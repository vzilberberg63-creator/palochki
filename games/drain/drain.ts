import { Particle, Scraper, integrate, scrape, separate } from '../shared/particles';

/**
 * «Водосток» — логика без отрисовки.
 *
 * Уровень начинается с затопленной улицы: решётки ливнёвки завалены листьями, бутылками,
 * пакетами и затянуты грязью. Игрок граблями сгребает мусор на тротуар и соскребает грязь.
 * Решётка открывается — воду прорывает, и улица высыхает. Это победа; звёзды — за время.
 * Течение тянет оставшийся мусор обратно к решётке, поэтому сметать его надо до тротуара.
 * На поздних уровнях идёт дождь: если вода дойдёт до бордюра, уровень проигран.
 *
 * Вода — сетка клеток: в каждой глубина, между соседями она перетекает туда,
 * где поверхность ниже (уклон дороги + глубина).
 */

export const WORLD_W = 600;
export const WORLD_H = 900;
/** Ширина тротуара с каждой стороны. */
export const SIDEWALK = 75;
export const CELL = 15;
export const COLS = WORLD_W / CELL;
export const ROWS = WORLD_H / CELL;
export const GRATE_W = 120;
export const GRATE_H = 75;

/** Уклон дороги к ближайшей решётке: единиц высоты на единицу расстояния. */
const SLOPE = 0.05;
/**
 * Доля разницы уровней, которая перетекает между соседними клетками за один подшаг.
 * Больше 0,2 нельзя — расчёт становится неустойчивым, поэтому воду считаем несколько раз за кадр.
 */
const FLOW_SHARE = 0.2;
const WATER_SUBSTEPS = 4;
/**
 * Сколько воды в секунду забирает одна клетка чистой решётки. Подобрано так, чтобы залитая улица
 * уходила через одну открытую решётку секунд за 10–15: момент, ради которого игра, должен длиться.
 */
const DRAIN_PER_CELL = 16;
/** Средняя глубина по дороге, при которой вода переливается через бордюр. */
export const FLOOD_DEPTH = 6;
/** Сколько «единиц засора» полностью закрывают одну решётку (лист — 1, пакет — 7). */
const CLOG_FULL = 10;
/** Забитая решётка не пропускает совсем: сам по себе уровень не пройдётся. */
const MIN_OPEN = 0;
/** Насколько сплошной слой грязи закрывает решётку. */
const MUD_BLOCK = 0.9;
/** Сколько грязи снимает один проход граблей над клеткой (в секунду контакта). */
const MUD_SCRAPE = 3.2;
/** Тяга стока: скорость мусора = SINK_PULL × поток решётки / расстояние, не быстрее SINK_MAX_SPEED. */
const SINK_PULL = 9000;
const SINK_MAX_SPEED = 130;
/** Улица считается сухой ниже этой доли затопления. */
export const DRY_LEVEL = 0.03;

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

export interface Grate {
  x: number;
  y: number;
  w: number;
  h: number;
  cells: number[];
}

