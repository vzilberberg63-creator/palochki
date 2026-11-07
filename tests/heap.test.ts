import { HeapSession } from '../src/core/heap';
import { generateHeapLevel } from '../src/core/level';
import { Grain } from '../src/core/session';
import { SQUARE, heapLayout, layoutForViewport } from '../src/core/world';

const layout = heapLayout(SQUARE);

/** Ведёт прижатую лопатку из (x0, y0) в (x1, y1) с шагом step за кадр. */
function sweep(s: HeapSession, x0: number, y0: number, x1: number, y1: number, step = 8): void {
  s.pointerDown(x0, y0);
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step);
  for (let i = 1; i <= n; i++) {
    s.pointerMove(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n);
    s.update(1 / 60);
  }
  s.pointerUp();
  for (let i = 0; i < 30; i++) s.update(1 / 60);
}

/** Убирает все зёрна со стола, кроме переданных, и ставит их кучкой. */
function only(s: HeapSession, grains: Grain[], cx: number, cy: number): void {
  for (const g of s.grains) {
    if (!grains.includes(g)) {
      g.state = 'sorted';
      g.x = -1000;
    }
  }
  grains.forEach((g, i) => {
    g.state = 'free';
    g.x = cx + (i % 3) * 14 - 14;
    g.y = cy + Math.floor(i / 3) * 14;
    g.vx = g.vy = 0;
  });
}

describe('generateHeapLevel', () => {
  it('детерминирован, с таймером, лопаткой и не больше трёх копилок', () => {
    expect(generateHeapLevel(9)).toEqual(generateHeapLevel(9));
    for (let i = 1; i <= 80; i++) {
      const l = generateHeapLevel(i);
      expect(l.mode).toBe('heap');
      expect(l.targets.length).toBeGreaterThan(0);
      expect(l.targets.length).toBeLessThanOrEqual(3);
      expect(l.timeLimit).toBeGreaterThan(0);
      expect(l.bladeHalfWidth).toBeGreaterThan(0);
      for (const f of l.fillers) expect(l.targets).not.toContain(f);
    }
    expect(generateHeapLevel(1).targets).toEqual(['riceBlack']);
    expect(generateHeapLevel(80).bladeHalfWidth).toBeLessThan(generateHeapLevel(1).bladeHalfWidth);
  });
});

