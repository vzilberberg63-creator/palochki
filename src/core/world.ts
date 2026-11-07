import type { GrainKindId } from './grains';
import type { Bounds } from './physics';

/**
 * Геометрия мира. Зависит от формы экрана и выбирается при старте уровня:
 * - square:   1000×1000, лотки снизу — планшеты и почти квадратные окна;
 * - portrait: 600 в ширину, высокий, лотки снизу — телефон вертикально;
 * - wide:     600 в высоту, широкий, лотки столбиком справа — телефон горизонтально и десктоп.
 * Узкая сторона мира у телефона — 600 единиц, поэтому зёрна там крупнее.
 */
export type LayoutKind = 'square' | 'portrait' | 'wide';

export interface Layout {
  kind: LayoutKind;
  w: number;
  h: number;
  /** Стол, по которому двигаются зёрна. */
  table: Bounds;
  pileCenter: { x: number; y: number };
  /** Лотки идут в ряд снизу или столбиком справа. */
  trayDirection: 'row' | 'column';
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Отступ стола от края мира: совпадает с нарисованной подложкой. */
const TABLE_INSET = 6;
const EDGE_MARGIN = 24;
const TABLE_TRAY_GAP = 28;
const TRAY_GAP = 16;
const TRAY_MAX = 230;

const BOTTOM_TRAY_H = { square: 170, portrait: 150 } as const;
const SIDE_TRAY_W = 170;

export const NARROW_SIDE = 600;
/** Пороги соотношения высоты к ширине доступной области экрана. */
const PORTRAIT_ASPECT = 1.15;
const WIDE_ASPECT = 0.75;

export function makeLayout(kind: LayoutKind, w: number, h: number): Layout {
  if (kind === 'wide') {
    const trayX = w - EDGE_MARGIN - SIDE_TRAY_W;
    const table = { minX: TABLE_INSET, minY: TABLE_INSET, maxX: trayX - TABLE_TRAY_GAP, maxY: h - TABLE_INSET };
    return {
      kind,
      w,
      h,
      table,
      pileCenter: { x: (table.minX + table.maxX) / 2, y: h / 2 },
      trayDirection: 'column',
    };
  }
  const trayTop = h - BOTTOM_TRAY_H[kind] - EDGE_MARGIN;
  const table = { minX: TABLE_INSET, minY: TABLE_INSET, maxX: w - TABLE_INSET, maxY: trayTop - TABLE_TRAY_GAP };
  return {
    kind,
    w,
    h,
    table,
    pileCenter: { x: w / 2, y: (table.minY + table.maxY) / 2 },
    trayDirection: 'row',
  };
}

export const SQUARE: Layout = makeLayout('square', 1000, 1000);

/** Раскладка под доступную область экрана (в CSS-пикселях). */
export function layoutForViewport(availW: number, availH: number): Layout {
  const aspect = availH / Math.max(1, availW);
  // Размер мира подгоняем под экран в разумных пределах, чтобы баланс уровней не плыл.
  if (aspect > PORTRAIT_ASPECT) {
    return makeLayout('portrait', NARROW_SIDE, Math.round(NARROW_SIDE * clamp(aspect, 1.5, 2.1)));
  }
  if (aspect < WIDE_ASPECT) {
    return makeLayout('wide', Math.round(NARROW_SIDE / clamp(aspect, 0.5, 0.7)), NARROW_SIDE);
  }
  return SQUARE;
}

export function trayRects(kinds: readonly GrainKindId[], layout: Layout): Rect[] {
  const n = kinds.length;
  if (layout.trayDirection === 'column') {
    const x = layout.w - EDGE_MARGIN - SIDE_TRAY_W;
    const avail = layout.h - EDGE_MARGIN * 2 - TRAY_GAP * (n - 1);
    const h = Math.min(TRAY_MAX * 0.8, avail / n);
    const startY = (layout.h - (h * n + TRAY_GAP * (n - 1))) / 2;
    return kinds.map((_, i) => ({ x, y: startY + i * (h + TRAY_GAP), w: SIDE_TRAY_W, h }));
  }
  const h = BOTTOM_TRAY_H[layout.kind as 'square' | 'portrait'];
  const y = layout.h - h - EDGE_MARGIN;
  const avail = layout.w - EDGE_MARGIN * 2 - TRAY_GAP * (n - 1);
  const w = Math.min(TRAY_MAX, avail / n);
  const startX = (layout.w - (w * n + TRAY_GAP * (n - 1))) / 2;
  return kinds.map((_, i) => ({ x: startX + i * (w + TRAY_GAP), y, w, h }));
}

export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
