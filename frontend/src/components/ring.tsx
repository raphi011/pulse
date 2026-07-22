import type { ReactNode } from "react";

const R = 42;
const CIRC = 2 * Math.PI * R;

/**
 * A square progress ring: a faint full track plus an optional colored arc,
 * with centered content laid over the middle. Sizes itself to fit its parent
 * (square, capped) so it grows in taller cards and never overflows.
 */
export function Ring({
  progress,
  color,
  arcTestId,
  children,
  className,
}: {
  /** 0..1 arc fraction; omit for a track-only ring. */
  progress?: number;
  /** Arc stroke color (any CSS color). */
  color?: string;
  /** Test id set on the arc circle when an arc is drawn. */
  arcTestId?: string;
  children?: ReactNode;
  /** Sizing overrides for the square wrapper. */
  className?: string;
}) {
  const pct = progress == null ? null : Math.min(Math.max(progress, 0), 1);
  return (
    <div className={`relative aspect-square h-full max-h-[168px] ${className ?? ""}`}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={R} fill="none" strokeWidth={7} className="stroke-slate-200 dark:stroke-white/10" />
        {pct != null && (
          <circle
            data-testid={arcTestId}
            cx="50"
            cy="50"
            r={R}
            fill="none"
            strokeWidth={7}
            strokeLinecap="round"
            stroke={color}
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - pct)}
            className="transition-[stroke-dashoffset] duration-500 ease-out"
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-center">
        {children}
      </div>
    </div>
  );
}
