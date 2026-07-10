"use client";

/** Shown when a widget's required config (repos / authors) is empty. */
export function NotConfigured() {
  return (
    <p className="text-sm text-slate-500 dark:text-slate-400">
      Not configured — open <span className="font-medium text-slate-700 dark:text-slate-300">⋯ → Configure</span>.
    </p>
  );
}

/** Non-fatal footer note when some repos failed to load but others succeeded. */
export function PartialFailure({ repos }: { repos: string[] }) {
  return (
    <p title={repos.join(", ")} className="mt-2 text-xs text-warn">
      {repos.length} repo{repos.length === 1 ? "" : "s"} failed to load
    </p>
  );
}
