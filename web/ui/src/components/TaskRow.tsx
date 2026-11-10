import { AlarmClock, Bell, Check, CornerUpLeft, Mail, MessageSquareText, MoreHorizontal, Pencil, X } from "lucide-react";
import { forwardRef } from "react";
import { useTriage, type Kind, type Task } from "../api";
import { dueInfo } from "../lib/dates";
import { cn, senderName } from "../lib/utils";
import { useQuickDismiss } from "../lib/quickDismiss";
import { useUI } from "../store";
import { SnoozeMenu } from "./SnoozeMenu";
import { Button, Chip, MenuContent, MenuItem, MenuRoot, MenuSep, MenuTrigger, Tip } from "./ui";

export const KIND_LABEL: Record<Kind, string> = {
  deadline: "Deadline",
  payment: "Payment",
  reply: "Reply",
  event: "Event",
  todo: "Task",
};
const KIND_TONE: Record<Kind, "overdue" | "today" | "accent" | "blue" | "neutral"> = {
  deadline: "overdue",
  payment: "today",
  reply: "accent",
  event: "blue",
  todo: "neutral",
};

export function KindChip({ kind }: { kind: Kind }) {
  if (kind === "todo") return null;
  return (
    <Chip tone={KIND_TONE[kind]} className="!bg-transparent px-0 text-[11px] font-semibold tracking-wide uppercase">
      {KIND_LABEL[kind]}
    </Chip>
  );
}

export function DueChip({ due, className }: { due: string | null; className?: string }) {
  const info = dueInfo(due);
  if (!info) return null;
  return (
    <Tip label={info.long}>
      <span>
        <Chip tone={info.tone} className={className}>
          {info.label}
        </Chip>
      </span>
    </Tip>
  );
}

type Props = { task: Task; focused?: boolean; onFocus?: () => void; variant?: "list" | "inbox" };

export const TaskRow = forwardRef<HTMLDivElement, Props>(({ task, focused, onFocus, variant = "list" }, ref) => {
  const { openTask, askDismiss } = useUI();
  const triage = useTriage();
  const quickDismiss = useQuickDismiss();
  const done = task.status === "done";
  const dismissed = task.status === "dismissed";
  const inbox = task.status === "inbox";
  const from = senderName(task.source?.sender);

  return (
    <div
      ref={ref}
      onMouseMove={onFocus}
      onClick={() => openTask(task.id)}
      className={cn(
        "group relative flex cursor-default items-start gap-3 rounded-xl px-3 py-2.5 transition-colors",
        focused ? "bg-hover" : "hover:bg-hover/60",
        (done || dismissed) && "opacity-60",
      )}
    >
      {focused && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-accent" />}

      {inbox ? (
        <span className="mt-[7px] h-2 w-2 shrink-0 rounded-full bg-accent" title="New from email" />
      ) : (
        <button
          aria-label={done ? "Mark not done" : "Mark done"}
          onClick={(e) => {
            e.stopPropagation();
            triage.mutate({ id: task.id, action: done ? "reopen" : dismissed ? "restore" : "done" });
          }}
          className={cn(
            "mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors",
            done ? "border-green bg-green text-white" : "border-line-strong hover:border-green hover:bg-green-soft",
            task.priority === 1 && !done && "border-red",
          )}
        >
          {done && <Check size={11} strokeWidth={3} />}
        </button>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={cn("truncate text-[14px] font-[450]", done && "line-through decoration-fg-3")}>{task.title}</span>
          <KindChip kind={task.kind} />
        </div>
        {(from || task.notes) && (
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12.5px] text-fg-3">
            {from && (
              <span className="flex shrink-0 items-center gap-1">
                <Mail size={11} /> {from}
              </span>
            )}
            {from && task.notes && <span>·</span>}
            {task.notes && <span className="truncate">{task.notes}</span>}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {task.has_reminder && !done && (
          <Tip label="In Apple Reminders">
            <Bell size={12} className="text-fg-3" />
          </Tip>
        )}
        <DueChip due={task.due} />
        {variant === "inbox" && inbox ? (
          <div className="ml-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Tip label={<>Keep · Y</>}>
              <Button size="sm" variant="secondary" onClick={() => triage.mutate({ id: task.id, action: "keep" })}>
                <Check size={13} /> Keep
              </Button>
            </Tip>
            <Tip label={<>Dismiss · X</>}>
              <Button size="icon" variant="ghost" aria-label="Dismiss" onClick={() => quickDismiss(task)}>
                <X size={15} />
              </Button>
            </Tip>
            <Tip label={<>Dismiss and tell Claude why · ⇧X</>}>
              <Button size="icon" variant="ghost" aria-label="Dismiss with reason" onClick={() => askDismiss(task)}>
                <MessageSquareText size={14} />
              </Button>
            </Tip>
          </div>
        ) : (
          <div
            className={cn("flex items-center opacity-0 transition-opacity group-hover:opacity-100", focused && "opacity-100")}
            onClick={(e) => e.stopPropagation()}
          >
            {!done && !dismissed && (
              <SnoozeMenu taskId={task.id}>
                <Button size="icon" variant="ghost" aria-label="Snooze">
                  <AlarmClock size={14} />
                </Button>
              </SnoozeMenu>
            )}
            <MenuRoot>
              <MenuTrigger asChild>
                <Button size="icon" variant="ghost" aria-label="More">
                  <MoreHorizontal size={15} />
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem icon={<Pencil size={14} />} shortcut="↵" onSelect={() => openTask(task.id)}>
                  Edit details
                </MenuItem>
                {task.source?.link && (
                  <MenuItem icon={<Mail size={14} />} onSelect={() => window.open(task.source!.link!, "_blank")}>
                    Open email in Gmail
                  </MenuItem>
                )}
                <MenuSep />
                {dismissed || done ? (
                  <MenuItem icon={<CornerUpLeft size={14} />} onSelect={() => triage.mutate({ id: task.id, action: "restore" })}>
                    Restore
                  </MenuItem>
                ) : (
                  <>
                    <MenuItem icon={<X size={14} />} shortcut="X" danger onSelect={() => quickDismiss(task)}>
                      Dismiss
                    </MenuItem>
                    <MenuItem icon={<MessageSquareText size={14} />} shortcut="⇧X" onSelect={() => askDismiss(task)}>
                      Dismiss with reason…
                    </MenuItem>
                  </>
                )}
              </MenuContent>
            </MenuRoot>
          </div>
        )}
      </div>
    </div>
  );
});
