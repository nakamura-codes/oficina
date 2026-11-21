export type PlayerIndex = 0 | 1;

export type CardType = 'attack' | 'skill' | 'power';
export type Rarity = 'common' | 'rare' | 'power';

export type PowerId = 'bankai' | 'gearSecond' | 'domain' | 'hollow';

/** Efeitos que uma carta pode ter. Os números ficam nos dados (cards.ts). */
export type Effect =
  | { kind: 'damage'; amount: number; times?: number; pierce?: boolean; fixed?: boolean; firstCardAmount?: number; bonusVsBlock?: number; doubleBelowHp?: number }
  | { kind: 'block'; amount: number }
  | { kind: 'strength'; amount: number; temporary?: boolean }
  | { kind: 'weak'; amount: number }
  | { kind: 'vulnerable'; amount: number }
  | { kind: 'loseHp'; amount: number }
  | { kind: 'drawNext'; amount: number }
  | { kind: 'reveal' }
  | { kind: 'clone' }
  | { kind: 'charge'; turns: number; damage: number; cancelOnDamage?: number; cancelOnlyOnStart?: boolean; cannotEvade?: boolean }
  /** Poder com duração: fica ativo no turno em que é jogado e em mais `turns - 1` turnos. */
  | { kind: 'power'; power: PowerId; turns: number }
  /** Desvia da próxima habilidade de dano do oponente neste turno. */
  | { kind: 'evade' }
  /** A próxima habilidade de dano do oponente neste turno volta nele. */
  | { kind: 'reflect' }
  /** Permite mudar a ordem da própria jogada (escolher qual carta resolve primeiro). */
  | { kind: 'reorder' }
  /** No próximo turno, esta carta vira outra na sua mão (ex.: Galick Gun → Big Bang Attack). */
  | { kind: 'evolve'; into: string }
  /** Depois de usada, coloca esta carta de volta no baralho de compra. */
  | { kind: 'returnCard'; cardId: string }
  /** Por alguns turnos: +Força e +cartas compradas no início de cada turno. */
  | { kind: 'sage'; turns: number; strength: number; draw: number }
  /** O próximo ataque deste turno causa +amount (por golpe). */
  | { kind: 'nextAttackBonus'; amount: number }
  | { kind: 'heal'; amount: number }
  /** Oponente não joga cartas no próximo turno e tem Ki máximo reduzido por alguns turnos. */
  | { kind: 'stun'; turns: number; kiPenalty: number; kiPenaltyTurns: number };

export interface CardDef {
  id: string;
  name: string;
  cost: number;
  type: CardType;
  rarity: Rarity;
  text: string;
  effects: Effect[];
  /** Sai do baralho depois de usada. Poderes sempre saem. */
  exhaust?: boolean;
  /** Criada durante a partida (ex.: por combo); não entra em baralho nem roupa. */
  token?: boolean;
  /** Se ainda estiver na mão no fim do turno, some. */
  ethereal?: boolean;
  /** Fica na mão de um turno para o outro, até ser usada. */
  retain?: boolean;
  /** Se jogada com pelo menos `atKi` de Ki: gasta esse Ki, causa o efeito normal e evolui para `into` (chega na mão no próximo turno). */
  evolve?: { atKi: number; into: string };
}

export interface ComboDef {
  requires: string[];
  creates: string;
}

export interface CardInstance {
  uid: string;
  id: string;
}

export type OutfitSlot = 'head' | 'body' | 'hand';

export interface OutfitItem {
  id: string;
  slot: OutfitSlot;
  name: string;
  cards: string[];
}

/** Peça vestida em cada espaço; null = vazio (boneco cinza). */
export type Outfit = Record<OutfitSlot, string | null>;

export interface Charge {
  uid: string;
  cardId: string;
  turnsLeft: number;
  damage: number;
  cancelOnDamage?: number;
  /** Se verdadeiro, o limiar de cancelamento vale só na rodada de lançamento. */
  cancelOnlyOnStart?: boolean;
  /** Ignora esquiva sem consumir a proteção; reflexão e bloqueio continuam válidos. */
  cannotEvade?: boolean;
}

export interface QueuedCard {
  /** Ordem de escolha, preservada quando o Scouter muda a ordem de execução. */
  playOrder?: number;
  card: CardInstance;
  doubled: boolean;
  /** Ki pago (para desfazer devolver o valor certo). */
  paid?: number;
  /** Jogada com Ki cheio: usa a versão evoluída da carta (ex.: Galick Gun). */
  powered?: boolean;
}

