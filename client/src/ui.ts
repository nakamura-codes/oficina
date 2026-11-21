import Phaser from 'phaser';
import { figureKey, getCard, getItem, type CardDef, type Outfit } from '@oficina/shared';
import { FRAME_LAYOUT, FRAME_SIZE } from './cardFrames.generated.ts';
import { sfx } from './sfx.ts';
import { RENDER_SCALE, VIEW_H, VIEW_W, viewportBounds } from './render.ts';
import { FX } from './fx.generated.ts';

export const FONT = '"GameFont", monospace';
/** Fonte só para números (custo, dano, HP, Ki): mais nítida em tamanho pequeno. */
export const NUM_FONT = '"GameNum", "GameFont", monospace';

export const COLORS = {
  bg: 0x16121f,
  panel: 0x231c33,
  panelLight: 0x30264a,
  outline: 0x0d0a14,
  text: '#f4ecd8',
  textDim: '#a89cc0',
  gold: 0xf0a830,
  goldLight: 0xffe28a,
  ki: 0x2f8fe0,
  hp: 0xd8414a,
  block: 0x4aa8e8,
  attack: 0x8e2b33,
  skill: 0x2b7a52,
  power: 0x6a34a8,
};

export const TYPE_COLOR: Record<CardDef['type'], number> = {
  attack: COLORS.attack,
  skill: COLORS.skill,
  power: COLORS.power,
};

export const TYPE_LABEL: Record<CardDef['type'], string> = {
  attack: 'Ataque',
  skill: 'Técnica',
  power: 'Poder',
};

/**
 * Tamanhos de texto pedidos em pixels de uma tela 1920×1080 (o layout de 1280×720 aparece 1,5× maior).
 * Nomes de itens: Pixelify Sans SemiBold 20 px.
 */
const SCREEN_PX = 1080 / 720;
export const ITEM_NAME = { size: 20 / SCREEN_PX, style: { fontStyle: '600' } } as const;
// O texto de regras usa uma fonte de leitura, independente da pixel art.
function description(scene: Phaser.Scene, x: number, y: number, value: string, width: number, height: number) {
  const body = txt(scene, x, y, value, 15, '#201a22', {
    fontFamily: 'Arial, sans-serif', color: '#201a22', wordWrap: { width }, align: 'left', lineSpacing: 0,
  });
  for (const size of [14, 13]) {
    if (body.height <= height) break;
    body.setFontSize(size);
  }
  if (body.height > height) {
    const lines = body.getWrappedText(value);
    while (body.height > height && lines.length > 1) {
      lines.pop();
      body.setText(lines.join('\n').replace(/[.,;:]?$/, '…'));
    }
  }
  return body;
}

let reader: { owner: Phaser.GameObjects.Container; dispose: () => void } | null = null;

export function hideCardReading(owner: Phaser.GameObjects.Container) {
  if (reader?.owner === owner) reader.dispose();
}

/** Texto integral em pixels de tela, mesmo quando as cartas da mão ficam muito pequenas. */
export function showCardReading(owner: Phaser.GameObjects.Container, id: string, cost?: number) {
  if (reader?.owner === owner) return;
  reader?.dispose();
  const def = getCard(id);
  const node = document.createElement('aside');
  node.className = 'card-reading';
  node.setAttribute('role', 'tooltip');
  const title = document.createElement('strong');
  title.textContent = cost === undefined ? def.name : def.name + ' · ' + cost + ' Ki';
  if (cost !== undefined) node.classList.add('hand-reading');
  const rules = document.createElement('div');
  rules.textContent = def.text;
  node.append(title, rules);
  const pointer = owner.scene.input.activePointer;
  const canvas = owner.scene.game.canvas;
  const rect = canvas.getBoundingClientRect();
  const y = rect.top + pointer.y / owner.scene.scale.gameSize.height * rect.height;
  node.style[y < window.innerHeight / 2 ? 'bottom' : 'top'] = '12px';
  document.body.append(node);
  const dismissTouch = (e: PointerEvent) => { if (e.pointerType === 'touch') dispose(); };
  document.addEventListener('pointerdown', dismissTouch, true);
  const dispose = () => {
    document.removeEventListener('pointerdown', dismissTouch, true);
    owner.off('destroy', dispose);
    node.remove();
    reader = null;
  };
  owner.once('destroy', dispose);
  reader = {owner, dispose};
}

