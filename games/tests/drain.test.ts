import { DrainModel, GRATE, KINDS, SIDEWALK, WORLD_H, WORLD_W } from '../drain/drain';
import { integrate, scrape, separate } from '../shared/particles';

const seq = (seed: number) => {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
};

function run(m: DrainModel, seconds: number, each?: () => void): void {
  for (let t = 0; t < seconds; t += 1 / 60) {
    each?.();
    m.update(1 / 60);
  }
}

/** Один мазок граблями из (x0, y0) в (x1, y1) за duration секунд. */
function stroke(m: DrainModel, x0: number, y0: number, x1: number, y1: number, duration = 0.6): void {
  m.rakeDown(x0, y0);
  const n = Math.ceil(duration * 60);
  for (let i = 1; i <= n; i++) {
    m.rakeMove(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n);
    m.update(1 / 60);
  }
  m.rakeUp();
}

const gx = GRATE.x + GRATE.w / 2;
const gy = GRATE.y + GRATE.h / 2;

describe('Частицы', () => {
  it('отрезок сгребает частицу перед собой и не трогает дальнюю', () => {
    const near = { x: 100, y: 95, vx: 0, vy: 0, r: 8 };
    const far = { x: 300, y: 95, vx: 0, vy: 0, r: 8 };
    const n = scrape([near, far], { x1: 60, y1: 100, x2: 140, y2: 100, r: 6, vx: 0, vy: -200 });
    expect(n).toBe(1);
    expect(near.y).toBeLessThan(95);
    expect(near.vy).toBeLessThan(-100);
    expect(far.y).toBe(95);
  });

  it('перекрывающиеся частицы расталкиваются, границы держат', () => {
    const a = { x: 50, y: 50, vx: 0, vy: 0, r: 10 };
    const b = { x: 55, y: 50, vx: 0, vy: 0, r: 10 };
    separate([a, b]);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(19.99);
    const c = { x: 5, y: 5, vx: -500, vy: -500, r: 10 };
    integrate([c], 0.1, 0, { minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(c.x).toBe(10);
    expect(c.y).toBe(10);
  });
});

describe('Вода', () => {
  it('на тротуарах воды нет, на дороге она прибывает от дождя', () => {
    const m = new DrainModel(seq(1));
    m.debris = [];
    run(m, 2);
    let side = 0;
    let road = 0;
    for (let i = 0; i < m.water.length; i++) (m.road[i] ? (road += m.water[i]) : (side += m.water[i]));
    expect(side).toBe(0);
    expect(road).toBeGreaterThan(0);
  });

  it('чистая решётка справляется с дождём', () => {
    const m = new DrainModel(seq(1));
    run(m, 120, () => {
      m.debris = [];
    });
    expect(m.flood).toBeLessThan(0.25);
    expect(m.drainFlow).toBeGreaterThan(0.2);
    expect(m.over).toBe(false);
  });

  it('вода течёт к решётке', () => {
    const m = new DrainModel(seq(1));
    run(m, 10, () => {
      m.debris = [];
    });
    // Выше решётки течение направлено вниз, левее — вправо.
    expect(m.flowAt(gx, gy - 200).y).toBeGreaterThan(0);
    expect(m.flowAt(gx - 150, gy).x).toBeGreaterThan(0);
    // На тротуаре течения нет.
    expect(m.flowAt(20, 300)).toEqual({ x: 0, y: 0 });
  });

  it('забитая решётка почти не пропускает — дорогу заливает', () => {
    const m = new DrainModel(seq(1));
    const bags = () => {
      m.debris = [0, 1, 2, 3].map((i) => ({ id: 900 + i, kind: 'bag' as const, x: GRATE.x + 20 + i * 27, y: gy, vx: 0, vy: 0, r: 19, angle: 0, look: 0, collected: 0 }));
    };
    bags();
    expect(m.open).toBeLessThan(0.1);
    run(m, 60, bags);
    expect(m.over).toBe(true);
    expect(m.drainEvents().some((e) => e.type === 'flood')).toBe(true);
  });
});

describe('Мусор и грабли', () => {
  it('течение сносит лист к решётке', () => {
    const m = new DrainModel(seq(1));
    m.debris = [{ id: 1, kind: 'leaf', x: gx, y: gy - 300, vx: 0, vy: 0, r: 9, angle: 0, look: 0, collected: 0 }];
    const leaf = m.debris[0];
    (m as unknown as { spawnIn: number }).spawnIn = 1e9;
    run(m, 20);
    expect(leaf.y).toBeGreaterThan(gy - 120);
  });

  it('мусор на решётке её забивает, разные виды — по-разному', () => {
    const m = new DrainModel(seq(1));
    m.debris = [];
    expect(m.open).toBe(1);
    m.debris = [{ id: 1, kind: 'leaf', x: gx, y: gy, vx: 0, vy: 0, r: 9, angle: 0, look: 0, collected: 0 }];
    const leaf = m.open;
    m.debris[0].kind = 'bag';
    expect(m.open).toBeLessThan(leaf);
    expect(KINDS.bag.block).toBeGreaterThan(KINDS.leaf.block);
  });

  it('мазок граблями сметает мусор с решётки на тротуар — решётка чистая, очки начислены', () => {
    const m = new DrainModel(seq(1));
    (m as unknown as { spawnIn: number }).spawnIn = 1e9;
    m.debris = [0, 1, 2, 3, 4].map((i) => ({ id: i + 1, kind: 'leaf' as const, x: gx - 30 + i * 15, y: gy - 10 + (i % 2) * 18, vx: 0, vy: 0, r: 9, angle: 0, look: 0, collected: 0 }));
    expect(m.open).toBeLessThan(1);
    stroke(m, GRATE.x + GRATE.w + 60, gy, SIDEWALK - 40, gy, 0.9);
    run(m, 1);
    expect(m.open).toBe(1);
    expect(m.score).toBe(5);
    expect(m.debris.length).toBe(0);
  });

  it('поднятые грабли ничего не двигают', () => {
    const m = new DrainModel(seq(1));
    (m as unknown as { spawnIn: number }).spawnIn = 1e9;
    m.debris = [{ id: 1, kind: 'bottle', x: 300, y: 150, vx: 0, vy: 0, r: 12, angle: 0, look: 0, collected: 0 }];
    m.rakeMove(300, 100);
    m.rakeMove(300, 300);
    m.update(1 / 60);
    // Бутылку могло чуть сдвинуть только течение, но не грабли.
    expect(Math.abs(m.debris[0].y - 150)).toBeLessThan(3);
  });

  it('мусор появляется на дороге, не на решётке, и его становится больше', () => {
    const m = new DrainModel(seq(4));
    for (const d of m.debris) {
      expect(d.x).toBeGreaterThan(SIDEWALK);
      expect(d.x).toBeLessThan(WORLD_W - SIDEWALK);
      expect(d.y).toBeLessThan(WORLD_H);
      expect(Math.hypot(d.x - gx, d.y - gy)).toBeGreaterThanOrEqual(150);
    }
    const count = (from: number, to: number) => {
      const mm = new DrainModel(seq(4));
      let n = 0;
      run(mm, to, () => {
        if (mm.over) mm.revive();
        if (mm.time >= from) n += mm.drainEvents().filter((e) => e.type === 'spawn').length;
        else mm.drainEvents();
      });
      return n;
    };
    expect(count(120, 150)).toBeGreaterThan(count(0, 30));
  });
});

describe('Партия', () => {
  it('без действий дорогу заливает, реклама спускает воду и чистит решётку', () => {
    const m = new DrainModel(seq(2));
    let t = 0;
    while (!m.over && t < 300) {
      m.update(1 / 60);
      t += 1 / 60;
    }
    expect(m.over).toBe(true);
    expect(t).toBeGreaterThan(20);
    expect(t).toBeLessThan(90);
    m.revive();
    expect(m.over).toBe(false);
    expect(m.flood).toBeLessThan(0.5);
    expect(m.open).toBe(1);
  });

  it('дождь со временем сильнее', () => {
    const early = new DrainModel(seq(1));
    const late = new DrainModel(seq(1));
    late.time = 300;
    // Сравниваем в одной фазе волны дождя.
    early.time = 300 % ((2 * Math.PI) / 0.35);
    expect(late.rain).toBeGreaterThan(early.rain * 1.5);
  });
});
