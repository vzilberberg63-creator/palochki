import { GRAIN_KINDS, GrainKindId, collisionRadius } from './grains';
import type { LevelConfig } from './level';
import { Body, Bounds, Pusher, stepPhysics } from './physics';
import { Rng } from './rng';
import { Layout, Rect, SQUARE, rectContains, trayRects } from './world';

export type GrainState = 'free' | 'held' | 'sorted';

export interface Grain extends Body {
  id: number;
  kind: GrainKindId;
  state: GrainState;
  /** Смещение светлоты конкретного зерна, чтобы куча не выглядела однотонной. */
  tint: number;
}

export interface Tray extends Rect {
  kind: GrainKindId;
  count: number;
  total: number;
}

export interface Chopsticks {
  /** Где палец/курсор. */
  pointerX: number;
  pointerY: number;
  /** Где кончики палочек (с учётом дрожания). */
  x: number;
  y: number;
  vx: number;
  vy: number;
  pressed: boolean;
  /** Устройство показывает курсор без нажатия (мышь). */
  hover: boolean;
  /** Текущее нажатие сделано пальцем. */
  touch: boolean;
  /** На сколько кончики палочек сейчас подняты над пальцем. */
  lift: number;
  /** 0 — палочки раскрыты, 1 — сжаты. */
  pinch: number;
  heldId: number;
  /** Режим «Кучки»: направление движения лопатки (единичный вектор) и её полуширина. */
  bladeDirX: number;
  bladeDirY: number;
  bladeHalf: number;
}

export type GameEvent =
  | { type: 'grab'; x: number; y: number }
  | { type: 'sorted'; x: number; y: number; kind: GrainKindId; combo: number; points: number }
  /** Множитель комбо вырос. */
  | { type: 'combo'; x: number; y: number; multiplier: number }
  /** Серия от COMBO_MIN_SHOWN зёрен прервалась ошибкой или паузой. */
  | { type: 'comboLost'; combo: number }
  /** За серию на уровне с таймером добавлено время. */
  | { type: 'timeBonus'; x: number; y: number; seconds: number }
  | { type: 'wrong'; x: number; y: number }
  | { type: 'slipped'; x: number; y: number }
  | { type: 'won' }
  | { type: 'lost' };

export type SessionStatus = 'playing' | 'won' | 'lost';

const RAKE_RADIUS = 14;
/** При касании пальцем зерно в палочках поднимается выше пальца, чтобы его было видно. */
export const TOUCH_LIFT = 70;
/** Палец менее точен, чем мышь: добавка к радиусу захвата. */
export const TOUCH_GRAB_BONUS = 10;
const SLIP_SPEED = 700;

/** Сколько секунд после верного переноса серия ждёт следующего. */
export const COMBO_WINDOW = 3.5;
/** Очки за зерно до умножения. */
export const POINTS_PER_GRAIN = 10;
/** С какой длины серия считается комбо и показывается игроку. */
export const COMBO_MIN_SHOWN = 3;
/** Каждые столько зёрен подряд на уровне с таймером — бонус времени. */
export const TIME_BONUS_EVERY = 5;
export const TIME_BONUS_SECONDS = 2;

/** Множитель очков по длине серии: ×1, ×2 с 3-го, ×3 с 6-го, ×4 с 10-го зерна. */
export function comboMultiplier(combo: number): number {
  if (combo >= 10) return 4;
  if (combo >= 6) return 3;
  if (combo >= COMBO_MIN_SHOWN) return 2;
  return 1;
}
const SETTLE_STEPS = 90;

export class Session {
  readonly config: LevelConfig;
  readonly layout: Layout;
  readonly grains: Grain[] = [];
  readonly trays: Tray[];
  readonly chop: Chopsticks;
  readonly totalTargets: number;
  status: SessionStatus = 'playing';
  elapsed = 0;
  mistakes = 0;
  sortedCount = 0;
  score = 0;
  /** Текущая серия верных переносов подряд. */
  combo = 0;
  bestCombo = 0;
  /** Сколько секунд серия ещё ждёт следующего зерна. */
  comboTimer = 0;
  /** Время, добавленное за серии и за рекламу. */
  bonusTime = 0;
  /** Игрок уже продлевал эту попытку за рекламу. */
  continued = false;
  /**
   * Насколько активно палочки сейчас разгребают кучу: 0 — нет, 1 — быстро и сквозь много зёрен.
   * Нужна для непрерывного шороха.
   */
  rakeActivity = 0;
  /** События за кадр для звука и эффектов; внешний код их забирает. */
  events: GameEvent[] = [];