export function txt(
  scene: Phaser.Scene,
  x: number,
  y: number,
  s: string,
  size = 16,
  color = COLORS.text,
  style: Phaser.Types.GameObjects.Text.TextStyle = {},
) {
  return scene.add
    // resolution 2: o texto é desenhado com o dobro de pixels, para ficar nítido (o jogo roda em 2x).
    .text(x, y, s, { fontFamily: FONT, fontSize: `${size}px`, color, resolution: Math.max(2, Math.ceil(RENDER_SCALE)), ...style })
    .setOrigin(0.5);
}

/**
 * Centraliza o texto pelo desenho dos caracteres (os pixels pintados), não pela caixa da fonte.
 * A Jersey 10 tem bastante espaço sobrando em cima e embaixo, o que deixa números fora do centro.
 * O texto precisa ter origem 0.5.
 */
export function centerInk(t: Phaser.GameObjects.Text, x: number, y: number) {
  t.setPosition(x, y);
  const cnv = t.canvas;
  if (!cnv || !cnv.width || !cnv.height) return t;
  const data = t.context.getImageData(0, 0, cnv.width, cnv.height).data;
  let x0 = cnv.width, y0 = cnv.height, x1 = -1, y1 = -1;
  for (let yy = 0; yy < cnv.height; yy++)
    for (let xx = 0; xx < cnv.width; xx++)
      if (data[(yy * cnv.width + xx) * 4 + 3] > 60) {
        if (xx < x0) x0 = xx;
        if (xx > x1) x1 = xx;
        if (yy < y0) y0 = yy;
        if (yy > y1) y1 = yy;
      }
  if (x1 < 0) return t;
  const res = t.style.resolution || 1;
  const dx = ((x0 + x1 + 1) / 2 - cnv.width / 2) / res;
  const dy = ((y0 + y1 + 1) / 2 - cnv.height / 2) / res;
  return t.setPosition(x - dx * t.scaleX, y - dy * t.scaleY);
}

/** Texto que diminui até caber na largura. */
export function fitText(t: Phaser.GameObjects.Text, maxWidth: number) {
  let size = parseFloat(String(t.style.fontSize));
  while (t.width > maxWidth && size > 8) {
    size -= 0.5;
    t.setFontSize(size);
  }
  return t;
}

export interface Button extends Phaser.GameObjects.Container {
  setEnabled(v: boolean): Button;
  setLabel(s: string): Button;
}

export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  onClick: () => void,
  color = COLORS.gold,
  size = 20,
): Button {
  const c = scene.add.container(x, y) as Button;
  const g = scene.add.graphics();
  const t = txt(scene, 0, -1, label, size, '#1a1420', { fontStyle: 'bold' });
  let enabled = true;
  let hover = false;
  const draw = () => {
    g.clear();
    const base = enabled ? color : 0x5a5168;
    g.fillStyle(COLORS.outline).fillRoundedRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6, 8);
    g.fillStyle(Phaser.Display.Color.ValueToColor(base).darken(30).color).fillRoundedRect(-w / 2, -h / 2 + 4, w, h - 4, 6);
    g.fillStyle(hover && enabled ? Phaser.Display.Color.ValueToColor(base).lighten(12).color : base).fillRoundedRect(-w / 2, -h / 2, w, h - 5, 6);
    t.setColor(enabled ? '#1a1420' : '#2e2838');
  };
  c.add([g, t]);
  c.setSize(w, h);
  c.setInteractive({ useHandCursor: true });
  c.on('pointerover', () => ((hover = true), draw()));
  c.on('pointerout', () => ((hover = false), draw()));
  c.on('pointerdown', () => {
    if (!enabled) return;
    sfx('click');
    onClick();
  });
  c.setEnabled = (v: boolean) => {
    enabled = v;
    draw();
    return c;
  };
  c.setLabel = (s: string) => {
    t.setText(s);
    return c;
  };
  draw();
  return c;
}

export const CARD_W = 156;
export const CARD_H = 234;

/** Desenha uma carta completa: moldura, custo, ícone hexagonal, nome e texto. */
type CardOpts = { cost?: number; preview?: { base: number; value: number } | null };

