import {
  Archive,
  BellOff,
  Brain,
  Check,
  CircleDot,
  Loader2,
  Pencil,
  PackageX,
  Plus,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useState } from "react";
import { usePost, type Bootstrap, type FeedbackEvent, type Rule } from "../api";
import { Button, Card, Chip, Empty, SectionTitle, Textarea, Tip } from "../components/ui";
import { ago } from "../lib/dates";
import { cn, senderName } from "../lib/utils";

const SCOPE_LABEL: Record<Rule["scope"], string> = { todos: "Tasks", packages: "Packages", highlights: "Highlights", general: "General" };

export function LearningPage({ data }: { data: Bootstrap }) {
  const post = usePost();
  const proposed = data.rules.filter((r) => r.status === "proposed");
  const active = data.rules.filter((r) => r.status === "active" && r.kind === "instruction");
  const muted = data.rules.filter((r) => r.status === "active" && r.kind === "ignore_sender");
  const byId = new Map(data.feedback.map((f) => [f.id, f]));
  const last = data.learn.last;

  return (
    <div className="mx-auto max-w-[860px] px-8 py-8">
      <header className="mb-6">
        <h1 className="text-[26px] font-semibold tracking-tight">Learning</h1>
        <p className="mt-1 max-w-[600px] text-[13.5px] text-fg-2">
          Claude reads your decisions — what you keep, dismiss, fix or add — and suggests rules for how it reads your email. Nothing
          changes until you accept a rule. Your most recent corrections are also shown to Claude as examples on every run.
        </p>
      </header>

      <Card className="mb-8 flex flex-wrap items-center gap-4 p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
          {data.learn.running ? <Loader2 size={18} className="animate-spin" /> : <Brain size={18} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium">
            {data.learn.running
              ? "Claude is reviewing your feedback…"
              : data.learn.pending
                ? `${data.learn.pending} new ${data.learn.pending === 1 ? "decision" : "decisions"} since the last review`
                : "Claude is up to date with your feedback"}
          </div>
          <div className="text-[12.5px] text-fg-3">
            {last?.error ? (
              <span className="text-red">Last review failed: {last.error}</span>
            ) : last ? (
              <>Last review {ago(last.at)}{last.summary ? ` — ${last.summary}` : ""}</>
            ) : (
              "Reviews run after the morning digest, or whenever you ask."
            )}
          </div>
        </div>
        <Button
          variant="primary"
          disabled={data.learn.running || !data.learn.pending}
          onClick={() => post.mutate({ path: "/api/learn", message: "Claude is reviewing your feedback…" })}
        >
          <Sparkles size={14} /> Review now
        </Button>
      </Card>

      <div className="space-y-9">
        <div>
          <SectionTitle>Suggested rules{proposed.length ? ` · ${proposed.length}` : ""}</SectionTitle>
          {proposed.length ? (
            <div className="space-y-2.5">
              {proposed.map((r) => (
                <Proposal key={r.id} rule={r} evidence={r.evidence.map((id) => byId.get(id)).filter(Boolean) as FeedbackEvent[]} />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-line px-4 py-3.5 text-[13px] text-fg-3">
              No suggestions waiting. They appear after Claude spots a pattern in your feedback.
            </div>
          )}
        </div>

        <div>
          <SectionTitle>Active rules{active.length ? ` · ${active.length}` : ""}</SectionTitle>
          <Card className="divide-y divide-line">
            {active.map((r) => (
              <ActiveRule key={r.id} rule={r} />
            ))}
            <AddRule />
          </Card>
        </div>

        {muted.length > 0 && (
          <div>
            <SectionTitle>Muted senders</SectionTitle>
            <div className="flex flex-wrap gap-1.5">
              {muted.map((r) => (
                <span key={r.id} className="flex h-7 items-center gap-1.5 rounded-lg border border-line bg-card pr-1 pl-2.5 text-[12.5px]">
                  <BellOff size={12} className="text-fg-3" /> {r.text}
                  <Tip label="Unmute">
                    <button
                      onClick={() => post.mutate({ path: `/api/rules/${r.id}`, body: { action: "retire" }, message: `Unmuted ${r.text}` })}
                      className="rounded p-0.5 text-fg-3 hover:bg-hover hover:text-fg"
                      aria-label={`Unmute ${r.text}`}
                    >
                      <X size={13} />
                    </button>
                  </Tip>
                </span>
              ))}
            </div>
          </div>
        )}

        <div>
          <SectionTitle>Your recent feedback</SectionTitle>
          {data.feedback.length ? (
            <Card className="divide-y divide-line">
              {data.feedback.map((f) => (
                <FeedbackRow key={f.id} f={f} />
              ))}
            </Card>
          ) : (
            <Card>
              <Empty icon={<Brain size={20} />} title="No feedback yet">
                Triage your Inbox, fix a date, or dismiss a task with a reason — each one shows up here.
              </Empty>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Proposal({ rule, evidence }: { rule: Rule; evidence: FeedbackEvent[] }) {
  const post = usePost();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(rule.text);
  const [showEvidence, setShowEvidence] = useState(false);
  const retire = rule.kind === "retire";
  const act = (action: string, message: string, body: object = {}) =>
    post.mutate({ path: `/api/rules/${rule.id}`, body: { action, ...body }, message });

  return (
    <div className="animate-in rounded-2xl border border-accent/30 bg-card p-4 shadow-card">
      <div className="mb-2 flex items-center gap-2">
        <Sparkles size={14} className="text-accent" />
        <span className="text-[12px] font-semibold text-accent">{retire ? "Suggests retiring a rule" : "Suggested rule"}</span>
        <Chip>{SCOPE_LABEL[rule.scope]}</Chip>
        <span className="ml-auto text-[12px] text-fg-3">{ago(rule.created_at)}</span>
      </div>
      {editing ? (
        <Textarea rows={2} value={text} autoFocus onChange={(e) => setText(e.target.value)} className="text-[14px]" />
      ) : (
        <div className={cn("text-[14.5px] leading-snug font-medium", retire && "text-fg-2 line-through decoration-fg-3")}>{rule.text}</div>
      )}
      {rule.rationale && <div className="mt-1.5 text-[13px] text-fg-2">{rule.rationale}</div>}
      {evidence.length > 0 && (
        <button onClick={() => setShowEvidence(!showEvidence)} className="mt-2 text-[12px] font-medium text-fg-3 hover:text-fg">
          Based on {evidence.length} {evidence.length === 1 ? "decision" : "decisions"} of yours {showEvidence ? "▴" : "▾"}
        </button>
      )}
      {showEvidence && (
        <div className="mt-2 divide-y divide-line rounded-xl border border-line">
          {evidence.map((f) => (
            <FeedbackRow key={f.id} f={f} compact />
          ))}
        </div>
      )}
      <div className="mt-3.5 flex items-center gap-2">
        {editing ? (
          <>
            <Button variant="primary" size="sm" onClick={() => (act("accept", "Rule saved and active", { text }), setEditing(false))}>
              <Check size={13} /> Save &amp; accept
            </Button>
            <Button variant="ghost" size="sm" onClick={() => (setEditing(false), setText(rule.text))}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" size="sm" onClick={() => act("accept", retire ? "Rule retired" : "Rule accepted — Claude will follow it")}>
              <Check size={13} /> {retire ? "Retire it" : "Accept"}
            </Button>
            {!retire && (
              <Button size="sm" onClick={() => setEditing(true)}>
                <Pencil size={12} /> Edit
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => act("reject", "Rejected — Claude won't suggest it again")}>
              <X size={13} /> {retire ? "Keep the rule" : "Reject"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function ActiveRule({ rule }: { rule: Rule }) {
  const post = usePost();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(rule.text);
  return (
    <div className="group flex items-start gap-3 px-4 py-3">
      <Chip className="mt-0.5 shrink-0">{SCOPE_LABEL[rule.scope]}</Chip>
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="space-y-2">
            <Textarea rows={2} value={text} autoFocus onChange={(e) => setText(e.target.value)} />
            <div className="flex gap-2">
              <Button size="sm" variant="primary" onClick={() => (post.mutate({ path: `/api/rules/${rule.id}`, body: { action: "edit", text }, message: "Rule updated" }), setEditing(false))}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => (setEditing(false), setText(rule.text))}>Cancel</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="text-[13.5px]">{rule.text}</div>
            <div className="mt-0.5 text-[12px] text-fg-3">
              {rule.origin === "user" ? "Written by you" : "Learned from your feedback"} · {ago(rule.decided_at ?? rule.created_at)}
            </div>
          </>
        )}
      </div>
      {!editing && (
        <div className="flex opacity-0 transition-opacity group-hover:opacity-100">
          <Tip label="Edit">
            <Button size="icon" variant="ghost" aria-label="Edit rule" onClick={() => setEditing(true)}>
              <Pencil size={13} />
            </Button>
          </Tip>
          <Tip label="Retire">
            <Button size="icon" variant="ghost" aria-label="Retire rule" onClick={() => post.mutate({ path: `/api/rules/${rule.id}`, body: { action: "retire" }, message: "Rule retired" })}>
              <Trash2 size={13} />
            </Button>
          </Tip>
        </div>
      )}
    </div>
  );
}

function AddRule() {
  const post = usePost();
  const [text, setText] = useState("");
  const [scope, setScope] = useState<Rule["scope"]>("general");
  const submit = () => {
    if (!text.trim()) return;
    post.mutate({ path: "/api/rules", body: { text, scope }, message: "Rule added — Claude will follow it" });
    setText("");
  };
  return (
    <div className="flex items-center gap-2 px-4 py-3">
      <Plus size={15} className="shrink-0 text-fg-3" />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="Teach Claude directly — “Treat anything from my advisor as high priority”"
        className="h-8 min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-fg-3"
      />
      <select
        value={scope}
        onChange={(e) => setScope(e.target.value as Rule["scope"])}
        className="h-7 rounded-md border border-line bg-bg px-1.5 text-[12px] text-fg-2 outline-none"
        aria-label="Rule applies to"
      >
        {Object.entries(SCOPE_LABEL).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
      <Button size="sm" disabled={!text.trim()} onClick={submit}>Add</Button>
    </div>
  );
}

const REASON: Record<string, string> = {
  not_task: "not a real task",
  already_done: "already handled",
  duplicate: "duplicate",
  low_value: "not worth tracking",
  mute_sender: "muted the sender",
};

function describe(f: FeedbackEvent): { icon: React.ReactNode; text: React.ReactNode } {
  const before = f.before_json ? JSON.parse(f.before_json) : {};
  const after = f.after_json ? JSON.parse(f.after_json) : {};
  const title = <span className="font-medium text-fg">“{before.title ?? after.title ?? before.headline ?? before.description}”</span>;
  switch (`${f.item_type}:${f.action}`) {
    case "todo:keep":
      return { icon: <Check size={14} className="text-green" />, text: <>Kept {title}</> };
    case "todo:done":
      return { icon: <Check size={14} className="text-green" />, text: <>Completed {title}</> };
    case "todo:dismiss":
      return { icon: <X size={14} className="text-red" />, text: <>Dismissed {title} — {REASON[f.reason ?? ""] ?? "no reason"}</> };
    case "todo:edit":
      return {
        icon: <Pencil size={13} className="text-accent" />,
        text: (
          <>
            Corrected {title}:{" "}
            {Object.keys(after).map((k) => (
              <span key={k} className="mr-1.5">
                {k} <span className="text-fg-3 line-through">{String(before[k] ?? "none")}</span> → {String(after[k] ?? "none")}
              </span>
            ))}
          </>
        ),
      };
    case "todo:add":
      return { icon: <Plus size={14} className="text-accent" />, text: <>Added {title} that Claude missed</> };
    case "todo:snooze":
      return { icon: <Undo2 size={14} className="text-fg-3" />, text: <>Snoozed {title}</> };
    case "package:not_package":
      return { icon: <PackageX size={14} className="text-red" />, text: <>Said {title} isn't a package</> };
    case "package:hide":
      return { icon: <Archive size={14} className="text-fg-3" />, text: <>Hid package {title}</> };
    case "highlight:useful":
      return { icon: <ThumbsUp size={14} className="text-green" />, text: <>Found {title} useful</> };
    case "highlight:not_important":
      return { icon: <ThumbsDown size={14} className="text-red" />, text: <>{title} wasn't worth highlighting</> };
    case "briefing:vote":
      return {
        icon: f.reason === "up" ? <ThumbsUp size={14} className="text-green" /> : <ThumbsDown size={14} className="text-red" />,
        text: <>Rated the briefing {f.reason === "up" ? "helpful" : "not helpful"}</>,
      };
    default:
      return { icon: <CircleDot size={14} className="text-fg-3" />, text: <>{f.action} {title}</> };
  }
}

function FeedbackRow({ f, compact }: { f: FeedbackEvent; compact?: boolean }) {
  const { icon, text } = describe(f);
  return (
    <div className={cn("flex items-start gap-3", compact ? "px-3 py-2" : "px-4 py-2.5")}>
      <span className="mt-0.5 flex w-4 shrink-0 justify-center">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-fg-2">{text}</div>
        {f.note && <div className="mt-0.5 text-[12.5px] text-fg-2 italic">“{f.note}”</div>}
        {f.subject && !compact && (
          <div className="mt-0.5 truncate text-[12px] text-fg-3">
            {senderName(f.sender)} · {f.subject}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 text-[11.5px] text-fg-3">
        {!f.reviewed_at && (
          <Tip label="Claude hasn't reviewed this yet">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          </Tip>
        )}
        {ago(f.created_at)}
      </div>
    </div>
  );
}
