/** Conexão de um jogador: só o que a lógica usa (serve para o 'ws' do Node e para a Cloudflare). */
export interface Sock {
  send(data: string): void;
  readonly readyState: number;
  readonly OPEN: number;
}

/** Aleatórios sem depender do Node (funciona no Node e no Cloudflare Workers). */
function randomInt(max: number): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % max;
}
function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}
import {
  RECONNECT_SECONDS,
  TURN_SECONDS, VS_INTRO_MS, type AvatarId,
  bothReady,
  createBattle,
  moveToFront,
  itemsForSlot,
  toggleKeep,
  playCard,
  resolveTurn,
  setReady,
  undoLastCard,
  viewFor,
  type BattleEvent,
  type BattleState,
  type BotLevel,
  type Outfit,
  type PlayerIndex,
  type ServerMessage,
} from '@oficina/shared';
import { botPlays } from './bot.ts';

export interface Lobbyist {
  avatar?: AvatarId | null;
  ws: Sock;
  name: string;
  outfit: Outfit;
  /** Conta logada (chave em minúsculas) ou null para convidado. */
  account?: string | null;
}

export interface Seat {
  avatar: AvatarId | null;
  ws: Sock | null;
  name: string;
  token: string;
  isBot: boolean;
  account: string | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
}

export function send(ws: Sock | null, msg: ServerMessage) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

const COIN_MS = 3500;

const BOT_NAMES: Record<BotLevel, string> = {
  iniciante: 'Bot Iniciante',
  competitivo: 'Bot Competitivo',
  deus: 'Deus das Cartas',
};

const pick = <T>(a: T[]): T => a[randomInt(a.length)];

/** Roupa do bot conforme o nível (as do Deus das Cartas são as que mais punem quem joga no automático). */
function botOutfitFor(level: BotLevel): Outfit {
  const ids = (slot: 'head' | 'body' | 'hand') => itemsForSlot(slot).map((i) => i.id);
  if (level === 'iniciante') return { head: pick(ids('head')), body: pick(ids('body')), hand: pick(ids('hand')) };
  if (level === 'deus') {
    return pick<Outfit>([
      { head: 'venda_olhos', body: 'uniforme_jujutsu', hand: 'kunai_ninja' },
      { head: 'bandana_ninja', body: 'uniforme_jujutsu', hand: 'kunai_ninja' },
      { head: 'venda_olhos', body: 'uniforme_naruto', hand: 'kunai_ninja' },
    ]);
  }
  return pick<Outfit>([
    { head: 'bandana_ninja', body: 'gi_laranja', hand: 'espada_trunks' },
    { head: 'chapeu_palha', body: 'gi_laranja', hand: 'pistola_pirata' },
    { head: 'mascara_hollow', body: 'shihakusho', hand: 'espada_trunks' },
    { head: 'venda_olhos', body: 'shihakusho', hand: pick(ids('hand')) },
  ]);
}

/** Tempo extra para o cliente animar a revelação antes do relógio voltar a correr. */
function animationBuffer(events: BattleEvent[]): number {
  return Math.min(8000, 1200 + events.filter(e => e.type !== 'cardFocus').length * 350);
}

export class Match {
  /** Seed fixa para testes (o servidor Node lê de SEED). */
  static seed: number | undefined;
  readonly id = randomHex(16);
  readonly startedAt = Date.now();
  state: BattleState;
  seats: [Seat, Seat];
  deadline = 0;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private botTimer: ReturnType<typeof setTimeout> | null = null;
  finished = false;

  constructor(
    a: Lobbyist,
    b: Lobbyist | 'bot',
    private onFinish: (m: Match) => void,
    readonly botLevel: BotLevel = 'competitivo',
  ) {
    const botName = BOT_NAMES[botLevel];
    const botOutfit = botOutfitFor(botLevel);
    // SEED fixa o embaralhamento e a moeda (útil para testes).
    const seed = Match.seed !== undefined ? Match.seed : randomInt(2 ** 31);
    this.state = createBattle(seed, [
      { name: a.name, outfit: a.outfit },
      b === 'bot' ? { name: botName, outfit: botOutfit } : { name: b.name, outfit: b.outfit },
    ]);
    const token = () => randomHex(16);
    this.seats = [
      { avatar: a.avatar ?? null, ws: a.ws, name: a.name, token: token(), isBot: false, account: a.account ?? null, reconnectTimer: null },
      b === 'bot'
        ? { avatar: null, ws: null, name: botName, token: token(), isBot: true, account: null, reconnectTimer: null }
        : { avatar: b.avatar ?? null, ws: b.ws, name: b.name, token: token(), isBot: false, account: b.account ?? null, reconnectTimer: null },
    ];
  }

  start() {
    for (const p of [0, 1] as PlayerIndex[]) {
      const opp = this.seats[p === 0 ? 1 : 0];
      send(this.seats[p].ws, { t: 'match', you: p, opponentName: opp.name, token: this.seats[p].token, avatars: [this.seats[0].avatar, this.seats[1].avatar] });
    }
    // Tempo para a animação da moeda antes do relógio do turno 1.
    this.beginPlanning(VS_INTRO_MS + COIN_MS);
    this.broadcastState();
  }

