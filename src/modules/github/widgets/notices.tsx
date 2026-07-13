"use client";

/** Shown when a widget's required config (repos / authors) is empty. */
export function NotConfigured() {
  return (
    <p className="text-sm text-slate-500 dark:text-slate-400">
      Not configured — open <span className="font-medium text-slate-700 dark:text-slate-300">⋯ → Configure</span>.
    </p>
  );
}

