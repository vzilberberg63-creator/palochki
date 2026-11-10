import { SCALE, Synth } from '../shared/audio';
import { Game, startShell } from '../shared/shell';
import { Stage, roundRect, runLoop } from '../shared/stage';
import { CELL, COLS, Debris, DrainModel, GRATE, RAKE_HALF, ROWS, SIDEWALK, WORLD_H, WORLD_W } from './drain';

const TEXTS = (ru: boolean) =>
  ru
    ? {
        title: 'Водосток',
        tagline: 'Ливень не ждёт. Решётка должна дышать.',
        howTo: 'Дождь заливает дорогу, а листья и мусор плывут к решётке и забивают её. Ведите пальцем — грабли сгребают мусор. Сметайте его на тротуар, пока воду не подняло до бордюра.',
        play: 'За грабли',
        again: 'Ещё раз',
        resume: 'Продолжить',
        menu: 'Меню',
        paused: 'Пауза',
        gameOver: 'Дорогу затопило',
        score: 'Очки',
        best: 'Рекорд',
        record: 'Новый рекорд!',
        continueAd: '▶ Спустить воду за рекламу',
        soundOn: 'Звук: вкл',
        soundOff: 'Звук: выкл',
      }
    : {
        title: 'Storm Drain',
        tagline: 'The downpour will not wait. Keep the grate clear.',
        howTo: 'Rain floods the road while leaves and litter drift to the grate and clog it. Drag to rake. Sweep the litter onto the sidewalk before the water reaches the curb.',
        play: 'Grab the rake',
        again: 'Again',
        resume: 'Resume',
        menu: 'Menu',
        paused: 'Paused',
        gameOver: 'The road is flooded',
        score: 'Score',
        best: 'Best',
        record: 'New record!',
        continueAd: '▶ Drain the water for an ad',
        soundOn: 'Sound: on',
        soundOff: 'Sound: off',
      };

const LEAF_COLORS = ['#d98a2b', '#c9562a', '#e3b23c', '#8f6b2c'];
const BOTTLE_COLORS = ['#3f8f5a', '#7a5a2e', '#4d86a8', '#3f8f5a'];
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

interface Float {
  x: number;
  y: number;
  text: string;
  age: number;
}

class DrainGame implements Game {
  private model = new DrainModel();
  private readonly ground: HTMLCanvasElement;
  private readonly waterCanvas: HTMLCanvasElement;
  private readonly waterCtx: CanvasRenderingContext2D;
  private readonly waterImage: ImageData;
  private rainDrops: { x: number; y: number; len: number }[] = [];
  private ripples: { x: number; y: number; age: number }[] = [];
  private floats: Float[] = [];
  private pointer = -1;
  private warnIn = 0;
  private clock = 0;

  constructor(
    private readonly stage: Stage,
    private readonly synth: Synth,
    private readonly ru: boolean,
  ) {
    this.ground = this.paintGround();
    this.waterCanvas = document.createElement('canvas');
    this.waterCanvas.width = COLS;
    this.waterCanvas.height = ROWS;
    this.waterCtx = this.waterCanvas.getContext('2d')!;
    this.waterImage = this.waterCtx.createImageData(COLS, ROWS);
    for (let i = 0; i < 70; i++) this.rainDrops.push({ x: Math.random() * (WORLD_W + 200) - 100, y: Math.random() * WORLD_H, len: 18 + Math.random() * 22 });
  }

  get score(): number {
    return this.model.score;
  }
  get over(): boolean {
    return this.model.over;
  }
  hudExtra(): string {
    const pct = Math.min(100, Math.round(this.model.flood * 100));
    return `${this.ru ? 'Вода' : 'Water'} ${pct}%`;
  }
  start(): void {
    this.model = new DrainModel();
    this.floats = [];
    this.ripples = [];
    this.pointer = -1;
  }
  revive(): void {
    this.model.revive();
    this.pointer = -1;
  }

