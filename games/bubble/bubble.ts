/**
 * «Пузырёк» — логика без отрисовки.
 *
 * Доска на опоре, посередине строительный уровень. На доску садятся птицы и кренят её.
 * На доске лежит грузик: нажатие слева двигает его влево, справа — вправо, отпустил — он стоит.
 * Грузик уравновешивает птиц. Пузырёк всплывает к поднятой стороне;
 * его надо держать между отметками. Пока он вне отметок, тает шкала спокойствия.
 * Шкала кончилась — игра окончена. Очки идут за время в центре.
 */

export const WORLD_W = 600;
export const WORLD_H = 900;
export const PIVOT = { x: 300, y: 560 };
export const HALF_LEN = 260;

/** Наклон доски, при котором пузырёк упирается в край трубки. */
export const BUBBLE_RANGE = 0.22;
/** Упоры: дальше доска не наклоняется. */
export const MAX_ANGLE = 0.38;

/**
 * Доска не качается как маятник, а вязко клонится к равновесию между весом птиц и нажатием
 * (петля в тугом шарнире). Иначе за время реакции игрока она проскакивает центр и раскачивается.
 * STIFFNESS — какой момент нужен на радиан наклона, TILT_TIME — постоянная времени.
 */
const STIFFNESS = 900;
const TILT_TIME = 0.45;
/** Вес грузика (в тех же единицах, что и птицы) и скорость, с которой он едет по доске. */
export const WEIGHT_MASS = 3;
export const WEIGHT_SPEED = 85;
/** Самый большой момент, который даёт грузик на краю. */
export const PUSH = WEIGHT_MASS * HALF_LEN;
/** Перевес птиц на одну сторону не больше этой доли от возможностей грузика: любую ситуацию можно выровнять. */
const MAX_NET_SHARE = 0.6;
const BUBBLE_RATE = 10;
const METER_DRAIN = 0.15;
const METER_GAIN = 0.2;
/** Очков в секунду, пока пузырёк между отметками; в самом центре вдвое больше. */
const POINTS_PER_SEC = 10;

export type BirdKind = 'sparrow' | 'pigeon' | 'crow';
export const BIRD_MASS: Record<BirdKind, number> = { sparrow: 1, pigeon: 1.8, crow: 2.8 };

export interface Bird {
  id: number;
  kind: BirdKind;
  /** Положение вдоль доски от опоры: −HALF_LEN..HALF_LEN. */
  s: number;
  /** Сколько ещё сидит, с. */
  stay: number;
  /** 0 — подлетает, 1 — сидит, далее улетает (для анимации). */
  phase: 'landing' | 'sitting' | 'leaving';
  t: number;
}

export type BubbleEvent = { type: 'land'; bird: Bird } | { type: 'leave'; bird: Bird } | { type: 'gust'; dir: number } | { type: 'over' };

/** Птица садится плавно: её вес нарастает почти секунду, есть время среагировать. */
const LAND_TIME = 0.9;
const LEAVE_TIME = 0.6;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function difficulty(seconds: number): number {
  return 1 - Math.exp(-seconds / 90);
}

export class BubbleModel {
  /** Наклон: + — правый край ниже. */
  angle = 0;
  omega = 0;
  /** Пузырёк в трубке: −1 — у левого края, +1 — у правого. */
  bubble = 0;
  meter = 1;
  time = 0;
  points = 0;
  left = false;
  right = false;
  /** Положение грузика вдоль доски: −HALF_LEN..HALF_LEN. */
  weight = 0;
  birds: Bird[] = [];
  private nextBirdIn = 1.5;
  private nextGustIn = 20;
  private gust = 0;
  private gustTime = 0;
  private ids = 0;
  events: BubbleEvent[] = [];

  constructor(private readonly rng: () => number = Math.random) {}

  get score(): number {
    return Math.floor(this.points);
  }

  get over(): boolean {
    return this.meter <= 0;
  }

  /** Полуширина зоны между отметками в долях трубки: сужается со временем. */
  get zone(): number {
    return lerp(0.4, 0.16, difficulty(this.time));
  }

  get inZone(): boolean {
    return Math.abs(this.bubble) <= this.zone;
  }

  /** Сумма моментов от птиц (только сидящих и садящихся). */
  birdTorque(): number {
    let t = 0;
    for (const b of this.birds) {
      if (b.phase === 'leaving') continue;
      const k = b.phase === 'landing' ? Math.min(1, b.t / LAND_TIME) : 1;
      t += BIRD_MASS[b.kind] * b.s * k;
    }
    return t;
  }

  revive(): void {
    this.meter = 1;
    this.birds = [];
    this.angle = 0;
    this.omega = 0;
    this.bubble = 0;
    this.weight = 0;
    this.gust = 0;
    this.nextBirdIn = 2;
  }

