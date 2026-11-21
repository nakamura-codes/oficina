import { BASE_DECK, comboFor, getCard, isArmor } from './cards.ts';
import { outfitCards } from './outfits.ts';
import { nextRandom, shuffle } from './rng.ts';
import { ARENAS } from './arenas.ts';
import type {
  BattleEvent,
  BattleState,
  BattleView,
  CardInstance,
  Fighter,
  FighterPublicView,
  Outfit,
  PlayerIndex,
  PowerId,
  QueuedCard,
} from './types.ts';

export const RULES = {
  maxHp: 200,
  kiPerTurn: 3,
  /** Ki que sobra passa para o próximo turno, até este limite. */
  maxKi: 5,
  drawPerTurn: 5,
  maxHandSize: 10,
  turnLimit: 24,
  bankaiBonus: 4,
  /** Fraco que o Bankai deixa quando acaba. */
  bankaiExhaustion: 2,
  /** Força extra enquanto a Hollowficação estiver ativa. */
  hollowStrength: 4,
  /** HP que Hollowficação e Gear Second custam em cada turno ativo. */
  powerHpCost: 10,
  /** HP que o Gear Second custa em cada turno ativo. */
  gearSecondHpCost: 8,
} as const;

export interface PlayerSetup {
  name: string;
  outfit: Outfit;
}

export type ActionResult = { ok: true; state: BattleState } | { ok: false; error: string };

const other = (p: PlayerIndex): PlayerIndex => (p === 0 ? 1 : 0);

function clone<T>(v: T): T {
  return structuredClone(v);
}

function newFighter(setup: PlayerSetup, cards: CardInstance[]): Fighter {
  return {
    name: setup.name,
    outfit: setup.outfit,
    hp: RULES.maxHp,
    maxHp: RULES.maxHp,
    block: 0,
    ki: 0,
    strength: 0,
    tempStrength: 0,
    weak: 0,
    vulnerable: 0,
    powers: [],
    powerTurns: [],
    charges: [],
    drawPile: cards,
    hand: [],
    discard: [],
    exhausted: [],
    queue: [],
    ready: false,
    revealing: false,
    cloneNext: false,
    bonusDraw: 0,
    damageTakenThisTurn: 0,
    decayWeak: false,
    decayVulnerable: false,
    pendingCombo: null,
    lockedTo: null,
    evade: 0,
    reflect: 0,
    stunned: 0,
    stunnedNow: false,
    kiPenalty: 0,
    kiPenaltyTurns: 0,
    kiCap: RULES.maxKi,
    nextAttackBonus: 0,
    sageTurns: 0,
    sageStrength: 0,
    sageDraw: 0,
    pendingCards: [],
    keepUid: null,
    lastKeptUid: null,
  };
}

export function buildDeck(outfit: Outfit): string[] {
  return [...BASE_DECK, ...outfitCards(outfit)];
}

/** Cria a batalha e já começa o turno 1 (cartas compradas). */
/** Efeito de um poder ativo em cada turno (o primeiro acontece quando ele é jogado). */
function powerTick(state: BattleState, p: PlayerIndex, power: PowerId, events: BattleEvent[]) {
  const f = state.fighters[p];
  if (power === 'gearSecond') {
    f.ki = Math.min(f.kiCap, f.ki + 1);
    loseHp(f, p, RULES.gearSecondHpCost, 'Gear Second', events);
  } else if (power === 'hollow') {
    loseHp(f, p, RULES.powerHpCost, 'Hollowficação', events);
  } else if (power === 'domain') {
    state.fighters[other(p)].weak += 1;
    events.push({ type: 'status', player: other(p), status: 'weak', amount: 1 });
  }
}

