export type Layout = "compact" | "full";

/**
 * Full's charts flex to fill the body, so its threshold is only what three
 * sections need at a *minimum* chart height (~37px), not at a fixed one; above
 * that, extra height goes to the charts rather than to dead space. Compact
 * fits in ~90px.
 *
 * A card of rowSpan n measures `56n - 16` tall and spends ~65px on chrome, so
 * the body lands on 143 / 199 / 255 / 311px for n = 4…7. The deadband sits in
 * the gap between 143 and 199: no reachable height falls inside it, so the
 * hysteresis can never strand a card in the layout it started in.
 */
export const FULL_MIN_PX = 190;
export const COMPACT_MAX_PX = 165;

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
