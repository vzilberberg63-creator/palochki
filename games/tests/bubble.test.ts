import { BubbleModel, HALF_LEN, MAX_ANGLE } from '../bubble/bubble';

function seq(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function run(m: BubbleModel, seconds: number, each?: () => void): void {
  for (let t = 0; t < seconds; t += 1 / 60) {
    each?.();
    m.update(1 / 60);
  }
}

/** Модель без случайных птиц: первая появится нескоро. */
function quiet(): BubbleModel {
  const m = new BubbleModel(seq(1));
  (m as unknown as { nextBirdIn: number }).nextBirdIn = 1e9;
  return m;
}

describe('Пузырёк', () => {
  it('пустая доска стоит ровно, пузырёк в центре, очки капают', () => {
    const m = quiet();
    run(m, 5);
    expect(Math.abs(m.angle)).toBeLessThan(0.001);
    expect(m.inZone).toBe(true);
    expect(m.meter).toBe(1);
    expect(m.score).toBeGreaterThanOrEqual(95);
  });

  it('птица справа кренит доску вправо, пузырёк уходит влево', () => {
    const m = quiet();
    m.birds.push({ id: 1, kind: 'pigeon', s: HALF_LEN - 30, stay: 100, phase: 'sitting', t: 0 });
    run(m, 2);
    expect(m.angle).toBeGreaterThan(0.1);
    expect(m.bubble).toBeLessThan(-0.5);
    expect(m.inZone).toBe(false);
  });

  it('грузик, сдвинутый влево, выравнивает доску против птицы справа', () => {
    const m = quiet();
    m.birds.push({ id: 1, kind: 'pigeon', s: HALF_LEN - 30, stay: 100, phase: 'sitting', t: 0 });
    // Двигаем грузик влево, пока пузырёк левее центра, и вправо — если проскочили.
    run(m, 8, () => {
      m.left = m.bubble < -0.05;
      m.right = m.bubble > 0.05;
    });
    expect(m.weight).toBeLessThan(0);
    expect(Math.abs(m.bubble)).toBeLessThan(m.zone);
    expect(m.meter).toBeGreaterThan(0.5);
  });

  it('держать постоянно — грузик уезжает к краю и перекачивает доску', () => {
    const m = quiet();
    m.left = true;
    run(m, 4);
    expect(m.weight).toBeLessThan(-200);
    expect(m.angle).toBeLessThan(0);
    expect(m.bubble).toBeGreaterThan(0.9);
  });

  it('доска упирается в упоры', () => {
    const m = quiet();
    for (let i = 0; i < 4; i++) m.birds.push({ id: i, kind: 'crow', s: HALF_LEN - i * 10, stay: 100, phase: 'sitting', t: 0 });
    m.right = true;
    run(m, 3);
    expect(m.angle).toBeLessThanOrEqual(MAX_ANGLE + 1e-9);
  });

  it('отпустил — грузик остаётся на месте', () => {
    const m = quiet();
    m.right = true;
    run(m, 0.5);
    m.right = false;
    const w = m.weight;
    run(m, 1);
    expect(m.weight).toBe(w);
  });

  it('пузырёк долго вне отметок — шкала кончается, игра окончена; реклама возвращает', () => {
    const m = quiet();
    m.right = true;
    run(m, 12);
    expect(m.over).toBe(true);
    const score = m.score;
    m.update(1);
    expect(m.score).toBe(score);
    m.revive();
    m.right = false;
    expect(m.over).toBe(false);
    run(m, 1);
    expect(m.meter).toBe(1);
  });

  it('птицы прилетают, сидят и улетают; со временем их больше и есть ветер', () => {
    const m = new BubbleModel(seq(3));
    const events: string[] = [];
    let maxBirds = 0;
    // Автопилот двигает грузик к центру пузырька; если проиграл — продолжаем, как после рекламы.
    run(m, 240, () => {
      if (m.over) m.revive();
      m.left = m.bubble < -0.08;
      m.right = m.bubble > 0.08;
      for (const e of m.drainEvents()) events.push(e.type);
      maxBirds = Math.max(maxBirds, m.birds.length);
    });
    expect(events).toContain('land');
    expect(events).toContain('leave');
    expect(events).toContain('gust');
    expect(maxBirds).toBeGreaterThanOrEqual(3);
    // Через 4 минуты зона между отметками заметно уже стартовой (0,4).
    expect(m.zone).toBeLessThan(0.25);
  });
});