export function createBattle(seed: number, players: [PlayerSetup, PlayerSetup]): BattleState {
  let rng = seed >>> 0;
  let uid = 0;
  const fighters = players.map((setup) => {
    const cards = buildDeck(setup.outfit).map((id) => ({ uid: `c${uid++}`, id }));
    const [shuffled, next] = shuffle(cards, rng);
    rng = next;
    return newFighter(setup, shuffled);
  }) as [Fighter, Fighter];

  // Moeda: quem começa o turno 1. Depois alterna.
  const [coin, afterCoin] = nextRandom(rng);
  const [arenaRoll, afterArena] = nextRandom(afterCoin);
  rng = afterArena;

  const state: BattleState = {
    seed,
    rngState: rng,
    firstPlayer: coin < 0.5 ? 0 : 1,
    arena: Math.floor(arenaRoll * ARENAS.length),
    turn: 0,
    phase: 'planning',
    fighters,
    winner: null,
    uidCounter: uid,
  };
  startTurn(state, []);
  return state;
}

function draw(state: BattleState, f: Fighter, n: number) {
  for (let i = 0; i < n; i++) {
    if (f.hand.length >= RULES.maxHandSize) return;
    if (f.drawPile.length === 0) {
      if (f.discard.length === 0) return;
      const [shuffled, next] = shuffle(f.discard, state.rngState);
      state.rngState = next;
      f.drawPile = shuffled;
      f.discard = [];
    }
    f.hand.push(f.drawPile.shift()!);
  }
}

function startTurn(state: BattleState, events: BattleEvent[]) {
  state.turn += 1;
  state.phase = 'planning';
  for (const p of [0, 1] as PlayerIndex[]) {
    const f = state.fighters[p];
    f.block = 0;
    f.evade = 0;
    f.nextAttackBonus = 0;
    f.reflect = 0;
    // Haki do Rei: atordoamento e Ki máximo reduzido valem a partir deste turno.
    f.stunnedNow = f.stunned > 0;
    if (f.stunned > 0) f.stunned -= 1;
    f.kiCap = RULES.maxKi - (f.kiPenaltyTurns > 0 ? f.kiPenalty : 0);
    if (f.kiPenaltyTurns > 0) f.kiPenaltyTurns -= 1;
    f.ki = Math.min(f.kiCap, f.ki + RULES.kiPerTurn);
    f.queue = [];
    f.ready = false;
    f.revealing = false;
    f.cloneNext = false;
    f.damageTakenThisTurn = 0;
  }
  // Poderes ativos acontecem no início do turno; os que acabaram saem antes.
  for (const p of [0, 1] as PlayerIndex[]) {
    const f = state.fighters[p];
    f.powerTurns = f.powerTurns.map((t) => t - 1);
    for (let i = f.powers.length - 1; i >= 0; i--) {
      if (f.powerTurns[i] <= 0) {
        events.push({ type: 'powerEnd', player: p, power: f.powers[i] });
        // Bankai: ao acabar, o corpo cobra o preço (exaustão).
        if (f.powers[i] === 'bankai') {
          f.weak += RULES.bankaiExhaustion;
          events.push({ type: 'status', player: p, status: 'weak', amount: RULES.bankaiExhaustion });
        }
        f.powers.splice(i, 1);
        f.powerTurns.splice(i, 1);
      }
    }
    for (const power of f.powers) powerTick(state, p, power, events);
  }
  for (const f of state.fighters) {
    // Modo Sábio: bônus no início de cada turno enquanto durar (Força dura só o turno).
    if (f.sageTurns > 0) {
      f.tempStrength += f.sageStrength;
      f.bonusDraw += f.sageDraw;
      f.sageTurns -= 1;
    }
    f.decayWeak = f.weak > 0;
    f.decayVulnerable = f.vulnerable > 0;
    draw(state, f, RULES.drawPerTurn + f.bonusDraw);
    f.bonusDraw = 0;
    // Evolução (ex.: Galick Gun → Big Bang Attack): chega na mão agora.
    for (const id of f.pendingCards) f.hand.push({ uid: `t${state.uidCounter++}`, id });
    f.pendingCards = [];
    // Carta criada por combo no turno anterior: chega agora e trava o turno nela.
    if (f.pendingCombo) {
      f.hand.push({ uid: `t${state.uidCounter++}`, id: f.pendingCombo });
      f.lockedTo = f.pendingCombo;
      f.pendingCombo = null;
    }
  }
  checkGameOver(state, events);
}