  protected readonly rng: Rng;
  protected readonly bounds: Bounds;

  constructor(config: LevelConfig, layout: Layout = SQUARE) {
    this.config = config;
    this.layout = layout;
    this.bounds = layout.table;
    this.rng = new Rng(config.seed ^ 0x9e3779b9);

    const rects = trayRects(config.targets, layout);
    this.trays = config.targets.map((kind, i) => ({
      ...rects[i],
      kind,
      count: 0,
      total: config.counts[kind] ?? 0,
    }));
    this.totalTargets = this.trays.reduce((s, t) => s + t.total, 0);

    const pc = layout.pileCenter;
    this.chop = {
      pointerX: pc.x,
      pointerY: pc.y,
      x: pc.x,
      y: pc.y,
      vx: 0,
      vy: 0,
      pressed: false,
      hover: false,
      touch: false,
      lift: 0,
      pinch: 0,
      heldId: -1,
      bladeDirX: 0,
      bladeDirY: -1,
      bladeHalf: config.bladeHalfWidth,
    };

    this.spawnPile();
  }

  get timeLeft(): number | null {
    if (this.config.timeLimit === null) return null;
    return Math.max(0, this.config.timeLimit + this.bonusTime - this.elapsed);
  }

  get heldGrain(): Grain | null {
    return this.chop.heldId >= 0 ? this.grains[this.chop.heldId] : null;
  }

  /** Звёзды за пройденный уровень: 0 — уровень не пройден. */
  stars(): number {
    if (this.status !== 'won') return 0;
    const limit = this.config.timeLimit;
    if (limit === null) return this.mistakes === 0 ? 3 : this.mistakes <= 2 ? 2 : 1;
    const left = (this.timeLeft ?? 0) / limit;
    const stars = 1 + (this.mistakes <= 2 ? 1 : 0) + (left >= 0.3 ? 1 : 0);
    // Продление за рекламу помогает пройти, но не даёт три звезды.
    return this.continued ? Math.min(2, stars) : stars;
  }

  /** Можно ли продлить попытку: время вышло, и продления ещё не было. */
  canContinue(): boolean {
    return this.status === 'lost' && !this.continued && this.config.timeLimit !== null;
  }

  /** Продолжить проигранную по времени попытку с seconds секундами на часах. */
  continueWithTime(seconds: number): void {
    if (!this.canContinue()) return;
    const limit = this.config.timeLimit!;
    this.bonusTime = this.elapsed - limit + seconds;
    this.continued = true;
    this.status = 'playing';
  }

  pointerDown(x: number, y: number, touch = false): void {
    if (this.status !== 'playing') return;
    this.chop.pointerX = x;
    this.chop.pointerY = y;
    this.chop.touch = touch;
    this.chop.lift = 0;
    this.updateTip(0);
    this.chop.pressed = true;
    this.tryGrab();
  }

  pointerMove(x: number, y: number): void {
    this.chop.pointerX = x;
    this.chop.pointerY = y;
  }

  pointerUp(): void {
    this.chop.pressed = false;
    this.rakeActivity = 0;
    const g = this.heldGrain;
    if (g) this.release(g);
  }

  update(dt: number): void {
    if (this.status !== 'playing') return;
    this.advanceTime(dt);

    const c = this.chop;
    const liftTarget = c.touch && this.heldGrain ? TOUCH_LIFT : 0;
    c.lift += (liftTarget - c.lift) * Math.min(1, dt * 14);
    this.updateTip(dt);
    const held = this.heldGrain;
    const pinchTarget = held ? 1 : c.pressed ? 0.45 : 0;
    c.pinch += (pinchTarget - c.pinch) * Math.min(1, dt * 18);

    if (held) {
      held.x = c.x;
      held.y = c.y;
      held.vx = c.vx;
      held.vy = c.vy;
      this.maybeSlip(held, dt);
    }

    const pushers: Pusher[] = [];
    if (c.pressed && !this.heldGrain) {
      pushers.push({ x: c.x, y: c.y, r: RAKE_RADIUS, vx: c.vx, vy: c.vy });
    }

    const contacts = stepPhysics(this.freeGrains(), dt, {
      damping: this.config.damping,
      bounds: this.bounds,
      pushers,
      kinematic: this.heldGrain,
    });
    const speed = Math.hypot(c.vx, c.vy);
    const target = pushers.length > 0 ? Math.min(1, contacts / 4) * Math.min(1, speed / 500) : 0;
    // Сглаживаем, чтобы шорох не трещал от кадра к кадру.
    this.rakeActivity += (target - this.rakeActivity) * Math.min(1, dt * 12);

    this.checkTimeout();
  }

