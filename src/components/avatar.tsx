function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

/**
 * Small round avatar. Renders `src` as an image (name → alt/title); when `src`
 * is missing/empty it falls back to the name's initials in a matching circle.
 * `className` overrides sizing (default h-4 w-4, matching the widget list rows).
 */
export function Avatar({ src, name, className = "h-4 w-4" }: { src?: string | null; name: string; className?: string }) {
  const base = `${className} shrink-0 rounded-full`;
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- local single-user app; matches existing plain-element widgets
      <img src={src} alt={name} title={name} loading="lazy" className={`${base} bg-slate-200 object-cover dark:bg-white/10`} />
    );
  }
  return (
    <span
      title={name}
      className={`${base} flex items-center justify-center bg-slate-500/15 text-[0.625rem] font-medium text-slate-500 dark:text-slate-400`}
    >
      {initials(name)}
    </span>
  );
}
