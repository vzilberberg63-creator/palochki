/**
 * «Налей чаю» — логика без отрисовки.
 *
 * Зажал — чайник наклоняется и льёт, отпустил — наклон уходит, но струя ещё летит вниз.
 * Надо отпустить заранее, чтобы чай встал между двумя чертами в чашке.
 * Одна попытка на чашку. Перелил, недолил или пролил мимо — минус жизнь.
 */

export const WORLD_W = 600;
export const WORLD_H = 900;
export const SPOUT = { x: 300, y: 250 };
/** Верх стола: на нём стоят чашки. */
export const TABLE_Y = 780;

/** Скорость падения струи, ед/с: от носика до дна чашки ~0,45 с. */
export const STREAM_SPEED = 1150;
/** Сколько секунд чайник наклоняется и выпрямляется. */
export const TILT_IN = 0.16;
export const TILT_OUT = 0.12;
/** Секунд на то, чтобы начать лить в стоящую чашку. */
export const PATIENCE = 7;
export const START_LIVES = 3;

export type CupStyle = 'cup' | 'glass' | 'mug' | 'bowl';

export interface Cup {
  style: CupStyle;
  /** Центр по горизонтали. */
  x: number;
  /** Внутренняя ширина и высота. */
  w: number;
  h: number;
  /** Черты: от и до, высота от дна. */
  lo: number;
  hi: number;
  /** Скорость движения (влево), 0 — стоит под носиком. */
  speed: number;
  /** Напор чайника для этой чашки: объём в секунду (ед²/с). */
  flow: number;
  /** Неровный напор: амплитуда колебаний, доля. */
  wobble: number;
}

export interface Parcel {
  x: number;
  vol: number;
  emitAt: number;
  landAt: number;
}

export type Verdict = 'perfect' | 'good' | 'under' | 'overflow' | 'spill' | 'miss';

export type TeaEvent =
  | { type: 'pourStart' }
  | { type: 'land'; level: number }
  | { type: 'verdict'; verdict: Verdict; points: number };

export type Phase = 'enter' | 'ready' | 'result' | 'exit';

const ENTER_TIME = 0.55;
const RESULT_TIME = 1.0;
const EXIT_TIME = 0.45;
/** Пролито мимо больше этой доли — считается «пролил». */
const SPILL_LIMIT = 0.15;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Сложность по номеру чашки: 0 в начале, плавно к 1. */
export function difficulty(n: number): number {
  return 1 - Math.exp(-n / 18);
}

export function makeCup(n: number, rng: () => number): Cup {
  const d = difficulty(n);
  const styles: CupStyle[] = n < 3 ? ['cup'] : ['cup', 'glass', 'mug', 'bowl'];
  const style = styles[Math.floor(rng() * styles.length)];
  const dims: Record<CupStyle, [number, number]> = {
    cup: [130, 120],
    glass: [80, 200],
    mug: [110, 160],
    bowl: [200, 90],
  };
  const [w, h] = dims[style];
  // Полоса между чертами сужается с 22% до 8% высоты чашки.
  const band = h * lerp(0.22, 0.08, d);
  const center = h * lerp(0.62, 0.78, rng());
  const moving = n >= 8 && rng() < lerp(0.3, 0.7, d);
  return {
    style,
    x: moving ? WORLD_W + w : SPOUT.x,
    w,
    h,
    lo: center - band / 2,
    hi: center + band / 2,
    speed: moving ? lerp(70, 150, d) : 0,
    flow: lerp(9000, 15000, d) * lerp(0.9, 1.1, rng()),
    wobble: n >= 15 ? lerp(0, 0.3, d) : 0,
  };
}

export class TeaModel {
  lives = START_LIVES;
  score = 0;
  /** Идеальные наливы подряд. */
  streak = 0;
  cupIndex = 0;
  time = 0;
  phase: Phase = 'enter';
  phaseTime = 0;
  cup: Cup;
  /** Откуда чашка въезжает (для анимации). */
  private enterFrom = WORLD_W + 200;
  parcels: Parcel[] = [];
  /** Наклон чайника 0..1. */
  tilt = 0;
  pressing = false;
  /** В эту чашку уже налили (вторая попытка не даётся). */
  pourUsed = false;
  volume = 0;
  spilled = 0;
  emitted = 0;
  overflowed = false;
  waited = 0;
  lastVerdict: Verdict | null = null;
  events: TeaEvent[] = [];

  constructor(private readonly rng: () => number = Math.random) {
    this.cup = makeCup(0, rng);
    this.placeCup();
  }

  get level(): number {
    return this.volume / this.cup.w;
  }

  /** Жизни кончились и вердикт последней чашки уже показан. */
  get over(): boolean {
    return this.lives <= 0 && (this.phase !== 'result' || this.phaseTime >= RESULT_TIME);
  }

  /** Сколько терпения осталось у стоящей чашки, 0..1 (для кольца-таймера). */
  get patience(): number {
    if (this.cup.speed > 0 || this.pourUsed) return 1;
    return Math.max(0, 1 - this.waited / PATIENCE);
  }

