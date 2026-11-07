import { GRAIN_KINDS } from '../src/core/grains';
import { difficulty, generateLevel } from '../src/core/level';
import { Rng, levelSeed } from '../src/core/rng';

describe('Rng', () => {
  it('одинаковый seed даёт одинаковую последовательность', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('значения в [0, 1)', () => {
    const r = new Rng(7);
    for (let i = 0; i < 10000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('seed уровней различаются', () => {
    const seeds = new Set(Array.from({ length: 200 }, (_, i) => levelSeed(i + 1)));
    expect(seeds.size).toBe(200);
  });
});

describe('generateLevel', () => {
  it('детерминирован', () => {
    expect(generateLevel(17)).toEqual(generateLevel(17));
  });

  it('первый уровень — обучение без таймера', () => {
    const l = generateLevel(1);
    expect(l.targets).toEqual(['riceBlack']);
    expect(l.fillers).toEqual(['riceWhite']);
    expect(l.timeLimit).toBeNull();
    expect(l.jitter).toBe(0);
    expect(l.slip).toBe(0);
  });

  it('отклоняет некорректный номер', () => {
    expect(() => generateLevel(0)).toThrow();
    expect(() => generateLevel(1.5)).toThrow();
  });

  it('цели и наполнители не пересекаются, количества положительные', () => {
    for (let i = 1; i <= 120; i++) {
      const l = generateLevel(i);
      expect(l.targets.length).toBeGreaterThan(0);
      expect(new Set(l.targets).size).toBe(l.targets.length);
      for (const f of l.fillers) expect(l.targets).not.toContain(f);
      for (const k of [...l.targets, ...l.fillers]) {
        expect(GRAIN_KINDS[k]).toBeDefined();
        expect(l.counts[k]).toBeGreaterThan(0);
      }
    }
  });

  it('сложность растёт монотонно', () => {
    let prev = generateLevel(1);
    for (let i = 2; i <= 80; i++) {
      const l = generateLevel(i);
      expect(difficulty(i)).toBeGreaterThan(difficulty(i - 1));
      expect(l.sizeScale).toBeLessThanOrEqual(prev.sizeScale);
      expect(l.grabRadius).toBeLessThanOrEqual(prev.grabRadius);
      expect(l.damping).toBeLessThanOrEqual(prev.damping);
      prev = l;
    }
  });

  it('целей становится больше, таймер появляется с 4-го уровня', () => {
    expect(generateLevel(3).timeLimit).toBeNull();
    expect(generateLevel(4).timeLimit).not.toBeNull();
    expect(generateLevel(40).targets.length).toBeGreaterThan(generateLevel(5).targets.length);
  });
});
