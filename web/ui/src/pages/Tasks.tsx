import { ListChecks } from "lucide-react";
import { useRef, useState } from "react";
import type { Bootstrap } from "../api";
import { QuickAdd } from "../components/QuickAdd";
import { TaskList } from "../components/TaskList";
import { Card, Empty } from "../components/ui";
import { BUCKETS, bucketOf, sortByDue } from "../lib/dates";
import { useHotkeys } from "../lib/hotkeys";
import { cn } from "../lib/utils";

type Tab = "open" | "snoozed" | "done" | "dismissed";

export function TasksPage({ data }: { data: Bootstrap }) {
  const [tab, setTab] = useState<Tab>("open");
  const addRef = useRef<HTMLInputElement>(null);
  useHotkeys({ c: () => addRef.current?.focus() });

  const now = new Date();
  const snoozed = (t: Bootstrap["tasks"][number]) => !!t.snoozed_until && new Date(t.snoozed_until) > now;
  const lists: Record<Tab, Bootstrap["tasks"]> = {
    open: data.tasks.filter((t) => t.status === "open" && !snoozed(t)),
    snoozed: data.tasks.filter((t) => t.status === "open" && snoozed(t)),
    done: data.tasks.filter((t) => t.status === "done").sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    dismissed: data.tasks.filter((t) => t.status === "dismissed").sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
  };
  const items = lists[tab];
  const sections =
    tab === "open"
      ? BUCKETS.map((b) => ({
          title: b,
          tasks: sortByDue(items.filter((t) => bucketOf(t.due, now) === b)),
          tone: b === "Overdue" ? "text-red" : undefined,
        }))
      : [{ title: { snoozed: "Snoozed", done: "Done in the last 7 days", dismissed: "Dismissed in the last 7 days" }[tab], tasks: tab === "snoozed" ? sortByDue(items) : items }];

  const tabs: [Tab, string][] = [
    ["open", "Open"],
    ["snoozed", "Snoozed"],
    ["done", "Done"],
    ["dismissed", "Dismissed"],
  ];

  return (
    <div className="mx-auto max-w-[820px] px-8 py-8">
      <header className="mb-5 flex items-center justify-between">
        <h1 className="text-[26px] font-semibold tracking-tight">Tasks</h1>
        <div className="flex gap-0.5 rounded-lg bg-hover p-0.5">
          {tabs.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={cn(
                "h-7 rounded-md px-3 text-[12.5px] font-medium transition-colors",
                tab === k ? "bg-card text-fg shadow-card" : "text-fg-3 hover:text-fg",
              )}
            >
              {label}
              {lists[k].length > 0 && <span className="ml-1.5 text-fg-3 tabular-nums">{lists[k].length}</span>}
            </button>
          ))}
        </div>
      </header>

      <QuickAdd ref={addRef} className="mb-7" />

      {items.length ? (
        <TaskList sections={sections} />
      ) : (
        <Card>
          <Empty icon={<ListChecks size={20} />} title={tab === "open" ? "All clear" : `Nothing ${tab}`}>
            {tab === "open" && "Tasks you keep from the Inbox, and ones you add here, show up in this list."}
          </Empty>
        </Card>
      )}
    </div>
  );
}