export interface LevelSpec {
  index: number;
  /** Центры решёток. */
  grates: { x: number; y: number }[];
  /** Сколько воды в начале: доля от уровня бордюра. */
  startFlood: number;
  /** Дождь во время уровня: глубины в секунду на клетку, 0 — сухо. */
  rain: number;
  /** Мусор в куче на каждой решётке. */
  pile: Record<DebrisKind, number>;
  /** Мусор, плавающий по улице. */
  scattered: number;
  /** Слой грязи на решётках, 0..1. */
  mud: number;
  /** Время на три звезды, с. */
  par: number;
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
  | { type: 'mud'; x: number; y: number }
  /** Решётку прорвало: она открылась больше чем наполовину. */
  | { type: 'breakthrough'; grate: number }
  | { type: 'won'; stars: number }
  | { type: 'flood' };

/** Полуширина граблей и шаг, которым они проходят путь за кадр (чтобы не проскочить мусор). */
export const RAKE_HALF = 40;
const RAKE_R = 6;
const RAKE_STEP = 6;
const COLLECT_FADE = 0.5;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function difficulty(level: number): number {
  return 1 - Math.exp(-(Math.max(1, level) - 1) / 10);
}

const GRATE_LAYOUTS: { x: number; y: number }[][] = [
  [{ x: 300, y: 560 }],
  [
    { x: 215, y: 330 },
    { x: 385, y: 640 },
  ],
  [
    { x: 300, y: 220 },
    { x: 200, y: 520 },
    { x: 400, y: 740 },
  ],
];

/** Уровни: первые три — обучение, дальше по кривой сложности. */
export function makeLevel(index: number): LevelSpec {
  if (!Number.isInteger(index) || index < 1) throw new Error(`bad level: ${index}`);
  const d = difficulty(index);
  const grateCount = index >= 9 ? 3 : index >= 4 ? 2 : 1;
  const leaves = Math.round(lerp(16, 34, d));
  const bottles = index >= 2 ? Math.round(lerp(2, 7, d)) : 0;
  const bags = index >= 3 ? Math.round(lerp(1, 4, d)) : 0;
  const mud = index >= 3 ? lerp(0.5, 1, d) : 0;
  const scattered = Math.round(lerp(6, 26, d));
  // Дождь — медленное давление: от старта до бордюра примерно 45 с на 6-м уровне и 25 с на поздних.
  const rain = index >= 6 ? lerp(0.03, 0.075, d) : 0;
  const total = (leaves + bottles + bags) * grateCount + scattered;
  return {
    index,
    grates: GRATE_LAYOUTS[grateCount - 1],
    startFlood: lerp(0.62, 0.8, d),
    rain,
    pile: { leaf: leaves, bottle: bottles, bag: bags },
    scattered,
    mud,
    // Время на три звезды: разгрести мусор, соскрести грязь и дождаться, пока вода уйдёт.
    // Подобрано по замерам бота с паузами между мазками: ему хватает с небольшим запасом.
    par: Math.round(0.72 * (14 + total * 0.38 + mud * grateCount * 5)),
  };
}

export class DrainModel {
  readonly level: LevelSpec;
  /** Глубина воды по клеткам. На тротуарах воды нет. */
  readonly water = new Float32Array(COLS * ROWS);
  /** Высота дороги: растёт с расстоянием от ближайшей решётки. */
  readonly terrain = new Float32Array(COLS * ROWS);
  /** Клетка — дорога (а не тротуар). */
  readonly road = new Uint8Array(COLS * ROWS);
  /** Грязь по клеткам (только на решётках), 0..1. */
  readonly mud = new Float32Array(COLS * ROWS);
  readonly grates: Grate[];
  private readonly roadCells: number;
  private readonly broken: boolean[];

  debris: Debris[] = [];
  rake: Rake = { x: 300, y: 300, vx: 0, vy: 0, down: false, dirX: 0, dirY: -1 };
  private rakeTargetX = 300;
  private rakeTargetY = 300;
  time = 0;
  points = 0;
  /** Сколько воды уходит в каждую решётку прямо сейчас (для воронки и звука), 0..1. */
  drainFlow: number[];
  /** Насколько грабли сейчас сгребают (для звука), 0..1. */
  rakeActivity = 0;
  flooded = false;
  won = false;
  private dryFor = 0;
  private spawnIn = 2;
  private ids = 0;
  events: DrainEvent[] = [];

