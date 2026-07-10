export const COL_UNIT_PX = 300; // target physical column width
export const ROW_UNIT_PX = 40; // height of one grid row unit
export const DEFAULT_ROW_SPAN = 6; // ~240px starting card height
export const MAX_COLS = 12;

/** Number of columns that fit in `width`, clamped to [1, MAX_COLS]. */
export function columnCountForWidth(width: number, unitPx = COL_UNIT_PX, maxCols = MAX_COLS): number {
  return Math.max(1, Math.min(maxCols, Math.floor(width / unitPx)));
}

/** A span is at least 1 and at most the available column count. */
export function clampSpan(span: number, cols: number): number {
  return Math.max(1, Math.min(Math.floor(span), Math.max(1, cols)));
}

/** New span after dragging `deltaPx` from `startSpan`, snapped to whole `cellPx` cells. */
export function spanFromDelta(startSpan: number, deltaPx: number, cellPx: number): number {
  return Math.max(1, Math.round(startSpan + deltaPx / cellPx));
}