/** Carta completa. Usa a moldura pixelada (assets/cards/frames) quando ela existe. */
export function makeCard(scene: Phaser.Scene, cardId: string, opts: CardOpts = {}) {
  const def = getCard(cardId);
  if (scene.textures.exists(`frame_${def.type}`)) return makeFramedCard(scene, cardId, opts);
  return makeClassicCard(scene, cardId, opts);
}

/** Selo de prévia do dano: valor riscado e o dano real (verde se maior, vermelho se menor). */
function previewBadge(scene: Phaser.Scene, p: { base: number; value: number }) {
  const up = p.value > p.base;
  const badge = scene.add.container(0, 0);
  const bg = scene.add.graphics();
  bg.fillStyle(COLORS.outline).fillRoundedRect(-34, -15, 68, 30, 6);
  bg.fillStyle(0x231c33).fillRoundedRect(-32, -13, 64, 26, 5);
  const oldT = centerInk(txt(scene, 0, 0, String(p.base), 19, '#a89cc0', { fontFamily: NUM_FONT }), -15, 0);
  const strike = scene.add.rectangle(-15, 0, oldT.width + 6, 2, 0xff6070);
  const newT = centerInk(txt(scene, 0, 0, String(p.value), 24, up ? '#7fe0a0' : '#ff7a7a', { fontFamily: NUM_FONT, stroke: '#0d0a14', strokeThickness: 3 }), 15, 0);
  badge.add([bg, oldT, strike, newT]);
  return badge;
}

function makeFramedCard(scene: Phaser.Scene, cardId: string, opts: CardOpts) {
  const def = getCard(cardId);
  const L = FRAME_LAYOUT[def.type];
  const w = FRAME_SIZE.w;
  const h = FRAME_SIZE.h;
  const ox = -w / 2;
  const oy = -h / 2;
  const cx = (r: { x: number; w: number }) => ox + r.x + r.w / 2;
  const cy = (r: { y: number; h: number }) => oy + r.y + r.h / 2;
  const c = scene.add.container(0, 0);

  // Fundo das áreas vazadas da moldura.
  const g = scene.add.graphics();
  g.fillStyle(0x15111f).fillRect(ox + L.art.x, oy + L.art.y, L.art.w, L.art.h);
  g.fillStyle(0x221a30).fillRect(ox + L.name.x, oy + L.name.y, L.name.w, L.name.h);
  g.fillStyle(0xf1e6cf).fillRect(ox + L.text.x, oy + L.text.y, L.text.w, L.text.h);
  g.fillStyle(0x221a30).fillRect(ox + L.type.x, oy + L.type.y, L.type.w, L.type.h);
  c.add(g);

  // Arte preenchendo 100% da abertura (esticada se preciso); a moldura por cima recorta o hexágono.
  const artKey = `cardart_${cardId}`;
  if (scene.textures.exists(artKey)) {
    c.add(scene.add.image(cx(L.art), cy(L.art), artKey).setDisplaySize(L.art.w + 2, L.art.h + 2));
  } else if (scene.textures.exists(`card_${cardId}`)) {
    const img = scene.add.image(cx(L.art), cy(L.art), `card_${cardId}`);
    img.setScale(Math.min((L.art.w - 6) / img.width, (L.art.h - 4) / img.height));
    c.add(img);
  } else {
    c.add(placeholderIcon(scene, def).setPosition(cx(L.art), cy(L.art)).setScale(0.9));
  }

  c.add(scene.add.image(0, 0, `frame_${def.type}`));

  // Custo de Ki: desenhado POR CIMA da moldura, um pouco maior que o buraco, para cobrir a borda
  // que sobra da redução da imagem. O contorno escuro fino encosta no anel da moldura.
  const orb = scene.add.graphics();
  const r = Math.max(L.cost.w, L.cost.h) / 2 + 1.5;
  orb.fillStyle(COLORS.outline).fillCircle(cx(L.cost), cy(L.cost), r + 1);
  orb.fillStyle(COLORS.ki).fillCircle(cx(L.cost), cy(L.cost), r);
  orb.fillStyle(0x8fd0ff, 0.9).fillCircle(cx(L.cost) - r * 0.45, cy(L.cost) - r * 0.45, 2.5);
  c.add(orb);

  c.add(fitText(txt(scene, cx(L.name), cy(L.name), def.name, 14, '#ffffff', { fontStyle: 'bold' }), L.name.w - 8));
  c.add(description(scene, cx(L.text), cy(L.text), def.text, L.text.w - 8, L.text.h - 2));
  const typeLabel = def.ethereal ? `${TYPE_LABEL[def.type]} · Etérea` : TYPE_LABEL[def.type];
  c.add(fitText(txt(scene, cx(L.type), cy(L.type), typeLabel, 10, def.ethereal ? '#e9b8ff' : '#f4ecd8'), L.type.w - 6));

  const cost = opts.cost ?? def.cost;
  // Número centralizado no círculo do custo.
  c.add(centerInk(txt(scene, 0, 0, String(cost), 22, '#ffffff', { fontFamily: NUM_FONT, stroke: '#0d0a14', strokeThickness: 4 }), cx(L.cost), cy(L.cost)));

  if (opts.preview && opts.preview.value !== opts.preview.base) {
    c.add(previewBadge(scene, opts.preview).setPosition(ox + L.art.x + L.art.w - 30, oy + L.art.y + L.art.h - 14));
  }

  c.setSize(w, h);
  return c;
}

