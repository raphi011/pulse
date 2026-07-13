import { useEffect } from "react";
import { open } from "@tauri-apps/plugin-shell";

// Tauri's webview swallows navigations from `<a target="_blank">`, so widget links
// (all absolute http(s)/mailto URLs) never reach the OS. A single capture-phase
// delegate opens them in the default browser instead — every module's links work
// without threading a component through the widget contract. Internal routes use
// `#`-prefixed hrefs (see AppLink) and fall through untouched.
const EXTERNAL_HREF = /^(https?:|mailto:)/i;

export function useExternalLinks(): void {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      // Let modified clicks (open-in-tab intents, etc.) behave normally.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      const anchor = (e.target as Element | null)?.closest("a[href]");
      const href = anchor?.getAttribute("href");
      if (!href || !EXTERNAL_HREF.test(href)) return;
      e.preventDefault();
      void open(href);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
}