function loseHp(f: Fighter, p: PlayerIndex, amount: number, reason: string, events: BattleEvent[]) {
  f.hp = Math.max(0, f.hp - amount);
  events.push({ type: 'hpLoss', player: p, amount, reason });
}

/** Quem resolve primeiro neste turno: a moeda escolhe o turno 1, depois alterna. */
export function turnStarter(state: BattleState): PlayerIndex {
  return state.turn % 2 === 1 ? state.firstPlayer : other(state.firstPlayer);
}

/** Custo efetivo: no turno travado pelo combo, a carta criada é de graça. */
function effectiveCost(f: Pick<Fighter, 'lockedTo'>, cardId: string): number {
  return f.lockedTo === cardId ? 0 : getCard(cardId).cost;
}

/** Custo debitado se a carta for jogada agora, incluindo evoluções com Ki cheio. */
export function currentCardCost(f: Pick<Fighter, 'ki' | 'lockedTo'>, cardId: string): number {
  const def = getCard(cardId);
  if (def.evolve && f.ki >= def.evolve.atKi) return def.evolve.atKi;
  return effectiveCost(f, cardId);
}

/** Red + Blue (ou outro combo) já está na fila: o turno fecha. */
export function hasComboLock(f: Fighter): boolean {
  return comboFor(f.queue.map((q) => q.card.id)) !== undefined;
}

/** Recalcula as marcas que dependem da fila (clone pendente e Sharingan). */
function recomputeQueueFlags(f: Fighter) {
  let cloneNext = false;
  let revealing = false;
  f.queue.forEach((q, index) => { q.playOrder ??= index; });
  const played = [...f.queue].sort((a, b) => a.playOrder! - b.playOrder!);
  for (const q of played) {
    const def = getCard(q.card.id);
    if (def.effects.some((e) => e.kind === 'reveal')) revealing = true;
    const isClone = def.effects.some((e) => e.kind === 'clone');
    q.doubled = cloneNext && !isClone;
    cloneNext = isClone;
  }
  f.cloneNext = cloneNext;
  f.revealing = revealing;
}

/** Jogador coloca uma carta da mão na fila do turno (escondida até a revelação). */
export function playCard(state: BattleState, player: PlayerIndex, cardUid: string): ActionResult {
  if (state.phase !== 'planning') return { ok: false, error: 'A partida não está na fase de escolha.' };
  const f = state.fighters[player];
  if (f.ready) return { ok: false, error: 'Você já confirmou este turno.' };
  const idx = f.hand.findIndex((c) => c.uid === cardUid);
  if (idx < 0) return { ok: false, error: 'Essa carta não está na sua mão.' };
  const def = getCard(f.hand[idx].id);
  if (f.stunnedNow) return { ok: false, error: 'Você está atordoado neste turno.' };
  if (f.lockedTo && def.id !== f.lockedTo) {
    return { ok: false, error: `Neste turno você só pode jogar ${getCard(f.lockedTo).name}.` };
  }
  if (hasComboLock(f)) return { ok: false, error: 'Combo feito: nenhuma outra carta neste turno.' };
  // Galick Gun com Ki cheio: vira a carga do Big Bang Attack (gasta todo esse Ki).
  const powered = !!def.evolve && f.ki >= def.evolve.atKi;
  const cost = currentCardCost(f, def.id);
  if (cost > f.ki) return { ok: false, error: 'Ki insuficiente.' };

  const next = clone(state);
  const nf = next.fighters[player];
  const [card] = nf.hand.splice(idx, 1);
  nf.ki -= cost;
  const playOrder = 1 + Math.max(-1, ...nf.queue.map((q, index) => q.playOrder ?? index));
  if (nf.keepUid === card.uid) nf.keepUid = null; // jogar a carta tira a trava
  nf.queue.push({ card, doubled: false, paid: cost, powered, playOrder });
  recomputeQueueFlags(nf);
  return { ok: true, state: next };
}