  update(dt: number): void {
    if (this.over) return;
    this.time += dt;
    const d = difficulty(this.time);

    this.updateBirds(dt, d);
    this.updateGust(dt, d);

    const move = (this.right ? 1 : 0) - (this.left ? 1 : 0);
    this.weight = Math.max(-HALF_LEN, Math.min(HALF_LEN, this.weight + move * WEIGHT_SPEED * dt));
    const player = WEIGHT_MASS * this.weight;
    const torque = this.birdTorque() * Math.cos(this.angle) + player + this.gust;
    const target = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, torque / STIFFNESS));
    const prev = this.angle;
    this.angle += (target - this.angle) * Math.min(1, dt / TILT_TIME);
    this.omega = dt > 0 ? (this.angle - prev) / dt : 0;

    // Пузырёк всплывает к поднятому краю: правый край ниже — пузырёк уходит влево.
    const bubbleTarget = Math.max(-1, Math.min(1, -this.angle / BUBBLE_RANGE));
    this.bubble += (bubbleTarget - this.bubble) * Math.min(1, BUBBLE_RATE * dt);

    if (this.inZone) {
      this.meter = Math.min(1, this.meter + METER_GAIN * dt);
      const centered = Math.abs(this.bubble) <= this.zone / 3;
      this.points += POINTS_PER_SEC * (centered ? 2 : 1) * dt;
    } else {
      this.meter = Math.max(0, this.meter - METER_DRAIN * dt * lerp(1, 1.4, d));
      if (this.meter === 0) this.events.push({ type: 'over' });
    }
  }

  private updateBirds(dt: number, d: number): void {
    for (const b of this.birds) {
      b.t += dt;
      if (b.phase === 'landing' && b.t >= LAND_TIME) {
        b.phase = 'sitting';
        b.t = 0;
      } else if (b.phase === 'sitting') {
        b.stay -= dt;
        if (b.stay <= 0) {
          b.phase = 'leaving';
          b.t = 0;
          this.events.push({ type: 'leave', bird: b });
        }
      }
    }
    this.birds = this.birds.filter((b) => !(b.phase === 'leaving' && b.t >= LEAVE_TIME));

    this.nextBirdIn -= dt;
    const maxBirds = Math.round(lerp(2, 6, d));
    const active = this.birds.filter((b) => b.phase !== 'leaving').length;
    if (this.nextBirdIn <= 0 && active < maxBirds) {
      this.spawnBird(d);
      this.nextBirdIn = lerp(3.4, 1.1, d) * lerp(0.7, 1.3, this.rng());
    }
  }

  private spawnBird(d: number): void {
    const r = this.rng();
    const kind: BirdKind = r < lerp(0.8, 0.35, d) ? 'sparrow' : r < lerp(0.97, 0.75, d) ? 'pigeon' : 'crow';
    // Садятся не в самый центр: там птица почти не влияет на наклон.
    const side = this.rng() < 0.5 ? -1 : 1;
    let s = side * lerp(105, HALF_LEN - 25, this.rng());
    // Перевес не должен стать больше, чем игрок может дожать: иначе садимся на другую сторону.
    const limit = PUSH * MAX_NET_SHARE;
    const net = this.birdTorque();
    if (Math.abs(net + BIRD_MASS[kind] * s) > limit) {
      s = -s;
      if (Math.abs(net + BIRD_MASS[kind] * s) > limit) return;
    }
    // Не садимся на соседа.
    if (this.birds.some((b) => b.phase !== 'leaving' && Math.abs(b.s - s) < 50)) return;
    const bird: Bird = { id: ++this.ids, kind, s, stay: lerp(5, 9, this.rng()), phase: 'landing', t: 0 };
    this.birds.push(bird);
    this.events.push({ type: 'land', bird });
  }

  /** Порывы ветра со временем: короткий толчок в случайную сторону. */
  private updateGust(dt: number, d: number): void {
    if (this.gustTime > 0) {
      this.gustTime -= dt;
      if (this.gustTime <= 0) this.gust = 0;
      return;
    }
    if (d < 0.25) return;
    this.nextGustIn -= dt;
    if (this.nextGustIn <= 0) {
      const dir = this.rng() < 0.5 ? -1 : 1;
      this.gust = dir * PUSH * lerp(0.2, 0.4, d);
      this.gustTime = lerp(0.8, 1.6, this.rng());
      this.nextGustIn = lerp(14, 6, d) * lerp(0.7, 1.3, this.rng());
      this.events.push({ type: 'gust', dir });
    }
  }

  drainEvents(): BubbleEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}
