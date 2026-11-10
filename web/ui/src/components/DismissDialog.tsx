import { BellOff, Check, Copy, Sparkles, ThumbsDown, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, useTriage } from "../api";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useUI } from "../store";
import { cn, senderName } from "../lib/utils";
import { Button, Kbd, Modal, Textarea } from "./ui";

export const DISMISS_REASONS = [
  { key: "1", reason: "not_task", label: "Not a real task", hint: "Claude shouldn't have made this", icon: X },
  { key: "2", reason: "already_done", label: "Already handled", hint: "It was done before it got here", icon: Check },
  { key: "3", reason: "duplicate", label: "Duplicate", hint: "Same as another task", icon: Copy },
  { key: "4", reason: "low_value", label: "Not worth tracking", hint: "Real, but too minor", icon: ThumbsDown },
  { key: "5", reason: "mute_sender", label: "Mute this sender", hint: "Never read their mail again", icon: BellOff },
] as const;

/** Why-dismiss picker. The reason (and optional note) is what Claude learns from. */
export function DismissDialog() {
  const { dismissing, askDismiss, amendFeedbackId } = useUI();
  const triage = useTriage();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [sel, setSel] = useState(0);

  useEffect(() => {
    if (dismissing) {
      setNote("");
      setSel(0);
    }
  }, [dismissing]);

  const reasons = DISMISS_REASONS.filter((r) => r.reason !== "mute_sender" || dismissing?.source?.sender_email);

  const submit = (i: number) => {
    if (!dismissing) return;
    if (amendFeedbackId) {
      // Already dismissed quickly: just attach the reason for Claude.
      api
        .post(`/api/feedback/${amendFeedbackId}/reason`, { reason: reasons[i].reason, note: note || undefined })
        .then(() => (toast("Thanks — Claude will learn from that"), qc.invalidateQueries({ queryKey: ["bootstrap"] })))
        .catch((e) => toast.error(String(e)));
    } else {
      triage.mutate({ id: dismissing.id, action: "dismiss", reason: reasons[i].reason, note: note || undefined });
    }
    askDismiss(null);
  };

  const onKey = (e: React.KeyboardEvent) => {
    const typing = (e.target as HTMLElement).tagName === "TEXTAREA";
    if (!typing) {
      const i = reasons.findIndex((r) => r.key === e.key);
      if (i >= 0) {
        e.preventDefault();
        submit(i);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "j") (e.preventDefault(), setSel((s) => Math.min(s + 1, reasons.length - 1)));
      if (e.key === "ArrowUp" || e.key === "k") (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)));
    }
    if (e.key === "Enter" && (!typing || e.metaKey)) {
      e.preventDefault();
      submit(sel);
    }
  };

  return (
    <Modal open={!!dismissing} onOpenChange={(o) => !o && askDismiss(null)} title="Dismiss task">
      <div onKeyDown={onKey}>
        <div className="border-b border-line px-5 pt-4 pb-3">
          <div className="text-[12px] font-medium text-fg-3">{amendFeedbackId ? "Why did you dismiss this?" : "Dismiss"}</div>
          <div className="mt-0.5 truncate text-[15px] font-medium">{dismissing?.title}</div>
        </div>
        <div className="p-2" role="listbox" tabIndex={0} autoFocus>
          {reasons.map((r, i) => (
            <button
              key={r.reason}
              onMouseEnter={() => setSel(i)}
              onClick={() => submit(i)}
              className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left", sel === i && "bg-hover")}
            >
              <r.icon size={16} className={r.reason === "mute_sender" ? "text-red" : "text-fg-3"} />
              <span className="flex-1">
                <span className="block text-[13.5px] font-medium">{r.label}</span>
                <span className="block text-[12px] text-fg-3">
                  {r.reason === "mute_sender" ? senderName(dismissing?.source?.sender) || dismissing?.source?.sender_email : r.hint}
                </span>
              </span>
              <Kbd>{r.key}</Kbd>
            </button>
          ))}
        </div>
        <div className="border-t border-line p-4">
          <label className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-fg-2">
            <Sparkles size={13} className="text-accent" /> Tell Claude why (optional)
          </label>
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. LinkedIn job-expiry emails are never tasks for me"
          />
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[12px] text-fg-3">
              <Kbd>1</Kbd>–<Kbd>{reasons.length}</Kbd> pick · <Kbd>↵</Kbd> confirm
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => askDismiss(null)}>Cancel</Button>
              <Button variant="primary" onClick={() => submit(sel)}>{amendFeedbackId ? "Save reason" : "Dismiss"}</Button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
