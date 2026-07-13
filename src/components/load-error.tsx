/** Full-view fallback when a top-level data load (layout / integrations) fails, with a retry. */
export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message = error instanceof Error && error.message ? error.message : "Something went wrong while loading.";
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-xl text-slate-400 ring-1 ring-border dark:bg-white/5 dark:ring-border-dark">
        ⚠
      </div>
      <p className="mt-4 text-sm font-medium">Couldn’t load</p>
      <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">{message}</p>
      <button type="button" onClick={onRetry} className="btn btn-ghost mt-4">
        Try again
      </button>
    </div>
  );
}
