import { generateLevel } from '../src/core/level';
import { Grain, Session } from '../src/core/session';
import { TABLE_BOTTOM } from '../src/core/world';

const center = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Берёт конкретное зерно палочками и отпускает в точке (x, y). */
function moveGrain(s: Session, g: Grain, x: number, y: number): void {
  s.pointerDown(g.x, g.y);
  expect(s.heldGrain).toBe(g);
  s.pointerMove(x, y);
  s.update(1 / 60);
  s.pointerUp();
}

/** Ищет свободное зерно вида kind, ближайшее к которому — оно само (чтобы захват был однозначным). */
function grabbable(s: Session, kind: string): Grain {
  for (const g of s.grains) {
    if (g.state !== 'free' || g.kind !== kind) continue;
    s.pointerDown(g.x, g.y);
    const held = s.heldGrain;
    s.pointerUp();
    if (held === g) return g;
  }
  throw new Error(`no grabbable ${kind}`);
}

describe('Session', () => {
  it('создаёт столько зёрен, сколько указано в уровне, без перекрытий и NaN', () => {
    const cfg = generateLevel(12);
    const s = new Session(cfg);
    const expected = Object.values(cfg.counts).reduce((a, b) => a + (b ?? 0), 0);
    expect(s.grains.length).toBe(expected);
    for (const g of s.grains) {
      expect(Number.isFinite(g.x) && Number.isFinite(g.y)).toBe(true);
      expect(g.y).toBeLessThanOrEqual(TABLE_BOTTOM);
    }
    // После раскладки кучи сильных перекрытий нет.
    let deep = 0;
    for (let i = 0; i < s.grains.length; i++) {
      for (let j = i + 1; j < s.grains.length; j++) {
        const a = s.grains[i];
        const b = s.grains[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) < (a.r + b.r) * 0.5) deep++;
      }
    }
    expect(deep).toBe(0);
  });

  it('правильный лоток засчитывает зерно', () => {
    const s = new Session(generateLevel(1));
    const tray = s.trays[0];
    const g = grabbable(s, tray.kind);
    const c = center(tray);
    moveGrain(s, g, c.x, c.y);
    expect(g.state).toBe('sorted');
    expect(tray.count).toBe(1);
    expect(s.sortedCount).toBe(1);
    expect(s.mistakes).toBe(0);
  });

  it('чужой лоток — ошибка, зерно возвращается на стол', () => {
    const s = new Session(generateLevel(1));
    const tray = s.trays[0];
    const filler = grabbable(s, s.config.fillers[0]);
    const c = center(tray);
    moveGrain(s, filler, c.x, c.y);
    expect(s.mistakes).toBe(1);
    expect(filler.state).toBe('free');
    expect(tray.count).toBe(0);
    for (let i = 0; i < 120; i++) s.update(1 / 60);
    expect(filler.y).toBeLessThanOrEqual(TABLE_BOTTOM);
  });

  it('промах мимо зёрен ничего не берёт', () => {
    const s = new Session(generateLevel(1));
    s.pointerDown(30, 30);
    expect(s.heldGrain).toBeNull();
  });

  it('разобрав все цели, уровень выигран', () => {
    const s = new Session(generateLevel(1));
    const tray = s.trays[0];
    const c = center(tray);
    let guard = 0;
    while (s.status === 'playing' && guard++ < 200) {
      moveGrain(s, grabbable(s, tray.kind), c.x, c.y);
    }
    expect(s.status).toBe('won');
    expect(s.stars()).toBe(3);
    expect(s.drainEvents().some((e) => e.type === 'won')).toBe(true);
  });

  it('по истечении времени уровень проигран', () => {
    const cfg = generateLevel(5);
    const s = new Session(cfg);
    const steps = Math.ceil((cfg.timeLimit ?? 0) / 0.5) + 1;
    for (let i = 0; i < steps; i++) s.update(0.5);
    expect(s.status).toBe('lost');
    expect(s.stars()).toBe(0);
  });

  it('разгребание сдвигает зёрна', () => {
    const s = new Session(generateLevel(2));
    const before = s.grains.map((g) => ({ x: g.x, y: g.y }));
    // Ведём палочками сквозь кучу, начиная с пустого места.
    s.pointerDown(150, 390);
    expect(s.heldGrain).toBeNull();
    for (let x = 150; x <= 850; x += 10) {
      s.pointerMove(x, 390);
      s.update(1 / 60);
    }
    s.pointerUp();
    const moved = s.grains.filter((g, i) => Math.hypot(g.x - before[i].x, g.y - before[i].y) > 5).length;
    expect(moved).toBeGreaterThan(5);
  });
});
