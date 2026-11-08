import { CENTER, HalfModel, MIN_SWIPE, START_LIVES, fractionOnSide, gradeError, makeFood, samplePoints } from '../half/half';

function seq(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const square = (half: number) => [
  { x: -half, y: -half },
  { x: half, y: -half },
  { x: half, y: half },
  { x: -half, y: half },
];

/** Модель с заданной едой: квадрат, без вращения. */
function withFood(outline = square(100), holes: { x: number; y: number; r: number }[] = [], target = 0.5) {
  const m = new HalfModel(seq(1));
  m.food = { style: 'cake', outline, holes, target, spin: 0, time: 9 };
  m.points = samplePoints(m.food);
  m.angle = 0;
  while (m.phase !== 'ready') m.update(1 / 60);
  return m;
}

describe('Площадь кусков', () => {
  it('квадрат по центру — пополам, по четверти ширины — четверть', () => {
    const pts = samplePoints({ outline: square(100), holes: [] }, 2);
    expect(fractionOnSide(pts, 0, 0, 0, 1)).toBeCloseTo(0.5, 2);
    const quarter = fractionOnSide(pts, -50, 0, 0, 1);
    expect(Math.min(quarter, 1 - quarter)).toBeCloseTo(0.25, 2);
  });

  it('дырка уменьшает площадь своей половины', () => {
    const pts = samplePoints({ outline: square(100), holes: [{ x: -50, y: 0, r: 40 }] }, 2);
    const f = fractionOnSide(pts, 0, 0, 0, 1);
    // Дырка 5027 из 40000: половина с дыркой 14973 против 20000, доля ≈ 0,572.
    expect(Math.max(f, 1 - f)).toBeCloseTo(20000 / (40000 - Math.PI * 1600), 2);
  });
});

describe('Оценка разреза', () => {
  it('пороги: 1% — идеально, 3% — отлично, 6% — нормально, больше — промах', () => {
    expect(gradeError(0.5).grade).toBe('perfect');
    expect(gradeError(2).grade).toBe('great');
    expect(gradeError(5).grade).toBe('ok');
    expect(gradeError(8).grade).toBe('miss');
  });

  it('разрез ровно посередине — идеально', () => {
    const m = withFood();
    const cut = m.cut(CENTER.x, CENTER.y - 300, CENTER.x, CENTER.y + 300)!;
    expect(cut.grade).toBe('perfect');
    expect(m.score).toBe(5);
    expect(m.lives).toBe(START_LIVES);
  });

  it('направление взмаха не важно', () => {
    const a = withFood().cut(CENTER.x + 20, CENTER.y - 300, CENTER.x + 20, CENTER.y + 300)!;
    const b = withFood().cut(CENTER.x + 20, CENTER.y + 300, CENTER.x + 20, CENTER.y - 300)!;
    expect(a.error).toBeCloseTo(b.error, 5);
  });

  it('криво — промах и минус жизнь', () => {
    const m = withFood();
    const cut = m.cut(CENTER.x + 40, CENTER.y - 300, CENTER.x + 40, CENTER.y + 300)!;
    expect(cut.grade).toBe('miss');
    expect(m.lives).toBe(START_LIVES - 1);
  });

  it('треть: засчитывается меньший кусок', () => {
    const m = withFood(square(100), [], 1 / 3);
    // Квадрат 200: треть — разрез на x = -100 + 66,7.
    const x = CENTER.x - 100 + 200 / 3;
    const cut = m.cut(x, CENTER.y - 300, x, CENTER.y + 300)!;
    expect(cut.small).toBeCloseTo(1 / 3, 1);
    expect(cut.grade).toBe('perfect');
  });

  it('разрез мимо еды и слишком короткий взмах не считаются', () => {
    const m = withFood();
    expect(m.cut(10, 10, 10, 800)).toBeNull();
    expect(m.cut(CENTER.x, CENTER.y, CENTER.x, CENTER.y + MIN_SWIPE - 1)).toBeNull();
    expect(m.phase).toBe('ready');
    expect(m.lives).toBe(START_LIVES);
  });

  it('поворот еды учитывается: разрез по повёрнутой оси', () => {
    const outline = [
      { x: -150, y: -50 },
      { x: 150, y: -50 },
      { x: 150, y: 50 },
      { x: -150, y: 50 },
    ];
    const m = withFood(outline);
    m.angle = Math.PI / 2;
    // Еда повёрнута на 90°: длинная сторона вертикальна. Горизонтальный разрез через центр — пополам.
    const cut = m.cut(CENTER.x - 300, CENTER.y, CENTER.x + 300, CENTER.y)!;
    expect(cut.grade).toBe('perfect');
  });
});

describe('Партия', () => {
  it('время на разрез кончилось — минус жизнь', () => {
    const m = withFood();
    for (let t = 0; t < 9.2; t += 1 / 60) m.update(1 / 60);
    expect(m.lastGrade).toBe('timeout');
    expect(m.lives).toBe(START_LIVES - 1);
  });

  it('три промаха — конец, реклама даёт ещё попытку', () => {
    const m = new HalfModel(seq(2));
    for (let i = 0; i < START_LIVES; i++) {
      while (m.phase !== 'ready') m.update(1 / 60);
      while (m.phase === 'ready') m.update(1 / 60);
    }
    for (let t = 0; t < 1.5; t += 1 / 60) m.update(1 / 60);
    expect(m.over).toBe(true);
    m.revive();
    expect(m.over).toBe(false);
    expect(m.lives).toBe(1);
  });

  it('со временем появляются трети, четверти, дырки и вращение', () => {
    const rng = seq(7);
    const late = Array.from({ length: 40 }, (_, i) => makeFood(30 + i, rng));
    expect(late.some((f) => f.target < 0.5)).toBe(true);
    expect(late.some((f) => f.holes.length > 0)).toBe(true);
    expect(late.every((f) => f.spin !== 0)).toBe(true);
    expect(makeFood(0, rng).target).toBe(0.5);
  });
});