function makeClassicCard(scene: Phaser.Scene, cardId: string, opts: CardOpts = {}) {
  const def = getCard(cardId);
  const c = scene.add.container(0, 0);
  const g = scene.add.graphics();
  const w = CARD_W;
  const h = CARD_H;
  const color = TYPE_COLOR[def.type];
  const dark = Phaser.Display.Color.ValueToColor(color).darken(25).color;

  g.fillStyle(COLORS.outline).fillRoundedRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6, 10);
  g.fillStyle(dark).fillRoundedRect(-w / 2, -h / 2, w, h, 8);
  g.fillStyle(color).fillRoundedRect(-w / 2 + 4, -h / 2 + 4, w - 8, h - 8, 6);
  // Painel do texto.
  g.fillStyle(0xf1e6cf).fillRoundedRect(-w / 2 + 8, 30, w - 16, h / 2 - 50, 4);
  g.lineStyle(2, COLORS.outline).strokeRoundedRect(-w / 2 + 8, 30, w - 16, h / 2 - 50, 4);
  c.add(g);

  const key = `card_${cardId}`;
  const icon = scene.textures.exists(key)
    ? scene.add.image(0, -52, key).setScale(1.5)
    : placeholderIcon(scene, def).setPosition(0, -52);
  c.add(icon);

  // Faixa com o nome.
  const ribbon = scene.add.graphics();
  ribbon.fillStyle(COLORS.outline).fillRect(-w / 2 + 2, 6, w - 4, 24);
  ribbon.fillStyle(0x2a2238).fillRect(-w / 2 + 4, 8, w - 8, 20);
  c.add(ribbon);
  c.add(fitText(txt(scene, 0, 18, def.name, 15, '#ffffff', { fontStyle: 'bold' }), w - 14));

  const panelH = h / 2 - 50;
  c.add(description(scene, 0, 30 + panelH / 2, def.text, w - 24, panelH - 4));

  c.add(txt(scene, 0, h / 2 - 12, def.ethereal ? `${TYPE_LABEL[def.type]} · Etérea` : TYPE_LABEL[def.type], 12, def.ethereal ? '#e9b8ff' : '#f4ecd8'));

  // Custo de Ki.
  const cost = opts.cost ?? def.cost;
  const orb = scene.add.graphics();
  orb.fillStyle(COLORS.outline).fillCircle(-w / 2 + 14, -h / 2 + 14, 17);
  orb.fillStyle(COLORS.ki).fillCircle(-w / 2 + 14, -h / 2 + 14, 14);
  orb.fillStyle(0x8fd0ff).fillCircle(-w / 2 + 10, -h / 2 + 9, 4);
  c.add(orb);
  c.add(centerInk(txt(scene, 0, 0, String(cost), 20, '#ffffff', { fontFamily: NUM_FONT, stroke: '#0d0a14', strokeThickness: 3 }), -w / 2 + 14, -h / 2 + 14));

  if (opts.preview && opts.preview.value !== opts.preview.base) c.add(previewBadge(scene, opts.preview).setPosition(w / 2 - 34, -10));

  c.setSize(w, h);
  return c;
}

