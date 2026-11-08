import { SCALE, Synth } from '../shared/audio';
import { Game, startShell } from '../shared/shell';
import { Stage, roundRect, runLoop } from '../shared/stage';
import { Cup, PATIENCE, SPOUT, STREAM_SPEED, TABLE_Y, TeaModel, Verdict, WORLD_H, WORLD_W } from './tea';

const TEA = '#b8661f';
const TEA_LIGHT = '#d98b3a';
const POT = '#f7f4ee';
const POT_SHADE = '#d9d2c4';
const POT_PATTERN = '#2f6b8f';

const TEXTS = (ru: boolean) =>
  ru
    ? {
        title: 'Налей чаю',
        tagline: 'Ровно до черты. Ни каплей больше.',
        howTo: 'Зажмите — чайник льёт. Отпустите заранее: струя ещё летит вниз. Чай должен встать между чертами.',
        play: 'Наливать',
        again: 'Ещё раз',
        resume: 'Продолжить',
        menu: 'Меню',
        paused: 'Пауза',
        gameOver: 'Чаепитие окончено',
        score: 'Очки',
        best: 'Рекорд',
        record: 'Новый рекорд!',
        continueAd: '▶ Ещё одна чашка за рекламу',
        soundOn: 'Звук: вкл',
        soundOff: 'Звук: выкл',
      }
    : {
        title: 'Pour the Tea',
        tagline: 'Right to the line. Not a drop more.',
        howTo: 'Hold to pour. Let go early: the stream is still falling. The tea must stop between the lines.',
        play: 'Pour',
        again: 'Again',
        resume: 'Resume',
        menu: 'Menu',
        paused: 'Paused',
        gameOver: 'Tea time is over',
        score: 'Score',
        best: 'Best',
        record: 'New record!',
        continueAd: '▶ One more cup for an ad',
        soundOn: 'Sound: on',
        soundOff: 'Sound: off',
      };

const VERDICT_TEXT: Record<Verdict, [string, string]> = {
  perfect: ['Идеально!', 'Perfect!'],
  good: ['Хорошо', 'Good'],
  under: ['Мало', 'Too little'],
  overflow: ['Перелил!', 'Overflow!'],
  spill: ['Мимо!', 'Spilled!'],
  miss: ['Не успел', 'Too slow'],
};

class TeaGame implements Game {
  private model = new TeaModel();
  private ripples: { x: number; age: number }[] = [];
  private steam = 0;

  constructor(
    private readonly stage: Stage,
    private readonly synth: Synth,
    private readonly ru: boolean,
  ) {}

  get score(): number {
    return this.model.score;
  }
  get over(): boolean {
    return this.model.over;
  }
  hudExtra(): string {
    return '♥'.repeat(Math.max(0, this.model.lives)) + '♡'.repeat(Math.max(0, 3 - this.model.lives));
  }

  start(): void {
    this.model = new TeaModel();
    this.ripples = [];
  }
  revive(): void {
    this.model.revive();
  }
  pointerDown(): void {
    this.model.press();
  }
  pointerMove(): void {}
  pointerUp(): void {
    this.model.release();
  }

  update(dt: number): void {
    const m = this.model;
    m.update(dt);
    for (const e of m.drainEvents()) {
      if (e.type === 'pourStart') this.synth.click(900, 0.05, 0.3);
      else if (e.type === 'land' && Math.random() < 0.15) this.ripples.push({ x: SPOUT.x + (Math.random() - 0.5) * 16, age: 0 });
      else if (e.type === 'verdict') this.verdictSound(e.verdict);
    }
    // Журчание: громче при наклоне, выше по мере наполнения — как настоящая чашка.
    const pouring = m.tilt > 0 || m.parcels.length > 0;
    const fill = m.level / m.cup.h;
    this.synth.loop('pour', pouring ? 0.4 + 0.6 * m.tilt : 0, 500 + fill * 1400, 1.4);
    this.steam = m.lastVerdict === 'perfect' || m.lastVerdict === 'good' ? Math.min(1, this.steam + dt * 2) : Math.max(0, this.steam - dt * 3);
  }

  private verdictSound(v: Verdict): void {
    if (v === 'perfect') {
      const s = Math.min(4, this.model.streak - 1);
      [0, 2, 4].forEach((k, i) => this.synth.note(SCALE[k + s], 0.6, 0.2, i * 0.08));
    } else if (v === 'good') this.synth.note(SCALE[2], 0.5, 0.2);
    else {
      this.synth.thud(0.5);
      if (v === 'overflow' || v === 'spill') this.synth.click(700, 0.25, 0.3);
    }
  }

  draw(dt: number): void {
    const ctx = this.stage.begin((c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#f4ebdd');
      g.addColorStop(1, '#e6d6bd');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    });
    const m = this.model;

    this.drawTable(ctx);
    this.drawCup(ctx, m.cup, m.level);
    this.drawStream(ctx);
    this.drawPot(ctx, m.tilt);
    this.drawRipples(ctx, dt);
    this.drawSteam(ctx, m.cup);
    if (m.phase === 'ready' && m.cup.speed === 0 && !m.pourUsed) this.drawPatience(ctx, m.cup, m.patience);
    if (m.phase === 'result' && m.lastVerdict) this.drawVerdict(ctx, m.lastVerdict, m.cup);
  }

