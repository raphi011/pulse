/** Preset accent palette for widget cards. Stored in the DB as a *name* so hues can be re-tuned here without touching stored data. */
export const ACCENT_NAMES = ["red", "orange", "amber", "green", "teal", "blue", "violet", "pink"] as const;
export type AccentName = (typeof ACCENT_NAMES)[number];

// Literal class strings — Tailwind v4 compiles statically, no interpolation.
// 500 reads right on light cards; 400 pops slightly better on the dark card surface.
const CLASSES: Record<AccentName, string> = {
  red: "bg-red-500 dark:bg-red-400",
  orange: "bg-orange-500 dark:bg-orange-400",
  amber: "bg-amber-500 dark:bg-amber-400",
  green: "bg-green-500 dark:bg-green-400",
  teal: "bg-teal-500 dark:bg-teal-400",
  blue: "bg-blue-500 dark:bg-blue-400",
  violet: "bg-violet-500 dark:bg-violet-400",
  pink: "bg-pink-500 dark:bg-pink-400",
};

export function isAccentName(v: unknown): v is AccentName {
  return typeof v === "string" && (ACCENT_NAMES as readonly string[]).includes(v);
}

/** Background classes for a preset; null for absent/unknown names so stale DB values degrade to no accent. */
export function accentClass(name: string | null | undefined): string | null {
  return isAccentName(name) ? CLASSES[name] : null;
}
