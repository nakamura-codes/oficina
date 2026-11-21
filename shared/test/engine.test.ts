import { describe, expect, it } from 'vitest';
import {
  CARDS,
  EMPTY_OUTFIT,
  figureKey,
  OUTFIT_ITEMS,
  RETIRED_CARDS,
  RULES,
  buildDeck,
  createBattle,
  currentCardCost,
  moveToFront,
  playCard,
  toggleKeep,
  previewCardDamage,
  resolveTurn,
  sanitizeOutfit,
  setReady,
  shuffle,
  undoLastCard,
  viewFor,
  type BattleState,
  type PlayerIndex,
} from '../src/index.ts';

const FULL = { head: 'chapeu_palha', body: 'gi_laranja', hand: null };

/** Batalha de teste: o jogador 0 começa o turno 1 (a moeda é fixada). */
function newBattle(seed = 1): BattleState {
  const s = createBattle(seed, [
    { name: 'A', outfit: FULL },
    { name: 'B', outfit: FULL },
  ]);
  s.firstPlayer = 0;
  return s;
}

/** Troca a mão de um jogador por cartas específicas (só para os testes). */
function giveHand(state: BattleState, p: PlayerIndex, ids: string[]) {
  state.fighters[p].hand = ids.map((id, i) => ({ uid: `t${p}_${i}_${id}`, id }));
}