  constructor(
    level: LevelSpec | number = 1,
    private readonly rng: () => number = Math.random,
  ) {
    this.level = typeof level === 'number' ? makeLevel(level) : level;
    this.grates = this.level.grates.map((g) => ({ x: g.x - GRATE_W / 2, y: g.y - GRATE_H / 2, w: GRATE_W, h: GRATE_H, cells: [] }));
    this.drainFlow = this.grates.map(() => 0);
    this.broken = this.grates.map(() => false);

    let roads = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        const x = (c + 0.5) * CELL;
        const y = (r + 0.5) * CELL;
        const isRoad = x > SIDEWALK && x < WORLD_W - SIDEWALK;
        this.road[i] = isRoad ? 1 : 0;
        if (isRoad) roads++;
        let dist = Infinity;
        for (const g of this.level.grates) dist = Math.min(dist, Math.hypot(x - g.x, y - g.y));
        this.terrain[i] = dist * SLOPE;
        if (!isRoad) continue;
        for (const g of this.grates) {
          if (x > g.x && x < g.x + g.w && y > g.y && y < g.y + g.h) {
            g.cells.push(i);
            this.mud[i] = this.level.mud;
          }
        }
      }
    }
    this.roadCells = roads;
    this.fillWater(this.level.startFlood);
    this.spawnPiles();
  }

  get score(): number {
    return this.points;
  }

  /** Уровень проигран: воду подняло до бордюра. */
  get over(): boolean {
    return this.flooded;
  }

  /** Доля затопления: 0 — сухо, 1 — вода у бордюра. */
  get flood(): number {
    let sum = 0;
    for (let i = 0; i < this.water.length; i++) sum += this.water[i];
    return sum / (this.roadCells * FLOOD_DEPTH);
  }

  /** Насколько решётка свободна: 1 — чистая, MIN_OPEN — забита мусором и грязью. */
  open(index: number): number {
    const g = this.grates[index];
    let block = 0;
    for (const d of this.debris) {
      if (d.collected > 0) continue;
      if (d.x > g.x - d.r * 0.5 && d.x < g.x + g.w + d.r * 0.5 && d.y > g.y - d.r * 0.5 && d.y < g.y + g.h + d.r * 0.5) {
        block += KINDS[d.kind].block;
      }
    }
    let mud = 0;
    for (const i of g.cells) mud += this.mud[i];
    mud /= g.cells.length;
    return Math.max(MIN_OPEN, 1 - block / CLOG_FULL - mud * MUD_BLOCK);
  }

  /** Средняя открытость всех решёток. */
  get openAll(): number {
    let s = 0;
    for (let i = 0; i < this.grates.length; i++) s += this.open(i);
    return s / this.grates.length;
  }

  /** Звёзды за пройденный уровень по времени. */
  stars(): number {
    if (!this.won) return 0;
    const par = this.level.par;
    return this.time <= par ? 3 : this.time <= par * 1.6 ? 2 : 1;
  }

  // ——— управление ———

  rakeDown(x: number, y: number): void {
    if (this.won || this.flooded) return;
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

  /** Продолжить после потопа: большая часть воды уходит. */
  revive(): void {
    for (let i = 0; i < this.water.length; i++) this.water[i] *= 0.45;
    this.flooded = false;
  }

  // ——— шаг ———

  update(dt: number): void {
    if (this.flooded || this.won) return;
    this.time += dt;
    this.stepWater(dt);
    this.stepRake(dt);
    this.stepDebris(dt);
    this.stepRainDebris(dt);

    for (let i = 0; i < this.grates.length; i++) {
      if (!this.broken[i] && this.open(i) > 0.5) {
        this.broken[i] = true;
        this.events.push({ type: 'breakthrough', grate: i });
      }
    }

    const flood = this.flood;
    if (flood >= 1) {
      this.flooded = true;
      this.rake.down = false;
      this.events.push({ type: 'flood' });
      return;
    }
    // Победа: вода ушла и держится сухо полсекунды (чтобы не засчитать случайный всплеск).
    this.dryFor = flood < DRY_LEVEL ? this.dryFor + dt : 0;
    if (this.dryFor >= 0.5) {
      this.won = true;
      this.rake.down = false;
      this.rakeActivity = 0;
      this.events.push({ type: 'won', stars: this.stars() });
    }
  }

  /** Заливает дорогу «по уровню»: глубже у решёток, как настоящая лужа в низине. */
  private fillWater(flood: number): void {
    const target = flood * this.roadCells * FLOOD_DEPTH;
    let lo = 0;
    let hi = 100;
    for (let it = 0; it < 40; it++) {
      const level = (lo + hi) / 2;
      let sum = 0;
      for (let i = 0; i < this.water.length; i++) if (this.road[i]) sum += Math.max(0, level - this.terrain[i]);
      if (sum < target) lo = level;
      else hi = level;
    }
    for (let i = 0; i < this.water.length; i++) this.water[i] = this.road[i] ? Math.max(0, hi - this.terrain[i]) : 0;
  }

  private spawnPiles(): void {
    const L = this.level;
    for (const g of L.grates) {
      for (const kind of ['bag', 'bottle', 'leaf'] as const) {
        for (let i = 0; i < L.pile[kind]; i++) {
          // Куча плотная в центре решётки и редеет к краям.
          const a = this.rng() * Math.PI * 2;
          const dist = Math.sqrt(this.rng());
          this.add(kind, g.x + Math.cos(a) * dist * GRATE_W * 0.55, g.y + Math.sin(a) * dist * GRATE_H * 0.6);
        }
      }
    }
    for (let i = 0; i < L.scattered; i++) {
      const kind: DebrisKind = this.rng() < 0.85 ? 'leaf' : 'bottle';
      this.add(kind, lerp(SIDEWALK + 15, WORLD_W - SIDEWALK - 15, this.rng()), lerp(15, WORLD_H - 15, this.rng()));
    }
    // Расталкиваем кучи, чтобы мусор не лежал друг в друге.
    for (let i = 0; i < 30; i++) separate(this.debris);
    for (const d of this.debris) d.x = Math.max(SIDEWALK + d.r, Math.min(WORLD_W - SIDEWALK - d.r, d.x));
  }

  private add(kind: DebrisKind, x: number, y: number): void {
    this.debris.push({ id: ++this.ids, kind, x, y, vx: 0, vy: 0, r: KINDS[kind].r, angle: this.rng() * Math.PI * 2, look: Math.floor(this.rng() * 4), collected: 0 });
  }

  private stepWater(dt: number): void {
    const w = this.water;
    const t = this.terrain;
    const rain = this.level.rain * dt;
    if (rain > 0) for (let i = 0; i < w.length; i++) if (this.road[i]) w[i] += rain;

    const opens = this.grates.map((_, i) => this.open(i));
    const drained = this.grates.map(() => 0);
    for (let step = 0; step < WATER_SUBSTEPS; step++) {
      // Перетекание между соседями: от высокой поверхности к низкой, не больше четверти запаса клетки.
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const i = r * COLS + c;
          if (!this.road[i]) continue;
          if (c + 1 < COLS && this.road[i + 1]) this.exchange(i, i + 1, w, t);
          if (r + 1 < ROWS) this.exchange(i, i + COLS, w, t);
        }
      }
      // Решётки забирают воду; засор уменьшает пропускную способность.
      this.grates.forEach((g, gi) => {
        const cap = (DRAIN_PER_CELL * opens[gi] * dt) / WATER_SUBSTEPS;
        for (const i of g.cells) {
          const take = Math.min(w[i], cap);
          w[i] -= take;
          drained[gi] += take;
        }
      });
    }
    this.grates.forEach((g, gi) => {
      const full = DRAIN_PER_CELL * dt * g.cells.length;
      const target = full > 0 ? Math.min(1, (drained[gi] / full) * 5) : 0;
      this.drainFlow[gi] += (target - this.drainFlow[gi]) * Math.min(1, dt * 6);
    });
  }

  private exchange(a: number, b: number, w: Float32Array, t: Float32Array): void {
    const dh = t[a] + w[a] - (t[b] + w[b]);
    if (dh > 0) {
      const f = Math.min(dh * FLOW_SHARE, w[a] * 0.25);
      w[a] -= f;
      w[b] += f;
    } else if (dh < 0) {
      const f = Math.min(-dh * FLOW_SHARE, w[b] * 0.25);
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
      // Грабли стоят поперёк движения и плавно разворачиваются за ним.
      const cur = Math.atan2(rk.dirY, rk.dirX);
      let diff = Math.atan2(my, mx) - cur;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const a = cur + diff * Math.min(1, dist / 20);
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
      contacts += this.scrapeMud(dt);
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

  /** Грабли в движении соскребают грязь с клеток под собой. Возвращает число задетых клеток. */
  private scrapeMud(dt: number): number {
    const rk = this.rake;
    const seg = this.rakeSegment(this.rakeTargetX, this.rakeTargetY);
    const sx = seg.x2 - seg.x1;
    const sy = seg.y2 - seg.y1;
    const len2 = sx * sx + sy * sy;
    let touched = 0;
    for (const g of this.grates) {
      for (const i of g.cells) {
        if (this.mud[i] <= 0) continue;
        const x = ((i % COLS) + 0.5) * CELL;
        const y = (Math.floor(i / COLS) + 0.5) * CELL;
        let t = ((x - seg.x1) * sx + (y - seg.y1) * sy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        if (Math.hypot(x - (seg.x1 + sx * t), y - (seg.y1 + sy * t)) > CELL) continue;
        const before = this.mud[i];
        this.mud[i] = Math.max(0, before - MUD_SCRAPE * dt);
        touched++;
        if (before > 0.05 && this.rng() < 0.25) this.events.push({ type: 'mud', x: x + rk.dirX * 10, y: y + rk.dirY * 10 });
      }
    }
    return touched;
  }

  private stepDebris(dt: number): void {
    const live = this.debris.filter((d) => d.collected === 0);
    for (const d of live) {
      // Течение несёт мусор к решётке; на сухом асфальте он лежит.
      const f = this.flowAt(d.x, d.y);
      const fl = Math.hypot(f.x, f.y);
      const depth = this.water[Math.floor(d.y / CELL) * COLS + Math.floor(d.x / CELL)] ?? 0;
      if (depth < 0.03) continue;
      let tx = 0;
      let ty = 0;
      if (fl > 0) {
        // Сток по уклону: в тонкой плёнке воды мусор еле ползёт, в глубокой луже плывёт быстро.
        const speed = Math.min(120, fl * 90 * Math.min(2, 0.5 + depth));
        tx += (f.x / fl) * speed;
        ty += (f.y / fl) * speed;
      }
      // Тяга стока: открытая решётка втягивает воду, и чем ближе к ней, тем сильнее течение.
      // В глубокой луже поверхность почти ровная, поэтому одного уклона для этого мало.
      this.grates.forEach((g, gi) => {
        const pull = this.drainFlow[gi];
        if (pull < 0.02) return;
        const dx = g.x + g.w / 2 - d.x;
        const dy = g.y + g.h / 2 - d.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 1) return;
        const speed = Math.min(SINK_MAX_SPEED, (SINK_PULL * pull) / Math.max(40, dist));
        tx += (dx / dist) * speed;
        ty += (dy / dist) * speed;
      });
      const tl = Math.hypot(tx, ty);
      if (tl > 0) {
        const cap = Math.min(1, SINK_MAX_SPEED / tl) * KINDS[d.kind].float;
        const k = Math.min(1, 2.5 * dt);
        d.vx += (tx * cap - d.vx) * k;
        d.vy += (ty * cap - d.vy) * k;
        d.angle += Math.min(3, tl / 40) * dt;
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

  /** В дождь ветер подбрасывает новые листья. */
  private stepRainDebris(dt: number): void {
    if (this.level.rain <= 0) return;
    this.spawnIn -= dt;
    if (this.spawnIn > 0) return;
    this.spawnIn = lerp(3.5, 1.6, difficulty(this.level.index)) * lerp(0.6, 1.4, this.rng());
    this.add('leaf', lerp(SIDEWALK + 15, WORLD_W - SIDEWALK - 15, this.rng()), lerp(15, WORLD_H - 15, this.rng()));
  }

  drainEvents(): DrainEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}
