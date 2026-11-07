import { GRAIN_KINDS, GrainKindId, collisionRadius } from './grains';
import type { LevelConfig } from './level';
import { Body, Bounds, Pusher, stepPhysics } from './physics';
import { Rng } from './rng';
import { PILE_CENTER, Rect, TABLE_BOTTOM, WORLD_W, rectContains, trayRects } from './world';

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
  /** 0 — палочки раскрыты, 1 — сжаты. */
  pinch: number;
  heldId: number;
}

export type GameEvent =
  | { type: 'grab'; x: number; y: number }
  | { type: 'sorted'; x: number; y: number; kind: GrainKindId }
  | { type: 'wrong'; x: number; y: number }
  | { type: 'slipped'; x: number; y: number }
  | { type: 'won' }
  | { type: 'lost' };

export type SessionStatus = 'playing' | 'won' | 'lost';

const TABLE_BOUNDS: Bounds = { minX: 0, minY: 0, maxX: WORLD_W, maxY: TABLE_BOTTOM };
const RAKE_RADIUS = 14;
const SLIP_SPEED = 700;
const SETTLE_STEPS = 90;

export class Session {
  readonly config: LevelConfig;
  readonly grains: Grain[] = [];
  readonly trays: Tray[];
  readonly chop: Chopsticks;
  readonly totalTargets: number;
  status: SessionStatus = 'playing';
  elapsed = 0;
  mistakes = 0;
  sortedCount = 0;
  /** События за кадр для звука и эффектов; внешний код их забирает. */
  events: GameEvent[] = [];

  private readonly rng: Rng;

  constructor(config: LevelConfig) {
    this.config = config;
    this.rng = new Rng(config.seed ^ 0x9e3779b9);

    const rects = trayRects(config.targets);
    this.trays = config.targets.map((kind, i) => ({
      ...rects[i],
      kind,
      count: 0,
      total: config.counts[kind] ?? 0,
    }));
    this.totalTargets = this.trays.reduce((s, t) => s + t.total, 0);

    this.chop = {
      pointerX: PILE_CENTER.x,
      pointerY: PILE_CENTER.y,
      x: PILE_CENTER.x,
      y: PILE_CENTER.y,
      vx: 0,
      vy: 0,
      pressed: false,
      hover: false,
      pinch: 0,
      heldId: -1,
    };

    this.spawnPile();
  }

  get timeLeft(): number | null {
    if (this.config.timeLimit === null) return null;
    return Math.max(0, this.config.timeLimit - this.elapsed);
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
    return 1 + (this.mistakes <= 2 ? 1 : 0) + (left >= 0.3 ? 1 : 0);
  }

  pointerDown(x: number, y: number): void {
    if (this.status !== 'playing') return;
    this.chop.pointerX = x;
    this.chop.pointerY = y;
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
    const g = this.heldGrain;
    if (g) this.release(g);
  }

  update(dt: number): void {
    if (this.status !== 'playing') return;
    this.elapsed += dt;

    this.updateTip(dt);
    const c = this.chop;
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

    stepPhysics(this.freeGrains(), dt, {
      damping: this.config.damping,
      bounds: TABLE_BOUNDS,
      pushers,
      kinematic: this.heldGrain,
    });

    const left = this.timeLeft;
    if (left !== null && left <= 0) {
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

    const R = this.config.pileRadius;
    kinds.forEach((kind, id) => {
      const a = this.rng.range(0, Math.PI * 2);
      const dist = Math.min(R, Math.abs(this.rng.gaussian()) * R * 0.5);
      const def = GRAIN_KINDS[kind];
      this.grains.push({
        id,
        kind,
        state: 'free',
        x: PILE_CENTER.x + Math.cos(a) * dist,
        y: PILE_CENTER.y + Math.sin(a) * dist * 0.8,
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
      stepPhysics(this.grains, 1 / 60, { damping: 30, bounds: TABLE_BOUNDS, iterations: 3 });
    }
    for (const g of this.grains) {
      g.vx = 0;
      g.vy = 0;
      g.spin = 0;
    }
  }

  private freeGrains(): Grain[] {
    return this.grains.filter((g) => g.state === 'free');
  }

  private updateTip(dt: number): void {
    const c = this.chop;
    const j = this.config.jitter;
    const t = this.elapsed;
    const jx = j * (Math.sin(t * 7.3) * 0.6 + Math.sin(t * 2.9 + 1.3) * 0.4);
    const jy = j * (Math.sin(t * 6.1 + 0.7) * 0.6 + Math.sin(t * 3.7 + 2.1) * 0.4);
    const nx = c.pointerX + jx;
    const ny = c.pointerY + jy;
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
    // Зёрна с большим id нарисованы сверху, поэтому при равенстве берём верхнее.
    for (let i = this.grains.length - 1; i >= 0; i--) {
      const g = this.grains[i];
      if (g.state !== 'free') continue;
      const d = Math.hypot(g.x - c.x, g.y - c.y) - g.r;
      if (d <= this.config.grabRadius && d < bestScore) {
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
      this.events.push({ type: 'sorted', x: g.x, y: g.y, kind: g.kind });
      if (this.sortedCount >= this.totalTargets) {
        this.status = 'won';
        this.events.push({ type: 'won' });
      }
      return;
    }

    // Не тот лоток: ошибка, зерно отскакивает обратно на стол.
    this.mistakes++;
    this.events.push({ type: 'wrong', x: g.x, y: g.y });
    g.state = 'free';
    g.y = TABLE_BOTTOM - g.r - 2;
    g.vx = (PILE_CENTER.x - g.x) * 0.8;
    g.vy = -650;
    g.spin = this.rng.range(-12, 12);
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