  pointerDown(x: number, y: number, id: number): void {
    if (this.pointer !== -1) return;
    this.pointer = id;
    this.model.rakeDown(x, y);
    this.synth.click(700, 0.05, 0.25);
  }
  pointerMove(x: number, y: number, id: number): void {
    if (id === this.pointer) this.model.rakeMove(x, y);
  }
  pointerUp(_x: number, _y: number, id: number): void {
    if (id !== this.pointer) return;
    this.pointer = -1;
    this.model.rakeUp();
  }

  update(dt: number): void {
    const m = this.model;
    m.update(dt);
    this.clock += dt;
    for (const e of m.drainEvents()) {
      if (e.type === 'collect') {
        this.floats.push({ x: e.x, y: e.y, text: `+${e.points}`, age: 0 });
        this.synth.click(e.kind === 'bottle' ? 2600 : 1500, 0.04, 0.3);
        this.synth.note(SCALE[2 + Math.min(6, e.points)], 0.25, 0.1, 0, 'sine');
      } else if (e.type === 'flood') {
        this.synth.thud(0.6);
      }
    }
    // Дождь шумит всегда, решётка булькает, когда вода уходит, грабли шуршат по асфальту.
    this.synth.loop('rain', 0.25 + m.rain * 0.3, 5200, 0.5);
    this.synth.loop('gurgle', m.drainFlow * 0.9, 260, 3);
    this.synth.loop('rake', m.rakeActivity * 0.8, 1800, 1.2);

    this.warnIn -= dt;
    if (m.flood > 0.75 && this.warnIn <= 0) {
      this.synth.click(1500, 0.03, 0.4);
      this.warnIn = 0.6 - (m.flood - 0.75) * 1.6;
    }

    for (const d of this.rainDrops) {
      d.y += 1500 * dt;
      d.x -= 260 * dt;
      if (d.y > WORLD_H + 40) {
        d.y = -40;
        d.x = Math.random() * (WORLD_W + 300) - 50;
        // Капля упала — круг на воде.
        if (this.ripples.length < 40) this.ripples.push({ x: SIDEWALK + Math.random() * (WORLD_W - SIDEWALK * 2), y: Math.random() * WORLD_H, age: 0 });
      }
    }
  }

  draw(dt: number): void {
    const ctx = this.stage.begin('#22282e');
    const m = this.model;
    ctx.drawImage(this.ground, 0, 0, WORLD_W, WORLD_H);
    this.drawGrate(ctx);
    this.drawWater(ctx);
    this.drawRipples(ctx, dt);
    this.drawVortex(ctx);
    for (const d of m.debris) this.drawDebris(ctx, d);
    this.drawRake(ctx);
    this.drawRain(ctx);
    this.drawFloats(ctx, dt);
    this.drawFloodBar(ctx);
    this.drawWarning(ctx);
  }