/** Desfaz a última carta colocada na fila. */
export function undoLastCard(state: BattleState, player: PlayerIndex): ActionResult {
  if (state.phase !== 'planning') return { ok: false, error: 'A partida não está na fase de escolha.' };
  const f = state.fighters[player];
  if (f.ready) return { ok: false, error: 'Você já confirmou este turno.' };
  if (f.queue.length === 0) return { ok: false, error: 'Nenhuma carta para desfazer.' };
  const next = clone(state);
  const nf = next.fighters[player];
  const q = nf.queue.pop()!;
  nf.ki += q.paid ?? effectiveCost(nf, q.card.id);
  nf.hand.push(q.card);
  recomputeQueueFlags(nf);
  return { ok: true, state: next };
}

/** Leitura de Poder: coloca uma carta da sua jogada como a primeira a resolver. */
/**
 * Trava (ou destrava) uma carta da mão: ela não é descartada no fim do turno.
 * Uma por turno; a carta que ficou travada no turno anterior não pode ser travada de novo.
 */
export function toggleKeep(state: BattleState, player: PlayerIndex, cardUid: string): ActionResult {
  if (state.phase !== 'planning') return { ok: false, error: 'A partida não está na fase de escolha.' };
  const f = state.fighters[player];
  if (f.ready) return { ok: false, error: 'Você já confirmou este turno.' };
  const card = f.hand.find((c) => c.uid === cardUid);
  if (!card) return { ok: false, error: 'Essa carta não está na sua mão.' };
  if (f.keepUid !== cardUid) {
    if (cardUid === f.lastKeptUid) return { ok: false, error: 'Essa carta já ficou travada no turno passado.' };
    const def = getCard(card.id);
    if (def.ethereal || def.retain) return { ok: false, error: 'Essa carta não pode ser travada.' };
  }
  const next = clone(state);
  const nf = next.fighters[player];
  nf.keepUid = nf.keepUid === cardUid ? null : cardUid;
  return { ok: true, state: next };
}

export function moveToFront(state: BattleState, player: PlayerIndex, cardUid: string): ActionResult {
  if (state.phase !== 'planning') return { ok: false, error: 'A partida não está na fase de escolha.' };
  const f = state.fighters[player];
  if (f.ready) return { ok: false, error: 'Você já confirmou este turno.' };
  if (!canReorder(f)) return { ok: false, error: 'Só com Leitura de Poder na sua jogada.' };
  const idx = f.queue.findIndex((q) => q.card.uid === cardUid);
  if (idx < 0) return { ok: false, error: 'Essa carta não está na sua jogada.' };
  const next = clone(state);
  const nf = next.fighters[player];
  nf.queue.forEach((q, index) => { q.playOrder ??= index; });
  const [item] = nf.queue.splice(idx, 1);
  nf.queue.unshift(item);
  return { ok: true, state: next };
}

export function canReorder(f: Fighter): boolean {
  return f.queue.some((q) => getCard(q.card.id).effects.some((e) => e.kind === 'reorder'));
}

export function setReady(state: BattleState, player: PlayerIndex): ActionResult {
  if (state.phase !== 'planning') return { ok: false, error: 'A partida não está na fase de escolha.' };
  const next = clone(state);
  next.fighters[player].ready = true;
  return { ok: true, state: next };
}

export function bothReady(state: BattleState): boolean {
  return state.fighters[0].ready && state.fighters[1].ready;
}

function attackDamage(state: BattleState, source: PlayerIndex, target: PlayerIndex, base: number, fixed = false): number {
  if (fixed) return base;
  const a = state.fighters[source];
  const t = state.fighters[target];
  const bankai = a.powers.filter((p) => p === 'bankai').length * RULES.bankaiBonus;
  const hollow = a.powers.filter((p) => p === 'hollow').length * RULES.hollowStrength;
  let dmg = base + a.strength + a.tempStrength + bankai + hollow;
  if (a.weak > 0) dmg = Math.floor(dmg * 0.75);
  if (t.vulnerable > 0) dmg = Math.floor(dmg * 1.25);
  return Math.max(0, dmg);
}