/** Verso da carta (cartas escondidas do oponente). */
export function makeCardBack(scene: Phaser.Scene, scale = 0.5) {
  if (scene.textures.exists('card_back')) {
    const c0 = scene.add.container(0, 0);
    c0.add(scene.add.image(0, 0, 'card_back').setScale((CARD_W * scale) / FRAME_SIZE.w));
    return c0;
  }
  const c = scene.add.container(0, 0);
  const g = scene.add.graphics();
  const w = CARD_W * scale;
  const h = CARD_H * scale;
  g.fillStyle(COLORS.outline).fillRoundedRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4, 6);
  g.fillStyle(0x3a2a5a).fillRoundedRect(-w / 2, -h / 2, w, h, 5);
  g.lineStyle(2, COLORS.gold).strokeRoundedRect(-w / 2 + 5, -h / 2 + 5, w - 10, h - 10, 4);
  c.add(g);
  c.add(txt(scene, 0, 0, '?', 28 * scale * 2, '#f0a830', { fontStyle: 'bold' }));
  return c;
}

/** Ícone provisório para cartas que ainda não têm arte. */
export function placeholderIcon(scene: Phaser.Scene, def: CardDef) {
  const c = scene.add.container(0, 0);
  const g = scene.add.graphics();
  const pts = [0, 1, 2, 3, 4, 5].map((i) => {
    const a = Phaser.Math.DegToRad(60 * i - 90);
    return new Phaser.Math.Vector2(Math.cos(a) * 58, Math.sin(a) * 58);
  });
  g.fillStyle(COLORS.outline).fillPoints(pts, true);
  g.fillStyle(TYPE_COLOR[def.type]).fillPoints(pts.map((p) => p.clone().scale(0.88)), true);
  c.add(g);
  c.add(txt(scene, 0, 0, def.name.slice(0, 1), 40, '#ffffff', { fontStyle: 'bold' }));
  return c;
}

/** Ícone pequeno (só o hexágono) para filas, poderes e golpes carregados. */
export function makeMiniIcon(scene: Phaser.Scene, cardId: string, scale = 0.6) {
  const key = `card_${cardId}`;
  if (scene.textures.exists(key)) return scene.add.image(0, 0, key).setScale(scale);
  return placeholderIcon(scene, getCard(cardId)).setScale(scale * 0.6);
}

/** Tamanho das figuras do personagem (assets/character) e linha dos pés. */
export const FIG_W = 64;
export const FIG_H = 80;
const FIG_FEET = 78;

/** Personagem com as roupas vestidas. Origem nos pés. */
export function makeCharacter(scene: Phaser.Scene, outfit: Outfit, scale: number, flip = false) {
  const c = scene.add.container(0, 0);
  c.add(scene.add.ellipse(0, -scale, 34 * scale, 6 * scale, 0x000000, 0.35));
  const armed = figureKey(outfit);
  const plain = figureKey({ ...outfit, hand: null });
  const key = scene.textures.exists(armed) ? armed : scene.textures.exists(plain) ? plain : 'fig_none_none';
  const layer = (k: string) =>
    c.add(
      scene.add
        .image(0, 0, k)
        .setOrigin(0.5, FIG_FEET / (scene.textures.get(k).getSourceImage().height || FIG_H))
        .setScale(scale)
        .setFlipX(flip),
    );
  layer(key);
  c.setSize(FIG_W * scale, FIG_H * scale);
  return c;
}


/** Ícone de uma peça de roupa, cabendo numa caixa de tamanho máximo. */
export function makeItemIcon(scene: Phaser.Scene, itemId: string, maxW: number, maxH: number) {
  const key = `item_${itemId}`;
  if (!scene.textures.exists(key)) return txt(scene, 0, 0, getItem(itemId)?.name ?? '?', 12);
  const img = scene.add.image(0, 0, key);
  const scale = Math.max(1, Math.floor(Math.min(maxW / img.width, maxH / img.height)));
  return img.setScale(scale);
}