  /** Асфальт, тротуары и бордюры рисуются один раз. */
  private paintGround(): HTMLCanvasElement {
    const k = 2;
    const c = document.createElement('canvas');
    c.width = WORLD_W * k;
    c.height = WORLD_H * k;
    const g = c.getContext('2d')!;
    g.scale(k, k);
    g.fillStyle = '#3a4047';
    g.fillRect(0, 0, WORLD_W, WORLD_H);
    // Зерно асфальта.
    for (let i = 0; i < 2600; i++) {
      const v = 40 + Math.floor(Math.random() * 50);
      g.fillStyle = `rgba(${v + 20}, ${v + 26}, ${v + 32}, 0.5)`;
      g.fillRect(SIDEWALK + Math.random() * (WORLD_W - SIDEWALK * 2), Math.random() * WORLD_H, 2, 2);
    }
    // Прерывистая разметка.
    g.fillStyle = 'rgba(230, 230, 220, 0.5)';
    for (let y = 20; y < WORLD_H; y += 110) {
      if (y > GRATE.y - 80 && y < GRATE.y + GRATE.h + 20) continue;
      g.fillRect(WORLD_W / 2 - 4, y, 8, 56);
    }
    // Тротуары плиткой и бордюры.
    for (const x0 of [0, WORLD_W - SIDEWALK]) {
      g.fillStyle = '#9aa1a6';
      g.fillRect(x0, 0, SIDEWALK, WORLD_H);
      g.strokeStyle = 'rgba(60, 68, 74, 0.35)';
      g.lineWidth = 1.5;
      for (let y = 0; y <= WORLD_H; y += 37.5) {
        g.beginPath();
        g.moveTo(x0, y);
        g.lineTo(x0 + SIDEWALK, y);
        g.stroke();
      }
      g.beginPath();
      g.moveTo(x0 + SIDEWALK / 2, 0);
      g.lineTo(x0 + SIDEWALK / 2, WORLD_H);
      g.stroke();
    }
    g.fillStyle = '#c3c8cb';
    g.fillRect(SIDEWALK - 8, 0, 8, WORLD_H);
    g.fillRect(WORLD_W - SIDEWALK, 0, 8, WORLD_H);
    g.fillStyle = 'rgba(0, 0, 0, 0.25)';
    g.fillRect(SIDEWALK, 0, 5, WORLD_H);
    g.fillRect(WORLD_W - SIDEWALK - 5, 0, 5, WORLD_H);
    return c;
  }

  private drawGrate(ctx: CanvasRenderingContext2D): void {
    const { x, y, w, h } = GRATE;
    roundRect(ctx, x - 6, y - 6, w + 12, h + 12, 8);
    ctx.fillStyle = '#5b6168';
    ctx.fill();
    roundRect(ctx, x, y, w, h, 5);
    ctx.fillStyle = '#0d1114';
    ctx.fill();
    ctx.fillStyle = '#6b727a';
    for (let i = 1; i < 8; i++) ctx.fillRect(x + (w / 8) * i - 3, y + 4, 6, h - 8);
    ctx.fillRect(x + 4, y + h / 2 - 3, w - 8, 6);
  }

  /** Вода: по клетке на пиксель маленького холста, растянутого со сглаживанием. */
  private drawWater(ctx: CanvasRenderingContext2D): void {
    const m = this.model;
    const data = this.waterImage.data;
    for (let i = 0; i < m.water.length; i++) {
      const d = m.water[i];
      const a = d <= 0 ? 0 : Math.min(0.82, 0.12 + d * 0.16);
      // Глубже — темнее и синее.
      const deep = Math.min(1, d / 6);
      data[i * 4] = 96 - deep * 50;
      data[i * 4 + 1] = 150 - deep * 45;
      data[i * 4 + 2] = 190 - deep * 20;
      data[i * 4 + 3] = m.road[i] ? a * 255 : 0;
    }
    this.waterCtx.putImageData(this.waterImage, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(SIDEWALK, 0, WORLD_W - SIDEWALK * 2, WORLD_H);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.waterCanvas, 0, 0, COLS * CELL, ROWS * CELL);
    ctx.restore();
  }