  remainingMs(): number {
    return this.deadline ? Math.max(0, this.deadline - Date.now()) : 0;
  }

  seatOf(ws: Sock): PlayerIndex | null {
    if (this.seats[0].ws === ws) return 0;
    if (this.seats[1].ws === ws) return 1;
    return null;
  }

  private beginPlanning(extraMs: number) {
    this.clearTimers();
    this.deadline = Date.now() + TURN_SECONDS * 1000 + extraMs;
    this.turnTimer = setTimeout(() => this.onTimeout(), this.deadline - Date.now());
    for (const p of [0, 1] as PlayerIndex[]) {
      if (!this.seats[p].isBot) continue;
      // O Deus das Cartas espera a jogada do oponente (ou os últimos segundos do turno) para reagir a ela.
      const delay = this.botLevel === 'deus' ? this.deadline - Date.now() - 3000 : extraMs + 1500 + Math.random() * 2500;
      this.botTimer = setTimeout(() => this.runBot(p), Math.max(500, delay));
    }
  }

  private runBot(p: PlayerIndex) {
    if (this.finished || this.state.phase !== 'planning') return;
    if (this.state.fighters[p].ready) return;
    this.state = botPlays(this.state, p, this.botLevel);
    const r = setReady(this.state, p);
    if (r.ok) this.state = r.state;
    this.afterAction();
  }

  private onTimeout() {
    if (this.finished) return;
    for (const p of [0, 1] as PlayerIndex[]) {
      if (!this.state.fighters[p].ready) {
        const r = setReady(this.state, p);
        if (r.ok) this.state = r.state;
      }
    }
    this.resolve();
  }

  handle(p: PlayerIndex, msg: { t: 'play'; uid: string } | { t: 'undo' } | { t: 'ready' } | { t: 'moveFirst'; uid: string } | { t: 'keep'; uid: string }) {
    if (this.finished) return;
    const r =
      msg.t === 'play'
        ? playCard(this.state, p, msg.uid)
        : msg.t === 'moveFirst'
          ? moveToFront(this.state, p, msg.uid)
          : msg.t === 'keep'
            ? toggleKeep(this.state, p, msg.uid)
        : msg.t === 'undo'
          ? undoLastCard(this.state, p)
          : setReady(this.state, p);
    if (!r.ok) {
      send(this.seats[p].ws, { t: 'error', message: r.error });
      // Reenvia o estado verdadeiro para o cliente se corrigir.
      send(this.seats[p].ws, { t: 'state', view: viewFor(this.state, p), remainingMs: this.remainingMs() });
      return;
    }
    this.state = r.state;
    this.afterAction();
  }

  private afterAction() {
    if (bothReady(this.state)) return this.resolve();
    this.broadcastState();
    // Deus das Cartas: assim que o oponente confirma, responde (com uma pausa para parecer que pensa).
    if (this.botLevel === 'deus') {
      for (const p of [0, 1] as PlayerIndex[]) {
        const opp: PlayerIndex = p === 0 ? 1 : 0;
        if (this.seats[p].isBot && !this.state.fighters[p].ready && this.state.fighters[opp].ready) {
          if (this.botTimer) clearTimeout(this.botTimer);
          this.botTimer = setTimeout(() => this.runBot(p), 900 + Math.random() * 900);
        }
      }
    }
  }

  private resolve() {
    const { state, events } = resolveTurn(this.state);
    this.state = state;
    if (state.phase === 'over') {
      this.clearTimers();
      this.deadline = 0;
    } else {
      this.beginPlanning(animationBuffer(events));
    }
    for (const p of [0, 1] as PlayerIndex[]) {
      send(this.seats[p].ws, { t: 'resolved', events, view: viewFor(this.state, p), remainingMs: this.remainingMs() });
    }
    if (state.phase === 'over') this.finish();
  }

  private broadcastState() {
    for (const p of [0, 1] as PlayerIndex[]) {
      send(this.seats[p].ws, { t: 'state', view: viewFor(this.state, p), remainingMs: this.remainingMs() });
    }
  }

  disconnect(p: PlayerIndex) {
    const seat = this.seats[p];
    seat.ws = null;
    if (this.finished) return;
    const oppIdx: PlayerIndex = p === 0 ? 1 : 0;
    send(this.seats[oppIdx].ws, { t: 'opponentStatus', connected: false });
    seat.reconnectTimer = setTimeout(() => this.forfeit(p), RECONNECT_SECONDS * 1000);
  }

