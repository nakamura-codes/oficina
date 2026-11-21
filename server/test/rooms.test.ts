import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { EMPTY_OUTFIT, TURN_SECONDS, VS_INTRO_MS, type ServerMessage } from '@oficina/shared';
import { Matchmaker, type Sock } from '../src/rooms.ts';

class TestSocket implements Sock {
  readonly OPEN = 1;
  readyState = 1;
  messages: ServerMessage[] = [];
  send(data: string) { this.messages.push(JSON.parse(data) as ServerMessage); }
}

function pair(mm: Matchmaker, a: TestSocket, b: TestSocket) {
  mm.join({ ws: a, name: 'A', outfit: { ...EMPTY_OUTFIT } }, false);
  mm.join({ ws: b, name: 'B', outfit: { ...EMPTY_OUTFIT, head: 'scouter' } }, false);
  const found = mm.matchOf(a);
  if (!found) throw new Error('Partida não criada');
  expect(mm.matchOf(b)?.match).toBe(found.match);
  return found.match;
}

beforeEach(() => {
  vi.useFakeTimers();
  if (!globalThis.crypto) vi.stubGlobal('crypto', webcrypto);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ciclo de vida das partidas PvP', () => {
  it('sair da fila para treinar deixa os próximos dois jogadores disputarem o PvP', () => {
    const mm = new Matchmaker();
    const player = { ws: new TestSocket(), name: 'Treino', outfit: EMPTY_OUTFIT };
    mm.join(player, false);
    mm.join(player, true);
    const training = mm.matchOf(player.ws)!.match;
    mm.join(player, false);
    const duel = pair(mm, new TestSocket(), new TestSocket());
    expect(duel).not.toBe(training);
    expect(mm.matchOf(player.ws)?.match).toBe(training);
    expect(player.ws.messages.filter(m => m.t === 'match')).toHaveLength(1);
  });

  it('retomar o treino durante uma busca retira a conexão da fila', () => {
    const mm = new Matchmaker();
    const player = { ws: new TestSocket(), name: 'Treino', outfit: EMPTY_OUTFIT };
    mm.join(player, true);
    const training = mm.matchOf(player.ws)!.match;
    mm.disconnect(player.ws);
    const resumed = new TestSocket();
    mm.join({ ...player, ws: resumed }, false);
    expect(mm.rejoin(training.seats[0].token, resumed)).toBe(true);
    const duel = pair(mm, new TestSocket(), new TestSocket());
    expect(mm.rejoin(training.seats[0].token, duel.seats[0].ws!)).toBe(false);
    expect(mm.matchOf(resumed)?.match).toBe(training);
  });

  it('envia os avatares por assento e reserva a abertura antes do primeiro turno', () => {
    const mm = new Matchmaker();
    const a = new TestSocket(), b = new TestSocket();
    mm.join({ws: a, name: 'A', avatar: 'naruto', outfit: EMPTY_OUTFIT}, false);
    mm.join({ws: b, name: 'B', outfit: EMPTY_OUTFIT}, false);
    for (const peer of [a, b]) {
      expect(peer.messages.find(m => m.t === 'match')).toMatchObject({avatars: ['naruto', null]});
    }
    const match = mm.matchOf(a)!.match;
    vi.advanceTimersByTime(VS_INTRO_MS + 3500);
    expect(match.remainingMs()).toBe(TURN_SECONDS * 1000);
    const resumed = new TestSocket();
    mm.disconnect(a);
    expect(mm.rejoin(match.seats[0].token, resumed)).toBe(true);
    expect(resumed.messages.find(m => m.t === 'match')).toMatchObject({resumed: true});
  });

  it('a limpeza atrasada da partida anterior não remove os dois jogadores da revanche', () => {
    const mm = new Matchmaker();
    const a = new TestSocket(), b = new TestSocket();
    const first = pair(mm, a, b);
    first.forfeit(0);
    vi.advanceTimersByTime(50_000);
    const current = pair(mm, a, b);
    const kept = { uid: 'keep-revanche', id: 'golpe_basico' };
    current.state.fighters[0].hand = [kept];
    current.state.fighters[1].hand = [
      { uid: 'scan-revanche', id: 'leitura_de_poder' },
      { uid: 'attack-revanche', id: 'golpe_basico' },
    ];
    current.handle(0, { t: 'keep', uid: kept.uid });
    current.handle(1, { t: 'play', uid: 'scan-revanche' });
    current.handle(1, { t: 'play', uid: 'attack-revanche' });
    vi.advanceTimersByTime(10_001); // timer da sala anterior dispara no meio da nova
    expect(mm.matchOf(a)?.match).toBe(current);
    expect(mm.matchOf(b)?.match).toBe(current);
    current.handle(0, { t: 'ready' });
    current.handle(1, { t: 'ready' });
    expect(current.state.phase).toBe('planning');
    expect(current.state.turn).toBe(2);
    expect(current.state.fighters[0].hp).toBe(192);
    expect(current.state.fighters[0].hand).toContainEqual(kept);
    current.handle(0, { t: 'play', uid: kept.uid });
    expect(current.state.fighters[0].queue[0]?.card).toEqual(kept);
    expect(mm.matchOf(a)?.match).toBe(current);
    expect(mm.matchOf(b)?.match).toBe(current);
  });

  it('uma nova conexão conserva a partida atual e seu token após a limpeza antiga', () => {
    const mm = new Matchmaker();
    const a = new TestSocket(), b = new TestSocket();
    const first = pair(mm, a, b);
    first.forfeit(0);
    vi.advanceTimersByTime(50_000);
    const current = pair(mm, a, b);
    const token = current.seats[0].token;
    mm.disconnect(a);
    const reconnect = new TestSocket();
    expect(mm.rejoin(token, reconnect)).toBe(true);
    vi.advanceTimersByTime(10_001);
    expect(mm.matchOf(reconnect)?.match).toBe(current);
    expect(mm.matchOf(b)?.match).toBe(current);
    expect(mm.rejoin(first.seats[0].token, new TestSocket())).toBe(false);
  });
});
