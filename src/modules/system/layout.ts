export type Layout = "compact" | "full";

/**
 * Provisional pixel thresholds — tune in Task 3's verify step against the real
 * running card. Full needs ~290px of body height to show three 64px charts
 * without scrolling; compact fits in ~90px.
 */
export const FULL_MIN_PX = 290;
export const COMPACT_MAX_PX = 260;

/**
 * Pick the layout for a measured available height. Inside the
 * [COMPACT_MAX_PX, FULL_MIN_PX] deadband the current mode is kept, so dragging
 * the card border across the boundary doesn't flip the layout back and forth.
 */
export function nextLayout(height: number, current: Layout): Layout {
  if (height >= FULL_MIN_PX) return "full";
  if (height <= COMPACT_MAX_PX) return "compact";
  return current;
}
