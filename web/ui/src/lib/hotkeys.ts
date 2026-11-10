import { useEffect, useRef } from "react";
import { isTyping } from "./utils";

type Handler = (e: KeyboardEvent) => void;

const anyDialogOpen = () => !!document.querySelector('[role="dialog"], [role="menu"]');

/**
 * Global single-key shortcuts. Keys are KeyboardEvent.key values ("j", "Enter",
 * "?") or "mod+k". "g t" style sequences are supported. Ignored while typing
 * or while a dialog/menu is open (unless `whenDialog` is set).
 */
export function useHotkeys(map: Record<string, Handler>, deps: unknown[] = [], opts: { whenDialog?: boolean } = {}) {
  const ref = useRef(map);
  ref.current = map;
  const pending = useRef<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const m = ref.current;
      const mod = e.metaKey || e.ctrlKey;
      if (mod) {
        const h = m[`mod+${e.key.toLowerCase()}`];
        if (h) {
          e.preventDefault();
          h(e);
        }
        return;
      }
      if (e.altKey || isTyping(e) || (!opts.whenDialog && anyDialogOpen())) return;
      if (pending.current) {
        const h = m[`${pending.current} ${e.key}`];
        pending.current = null;
        if (h) {
          e.preventDefault();
          h(e);
          return;
        }
      }
      if (Object.keys(m).some((k) => k.startsWith(`${e.key} `))) {
        pending.current = e.key;
        window.setTimeout(() => (pending.current = null), 900);
        return;
      }
      const h = m[e.key];
      if (h) {
        e.preventDefault();
        h(e);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
