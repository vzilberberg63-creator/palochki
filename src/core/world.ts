import type { GrainKindId } from './grains';

/** Мир — квадрат 1000×1000; на экран он вписывается с сохранением пропорций. */
export const WORLD_W = 1000;
export const WORLD_H = 1000;

/** Нижняя граница стола: ниже неё стоят лотки. */
export const TABLE_BOTTOM = 770;
export const PILE_CENTER = { x: 500, y: 390 };

export const TRAY_TOP = 800;
export const TRAY_H = 170;
const TRAY_GAP = 24;
const TRAY_MAX_W = 230;
const TRAY_SIDE_MARGIN = 40;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function trayRects(kinds: readonly GrainKindId[]): Rect[] {
  const n = kinds.length;
  const avail = WORLD_W - TRAY_SIDE_MARGIN * 2 - TRAY_GAP * (n - 1);
  const w = Math.min(TRAY_MAX_W, avail / n);
  const totalW = w * n + TRAY_GAP * (n - 1);
  const startX = (WORLD_W - totalW) / 2;
  return kinds.map((_, i) => ({ x: startX + i * (w + TRAY_GAP), y: TRAY_TOP, w, h: TRAY_H }));
}

export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}
