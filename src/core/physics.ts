/**
 * Упрощённая физика зёрен: каждое зерно — окружность.
 * Позиционное расталкивание + обмен импульсом по нормали,
 * поиск соседей через пространственную сетку.
 */

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  r: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Нечто, что раздвигает зёрна: кончики палочек при «разгребании». */
export interface Pusher {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
}

export interface StepOptions {
  damping: number;
  bounds: Bounds;
  pushers?: readonly Pusher[];
  /** Кинематическое тело (зерно в палочках): двигает других, само не сдвигается. */
  kinematic?: Body | null;
  iterations?: number;
}

const RESTITUTION = 0.15;

export function stepPhysics(bodies: Body[], dt: number, opts: StepOptions): void {
  const { damping, bounds, pushers = [], kinematic = null, iterations = 2 } = opts;
  const linDamp = Math.exp(-damping * dt);
  const angDamp = Math.exp(-damping * 1.5 * dt);

  for (const b of bodies) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.angle += b.spin * dt;
    b.vx *= linDamp;
    b.vy *= linDamp;
    b.spin *= angDamp;
  }

  for (const p of pushers) {
    for (const b of bodies) {
      const dx = b.x - p.x;
      const dy = b.y - p.y;
      const minD = p.r + b.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= minD * minD) continue;
      const d = Math.sqrt(d2) || 0.0001;
      const nx = dx / d;
      const ny = dy / d;
      b.x = p.x + nx * minD;
      b.y = p.y + ny * minD;
      // Зерно увлекается движением палочек и получает толчок наружу.
      b.vx += (p.vx - b.vx) * 0.5 + nx * 40;
      b.vy += (p.vy - b.vy) * 0.5 + ny * 40;
      b.spin += (nx * p.vy - ny * p.vx) * 0.01;
    }
  }

  const all = kinematic ? [...bodies, kinematic] : bodies;
  for (let it = 0; it < iterations; it++) {
    resolveCollisions(all, kinematic);
  }

  for (const b of bodies) clampToBounds(b, bounds);
}

function resolveCollisions(bodies: Body[], kinematic: Body | null): void {
  let maxR = 1;
  for (const b of bodies) if (b.r > maxR) maxR = b.r;
  const cell = maxR * 2;
  const grid = new Map<number, number[]>();
  const key = (cx: number, cy: number) => cx * 4096 + cy;

  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    const k = key(Math.floor(b.x / cell) + 1024, Math.floor(b.y / cell) + 1024);
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  }

  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    const cx = Math.floor(a.x / cell) + 1024;
    const cy = Math.floor(a.y / cell) + 1024;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const list = grid.get(key(cx + ox, cy + oy));
        if (!list) continue;
        for (const j of list) {
          if (j <= i) continue;
          separate(a, bodies[j], kinematic);
        }
      }
    }
  }
}

function separate(a: Body, b: Body, kinematic: Body | null): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const minD = a.r + b.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= minD * minD) return;
  const d = Math.sqrt(d2) || 0.0001;
  // Совпадающие центры: разводим в произвольную, но детерминированную сторону.
  const nx = d2 > 0 ? dx / d : 1;
  const ny = d2 > 0 ? dy / d : 0;
  const overlap = minD - d;

  const aFixed = a === kinematic;
  const bFixed = b === kinematic;
  if (aFixed && bFixed) return;
  const wa = aFixed ? 0 : bFixed ? 1 : 0.5;
  const wb = bFixed ? 0 : aFixed ? 1 : 0.5;

  a.x -= nx * overlap * wa;
  a.y -= ny * overlap * wa;
  b.x += nx * overlap * wb;
  b.y += ny * overlap * wb;

  // Скорость сближения вдоль нормали.
  const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rel >= 0) return;
  const impulse = -(1 + RESTITUTION) * rel;
  if (aFixed) {
    b.vx += nx * impulse;
    b.vy += ny * impulse;
  } else if (bFixed) {
    a.vx -= nx * impulse;
    a.vy -= ny * impulse;
  } else {
    a.vx -= nx * impulse * 0.5;
    a.vy -= ny * impulse * 0.5;
    b.vx += nx * impulse * 0.5;
    b.vy += ny * impulse * 0.5;
  }
}

function clampToBounds(b: Body, bounds: Bounds): void {
  if (b.x < bounds.minX + b.r) {
    b.x = bounds.minX + b.r;
    b.vx = Math.abs(b.vx) * 0.3;
  } else if (b.x > bounds.maxX - b.r) {
    b.x = bounds.maxX - b.r;
    b.vx = -Math.abs(b.vx) * 0.3;
  }
  if (b.y < bounds.minY + b.r) {
    b.y = bounds.minY + b.r;
    b.vy = Math.abs(b.vy) * 0.3;
  } else if (b.y > bounds.maxY - b.r) {
    b.y = bounds.maxY - b.r;
    b.vy = -Math.abs(b.vy) * 0.3;
  }
}