  private drawRipples(ctx: CanvasRenderingContext2D, dt: number): void {
    const m = this.model;
    ctx.save();
    ctx.lineWidth = 1.5;
    for (const r of this.ripples) {
      r.age += dt;
      const i = Math.floor(r.y / CELL) * COLS + Math.floor(r.x / CELL);
      if ((m.water[i] ?? 0) < 0.15) continue;
      const k = r.age / 0.6;
      ctx.strokeStyle = `rgba(220, 240, 255, ${0.55 * (1 - k)})`;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, 3 + k * 14, 2 + k * 9, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    this.ripples = this.ripples.filter((r) => r.age < 0.6);
  }

  /** Воронка над решёткой: чем больше воды уходит, тем заметнее. */
  private drawVortex(ctx: CanvasRenderingContext2D): void {
    const f = this.model.drainFlow;
    if (f < 0.03) return;
    const cx = GRATE.x + GRATE.w / 2;
    const cy = GRATE.y + GRATE.h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, GRATE.h / GRATE.w + 0.2);
    ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const r = 14 + i * 13;
      const a = this.clock * (5 - i * 0.7) + i * 1.7;
      ctx.strokeStyle = `rgba(225, 242, 255, ${Math.min(0.8, f) * (0.75 - i * 0.14)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, r, a, a + 2.1);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r, a + Math.PI, a + Math.PI + 1.4);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawDebris(ctx: CanvasRenderingContext2D, d: Debris): void {
    const fade = d.collected > 0 ? Math.max(0, 1 - d.collected / 0.5) : 1;
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(d.angle);
    ctx.globalAlpha = fade;
    ctx.scale(0.6 + 0.4 * fade, 0.6 + 0.4 * fade);
    if (d.kind === 'leaf') {
      const r = d.r * 1.5;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      this.leafPath(ctx, r, 2, 3);
      ctx.fill();
      ctx.fillStyle = LEAF_COLORS[d.look];
      this.leafPath(ctx, r, 0, 0);
      ctx.fill();
      ctx.strokeStyle = 'rgba(70, 40, 10, 0.5)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-r, 0);
      ctx.lineTo(r, 0);
      ctx.stroke();
    } else if (d.kind === 'bottle') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      roundRect(ctx, -16, -5, 34, 14, 6);
      ctx.fill();
      ctx.fillStyle = BOTTLE_COLORS[d.look];
      roundRect(ctx, -18, -7, 28, 14, 6);
      ctx.fill();
      ctx.fillRect(8, -3.5, 9, 7);
      ctx.fillStyle = '#e9e9e2';
      ctx.fillRect(16, -4, 4, 8);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.fillRect(-14, -5, 20, 3);
    } else {
      // Пакет: мятый светлый комок с ручками.
      ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
      this.bagPath(ctx, d.r, 3, 4, d.look);
      ctx.fill();
      ctx.fillStyle = d.look % 2 ? 'rgba(235, 240, 245, 0.92)' : 'rgba(205, 225, 240, 0.92)';
      this.bagPath(ctx, d.r, 0, 0, d.look);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120, 140, 155, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-d.r * 0.5, -d.r * 0.2);
      ctx.lineTo(d.r * 0.2, d.r * 0.4);
      ctx.moveTo(d.r * 0.1, -d.r * 0.5);
      ctx.lineTo(d.r * 0.5, d.r * 0.1);
      ctx.stroke();
    }
    ctx.restore();
  }

  private leafPath(ctx: CanvasRenderingContext2D, r: number, ox: number, oy: number): void {
    ctx.beginPath();
    ctx.moveTo(-r + ox, oy);
    ctx.quadraticCurveTo(ox, -r * 0.75 + oy, r + ox, oy);
    ctx.quadraticCurveTo(ox, r * 0.75 + oy, -r + ox, oy);
    ctx.closePath();
  }

  private bagPath(ctx: CanvasRenderingContext2D, r: number, ox: number, oy: number, look: number): void {
    ctx.beginPath();
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const rr = r * (0.85 + 0.25 * Math.sin(a * 3 + look * 1.3));
      const x = Math.cos(a) * rr + ox;
      const y = Math.sin(a) * rr + oy;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  /** Грабли: планка с зубьями поперёк движения и черенок, уходящий назад. */
  private drawRake(ctx: CanvasRenderingContext2D): void {
    const rk = this.model.rake;
    if (!rk.down) return;
    const bx = -rk.dirY;
    const by = rk.dirX;
    ctx.save();
    ctx.lineCap = 'round';
    // Черенок.
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(rk.x + 4, rk.y + 6);
    ctx.lineTo(rk.x - rk.dirX * 260 + 4, rk.y - rk.dirY * 260 + 6);
    ctx.stroke();
    ctx.strokeStyle = '#c99a5b';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(rk.x, rk.y);
    ctx.lineTo(rk.x - rk.dirX * 260, rk.y - rk.dirY * 260);
    ctx.stroke();
    // Зубья смотрят вперёд.
    ctx.strokeStyle = '#d7dde2';
    ctx.lineWidth = 3;
    for (let i = -5; i <= 5; i++) {
      const x = rk.x + bx * (RAKE_HALF / 5) * i;
      const y = rk.y + by * (RAKE_HALF / 5) * i;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + rk.dirX * 12, y + rk.dirY * 12);
      ctx.stroke();
    }
    // Планка.
    ctx.strokeStyle = '#8b97a1';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(rk.x - bx * RAKE_HALF, rk.y - by * RAKE_HALF);
    ctx.lineTo(rk.x + bx * RAKE_HALF, rk.y + by * RAKE_HALF);
    ctx.stroke();
    ctx.restore();
  }

  private drawRain(ctx: CanvasRenderingContext2D): void {
    const heavy = Math.min(1, this.model.rain / 1.5);
    ctx.save();
    ctx.strokeStyle = `rgba(215, 232, 245, ${0.22 + heavy * 0.25})`;
    ctx.lineWidth = 1.6;
    const n = Math.floor(this.rainDrops.length * (0.4 + 0.6 * heavy));
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const d = this.rainDrops[i];
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x + d.len * 0.17, d.y - d.len);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawFloats(ctx: CanvasRenderingContext2D, dt: number): void {
    ctx.save();
    ctx.font = `800 26px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of this.floats) {
      f.age += dt;
      const k = f.age / 0.8;
      ctx.globalAlpha = Math.max(0, 1 - k);
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(29, 39, 48, 0.8)';
      ctx.strokeText(f.text, f.x, f.y - k * 40);
      ctx.fillStyle = '#ffd24a';
      ctx.fillText(f.text, f.x, f.y - k * 40);
    }
    ctx.restore();
    this.floats = this.floats.filter((f) => f.age < 0.8);
  }

  /** Шкала затопления сверху. */
  private drawFloodBar(ctx: CanvasRenderingContext2D): void {
    const f = Math.min(1, this.model.flood);
    const x = SIDEWALK + 20;
    const w = WORLD_W - SIDEWALK * 2 - 40;
    roundRect(ctx, x, 18, w, 12, 6);
    ctx.fillStyle = 'rgba(10, 14, 18, 0.55)';
    ctx.fill();
    if (f <= 0.01) return;
    const danger = f > 0.75;
    ctx.save();
    if (danger) ctx.globalAlpha = 0.65 + 0.35 * Math.sin(this.clock * 12);
    roundRect(ctx, x, 18, Math.max(12, w * f), 12, 6);
    ctx.fillStyle = danger ? '#e2553b' : f > 0.45 ? '#e8a21a' : '#5fb2e0';
    ctx.fill();
    ctx.restore();
  }

  /** Вода у бордюра: тротуары мигают красным. */
  private drawWarning(ctx: CanvasRenderingContext2D): void {
    const f = this.model.flood;
    if (f < 0.75) return;
    const a = (f - 0.75) * 1.6 * (0.5 + 0.5 * Math.sin(this.clock * 12));
    ctx.fillStyle = `rgba(226, 85, 59, ${Math.min(0.45, a)})`;
    ctx.fillRect(0, 0, SIDEWALK, WORLD_H);
    ctx.fillRect(WORLD_W - SIDEWALK, 0, SIDEWALK, WORLD_H);
  }
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const stage = new Stage(canvas, { width: WORLD_W, height: WORLD_H });
void startShell(
  {
    storageKey: 'storm-drain.v1',
    texts: TEXTS,
    create: ({ synth, ru }) => new DrainGame(stage, synth, ru),
    stageToWorld: (x, y) => stage.toWorld(x, y),
  },
  canvas,
  runLoop,
);
