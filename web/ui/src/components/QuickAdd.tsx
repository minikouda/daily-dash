import { CalendarClock, CornerDownLeft, Plus, Sparkles } from "lucide-react";
import { forwardRef, useState } from "react";
import { useAddTask } from "../api";
import { parseQuick } from "../lib/dates";
import { cn } from "../lib/utils";
import { Kbd, Tip } from "./ui";

/** "Pay rent fri 5pm !" -> title, due, priority. A leading/trailing "!" marks high priority. */
export function parseTask(text: string) {
  const high = /(^|\s)!+(\s|$)/.test(text);
  const q = parseQuick(text.replace(/(^|\s)!+(?=\s|$)/g, " "));
  return { ...q, priority: high ? 1 : 2 };
}

export const QuickAdd = forwardRef<HTMLInputElement, { className?: string }>(({ className }, ref) => {
  const [text, setText] = useState("");
  const [missed, setMissed] = useState(false);
  const add = useAddTask();
  const p = text.trim() ? parseTask(text) : null;

  const submit = () => {
    if (!p || !p.title) return;
    add.mutate({ title: p.title, due: p.due, priority: p.priority, missed });
    setText("");
    setMissed(false);
  };

  return (
    <div
      className={cn(
        "rounded-xl border border-line bg-card shadow-card transition-colors focus-within:border-accent/60",
        className,
      )}
    >
      <div className="flex items-center gap-2.5 px-3">
        <Plus size={16} className="shrink-0 text-fg-3" />
        <input
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.preventDefault(), submit());
            if (e.key === "Escape") (e.currentTarget.blur(), setText(""));
          }}
          placeholder="Add a task — “email Prof. Lee fri 3pm”, add ! for high priority"
          className="h-11 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-fg-3"
        />
        <Tip label="Claude missed this — it should have caught it from an email">
          <button
            onClick={() => setMissed(!missed)}
            className={cn(
              "flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-[12px] font-medium transition-colors",
              missed ? "bg-accent-soft text-accent" : "text-fg-3 hover:bg-hover",
            )}
          >
            <Sparkles size={13} /> Missed
          </button>
        </Tip>
        {!text && <Kbd>C</Kbd>}
      </div>
      {p && (
        <div className="flex items-center gap-3 border-t border-line px-3 py-1.5 text-[12px] text-fg-3">
          <span className="truncate">
            <span className="text-fg-2">{p.title || "…"}</span>
          </span>
          {p.label && (
            <span className="flex shrink-0 items-center gap-1 text-accent">
              <CalendarClock size={12} /> {p.label}
            </span>
          )}
          {p.priority === 1 && <span className="shrink-0 font-medium text-red">High priority</span>}
          <span className="ml-auto flex shrink-0 items-center gap-1">
            <CornerDownLeft size={11} /> add
          </span>
        </div>
      )}
    </div>
  );
});
