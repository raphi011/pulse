"use client";

/**
 * Non-fatal footer note for widgets whose data is fetched per-item (N+1): some items loaded, some
 * failed. Surfaces the count (with the failed labels in a tooltip) so a short list can't be mistaken
 * for "that's everything". `noun` is the singular item name; an "s" is appended for the plural.
 */
export function PartialFailure({ items, noun = "item" }: { items: string[]; noun?: string }) {
  return (
    <p title={items.join(", ")} className="mt-2 text-xs text-warn">
      {items.length} {noun}{items.length === 1 ? "" : "s"} failed to load
    </p>
  );
}
