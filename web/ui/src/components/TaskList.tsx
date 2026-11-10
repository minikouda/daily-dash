import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTriage, type Task } from "../api";
import { useHotkeys } from "../lib/hotkeys";
import { useQuickDismiss } from "../lib/quickDismiss";
import { useUI } from "../store";
import { TaskRow } from "./TaskRow";
import { SectionTitle } from "./ui";

export type Section = { title: string; tasks: Task[]; tone?: string; right?: ReactNode };

/**
 * Sections of tasks with one shared keyboard cursor:
 * J/K move, Enter opens, E done, X dismiss, S snooze, Y keep (inbox items).
 */
export function TaskList({
  sections,
  variant = "list",
  keyboard = true,
}: {
  sections: Section[];
  variant?: "list" | "inbox";
  keyboard?: boolean;
}) {
  const flat = useMemo(() => sections.flatMap((s) => s.tasks), [sections]);
  const [cursor, setCursor] = useState(0);
  const rows = useRef(new Map<number, HTMLDivElement>());
  const { openTask, askDismiss, askSnooze } = useUI();
  const triage = useTriage();
  const quickDismiss = useQuickDismiss();
  const current = flat[Math.min(cursor, flat.length - 1)];

  // Keep the cursor in range as items leave the list (triage removes them).
  useEffect(() => {
    if (cursor > flat.length - 1) setCursor(Math.max(0, flat.length - 1));
  }, [flat.length, cursor]);

  useEffect(() => {
    if (current) rows.current.get(current.id)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  // Triaged items leave the list, so the cursor lands on the next one by itself.
  const act = (action: string) => current && triage.mutate({ id: current.id, action });

  useHotkeys(
    keyboard
      ? {
          j: () => setCursor((c) => Math.min(c + 1, flat.length - 1)),
          ArrowDown: () => setCursor((c) => Math.min(c + 1, flat.length - 1)),
          k: () => setCursor((c) => Math.max(c - 1, 0)),
          ArrowUp: () => setCursor((c) => Math.max(c - 1, 0)),
          Enter: () => current && openTask(current.id),
          e: () => current && act(current.status === "done" ? "reopen" : "done"),
          y: () => current?.status === "inbox" && act("keep"),
          x: () => current && quickDismiss(current),
          X: () => current && askDismiss(current),
          s: () => current && askSnooze(current),
        }
      : {},
  );

  return (
    <div className="space-y-6">
      {sections
        .filter((s) => s.tasks.length)
        .map((s) => (
          <div key={s.title}>
            <SectionTitle right={s.right}>
              <span className={s.tone}>{s.title}</span>
              <span className="ml-2 font-normal text-fg-3 tabular-nums">{s.tasks.length}</span>
            </SectionTitle>
            <div className="space-y-px">
              {s.tasks.map((t) => (
                <TaskRow
                  key={t.id}
                  ref={(el) => {
                    if (el) rows.current.set(t.id, el);
                    else rows.current.delete(t.id);
                  }}
                  task={t}
                  variant={variant}
                  focused={keyboard && current?.id === t.id}
                  onFocus={() => setCursor(flat.indexOf(t))}
                />
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}