function dealDamage(
  state: BattleState,
  source: PlayerIndex,
  target: PlayerIndex,
  base: number,
  pierce: boolean,
  cardId: string,
  events: BattleEvent[],
  fixed = false,
) {
  const t = state.fighters[target];
  const dmg = attackDamage(state, source, target, base, fixed);
  const blocked = pierce ? 0 : Math.min(t.block, dmg);
  t.block -= blocked;
  const hpDamage = dmg - blocked;
  t.hp = Math.max(0, t.hp - hpDamage);
  t.damageTakenThisTurn += hpDamage;
  events.push({ type: 'damage', source, target, cardId, amount: hpDamage, blocked });
}

/**
 * Infinity e Boogie Woogie agem sobre uma habilidade inteira (todos os golpes da carta).
 * Boogie Woogie tem prioridade: se o alvo tiver os dois, a habilidade volta no atacante.
 */
function intercept(state: BattleState, attacker: PlayerIndex, cardId: string, events: BattleEvent[], cannotEvade = false): 'evade' | 'reflect' | null {
  const target = other(attacker);
  const t = state.fighters[target];
  if (t.reflect > 0) {
    t.reflect -= 1;
    events.push({ type: 'reflect', player: target, cardId });
    return 'reflect';
  }
  if (!cannotEvade && t.evade > 0) {
    t.evade -= 1;
    events.push({ type: 'evade', player: target, cardId });
    return 'evade';
  }
  return null;
}

function resolveCard(state: BattleState, player: PlayerIndex, q: QueuedCard, events: BattleEvent[]) {
  const def = getCard(q.card.id);
  const f = state.fighters[player];
  const opp = other(player);
  const repeats = q.doubled ? 2 : 1;
  const isFirstCard = f.queue[0]?.card.uid === q.card.uid;
  let caught: 'evade' | 'reflect' | null | undefined;
  let bonus = 0;
  for (let r = 0; r < repeats; r++) {
    for (const e of def.effects) {
      switch (e.kind) {
        case 'damage': {
          if (caught === undefined) caught = intercept(state, player, def.id, events);
          if (caught === 'evade') break;
          const target = caught === 'reflect' ? player : opp;
          let amount = isFirstCard && e.firstCardAmount !== undefined ? e.firstCardAmount : e.amount;
          // Sonído: o bônus vale para todos os golpes do próximo ataque e é gasto nele.
          if (r === 0 && f.nextAttackBonus > 0 && !e.fixed) {
            bonus = f.nextAttackBonus;
            f.nextAttackBonus = 0;
          }
          amount += bonus;
          if (e.bonusVsBlock && state.fighters[target].block > 0) amount += e.bonusVsBlock;
          // Proporção 7:3: dano dobrado com o alvo em HP baixo.
          const tf = state.fighters[target];
          if (e.doubleBelowHp && tf.hp <= tf.maxHp * e.doubleBelowHp) amount *= 2;
          for (let i = 0; i < (e.times ?? 1); i++) dealDamage(state, player, target, amount, !!e.pierce, def.id, events, !!e.fixed);
          break;
        }
        case 'sage':
          f.sageTurns = e.turns;
          f.sageStrength = e.strength;
          f.sageDraw = e.draw;
          events.push({ type: 'status', player, status: 'strength', amount: e.strength, cardId: def.id });
          break;
        case 'evolve':
          f.pendingCards.push(e.into);
          events.push({ type: 'chargeStart', player, cardId: def.id, turns: 1 });
          break;
        case 'returnCard': {
          // Volta para uma posição aleatória do baralho de compra.
          const [r, nextRng] = nextRandom(state.rngState);
          state.rngState = nextRng;
          const at = Math.floor(r * (f.drawPile.length + 1));
          f.drawPile.splice(at, 0, { uid: `t${state.uidCounter++}`, id: e.cardId });
          break;
        }
        case 'nextAttackBonus':
          f.nextAttackBonus += e.amount;
          break;
        case 'evade':
          f.evade += 1;
          break;
        case 'reflect':
          f.reflect += 1;
          break;
        case 'heal': {
          const healed = Math.min(e.amount, f.maxHp - f.hp);
          f.hp += healed;
          events.push({ type: 'heal', player, amount: healed });
          break;
        }
        case 'stun': {
          const o = state.fighters[opp];
          o.stunned = Math.max(o.stunned, e.turns);
          o.kiPenalty = e.kiPenalty;
          o.kiPenaltyTurns = Math.max(o.kiPenaltyTurns, e.kiPenaltyTurns);
          events.push({ type: 'stun', player: opp, turns: e.turns, kiPenalty: e.kiPenalty });
          break;
        }
        case 'block':
          f.block += e.amount;
          events.push({ type: 'block', player, amount: e.amount });
          break;
        case 'strength':
          if (e.temporary) f.tempStrength += e.amount;
          else f.strength += e.amount;
          events.push({ type: 'status', player, status: 'strength', amount: e.amount, cardId: def.id });
          break;
        case 'weak':
        case 'vulnerable':
          state.fighters[opp][e.kind] += e.amount;
          events.push({ type: 'status', player: opp, status: e.kind, amount: e.amount, cardId: def.id });
          break;
        case 'loseHp':
          loseHp(f, player, e.amount, def.name, events);
          break;
        case 'drawNext':
          f.bonusDraw += e.amount;
          break;
        case 'charge':
          f.charges.push({
            uid: `ch${state.uidCounter++}`,
            cardId: def.id,
            turnsLeft: e.turns,
            damage: e.damage,
            cancelOnDamage: e.cancelOnDamage,
            cancelOnlyOnStart: e.cancelOnlyOnStart,
            cannotEvade: e.cannotEvade,
          });
          events.push({ type: 'chargeStart', player, cardId: def.id, turns: e.turns });
          break;
        case 'power':
          f.powers.push(e.power);
          f.powerTurns.push(e.turns);
          events.push({ type: 'power', player, power: e.power });
          // O turno em que o poder é jogado já conta como um dos turnos ativos.
          powerTick(state, player, e.power, events);
          break;
        case 'reveal':
        case 'reorder':
        case 'clone':
          break;
      }
    }
  }
  // Evolução (Galick Gun com Ki cheio): depois do efeito normal, a carta vira outra,
  // que chega na mão no próximo turno.
  if (q.powered && def.evolve) {
    f.pendingCards.push(def.evolve.into);
    f.exhausted.push(q.card);
    events.push({ type: 'evolve', player, from: def.id, into: def.evolve.into });
    return;
  }
  if (def.exhaust || def.type === 'power') f.exhausted.push(q.card);
  else f.discard.push(q.card);
}

