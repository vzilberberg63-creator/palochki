/**
 * Простая физика частиц-окружностей для мини-игр: расталкивание, границы,
 * толкатель-отрезок (грабли, лопатка). Без зависимостей.
 */

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Отрезок толщиной 2r, который сгребает частицы. */
export interface Scraper {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  r: number;
  vx: number;
  vy: number;
}

/**
 * Выталкивает частицы из отрезка и передаёт им его скорость.
 * carry — насколько частица перенимает скорость (1 — едет вместе с граблями).
 * Возвращает число касаний.
 */
export function scrape(parts: Particle[], s: Scraper, carry = 0.9): number {
  const sx = s.x2 - s.x1;
  const sy = s.y2 - s.y1;
  const len2 = sx * sx + sy * sy;
  let contacts = 0;
  for (const p of parts) {
    let t = len2 > 0 ? ((p.x - s.x1) * sx + (p.y - s.y1) * sy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = s.x1 + sx * t;
    const cy = s.y1 + sy * t;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const min = s.r + p.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) continue;
    const d = Math.sqrt(d2);
    const sv = Math.hypot(s.vx, s.vy) || 1;
    // Центр частицы ровно на отрезке — выталкиваем по ходу движения.
    const nx = d > 1e-4 ? dx / d : s.vx / sv;
    const ny = d > 1e-4 ? dy / d : s.vy / sv;
    p.x = cx + nx * min;
    p.y = cy + ny * min;
    p.vx += (s.vx - p.vx) * carry;
    p.vy += (s.vy - p.vy) * carry;
    contacts++;
  }
  return contacts;
}

/** Расталкивает перекрывающиеся частицы (поиск соседей по сетке). */
export function separate(parts: Particle[]): void {
  let maxR = 1;
  for (const p of parts) if (p.r > maxR) maxR = p.r;
  const cell = maxR * 2;
  const grid = new Map<number, number[]>();
  const key = (cx: number, cy: number) => (cx + 2048) * 8192 + (cy + 2048);
  parts.forEach((p, i) => {
    const k = key(Math.floor(p.x / cell), Math.floor(p.y / cell));
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  });
  for (let i = 0; i < parts.length; i++) {
    const a = parts[i];
    const cx = Math.floor(a.x / cell);
    const cy = Math.floor(a.y / cell);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const list = grid.get(key(cx + ox, cy + oy));
        if (!list) continue;
        for (const j of list) {
          if (j <= i) continue;
          const b = parts[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const min = a.r + b.r;
          const d2 = dx * dx + dy * dy;
          if (d2 >= min * min) continue;
          const d = Math.sqrt(d2);
          const nx = d > 1e-4 ? dx / d : 1;
          const ny = d > 1e-4 ? dy / d : 0;
          const push = (min - d) / 2;
          a.x -= nx * push;
          a.y -= ny * push;
          b.x += nx * push;
          b.y += ny * push;
        }
      }
    }
  }
}

/** Движение с затуханием и удержание в границах. */
export function integrate(parts: Particle[], dt: number, damping: number, box: Box): void {
  const k = Math.exp(-damping * dt);
  for (const p of parts) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= k;
    p.vy *= k;
    if (p.x < box.minX + p.r) {
      p.x = box.minX + p.r;
      p.vx = Math.abs(p.vx) * 0.2;
    } else if (p.x > box.maxX - p.r) {
      p.x = box.maxX - p.r;
      p.vx = -Math.abs(p.vx) * 0.2;
    }
    if (p.y < box.minY + p.r) {
      p.y = box.minY + p.r;
      p.vy = Math.abs(p.vy) * 0.2;
    } else if (p.y > box.maxY - p.r) {
      p.y = box.maxY - p.r;
      p.vy = -Math.abs(p.vy) * 0.2;
    }
  }
}
