import { Command } from "cmdk";
import { Brain, CalendarDays, Inbox, ListTodo, Mail, Package, Plus, RefreshCw, Settings, Sun } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { useAddTask, useData, usePost } from "../api";
import { dueInfo } from "../lib/dates";
import { useUI } from "../store";
import { parseTask } from "./QuickAdd";
import { Kbd, Modal } from "./ui";

const item =
  "flex h-10 cursor-pointer items-center gap-3 rounded-lg px-3 text-[13.5px] text-fg data-[disabled=true]:opacity-50 [&_svg]:text-fg-3";

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, openTask } = useUI();
  const [, nav] = useLocation();
  const [q, setQ] = useState("");
  const { data } = useData();
  const add = useAddTask();
  const post = usePost();

  const close = () => {
    setPaletteOpen(false);
    setQ("");
  };
  const run = (f: () => void) => () => (f(), close());
  const parsed = q.trim() ? parseTask(q) : null;
  const tasks = (data?.tasks ?? []).filter((t) => t.status === "open" || t.status === "inbox");

  return (
    <Modal open={paletteOpen} onOpenChange={(o) => (o ? setPaletteOpen(true) : close())} title="Command palette" className="overflow-hidden">
      <Command loop className="flex max-h-[min(480px,70vh)] flex-col">
        <Command.Input
          value={q}
          onValueChange={setQ}
          autoFocus
          placeholder="Search tasks, jump to a page, or type a new task…"
          className="h-12 w-full border-b border-line bg-transparent px-4 text-[15px] outline-none placeholder:text-fg-3"
        />
        <Command.List className="overflow-y-auto p-1.5">
          <Command.Empty className="px-3 py-6 text-center text-[13px] text-fg-3">No matches.</Command.Empty>

          {parsed?.title && (
            <Command.Group heading="Create">
              <Command.Item
                value={`create ${q}`}
                onSelect={run(() => add.mutate({ title: parsed.title, due: parsed.due, priority: parsed.priority }))}
                className={item}
              >
                <Plus size={15} />
                <span className="flex-1 truncate">
                  Add task “{parsed.title}”
                  {parsed.label && <span className="ml-2 text-fg-3">{parsed.label}</span>}
                </span>
              </Command.Item>
            </Command.Group>
          )}

          <Command.Group heading="Go to">
            {[
              { to: "/", label: "Today", icon: Sun, k: "G T" },
              { to: "/inbox", label: "Inbox", icon: Inbox, k: "G I" },
              { to: "/tasks", label: "Tasks", icon: ListTodo, k: "G L" },
              { to: "/packages", label: "Packages", icon: Package, k: "G P" },
              { to: "/learning", label: "Learning", icon: Brain, k: "G R" },
              { to: "/settings", label: "Settings", icon: Settings, k: "G S" },
            ].map((p) => (
              <Command.Item key={p.to} value={`go ${p.label}`} onSelect={run(() => nav(p.to))} className={item}>
                <p.icon size={15} />
                <span className="flex-1">{p.label}</span>
                <Kbd>{p.k}</Kbd>
              </Command.Item>
            ))}
          </Command.Group>

          <Command.Group heading="Actions">
            <Command.Item value="check mail now refresh" onSelect={run(() => post.mutate({ path: "/api/run/refresh", message: "Checking mail…" }))} className={item}>
              <RefreshCw size={15} /> Check mail now
            </Command.Item>
            <Command.Item value="morning digest briefing" onSelect={run(() => post.mutate({ path: "/api/run/digest", message: "Running the morning digest…" }))} className={item}>
              <CalendarDays size={15} /> Run morning digest
            </Command.Item>
            <Command.Item value="learn review feedback claude" onSelect={run(() => post.mutate({ path: "/api/learn", message: "Claude is reviewing your feedback…" }))} className={item}>
              <Brain size={15} /> Ask Claude to review my feedback
            </Command.Item>
          </Command.Group>

          {tasks.length > 0 && (
            <Command.Group heading="Tasks">
              {tasks.map((t) => (
                <Command.Item key={t.id} value={`task ${t.id} ${t.title} ${t.notes}`} onSelect={run(() => openTask(t.id))} className={item}>
                  {t.status === "inbox" ? <Inbox size={15} /> : t.source ? <Mail size={15} /> : <ListTodo size={15} />}
                  <span className="flex-1 truncate">{t.title}</span>
                  <span className="text-[12px] text-fg-3">{dueInfo(t.due)?.label}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </Modal>
  );
}

export function ShortcutsHelp() {
  const { helpOpen, setHelpOpen } = useUI();
  const groups: [string, [string, string][]][] = [
    ["Anywhere", [["⌘ K", "Command palette"], ["C", "Add a task"], ["G then T / I / L / P / R / S", "Go to a page"], ["?", "This help"]]],
    ["Lists", [["J / K", "Move down / up"], ["↵", "Open details"], ["E", "Mark done"], ["S", "Snooze"], ["X", "Dismiss"], ["⇧ X", "Dismiss with a reason"]]],
    ["Inbox", [["Y", "Keep (adds to Reminders)"], ["E", "Already done"], ["X", "Dismiss (Why? on the toast adds a reason)"], ["⇧ X", "Dismiss and tell Claude why"], ["S", "Keep, but snooze"]]],
  ];
  return (
    <Modal open={helpOpen} onOpenChange={setHelpOpen} title="Keyboard shortcuts">
      <div className="p-5">
        <div className="mb-4 text-[15px] font-semibold">Keyboard shortcuts</div>
        <div className="grid gap-5 sm:grid-cols-2">
          {groups.map(([g, rows]) => (
            <div key={g}>
              <div className="mb-2 text-[11px] font-semibold tracking-wide text-fg-3 uppercase">{g}</div>
              <div className="space-y-1.5">
                {rows.map(([k, d]) => (
                  <div key={d} className="flex items-center justify-between gap-3 text-[13px]">
                    <span className="text-fg-2">{d}</span>
                    <span className="flex gap-1">
                      {k.split(" ").map((x, i) =>
                        x === "then" || x === "/" ? (
                          <span key={i} className="text-[11px] text-fg-3">{x}</span>
                        ) : (
                          <Kbd key={i}>{x}</Kbd>
                        ),
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