  press(): void {
    if (this.phase !== 'ready' || this.pourUsed || this.lives <= 0) return;
    this.pressing = true;
    this.pourUsed = true;
    this.events.push({ type: 'pourStart' });
  }

  release(): void {
    this.pressing = false;
  }

  /** Продолжить после проигрыша: одна жизнь, следующая чашка. */
  revive(): void {
    this.lives = 1;
    this.nextCup();
  }

  update(dt: number): void {
    this.time += dt;
    this.phaseTime += dt;
    const c = this.cup;

    if (this.phase === 'enter') {
      const k = Math.min(1, this.phaseTime / ENTER_TIME);
      c.x = lerp(this.enterFrom, SPOUT.x, 1 - (1 - k) ** 3);
      if (k >= 1) this.setPhase('ready');
      return;
    }

    if (this.phase === 'ready' && c.speed > 0) c.x -= c.speed * dt;
    if (this.phase === 'ready' && !this.pourUsed && c.speed === 0) this.waited += dt;

    // Наклон чайника и выпуск струи.
    const target = this.pressing ? 1 : 0;
    this.tilt = target > this.tilt ? Math.min(1, this.tilt + dt / TILT_IN) : Math.max(0, this.tilt - dt / TILT_OUT);
    if (this.tilt > 0) {
      const wob = c.wobble > 0 ? 1 + c.wobble * Math.sin(this.time * 9.3) * Math.sin(this.time * 3.1 + 1) : 1;
      const vol = c.flow * this.tilt * wob * dt;
      const surface = TABLE_Y - this.level;
      this.parcels.push({ x: SPOUT.x, vol, emitAt: this.time, landAt: this.time + (surface - SPOUT.y) / STREAM_SPEED });
      this.emitted += vol;
    }

    // Приземление.
    while (this.parcels.length && this.parcels[0].landAt <= this.time) {
      const p = this.parcels.shift()!;
      if (Math.abs(p.x - c.x) <= c.w / 2) {
        this.volume += p.vol;
        const max = c.h * c.w;
        if (this.volume > max) {
          this.spilled += this.volume - max;
          this.volume = max;
          this.overflowed = true;
        }
        this.events.push({ type: 'land', level: this.level / c.h });
      } else {
        this.spilled += p.vol;
      }
    }

    if (this.phase === 'ready') {
      const pourFinished = this.pourUsed && !this.pressing && this.tilt === 0 && this.parcels.length === 0;
      const gone = c.speed > 0 && c.x < -c.w;
      const timedOut = c.speed === 0 && !this.pourUsed && this.waited >= PATIENCE;
      if (this.overflowed && this.parcels.length === 0 && this.tilt === 0) this.judge('overflow');
      else if (pourFinished) this.judge(this.verdict());
      else if (gone) this.judge(this.pourUsed ? this.verdict() : 'miss');
      else if (timedOut) this.judge('miss');
    } else if (this.phase === 'result') {
      if (this.phaseTime >= RESULT_TIME) {
        if (this.lives <= 0) return;
        this.setPhase('exit');
      }
    } else if (this.phase === 'exit') {
      if (c.speed === 0) c.x -= (WORLD_W / EXIT_TIME) * dt;
      if (this.phaseTime >= EXIT_TIME) this.nextCup();
    }
  }

  /** Оценка налитого (когда струя кончилась). */
  verdict(): Verdict {
    const c = this.cup;
    if (this.overflowed) return 'overflow';
    if (this.emitted > 0 && this.spilled / this.emitted > SPILL_LIMIT) return 'spill';
    const lvl = this.level;
    if (lvl < c.lo) return 'under';
    if (lvl > c.hi) return 'overflow';
    const mid = (c.lo + c.hi) / 2;
    return Math.abs(lvl - mid) <= (c.hi - c.lo) * 0.2 ? 'perfect' : 'good';
  }

  private judge(v: Verdict): void {
    let points = 0;
    if (v === 'perfect') {
      this.streak++;
      points = 3 * (1 + Math.floor((this.streak - 1) / 3));
    } else if (v === 'good') {
      this.streak = 0;
      points = 1;
    } else {
      this.streak = 0;
      this.lives--;
    }
    this.score += points;
    this.lastVerdict = v;
    this.pressing = false;
    this.events.push({ type: 'verdict', verdict: v, points });
    this.setPhase('result');
  }

  private nextCup(): void {
    this.cupIndex++;
    this.cup = makeCup(this.cupIndex, this.rng);
    this.placeCup();
  }

  private placeCup(): void {
    this.parcels = [];
    this.tilt = 0;
    this.pressing = false;
    this.pourUsed = false;
    this.volume = 0;
    this.spilled = 0;
    this.emitted = 0;
    this.overflowed = false;
    this.waited = 0;
    this.lastVerdict = null;
    if (this.cup.speed > 0) {
      // Едущая чашка сразу готова: она въезжает справа и проезжает под носиком.
      this.setPhase('ready');
    } else {
      this.enterFrom = WORLD_W + this.cup.w;
      this.cup.x = this.enterFrom;
      this.setPhase('enter');
    }
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseTime = 0;
  }

  drainEvents(): TeaEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}
