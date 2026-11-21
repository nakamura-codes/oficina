import Phaser from 'phaser';
import { startMenuMusic } from '../music.ts';
import type { BotLevel, ServerMessage } from '@oficina/shared';
import { session } from '../session.ts';
import { COLORS, drawArena, makeButton, makeCharacter, txt, fullShade } from '../ui.ts';

/** Espera um oponente na fila (ou começa direto contra o bot). */
export class LobbyScene extends Phaser.Scene {
  constructor() {
    super('Lobby');
  }

  create(data: { vsBot?: boolean; botLevel?: BotLevel }) {
    startMenuMusic();
    drawArena(this);
    fullShade(this, 0.5);
    makeCharacter(this, session.outfit, 4).setPosition(640, 500);

    const title = txt(this, 640, 150, data.vsBot ? 'Preparando treino' : 'Procurando oponente', 34, '#ffe28a', {
      fontStyle: 'bold',
      stroke: '#0d0a14',
      strokeThickness: 6,
    });
    let dots = 0;
    const base = title.text;
    const status = txt(this, 640, 200, session.net.connected ? '' : 'Conectando ao servidor…', 18, COLORS.textDim);

    this.time.addEvent({ delay: 400, loop: true, callback: () => {
      title.setText(base + '.'.repeat((dots = (dots + 1) % 4)));
      if (!session.net.connected) status.setText('Conectando ao servidor…');
    } });

    const join = () => session.net.send({ t: 'join', name: session.name, outfit: session.outfit, vsBot: !!data.vsBot, botLevel: data.botLevel });
    makeButton(this, 640, 560, 220, 54, 'Cancelar', () => {
      if (session.net.connected) session.net.send({ t: 'leaveQueue' });
      this.scene.start('Wardrobe');
    }, 0xb0a0c8);

    const off = session.net.on((msg: ServerMessage) => {
      if (msg.t === 'match') {
        this.scene.start('Battle');
      } else if (msg.t === 'queued') {
        status.setText('Na fila. Aguardando outro jogador…');
      } else if (msg.t === 'error') {
        status.setText(msg.message);
      }
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, off);

    if (data.vsBot) join();
    else {
      const offOpen = session.net.onOpen(join);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, offOpen);
    }
  }
}
