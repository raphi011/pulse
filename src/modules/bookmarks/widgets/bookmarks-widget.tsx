"use client";
import { useState } from "react";
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
  const [failed, setFailed] = useState(false);
  const src = faviconUrl(url);
  if (!src || failed) return <span className="h-4 w-4 shrink-0" aria-hidden />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className="h-4 w-4 shrink-0 rounded-sm"
      onError={() => setFailed(true)}
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
    await saveConfig({ bookmarks: bookmarks.filter((_, i) => i !== index) });
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
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const normalized = normalizeUrl(url);
    if (!title.trim() || !normalized) {
      setError("Enter a title and a valid URL.");
      return;
    }
    await saveConfig({ bookmarks: [...data.bookmarks, { title: title.trim(), url: normalized }] });
    setTitle("");
    setUrl("");
    setError(null);
    setOpen(false);
  }

  const inputCls =
    "w-full rounded-lg bg-surface px-2.5 py-1.5 text-sm ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-primary-500/50 dark:bg-surface-dark dark:ring-border-dark";

  return (
    <div className="relative">
      <button aria-label="Add bookmark" onClick={() => setOpen((o) => !o)} className="icon-btn">
        <span className="text-[0.95rem] leading-none">＋</span>
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-20 w-60 space-y-2 rounded-lg bg-panel p-3 text-left shadow-xl ring-1 ring-border dark:bg-panel-dark dark:ring-border-dark">
          <input
            className={inputCls}
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            className={inputCls}
            placeholder="example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex justify-end">
            <button onClick={add} className="btn btn-primary">
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
