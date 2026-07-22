"use client";
import { useEffect, useRef, useState } from "react";

export function CardMenu({
  onConfigure, onRemove, moveTargets = [], onMove,
}: {
  onConfigure: () => void;
  onRemove: () => void;
  moveTargets?: { id: string; name: string }[];
  onMove?: (tabId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"root" | "move">("root");
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) setOpen(false);
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

  useEffect(() => {
    if (!open) setView("root");
  }, [open]);

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
    setOpen((v) => !v);
  }

  return (
    <>
      <button
        ref={btnRef}
        aria-label="Widget menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        className="icon-btn"
      >
        <span className="text-[0.95rem] leading-none">⋯</span>
      </button>
      {open && pos && (
        <div
          ref={menuRef}
          role="menu"
          style={{ position: "fixed", top: pos.top, right: pos.right }}
          className="z-50 w-44 overflow-hidden rounded-lg bg-panel py-1 shadow-lg ring-1 ring-border [animation:wd-fade-in_.12s_ease-out] dark:bg-panel-dark dark:ring-border-dark"
        >
          {view === "root" ? (
            <>
              <button
                role="menuitem"
                onClick={() => { setOpen(false); onConfigure(); }}
                className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/5"
              >
                Configure
              </button>
              {onMove && moveTargets.length > 0 && (
                <button
                  role="menuitem"
                  onClick={() => setView("move")}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/5"
                >
                  Move to tab… <span aria-hidden className="text-slate-400">›</span>
                </button>
              )}
              <button
                role="menuitem"
                onClick={() => { setOpen(false); onRemove(); }}
                className="block w-full px-3 py-1.5 text-left text-sm text-danger hover:bg-danger/10"
              >
                Remove
              </button>
            </>
          ) : (
            <>
              <button
                role="menuitem"
                onClick={() => setView("root")}
                className="flex w-full items-center gap-1 px-3 py-1.5 text-left text-sm text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5"
              >
                <span aria-hidden>‹</span> Back
              </button>
              {moveTargets.map((t) => (
                <button
                  key={t.id}
                  role="menuitem"
                  onClick={() => { setOpen(false); onMove?.(t.id); }}
                  className="block w-full truncate px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/5"
                >
                  {t.name}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </>
  );
}