function tickCharges(state: BattleState, order: PlayerIndex[], events: BattleEvent[]) {
  for (const p of order) {
    const f = state.fighters[p];
    const remaining = [];
    for (const ch of f.charges) {
      ch.turnsLeft -= 1;
      if (ch.turnsLeft <= 0) {
        events.push({ type: 'chargeFire', player: p, cardId: ch.cardId });
        const caught = intercept(state, p, ch.cardId, events, ch.cannotEvade);
        if (caught !== 'evade') dealDamage(state, p, caught === 'reflect' ? p : other(p), ch.damage, false, ch.cardId, events);
      } else {
        remaining.push(ch);
      }
    }
    f.charges = remaining;
  }
}

function checkGameOver(state: BattleState, events: BattleEvent[]): boolean {
  if (state.phase === 'over') return true;
  const [a, b] = state.fighters;
  let winner: BattleState['winner'] = null;
  if (a.hp <= 0 && b.hp <= 0) winner = 'draw';
  else if (a.hp <= 0) winner = 1;
  else if (b.hp <= 0) winner = 0;
  else if (state.turn > RULES.turnLimit) winner = a.hp === b.hp ? 'draw' : a.hp > b.hp ? 0 : 1;
  if (winner === null) return false;
  state.phase = 'over';
  state.winner = winner;
  events.push({ type: 'gameOver', winner });
  return true;
}

