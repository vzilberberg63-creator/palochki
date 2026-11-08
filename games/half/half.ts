/**
 * «Ровно пополам» — логика без отрисовки.
 *
 * На доске лежит еда неровной формы. Один взмах — один разрез по прямой.
 * Надо отрезать заданную долю: половину, треть или четверть. Площадь считается честно,
 * дырки в сыре её уменьшают. Ошибка больше 6% или не успел — минус жизнь.
 */

export const WORLD_W = 600;
export const WORLD_H = 900;
export const CENTER = { x: 300, y: 450 };
export const START_LIVES = 3;
/** Шаг сетки, по которой считается площадь: ~6000 точек на форму, ошибка оценки < 0,2%. */
const SAMPLE_STEP = 4;
/** Короче этого взмах не считается разрезом. */
export const MIN_SWIPE = 60;

export type FoodStyle = 'cheese' | 'cake' | 'bread' | 'pizza';
export type Grade = 'perfect' | 'great' | 'ok' | 'miss' | 'timeout';

export interface Hole {
  x: number;
  y: number;
  r: number;
}

export interface Food {
  style: FoodStyle;
  /** Контур в локальных координатах (центр в 0,0). */
  outline: { x: number; y: number }[];
  holes: Hole[];
  /** Какую долю отрезать: 1/2, 1/3 или 1/4. */
  target: number;
  /** Скорость вращения, рад/с. */
  spin: number;
  /** Секунд на разрез. */
  time: number;
}

export interface Cut {
  /** Точка и направление разреза в локальных координатах еды. */
  px: number;
  py: number;
  dx: number;
  dy: number;
  /** Доля по «положительную» сторону и доля меньшего куска. */
  fraction: number;
  small: number;
  /** Ошибка в процентных пунктах. */
  error: number;
  grade: Grade;
  points: number;
}

export type HalfEvent = { type: 'cut'; cut: Cut } | { type: 'timeout' } | { type: 'invalid' };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function difficulty(n: number): number {
  return 1 - Math.exp(-n / 16);
}

/** Неровный контур: окружность с наложенными гармониками, неровность растёт со сложностью. */
export function makeFood(n: number, rng: () => number): Food {
  const d = difficulty(n);
  const styles: FoodStyle[] = n < 2 ? ['cake'] : ['cheese', 'cake', 'bread', 'pizza'];
  const style = styles[Math.floor(rng() * styles.length)];
  const R = lerp(170, 150, d);
  const harmonics = Array.from({ length: 4 }, (_, i) => ({
    k: i + 2,
    a: (rng() * 2 - 1) * lerp(0.05, 0.2, d) / (i + 1),
    p: rng() * Math.PI * 2,
  }));
  // Хлеб вытянут, пицца круглее.
  const sx = style === 'bread' ? 1.35 : 1;
  const sy = style === 'bread' ? 0.7 : 1;
  const outline = Array.from({ length: 72 }, (_, i) => {
    const t = (i / 72) * Math.PI * 2;
    const r = R * (1 + harmonics.reduce((s, h) => s + h.a * Math.sin(h.k * t + h.p), 0));
    return { x: Math.cos(t) * r * sx, y: Math.sin(t) * r * sy };
  });

  const holes: Hole[] = [];
  if (style === 'cheese') {
    const count = 2 + Math.floor(rng() * (2 + d * 4));
    for (let i = 0; i < count * 4 && holes.length < count; i++) {
      const a = rng() * Math.PI * 2;
      const dist = rng() * R * 0.6;
      const h = { x: Math.cos(a) * dist, y: Math.sin(a) * dist, r: lerp(14, 34, rng()) };
      if (holes.every((o) => Math.hypot(o.x - h.x, o.y - h.y) > o.r + h.r + 8)) holes.push(h);
    }
  }

  const targets = n < 5 ? [0.5] : n < 12 ? [0.5, 0.5, 1 / 3] : [0.5, 1 / 3, 1 / 4];
  return {
    style,
    outline,
    holes,
    target: targets[Math.floor(rng() * targets.length)],
    spin: n >= 10 ? (rng() < 0.5 ? -1 : 1) * lerp(0.2, 0.9, d) : 0,
    time: lerp(9, 4.5, d),
  };
}

