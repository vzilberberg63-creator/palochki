import { generateLevel } from '../src/core/level';
import { Grain, Session, TOUCH_LIFT } from '../src/core/session';
import { SQUARE, layoutForViewport } from '../src/core/world';

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
      expect(g.y).toBeLessThanOrEqual(s.layout.table.maxY);
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
    expect(filler.y).toBeLessThanOrEqual(s.layout.table.maxY);
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

describe('Раскладки под экран', () => {
  const phone = layoutForViewport(374, 780);
  const phoneLandscape = layoutForViewport(828, 326);
  const desktop = layoutForViewport(1264, 736);

  it('выбирает раскладку по форме экрана', () => {
    expect(layoutForViewport(900, 900)).toBe(SQUARE);
    expect(phone.kind).toBe('portrait');
    expect(phone.w).toBe(600);
    expect(phoneLandscape.kind).toBe('wide');
    expect(phoneLandscape.h).toBe(600);
    expect(phoneLandscape.trayDirection).toBe('column');
    expect(desktop.kind).toBe('wide');
  });

  it('на телефоне зёрна заметно крупнее, чем в квадратном мире', () => {
    const scale = (l: { w: number; h: number }, w: number, h: number) => Math.min(w / l.w, h / l.h);
    expect(scale(phone, 374, 780)).toBeGreaterThan(scale(SQUARE, 374, 780) * 1.5);
    expect(scale(phoneLandscape, 828, 326)).toBeGreaterThan(scale(SQUARE, 828, 326) * 1.5);
  });

  for (const [name, layout] of [
    ['portrait', phone],
    ['wide', phoneLandscape],
    ['square', SQUARE],
  ] as const) {
    it(`${name}: зёрна на столе, лотки в мире и не пересекают стол`, () => {
      for (const level of [1, 12, 30, 60]) {
        const s = new Session(generateLevel(level), layout);
        const t = layout.table;
        for (const g of s.grains) {
          expect(g.x - g.r).toBeGreaterThanOrEqual(t.minX - 0.001);
          expect(g.x + g.r).toBeLessThanOrEqual(t.maxX + 0.001);
          expect(g.y - g.r).toBeGreaterThanOrEqual(t.minY - 0.001);
          expect(g.y + g.r).toBeLessThanOrEqual(t.maxY + 0.001);
        }
        for (const tr of s.trays) {
          expect(tr.x).toBeGreaterThanOrEqual(0);
          expect(tr.y).toBeGreaterThanOrEqual(0);
          expect(tr.x + tr.w).toBeLessThanOrEqual(layout.w);
          expect(tr.y + tr.h).toBeLessThanOrEqual(layout.h);
          const overlaps = tr.x < t.maxX && tr.x + tr.w > t.minX && tr.y < t.maxY && tr.y + tr.h > t.minY;
          expect(overlaps).toBe(false);
        }
      }
    });
  }

  it('ошибка в боковом лотке возвращает зерно на стол', () => {
    const s = new Session(generateLevel(1), phoneLandscape);
    const tray = s.trays[0];
    const filler = grabbable(s, s.config.fillers[0]);
    moveGrain(s, filler, tray.x + tray.w / 2, tray.y + tray.h / 2);
    expect(s.mistakes).toBe(1);
    for (let i = 0; i < 120; i++) s.update(1 / 60);
    expect(filler.x).toBeLessThanOrEqual(phoneLandscape.table.maxX);
  });

  it('касанием зерно поднимается над пальцем и попадает в лоток по своему положению', () => {
    const s = new Session(generateLevel(1), phone);
    const tray = s.trays[0];
    const g = grabbable(s, tray.kind);
    s.pointerDown(g.x, g.y, true);
    expect(s.heldGrain).toBe(g);
    for (let i = 0; i < 40; i++) s.update(1 / 60);
    expect(s.chop.pointerY - g.y).toBeGreaterThan(TOUCH_LIFT * 0.9);
    // Палец ниже центра лотка ровно на высоту подъёма — зерно над центром.
    s.pointerMove(tray.x + tray.w / 2, tray.y + tray.h / 2 + TOUCH_LIFT);
    for (let i = 0; i < 40; i++) s.update(1 / 60);
    s.pointerUp();
    expect(g.state).toBe('sorted');
  });

  it('палец захватывает с большим радиусом, чем мышь', () => {
    const s = new Session(generateLevel(1), phone);
    // Одиночное зерно в пустом месте стола, чтобы рядом не было других.
    const g = s.grains[0];
    g.x = 60;
    g.y = 60;
    const off = g.r + s.config.grabRadius + 5;
    s.pointerDown(g.x + off, g.y);
    expect(s.heldGrain).toBeNull();
    s.pointerUp();
    s.pointerDown(g.x + off, g.y, true);
    expect(s.heldGrain).toBe(g);
  });
});
