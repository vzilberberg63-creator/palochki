import { SCALE, Synth } from '../shared/audio';
import { Game, startShell } from '../shared/shell';
import { Stage, roundRect, runLoop } from '../shared/stage';
import { CENTER, Cut, Food, Grade, HalfModel, WORLD_H, WORLD_W } from './half';

const TEXTS = (ru: boolean) =>
  ru
    ? {
        title: 'Ровно пополам',
        tagline: 'Один взмах ножа. Никаких «примерно».',
        howTo: 'Проведите пальцем через еду — это разрез. Отрежьте ровно половину, а потом треть и четверть. Дырки в сыре не считаются.',
        play: 'Резать',
        again: 'Ещё раз',
        resume: 'Продолжить',
        menu: 'Меню',
        paused: 'Пауза',
        gameOver: 'Нож отложен',
        score: 'Очки',
        best: 'Рекорд',
        record: 'Новый рекорд!',
        continueAd: '▶ Ещё один разрез за рекламу',
        soundOn: 'Звук: вкл',
        soundOff: 'Звук: выкл',
      }
    : {
        title: 'Exactly Half',
        tagline: 'One cut. No “roughly”.',
        howTo: 'Swipe across the food to cut it. Cut exactly half, then a third and a quarter. Holes in the cheese do not count.',
        play: 'Cut',
        again: 'Again',
        resume: 'Resume',
        menu: 'Menu',
        paused: 'Paused',
        gameOver: 'Knife down',
        score: 'Score',
        best: 'Best',
        record: 'New record!',
        continueAd: '▶ One more cut for an ad',
        soundOn: 'Sound: on',
        soundOff: 'Sound: off',
      };

const GRADE_TEXT: Record<Grade, [string, string]> = {
  perfect: ['Идеально!', 'Perfect!'],
  great: ['Отлично', 'Great'],
  ok: ['Почти', 'Close'],
  miss: ['Криво!', 'Crooked!'],
  timeout: ['Не успели', 'Too slow'],
};

interface Palette {
  fill: string;
  edge: string;
  edgeWidth: number;
  hole?: string;
}

const PALETTES: Record<Food['style'], Palette> = {
  cheese: { fill: '#f6c945', edge: '#d9a21e', edgeWidth: 6, hole: '#d99a1c' },
  cake: { fill: '#f4cfd7', edge: '#b9607a', edgeWidth: 8 },
  bread: { fill: '#e2ad72', edge: '#9c5a24', edgeWidth: 12 },
  pizza: { fill: '#d4492f', edge: '#e3b56a', edgeWidth: 16 },
};

function targetLabel(t: number, ru: boolean): string {
  if (t === 0.5) return ru ? 'Пополам' : 'In half';
  if (Math.abs(t - 1 / 3) < 1e-6) return ru ? 'Отрежьте ⅓' : 'Cut off ⅓';
  return ru ? 'Отрежьте ¼' : 'Cut off ¼';
}

function fmt(f: number, ru: boolean): string {
  return (f * 100).toFixed(1).replace('.', ru ? ',' : '.') + '%';
}