export function insidePolygon(poly: { x: number; y: number }[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Точки сетки внутри еды (с учётом дырок): по ним считается площадь кусков. */
export function samplePoints(food: Pick<Food, 'outline' | 'holes'>, step = SAMPLE_STEP): Float32Array {
  const xs = food.outline.map((p) => p.x);
  const ys = food.outline.map((p) => p.y);
  const out: number[] = [];
  // Центры клеток, а не их углы: иначе точки ложатся ровно на «круглые» разрезы и дают смещение.
  for (let y = Math.min(...ys) + step / 2; y <= Math.max(...ys); y += step) {
    for (let x = Math.min(...xs) + step / 2; x <= Math.max(...xs); x += step) {
      if (!insidePolygon(food.outline, x, y)) continue;
      if (food.holes.some((h) => (x - h.x) ** 2 + (y - h.y) ** 2 < h.r * h.r)) continue;
      out.push(x, y);
    }
  }
  return new Float32Array(out);
}

/** Доля точек по положительную сторону прямой через (px, py) с направлением (dx, dy). */
export function fractionOnSide(points: Float32Array, px: number, py: number, dx: number, dy: number): number {
  let pos = 0;
  const n = points.length / 2;
  for (let i = 0; i < points.length; i += 2) {
    const side = (points[i] - px) * dy - (points[i + 1] - py) * dx;
    // Точка ровно на линии делится пополам, чтобы направление взмаха не влияло на результат.
    if (side > 1e-9) pos++;
    else if (side > -1e-9) pos += 0.5;
  }
  return n > 0 ? pos / n : 0;
}

export function gradeError(error: number): { grade: Grade; points: number } {
  if (error <= 1) return { grade: 'perfect', points: 5 };
  if (error <= 3) return { grade: 'great', points: 3 };
  if (error <= 6) return { grade: 'ok', points: 1 };
  return { grade: 'miss', points: 0 };
}

type Phase = 'enter' | 'ready' | 'result' | 'exit';
const ENTER_TIME = 0.4;
const RESULT_TIME = 1.3;
const EXIT_TIME = 0.35;

export class HalfModel {
  lives = START_LIVES;
  score = 0;
  streak = 0;
  index = 0;
  phase: Phase = 'enter';
  phaseTime = 0;
  food: Food;
  points: Float32Array;
  /** Поворот еды сейчас. */
  angle = 0;
  /** Сколько осталось на разрез. */
  timeLeft = 0;
  lastCut: Cut | null = null;
  lastGrade: Grade | null = null;
  events: HalfEvent[] = [];

  constructor(private readonly rng: () => number = Math.random) {
    this.food = makeFood(0, rng);
    this.points = samplePoints(this.food);
    this.timeLeft = this.food.time;
  }

  get over(): boolean {
    return this.lives <= 0 && (this.phase !== 'result' || this.phaseTime >= RESULT_TIME);
  }

  update(dt: number): void {
    this.phaseTime += dt;
    if (this.phase === 'enter') {
      if (this.phaseTime >= ENTER_TIME) this.setPhase('ready');
      return;
    }
    if (this.phase === 'ready') {
      this.angle += this.food.spin * dt;
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.lives--;
        this.streak = 0;
        this.lastCut = null;
        this.lastGrade = 'timeout';
        this.events.push({ type: 'timeout' });
        this.setPhase('result');
      }
      return;
    }
    if (this.phase === 'result') {
      if (this.phaseTime >= RESULT_TIME && this.lives > 0) this.setPhase('exit');
      return;
    }
    if (this.phase === 'exit' && this.phaseTime >= EXIT_TIME) this.next();
  }

  /** Разрез по прямой через две точки мира (начало и конец взмаха). */
  cut(x1: number, y1: number, x2: number, y2: number): Cut | null {
    if (this.phase !== 'ready') return null;
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < MIN_SWIPE) {
      this.events.push({ type: 'invalid' });
      return null;
    }
    // Переводим прямую в координаты еды (с учётом поворота).
    const toLocal = (x: number, y: number) => {
      const ox = x - CENTER.x;
      const oy = y - CENTER.y;
      const c = Math.cos(-this.angle);
      const s = Math.sin(-this.angle);
      return { x: ox * c - oy * s, y: ox * s + oy * c };
    };
    const a = toLocal(x1, y1);
    const b = toLocal(x2, y2);
    const dx = (b.x - a.x) / len;
    const dy = (b.y - a.y) / len;
    const fraction = fractionOnSide(this.points, a.x, a.y, dx, dy);
    // Разрез мимо еды — один из кусков пустой.
    if (fraction <= 0.002 || fraction >= 0.998) {
      this.events.push({ type: 'invalid' });
      return null;
    }
    const target = this.food.target;
    const small = target < 0.5 ? Math.min(fraction, 1 - fraction) : fraction;
    const error = (target < 0.5 ? Math.abs(small - target) : Math.abs(fraction - 0.5)) * 100;
    const { grade, points } = gradeError(error);
    let pts = points;
    if (grade === 'perfect') {
      this.streak++;
      pts += Math.min(5, this.streak - 1);
    } else {
      this.streak = grade === 'miss' ? 0 : this.streak;
    }
    if (grade === 'miss') this.lives--;
    this.score += pts;
    const cut: Cut = { px: a.x, py: a.y, dx, dy, fraction, small: target < 0.5 ? small : Math.min(fraction, 1 - fraction), error, grade, points: pts };
    this.lastCut = cut;
    this.lastGrade = grade;
    this.events.push({ type: 'cut', cut });
    this.setPhase('result');
    return cut;
  }

  revive(): void {
    this.lives = 1;
    this.next();
  }

  private next(): void {
    this.index++;
    this.food = makeFood(this.index, this.rng);
    this.points = samplePoints(this.food);
    this.angle = 0;
    this.timeLeft = this.food.time;
    this.lastCut = null;
    this.lastGrade = null;
    this.setPhase('enter');
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseTime = 0;
  }

  drainEvents(): HalfEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}