/** Alterna as cartas dos dois jogadores: 1ª de quem começa, 1ª do outro, 2ª de quem começa… */
function interleave(order: PlayerIndex[], lists: QueuedCard[][]): [PlayerIndex, QueuedCard][] {
  const out: [PlayerIndex, QueuedCard][] = [];
  const len = Math.max(lists[0].length, lists[1].length);
  for (let i = 0; i < len; i++) {
    for (let k = 0; k < 2; k++) {
      const q = lists[k][i];
      if (q) out.push([order[k], q]);
    }
  }
  return out;
}

/**
 * Revela e resolve as cartas dos dois jogadores.
 * 1. Armadura (cartas com Bloqueio e sem dano), para a defesa sempre funcionar.
 * 2. Golpes carregados que disparam neste turno.
 * 3. O resto, na ordem em que cada jogador jogou (buff/debuff só vale para o que vem depois).
 * As cartas dos dois se alternam; a moeda escolhe quem começa o turno 1 e depois alterna.
 * A partida acaba na hora em que alguém chega a 0 HP.
 */
export function resolveTurn(state: BattleState): { state: BattleState; events: BattleEvent[] } {
  const next = clone(state);
  const events: BattleEvent[] = [];
  if (next.phase !== 'planning') return { state: next, events };

  const first = turnStarter(next);
  const order: PlayerIndex[] = [first, other(first)];
  const queues = order.map((p) => next.fighters[p].queue);
  const armor = interleave(order, queues.map((q) => q.filter((c) => isArmor(getCard(c.card.id)))));
  const rest = interleave(order, queues.map((q) => q.filter((c) => !isArmor(getCard(c.card.id)))));

  for (const [p, q] of [...armor, ...rest]) events.push({ type: 'play', player: p, cardId: q.card.id, doubled: q.doubled });

  let playIndex = 0;
  const resolvePlay = (p: PlayerIndex, q: QueuedCard) => {
    events.push({ type: 'cardFocus', index: playIndex++ });
    resolveCard(next, p, q, events);
    events.push({ type: 'cardFocus', index: null });
  };
  for (const [p, q] of armor) {
    resolvePlay(p, q);
    if (checkGameOver(next, events)) return { state: next, events };
  }
  tickCharges(next, order, events);
  if (checkGameOver(next, events)) return { state: next, events };
  for (const [p, q] of rest) {
    resolvePlay(p, q);
    if (checkGameOver(next, events)) return { state: next, events };
  }

  // Golpes carregados que podem ser interrompidos.
  for (const p of order) {
    const f = next.fighters[p];
    f.charges = f.charges.filter((ch) => {
      if (ch.cancelOnDamage !== undefined && f.damageTakenThisTurn >= ch.cancelOnDamage) {
        events.push({ type: 'chargeCancel', player: p, cardId: ch.cardId });
        return false;
      }
      // A Genki Dama sobrevivendo ao turno de lançamento não pode mais ser interrompida por dano.
      if (ch.cancelOnlyOnStart) delete ch.cancelOnDamage;
      return true;
    });
  }

  // Combos (ex.: Red + Blue → Hollow Purple no próximo turno).
  for (const p of order) {
    const f = next.fighters[p];
    const combo = comboFor(f.queue.map((q) => q.card.id));
    if (combo) {
      f.pendingCombo = combo.creates;
      events.push({ type: 'combo', player: p, cardId: combo.creates });
    }
  }

  // Fim do turno.
  for (const f of next.fighters) {
    // Cartas retidas (Big Bang Attack) ficam na mão; etéreas somem; o resto vai para o descarte.
    const kept: CardInstance[] = [];
    for (const c of f.hand) {
      const d = getCard(c.id);
      if (d.retain || c.uid === f.keepUid) kept.push(c);
      else (d.ethereal ? f.exhausted : f.discard).push(c);
    }
    f.hand = kept;
    f.lastKeptUid = f.keepUid;
    f.keepUid = null;
    f.queue = [];
    if (f.decayWeak) f.weak = Math.max(0, f.weak - 1);
    if (f.decayVulnerable) f.vulnerable = Math.max(0, f.vulnerable - 1);
    f.tempStrength = 0;
    // Turno travado pelo combo: o Ki recebido não acumula.
    if (f.lockedTo) {
      f.ki = 0;
      f.lockedTo = null;
    }
  }

  // Encerra após resolver a última rodada, sem um turno fantasma ou tick extra.
  if (next.turn >= RULES.turnLimit) {
    const [a, b] = next.fighters;
    next.phase = 'over';
    next.winner = a.hp === b.hp ? 'draw' : a.hp > b.hp ? 0 : 1;
    events.push({ type: 'gameOver', winner: next.winner });
    return { state: next, events };
  }
  startTurn(next, events);
  return { state: next, events };
}

