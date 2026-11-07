/** Виды зёрен и их внешний вид. Размеры в единицах мира (мир 1000×1000). */

export type GrainShape = 'rice' | 'round' | 'lentil' | 'bean' | 'buckwheat';

export type GrainKindId =
  | 'riceWhite'
  | 'riceBlack'
  | 'buckwheat'
  | 'lentilRed'
  | 'pea'
  | 'beanWhite'
  | 'lentilGreen'
  | 'beanRed';

export interface GrainKind {
  id: GrainKindId;
  shape: GrainShape;
  /** Длина по большой оси. */
  length: number;
  /** Ширина по малой оси. */
  width: number;
  /** Базовый цвет, HSL. */
  hue: number;
  sat: number;
  light: number;
  /** Разброс светлоты между зёрнами одного вида (в процентах HSL). */
  lightSpread: number;
}

export const GRAIN_KINDS: Record<GrainKindId, GrainKind> = {
  riceWhite: { id: 'riceWhite', shape: 'rice', length: 26, width: 10, hue: 45, sat: 30, light: 90, lightSpread: 4 },
  riceBlack: { id: 'riceBlack', shape: 'rice', length: 24, width: 10, hue: 280, sat: 12, light: 14, lightSpread: 5 },
  buckwheat: { id: 'buckwheat', shape: 'buckwheat', length: 18, width: 15, hue: 28, sat: 45, light: 38, lightSpread: 6 },
  lentilRed: { id: 'lentilRed', shape: 'lentil', length: 16, width: 16, hue: 18, sat: 75, light: 55, lightSpread: 5 },
  pea: { id: 'pea', shape: 'round', length: 20, width: 20, hue: 48, sat: 80, light: 58, lightSpread: 5 },
  beanWhite: { id: 'beanWhite', shape: 'bean', length: 32, width: 20, hue: 40, sat: 35, light: 86, lightSpread: 4 },
  lentilGreen: { id: 'lentilGreen', shape: 'lentil', length: 16, width: 16, hue: 70, sat: 25, light: 40, lightSpread: 6 },
  beanRed: { id: 'beanRed', shape: 'bean', length: 32, width: 19, hue: 355, sat: 55, light: 30, lightSpread: 5 },
};

/** Порядок, в котором виды открываются по мере прохождения. */
export const UNLOCK_ORDER: readonly GrainKindId[] = [
  'riceWhite',
  'riceBlack',
  'buckwheat',
  'lentilRed',
  'pea',
  'beanWhite',
  'lentilGreen',
  'beanRed',
];

/**
 * Похожие друг на друга пары: на высокой сложности к цели
 * подмешивается её «двойник», чтобы отличать было труднее.
 */
export const LOOKALIKES: Partial<Record<GrainKindId, GrainKindId>> = {
  riceWhite: 'beanWhite',
  beanWhite: 'riceWhite',
  lentilRed: 'beanRed',
  beanRed: 'lentilRed',
  buckwheat: 'lentilGreen',
  lentilGreen: 'buckwheat',
  riceBlack: 'beanRed',
  pea: 'lentilRed',
};

/** Радиус окружности, которой зерно представлено в физике. */
export function collisionRadius(kind: GrainKind, sizeScale: number): number {
  return ((kind.length + kind.width) / 4) * sizeScale;
}
