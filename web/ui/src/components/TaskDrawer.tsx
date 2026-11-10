import { addDays, format, nextMonday } from "date-fns";
import { AlarmClock, Bell, Check, CornerUpLeft, ExternalLink, Loader2, Mail, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useData, useEditTask, useEmail, useTriage, type Kind, type Task } from "../api";
import { dueInfo, parseDueInput, shortDate } from "../lib/dates";
import { cn, senderName } from "../lib/utils";
import { useUI } from "../store";
import { SnoozeMenu } from "./SnoozeMenu";
import { KIND_LABEL } from "./TaskRow";
import { Button, Chip, Drawer, Kbd, Textarea } from "./ui";

const KINDS: Kind[] = ["deadline", "payment", "reply", "event", "todo"];
const PRIORITIES = [
  { v: 1, label: "High" },
  { v: 2, label: "Normal" },
  { v: 3, label: "Low" },
] as const;

type Draft = { title: string; due: string | null; notes: string; kind: Kind; priority: 1 | 2 | 3 };
const draftOf = (t: Task): Draft => ({ title: t.title, due: t.due, notes: t.notes, kind: t.kind, priority: t.priority });

export function TaskDrawer() {
  const { openTaskId, openTask, chatOpen, chatWidth } = useUI();
  const { data } = useData();
  const task = data?.tasks.find((t) => t.id === openTaskId) ?? null;
  return (
    <Drawer
      open={!!task}
      onOpenChange={(o) => !o && openTask(null)}
      title={task?.status === "inbox" ? "New from email" : "Task"}
      right={chatOpen ? chatWidth : 0}
    >
      {task && <TaskEditor key={task.id} task={task} />}
    </Drawer>
  );
}

function TaskEditor({ task }: { task: Task }) {
  const { openTask, askDismiss } = useUI();
  const edit = useEditTask();
  const triage = useTriage();
  const [draft, setDraft] = useState<Draft>(() => draftOf(task));
  const [note, setNote] = useState("");

  useEffect(() => setDraft(draftOf(task)), [task.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = useMemo(() => {
    const o = draftOf(task);
    return (Object.keys(o) as (keyof Draft)[]).filter((k) => o[k] !== draft[k]);
  }, [draft, task]);

  const save = () => {
    if (!dirty.length) return;
    const change: Record<string, unknown> = {};
    for (const k of dirty) change[k] = draft[k];
    if (dirty.includes("due") && draft.due === null) change.clear_due = true;
    edit.mutate({ id: task.id, ...change, note: note || undefined });
    setNote("");
  };

  const fromEmail = task.origin === "email";

  return (
    <div
      className="flex min-h-full flex-col"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          save();
        }
      }}
    >
      <div className="space-y-5 p-5">
        <textarea
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value.replace(/\n/g, "") })}
          rows={1}
          className="field-sizing-content w-full resize-none bg-transparent text-[19px] leading-snug font-semibold outline-none"
          aria-label="Title"
        />

        <div className="grid grid-cols-[88px_1fr] items-start gap-x-3 gap-y-4 text-[13px]">
          <span className="pt-1.5 text-fg-3">Due</span>
          <DueField value={draft.due} onChange={(due) => setDraft({ ...draft, due })} />

          <span className="pt-1 text-fg-3">Type</span>
          <Segmented
            options={KINDS.map((k) => ({ v: k, label: KIND_LABEL[k] }))}
            value={draft.kind}
            onChange={(kind) => setDraft({ ...draft, kind })}
          />

          <span className="pt-1 text-fg-3">Priority</span>
          <Segmented options={[...PRIORITIES]} value={draft.priority} onChange={(priority) => setDraft({ ...draft, priority })} />

          <span className="pt-2 text-fg-3">Notes</span>
          <Textarea rows={3} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Add notes" />
        </div>

        {dirty.length > 0 && (
          <div className="animate-in rounded-xl border border-accent/30 bg-accent-soft/50 p-3">
            {fromEmail && (
              <>
                <label className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-fg-2">
                  <Sparkles size={13} className="text-accent" />
                  Claude will learn from this correction. Why was it wrong? (optional)
                </label>
                <Textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Gradescope's 'late due date' isn't the real deadline"
                  className="bg-card"
                />
              </>
            )}
            <div className={cn("flex items-center justify-end gap-2", fromEmail && "mt-2.5")}>
              <span className="mr-auto text-[12px] text-fg-3">
                <Kbd>⌘</Kbd> <Kbd>↵</Kbd> to save
              </span>
              <Button variant="ghost" size="sm" onClick={() => setDraft(draftOf(task))}>
                Reset
              </Button>
              <Button variant="primary" size="sm" onClick={save}>
                Save changes
              </Button>
            </div>
          </div>
        )}

        <StatusBar task={task} />
      </div>

      {task.source && <SourceEmail task={task} />}

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line p-4">
        {task.status === "inbox" && (
          <Button variant="primary" onClick={() => triage.mutate({ id: task.id, action: "keep" })}>
            <Check size={14} /> Keep
          </Button>
        )}
        {(task.status === "open" || task.status === "inbox") && (
          <>
            <Button onClick={() => (triage.mutate({ id: task.id, action: "done" }), openTask(null))}>
              <Check size={14} /> Done
            </Button>
            <SnoozeMenu taskId={task.id}>
              <Button>
                <AlarmClock size={14} /> Snooze
              </Button>
            </SnoozeMenu>
            <Button variant="danger" className="ml-auto" onClick={() => askDismiss(task)}>
              <X size={14} /> Dismiss
            </Button>
          </>
        )}
        {(task.status === "done" || task.status === "dismissed") && (
          <Button onClick={() => triage.mutate({ id: task.id, action: "restore" })}>
            <CornerUpLeft size={14} /> Restore
          </Button>
        )}
      </div>
    </div>
  );
}

