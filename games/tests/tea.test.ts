import { PATIENCE, START_LIVES, STREAM_SPEED, SPOUT, TABLE_Y, TeaModel, makeCup } from '../tea/tea';

/** Детерминированный генератор для тестов. */
function seq(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function run(m: TeaModel, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 60) m.update(1 / 60);
}

/** Ждём, пока чашка встанет под носик. */
function ready(m: TeaModel): void {
  let guard = 0;
  while (m.phase !== 'ready' && guard++ < 600) m.update(1 / 60);
}

/** Сколько секунд держать, чтобы чай встал на середину полосы (без учёта наклона на краях). */
function holdForMiddle(m: TeaModel): number {
  const c = m.cup;
  const mid = (c.lo + c.hi) / 2;
  // Объём = flow * (время держания), наклон в начале и в конце съедает примерно половину своих долей.
  return (mid * c.w) / c.flow + 0.16 / 2 - 0.12 / 2;
}

describe('Налей чаю', () => {
  it('первые чашки стоят на месте и ровные', () => {
    const rng = seq(3);
    for (let n = 0; n < 8; n++) {
      const c = makeCup(n, rng);
      expect(c.speed).toBe(0);
      expect(c.lo).toBeLessThan(c.hi);
      expect(c.hi).toBeLessThan(c.h);
    }
  });

  it('полоса сужается, позже появляются едущие чашки и неровный напор', () => {
    const rng = seq(5);
    const early = makeCup(0, rng);
    const late = Array.from({ length: 30 }, (_, i) => makeCup(60 + i, rng));
    expect(Math.min(...late.map((c) => (c.hi - c.lo) / c.h))).toBeLessThan((early.hi - early.lo) / early.h);
    expect(late.some((c) => c.speed > 0)).toBe(true);
    expect(late.every((c) => c.wobble > 0)).toBe(true);
  });

  it('струя долетает не сразу: после отпускания чай ещё прибывает', () => {
    const m = new TeaModel(seq(1));
    ready(m);
    m.press();
    run(m, 0.5);
    m.release();
    const atRelease = m.volume;
    run(m, 0.6);
    expect(m.volume).toBeGreaterThan(atRelease * 1.3);
    // Время полёта от носика до дна.
    expect((TABLE_Y - SPOUT.y) / STREAM_SPEED).toBeGreaterThan(0.4);
  });

  it('вовремя отпустил — «идеально» и очки', () => {
    const m = new TeaModel(seq(1));
    ready(m);
    m.press();
    run(m, holdForMiddle(m));
    m.release();
    run(m, 1);
    const verdicts = m.drainEvents().filter((e) => e.type === 'verdict');
    expect(verdicts).toHaveLength(1);
    expect(['perfect', 'good']).toContain((verdicts[0] as { verdict: string }).verdict);
    expect(m.score).toBeGreaterThan(0);
    expect(m.lives).toBe(START_LIVES);
  });

  it('держал слишком долго — перелил, минус жизнь', () => {
    const m = new TeaModel(seq(1));
    ready(m);
    m.press();
    run(m, 4);
    m.release();
    run(m, 1);
    expect(m.lastVerdict).toBe('overflow');
    expect(m.lives).toBe(START_LIVES - 1);
  });

  it('отпустил слишком рано — мало', () => {
    const m = new TeaModel(seq(1));
    ready(m);
    m.press();
    run(m, 0.2);
    m.release();
    run(m, 1);
    expect(m.lastVerdict).toBe('under');
    expect(m.lives).toBe(START_LIVES - 1);
  });

  it('вторая попытка в ту же чашку не даётся', () => {
    const m = new TeaModel(seq(1));
    ready(m);
    m.press();
    run(m, 0.1);
    m.release();
    run(m, 0.05);
    m.press();
    expect(m.pressing).toBe(false);
  });

  it('не начал лить — чашка уходит, «не успел»', () => {
    const m = new TeaModel(seq(1));
    ready(m);
    run(m, PATIENCE + 0.2);
    expect(m.lastVerdict).toBe('miss');
    expect(m.lives).toBe(START_LIVES - 1);
  });

  it('после трёх промахов игра окончена, реклама даёт ещё одну жизнь', () => {
    const m = new TeaModel(seq(1));
    for (let i = 0; i < START_LIVES; i++) {
      ready(m);
      run(m, PATIENCE + 0.2);
    }
    run(m, 1.1);
    expect(m.over).toBe(true);
    m.revive();
    expect(m.over).toBe(false);
    expect(m.lives).toBe(1);
    ready(m);
    expect(m.phase).toBe('ready');
  });

  it('струя мимо едущей чашки — пролил', () => {
    const m = new TeaModel(seq(1));
    // Подменяем чашку на едущую, которая уже проехала носик.
    ready(m);
    m.cup.speed = 120;
    m.cup.x = SPOUT.x - 200;
    m.press();
    run(m, 0.6);
    m.release();
    run(m, 1);
    expect(m.lastVerdict).toBe('spill');
  });
});
