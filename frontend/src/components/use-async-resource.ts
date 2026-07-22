import { useCallback, useEffect, useState } from "react";

export type AsyncResource<T> = {
  data: T | null;
  error: unknown;
  reload: () => void;
};

/**
 * Load an async resource once on mount. Unlike a bare `loader().then(setData)`, this surfaces a
 * rejection as `error` (rather than leaving the caller stuck rendering a loading state forever —
 * e.g. a DB lock at startup) and exposes `reload` to retry. Results from a superseded load are
 * dropped so a slow retry can't overwrite a newer one.
 */
export function useAsyncResource<T>(loader: () => Promise<T>): AsyncResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    loader().then(
      (d) => {
        if (active) setData(d);
      },
      (e) => {
        if (active) setError(e ?? new Error("Unknown error"));
      },
    );
    return () => {
      active = false;
    };
    // Re-run only on an explicit reload; `loader` is expected to be a stable reference.
  }, [nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, reload };
}
