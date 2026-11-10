import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Task } from "./api";

/** App-wide UI state: which task is open in the drawer, palette, dismiss dialog. */
type UI = {
  openTaskId: number | null;
  openTask: (id: number | null) => void;
  paletteOpen: boolean;
  setPaletteOpen: (o: boolean) => void;
  helpOpen: boolean;
  setHelpOpen: (o: boolean) => void;
  dismissing: Task | null;
  /** Opens the reason picker; with feedbackId it adds a reason to an earlier quick dismissal. */
  askDismiss: (t: Task | null, feedbackId?: number) => void;
  amendFeedbackId: number | null;
  snoozing: Task | null;
  askSnooze: (t: Task | null) => void;
  chatOpen: boolean;
  setChatOpen: (o: boolean) => void;
  chatWidth: number;
  setChatWidth: (w: number) => void;
  /** Text to pre-fill in the chat box (e.g. from the Gmail extension). */
  chatDraft: string;
  setChatDraft: (s: string) => void;
};

export const DEFAULT_CHAT_WIDTH = 520;
export const MIN_CHAT_WIDTH = 380;

const Ctx = createContext<UI | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const [openTaskId, setOpenTaskId] = useState<number | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [dismissing, setDismissing] = useState<Task | null>(null);
  const [amendFeedbackId, setAmendFeedbackId] = useState<number | null>(null);
  const askDismiss = useCallback((t: Task | null, feedbackId?: number) => {
    setDismissing(t);
    setAmendFeedbackId(feedbackId ?? null);
  }, []);
  const [snoozing, setSnoozing] = useState<Task | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [chatWidth, setChatWidthState] = useState(() => {
    try {
      return Number(localStorage.getItem("chatWidth")) || DEFAULT_CHAT_WIDTH;
    } catch {
      return DEFAULT_CHAT_WIDTH;
    }
  });
  const setChatWidth = useCallback((w: number) => {
    setChatWidthState(w);
    try {
      localStorage.setItem("chatWidth", String(Math.round(w)));
    } catch {
      /* storage unavailable */
    }
  }, []);
  const openTask = useCallback((id: number | null) => setOpenTaskId(id), []);
  const value = useMemo(
    () => ({
      openTaskId, openTask, paletteOpen, setPaletteOpen, helpOpen, setHelpOpen,
      dismissing, askDismiss, amendFeedbackId, snoozing, askSnooze: setSnoozing, chatOpen, setChatOpen, chatWidth, setChatWidth, chatDraft, setChatDraft,
    }),
    [openTaskId, openTask, paletteOpen, helpOpen, dismissing, amendFeedbackId, askDismiss, snoozing, chatOpen, chatWidth, setChatWidth, chatDraft],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUI() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useUI outside UIProvider");
  return v;
}