class HalfGame implements Game {
  private model = new HalfModel();
  private swipe: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** Центры кусков в координатах еды — для подписей с процентами. */
  private pieceCenters: { pos: { x: number; y: number }; neg: { x: number; y: number } } | null = null;

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
    this.model = new HalfModel();
    this.swipe = null;
  }
  revive(): void {
    this.model.revive();
  }

  pointerDown(x: number, y: number): void {
    if (this.model.phase !== 'ready') return;
    this.swipe = { x0: x, y0: y, x1: x, y1: y };
  }
  pointerMove(x: number, y: number): void {
    if (!this.swipe) return;
    this.swipe.x1 = x;
    this.swipe.y1 = y;
  }
  pointerUp(x: number, y: number): void {
    const s = this.swipe;
    this.swipe = null;
    if (!s) return;
    this.model.cut(s.x0, s.y0, x, y);
  }

  update(dt: number): void {
    const m = this.model;
    m.update(dt);
    if (m.phase !== 'ready') this.swipe = null;
    for (const e of m.drainEvents()) {
      if (e.type === 'cut') {
        this.pieceCenters = this.centers(e.cut);
        this.synth.click(3200, 0.12, 0.35);
        this.synth.click(900, 0.06, 0.4, 0.05);
        this.gradeSound(e.cut.grade);
      } else if (e.type === 'timeout') this.synth.thud(0.5);
      else if (e.type === 'invalid') this.synth.click(500, 0.05, 0.25);
    }
  }

  private gradeSound(g: Grade): void {
    if (g === 'perfect') {
      const s = Math.min(4, this.model.streak - 1);
      [0, 2, 4, 6].forEach((k, i) => this.synth.note(SCALE[k + s] ?? SCALE[9], 0.6, 0.18, 0.1 + i * 0.07));
    } else if (g === 'great') this.synth.note(SCALE[4], 0.5, 0.2, 0.1);
    else if (g === 'ok') this.synth.note(SCALE[1], 0.4, 0.18, 0.1);
    else this.synth.thud(0.5);
  }

  private centers(c: Cut) {
    const pts = this.model.points;
    const acc = { pos: { x: 0, y: 0, n: 0 }, neg: { x: 0, y: 0, n: 0 } };
    for (let i = 0; i < pts.length; i += 2) {
      const side = (pts[i] - c.px) * c.dy - (pts[i + 1] - c.py) * c.dx > 0 ? acc.pos : acc.neg;
      side.x += pts[i];
      side.y += pts[i + 1];
      side.n++;
    }
    const avg = (a: { x: number; y: number; n: number }) => ({ x: a.x / Math.max(1, a.n), y: a.y / Math.max(1, a.n) });
    return { pos: avg(acc.pos), neg: avg(acc.neg) };
  }

  draw(): void {
    const ctx = this.stage.begin((c, w, h) => {
      const g = c.createRadialGradient(w / 2, h * 0.45, 50, w / 2, h / 2, Math.max(w, h));
      g.addColorStop(0, '#2c414c');
      g.addColorStop(1, '#162127');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    });
    const m = this.model;
    this.drawBoard(ctx);

    const enter = m.phase === 'enter' ? Math.min(1, m.phaseTime / 0.4) : 1;
    const exit = m.phase === 'exit' ? Math.min(1, m.phaseTime / 0.35) : 0;
    ctx.save();
    ctx.globalAlpha = enter * (1 - exit);
    if (m.phase === 'result' && m.lastCut) this.drawPieces(ctx, m.lastCut, Math.min(1, m.phaseTime / 0.25));
    else this.drawFood(ctx, m.food, m.angle, 0.7 + 0.3 * (1 - (1 - enter) ** 3), 0, 0);
    ctx.restore();

    this.drawTarget(ctx);
    if (m.phase === 'ready') this.drawTimer(ctx);
    if (this.swipe) this.drawSwipe(ctx, this.swipe);
    if (m.phase === 'result') this.drawGrade(ctx);
  }

  private drawBoard(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 12;
    roundRect(ctx, 30, 220, WORLD_W - 60, 470, 40);
    const g = ctx.createLinearGradient(0, 220, 0, 690);
    g.addColorStop(0, '#c9935c');
    g.addColorStop(1, '#a8723f');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(90, 50, 20, 0.18)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      ctx.beginPath();
      const y = 250 + i * 50;
      ctx.moveTo(50, y);
      ctx.bezierCurveTo(200, y + 10, 400, y - 10, WORLD_W - 50, y + 4);
      ctx.stroke();
    }
  }

  /** Еда целиком: перенос в центр, поворот, масштаб, сдвиг (для кусков). */
  private drawFood(ctx: CanvasRenderingContext2D, f: Food, angle: number, scale: number, ox: number, oy: number): void {
    const pal = PALETTES[f.style];
    ctx.save();
    ctx.translate(CENTER.x + ox, CENTER.y + oy);
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    const path = new Path2D();
    f.outline.forEach((p, i) => (i === 0 ? path.moveTo(p.x, p.y) : path.lineTo(p.x, p.y)));
    path.closePath();

    ctx.save();
    ctx.shadowColor = 'rgba(60, 30, 10, 0.35)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = pal.edge;
    ctx.fill(path);
    ctx.restore();
    ctx.save();
    ctx.clip(path);
    // Корочка/край по контуру, внутри — начинка.
    ctx.lineWidth = pal.edgeWidth * 2;
    ctx.strokeStyle = pal.edge;
    ctx.fillStyle = pal.fill;
    ctx.fill(path);
    ctx.stroke(path);
    this.decorate(ctx, f);
    ctx.restore();
    ctx.restore();
  }

  private decorate(ctx: CanvasRenderingContext2D, f: Food): void {
    if (f.style === 'cheese') {
      for (const h of f.holes) {
        const g = ctx.createRadialGradient(h.x - h.r * 0.3, h.y - h.r * 0.3, 2, h.x, h.y, h.r);
        g.addColorStop(0, '#c98d14');
        g.addColorStop(1, '#e6b235');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (f.style === 'cake') {
      ctx.fillStyle = '#fffaf5';
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * 110, Math.sin(a) * 110, 11, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#c4213f';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.3;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * 55, Math.sin(a) * 55, 13, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (f.style === 'bread') {
      ctx.strokeStyle = 'rgba(140, 80, 30, 0.55)';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 60 - 30, -50);
        ctx.lineTo(i * 60 + 30, 50);
        ctx.stroke();
      }
    } else if (f.style === 'pizza') {
      ctx.fillStyle = '#f2d27a';
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4;
        const r = 30 + (i % 3) * 38;
        ctx.beginPath();
        ctx.ellipse(Math.cos(a) * r, Math.sin(a) * r, 26, 18, a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#9e2a1f';
      for (let i = 0; i < 6; i++) {
        const a = i * 1.05 + 0.5;
        const r = 70 + (i % 2) * 40;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r, Math.sin(a) * r, 15, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /** После разреза: два куска разъезжаются вдоль нормали, на каждом его доля. */
  private drawPieces(ctx: CanvasRenderingContext2D, c: Cut, k: number): void {
    const m = this.model;
    const sep = 16 * k;
    // Нормаль к разрезу в координатах мира.
    const nxl = c.dy;
    const nyl = -c.dx;
    const cos = Math.cos(m.angle);
    const sin = Math.sin(m.angle);
    const nx = nxl * cos - nyl * sin;
    const ny = nxl * sin + nyl * cos;
    for (const side of [1, -1]) {
      ctx.save();
      // Отсекаем полуплоскость в координатах еды.
      ctx.translate(CENTER.x + nx * sep * side, CENTER.y + ny * sep * side);
      ctx.rotate(m.angle);
      const L = 2000;
      ctx.beginPath();
      ctx.moveTo(c.px - c.dx * L, c.py - c.dy * L);
      ctx.lineTo(c.px + c.dx * L, c.py + c.dy * L);
      ctx.lineTo(c.px + c.dx * L + nxl * L * side, c.py + c.dy * L + nyl * L * side);
      ctx.lineTo(c.px - c.dx * L + nxl * L * side, c.py - c.dy * L + nyl * L * side);
      ctx.closePath();
      ctx.clip();
      ctx.rotate(-m.angle);
      ctx.translate(-CENTER.x, -CENTER.y);
      this.drawFood(ctx, m.food, m.angle, 1, 0, 0);
      ctx.restore();
    }
    // Подписи долей.
    if (!this.pieceCenters) return;
    const toWorld = (p: { x: number; y: number }, side: number) => ({
      x: CENTER.x + p.x * cos - p.y * sin + nx * sep * side,
      y: CENTER.y + p.x * sin + p.y * cos + ny * sep * side,
    });
    const labels: [{ x: number; y: number }, number][] = [
      [toWorld(this.pieceCenters.pos, 1), c.fraction],
      [toWorld(this.pieceCenters.neg, -1), 1 - c.fraction],
    ];
    ctx.font = '800 30px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [p, f] of labels) {
      ctx.lineWidth = 7;
      ctx.strokeStyle = 'rgba(30, 20, 10, 0.75)';
      ctx.strokeText(fmt(f, this.ru), p.x, p.y);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(fmt(f, this.ru), p.x, p.y);
    }
    // Вспышка ножа вдоль разреза.
    if (k < 1) {
      ctx.save();
      ctx.translate(CENTER.x, CENTER.y);
      ctx.rotate(m.angle);
      ctx.strokeStyle = `rgba(255, 255, 255, ${1 - k})`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(c.px - c.dx * 400, c.py - c.dy * 400);
      ctx.lineTo(c.px + c.dx * 400, c.py + c.dy * 400);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawTarget(ctx: CanvasRenderingContext2D): void {
    const m = this.model;
    ctx.save();
    ctx.font = '800 46px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f8f4ec';
    ctx.fillText(targetLabel(m.food.target, this.ru), WORLD_W / 2, 150);
    ctx.restore();
  }

  private drawTimer(ctx: CanvasRenderingContext2D): void {
    const m = this.model;
    const f = Math.max(0, m.timeLeft / m.food.time);
    const w = WORLD_W - 120;
    roundRect(ctx, 60, 190, w, 10, 5);
    ctx.fillStyle = 'rgba(248, 244, 236, 0.15)';
    ctx.fill();
    roundRect(ctx, 60, 190, Math.max(10, w * f), 10, 5);
    ctx.fillStyle = f < 0.25 ? '#e0562f' : '#f8f4ec';
    ctx.fill();
  }

  private drawSwipe(ctx: CanvasRenderingContext2D, s: { x0: number; y0: number; x1: number; y1: number }): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 4;
    ctx.setLineDash([14, 10]);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.x0, s.y0);
    ctx.lineTo(s.x1, s.y1);
    ctx.stroke();
    ctx.restore();
  }

  private drawGrade(ctx: CanvasRenderingContext2D): void {
    const g = this.model.lastGrade;
    if (!g) return;
    const good = g === 'perfect' || g === 'great' || g === 'ok';
    ctx.save();
    ctx.font = '800 50px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = good ? (g === 'perfect' ? '#7ee08a' : '#f8f4ec') : '#ff8a65';
    ctx.fillText(GRADE_TEXT[g][this.ru ? 0 : 1], WORLD_W / 2, 780);
    const c = this.model.lastCut;
    if (c) {
      ctx.font = '600 26px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(248, 244, 236, 0.75)';
      const err = c.error.toFixed(1).replace('.', this.ru ? ',' : '.');
      ctx.fillText(this.ru ? `ошибка ${err}%` : `off by ${err}%`, WORLD_W / 2, 830);
    }
    ctx.restore();
  }
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const stage = new Stage(canvas, { width: WORLD_W, height: WORLD_H });
void startShell(
  {
    storageKey: 'exactly-half.v1',
    texts: TEXTS,
    create: ({ synth, ru }) => new HalfGame(stage, synth, ru),
    stageToWorld: (x, y) => stage.toWorld(x, y),
  },
  canvas,
  runLoop,
);