/** Painel de uma peça: ícone, nome e os 3 poderes que ela dá. */
export function makeItemTile(
  scene: Phaser.Scene,
  itemId: string,
  opts: { width?: number; selected?: boolean; tag?: string; onClick?: () => void; onHover?: (cardId: string | null, x: number, y: number) => void } = {},
) {
  const item = getItem(itemId)!;
  const w = opts.width ?? 190;
  const h = 150;
  const c = scene.add.container(0, 0);
  const g = scene.add.graphics();
  const draw = (hover: boolean) => {
    g.clear();
    g.fillStyle(opts.selected ? COLORS.gold : COLORS.outline).fillRoundedRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6, 10);
    g.fillStyle(hover ? COLORS.panelLight : 0x1f5bb8).fillRoundedRect(-w / 2, -h / 2, w, h, 8);
    g.fillStyle(0x16121f, 0.55).fillRoundedRect(-w / 2, h / 2 - 66, w, 66, { tl: 0, tr: 0, bl: 8, br: 8 });
  };
  draw(false);
  c.add(g);
  c.add(makeItemIcon(scene, itemId, w - 16, 82).setPosition(0, -h / 2 + 42));
  c.add(fitText(txt(scene, 0, h / 2 - 52, item.name, ITEM_NAME.size, '#ffffff', ITEM_NAME.style), w - 12));
  item.cards.forEach((cardId, i) => {
    const x = (i - 1) * Math.min(46, (w - 10) / 3);
    const icon = makeMiniIcon(scene, cardId, 0.48).setPosition(x, h / 2 - 22);
    c.add(icon);
    if (opts.onHover) {
      const zone = scene.add.zone(x, h / 2 - 22, 40, 40).setInteractive();
      zone.on('pointerover', () => opts.onHover!(cardId, c.x + x, c.y + h / 2 - 22));
      zone.on('pointerout', () => opts.onHover!(null, 0, 0));
      c.add(zone);
    }
  });
  if (opts.tag) c.add(txt(scene, w / 2 - 8, -h / 2 + 12, opts.tag, 12, '#ffe28a', { fontStyle: 'bold', stroke: '#0d0a14', strokeThickness: 3 }).setOrigin(1, 0.5));
  if (opts.onClick) {
    const hit = scene.add.zone(0, -24, w, h - 50).setInteractive({ useHandCursor: true });
    hit.on('pointerover', () => draw(true));
    hit.on('pointerout', () => draw(false));
    hit.on('pointerdown', () => opts.onClick!());
    c.addAt(hit, 1);
  }
  c.setSize(w, h);
  return c;
}

export function tweenPromise(scene: Phaser.Scene, config: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
  return new Promise((resolve) => {
    scene.tweens.add({ ...config, onComplete: () => resolve() });
  });
}

export function wait(scene: Phaser.Scene, ms: number): Promise<void> {
  return new Promise((resolve) => scene.time.delayedCall(ms, resolve));
}

