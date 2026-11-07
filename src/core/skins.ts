/**
 * Стили палочек. Чисто внешние: на захват и сложность не влияют,
 * чтобы покупки не ломали баланс уровней.
 */

export type SkinId = 'classic' | 'bamboo' | 'redLacquer' | 'steel' | 'sakura' | 'jade' | 'blackGold' | 'golden';

export interface ChopstickSkin {
  id: SkinId;
  /** Цена в монетах; 0 — выдаётся сразу. */
  price: number;
  /** Цвета вдоль палочки от кончика (0) к рукоятке (1). */
  stops: readonly (readonly [number, string])[];
  /** Ширина у кончика и у рукоятки, в единицах мира. */
  tipWidth: number;
  endWidth: number;
  /** Яркость блика: 0 — матовое дерево, 1 — металл. */
  sheen: number;
  /** Поперечные кольца: доля длины и цвет. */
  bands?: readonly (readonly [number, string])[];
  /** Узор на рукоятке. */
  pattern?: { kind: 'nodes' | 'petals' | 'stripes'; color: string };
}

export const SKINS: readonly ChopstickSkin[] = [
  {
    id: 'classic',
    price: 0,
    stops: [
      [0, '#3a2414'],
      [0.75, '#2a1a10'],
      [0.76, '#8b1e1e'],
      [1, '#6e1414'],
    ],
    tipWidth: 3,
    endWidth: 8,
    sheen: 0.35,
  },
  {
    id: 'bamboo',
    price: 120,
    stops: [
      [0, '#c9a46a'],
      [0.5, '#d8b77c'],
      [1, '#c49a5c'],
    ],
    tipWidth: 3.5,
    endWidth: 8.5,
    sheen: 0.25,
    pattern: { kind: 'nodes', color: '#8f6b37' },
  },
  {
    id: 'redLacquer',
    price: 200,
    stops: [
      [0, '#1d1210'],
      [0.12, '#1d1210'],
      [0.13, '#b3261e'],
      [1, '#8e1b15'],
    ],
    tipWidth: 3,
    endWidth: 8,
    sheen: 0.6,
    bands: [
      [0.8, '#d9a63a'],
      [0.84, '#d9a63a'],
    ],
  },
  {
    id: 'steel',
    price: 320,
    stops: [
      [0, '#8d949c'],
      [0.5, '#c9d0d6'],
      [1, '#9aa2aa'],
    ],
    tipWidth: 2.5,
    endWidth: 6,
    sheen: 0.9,
    pattern: { kind: 'stripes', color: 'rgba(60, 66, 72, 0.45)' },
  },
  {
    id: 'sakura',
    price: 480,
    stops: [
      [0, '#4a2a33'],
      [0.15, '#4a2a33'],
      [0.16, '#f2b8c6'],
      [1, '#e597ab'],
    ],
    tipWidth: 3,
    endWidth: 8,
    sheen: 0.45,
    pattern: { kind: 'petals', color: '#ffffff' },
  },
  {
    id: 'jade',
    price: 700,
    stops: [
      [0, '#2f6b4f'],
      [0.5, '#5fa880'],
      [1, '#3d8a63'],
    ],
    tipWidth: 3,
    endWidth: 8,
    sheen: 0.7,
    bands: [[0.78, '#e8e2c8']],
  },
  {
    id: 'blackGold',
    price: 1000,
    stops: [
      [0, '#d4a63a'],
      [0.1, '#d4a63a'],
      [0.11, '#141214'],
      [1, '#0d0c0d'],
    ],
    tipWidth: 3,
    endWidth: 8,
    sheen: 0.65,
    bands: [
      [0.7, '#d4a63a'],
      [0.76, '#d4a63a'],
      [0.97, '#d4a63a'],
    ],
  },
  {
    id: 'golden',
    price: 2000,
    stops: [
      [0, '#a87a1c'],
      [0.35, '#f3d27a'],
      [0.65, '#c9982e'],
      [1, '#f0cd6e'],
    ],
    tipWidth: 3,
    endWidth: 8,
    sheen: 1,
    pattern: { kind: 'stripes', color: 'rgba(120, 82, 10, 0.4)' },
  },
];

export const DEFAULT_SKIN: SkinId = 'classic';

export function skinById(id: string): ChopstickSkin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}

export function isSkinId(id: unknown): id is SkinId {
  return typeof id === 'string' && SKINS.some((s) => s.id === id);
}