  /** Часы уровня и окно комбо. */
  protected advanceTime(dt: number): void {
    this.elapsed += dt;
    if (this.comboTimer > 0) {
      this.comboTimer = Math.max(0, this.comboTimer - dt);
      if (this.comboTimer === 0) this.breakCombo();
    }
  }

  protected checkTimeout(): void {
    const left = this.timeLeft;
    if (left !== null && left <= 0) {
      this.rakeActivity = 0;
      this.dropHeld();
      this.status = 'lost';
      this.events.push({ type: 'lost' });
    }
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ——— внутреннее ———

  private spawnPile(): void {
    const kinds: GrainKindId[] = [];
    for (const k of [...this.config.targets, ...this.config.fillers]) {
      const n = this.config.counts[k] ?? 0;
      for (let i = 0; i < n; i++) kinds.push(k);
    }
    // Перемешиваем, чтобы цели не лежали слоем поверх наполнителя.
    this.rng.shuffle(kinds);

    // Куча — эллипс, повторяющий пропорции стола: на вертикальном экране он вытянут вверх.
    const R = this.config.pileRadius;
    // В «Кучках» копилки стоят на столе — куча появляется только на свободной части.
    const table = this.layout.pileArea ?? this.layout.table;
    const settleBounds = this.layout.pileArea ?? this.bounds;
    const { pileCenter } = this.layout;
    const tw = table.maxX - table.minX;
    const th = table.maxY - table.minY;
    const rx = Math.min(R, tw * 0.42);
    const ry = Math.min(R * (th / tw), th * 0.42);
    kinds.forEach((kind, id) => {
      const a = this.rng.range(0, Math.PI * 2);
      const dist = Math.min(1, Math.abs(this.rng.gaussian()) * 0.5);
      const def = GRAIN_KINDS[kind];
      this.grains.push({
        id,
        kind,
        state: 'free',
        x: pileCenter.x + Math.cos(a) * dist * rx,
        y: pileCenter.y + Math.sin(a) * dist * ry,
        vx: 0,
        vy: 0,
        angle: this.rng.range(0, Math.PI * 2),
        spin: 0,
        r: collisionRadius(def, this.config.sizeScale),
        tint: this.rng.range(-def.lightSpread, def.lightSpread),
      });
    });

    // Раскладываем кучу, чтобы зёрна не лежали друг в друге.
    for (let i = 0; i < SETTLE_STEPS; i++) {
      stepPhysics(this.grains, 1 / 60, { damping: 30, bounds: settleBounds, iterations: 3 });
    }
    for (const g of this.grains) {
      g.vx = 0;
      g.vy = 0;
      g.spin = 0;
    }
  }

  protected freeGrains(): Grain[] {
    return this.grains.filter((g) => g.state === 'free');
  }

  protected updateTip(dt: number): void {
    const c = this.chop;
    const j = this.config.jitter;
    const t = this.elapsed;
    const jx = j * (Math.sin(t * 7.3) * 0.6 + Math.sin(t * 2.9 + 1.3) * 0.4);
    const jy = j * (Math.sin(t * 6.1 + 0.7) * 0.6 + Math.sin(t * 3.7 + 2.1) * 0.4);
    const nx = c.pointerX + jx;
    const ny = c.pointerY + jy - c.lift;
    if (dt > 0) {
      c.vx = (nx - c.x) / dt;
      c.vy = (ny - c.y) / dt;
    } else {
      c.vx = 0;
      c.vy = 0;
    }
    c.x = nx;
    c.y = ny;
  }

  private tryGrab(): void {
    const c = this.chop;
    let best: Grain | null = null;
    let bestScore = Infinity;
    const radius = this.config.grabRadius + (c.touch ? TOUCH_GRAB_BONUS : 0);
    // Зёрна с большим id нарисованы сверху, поэтому при равенстве берём верхнее.
    for (let i = this.grains.length - 1; i >= 0; i--) {
      const g = this.grains[i];
      if (g.state !== 'free') continue;
      const d = Math.hypot(g.x - c.x, g.y - c.y) - g.r;
      if (d <= radius && d < bestScore) {
        best = g;
        bestScore = d;
      }
    }
    if (!best) return;
    best.state = 'held';
    best.spin = 0;
    c.heldId = best.id;
    this.events.push({ type: 'grab', x: best.x, y: best.y });
  }

  private release(g: Grain): void {
    this.chop.heldId = -1;
    const tray = this.trays.find((t) => rectContains(t, g.x, g.y));

    if (!tray) {
      g.state = 'free';
      g.vx = this.chop.vx * 0.3;
      g.vy = this.chop.vy * 0.3;
      return;
    }

    if (tray.kind === g.kind) {
      g.state = 'sorted';
      const pad = g.r + 10;
      g.x = this.rng.range(tray.x + pad, tray.x + tray.w - pad);
      g.y = this.rng.range(tray.y + pad + 14, tray.y + tray.h - pad);
      g.vx = g.vy = g.spin = 0;
      tray.count++;
      this.sortedCount++;
      this.addToCombo(g);
      if (this.sortedCount >= this.totalTargets) {
        this.status = 'won';
        this.events.push({ type: 'won' });
      }
      return;
    }

    // Не тот лоток: ошибка, зерно отскакивает обратно на стол.
    this.mistakes++;
    this.breakCombo();
    this.events.push({ type: 'wrong', x: g.x, y: g.y });
    g.state = 'free';
    // Ставим на край стола у лотка и бросаем к центру кучи.
    const t = this.layout.table;
    g.x = Math.max(t.minX + g.r, Math.min(t.maxX - g.r - 2, g.x));
    g.y = Math.max(t.minY + g.r, Math.min(t.maxY - g.r - 2, g.y));
    const pc = this.layout.pileCenter;
    const dx = pc.x - g.x;
    const dy = pc.y - g.y;
    const d = Math.hypot(dx, dy) || 1;
    g.vx = (dx / d) * 650;
    g.vy = (dy / d) * 650;
    g.spin = this.rng.range(-12, 12);
  }

  protected addToCombo(g: Grain): void {
    const prevMult = comboMultiplier(this.combo);
    this.combo = this.comboTimer > 0 ? this.combo + 1 : 1;
    this.comboTimer = COMBO_WINDOW;
    this.bestCombo = Math.max(this.bestCombo, this.combo);

    const mult = comboMultiplier(this.combo);
    const points = POINTS_PER_GRAIN * mult;
    this.score += points;
    this.events.push({ type: 'sorted', x: g.x, y: g.y, kind: g.kind, combo: this.combo, points });
    if (mult > prevMult) this.events.push({ type: 'combo', x: g.x, y: g.y, multiplier: mult });

    if (this.config.timeLimit !== null && this.combo % TIME_BONUS_EVERY === 0) {
      this.bonusTime += TIME_BONUS_SECONDS;
      this.events.push({ type: 'timeBonus', x: g.x, y: g.y, seconds: TIME_BONUS_SECONDS });
    }
  }

  protected breakCombo(): void {
    if (this.combo >= COMBO_MIN_SHOWN) this.events.push({ type: 'comboLost', combo: this.combo });
    this.combo = 0;
    this.comboTimer = 0;
  }

  private maybeSlip(g: Grain, dt: number): void {
    const slip = this.config.slip;
    if (slip <= 0) return;
    const speed = Math.hypot(this.chop.vx, this.chop.vy);
    if (speed <= SLIP_SPEED) return;
    const chance = slip * ((speed - SLIP_SPEED) / 1000) * dt * 4;
    if (this.rng.next() < chance) {
      this.chop.heldId = -1;
      g.state = 'free';
      g.vx = this.chop.vx * 0.5;
      g.vy = this.chop.vy * 0.5;
      g.spin = this.rng.range(-20, 20);
      this.events.push({ type: 'slipped', x: g.x, y: g.y });
    }
  }

  private dropHeld(): void {
    const g = this.heldGrain;
    if (!g) return;
    this.chop.heldId = -1;
    g.state = 'free';
  }
}