/** Texto que sobe e some (dano, bloqueio, status). */
export function floatText(scene: Phaser.Scene, x: number, y: number, s: string, color: string, size = 28) {
  // Números puros ("-12", "+5") usam a fonte de números.
  const onlyNumber = /^[-+]?\d+$/.test(s);
  const t = txt(scene, x, y, s, onlyNumber ? Math.round(size * 1.2) : size, color, { fontStyle: 'bold', ...(onlyNumber ? { fontFamily: NUM_FONT } : {}), stroke: '#0d0a14', strokeThickness: 5 }).setDepth(50);
  scene.tweens.add({ targets: t, y: y - 60, alpha: 0, duration: 1100, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
}

/** Fundo pixelado de arena. */
export function drawArena(scene: Phaser.Scene) {
  const W = 1280;
  const H = 720;
  const backdrop = scene.add.graphics().setDepth(-11);
  onViewportResize(scene, backdrop, () => {
    const { w, h, mx, my } = viewportBounds(scene.scale);
    backdrop.clear();
    backdrop.fillGradientStyle(0x1d2340, 0x1d2340, 0x2a1d3a, 0x2a1d3a).fillRect(-mx - 1, -my - 1, w + 2, h + 2);
    backdrop.fillStyle(0x2a2440).fillRect(-mx - 1, 430, w + 2, 290 + my + 1);
  });
  const g = scene.add.graphics().setDepth(-10);
  // Pilares.
  for (const x of [120, 400, 880, 1160]) {
    g.fillStyle(0x161a30).fillRect(x - 40, 60, 80, 400);
    g.fillStyle(0x222846).fillRect(x - 34, 60, 8, 400);
  }
  // Chão.
  g.fillStyle(0x2a2440).fillRect(0, 430, W, H - 430);
  for (let x = 0; x < W; x += 64) {
    for (let y = 430; y < H; y += 32) {
      g.fillStyle(((x + y) / 32) % 2 ? 0x2f2848 : 0x272139).fillRect(x + ((y / 32) % 2) * 32, y, 62, 30);
    }
  }
  g.fillStyle(0x0d0a14, 0.5).fillRect(0, 430, W, 6);
  // Tochas.
  for (const x of [120, 1160]) {
    g.fillStyle(0x3a2a20).fillRect(x - 4, 150, 8, 30);
    const flame = scene.add.ellipse(x, 140, 18, 26, 0xffa030).setDepth(-9);
    const core = scene.add.ellipse(x, 144, 8, 14, 0xffe28a).setDepth(-9);
    scene.tweens.add({ targets: [flame, core], scaleY: 1.15, scaleX: 0.9, yoyo: true, repeat: -1, duration: 260, ease: 'Sine.easeInOut' });
  }
  return g;
}

/**
 * Toca um efeito visual (assets/fx) uma vez e some no fim. O ponto (x, y) é onde fica o pivô do
 * efeito (ex.: a base de uma explosão, o centro de um impacto).
 */
export function playFx(
  scene: Phaser.Scene,
  name: string,
  x: number,
  y: number,
  opts: { scale?: number; tint?: number; flipX?: boolean; depth?: number; speed?: number } = {},
): Promise<void> {
  const info = FX[name];
  if (!info || !scene.textures.exists(`fx_${name}`)) return Promise.resolve();
  const sprite = scene.add
    .sprite(x, y, `fx_${name}`, 0)
    .setOrigin(info.pivotX, info.pivotY)
    .setScale(opts.scale ?? 2.5)
    .setFlipX(!!opts.flipX)
    .setDepth(opts.depth ?? 36);
  if (opts.tint !== undefined) sprite.setTint(opts.tint);
  return new Promise((resolve) => {
    sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      sprite.destroy();
      resolve();
    });
    sprite.play({ key: `fx_${name}`, timeScale: opts.speed ?? 1 });
  });
}

/**
 * Botão com a arte da HUD (assets/ui/btn_*.png), esticada para a área `r`.
 * O meio da arte é vazado: por baixo vai a cor do botão, por cima o texto.
 */
export function makeArtButton(
  scene: Phaser.Scene,
  r: { x: number; y: number; w: number; h: number },
  label: string,
  onClick: () => void,
  fill = 0x2f6fb0,
  size = 20,
): Button {
  const c = scene.add.container(r.x + r.w / 2, r.y + r.h / 2) as Button;
  const bg = scene.add.graphics();
  const art = scene.add.image(0, 0, 'btn_normal').setDisplaySize(r.w, r.h);
  const t = txt(scene, 0, -1, label, size, '#ffffff', { fontStyle: 'bold', stroke: '#0d0a14', strokeThickness: 4 });
  let enabled = true;
  let hover = false;
  const draw = () => {
    bg.clear();
    const base = !enabled ? 0x2a2f38 : hover ? Phaser.Display.Color.ValueToColor(fill).lighten(15).color : fill;
    bg.fillStyle(base).fillRect(-r.w / 2 + 6, -r.h / 2 + 6, r.w - 12, r.h - 12);
    art.setTexture(!enabled ? 'btn_disabled' : hover ? 'btn_hover' : 'btn_normal').setDisplaySize(r.w, r.h);
    t.setColor(enabled ? '#ffffff' : '#8a8f9a');
  };
  c.add([bg, art, t]);
  c.setSize(r.w, r.h);
  c.setInteractive({ useHandCursor: true });
  c.on('pointerover', () => ((hover = true), draw()));
  c.on('pointerout', () => ((hover = false), draw()));
  c.on('pointerdown', () => {
    if (!enabled) return;
    sfx('click');
    onClick();
  });
  c.setEnabled = (v: boolean) => {
    enabled = v;
    draw();
    return c;
  };
  c.setLabel = (s: string) => {
    t.setText(s);
    return c;
  };
  draw();
  return c;
}

