import { SCALE, Synth } from '../shared/audio';
import { Game, startShell } from '../shared/shell';
import { Stage, roundRect, runLoop } from '../shared/stage';
import { CELL, COLS, Debris, DrainModel, Grate, RAKE_HALF, ROWS, SIDEWALK, WORLD_H, WORLD_W } from './drain';

const TEXTS = (ru: boolean) =>
  ru
    ? {
        title: 'Водосток',
        tagline: 'Улицу залило. Прочистите ливнёвку.',
        howTo: 'Решётки завалены листьями и мусором, вода стоит. Ведите пальцем — грабли сгребают мусор. Сметите его на тротуар и соскребите грязь: воду прорвёт, и улица высохнет.',
        play: 'За грабли',
        again: 'Ещё раз',
        resume: 'Продолжить',
        menu: 'Меню',
        paused: 'Пауза',
        gameOver: 'Улицу затопило',
        win: 'Улица сухая!',
        next: 'Дальше',
        levelWord: 'Уровень',
        score: 'Очки',
        best: 'Рекорд',
        record: 'Новый рекорд!',
        continueAd: '▶ Спустить воду за рекламу',
        soundOn: 'Звук: вкл',
        soundOff: 'Звук: выкл',
      }
    : {
        title: 'Storm Drain',
        tagline: 'The street is flooded. Unclog the drain.',
        howTo: 'The grates are buried under leaves and litter, and the water will not go. Drag to rake. Sweep the litter onto the sidewalk and scrape off the mud: the water breaks through and the street dries.',
        play: 'Grab the rake',
        again: 'Again',
        resume: 'Resume',
        menu: 'Menu',
        paused: 'Paused',
        gameOver: 'The street is flooded',
        win: 'The street is dry!',
        next: 'Next',
        levelWord: 'Level',
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
  private levelIndex = 1;
  private model = new DrainModel(1);
  private ground: HTMLCanvasElement;
  /** Брызги грязи из-под граблей. */
  private splats: { x: number; y: number; vx: number; vy: number; age: number }[] = [];
  /** Всплеск над решёткой в момент прорыва: секунды с начала, по решёткам. */
  private bursts: number[] = [];
  private everCollected = false;
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
  get won(): boolean {
    return this.model.won;
  }
  stars(): number {
    return this.model.stars();
  }
  setLevel(level: number): void {
    this.levelIndex = level;
  }
  hudExtra(): string {
    const m = this.model;
    const pct = Math.min(100, Math.round(m.flood * 100));
    const sec = Math.floor(m.time);
    return `${this.ru ? 'Вода' : 'Water'} ${pct}% · ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }
  start(): void {
    this.model = new DrainModel(this.levelIndex);
    this.ground = this.paintGround();
    this.floats = [];
    this.ripples = [];
    this.splats = [];
    this.bursts = this.model.grates.map(() => -1);
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
        this.everCollected = true;
      } else if (e.type === 'mud') {
        const a = Math.random() * Math.PI * 2;
        this.splats.push({ x: e.x, y: e.y, vx: Math.cos(a) * 60 + m.rake.dirX * 120, vy: Math.sin(a) * 60 + m.rake.dirY * 120, age: 0 });
        if (Math.random() < 0.2) this.synth.click(420, 0.06, 0.2);
      } else if (e.type === 'breakthrough') {
        // Воду прорвало: глухой «глоток» и всплеск.
        this.bursts[e.grate] = 0;
        this.synth.thud(0.45);
        this.synth.click(600, 0.3, 0.3);
      } else if (e.type === 'won') {
        [0, 2, 4, 7].forEach((k, i) => this.synth.note(SCALE[k], 0.7, 0.2, i * 0.09));
      } else if (e.type === 'flood') {
        this.synth.thud(0.6);
      }
    }
    const raining = m.level.rain > 0;
    const flow = Math.max(0, ...m.drainFlow);
    // Дождь шумит на дождливых уровнях, решётка булькает, когда вода уходит, грабли шуршат по асфальту.
    this.synth.loop('rain', raining ? 0.45 : 0, 5200, 0.5);
    this.synth.loop('gurgle', flow * 0.9, 260, 3);
    this.synth.loop('rake', m.rakeActivity * 0.8, 1800, 1.2);

    this.warnIn -= dt;
    if (raining && m.flood > 0.85 && this.warnIn <= 0) {
      this.synth.click(1500, 0.03, 0.4);
      this.warnIn = 0.5 - (m.flood - 0.85) * 2;
    }
    for (let i = 0; i < this.bursts.length; i++) if (this.bursts[i] >= 0) this.bursts[i] += dt;
    for (const p of this.splats) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.9;
      p.vy *= 0.9;
    }
    this.splats = this.splats.filter((p) => p.age < 0.5);
    if (!raining) return;

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
    for (const g of m.grates) this.drawGrate(ctx, g);
    this.drawWater(ctx);
    this.drawMud(ctx);
    this.drawRipples(ctx, dt);
    m.grates.forEach((g, i) => this.drawVortex(ctx, g, m.drainFlow[i], this.bursts[i] ?? -1));
    for (const d of m.debris) this.drawDebris(ctx, d);
    this.drawSplats(ctx);
    this.drawRake(ctx);
    if (m.level.rain > 0) this.drawRain(ctx);
    this.drawFloats(ctx, dt);
    this.drawFloodBar(ctx);
    this.drawHint(ctx);
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
      // Пропускаем штрихи, которые легли бы на решётку.
      const onGrate = this.model.grates.some((gr) => gr.x < WORLD_W / 2 + 10 && gr.x + gr.w > WORLD_W / 2 - 10 && y > gr.y - 70 && y < gr.y + gr.h + 14);
      if (onGrate) continue;
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

  private drawGrate(ctx: CanvasRenderingContext2D, grate: Grate): void {
    const { x, y, w, h } = grate;
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

  /** Грязь на решётках: бурые пятна, которые стираются под граблями. */
  private drawMud(ctx: CanvasRenderingContext2D): void {
    const m = this.model;
    for (const g of m.grates) {
      for (const i of g.cells) {
        const v = m.mud[i];
        if (v <= 0.02) continue;
        const x = (i % COLS) * CELL;
        const y = Math.floor(i / COLS) * CELL;
        ctx.fillStyle = `rgba(92, 64, 38, ${Math.min(0.95, v)})`;
        ctx.beginPath();
        ctx.ellipse(x + CELL / 2, y + CELL / 2, CELL * 0.75, CELL * 0.7, (i * 1.7) % 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawSplats(ctx: CanvasRenderingContext2D): void {
    for (const p of this.splats) {
      ctx.fillStyle = `rgba(92, 64, 38, ${0.8 * (1 - p.age / 0.5)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Подсказка на первых уровнях, пока игрок не начал. */
  private drawHint(ctx: CanvasRenderingContext2D): void {
    const m = this.model;
    let text = '';
    if (m.level.index === 1 && !this.everCollected) text = this.ru ? 'Сметите мусор с решётки на тротуар' : 'Sweep the litter off the grate onto the sidewalk';
    else if (m.level.index === 3 && m.time < 7) text = this.ru ? 'Грязь соскребайте граблями' : 'Scrape the mud off with the rake';
    else if (m.level.rain > 0 && m.time < 5) text = this.ru ? 'Идёт дождь — вода прибывает!' : 'It is raining: the water is rising!';
    if (!text) return;
    ctx.save();
    ctx.font = `700 22px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 36;
    roundRect(ctx, WORLD_W / 2 - w / 2, 52, w, 44, 14);
    ctx.fillStyle = 'rgba(16, 22, 28, 0.82)';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, WORLD_W / 2, 75);
    ctx.restore();
  }

  /** Воронка над решёткой: чем больше воды уходит, тем заметнее; в момент прорыва — всплеск. */
  private drawVortex(ctx: CanvasRenderingContext2D, grate: Grate, f: number, burst: number): void {
    const cx = grate.x + grate.w / 2;
    const cy = grate.y + grate.h / 2;
    if (burst >= 0 && burst < 0.9) {
      const k = burst / 0.9;
      ctx.save();
      ctx.strokeStyle = `rgba(225, 242, 255, ${0.9 * (1 - k)})`;
      ctx.lineWidth = 6 * (1 - k) + 1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 30 + k * 150, 20 + k * 110, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (f < 0.03) return;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, grate.h / grate.w + 0.2);
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
    const heavy = Math.min(1, this.model.level.rain / 0.075);
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
    const danger = this.model.level.rain > 0 && f > 0.85;
    ctx.save();
    if (danger) ctx.globalAlpha = 0.65 + 0.35 * Math.sin(this.clock * 12);
    roundRect(ctx, x, 18, Math.max(12, w * f), 12, 6);
    ctx.fillStyle = danger ? '#e2553b' : '#5fb2e0';
    ctx.fill();
    ctx.restore();
  }

  /** Вода у бордюра: тротуары мигают красным. */
  private drawWarning(ctx: CanvasRenderingContext2D): void {
    const f = this.model.flood;
    if (this.model.level.rain <= 0 || f < 0.85) return;
    const a = (f - 0.85) * 2.6 * (0.5 + 0.5 * Math.sin(this.clock * 12));
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
    levels: true,
    stageToWorld: (x, y) => stage.toWorld(x, y),
  },
  canvas,
  runLoop,
);
