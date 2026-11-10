import { Particle, Scraper, integrate, scrape, separate } from '../shared/particles';

/**
 * «Водосток» — логика без отрисовки.
 *
 * Вид сверху на дорогу между двумя тротуарами. Идёт дождь, вода по уклону стекает
 * к решётке ливнёвки и уходит в неё. Течение несёт листья, бутылки и пакеты к решётке,
 * и они её забивают. Игрок ведёт граблями и сгребает мусор на тротуар.
 * Если вода заливает дорогу до бордюра — игра окончена.
 *
 * Вода — сетка клеток: в каждой глубина, между соседями она перетекает туда,
 * где поверхность ниже (рельеф + глубина). Так лужа сама собирается у решётки.
 */

export const WORLD_W = 600;
export const WORLD_H = 900;
/** Ширина тротуара с каждой стороны. */
export const SIDEWALK = 75;
export const CELL = 15;
export const COLS = WORLD_W / CELL;
export const ROWS = WORLD_H / CELL;
/** Решётка ливнёвки. */
export const GRATE = { x: 240, y: 560, w: 120, h: 75 };
const GRATE_CX = GRATE.x + GRATE.w / 2;
const GRATE_CY = GRATE.y + GRATE.h / 2;

/** Уклон дороги к решётке: единиц высоты на единицу расстояния. */
const SLOPE = 0.05;
/**
 * Доля разницы уровней, которая перетекает между соседними клетками за один подшаг.
 * Больше 0,2 нельзя — расчёт становится неустойчивым, поэтому воду считаем несколько раз за кадр.
 */
const FLOW_SHARE = 0.2;
const WATER_SUBSTEPS = 4;
/** Сколько воды в секунду забирает одна клетка чистой решётки. */
const DRAIN_PER_CELL = 60;
/** Средняя глубина по дороге, при которой вода переливается через бордюр. */
export const FLOOD_DEPTH = 6;
/** Сколько «единиц засора» полностью закрывают решётку. */
const CLOG_FULL = 20;
/** Даже забитая решётка чуть-чуть пропускает. */
const MIN_OPEN = 0.04;

export type DebrisKind = 'leaf' | 'bottle' | 'bag';

interface KindSpec {
  r: number;
  /** Сколько засора даёт на решётке. */
  block: number;
  /** Насколько охотно плывёт по течению. */
  float: number;
  points: number;
}

export const KINDS: Record<DebrisKind, KindSpec> = {
  leaf: { r: 9, block: 1, float: 1, points: 1 },
  bottle: { r: 12, block: 2.5, float: 0.7, points: 3 },
  bag: { r: 19, block: 7, float: 0.85, points: 5 },
};

export interface Debris extends Particle {
  id: number;
  kind: DebrisKind;
  angle: number;
  /** Вариант цвета/формы для отрисовки. */
  look: number;
  /** >0 — уже на тротуаре и исчезает; секунды с момента сбора. */
  collected: number;
}

export interface Rake {
  x: number;
  y: number;
  vx: number;
  vy: number;
  down: boolean;
  /** Направление движения (единичный вектор): грабли стоят поперёк него. */
  dirX: number;
  dirY: number;
}

export type DrainEvent =
  | { type: 'collect'; kind: DebrisKind; x: number; y: number; points: number }
  | { type: 'spawn'; kind: DebrisKind }
  | { type: 'flood' };

/** Полуширина граблей и шаг, которым они проходят путь за кадр (чтобы не проскочить мусор). */
export const RAKE_HALF = 40;
const RAKE_R = 6;
const RAKE_STEP = 6;
const COLLECT_FADE = 0.5;
const MAX_DEBRIS = 230;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function difficulty(seconds: number): number {
  return 1 - Math.exp(-seconds / 100);
}

export class DrainModel {
  /** Глубина воды по клеткам. На тротуарах воды нет. */
  readonly water = new Float32Array(COLS * ROWS);
  /** Высота дороги: растёт с расстоянием от решётки. */
  readonly terrain = new Float32Array(COLS * ROWS);
  /** Клетка — дорога (а не тротуар). */
  readonly road = new Uint8Array(COLS * ROWS);
  readonly grateCells: number[] = [];
  private readonly roadCells: number;

