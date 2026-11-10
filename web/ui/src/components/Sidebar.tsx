import { Brain, Command, Inbox, ListTodo, Loader2, Package, RefreshCw, Settings, Sparkles, Sun } from "lucide-react";
import { Link, useLocation } from "wouter";
import { usePost, type Bootstrap } from "../api";
import { ago } from "../lib/dates";
import { cn } from "../lib/utils";
import { useUI } from "../store";
import { ConfirmPop } from "./ConfirmPop";
import { Kbd } from "./ui";

export function Sidebar({ data }: { data: Bootstrap | undefined }) {
  const [loc] = useLocation();
  const { setPaletteOpen, chatOpen, setChatOpen } = useUI();
  const post = usePost();
  const now = new Date();
  const inbox = data?.tasks.filter((t) => t.status === "inbox").length ?? 0;
  const open =
    data?.tasks.filter((t) => t.status === "open" && (!t.snoozed_until || new Date(t.snoozed_until) <= now)).length ?? 0;
  const pkgs = data?.packages.filter((p) => !p.archived && p.status !== "delivered").length ?? 0;
  const proposals = data?.rules.filter((r) => r.status === "proposed").length ?? 0;
  const run = data?.runs[0];
  const running = !!run && !run.finished_at;

  const nav = [
    { to: "/", label: "Today", icon: Sun },
    { to: "/inbox", label: "Inbox", icon: Inbox, count: inbox, accent: inbox > 0 },
    { to: "/tasks", label: "Tasks", icon: ListTodo, count: open },
    { to: "/packages", label: "Packages", icon: Package, count: pkgs },
    { to: "/learning", label: "Learning", icon: Brain, count: proposals, accent: proposals > 0 },
  ];

  return (
    <aside className="flex h-full w-[232px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-accent-fg">
          <svg viewBox="0 0 32 32" width="16" height="16">
            <path d="M9 16.5l4.5 4.5L23 11" stroke="currentColor" strokeWidth="3.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <span className="text-[14.5px] font-semibold tracking-tight">Daily Dash</span>
      </div>

      <button
        onClick={() => setPaletteOpen(true)}
        className="mx-3 mb-3 flex h-8 items-center gap-2 rounded-lg border border-line bg-card px-2.5 text-[13px] text-fg-3 shadow-card hover:text-fg-2"
      >
        <Command size={13} />
        <span className="flex-1 text-left">Search or command</span>
        <Kbd>⌘K</Kbd>
      </button>

      <nav className="flex flex-col gap-0.5 px-2">
        {nav.map((n) => {
          const active = n.to === "/" ? loc === "/" : loc.startsWith(n.to);
          return (
            <Link
              key={n.to}
              href={n.to}
              className={cn(
                "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] transition-colors",
                active ? "bg-card font-medium text-fg shadow-card" : "text-fg-2 hover:bg-hover hover:text-fg",
              )}
            >
              <n.icon size={16} className={active ? "text-accent" : "text-fg-3"} />
              <span className="flex-1">{n.label}</span>
              {!!n.count && (
                <span
                  className={cn(
                    "min-w-5 rounded-md px-1.5 text-center text-[11.5px] font-semibold tabular-nums",
                    n.accent ? "bg-accent text-accent-fg" : "text-fg-3",
                  )}
                >
                  {n.count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto space-y-1 p-2">
        <button
          onClick={() => setChatOpen(!chatOpen)}
          className={cn(
            "flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13.5px]",
            chatOpen ? "bg-accent-soft font-medium text-accent" : "text-fg-2 hover:bg-hover hover:text-fg",
          )}
        >
          <Sparkles size={16} className="text-accent" />
          <span className="flex-1 text-left">Ask Claude</span>
          <Kbd>⌘J</Kbd>
        </button>
        <Link
          href="/settings"
          className={cn(
            "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px]",
            loc.startsWith("/settings") ? "bg-card font-medium shadow-card" : "text-fg-2 hover:bg-hover",
          )}
        >
          <Settings size={16} className="text-fg-3" /> Settings
        </Link>
        <div className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] text-fg-3">
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              running ? "animate-pulse bg-amber" : run?.ok ? "bg-green" : run ? "bg-red" : "bg-fg-3",
            )}
          />
          <span className="flex-1 truncate">
            {running ? "Checking mail…" : run ? `Checked ${ago(run.finished_at)}` : "Never checked"}
          </span>
          <ConfirmPop title="Check mail now?" detail="Fetches new email and has Claude read it." confirmLabel="Check now" onConfirm={() => post.mutate({ path: "/api/run/refresh", message: "Checking mail…" })}>
            <button
              disabled={running}
              title="Check mail now"
              className="rounded p-1 hover:bg-hover hover:text-fg disabled:opacity-60"
              aria-label="Check mail now"
            >
              {running ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            </button>
          </ConfirmPop>
        </div>
      </div>
    </aside>
  );
}