function publicView(f: Fighter): FighterPublicView {
  return {
    name: f.name,
    outfit: f.outfit,
    hp: f.hp,
    maxHp: f.maxHp,
    block: f.block,
    ki: f.ki,
    strength: f.strength,
    tempStrength: f.tempStrength,
    weak: f.weak,
    vulnerable: f.vulnerable,
    powers: f.powers,
    powerTurns: f.powerTurns,
    charges: f.charges,
    handCount: f.hand.length,
    drawCount: f.drawPile.length,
    discardCount: f.discard.length,
    queueCount: f.queue.length,
    ready: f.ready,
    maxKi: f.kiCap,
    lockedTo: f.lockedTo,
    stunned: f.stunnedNow,
    sageTurns: f.sageTurns,
    evade: f.evade,
    reflect: f.reflect,
  };
}

/** Project only the player's queued cards against the public target, before its response. */
function previewQueue(state: BattleState, player: PlayerIndex): BattleView['me']['queuePreview'] {
  const result = { damage: 0, block: 0, hpCost: 0 };
  if (state.phase !== 'planning' || !state.fighters[player].queue.length) return result;

  const simulation = clone(state);
  const rival = simulation.fighters[other(player)];
  rival.block = rival.evade = rival.reflect = 0;
  const queue = simulation.fighters[player].queue;
  const events: BattleEvent[] = [];
  const armor = queue.filter(card => isArmor(getCard(card.card.id)));
  const rest = queue.filter(card => !isArmor(getCard(card.card.id)));
  for (const card of [...armor, ...rest]) {
    resolveCard(simulation, player, card, events);
    if (simulation.fighters[player].hp === 0 || rival.hp === 0) break;
  }
  for (const event of events) {
    if (event.type === 'damage' && event.target === other(player)) result.damage += event.amount;
    if (event.type === 'block' && event.player === player) result.block += event.amount;
    if (event.type === 'hpLoss' && event.player === player) result.hpCost += event.amount;
  }
  return result;
}

/** Estado visto por um jogador: as cartas escolhidas pelo oponente ficam escondidas, a não ser com Sharingan. */
export function viewFor(state: BattleState, player: PlayerIndex): BattleView {
  const me = state.fighters[player];
  const opp = state.fighters[other(player)];
  return {
    you: player,
    turn: state.turn,
    phase: state.phase,
    winner: state.winner,
    firstPlayer: state.firstPlayer,
    arena: ARENAS[state.arena]?.id ?? ARENAS[0].id,
    turnStarter: turnStarter(state),
    me: {
      ...publicView(me),
      queuePreview: previewQueue(state, player),
      hand: me.hand,
      queue: me.queue,
      cloneNext: me.cloneNext,
      revealing: me.revealing,
      comboLock: hasComboLock(me),
      canReorder: canReorder(me),
      keepUid: me.keepUid,
      lastKeptUid: me.lastKeptUid,
    },
    // O oponente não fica sabendo quantas cartas você escolheu (só com Sharingan).
    opponent: { ...publicView(opp), queueCount: me.revealing ? opp.queue.length : 0, queue: me.revealing ? opp.queue : null },
  };
}

/** Pré-visualização do dano de um golpe contra o oponente atual (para a interface). */
export function previewDamage(state: BattleState, player: PlayerIndex, base: number): number {
  return attackDamage(state, player, other(player), base);
}