/**
 * Botão que preenche uma abertura da HUD (a moldura dourada é da própria arte):
 * face em pixel art com luz em cima e sombra embaixo, como os botões do menu.
 */
export function makeSlotButton(
  scene: Phaser.Scene,
  r: { x: number; y: number; w: number; h: number },
  label: string,
  onClick: () => void,
  fill = 0xe8761c,
  size = 20,
): Button {
  const c = scene.add.container(r.x + r.w / 2, r.y + r.h / 2) as Button;
  const g = scene.add.graphics();
  const t = txt(scene, 0, -1, label, size, '#ffffff', { fontStyle: 'bold', stroke: '#0d0a14', strokeThickness: 4 });
  let enabled = true;
  let hover = false;
  let down = false;
  const W = r.w + 4, H = r.h + 4;
  const draw = () => {
    g.clear();
    const col = Phaser.Display.Color.ValueToColor(!enabled ? 0x3a3550 : fill);
    const base = hover && enabled ? col.clone().lighten(12) : col;
    const light = base.clone().lighten(18).color, dark = base.clone().darken(22).color;
    g.fillStyle(base.color).fillRect(-W / 2, -H / 2, W, H);
    g.fillStyle(light).fillRect(-W / 2, -H / 2, W, 5);
    g.fillStyle(dark).fillRect(-W / 2, H / 2 - (down ? 3 : 7), W, down ? 3 : 7);
    t.setColor(enabled ? '#ffffff' : '#8a8f9a').setY(down ? 1 : -2);
  };
  c.add([g, t]);
  c.setSize(r.w, r.h);
  c.setInteractive({ useHandCursor: true });
  c.on('pointerover', () => ((hover = true), draw()));
  c.on('pointerout', () => ((hover = false), (down = false), draw()));
  c.on('pointerdown', () => {
    if (!enabled) return;
    down = true;
    draw();
    sfx('click');
    onClick();
  });
  c.on('pointerup', () => ((down = false), draw()));
  c.setEnabled = (v: boolean) => {
    enabled = v;
    draw();
    return c;
  };
  c.setLabel = (s2: string) => {
    t.setText(s2);
    fitText(t, r.w - 12);
    return c;
  };
  draw();
  return c;
}

/** Atualiza objetos responsivos enquanto existirem, sem acumular listeners ao trocar de cena. */
export function onViewportResize(scene: Phaser.Scene, owner: Phaser.GameObjects.GameObject, update: () => void) {
  update();
  const scale = scene.scale;
  scale.on(Phaser.Scale.Events.RESIZE, update);
  owner.once(Phaser.GameObjects.Events.DESTROY, () => scale.off(Phaser.Scale.Events.RESIZE, update));
}

/** Fundo proporcional: preenche a janela inteira, cortando apenas a arte excedente. */
export function fullBackground(scene: Phaser.Scene, key: string, depth = -11, framed = false) {
  const image = scene.add.image(640, 360, key).setDepth(depth);
  if (framed) {
    // Painéis embutidos ficam alinhados; uma cópia de fundo cobre a área extra.
    fullBackground(scene, key, depth - 1);
    return image.setDisplaySize(VIEW_W, VIEW_H);
  }
  onViewportResize(scene, image, () => {
    const { w, h } = viewportBounds(scene.scale);
    const f = Math.max((w + 2) / image.width, (h + 2) / image.height);
    image.setDisplaySize(image.width * f, image.height * f);
  });
  return image;
}

/** Retângulo de cor que acompanha toda a área visível. */
export function viewportRect(scene: Phaser.Scene, color: number, alpha = 1) {
  const rect = scene.add.rectangle(640, 360, VIEW_W + 4, VIEW_H + 4, color, alpha);
  onViewportResize(scene, rect, () => {
    const { w, h } = viewportBounds(scene.scale);
    rect.setSize(w + 4, h + 4);
  });
  return rect;
}

export function fullShade(scene: Phaser.Scene, alpha: number) {
  return viewportRect(scene, 0x0d0a14, alpha);
}
