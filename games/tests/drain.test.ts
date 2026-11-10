import { DRY_LEVEL, DrainModel, GRATE_H, GRATE_W, KINDS, SIDEWALK, WORLD_W, makeLevel } from '../drain/drain';
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

/**
 * Бот-игрок: сметает мусор у решёток на ближний тротуар, потом скребёт грязь,
 * потом убирает то, что плавает. pause — пауза между мазками, с.
 */
function playBot(m: DrainModel, pause: number, cap = 300): number {
  let t = 0;
  let wait = 0;
  let st: { x0: number; y0: number; x1: number; y1: number; k: number; dur: number } | null = null;
  while (!m.won && !m.over && t < cap) {
    if (!st) {
      wait -= 1 / 60;
      if (wait <= 0) {
        let pick: { x0: number; y0: number; x1: number; y1: number; dur: number } | null = null;
        for (let gi = 0; gi < m.grates.length && !pick; gi++) {
          const g = m.grates[gi];
          const near = m.debris.filter((d) => d.collected === 0 && d.x > g.x - 45 && d.x < g.x + g.w + 45 && d.y > g.y - 45 && d.y < g.y + g.h + 45);
          if (near.length) {
            const d = near[Math.floor(near.length / 2)];
            const left = d.x < WORLD_W / 2;
            pick = { x0: left ? d.x + 70 : d.x - 70, y0: d.y, x1: left ? SIDEWALK - 30 : WORLD_W - SIDEWALK + 30, y1: d.y, dur: 0.7 };
          } else if (m.open(gi) < 0.95) {
            const y = g.y + 8 + ((Math.floor(t * 3) % 5) / 4) * (GRATE_H - 16);
            pick = { x0: g.x - 30, y0: y, x1: g.x + GRATE_W + 30, y1: y, dur: 0.45 };
          }
        }
        if (pick) {
          st = { ...pick, k: 0 };
          m.rakeDown(pick.x0, pick.y0);
        }
        wait = pause;
      }
    } else {
      st.k += 1 / 60 / st.dur;
      const k = Math.min(1, st.k);
      m.rakeMove(st.x0 + (st.x1 - st.x0) * k, st.y0 + (st.y1 - st.y0) * k);
      if (st.k >= 1) {
        m.rakeUp();
        st = null;
      }
    }
    m.update(1 / 60);
    t += 1 / 60;
  }
  return t;
}

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

describe('Уровни', () => {
  it('первый уровень простой: одна решётка, листья, без грязи и дождя', () => {
    const l = makeLevel(1);
    expect(l.grates).toHaveLength(1);
    expect(l.pile.bottle + l.pile.bag).toBe(0);
    expect(l.mud).toBe(0);
    expect(l.rain).toBe(0);
  });

  it('дальше появляются грязь, вторая и третья решётка, дождь', () => {
    expect(makeLevel(3).mud).toBeGreaterThan(0);
    expect(makeLevel(4).grates).toHaveLength(2);
    expect(makeLevel(6).rain).toBeGreaterThan(0);
    expect(makeLevel(9).grates).toHaveLength(3);
    expect(makeLevel(20).pile.leaf).toBeGreaterThan(makeLevel(1).pile.leaf);
    expect(makeLevel(20).par).toBeGreaterThan(makeLevel(1).par);
    expect(() => makeLevel(0)).toThrow();
  });

  it('решётки лежат на дороге и не перекрываются', () => {
    for (const n of [1, 4, 9]) {
      const m = new DrainModel(n, seq(1));
      m.grates.forEach((g, i) => {
        expect(g.x).toBeGreaterThan(SIDEWALK);
        expect(g.x + g.w).toBeLessThan(WORLD_W - SIDEWALK);
        expect(g.cells.length).toBeGreaterThan(20);
        for (const o of m.grates.slice(i + 1)) {
          expect(g.x + g.w < o.x || o.x + o.w < g.x || g.y + g.h < o.y || o.y + o.h < g.y).toBe(true);
        }
      });
    }
  });
});

describe('Старт уровня', () => {
  it('улица залита на заданную долю, тротуары сухие, решётки забиты наглухо', () => {
    for (const n of [1, 3, 6, 12]) {
      const m = new DrainModel(n, seq(2));
      expect(m.flood).toBeCloseTo(m.level.startFlood, 2);
      let side = 0;
      for (let i = 0; i < m.water.length; i++) if (!m.road[i]) side += m.water[i];
      expect(side).toBe(0);
      for (let g = 0; g < m.grates.length; g++) expect(m.open(g)).toBe(0);
    }
  });

  it('вода глубже у решётки, чем вдали от неё', () => {
    const m = new DrainModel(1, seq(1));
    const g = m.grates[0];
    const at = (x: number, y: number) => m.water[Math.floor(y / 15) * 40 + Math.floor(x / 15)];
    expect(at(g.x + g.w / 2, g.y + g.h / 2)).toBeGreaterThan(at(g.x + g.w / 2, 40));
  });

  it('сам по себе уровень не проходится: без дождя вода стоит', () => {
    const m = new DrainModel(2, seq(1));
    run(m, 60);
    expect(m.won).toBe(false);
    expect(m.over).toBe(false);
    expect(m.flood).toBeGreaterThan(m.level.startFlood * 0.95);
  });
});

