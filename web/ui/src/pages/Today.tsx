import { addDays, format, isSameDay, parseISO, startOfDay } from "date-fns";
import { ArrowRight, CalendarDays, Inbox, Loader2, Newspaper, Package as PackageIcon, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { usePost, type Bootstrap } from "../api";
import { BriefingCard, Count, HighlightRow, PackageCard } from "../components/Feed";
import { ConfirmPop } from "../components/ConfirmPop";
import { TaskList } from "../components/TaskList";
import { Button, Card, Empty, Kbd, SectionTitle } from "../components/ui";
import { bucketOf, dueDate, sortByDue } from "../lib/dates";
import { cn } from "../lib/utils";

export function TodayPage({ data }: { data: Bootstrap }) {
  const post = usePost();
  const now = new Date();
  // Untriaged items count too: a deadline shouldn't hide in the Inbox.
  const visible = data.tasks.filter(
    (t) => (t.status === "open" || t.status === "inbox") && (!t.snoozed_until || new Date(t.snoozed_until) <= now),
  );
  const inbox = data.tasks.filter((t) => t.status === "inbox");
  const by = (b: string) => sortByDue(visible.filter((t) => bucketOf(t.due, now) === b));
  const overdue = by("Overdue");
  const today = by("Today");
  const tomorrow = by("Tomorrow");
  const comingUp = by("This week").slice(0, 6);
  const important = visible.filter((t) => !t.due && t.priority === 1);
  const recent = Date.now() - 36 * 3600_000;
  const pkgs = data.packages.filter(
    (p) => !p.archived && (p.status !== "delivered" || new Date(p.delivered_at ?? p.last_update).getTime() > recent),
  );
  const arrivingToday = pkgs.filter((p) => p.status !== "delivered" && p.eta && isSameDay(parseISO(p.eta.slice(0, 10)), now)).length;
  const highlights = data.highlights.filter((h) => new Date(h.created_at).getTime() > Date.now() - 48 * 3600_000);
  const digestRunning = data.runs.some((r) => !r.finished_at && r.kind === "digest");

  return (
    <div className="@container mx-auto max-w-[1080px] px-8 py-8">
      <header className="mb-6">
        <h1 className="text-[26px] font-semibold tracking-tight">{format(now, "EEEE, MMMM d")}</h1>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {overdue.length > 0 && <Count n={overdue.length} label="overdue" tone="red" />}
          <Count n={today.length} label="due today" tone={today.length ? "amber" : undefined} />
          {arrivingToday > 0 && <Count n={arrivingToday} label={arrivingToday === 1 ? "package arriving" : "packages arriving"} tone="amber" />}
          {inbox.length > 0 && <Count n={inbox.length} label="to triage" tone="accent" />}
        </div>
      </header>

      {inbox.length > 0 && (
        <Link
          href="/inbox"
          className="mb-5 flex items-center gap-3 rounded-2xl border border-accent/25 bg-accent-soft/60 px-4 py-3 transition-colors hover:bg-accent-soft"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent text-accent-fg">
            <Inbox size={16} />
          </div>
          <div className="flex-1">
            <div className="text-[14px] font-medium">
              {inbox.length} new {inbox.length === 1 ? "item" : "items"} from your email
            </div>
            <div className="text-[12.5px] text-fg-2">Keep what matters and tell Claude what doesn't; it learns from every decision.</div>
          </div>
          <span className="hidden items-center gap-1 text-[12px] text-fg-3 sm:flex">
            <Kbd>G</Kbd> <Kbd>I</Kbd>
          </span>
          <ArrowRight size={16} className="text-accent" />
        </Link>
      )}

      <div className="mb-6">
        {data.briefing ? (
          <BriefingCard briefing={data.briefing} />
        ) : (
          <Card className="flex items-center gap-4 p-5">
            <Sparkles size={18} className="text-accent" />
            <div className="flex-1">
              <div className="text-[14px] font-medium">No briefing yet</div>
              <div className="text-[13px] text-fg-3">The morning digest writes one at 8:00. You can run it now.</div>
            </div>
            <ConfirmPop title="Run the morning digest now?" detail="Checks mail, then writes a new briefing." confirmLabel="Run it" onConfirm={() => post.mutate({ path: "/api/run/digest", message: "Running the morning digest…" })}>
              <Button disabled={digestRunning}>
                {digestRunning ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Run digest
              </Button>
            </ConfirmPop>
          </Card>
        )}
      </div>

      <WeekStrip data={data} />

      <div className="grid grid-cols-1 gap-8 @3xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div>
          {overdue.length + today.length + tomorrow.length + comingUp.length + important.length ? (
            <TaskList
              sections={[
                { title: "Overdue", tasks: overdue, tone: "text-red" },
                { title: "Today", tasks: today },
                { title: "Tomorrow", tasks: tomorrow },
                { title: "Coming up", tasks: comingUp },
                { title: "Important, no date", tasks: important },
              ]}
            />
          ) : (
            <Card>
              <Empty icon={<CalendarDays size={20} />} title="Nothing due this week">
                See everything in <Link href="/tasks" className="text-accent">Tasks</Link>.
              </Empty>
            </Card>
          )}
        </div>

        <div className="space-y-7">
          <div>
            <SectionTitle right={<Link href="/packages" className="text-[12px] text-fg-3 hover:text-fg">All →</Link>}>Packages</SectionTitle>
            {pkgs.length ? (
              <div className="space-y-2">
                {pkgs.slice(0, 5).map((p) => (
                  <PackageCard key={p.key} p={p} />
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-xl border border-dashed border-line px-3.5 py-3 text-[13px] text-fg-3">
                <PackageIcon size={15} /> Nothing on the way.
              </div>
            )}
          </div>

          <div>
            <SectionTitle>Worth reading</SectionTitle>
            {highlights.length ? (
              <div className="-mx-3 space-y-px">
                {highlights.map((h) => (
                  <HighlightRow key={h.id} h={h} />
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-xl border border-dashed border-line px-3.5 py-3 text-[13px] text-fg-3">
                <Newspaper size={15} /> Nothing notable in the last two days.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Seven-day glance: task and delivery counts per day. */
function WeekStrip({ data }: { data: Bootstrap }) {
  const start = startOfDay(new Date());
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const tasks = data.tasks.filter((t) => (t.status === "open" || t.status === "inbox") && t.due);
  return (
    <div className="mb-8 grid grid-cols-7 gap-1.5">
      {days.map((d, i) => {
        const dayTasks = tasks.filter((t) => isSameDay(dueDate(t.due!), d));
        const deliveries = data.packages.filter((p) => p.status !== "delivered" && !p.archived && p.eta && isSameDay(parseISO(p.eta.slice(0, 10)), d));
        const urgent = dayTasks.some((t) => t.kind === "deadline" || t.kind === "payment" || t.priority === 1);
        return (
          <div
            key={i}
            className={cn(
              "rounded-xl border px-2.5 py-2",
              i === 0 ? "border-accent/40 bg-accent-soft/40" : "border-line bg-card",
            )}
            title={[...dayTasks.map((t) => `• ${t.title}`), ...deliveries.map((p) => `📦 ${p.description}`)].join("\n") || "Nothing scheduled"}
          >
            <div className={cn("text-[11px] font-semibold uppercase", i === 0 ? "text-accent" : "text-fg-3")}>
              {i === 0 ? "Today" : format(d, "EEE")}
            </div>
            <div className="text-[17px] font-semibold tabular-nums">{format(d, "d")}</div>
            <div className="mt-1 flex h-4 items-center gap-1.5 text-[11px] text-fg-3">
              {dayTasks.length > 0 && (
                <span className={cn("flex items-center gap-1", urgent && "font-medium text-red")}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", urgent ? "bg-red" : "bg-fg-3")} />
                  {dayTasks.length}
                </span>
              )}
              {deliveries.length > 0 && (
                <span className="flex items-center gap-0.5">
                  <PackageIcon size={11} /> {deliveries.length}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