describe('HeapSession', () => {
  it('куча появляется на свободной части стола, не в копилках', () => {
    for (const level of [1, 3, 20, 60]) {
      for (const base of [SQUARE, layoutForViewport(374, 780), layoutForViewport(828, 326)]) {
        const l = heapLayout(base);
        const s = new HeapSession(generateHeapLevel(level), l);
        expect(s.sortedCount).toBe(0);
        for (const g of s.grains) {
          expect(g.y).toBeLessThanOrEqual(l.pileArea!.maxY);
          expect(g.x).toBeLessThanOrEqual(l.pileArea!.maxX);
        }
        s.update(1 / 60);
        expect(s.sortedCount).toBe(0);
        expect(s.mistakes).toBe(0);
      }
    }
  });

  it('лопатка ведёт кучку целиком, а не проскакивает сквозь неё', () => {
    const s = new HeapSession(generateHeapLevel(1), layout);
    const heap = s.grains.filter((g) => g.kind === 'riceWhite').slice(0, 9);
    only(s, heap, 500, 300);
    // Ведём быстро (20 единиц за кадр) сверху вниз через кучку.
    sweep(s, 500, 200, 500, 600, 20);
    const ys = heap.map((g) => g.y);
    // Почти все зёрна уехали вместе с лопаткой, а не остались на месте.
    expect(ys.filter((y) => y > 450).length).toBeGreaterThanOrEqual(7);
    // И кучка не разлетелась в стороны.
    const xs = heap.map((g) => g.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(160);
  });

  it('кучка, сдвинутая в свою копилку, засчитывается целиком и даёт комбо', () => {
    const s = new HeapSession(generateHeapLevel(1), layout);
    const tray = s.trays[0];
    const black = s.grains.filter((g) => g.kind === tray.kind);
    only(s, black, tray.x + tray.w / 2, tray.y - 120);
    sweep(s, tray.x + tray.w / 2, tray.y - 180, tray.x + tray.w / 2, tray.y + tray.h - 20);
    expect(s.sortedCount).toBe(black.length);
    expect(tray.count).toBe(black.length);
    expect(s.status).toBe('won');
    expect(s.bestCombo).toBe(black.length);
    expect(s.score).toBeGreaterThan(black.length * 10);
  });

  it('чужое зерно в копилке — ошибка, и пока оно там, уровень не пройден', () => {
    const s = new HeapSession(generateHeapLevel(1), layout);
    const tray = s.trays[0];
    const black = s.grains.filter((g) => g.kind === tray.kind);
    const white = s.grains.find((g) => g.kind === 'riceWhite')!;
    only(s, [...black, white], tray.x + tray.w / 2, tray.y - 120);
    sweep(s, tray.x + tray.w / 2, tray.y - 180, tray.x + tray.w / 2, tray.y + tray.h - 20);
    expect(s.sortedCount).toBe(black.length);
    expect(s.mistakes).toBe(1);
    expect(s.intruders.has(white.id)).toBe(true);
    expect(s.status).toBe('playing');

    // Выталкиваем белое зерно вверх из копилки.
    white.x = tray.x + tray.w / 2;
    sweep(s, white.x, tray.y + tray.h + 40, white.x, tray.y - 200);
    expect(s.intruders.size).toBe(0);
    expect(s.status).toBe('won');
    expect(s.mistakes).toBe(1);
  });

  it('поднятые палочки ничего не двигают', () => {
    const s = new HeapSession(generateHeapLevel(2), layout);
    const before = s.grains.map((g) => [g.x, g.y]);
    s.pointerMove(200, 390);
    for (let x = 200; x <= 800; x += 10) {
      s.pointerMove(x, 390);
      s.update(1 / 60);
    }
    const moved = s.grains.filter((g, i) => Math.hypot(g.x - before[i][0], g.y - before[i][1]) > 1).length;
    expect(moved).toBe(0);
  });

  it('лопатка разворачивается поперёк движения', () => {
    const s = new HeapSession(generateHeapLevel(1), layout);
    s.pointerDown(100, 100);
    for (let x = 100; x <= 300; x += 10) {
      s.pointerMove(x, 100);
      s.update(1 / 60);
    }
    expect(s.chop.bladeDirX).toBeCloseTo(1, 2);
    expect(Math.abs(s.chop.bladeDirY)).toBeLessThan(0.05);
  });
});

describe('Разворот лопатки', () => {
  it('разворачивается и при движении строго назад', () => {
    const s = new HeapSession(generateHeapLevel(1), layout);
    // По умолчанию лопатка смотрит вверх; ведём вниз.
    expect(s.chop.bladeDirY).toBeCloseTo(-1, 5);
    s.pointerDown(500, 100);
    for (let y = 100; y <= 300; y += 8) {
      s.pointerMove(500, y);
      s.update(1 / 60);
    }
    expect(s.chop.bladeDirY).toBeGreaterThan(0.99);
  });
});

describe('Чужие зёрна в копилке', () => {
  it('нажатие выбрасывает зерно, повторный заезд не добавляет ошибку', () => {
    const s = new HeapSession(generateHeapLevel(1), layout);
    const tray = s.trays[0];
    const white = s.grains.find((g) => g.kind === 'riceWhite')!;
    only(s, [white], tray.x + tray.w / 2, tray.y - 60);
    // Загоняем к самому бортику: лопаткой оттуда не вытолкнуть.
    sweep(s, white.x, tray.y - 120, white.x, s.layout.table.maxY - 10);
    expect(s.intruders.has(white.id)).toBe(true);
    expect(s.mistakes).toBe(1);

    // Нажатие на зерно выбрасывает его из копилки, сгребание не начинается.
    s.pointerDown(white.x, white.y);
    expect(s.chop.pressed).toBe(false);
    s.pointerUp();
    for (let i = 0; i < 30; i++) s.update(1 / 60);
    expect(s.intruders.size).toBe(0);
    expect(white.y).toBeLessThan(tray.y);

    // Снова загоняем то же зерно — ошибок по-прежнему одна.
    sweep(s, white.x, white.y - 60, white.x, s.layout.table.maxY - 10);
    expect(s.intruders.has(white.id)).toBe(true);
    expect(s.mistakes).toBe(1);
  });

  it('нажатие мимо чужих зёрен начинает сгребание', () => {
    const s = new HeapSession(generateHeapLevel(1), layout);
    s.pointerDown(100, 100);
    expect(s.chop.pressed).toBe(true);
  });
});