function StatusBar({ task }: { task: Task }) {
  const bits: React.ReactNode[] = [];
  if (task.status === "inbox") bits.push(<Chip key="s" tone="accent">Awaiting triage</Chip>);
  if (task.status === "done") bits.push(<Chip key="s" tone="green">Done</Chip>);
  if (task.status === "dismissed") bits.push(<Chip key="s">Dismissed</Chip>);
  if (task.snoozed_until && new Date(task.snoozed_until) > new Date())
    bits.push(<Chip key="z" tone="blue"><AlarmClock size={11} /> until {format(new Date(task.snoozed_until), "EEE MMM d")}</Chip>);
  if (task.has_reminder) bits.push(<Chip key="r"><Bell size={11} /> Apple Reminders</Chip>);
  bits.push(
    <span key="c" className="text-[12px] text-fg-3">
      {task.origin === "email" ? "Found in email" : "Added by you"} · {shortDate(task.created_at)}
    </span>,
  );
  return <div className="flex flex-wrap items-center gap-2">{bits}</div>;
}

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { v: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex flex-wrap gap-0.5 rounded-lg bg-hover p-0.5">
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={cn(
            "h-6 rounded-md px-2 text-[12px] font-medium transition-colors",
            value === o.v ? "bg-card text-fg shadow-card" : "text-fg-3 hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Free-text due editor: "fri 5pm", "nov 12", quick presets, or none. */
export function DueField({ value, onChange, autoFocus }: { value: string | null; onChange: (v: string | null) => void; autoFocus?: boolean }) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(!!autoFocus);
  const parsed = text ? parseDueInput(text) : null;
  const info = dueInfo(value);
  const today = new Date();
  const presets = [
    { label: "Today", v: format(today, "yyyy-MM-dd") },
    { label: "Tomorrow", v: format(addDays(today, 1), "yyyy-MM-dd") },
    { label: "Next Mon", v: format(nextMonday(today), "yyyy-MM-dd") },
  ];
  const commit = () => {
    if (parsed) onChange(parsed);
    setText("");
    setEditing(false);
  };
  return (
    <div className="space-y-2">
      {editing ? (
        <div>
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.metaKey) (e.preventDefault(), commit());
              if (e.key === "Escape") (e.stopPropagation(), setEditing(false));
            }}
            onBlur={commit}
            placeholder="Try “fri 5pm”, “nov 12”, “in 3 days”"
            className="h-8 w-full rounded-lg border border-accent bg-bg px-3 text-[13px] outline-none placeholder:text-fg-3"
          />
          <div className="mt-1 h-4 text-[12px] text-fg-3">
            {text && (parsed ? <>→ {dueInfo(parsed)?.long}</> : "Can't read that date")}
          </div>
        </div>
      ) : (
        <button
          onClick={() => setEditing(true)}
          className={cn(
            "flex h-8 items-center rounded-lg px-2 text-[13px] hover:bg-hover",
            info ? (info.tone === "overdue" ? "text-red" : "text-fg") : "text-fg-3",
          )}
        >
          {info ? info.long : "No due date"}
        </button>
      )}
      <div className="flex flex-wrap gap-1">
        {presets.map((p) => (
          <button key={p.label} onClick={() => onChange(p.v)} className="h-6 rounded-md bg-hover px-2 text-[12px] text-fg-2 hover:text-fg">
            {p.label}
          </button>
        ))}
        {value && (
          <button onClick={() => onChange(null)} className="h-6 rounded-md px-2 text-[12px] text-fg-3 hover:text-red">
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

function SourceEmail({ task }: { task: Task }) {
  const src = task.source!;
  const [open, setOpen] = useState(task.status === "inbox");
  const email = useEmail(open ? src.id : undefined);
  return (
    <div className="mx-5 mb-5 overflow-hidden rounded-xl border border-line">
      <div className="flex items-start gap-3 bg-bg px-3.5 py-3">
        <Mail size={15} className="mt-0.5 shrink-0 text-fg-3" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{src.subject || "(no subject)"}</div>
          <div className="truncate text-[12px] text-fg-3">
            {senderName(src.sender)} · {src.received_at ? shortDate(src.received_at) : ""} · {src.account}
          </div>
        </div>
        {src.link && (
          <a href={src.link} target="_blank" rel="noreferrer" className="shrink-0 text-fg-3 hover:text-accent" title="Open in Gmail">
            <ExternalLink size={14} />
          </a>
        )}
      </div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full border-t border-line px-3.5 py-2 text-left text-[12px] font-medium text-fg-3 hover:text-fg"
      >
        {open ? "Hide email" : "Show email"}
      </button>
      {open && (
        <div className="max-h-[340px] overflow-y-auto border-t border-line px-3.5 py-3 text-[12.5px] leading-relaxed whitespace-pre-wrap text-fg-2">
          {email.isLoading && (
            <span className="flex items-center gap-2 text-fg-3">
              <Loader2 size={13} className="animate-spin" /> Loading from Gmail…
            </span>
          )}
          {email.error && <span className="text-red">{String(email.error)}</span>}
          {email.data?.body}
        </div>
      )}
    </div>
  );
}