  debris: Debris[] = [];
  rake: Rake = { x: 300, y: 300, vx: 0, vy: 0, down: false, dirX: 0, dirY: -1 };
  private rakeTargetX = 300;
  private rakeTargetY = 300;
  time = 0;
  points = 0;
  /** Сколько воды уходит в решётку прямо сейчас (для воронки и звука), 0..1. */
  drainFlow = 0;
  /** Насколько грабли сейчас сгребают (для звука), 0..1. */
  rakeActivity = 0;
  flooded = false;
  private spawnIn = 0.5;
  private ids = 0;
  events: DrainEvent[] = [];

  constructor(private readonly rng: () => number = Math.random) {
    let roads = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        const x = (c + 0.5) * CELL;
        const y = (r + 0.5) * CELL;
        const isRoad = x > SIDEWALK && x < WORLD_W - SIDEWALK;
        this.road[i] = isRoad ? 1 : 0;
        if (isRoad) roads++;
        this.terrain[i] = Math.hypot(x - GRATE_CX, y - GRATE_CY) * SLOPE;
        if (isRoad && x > GRATE.x && x < GRATE.x + GRATE.w && y > GRATE.y && y < GRATE.y + GRATE.h) this.grateCells.push(i);
      }
    }
    this.roadCells = roads;
    // Немного мусора с самого начала, чтобы было что делать.
    for (let i = 0; i < 14; i++) this.spawn('leaf');
  }

  get score(): number {
    return this.points;
  }

  get over(): boolean {
    return this.flooded;
  }

  /** Доля затопления: 0 — сухо, 1 — вода у бордюра. */
  get flood(): number {
    let sum = 0;
    for (let i = 0; i < this.water.length; i++) sum += this.water[i];
    return sum / (this.roadCells * FLOOD_DEPTH);
  }

  /** Сила дождя сейчас: глубины в секунду на клетку. */
  get rain(): number {
    const d = difficulty(this.time);
    // Дождь идёт волнами: то стихает, то усиливается.
    const wave = 0.75 + 0.25 * Math.sin(this.time * 0.35);
    return lerp(0.55, 1.5, d) * wave;
  }

  /** Насколько решётка свободна: 1 — чистая, MIN_OPEN — забита. */
  get open(): number {
    let block = 0;
    for (const d of this.debris) {
      if (d.collected > 0) continue;
      if (d.x > GRATE.x - d.r * 0.5 && d.x < GRATE.x + GRATE.w + d.r * 0.5 && d.y > GRATE.y - d.r * 0.5 && d.y < GRATE.y + GRATE.h + d.r * 0.5) {
        block += KINDS[d.kind].block;
      }
    }
    return Math.max(MIN_OPEN, 1 - block / CLOG_FULL);
  }

  // ——— управление ———

  rakeDown(x: number, y: number): void {
    this.rakeTargetX = this.rake.x = x;
    this.rakeTargetY = this.rake.y = y;
    this.rake.vx = this.rake.vy = 0;
    this.rake.down = true;
  }

  rakeMove(x: number, y: number): void {
    this.rakeTargetX = x;
    this.rakeTargetY = y;
  }

  rakeUp(): void {
    this.rake.down = false;
    this.rakeActivity = 0;
  }

  /** Продолжить после потопа: половина воды уходит, решётка расчищена. */
  revive(): void {
    for (let i = 0; i < this.water.length; i++) this.water[i] *= 0.4;
    this.debris = this.debris.filter((d) => !(d.x > GRATE.x - 30 && d.x < GRATE.x + GRATE.w + 30 && d.y > GRATE.y - 30 && d.y < GRATE.y + GRATE.h + 30));
    this.flooded = false;
  }

  // ——— шаг ———

  update(dt: number): void {
    if (this.flooded) return;
    this.time += dt;
    this.stepWater(dt);
    this.stepRake(dt);
    this.stepDebris(dt);
    this.stepSpawn(dt);
    if (this.flood >= 1) {
      this.flooded = true;
      this.rake.down = false;
      this.events.push({ type: 'flood' });
    }
  }

  private stepWater(dt: number): void {
    const w = this.water;
    const t = this.terrain;
    const rain = this.rain * dt;
    for (let i = 0; i < w.length; i++) if (this.road[i]) w[i] += rain;

    // Решётка забирает воду; засор уменьшает пропускную способность.
    const open = this.open;
    const cap = (DRAIN_PER_CELL * open * dt) / WATER_SUBSTEPS;
    let drained = 0;
    for (let step = 0; step < WATER_SUBSTEPS; step++) {
      // Перетекание между соседями: от высокой поверхности к низкой, не больше четверти запаса клетки.
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const i = r * COLS + c;
          if (!this.road[i]) continue;
          if (c + 1 < COLS && this.road[i + 1]) this.exchange(i, i + 1, FLOW_SHARE, w, t);
          if (r + 1 < ROWS) this.exchange(i, i + COLS, FLOW_SHARE, w, t);
        }
      }
      for (const i of this.grateCells) {
        const take = Math.min(w[i], cap);
        w[i] -= take;
        drained += take;
      }
    }
    const full = DRAIN_PER_CELL * dt * this.grateCells.length;
    const target = full > 0 ? Math.min(1, (drained / full) * 6) : 0;
    this.drainFlow += (target - this.drainFlow) * Math.min(1, dt * 6);
  }

  private exchange(a: number, b: number, k: number, w: Float32Array, t: Float32Array): void {
    const dh = t[a] + w[a] - (t[b] + w[b]);
    if (dh > 0) {
      const f = Math.min(dh * k, w[a] * 0.25);
      w[a] -= f;
      w[b] += f;
    } else if (dh < 0) {
      const f = Math.min(-dh * k, w[b] * 0.25);
      w[b] -= f;
      w[a] += f;
    }
  }

  /** Куда течёт вода в точке: против градиента поверхности. Нулевой вектор на сухом. */
  flowAt(x: number, y: number): { x: number; y: number } {
    const c = Math.floor(x / CELL);
    const r = Math.floor(y / CELL);
    if (c < 1 || c >= COLS - 1 || r < 1 || r >= ROWS - 1) return { x: 0, y: 0 };
    const i = r * COLS + c;
    if (!this.road[i] || this.water[i] < 0.03) return { x: 0, y: 0 };
    const h = (j: number) => (this.road[j] ? this.terrain[j] + this.water[j] : this.terrain[i] + this.water[i]);
    return { x: (h(i - 1) - h(i + 1)) / 2, y: (h(i - COLS) - h(i + COLS)) / 2 };
  }

  private stepRake(dt: number): void {
    const rk = this.rake;
    if (!rk.down) return;
    const px = rk.x;
    const py = rk.y;
    const mx = this.rakeTargetX - px;
    const my = this.rakeTargetY - py;
    const dist = Math.hypot(mx, my);
    rk.vx = dt > 0 ? mx / dt : 0;
    rk.vy = dt > 0 ? my / dt : 0;
    let contacts = 0;
    if (dist > 0.5) {
      // Грабли стоят поперёк движения; разворот плавный, кроме самого начала мазка.
      const k = Math.min(1, dist / 20);
      const cur = Math.atan2(rk.dirY, rk.dirX);
      let diff = Math.atan2(my, mx) - cur;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const a = cur + diff * k;
      rk.dirX = Math.cos(a);
      rk.dirY = Math.sin(a);
      const live = this.debris.filter((d) => d.collected === 0);
      const steps = Math.min(14, Math.max(1, Math.ceil(dist / RAKE_STEP)));
      for (let s = 1; s <= steps; s++) {
        const x = px + (mx * s) / steps;
        const y = py + (my * s) / steps;
        contacts += scrape(live, this.rakeSegment(x, y));
        separate(live);
      }
    }
    rk.x = this.rakeTargetX;
    rk.y = this.rakeTargetY;
    const speed = Math.hypot(rk.vx, rk.vy);
    const target = Math.min(1, contacts / 6) * Math.min(1, speed / 350);
    this.rakeActivity += (target - this.rakeActivity) * Math.min(1, dt * 12);
  }

  /** Отрезок граблей в точке (x, y): поперёк направления движения. */
  rakeSegment(x: number, y: number): Scraper {
    const rk = this.rake;
    const bx = -rk.dirY;
    const by = rk.dirX;
    return { x1: x - bx * RAKE_HALF, y1: y - by * RAKE_HALF, x2: x + bx * RAKE_HALF, y2: y + by * RAKE_HALF, r: RAKE_R, vx: rk.vx, vy: rk.vy };
  }

  private stepDebris(dt: number): void {
    const live = this.debris.filter((d) => d.collected === 0);
    for (const d of live) {
      // Течение несёт мусор к решётке; сам по себе на сухом асфальте он лежит.
      const f = this.flowAt(d.x, d.y);
      const fl = Math.hypot(f.x, f.y);
      if (fl > 0) {
        // В тонкой плёнке воды мусор еле ползёт, в глубокой луже плывёт быстро.
        const depth = this.water[Math.floor(d.y / CELL) * COLS + Math.floor(d.x / CELL)] ?? 0;
        const speed = Math.min(120, fl * 90 * Math.min(2, 0.5 + depth)) * KINDS[d.kind].float;
        const tx = (f.x / fl) * speed;
        const ty = (f.y / fl) * speed;
        const k = Math.min(1, 2.5 * dt);
        d.vx += (tx - d.vx) * k;
        d.vy += (ty - d.vy) * k;
        d.angle += fl * dt * 3;
      }
    }
    integrate(live, dt, 6, { minX: 0, minY: 0, maxX: WORLD_W, maxY: WORLD_H });
    separate(live);

    // Мусор, сдвинутый на тротуар, собран.
    for (const d of this.debris) {
      if (d.collected > 0) {
        d.collected += dt;
        continue;
      }
      if (d.x < SIDEWALK - d.r * 0.3 || d.x > WORLD_W - SIDEWALK + d.r * 0.3) {
        d.collected = 1e-6;
        d.vx = d.vy = 0;
        const pts = KINDS[d.kind].points;
        this.points += pts;
        this.events.push({ type: 'collect', kind: d.kind, x: d.x, y: d.y, points: pts });
      }
    }
    this.debris = this.debris.filter((d) => d.collected < COLLECT_FADE);
  }

  private stepSpawn(dt: number): void {
    this.spawnIn -= dt;
    if (this.spawnIn > 0) return;
    const d = difficulty(this.time);
    // Мусора всё больше: сначала по кривой сложности, дальше — без потолка, чтобы партия не была вечной.
    this.spawnIn = (lerp(2.4, 0.8, d) / (1 + this.time / 300)) * lerp(0.6, 1.4, this.rng());
    if (this.debris.length >= MAX_DEBRIS) return;
    const r = this.rng();
    const kind: DebrisKind = r < lerp(0.9, 0.72, d) ? 'leaf' : r < lerp(0.97, 0.9, d) ? 'bottle' : 'bag';
    // Листья падают горстью.
    const n = kind === 'leaf' ? 1 + Math.floor(this.rng() * lerp(2, 4, d)) : 1;
    for (let i = 0; i < n; i++) this.spawn(kind);
    this.events.push({ type: 'spawn', kind });
  }

  private spawn(kind: DebrisKind): void {
    const spec = KINDS[kind];
    // Где угодно на дороге, но не прямо на решётке.
    for (let tries = 0; tries < 8; tries++) {
      const x = lerp(SIDEWALK + spec.r, WORLD_W - SIDEWALK - spec.r, this.rng());
      const y = lerp(spec.r, WORLD_H - spec.r, this.rng());
      if (Math.hypot(x - GRATE_CX, y - GRATE_CY) < 150) continue;
      this.debris.push({ id: ++this.ids, kind, x, y, vx: 0, vy: 0, r: spec.r, angle: this.rng() * Math.PI * 2, look: Math.floor(this.rng() * 4), collected: 0 });
      return;
    }
  }

  drainEvents(): DrainEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}
