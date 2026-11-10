import { useQuery } from "@tanstack/react-query";
import { Bell, CheckCircle2, CircleAlert, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { api, usePost, type Bootstrap } from "../api";
import { ConfirmPop } from "../components/ConfirmPop";
import { Button, Card, SectionTitle } from "../components/ui";
import { ago, shortDate } from "../lib/dates";
import { applyTextSize, getTextSize, type TextSize } from "../lib/textSize";
import { cn } from "../lib/utils";

export function SettingsPage({ data }: { data: Bootstrap }) {
  const post = usePost();
  const [logFor, setLogFor] = useState<number | null>(null);
  const running = data.runs.some((r) => !r.finished_at);
  const [textSize, setTextSize] = useState<TextSize>(getTextSize());

  return (
    <div className="mx-auto max-w-[820px] px-8 py-8">
      <h1 className="mb-6 text-[26px] font-semibold tracking-tight">Settings</h1>

      <div className="space-y-8">
        <div>
          <SectionTitle>Text size</SectionTitle>
          <Card className="flex items-center gap-3 px-4 py-3">
            <span className="flex-1 text-[13.5px]">Scale the whole dashboard</span>
            <div className="flex gap-0.5 rounded-lg bg-hover p-0.5">
              {(["small", "default", "large"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => (applyTextSize(s), setTextSize(s))}
                  className={cn(
                    "h-7 rounded-md px-3 font-medium capitalize transition-colors",
                    s === "small" ? "text-[12px]" : s === "default" ? "text-[13px]" : "text-[14.5px]",
                    textSize === s ? "bg-card text-fg shadow-card" : "text-fg-3 hover:text-fg",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </Card>
        </div>

        <div>
          <SectionTitle>Email accounts</SectionTitle>
          <Card className="divide-y divide-line">
            {data.accounts.map((a) => (
              <div key={a.email} className="flex items-center gap-3 px-4 py-3">
                {a.connected ? <CheckCircle2 size={16} className="text-green" /> : <CircleAlert size={16} className="text-red" />}
                <div className="flex-1">
                  <div className="text-[13.5px] font-medium">{a.email}</div>
                  <div className="text-[12px] text-fg-3">
                    {a.connected ? `Checked ${ago(a.last_fetch)}` : <>Not connected — run <code className="font-mono">uv run daily-dash auth {a.email}</code></>}
                  </div>
                </div>
              </div>
            ))}
          </Card>
          <p className="mt-2 px-1 text-[12px] text-fg-3">Accounts, ignored senders and batch size live in ~/.daily-dash/config.toml.</p>
        </div>

        <div>
          <SectionTitle>Runs</SectionTitle>
          <Card className="p-4">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <ConfirmPop align="start" title="Check mail now?" detail="Fetches new email and has Claude read it." confirmLabel="Check now" onConfirm={() => post.mutate({ path: "/api/run/refresh", message: "Checking mail…" })}>
                <Button disabled={running}>
                  {running ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Check mail now
                </Button>
              </ConfirmPop>
              <ConfirmPop align="start" title="Run the morning digest now?" detail="Checks mail, then writes a new briefing." confirmLabel="Run it" onConfirm={() => post.mutate({ path: "/api/run/digest", message: "Running the morning digest…" })}>
                <Button disabled={running}>
                  <Sparkles size={14} /> Run morning digest
                </Button>
              </ConfirmPop>
              <span className="ml-auto text-[12px] text-fg-3">Scheduled: digest daily at 8:00, mail check every 4 hours</span>
            </div>
            <div className="divide-y divide-line rounded-xl border border-line">
              {data.runs.length === 0 && <div className="px-3 py-3 text-[13px] text-fg-3">No runs yet.</div>}
              {data.runs.map((r) => (
                <div key={r.id}>
                  <button onClick={() => setLogFor(logFor === r.id ? null : r.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-[13px] hover:bg-hover/60">
                    <span className={cn("h-1.5 w-1.5 rounded-full", !r.finished_at ? "animate-pulse bg-amber" : r.ok ? "bg-green" : "bg-red")} />
                    <span className="w-16 font-medium capitalize">{r.kind}</span>
                    <span className="flex-1 text-fg-3">{shortDate(r.started_at)}</span>
                    <span className="text-[12px] text-fg-3 tabular-nums">{r.finished_at ? `${r.extracted}/${r.fetched} emails` : "running…"}</span>
                  </button>
                  {logFor === r.id && <RunLog id={r.id} />}
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div>
          <SectionTitle>Apple Reminders</SectionTitle>
          <Card className="flex items-center gap-3 px-4 py-3">
            <Bell size={16} className="text-fg-3" />
            <div className="text-[13.5px]">
              {data.reminders.enabled ? (
                <>Tasks you keep are added to the “{data.reminders.list}” list. Completing one there marks it done here.</>
              ) : (
                "Reminders sync is off."
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function RunLog({ id }: { id: number }) {
  const q = useQuery({ queryKey: ["runlog", id], queryFn: () => api.get<{ log: string }>(`/api/runs/${id}/log`) });
  return (
    <pre className="max-h-72 overflow-auto border-t border-line bg-bg px-3 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-fg-2">
      {q.isLoading ? "Loading…" : q.data?.log || "(empty)"}
    </pre>
  );
}