export interface Fighter {
  name: string;
  outfit: Outfit;
  hp: number;
  maxHp: number;
  block: number;
  ki: number;
  strength: number;
  tempStrength: number;
  weak: number;
  vulnerable: number;
  powers: PowerId[];
  /** Turnos restantes de cada poder (mesma posição de `powers`), contando o atual. */
  powerTurns: number[];
  charges: Charge[];
  drawPile: CardInstance[];
  hand: CardInstance[];
  discard: CardInstance[];
  exhausted: CardInstance[];
  queue: QueuedCard[];
  ready: boolean;
  revealing: boolean;
  cloneNext: boolean;
  bonusDraw: number;
  damageTakenThisTurn: number;
  /** Fraco/Vulnerável aplicados neste turno só começam a diminuir no fim do turno seguinte. */
  decayWeak: boolean;
  decayVulnerable: boolean;
  /** Combo feito neste turno: a carta criada chega no próximo. */
  pendingCombo: string | null;
  /** Turno travado: só pode jogar esta carta (de graça). */
  lockedTo: string | null;
  /** Infinity: desvios disponíveis neste turno. */
  evade: number;
  /** Boogie Woogie: devoluções disponíveis neste turno. */
  reflect: number;
  /** Turnos de atordoamento ainda por vir (começam no próximo turno). */
  stunned: number;
  /** Atordoado neste turno: não pode jogar cartas. */
  stunnedNow: boolean;
  /** Redução do Ki máximo e por quantos turnos ainda vale. */
  kiPenalty: number;
  kiPenaltyTurns: number;
  /** Ki máximo neste turno (5, ou menos com a penalidade do Haki do Rei). */
  kiCap: number;
  /** Sonído: bônus para o próximo ataque deste turno. */
  nextAttackBonus: number;
  /** Modo Sábio: turnos restantes e o bônus por turno. */
  sageTurns: number;
  sageStrength: number;
  sageDraw: number;
  /** Cartas que chegam na mão no próximo turno (evolução). */
  pendingCards: string[];
  /** Carta travada neste turno: não é descartada no fim do turno (uma por turno). */
  keepUid: string | null;
  /** Carta que ficou travada no turno anterior: não pode ser travada de novo agora. */
  lastKeptUid: string | null;
}

export interface BattleState {
  seed: number;
  rngState: number;
  turn: number;
  phase: 'planning' | 'over';
  fighters: [Fighter, Fighter];
  winner: PlayerIndex | 'draw' | null;
  uidCounter: number;
  /** Quem a moeda escolheu para começar o turno 1. Depois alterna. */
  firstPlayer: PlayerIndex;
  /** Índice da arena sorteada (shared/src/arenas.ts). */
  arena: number;
}

export type BattleEvent =
  | { type: 'cardFocus'; index: number | null }
  | { type: 'play'; player: PlayerIndex; cardId: string; doubled: boolean }
  | { type: 'damage'; source: PlayerIndex; target: PlayerIndex; cardId: string; amount: number; blocked: number }
  | { type: 'block'; player: PlayerIndex; amount: number }
  | { type: 'status'; player: PlayerIndex; status: 'strength' | 'weak' | 'vulnerable'; amount: number; cardId?: string }
  | { type: 'hpLoss'; player: PlayerIndex; amount: number; reason: string }
  | { type: 'power'; player: PlayerIndex; power: PowerId }
  | { type: 'powerEnd'; player: PlayerIndex; power: PowerId }
  | { type: 'chargeStart'; player: PlayerIndex; cardId: string; turns: number }
  | { type: 'chargeFire'; player: PlayerIndex; cardId: string }
  | { type: 'chargeCancel'; player: PlayerIndex; cardId: string }
  | { type: 'combo'; player: PlayerIndex; cardId: string }
  | { type: 'evolve'; player: PlayerIndex; from: string; into: string }
  | { type: 'evade'; player: PlayerIndex; cardId: string }
  | { type: 'reflect'; player: PlayerIndex; cardId: string }
  | { type: 'heal'; player: PlayerIndex; amount: number }
  | { type: 'stun'; player: PlayerIndex; turns: number; kiPenalty: number }
  | { type: 'gameOver'; winner: PlayerIndex | 'draw' };

/** O que cada jogador pode ver (sem as cartas escondidas do oponente). */
export interface FighterPublicView {
  name: string;
  outfit: Outfit;
  hp: number;
  maxHp: number;
  block: number;
  ki: number;
  strength: number;
  tempStrength: number;
  weak: number;
  vulnerable: number;
  powers: PowerId[];
  /** Turnos restantes de cada poder (mesma posição de `powers`), contando o atual. */
  powerTurns: number[];
  charges: Charge[];
  handCount: number;
  drawCount: number;
  discardCount: number;
  queueCount: number;
  ready: boolean;
  maxKi: number;
  lockedTo: string | null;
  stunned: boolean;
  sageTurns: number;
  evade: number;
  reflect: number;
}

export interface BattleView {
  you: PlayerIndex;
  turn: number;
  phase: BattleState['phase'];
  winner: BattleState['winner'];
  firstPlayer: PlayerIndex;
  arena: string;
  /** Quem resolve primeiro neste turno. */
  turnStarter: PlayerIndex;
  me: FighterPublicView & {
    queuePreview: { damage: number; block: number; hpCost: number };
    hand: CardInstance[];
    queue: QueuedCard[];
    cloneNext: boolean;
    revealing: boolean;
    /** Red + Blue já na fila: nenhuma outra carta neste turno. */
    comboLock: boolean;
    /** Leitura de Poder na fila: pode escolher qual carta resolve primeiro. */
    canReorder: boolean;
    keepUid: string | null;
    lastKeptUid: string | null;
  };
  opponent: FighterPublicView & { queue: QueuedCard[] | null };
}

/** Nível do bot de treino. */
export type BotLevel = 'iniciante' | 'competitivo' | 'deus';