function play(state: BattleState, p: PlayerIndex, id: string): BattleState {
  const card = state.fighters[p].hand.find((c) => c.id === id);
  if (!card) throw new Error(`sem ${id} na mão`);
  const r = playCard(state, p, card.uid);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

function readyAndResolve(state: BattleState) {
  let s = state;
  for (const p of [0, 1] as PlayerIndex[]) {
    const r = setReady(s, p);
    if (!r.ok) throw new Error(r.error);
    s = r.state;
  }
  return resolveTurn(s);
}

describe('dados', () => {
  it('toda carta das roupas existe', () => {
    for (const item of OUTFIT_ITEMS) for (const id of item.cards) expect(CARDS[id], id).toBeDefined();
  });

  it('baralho inicial = 8 básicas + 3 por peça vestida', () => {
    expect(buildDeck(FULL)).toHaveLength(14);
    expect(buildDeck({ head: 'bandana_ninja', body: null, hand: null })).toHaveLength(11);
    expect(buildDeck(EMPTY_OUTFIT)).toHaveLength(8);
  });

  it('toda carta aparece em alguma peça', () => {
    const fromItems = new Set(OUTFIT_ITEMS.flatMap((i) => i.cards));
    for (const id of Object.keys(CARDS)) if (!CARDS[id].token && !RETIRED_CARDS.includes(id) && !id.endsWith('_basico') && id !== 'defesa_basica') expect(fromItems.has(id), id).toBe(true);
  });

  it('peça inválida ou no espaço errado vira espaço vazio', () => {
    expect(sanitizeOutfit({ head: 'gi_laranja', body: 'xxx', hand: null })).toEqual(EMPTY_OUTFIT);
    expect(sanitizeOutfit({ head: 'bandana_ninja' })).toEqual({ head: 'bandana_ninja', body: null, hand: null });
    expect(sanitizeOutfit(null)).toEqual(EMPTY_OUTFIT);
  });

  it('nome da figura do personagem', () => {
    expect(figureKey(EMPTY_OUTFIT)).toBe('fig_none_none');
    expect(figureKey(FULL)).toBe('fig_chapeu_palha_gi_laranja');
  });
});

describe('embaralhamento', () => {
  it('é determinístico com a mesma seed', () => {
    const a = shuffle([1, 2, 3, 4, 5, 6, 7, 8], 42)[0];
    const b = shuffle([1, 2, 3, 4, 5, 6, 7, 8], 42)[0];
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('mesma seed gera a mesma batalha', () => {
    expect(newBattle(7).fighters[0].hand).toEqual(newBattle(7).fighters[0].hand);
  });
});

describe('início', () => {
  it('cada jogador começa com 5 cartas, 3 de Ki e 200 de HP', () => {
    const s = newBattle();
    for (const f of s.fighters) {
      expect(f.hand).toHaveLength(RULES.drawPerTurn);
      expect(f.ki).toBe(RULES.kiPerTurn);
      expect(f.hp).toBe(RULES.maxHp);
    }
  });
});

describe('jogar cartas', () => {
  it('recusa carta que não está na mão', () => {
    const s = newBattle();
    const r = playCard(s, 0, 'nao-existe');
    expect(r.ok).toBe(false);
  });

  it('recusa quando falta Ki', () => {
    const s = newBattle();
    s.fighters[0].ki = 5;
    giveHand(s, 0, ['genki_dama', 'getsuga']);
    const s2 = play(s, 0, 'genki_dama');
    const card = s2.fighters[0].hand.find((c) => c.id === 'getsuga')!;
    const r = playCard(s2, 0, card.uid);
    expect(r).toEqual({ ok: false, error: 'Ki insuficiente.' });
  });

  it('recusa depois de confirmar', () => {
    let s = newBattle();
    giveHand(s, 0, ['golpe_basico']);
    const r = setReady(s, 0);
    if (!r.ok) throw new Error();
    s = r.state;
    expect(playCard(s, 0, s.fighters[0].hand[0].uid).ok).toBe(false);
  });

  it('desfazer devolve a carta e o Ki', () => {
    let s = newBattle();
    giveHand(s, 0, ['getsuga']);
    s = play(s, 0, 'getsuga');
    expect(s.fighters[0].ki).toBe(1);
    const r = undoLastCard(s, 0);
    if (!r.ok) throw new Error();
    expect(r.state.fighters[0].ki).toBe(3);
    expect(r.state.fighters[0].hand.map((c) => c.id)).toEqual(['getsuga']);
  });

  it('não altera o estado original', () => {
    const s = newBattle();
    giveHand(s, 0, ['golpe_basico']);
    play(s, 0, 'golpe_basico');
    expect(s.fighters[0].hand).toHaveLength(1);
  });
});

describe('resolução', () => {
  it('bloqueio acontece antes dos ataques', () => {
    let s = newBattle();
    giveHand(s, 0, ['golpe_basico']);
    giveHand(s, 1, ['defesa_basica']);
    s = play(s, 0, 'golpe_basico');
    s = play(s, 1, 'defesa_basica');
    const { state } = readyAndResolve(s);
    expect(state.fighters[1].hp).toBe(199); // 8 de dano - 7 de bloqueio
  });

  it('o bloqueio zera no início do turno', () => {
    let s = newBattle();
    giveHand(s, 1, ['haki']);
    s = play(s, 1, 'haki');
    const { state } = readyAndResolve(s);
    expect(state.fighters[1].block).toBe(0);
    // A Força do Busoshoku Haki dura só o turno.
    expect(state.fighters[1].strength).toBe(0);
    expect(state.fighters[1].tempStrength).toBe(0);
  });

  it('Chidori ignora o bloqueio', () => {
    let s = newBattle();
    giveHand(s, 0, ['chidori']);
    giveHand(s, 1, ['haki']);
    s = play(s, 0, 'chidori');
    s = play(s, 1, 'haki');
    const { state } = readyAndResolve(s);
    expect(state.fighters[1].hp).toBe(184);
  });

  it('Gatling acerta 4 vezes e a Força conta em cada golpe', () => {
    let s = newBattle();
    giveHand(s, 0, ['kaioken', 'gatling']);
    s = play(s, 0, 'kaioken');
    s = play(s, 0, 'gatling');
    const { state, events } = readyAndResolve(s);
    expect(events.filter((e) => e.type === 'damage')).toHaveLength(4);
    expect(state.fighters[1].hp).toBe(200 - 4 * 8);
    expect(state.fighters[0].hp).toBe(190); // custo do Kaioken
    expect(state.fighters[0].tempStrength).toBe(0); // Força temporária some
  });

  it('Rasengan aplica Vulnerável e o próximo golpe causa 25% a mais', () => {
    let s = newBattle();
    giveHand(s, 0, ['rasengan']);
    s = play(s, 0, 'rasengan');
    let r = readyAndResolve(s);
    expect(r.state.fighters[1].hp).toBe(182);
    s = r.state;
    giveHand(s, 0, ['golpe_basico']);
    s = play(s, 0, 'golpe_basico');
    r = readyAndResolve(s);
    expect(r.state.fighters[1].hp).toBe(182 - 10);
    expect(r.state.fighters[1].vulnerable).toBe(0);
  });

  it('Fraco reduz o dano em 25%', () => {
    let s = newBattle();
    s.fighters[0].weak = 1;
    giveHand(s, 0, ['getsuga']);
    s = play(s, 0, 'getsuga');
    const { state } = readyAndResolve(s);
    expect(state.fighters[1].hp).toBe(200 - 18);
  });

  it('Getsuga é exaurida', () => {
    let s = newBattle();
    giveHand(s, 0, ['getsuga']);
    s = play(s, 0, 'getsuga');
    const { state } = readyAndResolve(s);
    expect(state.fighters[0].exhausted.map((c) => c.id)).toEqual(['getsuga']);
  });

  it('Kage Bunshin faz a próxima carta acontecer 2 vezes', () => {
    let s = newBattle();
    giveHand(s, 0, ['kage_bunshin', 'pistol']);
    s = play(s, 0, 'kage_bunshin');
    s = play(s, 0, 'pistol');
    expect(s.fighters[0].queue[1].doubled).toBe(true);
    const { state } = readyAndResolve(s);
    expect(state.fighters[1].hp).toBe(200 - 20);
  });

  it('desfazer o clone após reordenar remove a duplicação do ataque', () => {
    let s = newBattle();
    giveHand(s, 0, ['leitura_de_poder', 'kage_bunshin', 'golpe_basico']);
    for (const id of ['leitura_de_poder', 'kage_bunshin', 'golpe_basico']) s = play(s, 0, id);
    const moved = moveToFront(s, 0, s.fighters[0].queue[2].card.uid);
    if (!moved.ok) throw Error(moved.error);
    expect(moved.state.fighters[0].queue[0].doubled).toBe(true);
    const undone = undoLastCard(moved.state, 0);
    if (!undone.ok) throw Error(undone.error);
    expect(undone.state.fighters[0].hand.some(c => c.id === 'kage_bunshin')).toBe(true);
    expect(undone.state.fighters[0].queue[0].doubled).toBe(false);
    expect(viewFor(undone.state, 0).me.queuePreview.damage).toBe(8);
    expect(readyAndResolve(undone.state).state.fighters[1].hp).toBe(192);
  });

  it('Sharingan revela a fila do oponente', () => {
    let s = newBattle();
    giveHand(s, 0, ['sharingan']);
    giveHand(s, 1, ['pistol']);
    s = play(s, 1, 'pistol');
    expect(viewFor(s, 0).opponent.queue).toBeNull();
    s = play(s, 0, 'sharingan');
    expect(viewFor(s, 0).opponent.queue?.map((q) => q.card.id)).toEqual(['pistol']);
    expect(viewFor(s, 1).opponent.queue).toBeNull();
  });
});

describe('golpes carregados', () => {
  it('Kamehameha dispara no turno seguinte', () => {
    let s = newBattle();
    giveHand(s, 0, ['kamehameha']);
    s = play(s, 0, 'kamehameha');
    let r = readyAndResolve(s);
    expect(r.state.fighters[1].hp).toBe(200);
    expect(r.state.fighters[0].charges).toHaveLength(1);
    r = readyAndResolve(r.state);
    expect(r.state.fighters[1].hp).toBe(174);
    expect(r.state.fighters[0].charges).toHaveLength(0);
    expect(r.events.some((e) => e.type === 'chargeFire')).toBe(true);
  });

  it('Genki Dama custa 5 Ki, dispara no quarto turno contando o lançamento, causa 100 e é exaurida', () => {
    let s = newBattle();
    giveHand(s, 0, ['genki_dama', 'kage_bunshin']);
    expect(playCard(s, 0, s.fighters[0].hand[0].uid).ok).toBe(false);
    s.fighters[0].ki = 5;
    s = play(s, 0, 'genki_dama');
    expect(s.fighters[0].ki).toBe(0);
    let r = readyAndResolve(s);
    expect(r.state.fighters[0].exhausted.some(c => c.id === 'genki_dama')).toBe(true);
    for (let i = 0; i < 2; i++) {
      expect(r.state.fighters[1].hp).toBe(200);
      r = readyAndResolve(r.state);
    }
    expect(r.state.fighters[1].hp).toBe(200);
    expect(r.state.fighters[0].charges[0].turnsLeft).toBe(1);
    r = readyAndResolve(r.state);
    expect(r.state.fighters[1].hp).toBe(100);
    expect(r.events.some(e => e.type === 'chargeFire')).toBe(true);
    expect(r.state.fighters[0].charges).toHaveLength(0);
  });

  it('Genki Dama é cancelada com 25+ de dano no turno de uso, antes ou depois da carta', () => {
    for (const starter of [0, 1] as PlayerIndex[]) {
      let s = newBattle();
      s.firstPlayer = starter;
      s.fighters[0].ki = 5;
      giveHand(s, 0, ['genki_dama']);
      giveHand(s, 1, ['golpe_basico', 'getsuga']);
      s = play(s, 0, 'genki_dama');
      s = play(s, 1, 'getsuga');
      s = play(s, 1, 'golpe_basico');
      const r = readyAndResolve(s);
      expect(r.state.fighters[0].hp).toBe(168);
      expect(r.state.fighters[0].charges).toHaveLength(0);
      expect(r.events.some(e => e.type === 'chargeCancel' && e.cardId === 'genki_dama')).toBe(true);
    }
  });

  it('Genki Dama não cancela com 24 de dano no uso nem com 32 em cada rodada seguinte', () => {
    let s = newBattle();
    s.fighters[0].ki = 5;
    giveHand(s, 0, ['genki_dama']);
    giveHand(s, 1, ['getsuga']);
    s = play(s, 0, 'genki_dama');
    s = play(s, 1, 'getsuga');
    let r = readyAndResolve(s);
    expect(r.state.fighters[0].hp).toBe(176);
    expect(r.state.fighters[0].charges).toHaveLength(1);
    for (let i = 0; i < 2; i++) {
      s = r.state;
      giveHand(s, 1, ['getsuga', 'golpe_basico']);
      s = play(s, 1, 'getsuga');
      s = play(s, 1, 'golpe_basico');
      r = readyAndResolve(s);
      expect(r.state.fighters[0].charges).toHaveLength(1);
      expect(r.events.some(e => e.type === 'chargeCancel')).toBe(false);
    }
    r = readyAndResolve(r.state);
    expect(r.state.fighters[1].hp).toBe(100);
    expect(r.state.fighters[0].charges).toHaveLength(0);
  });

  it('Genki Dama ignora Infinity, Kawarimi e Hiraishin sem consumir a esquiva de outro ataque', () => {
    for (const dodge of ['infinity', 'kawarimi', 'hiraishin']) {
      let s = newBattle();
      s.fighters[0].ki = 5;
      giveHand(s, 0, ['genki_dama']);
      s = play(s, 0, 'genki_dama');
      s = readyAndResolve(s).state;
      s = readyAndResolve(s).state;
      s = readyAndResolve(s).state;
      giveHand(s, 0, ['golpe_basico']);
      giveHand(s, 1, [dodge]);
      s = play(s, 0, 'golpe_basico');
      s = play(s, 1, dodge);
      const r = readyAndResolve(s);
      expect(r.state.fighters[1].hp).toBe(100);
      expect(r.events.some(e => e.type === 'evade' && e.cardId === 'genki_dama')).toBe(false);
      expect(r.events.some(e => e.type === 'evade' && e.cardId === 'golpe_basico')).toBe(true);
    }
  });

  it('Genki Dama ainda pode ser bloqueada ou refletida', () => {
    for (const defense of ['defesa_basica', 'boogie_woogie']) {
      let s = newBattle();
      s.fighters[0].ki = 5;
      giveHand(s, 0, ['genki_dama']);
      s = play(s, 0, 'genki_dama');
      for (let i = 0; i < 3; i++) s = readyAndResolve(s).state;
      giveHand(s, 1, [defense]);
      s = play(s, 1, defense);
      const r = readyAndResolve(s);
      expect(r.state.fighters[1].hp).toBe(defense === 'defesa_basica' ? 107 : 200);
      expect(r.state.fighters[0].hp).toBe(defense === 'boogie_woogie' ? 100 : 200);
    }
  });
});

describe('poderes', () => {
  it('Bankai soma +4 por golpe', () => {
    let s = newBattle();
    giveHand(s, 0, ['bankai']);
    s = play(s, 0, 'bankai');
    let r = readyAndResolve(s);
    s = r.state;
    giveHand(s, 0, ['golpe_basico']);
    s = play(s, 0, 'golpe_basico');
    r = readyAndResolve(s);
    expect(r.state.fighters[1].hp).toBe(200 - 12);
  });

  it('Gear Second dura 2 turnos: +1 Ki e perde 8 HP em cada um', () => {
    let s = newBattle();
    giveHand(s, 0, ['gear_second']);
    s = play(s, 0, 'gear_second');
    let r = readyAndResolve(s);
    // 8 HP ao ser jogado + 8 no início do turno seguinte; Ki limitado a 5.
    expect(r.state.fighters[0].ki).toBe(5);
    expect(r.state.fighters[0].hp).toBe(184);
    r = readyAndResolve(r.state);
    expect(r.state.fighters[0].powers).toEqual([]);
    expect(r.state.fighters[0].hp).toBe(184);
  });

  it('Domain Expansion aplica Fraco no oponente a cada turno', () => {
    let s = newBattle();
    giveHand(s, 0, ['domain_expansion']);
    s = play(s, 0, 'domain_expansion');
    const r = readyAndResolve(s);
    expect(r.state.fighters[1].weak).toBeGreaterThanOrEqual(1);
  });
});

describe('fim de jogo', () => {
  it('termina quando o HP chega a 0', () => {
    let s = newBattle();
    s.fighters[1].hp = 5;
    giveHand(s, 0, ['golpe_basico']);
    s = play(s, 0, 'golpe_basico');
    const { state, events } = readyAndResolve(s);
    expect(state.phase).toBe('over');
    expect(state.winner).toBe(0);
    expect(events.at(-1)).toEqual({ type: 'gameOver', winner: 0 });
  });

  it('quem resolve primeiro derruba e as cartas restantes não acontecem', () => {
    let s = newBattle();
    s.fighters[0].hp = 5;
    s.fighters[1].hp = 5;
    giveHand(s, 0, ['golpe_basico']);
    giveHand(s, 1, ['golpe_basico']);
    s = play(s, 0, 'golpe_basico');
    s = play(s, 1, 'golpe_basico');
    const { state, events } = readyAndResolve(s);
    expect(state.winner).toBe(0);
    expect(state.fighters[0].hp).toBe(5);
    expect(events.filter((e) => e.type === 'damage')).toHaveLength(1);
  });

  it('uma partida inteira entre dois bots termina', () => {
    let s = newBattle(123);
    for (let i = 0; i < 100 && s.phase === 'planning'; i++) {
      for (const p of [0, 1] as PlayerIndex[]) {
        for (const c of [...s.fighters[p].hand]) {
          const r = playCard(s, p, c.uid);
          if (r.ok) s = r.state;
        }
      }
      s = readyAndResolve(s).state;
    }
    expect(s.phase).toBe('over');
  });
});

describe('ordem de resolução e moeda', () => {
  it('a moeda é determinística pela seed e quem começa alterna', () => {
    const a = createBattle(99, [{ name: 'A', outfit: FULL }, { name: 'B', outfit: FULL }]);
    const b = createBattle(99, [{ name: 'A', outfit: FULL }, { name: 'B', outfit: FULL }]);
    expect(a.firstPlayer).toBe(b.firstPlayer);
    const seen = new Set([0, 1, 2, 3, 4, 5, 6, 7].map((seed) => createBattle(seed, [{ name: 'A', outfit: FULL }, { name: 'B', outfit: FULL }]).firstPlayer));
    expect(seen.size).toBe(2);
    expect(viewFor(a, 0).turnStarter).toBe(a.firstPlayer);
    const r = readyAndResolve(a);
    expect(viewFor(r.state, 0).turnStarter).toBe(a.firstPlayer === 0 ? 1 : 0);
  });

  it('armadura protege mesmo jogada depois do ataque de quem começa', () => {
    let s = newBattle();
    giveHand(s, 0, ['getsuga']);
    giveHand(s, 1, ['golpe_basico', 'defesa_basica']);
    s = play(s, 0, 'getsuga');
    s = play(s, 1, 'golpe_basico');
    s = play(s, 1, 'defesa_basica');
    const { state } = readyAndResolve(s);
    expect(state.fighters[1].hp).toBe(200 - 17);
  });

  it('as cartas se alternam: o ataque de quem começa vem antes do buff do outro', () => {
    let s = newBattle();
    giveHand(s, 0, ['golpe_basico']);
    giveHand(s, 1, ['kaioken', 'golpe_basico']);
    s = play(s, 0, 'golpe_basico');
    s = play(s, 1, 'kaioken');
    s = play(s, 1, 'golpe_basico');
    const { events } = readyAndResolve(s);
    const order = events.filter((e) => e.type === 'play').map((e) => (e as { cardId: string }).cardId);
    expect(order).toEqual(['golpe_basico', 'kaioken', 'golpe_basico']);
  });

  it('destaca apenas as cartas que chegam a executar antes do nocaute', () => {
    let s = newBattle();
    s.fighters[1].hp = 1;
    for (const player of [0, 1] as const) {
      giveHand(s, player, ['golpe_basico']);
      s = play(s, player, 'golpe_basico');
    }
    const {events} = readyAndResolve(s);
    expect(events.filter(e => e.type === 'play')).toHaveLength(2);
    expect(events.filter(e => e.type === 'cardFocus' || e.type === 'damage')).toMatchObject([
      {type: 'cardFocus', index: 0},
      {type: 'damage', source: 0, target: 1},
      {type: 'cardFocus', index: null},
    ]);
  });

  it('recalcula a prévia privada ao jogar, reordenar e desfazer', () => {
    let s = newBattle();
    giveHand(s, 0, ['leitura_de_poder', 'kaioken', 'golpe_basico', 'defesa_basica']);
    const preview = () => viewFor(s, 0).me.queuePreview;
    expect(preview()).toEqual({damage: 0, block: 0, hpCost: 0});
    for (const id of ['leitura_de_poder', 'kaioken', 'golpe_basico', 'defesa_basica']) s = play(s, 0, id);
    expect(preview()).toEqual({damage: 12, block: 7, hpCost: 10});
    expect(viewFor(s, 0).me.ki).toBe(0);
    const reordered = moveToFront(s, 0, s.fighters[0].queue[2].card.uid);
    if (!reordered.ok) throw Error(reordered.error);
    s = reordered.state;
    expect(preview().damage).toBe(8);
    const undo = undoLastCard(s, 0);
    if (!undo.ok) throw Error(undo.error);
    s = undo.state;
    expect(preview()).toEqual({damage: 8, block: 0, hpCost: 10});
    expect(viewFor(s, 0).me.ki).toBe(1);
    giveHand(s, 1, ['defesa_basica']);
    s = play(s, 1, 'defesa_basica');
    const before = JSON.stringify(s);
    expect(preview().damage).toBe(8);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('Blue antes do Red reforça o Red; Red antes do Blue não', () => {
    let s = newBattle();
    giveHand(s, 0, ['blue', 'red']);
    s.fighters[0].ki = 5;
    s = play(s, 0, 'blue');
    s = play(s, 0, 'red');
    expect(readyAndResolve(s).state.fighters[1].hp).toBe(200 - 25);

    s = newBattle();
    giveHand(s, 0, ['blue', 'red']);
    s.fighters[0].ki = 5;
    s = play(s, 0, 'red');
    s = play(s, 0, 'blue');
    expect(readyAndResolve(s).state.fighters[1].hp).toBe(200 - 20);
  });
});

describe('Ki acumulável', () => {
  it('o Ki que sobra passa para o próximo turno, até 5', () => {
    let s = newBattle();
    let r = readyAndResolve(s);
    expect(r.state.fighters[0].ki).toBe(5);
    s = r.state;
    giveHand(s, 0, ['getsuga']);
    s = play(s, 0, 'getsuga');
    r = readyAndResolve(s);
    expect(r.state.fighters[0].ki).toBe(5); // 3 + 3 = 6 → 5
  });
});

describe('combo Red + Blue → Hollow Purple', () => {
  function comboTurn(order: ['red', 'blue'] | ['blue', 'red'] = ['blue', 'red']) {
    let s = newBattle();
    s.fighters[0].ki = 5;
    giveHand(s, 0, ['blue', 'red', 'golpe_basico', 'shunpo']);
    s = play(s, 0, order[0]);
    s = play(s, 0, order[1]);
    return s;
  }

  it('depois de Red + Blue nenhuma outra carta pode ser jogada; desfazer libera', () => {
    let s = comboTurn();
    expect(viewFor(s, 0).me.comboLock).toBe(true);
    const shunpo = s.fighters[0].hand.find((c) => c.id === 'shunpo')!;
    expect(playCard(s, 0, shunpo.uid).ok).toBe(false);
    const u = undoLastCard(s, 0);
    if (!u.ok) throw new Error(u.error);
    expect(viewFor(u.state, 0).me.comboLock).toBe(false);
    expect(playCard(u.state, 0, shunpo.uid).ok).toBe(true);
  });

  it('funciona em qualquer ordem e cria o Hollow Purple no turno seguinte', () => {
    for (const order of [['blue', 'red'], ['red', 'blue']] as const) {
      const { state, events } = readyAndResolve(comboTurn([...order]));
      expect(events.some((e) => e.type === 'combo' && e.player === 0)).toBe(true);
      const hand = state.fighters[0].hand.map((c) => c.id);
      expect(hand).toContain('hollow_purple');
      expect(hand).toHaveLength(RULES.drawPerTurn + 1);
      expect(state.fighters[0].lockedTo).toBe('hollow_purple');
    }
  });

  it('no turno travado só o Hollow Purple pode ser jogado, de graça, e causa exatamente 50', () => {
    let s = readyAndResolve(comboTurn()).state;
    const other = s.fighters[0].hand.find((c) => c.id !== 'hollow_purple')!;
    expect(playCard(s, 0, other.uid).ok).toBe(false);
    s.fighters[1].block = 0;
    const hp = s.fighters[1].hp;
    giveHand(s, 1, ['haki']);
    s = play(s, 1, 'haki');
    const kiBefore = s.fighters[0].ki;
    s = play(s, 0, 'hollow_purple');
    expect(s.fighters[0].ki).toBe(kiBefore);
    const { state } = readyAndResolve(s);
    // Ignora o Bloqueio do Haki e o Vulnerável do Blue.
    expect(state.fighters[1].hp).toBe(hp - 50);
    expect(state.fighters[0].exhausted.map((c) => c.id)).toContain('hollow_purple');
    // O Ki do turno travado não acumula.
    expect(state.fighters[0].ki).toBe(RULES.kiPerTurn);
    expect(state.fighters[0].lockedTo).toBeNull();
  });

  it('Hollow Purple não jogado some no fim do turno', () => {
    const s = readyAndResolve(comboTurn()).state;
    const { state } = readyAndResolve(s);
    const all = [...state.fighters[0].hand, ...state.fighters[0].drawPile, ...state.fighters[0].discard];
    expect(all.some((c) => c.id === 'hollow_purple')).toBe(false);
    expect(state.fighters[0].exhausted.map((c) => c.id)).toContain('hollow_purple');
  });

  it('Kage Bunshin no meio gera só 1 Hollow Purple', () => {
    let s = newBattle();
    s.fighters[0].ki = 5;
    giveHand(s, 0, ['kage_bunshin', 'blue', 'red']);
    s.fighters[0].ki = 6; // forçado só para caber as 3 cartas no teste
    s = play(s, 0, 'kage_bunshin');
    s = play(s, 0, 'blue');
    s = play(s, 0, 'red');
    const { state } = readyAndResolve(s);
    expect(state.fighters[0].hand.filter((c) => c.id === 'hollow_purple')).toHaveLength(1);
  });

  it('sem combo se a partida acabou no turno', () => {
    let s = comboTurn();
    s.fighters[1].hp = 5;
    const { state, events } = readyAndResolve(s);
    expect(state.phase).toBe('over');
    expect(events.some((e) => e.type === 'combo')).toBe(false);
  });
});

describe('novas habilidades', () => {
  it('Infinity desvia da próxima habilidade inteira (todos os golpes), mesmo jogado depois', () => {
    let s = newBattle();
    giveHand(s, 0, ['gatling', 'golpe_basico']);
    giveHand(s, 1, ['infinity']);
    s.fighters[0].ki = 5;
    s = play(s, 0, 'gatling');
    s = play(s, 0, 'golpe_basico');
    s = play(s, 1, 'infinity');
    const { state, events } = readyAndResolve(s);
    expect(events.some((e) => e.type === 'evade' && e.cardId === 'gatling')).toBe(true);
    expect(state.fighters[1].hp).toBe(200 - 8); // só o Golpe Básico acerta
  });

  it('Infinity desvia do Hollow Purple', () => {
    let s = newBattle();
    s.fighters[0].lockedTo = 'hollow_purple';
    s.fighters[0].hand = [{ uid: 'hp', id: 'hollow_purple' }];
    giveHand(s, 1, ['infinity']);
    s = play(s, 0, 'hollow_purple');
    s = play(s, 1, 'infinity');
    expect(readyAndResolve(s).state.fighters[1].hp).toBe(200);
  });

  it('Boogie Woogie devolve a próxima habilidade no atacante', () => {
    let s = newBattle();
    giveHand(s, 0, ['getsuga']);
    giveHand(s, 1, ['boogie_woogie']);
    s = play(s, 0, 'getsuga');
    s = play(s, 1, 'boogie_woogie');
    const { state, events } = readyAndResolve(s);
    expect(events.some((e) => e.type === 'reflect')).toBe(true);
    expect(state.fighters[1].hp).toBe(200);
    expect(state.fighters[0].hp).toBe(200 - 24);
  });

  it('Boogie Woogie também devolve golpe carregado', () => {
    let s = newBattle();
    giveHand(s, 0, ['kamehameha']);
    s = play(s, 0, 'kamehameha');
    s = readyAndResolve(s).state;
    giveHand(s, 1, ['boogie_woogie']);
    s = play(s, 1, 'boogie_woogie');
    const { state } = readyAndResolve(s);
    expect(state.fighters[0].hp).toBe(200 - 26);
    expect(state.fighters[1].hp).toBe(200);
  });

  it('Técnica Reversa cura 24 sem passar do máximo e é exaurida', () => {
    let s = newBattle();
    s.fighters[0].hp = 165;
    giveHand(s, 0, ['tecnica_reversa']);
    s = play(s, 0, 'tecnica_reversa');
    let r = readyAndResolve(s);
    expect(r.state.fighters[0].hp).toBe(189);
    expect(r.state.fighters[0].exhausted.map((c) => c.id)).toContain('tecnica_reversa');
    s = newBattle();
    s.fighters[0].hp = 196;
    giveHand(s, 0, ['tecnica_reversa']);
    s = play(s, 0, 'tecnica_reversa');
    r = readyAndResolve(s);
    expect(r.state.fighters[0].hp).toBe(200);
  });

  it('Black Flash causa 28 como primeira carta e 12 depois', () => {
    let s = newBattle();
    giveHand(s, 0, ['black_flash']);
    s = play(s, 0, 'black_flash');
    expect(readyAndResolve(s).state.fighters[1].hp).toBe(172);
    s = newBattle();
    giveHand(s, 0, ['shunpo', 'black_flash']);
    s = play(s, 0, 'shunpo');
    s = play(s, 0, 'black_flash');
    expect(readyAndResolve(s).state.fighters[1].hp).toBe(188);
  });

  it('Ki Blast custa 1 e causa 4 duas vezes', () => {
    let s = newBattle();
    giveHand(s, 0, ['ki_blast']);
    s = play(s, 0, 'ki_blast');
    expect(s.fighters[0].ki).toBe(2);
    expect(readyAndResolve(s).state.fighters[1].hp).toBe(192);
  });

  it('Haki do Rei atordoa 1 turno e reduz o Ki máximo do oponente em 2 por 2 turnos', () => {
    let s = newBattle();
    s.fighters[1].ki = 5;
    giveHand(s, 0, ['haki_do_rei']);
    s = play(s, 0, 'haki_do_rei');
    let r = readyAndResolve(s);
    s = r.state;
    // Turno 2: atordoado e com Ki máximo 3.
    expect(s.fighters[1].stunnedNow).toBe(true);
    expect(viewFor(s, 1).me.maxKi).toBe(3);
    expect(s.fighters[1].ki).toBe(3);
    expect(playCard(s, 1, s.fighters[1].hand[0].uid)).toEqual({ ok: false, error: 'Você está atordoado neste turno.' });
    s = readyAndResolve(s).state;
    // Turno 3: já pode jogar, mas o Ki máximo ainda é 3.
    expect(s.fighters[1].stunnedNow).toBe(false);
    expect(viewFor(s, 1).me.maxKi).toBe(3);
    s = readyAndResolve(s).state;
    // Turno 4: volta ao normal.
    expect(viewFor(s, 1).me.maxKi).toBe(5);
  });
});

describe('Máscara Hollow', () => {
  it('Cero carrega 1 turno e causa 24', () => {
    let s = newBattle();
    giveHand(s, 0, ['cero']);
    s = play(s, 0, 'cero');
    let r = readyAndResolve(s);
    expect(r.state.fighters[1].hp).toBe(200);
    r = readyAndResolve(r.state);
    expect(r.state.fighters[1].hp).toBe(176);
  });

  it('Hollowficação dura 2 turnos: +4 de Força e perde 10 HP em cada um', () => {
    let s = newBattle();
    giveHand(s, 0, ['hollowficacao', 'golpe_basico']);
    s.fighters[0].ki = 3;
    s = play(s, 0, 'hollowficacao');
    s = play(s, 0, 'golpe_basico');
    let r = readyAndResolve(s);
    // O poder vale já no turno em que é jogado: 8 + 4.
    expect(r.state.fighters[1].hp).toBe(200 - 12);
    expect(r.state.fighters[0].hp).toBe(180);
    s = r.state;
    giveHand(s, 0, ['golpe_basico']);
    s = play(s, 0, 'golpe_basico');
    r = readyAndResolve(s);
    expect(r.state.fighters[1].hp).toBe(200 - 12 - 12);
    // Acabou: não perde mais HP e a Força extra some.
    expect(r.state.fighters[0].powers).toEqual([]);
    expect(r.state.fighters[0].hp).toBe(180);
    s = r.state;
    giveHand(s, 0, ['golpe_basico']);
    s = play(s, 0, 'golpe_basico');
    r = readyAndResolve(s);
    expect(r.state.fighters[1].hp).toBe(200 - 12 - 12 - 8);
  });

  it('Bankai e Gear Second duram 2 turnos', () => {
    let s = newBattle();
    giveHand(s, 0, ['bankai']);
    s.fighters[0].ki = 5;
    giveHand(s, 1, ['gear_second']);
    s = play(s, 0, 'bankai');
    s = play(s, 1, 'gear_second');
    const powers = (st: typeof s) => [st.fighters[0].powers.length, st.fighters[1].powers.length];
    let r = readyAndResolve(s);
    expect(powers(r.state)).toEqual([1, 1]);
    r = readyAndResolve(r.state);
    expect(powers(r.state)).toEqual([0, 0]);
    // Exaustão do Bankai: Fraco quando acaba.
    expect(r.state.fighters[0].weak).toBeGreaterThanOrEqual(1);
  });

  it('Sonído dá 5 de Bloqueio e +4 só no próximo ataque, em todos os golpes dele', () => {
    let s = newBattle();
    giveHand(s, 0, ['sonido', 'ki_blast', 'golpe_basico']);
    s = play(s, 0, 'sonido');
    s = play(s, 0, 'ki_blast');
    s = play(s, 0, 'golpe_basico');
    giveHand(s, 1, ['golpe_basico']);
    s = play(s, 1, 'golpe_basico');
    const { state } = readyAndResolve(s);
    // Ki Blast: (4+4)×2 = 16; Golpe Básico: 8 sem bônus.
    expect(state.fighters[1].hp).toBe(200 - 16 - 8);
    // Bloqueio de 5 absorve parte do golpe de 8.
    expect(state.fighters[0].hp).toBe(197);
  });
});

describe('prévia de dano na carta', () => {
  it('soma Força, Vulnerável do oponente e cartas já na fila', () => {
    let s = newBattle();
    s.fighters[0].strength = 2;
    giveHand(s, 0, ['kaioken', 'golpe_basico', 'chidori']);
    expect(previewCardDamage(viewFor(s, 0), 'golpe_basico')).toEqual({ base: 8, value: 10 });
    s = play(s, 0, 'kaioken');
    expect(previewCardDamage(viewFor(s, 0), 'golpe_basico')).toEqual({ base: 8, value: 14 });
    s.fighters[1].vulnerable = 1;
    expect(previewCardDamage(viewFor(s, 0), 'golpe_basico')).toEqual({ base: 8, value: 17 });
  });

  it('Fraco reduz; golpe carregado e dano fixo não têm prévia', () => {
    const s = newBattle();
    s.fighters[0].weak = 1;
    expect(previewCardDamage(viewFor(s, 0), 'golpe_basico')).toEqual({ base: 8, value: 6 });
    expect(previewCardDamage(viewFor(s, 0), 'kamehameha')).toBeNull();
    expect(previewCardDamage(viewFor(s, 0), 'hollow_purple')).toBeNull();
    expect(previewCardDamage(viewFor(s, 0), 'defesa_basica')).toBeNull();
  });

  it('Black Flash mostra 28 como primeira carta; Sonído vai para o primeiro ataque', () => {
    let s = newBattle();
    giveHand(s, 0, ['black_flash', 'sonido', 'ki_blast', 'golpe_basico']);
    expect(previewCardDamage(viewFor(s, 0), 'black_flash')).toEqual({ base: 28, value: 28 });
    s = play(s, 0, 'sonido');
    expect(previewCardDamage(viewFor(s, 0), 'ki_blast')).toEqual({ base: 4, value: 8 });
    s = play(s, 0, 'ki_blast');
    expect(previewCardDamage(viewFor(s, 0), 'golpe_basico')).toEqual({ base: 8, value: 8 });
  });
});

describe('Scouter', () => {
  it('Leitura de Poder revela o oponente e permite pôr uma carta na frente', () => {
    let s = newBattle();
    s.fighters[0].ki = 5;
    giveHand(s, 0, ['golpe_basico', 'black_flash', 'leitura_de_poder']);
    giveHand(s, 1, ['pistol']);
    s = play(s, 1, 'pistol');
    s = play(s, 0, 'golpe_basico');
    s = play(s, 0, 'black_flash');
    const bf = s.fighters[0].queue[1].card.uid;
    expect(moveToFront(s, 0, bf).ok).toBe(false); // ainda sem Leitura de Poder
    s = play(s, 0, 'leitura_de_poder');
    expect(viewFor(s, 0).opponent.queue?.map((q) => q.card.id)).toEqual(['pistol']);
    expect(viewFor(s, 0).me.canReorder).toBe(true);
    const r = moveToFront(s, 0, bf);
    if (!r.ok) throw new Error(r.error);
    expect(r.state.fighters[0].queue.map((q) => q.card.id)).toEqual(['black_flash', 'golpe_basico', 'leitura_de_poder']);
    // Black Flash agora é a primeira carta: 28 + Golpe Básico 8.
    expect(readyAndResolve(r.state).state.fighters[1].hp).toBe(200 - 36);
  });

});

describe('Kunai e Saquê', () => {
  it('Kunai custa 0 e causa 6; Saquê cura 14 e é exaurido', () => {
    let s = newBattle();
    s.fighters[0].hp = 50;
    giveHand(s, 0, ['kunai', 'sake']);
    s = play(s, 0, 'kunai');
    expect(s.fighters[0].ki).toBe(3);
    s = play(s, 0, 'sake');
    const { state } = readyAndResolve(s);
    expect(state.fighters[1].hp).toBe(194);
    expect(state.fighters[0].hp).toBe(64);
    expect(state.fighters[0].exhausted.map((c) => c.id)).toContain('sake');
  });
});

describe('Modo Sábio', () => {
  it('dá +2 de Força e +1 carta nos 2 turnos seguintes e depois acaba', () => {
    let s = newBattle();
    giveHand(s, 0, ['modo_sabio']);
    s = play(s, 0, 'modo_sabio');
    s = readyAndResolve(s).state;
    // Turno 2
    expect(s.fighters[0].tempStrength).toBe(2);
    expect(s.fighters[0].hand).toHaveLength(RULES.drawPerTurn + 1);
    giveHand(s, 0, ['golpe_basico']);
    s = play(s, 0, 'golpe_basico');
    s = readyAndResolve(s).state;
    expect(s.fighters[1].hp).toBe(200 - 10);
    // Turno 3: ainda ativo
    expect(s.fighters[0].tempStrength).toBe(2);
    s = readyAndResolve(s).state;
    // Turno 4: acabou
    expect(s.fighters[0].tempStrength).toBe(0);
    expect(s.fighters[0].hand).toHaveLength(RULES.drawPerTurn);
  });
});

describe('Galick Gun → Big Bang Attack', () => {
  it('Galick Gun sem 5 de Ki é um ataque normal (2 Ki, 16 de dano)', () => {
    let s = newBattle();
    giveHand(s, 0, ['galick_gun']);
    s = play(s, 0, 'galick_gun');
    expect(s.fighters[0].ki).toBe(1);
    const r = readyAndResolve(s);
    expect(r.state.fighters[1].hp).toBe(184);
    expect(r.state.fighters[0].hand.some((c) => c.id === 'big_bang_attack')).toBe(false);
    expect(r.state.fighters[0].discard.some((c) => c.id === 'galick_gun')).toBe(true);
  });

  it('o custo exibido na mão coincide com o débito normal e o carregado', () => {
    for (const [ki, expected] of [[4, 2], [5, 5]]) {
      const s = newBattle();
      s.fighters[0].ki = ki;
      giveHand(s, 0, ['galick_gun']);
      expect(currentCardCost(viewFor(s, 0).me, 'galick_gun')).toBe(expected);
      expect(play(s, 0, 'galick_gun').fighters[0].ki).toBe(ki - expected);
    }
  });

  it('desfazer o Galick Gun carregado devolve os 5 de Ki', () => {
    let s = newBattle();
    s.fighters[0].ki = 5;
    giveHand(s, 0, ['galick_gun']);
    s = play(s, 0, 'galick_gun');
    expect(s.fighters[0].ki).toBe(0);
    const u = undoLastCard(s, 0);
    if (!u.ok) throw new Error(u.error);
    expect(u.state.fighters[0].ki).toBe(5);
  });

  it('Galick Gun com 5 de Ki causa dano, gasta tudo e evolui para Big Bang Attack no próximo turno, que fica na mão até ser usado', () => {
    let s = newBattle();
    s.fighters[0].ki = 5;
    giveHand(s, 0, ['galick_gun']);
    s = play(s, 0, 'galick_gun');
    expect(s.fighters[0].ki).toBe(0);
    let r = readyAndResolve(s);
    expect(r.state.fighters[1].hp).toBe(184); // causa os 16 e evolui
    expect(r.events.some((e) => e.type === 'evolve')).toBe(true)
    s = r.state;
    const bba = () => s.fighters[0].hand.filter((c) => c.id === 'big_bang_attack');
    expect(bba()).toHaveLength(1);
    // Turno 2: com 3 de Ki não dá para usar; ele fica na mão para o turno 3.
    s = readyAndResolve(s).state;
    expect(bba()).toHaveLength(1);
    expect(s.fighters[0].ki).toBe(5);
    // Turno 3: usa com 5 de Ki → 50 de dano ignorando Bloqueio.
    giveHand(s, 1, ['defesa_basica']);
    s = play(s, 1, 'defesa_basica');
    s = play(s, 0, 'big_bang_attack');
    r = readyAndResolve(s);
    expect(r.state.fighters[1].hp).toBe(134);
    // Some, e o Galick Gun volta ao baralho de compra.
    const f = r.state.fighters[0];
    expect([...f.hand, ...f.drawPile, ...f.discard].some((c) => c.id === 'big_bang_attack')).toBe(false);
    expect(f.drawPile.some((c) => c.id === 'galick_gun') || f.hand.some((c) => c.id === 'galick_gun')).toBe(true);
  });
});

describe('travar carta', () => {
  it('a carta travada fica na mão no próximo turno; só uma por turno', () => {
    let s = newBattle();
    giveHand(s, 0, ['red', 'pistol', 'golpe_basico']);
    const red = s.fighters[0].hand[0].uid;
    const pistol = s.fighters[0].hand[1].uid;
    let r = toggleKeep(s, 0, red);
    if (!r.ok) throw new Error(r.error);
    // Travar outra troca a trava (continua uma só).
    r = toggleKeep(r.state, 0, pistol);
    if (!r.ok) throw new Error(r.error);
    expect(r.state.fighters[0].keepUid).toBe(pistol);
    r = toggleKeep(r.state, 0, red);
    if (!r.ok) throw new Error(r.error);
    s = readyAndResolve(r.state).state;
    expect(s.fighters[0].hand.some((c) => c.uid === red)).toBe(true);
    expect(s.fighters[0].hand.some((c) => c.uid === pistol)).toBe(false);
    expect(s.fighters[0].hand).toHaveLength(RULES.drawPerTurn + 1);
  });

  it('a mesma carta não pode ser travada dois turnos seguidos', () => {
    let s = newBattle();
    giveHand(s, 0, ['red']);
    const red = s.fighters[0].hand[0].uid;
    const r = toggleKeep(s, 0, red);
    if (!r.ok) throw new Error(r.error);
    s = readyAndResolve(r.state).state;
    expect(toggleKeep(s, 0, red)).toEqual({ ok: false, error: 'Essa carta já ficou travada no turno passado.' });
    s = readyAndResolve(s).state;
    // Depois de um turno sem trava, a carta (se estiver na mão) pode ser travada de novo.
    giveHand(s, 0, ['red']);
    expect(toggleKeep(s, 0, s.fighters[0].hand[0].uid).ok).toBe(true);
  });

  it('jogar a carta travada tira a trava; carta etérea não pode ser travada', () => {
    let s = newBattle();
    giveHand(s, 0, ['pistol']);
    const r = toggleKeep(s, 0, s.fighters[0].hand[0].uid);
    if (!r.ok) throw new Error(r.error);
    s = play(r.state, 0, 'pistol');
    expect(s.fighters[0].keepUid).toBeNull();
    s = newBattle();
    s.fighters[0].hand = [{ uid: 'hp', id: 'hollow_purple' }];
    expect(toggleKeep(s, 0, 'hp').ok).toBe(false);
  });
});

 describe('limite de duração PvP', () => {
  it('encerra na 24ª rodada com vitória por HP, sem abrir outra rodada', () => {
    let s = newBattle();
    s.turn = RULES.turnLimit;
    s.fighters[0].hp = 150;
    s.fighters[1].hp = 140;
    const r = readyAndResolve(s);
    expect(r.state.turn).toBe(24);
    expect(r.state.phase).toBe('over');
    expect(r.state.winner).toBe(0);
  });
  it('empata quando os HPs são iguais ao final do limite', () => {
    const s = newBattle();
    s.turn = RULES.turnLimit;
    const r = readyAndResolve(s);
    expect(r.state.turn).toBe(24);
    expect(r.state.winner).toBe('draw');
  });
});
