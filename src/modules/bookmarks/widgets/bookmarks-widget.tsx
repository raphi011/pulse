"use client";
import { useEffect, useRef, useState } from "react";
import type { WidgetBodyProps } from "@/modules/contracts";
import {
  normalizeUrl,
  type BookmarksConfig,
  type BookmarksData,
} from "../manifest";

type Props = WidgetBodyProps<BookmarksData, BookmarksConfig>;

function faviconUrl(url: string): string | null {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`;
  } catch {
    return null;
  }
}

/** Favicon from Google's service; on load error, fall back to a blank spacer (keeps row alignment). */
function Favicon({ url }: { url: string }) {
  const src = faviconUrl(url);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) return <span className="h-4 w-4 shrink-0" aria-hidden />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className="h-4 w-4 shrink-0 rounded-sm"
      onError={() => setFailedSrc(src)}
    />
  );
}

export function BookmarksWidget({ data, saveConfig }: Props) {
  const bookmarks = data.bookmarks;
  const [pendingRemove, setPendingRemove] = useState<number | null>(null);

  if (bookmarks.length === 0) {
    return (
      <p className="py-2 text-sm text-slate-500 dark:text-slate-400">
        No bookmarks yet — use +
      </p>
    );
  }

  async function remove(index: number) {
    try {
      await saveConfig({ bookmarks: bookmarks.filter((_, i) => i !== index) });
    } catch {
      // Save failed; data is unchanged so the row remains. Swallow to avoid an unhandled rejection.
    }
    setPendingRemove(null);
  }

  return (
    <ul className="space-y-0.5">
      {bookmarks.map((b, i) => (
        <li
          key={i}
          className="group/row flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-slate-100 dark:hover:bg-white/5"
        >
          <Favicon url={b.url} />
          <a
            href={b.url}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 flex-1 truncate text-sm text-slate-700 hover:text-primary-600 dark:text-slate-200 dark:hover:text-primary-400"
          >
            {b.title}
          </a>
          {pendingRemove === i ? (
            <span className="flex shrink-0 items-center gap-1 text-xs">
              <span className="text-slate-500 dark:text-slate-400">Remove?</span>
              <button aria-label="Confirm remove" onClick={() => remove(i)} className="icon-btn text-danger">
                ✓
              </button>
              <button aria-label="Cancel remove" onClick={() => setPendingRemove(null)} className="icon-btn">
                ✕
              </button>
            </span>
          ) : (
            <button
              aria-label={`Remove ${b.title}`}
              onClick={() => setPendingRemove(i)}
              className="icon-btn shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100"
            >
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function BookmarksHeaderControls({ data, saveConfig }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDoc = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
    setError(null);
    setOpen((v) => !v);
  }

  async function add() {
    const normalized = normalizeUrl(url);
    if (!title.trim() || !normalized) {
      setError("Enter a title and a valid URL.");
      return;
    }
    setSaving(true);
    try {
      await saveConfig({ bookmarks: [...data.bookmarks, { title: title.trim(), url: normalized }] });
    } catch {
      setError("Couldn't save. Try again.");
      setSaving(false);
      return;
    }
    setTitle("");
    setUrl("");
    setError(null);
    setSaving(false);
    setOpen(false);
  }

  const inputCls =
    "w-full rounded-lg bg-surface px-2.5 py-1.5 text-sm ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-primary-500/50 dark:bg-surface-dark dark:ring-border-dark";

  return (
    <>
      <button ref={btnRef} aria-label="Add bookmark" aria-expanded={open} onClick={toggle} className="icon-btn">
        <span className="text-[0.95rem] leading-none">＋</span>
      </button>
      {open && pos && (
        <div
          ref={popRef}
          style={{ position: "fixed", top: pos.top, right: pos.right }}
          className="z-50 w-60 space-y-2 rounded-lg bg-panel p-3 text-left shadow-xl ring-1 ring-border [animation:wd-fade-in_.12s_ease-out] dark:bg-panel-dark dark:ring-border-dark"
        >
          <input aria-label="Title" className={inputCls} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input
            aria-label="URL"
            className={inputCls}
            placeholder="example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex justify-end">
            <button onClick={add} disabled={saving} className="btn btn-primary disabled:opacity-60">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