  rejoin(p: PlayerIndex, ws: Sock) {
    const seat = this.seats[p];
    if (seat.reconnectTimer) clearTimeout(seat.reconnectTimer);
    seat.reconnectTimer = null;
    seat.ws = ws;
    const oppIdx: PlayerIndex = p === 0 ? 1 : 0;
    send(ws, { t: 'match', you: p, opponentName: this.seats[oppIdx].name, token: seat.token, resumed: true });
    send(ws, { t: 'state', view: viewFor(this.state, p), remainingMs: this.remainingMs() });
    send(this.seats[oppIdx].ws, { t: 'opponentStatus', connected: true });
  }

  /** Quem não voltou a tempo perde. */
  forfeit(p: PlayerIndex) {
    if (this.finished) return;
    const winner: PlayerIndex = p === 0 ? 1 : 0;
    this.state = { ...this.state, phase: 'over', winner };
    this.clearTimers();
    for (const i of [0, 1] as PlayerIndex[]) {
      send(this.seats[i].ws, {
        t: 'resolved',
        events: [{ type: 'gameOver', winner }],
        view: viewFor(this.state, i),
        remainingMs: 0,
      });
    }
    this.finish();
  }

  private finish() {
    this.finished = true;
    this.clearTimers();
    for (const s of this.seats) if (s.reconnectTimer) clearTimeout(s.reconnectTimer);
    this.onFinish(this);
  }

  private clearTimers() {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.botTimer) clearTimeout(this.botTimer);
    this.turnTimer = null;
    this.botTimer = null;
  }
}

/** Fila de pareamento: os dois primeiros que entram jogam entre si. */
export class Matchmaker {
  private waiting: Lobbyist | null = null;
  private byWs = new Map<Sock, Match>();
  private byToken = new Map<string, { match: Match; seat: PlayerIndex }>();
  /** Chamado quando uma partida termina (para gravar vitórias e derrotas). */
  onResult: ((m: Match) => void) | null = null;

  join(l: Lobbyist, vsBot: boolean, level: BotLevel = 'competitivo') {
    // Partida que já acabou não prende o jogador: pode começar outra na hora.
    if (this.byWs.get(l.ws)?.finished) this.byWs.delete(l.ws);
    if (this.byWs.has(l.ws)) return;
    if (vsBot) return this.startMatch(new Match(l, 'bot', (m) => this.cleanup(m), level));
    if (this.waiting && this.waiting.ws !== l.ws && this.waiting.ws.readyState === this.waiting.ws.OPEN) {
      const other = this.waiting;
      if (l.account && other.account === l.account) {
        send(l.ws, { t: 'error', message: 'Use duas contas diferentes para um duelo PvP.' });
        return;
      }
      this.startMatch(new Match(other, l, (m) => this.cleanup(m)));
    } else {
      this.waiting = l;
      send(l.ws, { t: 'queued' });
    }
  }

  busy(ws: Sock) {
    const match = this.byWs.get(ws);
    return this.waiting?.ws === ws || Boolean(match && !match.finished);
  }

  privateMatch(a: Lobbyist, b: Lobbyist) {
    if (this.busy(a.ws) || this.busy(b.ws)) return;
    this.startMatch(new Match(a, b, m => this.cleanup(m)));
  }

  leaveQueue(ws: Sock) {
    if (this.waiting?.ws === ws) this.waiting = null;
  }

  private startMatch(m: Match) {
    m.seats.forEach((s, i) => {
      if (s.ws) {
        this.leaveQueue(s.ws);
        this.byWs.set(s.ws, m);
      }
      this.byToken.set(s.token, { match: m, seat: i as PlayerIndex });
    });
    m.start();
  }

  matchOf(ws: Sock) {
    const m = this.byWs.get(ws);
    if (!m) return null;
    const seat = m.seatOf(ws);
    return seat === null ? null : { match: m, seat };
  }

  rejoin(token: string, ws: Sock): boolean {
    const entry = this.byToken.get(token);
    if (!entry || entry.match.finished) return false;
    const current = this.matchOf(ws);
    if (current && !current.match.finished && (current.match !== entry.match || current.seat !== entry.seat)) return false;
    this.leaveQueue(ws);
    const old = entry.match.seats[entry.seat].ws;
    if (old) this.byWs.delete(old);
    this.byWs.set(ws, entry.match);
    entry.match.rejoin(entry.seat, ws);
    return true;
  }

  disconnect(ws: Sock) {
    this.leaveQueue(ws);
    const found = this.matchOf(ws);
    if (!found) return;
    this.byWs.delete(ws);
    found.match.disconnect(found.seat);
  }

  private cleanup(m: Match) {
    try {
      this.onResult?.(m);
    } catch {
      /* gravar o resultado nunca derruba o servidor */
    }
    // Mantém os tokens um pouco para quem recarregar a página ver o resultado; depois limpa.
    setTimeout(() => {
      for (const s of m.seats) {
        // A conexão pode já estar em outra partida (revanche ou treino).
        // O timer da sala antiga não pode remover o vínculo da sala atual.
        if (this.byToken.get(s.token)?.match === m) this.byToken.delete(s.token);
        if (s.ws && this.byWs.get(s.ws) === m) this.byWs.delete(s.ws);
      }
    }, 60_000);
  }
}