describe('Расчистка', () => {
  it('мазок сметает мусор с решётки на тротуар: решётка открывается, очки начислены', () => {
    const m = new DrainModel(1, seq(1));
    const g = m.grates[0];
    m.debris = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => ({ id: i + 1, kind: 'leaf' as const, x: g.x + 15 + (i % 6) * 18, y: g.y + 25 + Math.floor(i / 6) * 22, vx: 0, vy: 0, r: 9, angle: 0, look: 0, collected: 0 }));
    expect(m.open(0)).toBe(0);
    stroke(m, g.x + g.w + 60, g.y + g.h / 2, SIDEWALK - 40, g.y + g.h / 2, 0.9);
    run(m, 1);
    // Один мазок сметает большую часть кучи. Остатки сошли с краёв граблей,
    // и течение может затянуть лист-другой обратно на решётку.
    expect(m.open(0)).toBeGreaterThanOrEqual(0.7);
    expect(m.score).toBeGreaterThanOrEqual(8);
    expect(m.drainEvents().some((e) => e.type === 'breakthrough')).toBe(true);
  });

  it('пакет закрывает решётку сильнее листа', () => {
    const m = new DrainModel(1, seq(1));
    const g = m.grates[0];
    const one = (kind: 'leaf' | 'bag') => {
      m.debris = [{ id: 1, kind, x: g.x + g.w / 2, y: g.y + g.h / 2, vx: 0, vy: 0, r: KINDS[kind].r, angle: 0, look: 0, collected: 0 }];
      return m.open(0);
    };
    expect(one('bag')).toBeLessThan(one('leaf'));
  });

  it('грязь закрывает решётку и соскребается граблями за несколько проходов', () => {
    const m = new DrainModel(3, seq(1));
    m.debris = [];
    const g = m.grates[0];
    const before = m.open(0);
    expect(before).toBeLessThan(0.6);
    stroke(m, g.x - 30, g.y + g.h / 2, g.x + g.w + 30, g.y + g.h / 2, 0.5);
    const afterOne = m.open(0);
    expect(afterOne).toBeGreaterThan(before);
    expect(afterOne).toBeLessThan(1);
    for (let k = 0; k < 6; k++) {
      for (const y of [g.y + 10, g.y + g.h / 2, g.y + g.h - 10]) stroke(m, g.x - 30, y, g.x + g.w + 30, y, 0.4);
    }
    expect(m.open(0)).toBe(1);
  });

  it('открытая решётка спускает воду, улица высыхает — победа со звёздами', () => {
    const m = new DrainModel(1, seq(1));
    m.debris = [];
    expect(m.open(0)).toBe(1);
    run(m, 40);
    expect(m.flood).toBeLessThan(DRY_LEVEL);
    expect(m.won).toBe(true);
    expect(m.stars()).toBeGreaterThanOrEqual(1);
    // Вода уходит не мгновенно: момент должен длиться.
    expect(m.time).toBeGreaterThan(6);
    // После победы игра стоит.
    const t = m.time;
    m.update(1);
    expect(m.time).toBe(t);
  });

  it('течение тянет мусор к открытой решётке', () => {
    const m = new DrainModel(1, seq(1));
    const g = m.grates[0];
    m.debris = [{ id: 1, kind: 'leaf', x: g.x + g.w / 2 + 5, y: g.y - 160, vx: 0, vy: 0, r: 9, angle: 0, look: 0, collected: 0 }];
    const leaf = m.debris[0];
    const start = leaf.y;
    // В стоячей луже течение слабое и разгоняется, когда вода пошла в решётку.
    run(m, 8);
    expect(leaf.y).toBeGreaterThan(start + 40);
    expect(Math.abs(leaf.x - (g.x + g.w / 2))).toBeLessThan(30);
  });

  it('поднятые грабли ничего не двигают', () => {
    const m = new DrainModel(1, seq(1));
    const before = m.debris.map((d) => [d.x, d.y]);
    m.rakeMove(100, 100);
    m.rakeMove(500, 800);
    m.update(1 / 60);
    const moved = m.debris.filter((d, i) => Math.hypot(d.x - before[i][0], d.y - before[i][1]) > 2).length;
    expect(moved).toBe(0);
  });
});

describe('Дождь', () => {
  it('на дождливом уровне без действий улицу заливает, но не мгновенно', () => {
    const m = new DrainModel(6, seq(1));
    let t = 0;
    while (!m.over && t < 200) {
      m.update(1 / 60);
      t += 1 / 60;
    }
    expect(m.over).toBe(true);
    expect(t).toBeGreaterThan(20);
    expect(m.drainEvents().some((e) => e.type === 'flood')).toBe(true);
    m.revive();
    expect(m.over).toBe(false);
    expect(m.flood).toBeLessThan(0.6);
  });
});

describe('Проходимость', () => {
  it.each([1, 3, 4, 6, 9, 15])('уровень %i проходится ботом, быстрый бот берёт три звезды', (n) => {
    const fast = new DrainModel(n, seq(1));
    playBot(fast, 0.25);
    expect(fast.won).toBe(true);
    expect(fast.stars()).toBe(3);
    const slow = new DrainModel(n, seq(2));
    playBot(slow, 1.2);
    expect(slow.won).toBe(true);
  });
});