  private drawTable(ctx: CanvasRenderingContext2D): void {
    const top = TABLE_Y + 10;
    const g = ctx.createLinearGradient(0, top, 0, WORLD_H);
    g.addColorStop(0, '#a8703f');
    g.addColorStop(1, '#8a5a31');
    ctx.fillStyle = g;
    // Стол шире мира: на широком экране его края не должны быть видны.
    roundRect(ctx, -2000, top, WORLD_W + 4000, WORLD_H - top + 400, 0);
    ctx.fill();
    ctx.strokeStyle = 'rgba(70, 40, 15, 0.25)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      const y = top + 20 + i * 24;
      ctx.moveTo(-2000, y);
      ctx.bezierCurveTo(100, y + 6, 400, y - 6, WORLD_W + 2000, y + 3);
      ctx.stroke();
    }
  }

  private drawCup(ctx: CanvasRenderingContext2D, c: Cup, level: number): void {
    const left = c.x - c.w / 2;
    const right = c.x + c.w / 2;
    const top = TABLE_Y - c.h;
    const wall = 9;
    const base = TABLE_Y + 10;
    const color = c.style === 'glass' ? 'rgba(220, 235, 245, 0.55)' : c.style === 'mug' ? '#c9553d' : c.style === 'bowl' ? '#e8e1d0' : '#ffffff';
    const edge = c.style === 'glass' ? 'rgba(120, 150, 170, 0.7)' : 'rgba(60, 40, 20, 0.35)';

    // Ручка.
    if (c.style === 'cup' || c.style === 'mug') {
      ctx.beginPath();
      ctx.lineWidth = 12;
      ctx.strokeStyle = color;
      ctx.arc(right + wall + 14, TABLE_Y - c.h * 0.55, c.h * 0.22, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = edge;
      ctx.stroke();
    }

    // Стенки и дно.
    ctx.beginPath();
    ctx.moveTo(left - wall, top);
    ctx.lineTo(left - wall, base - 12);
    ctx.quadraticCurveTo(left - wall, base, left + 4, base);
    ctx.lineTo(right - 4, base);
    ctx.quadraticCurveTo(right + wall, base, right + wall, base - 12);
    ctx.lineTo(right + wall, top);
    ctx.lineTo(right, top);
    ctx.lineTo(right, TABLE_Y);
    ctx.lineTo(left, TABLE_Y);
    ctx.lineTo(left, top);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = edge;
    ctx.stroke();

    // Внутренность и чай.
    ctx.fillStyle = c.style === 'glass' ? 'rgba(240, 248, 252, 0.4)' : 'rgba(250, 246, 238, 0.95)';
    ctx.fillRect(left, top, c.w, c.h);
    if (level > 0) {
      const g = ctx.createLinearGradient(0, TABLE_Y - level, 0, TABLE_Y);
      g.addColorStop(0, TEA_LIGHT);
      g.addColorStop(1, TEA);
      ctx.fillStyle = g;
      ctx.fillRect(left, TABLE_Y - level, c.w, level);
      ctx.fillStyle = 'rgba(255, 230, 190, 0.6)';
      ctx.fillRect(left, TABLE_Y - level, c.w, 3);
    }

    // Черты: полоса, куда надо налить.
    const ok = 'rgba(70, 150, 90, ';
    ctx.fillStyle = ok + '0.16)';
    ctx.fillRect(left, TABLE_Y - c.hi, c.w, c.hi - c.lo);
    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = ok + '0.9)';
    ctx.lineWidth = 2.5;
    for (const y of [c.lo, c.hi]) {
      ctx.beginPath();
      ctx.moveTo(left, TABLE_Y - y);
      ctx.lineTo(right, TABLE_Y - y);
      ctx.stroke();
    }
    ctx.restore();
    // Метки снаружи, чтобы было видно и поверх тёмного чая.
    ctx.fillStyle = ok + '1)';
    for (const y of [c.lo, c.hi]) {
      ctx.beginPath();
      ctx.moveTo(left - wall - 16, TABLE_Y - y - 6);
      ctx.lineTo(left - wall - 4, TABLE_Y - y);
      ctx.lineTo(left - wall - 16, TABLE_Y - y + 6);
      ctx.fill();
    }
  }

  private drawStream(ctx: CanvasRenderingContext2D): void {
    const m = this.model;
    if (m.parcels.length === 0) return;
    ctx.save();
    ctx.strokeStyle = TEA;
    ctx.lineCap = 'round';
    ctx.lineWidth = 7;
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    let prev: { y: number; t: number } | null = null;
    for (const p of m.parcels) {
      const y = Math.min(SPOUT.y + STREAM_SPEED * (m.time - p.emitAt), TABLE_Y - m.level);
      if (prev && p.emitAt - prev.t < 0.04) ctx.lineTo(p.x, y);
      else ctx.moveTo(p.x, y);
      prev = { y, t: p.emitAt };
    }
    // Последний кусок — от носика, пока чайник наклонён.
    if (m.tilt > 0 && prev) ctx.lineTo(SPOUT.x, SPOUT.y);
    ctx.stroke();
    ctx.restore();
  }

  private drawPot(ctx: CanvasRenderingContext2D, tilt: number): void {
    ctx.save();
    // Чайник вращается вокруг носика: струя всегда начинается в одной точке.
    ctx.translate(SPOUT.x, SPOUT.y);
    ctx.rotate(tilt * 0.42 - 0.08);
    // Чайник чуть меньше натурального, чтобы ручка не уходила за левый край узкого экрана.
    ctx.scale(0.82, 0.82);
    // Носик.
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-30, 10, -62, 48);
    ctx.lineTo(-82, 30);
    ctx.quadraticCurveTo(-40, 6, -6, -8);
    ctx.closePath();
    ctx.fillStyle = POT;
    ctx.fill();
    ctx.strokeStyle = POT_SHADE;
    ctx.lineWidth = 2;
    ctx.stroke();
    // Ручка.
    ctx.beginPath();
    ctx.lineWidth = 14;
    ctx.strokeStyle = POT;
    ctx.arc(-290, 60, 42, Math.PI * 0.55, Math.PI * 1.45);
    ctx.stroke();
    // Тело.
    const g = ctx.createRadialGradient(-210, 40, 20, -180, 70, 130);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, POT_SHADE);
    ctx.beginPath();
    ctx.ellipse(-180, 70, 112, 82, 0, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    // Узор.
    ctx.strokeStyle = POT_PATTERN;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(-180, 70, 112, 82, 0, Math.PI * 0.05, Math.PI * 0.95);
    ctx.stroke();
    ctx.fillStyle = POT_PATTERN;
    for (let i = 0; i < 5; i++) {
      const a = Math.PI * (0.15 + i * 0.17);
      ctx.beginPath();
      ctx.arc(-180 + Math.cos(a) * 80, 70 + Math.sin(a) * 52, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    // Крышка.
    ctx.fillStyle = POT;
    ctx.beginPath();
    ctx.ellipse(-180, -6, 58, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = POT_SHADE;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = POT_PATTERN;
    ctx.beginPath();
    ctx.arc(-180, -22, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawRipples(ctx: CanvasRenderingContext2D, dt: number): void {
    const m = this.model;
    ctx.save();
    for (const r of this.ripples) {
      r.age += dt;
      const k = r.age / 0.4;
      ctx.strokeStyle = `rgba(255, 225, 180, ${1 - k})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(r.x, TABLE_Y - m.level, 6 + k * 22, 2 + k * 4, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    this.ripples = this.ripples.filter((r) => r.age < 0.4);
  }

  private drawSteam(ctx: CanvasRenderingContext2D, c: Cup): void {
    if (this.steam <= 0) return;
    const t = performance.now() / 1000;
    ctx.save();
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.7 * this.steam})`;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    for (let i = -1; i <= 1; i++) {
      const x = c.x + i * 22;
      ctx.beginPath();
      for (let k = 0; k <= 10; k++) {
        const y = TABLE_Y - c.h - 10 - k * 9;
        const xx = x + Math.sin(t * 3 + k * 0.6 + i) * 7;
        if (k === 0) ctx.moveTo(xx, y);
        else ctx.lineTo(xx, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawPatience(ctx: CanvasRenderingContext2D, c: Cup, left: number): void {
    const x = c.x;
    const y = TABLE_Y - c.h - 46;
    ctx.save();
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(58, 42, 28, 0.15)';
    ctx.beginPath();
    ctx.arc(x, y, 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = left < 0.3 ? '#c0392b' : '#2f6b8f';
    ctx.beginPath();
    ctx.arc(x, y, 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
    ctx.stroke();
    ctx.restore();
    void PATIENCE;
  }

  private drawVerdict(ctx: CanvasRenderingContext2D, v: Verdict, c: Cup): void {
    const good = v === 'perfect' || v === 'good';
    const text = VERDICT_TEXT[v][this.ru ? 0 : 1];
    const k = Math.min(1, this.model.phaseTime / 0.2);
    ctx.save();
    ctx.translate(c.x, TABLE_Y - c.h - 70);
    ctx.scale(0.8 + 0.2 * k, 0.8 + 0.2 * k);
    ctx.font = '800 44px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(255, 250, 242, 0.95)';
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = good ? (v === 'perfect' ? '#2e8b57' : '#2f6b8f') : '#c0392b';
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const stage = new Stage(canvas, { width: WORLD_W, height: WORLD_H });
void startShell(
  {
    storageKey: 'pour-tea.v1',
    texts: TEXTS,
    create: ({ synth, ru }) => new TeaGame(stage, synth, ru),
    stageToWorld: (x, y) => stage.toWorld(x, y),
  },
  canvas,
  runLoop,
);
