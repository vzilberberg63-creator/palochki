import { generateLevel } from '../src/core/level';
import {
  COMBO_WINDOW,
  Grain,
  POINTS_PER_GRAIN,
  Session,
  TIME_BONUS_SECONDS,
  comboMultiplier,
} from '../src/core/session';
import { emptyProgress, mergeProgress, normalizeProgress } from '../src/platform/platform';

/** Кладёт зерно сразу в лоток (или в чужой лоток), минуя физику переноса. */
function drop(s: Session, g: Grain, trayIndex: number): void {
  s.pointerDown(g.x, g.y);
  expect(s.heldGrain).toBe(g);
  const t = s.trays[trayIndex];
  s.pointerMove(t.x + t.w / 2, t.y + t.h / 2);
  s.update(1 / 60);
  s.pointerUp();
}

/** Ставит зерно в пустой угол стола, чтобы захват был однозначным. */
function isolate(s: Session, g: Grain): Grain {
  g.x = s.layout.table.minX + 40;
  g.y = s.layout.table.minY + 40;
  g.vx = g.vy = 0;
  return g;
}

function nextTarget(s: Session, kind = s.trays[0].kind): Grain {
  const g = s.grains.find((x) => x.state === 'free' && x.kind === kind);
  if (!g) throw new Error('no target left');
  return isolate(s, g);
}

describe('comboMultiplier', () => {
  it('растёт по порогам 3, 6, 10', () => {
    expect([1, 2, 3, 5, 6, 9, 10, 25].map(comboMultiplier)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });
});

describe('Комбо', () => {
  it('серия быстрых верных переносов растит множитель и очки', () => {
    const s = new Session(generateLevel(2));
    for (let i = 0; i < 6; i++) drop(s, nextTarget(s), 0);
    expect(s.combo).toBe(6);
    expect(s.bestCombo).toBe(6);
    // 10 + 10 + 20 + 20 + 20 + 30
    expect(s.score).toBe(POINTS_PER_GRAIN * (1 + 1 + 2 + 2 + 2 + 3));
    const events = s.drainEvents();
    const combos = events.filter((e) => e.type === 'combo');
    expect(combos.map((e) => (e.type === 'combo' ? e.multiplier : 0))).toEqual([2, 3]);
  });

  it('пауза дольше окна обрывает серию', () => {
    const s = new Session(generateLevel(2));
    for (let i = 0; i < 3; i++) drop(s, nextTarget(s), 0);
    expect(s.combo).toBe(3);
    s.drainEvents();
    for (let t = 0; t < COMBO_WINDOW + 0.2; t += 0.1) s.update(0.1);
    expect(s.combo).toBe(0);
    expect(s.drainEvents().some((e) => e.type === 'comboLost')).toBe(true);
    drop(s, nextTarget(s), 0);
    expect(s.combo).toBe(1);
    expect(s.bestCombo).toBe(3);
  });

  it('ошибка обрывает серию', () => {
    const s = new Session(generateLevel(2));
    for (let i = 0; i < 4; i++) drop(s, nextTarget(s), 0);
    const filler = isolate(s, s.grains.find((g) => g.state === 'free' && g.kind === s.config.fillers[0])!);
    drop(s, filler, 0);
    expect(s.mistakes).toBe(1);
    expect(s.combo).toBe(0);
    expect(s.bestCombo).toBe(4);
  });

  it('на уровне с таймером каждые 5 подряд дают время', () => {
    const s = new Session(generateLevel(6));
    const kind = s.trays[0].kind;
    const before = s.timeLeft!;
    for (let i = 0; i < 5; i++) drop(s, nextTarget(s, kind), 0);
    const elapsedDuringDrops = 5 / 60;
    expect(s.bonusTime).toBe(TIME_BONUS_SECONDS);
    expect(s.timeLeft!).toBeCloseTo(before + TIME_BONUS_SECONDS - elapsedDuringDrops, 5);
  });

  it('без таймера бонуса времени нет', () => {
    const s = new Session({ ...generateLevel(2), timeLimit: null });
    for (let i = 0; i < 5; i++) drop(s, nextTarget(s), 0);
    expect(s.bonusTime).toBe(0);
  });
});

describe('Рекорды в прогрессе', () => {
  it('старый прогресс без рекордов, монет и стилей читается', () => {
    expect(normalizeProgress({ unlocked: 4, stars: { 1: 3 } })).toEqual({
      ...emptyProgress(),
      unlocked: 4,
      stars: { 1: 3 },
    });
  });

  it('мусор отбрасывается', () => {
    expect(normalizeProgress({ unlocked: 2, stars: {}, best: { 1: 150, x: 5, 2: -1, 3: 'a' } }).best).toEqual({ 1: 150 });
  });

  it('при слиянии берётся лучшее по каждому уровню', () => {
    const a = { ...emptyProgress(), unlocked: 3, stars: { 1: 2 }, best: { 1: 100, 2: 50 } };
    const b = { ...emptyProgress(), unlocked: 2, stars: { 1: 3 }, best: { 1: 80, 2: 70 } };
    const m = mergeProgress(a, b);
    expect(m.unlocked).toBe(3);
    expect(m.stars).toEqual({ 1: 3 });
    expect(m.best).toEqual({ 1: 100, 2: 70 });
  });
});
