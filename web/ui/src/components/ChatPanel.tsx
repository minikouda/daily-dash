import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  BellOff,
  Brain,
  Check,
  CircleAlert,
  Code2,
  FileCode,
  GitCommit,
  PackageX,
  RotateCcw,
  RotateCw,
  ShieldCheck,
  Terminal,
  Eye,
  Inbox,
  ListTodo,
  Loader2,
  Mail,
  Maximize2,
  Minimize2,
  Package,
  Pencil,
  Plus,
  Search,
  SquarePen,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { api, streamChat, useData, type ChatMode, type ChatPart, type ChatState, type CommitInfo, type Proposal } from "../api";
import { dueInfo } from "../lib/dates";
import { viewportWidth } from "../lib/textSize";
import { cn } from "../lib/utils";
import { DEFAULT_CHAT_WIDTH, MIN_CHAT_WIDTH, useUI } from "../store";
import { Button, Kbd, Tip } from "./ui";

const PAGE_NAME: Record<string, string> = {
  "/": "Today",
  "/inbox": "Inbox",
  "/tasks": "Tasks",
  "/packages": "Packages",
  "/learning": "Learning",
  "/settings": "Settings",
};

function toolLabel(name: string, input: Record<string, unknown>): { icon: React.ReactNode; text: string } {
  switch (name) {
    case "dashboard_overview":
      return { icon: <Eye size={12} />, text: "Looked over your dashboard" };
    case "list_tasks":
      return { icon: <ListTodo size={12} />, text: input.query ? `Looked for tasks matching “${input.query}”` : "Listed your tasks" };
    case "get_task":
      return { icon: <ListTodo size={12} />, text: `Opened task #${input.task_id}` };
    case "list_packages":
      return { icon: <Package size={12} />, text: "Checked packages" };
    case "list_highlights":
      return { icon: <Sparkles size={12} />, text: "Read your highlights" };
    case "list_rules":
      return { icon: <Brain size={12} />, text: "Checked your rules" };
    case "recent_feedback":
      return { icon: <Brain size={12} />, text: "Reviewed your recent feedback" };
    case "run_history":
      return { icon: <Inbox size={12} />, text: "Checked recent mail runs" };
    case "search_email":
      return { icon: <Search size={12} />, text: `Searched email: ${input.query}` };
    case "read_email":
      return { icon: <Mail size={12} />, text: "Read an email" };
    case "Read":
      return { icon: <FileCode size={12} />, text: `Read ${shortPath(input.file_path)}` };
    case "Glob":
      return { icon: <Search size={12} />, text: `Listed files ${input.pattern ?? ""}` };
    case "Grep":
      return { icon: <Search size={12} />, text: `Searched code for “${input.pattern}”` };
    case "Edit":
    case "Write":
      return { icon: <Pencil size={12} />, text: `${name === "Write" ? "Wrote" : "Edited"} ${shortPath(input.file_path)}` };
    case "Bash":
      return { icon: <Terminal size={12} />, text: `Ran ${String(input.command ?? "").slice(0, 80)}` };
    default:
      return { icon: <Eye size={12} />, text: name };
  }
}

const shortPath = (p: unknown) => String(p ?? "").replace(/^.*\/daily-dash\//, "");

type Live = { parts: ChatPart[]; streaming: string; thinking: boolean; error: string | null; proposals: Record<number, Proposal> };
const EMPTY_LIVE: Live = { parts: [], streaming: "", thinking: false, error: null, proposals: {} };

export function ChatPanel() {
  const { chatOpen, setChatOpen, openTaskId, chatWidth, setChatWidth, chatDraft, setChatDraft } = useUI();
  const [loc] = useLocation();
  const qc = useQueryClient();
  const { data: dash } = useData();
  const [mode, setMode] = useState<ChatMode>("assistant");
  const chat = useQuery({
    queryKey: ["chat", mode],
    queryFn: () => api.get<ChatState>(`/api/chat?mode=${mode}`),
    enabled: chatOpen,
  });
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [live, setLive] = useState<Live>(EMPTY_LIVE);
  const [useContext, setUseContext] = useState(true);
  const busy = pending !== null;
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const openTask = dash?.tasks.find((t) => t.id === openTaskId);
  const contextLabel = openTask ? `Task: ${openTask.title}` : `${PAGE_NAME[loc] ?? "Today"} page`;

  useEffect(() => {
    if (chatOpen) setTimeout(() => box.current?.focus(), 50);
  }, [chatOpen]);

  // A draft from outside (Gmail extension): assistant mode, pre-filled, not sent.
  useEffect(() => {
    if (!chatDraft) return;
    setMode("assistant");
    setInput(chatDraft);
    setChatDraft("");
    setTimeout(() => box.current?.focus(), 80);
  }, [chatDraft, setChatDraft]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [chat.data?.messages.length, live, pending]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy || !chat.data) return;
    setInput("");
    setPending(message);
    setLive(EMPTY_LIVE);
    const context = useContext && mode === "assistant" ? { page: PAGE_NAME[loc] ?? "Today", task_id: openTaskId ?? undefined } : {};
    try {
      for await (const ev of streamChat({ session_id: chat.data.session_id, message, context })) {
        setLive((l) => {
          switch (ev.type) {
            case "delta":
              return { ...l, streaming: l.streaming + ev.text, thinking: false };
            case "text_end":
              return l.streaming ? { ...l, parts: [...l.parts, { type: "text", text: l.streaming }], streaming: "" } : l;
            case "thinking":
              return { ...l, thinking: true };
            case "tool":
              return { ...l, parts: [...l.parts, { type: "tool", name: ev.name, input: ev.input }], thinking: false };
            case "proposal":
              return {
                ...l,
                parts: [...l.parts, { type: "proposal", id: ev.proposal.id }],
                proposals: { ...l.proposals, [ev.proposal.id]: ev.proposal },
              };
            case "commit": {
              const { type: _t, ...info } = ev;
              return { ...l, parts: [...l.parts, { type: "commit", ...info }] };
            }
            case "error":
              return { ...l, error: ev.message };
            default:
              return l;
          }
        });
      }
    } catch (e) {
      setLive((l) => ({ ...l, error: String(e) }));
    }
    await qc.invalidateQueries({ queryKey: ["chat", mode] });
    setPending(null);
    setLive((l) => (l.error ? { ...EMPTY_LIVE, error: l.error } : EMPTY_LIVE));
  };

  const newChat = async () => {
    const state = await api.post<ChatState>(`/api/chat/new?mode=${mode}`);
    qc.setQueryData(["chat", mode], state);
    setLive(EMPTY_LIVE);
    box.current?.focus();
  };

  const maxWidth = () => Math.max(MIN_CHAT_WIDTH, viewportWidth() - 480);
  const wide = chatWidth >= maxWidth() - 8;
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = chatWidth;
    const move = (ev: PointerEvent) =>
      setChatWidth(Math.min(maxWidth(), Math.max(MIN_CHAT_WIDTH, startW + startX - ev.clientX)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  if (!chatOpen) return null;
  const messages = chat.data?.messages ?? [];
  const proposals = { ...(chat.data?.proposals ?? {}), ...live.proposals };
  const suggestions =
    mode === "code"
      ? [
          "Prefer carrier tracking URLs over click-tracking redirect links",
          "Show the package's order number on its card",
          "Group regrade requests into one task per course",
          "Explain how a mail check works, step by step",
        ]
      : [
          openTask ? `Why is “${openTask.title}” a task? Show me the email.` : "What should I do first today?",
          "What's due before my next interview?",
          "Summarize what came in since yesterday",
          "Which of my inbox items can I safely dismiss?",
        ];

  return (
    <aside
      data-chat-panel
      style={{ width: Math.min(chatWidth, maxWidth()) }}
      className="relative flex h-full shrink-0 animate-drawer flex-col border-l border-line bg-card"
    >
      <div
        onPointerDown={startResize}
        onDoubleClick={() => setChatWidth(DEFAULT_CHAT_WIDTH)}
        title="Drag to resize · double-click to reset"
        className="absolute top-0 -left-1 z-10 h-full w-2 cursor-col-resize transition-colors hover:bg-accent/30"
      />
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
        <Sparkles size={16} className="text-accent" />
        <span className="text-[14px] font-semibold">Ask Claude</span>
        <div className="ml-2 flex gap-0.5 rounded-lg bg-hover p-0.5">
          {(["assistant", "code"] as const).map((m) => (
            <button
              key={m}
              disabled={busy}
              onClick={() => (setMode(m), setLive(EMPTY_LIVE))}
              className={cn(
                "flex h-6 items-center gap-1 rounded-md px-2 text-[12px] font-medium transition-colors disabled:opacity-60",
                mode === m ? "bg-card text-fg shadow-card" : "text-fg-3 hover:text-fg",
              )}
            >
              {m === "code" ? <Code2 size={12} /> : <Sparkles size={12} />}
              {m === "code" ? "Code" : "Assistant"}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <Tip label={wide ? "Shrink" : "Expand"}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={wide ? "Shrink chat" : "Expand chat"}
            onClick={() => setChatWidth(wide ? DEFAULT_CHAT_WIDTH : maxWidth())}
          >
            {wide ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </Button>
        </Tip>
        <Tip label="New conversation">
          <Button variant="ghost" size="icon" aria-label="New conversation" onClick={newChat} disabled={busy}>
            <SquarePen size={15} />
          </Button>
        </Tip>
        <Tip label={<>Close · ⌘J</>}>
          <Button variant="ghost" size="icon" aria-label="Close chat" onClick={() => setChatOpen(false)}>
            <X size={16} />
          </Button>
        </Tip>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-5 py-5 [&>*]:mx-auto [&>*]:max-w-[760px]">
        {messages.length === 0 && !busy ? (
          <div className="flex h-full flex-col justify-end pb-2">
            <div className="mb-4">
              <div className="mb-1 text-[15px] font-semibold">
                {mode === "code" ? "Change how Daily Dash works" : "Ask about your email and tasks"}
              </div>
              <div className="text-[13px] text-fg-3">
                {mode === "code"
                  ? "Claude works on the daily-dash code: reads files freely, but asks you before every edit and command. Each answer's changes become one git commit you can revert. Email tools are off in this mode."
                  : "Claude can look up your tasks, packages and rules, and search or read your Gmail (read-only). Changes it suggests show up as buttons you approve."}
              </div>
            </div>
            <div className="space-y-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="block w-full rounded-xl border border-line px-3 py-2 text-left text-[13px] text-fg-2 transition-colors hover:border-accent/40 hover:bg-accent-soft/40 hover:text-fg"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {messages.map((m) =>
              m.role === "user" ? (
                <UserBubble key={m.id} text={(m.parts[0] as { text: string }).text} />
              ) : (
                <AssistantTurn key={m.id} parts={m.parts} proposals={proposals} />
              ),
            )}
            {pending && (
              <>
                <UserBubble text={pending} />
                <AssistantTurn parts={live.parts} proposals={proposals} streaming={live.streaming} working={!live.streaming} />
              </>
            )}
            {live.error && (
              <div className="flex items-start gap-2 rounded-xl bg-red-soft px-3 py-2 text-[12.5px] text-red">
                <CircleAlert size={14} className="mt-0.5 shrink-0" /> {live.error}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line p-3 [&>*]:mx-auto [&>*]:max-w-[760px]">
        {mode === "code" && (
          <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-amber-soft px-2.5 py-1.5 text-[12px] text-amber">
            <ShieldCheck size={13} /> Code mode · edits the project · you approve each change · no email access
          </div>
        )}
        <div className="rounded-xl border border-line bg-bg focus-within:border-accent/60">
          <textarea
            ref={box}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder={busy ? "Claude is working…" : mode === "code" ? "Describe a change — “show order numbers on package cards”" : "Ask anything — “what's my week look like?”"}
            className="field-sizing-content max-h-64 min-h-[84px] w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[14px] outline-none placeholder:text-fg-3 focus-visible:outline-none"
          />
          <div className="flex items-center gap-2 px-2 pb-2">
            {mode === "assistant" && (
            <button
              onClick={() => setUseContext(!useContext)}
              className={cn(
                "flex h-6 max-w-[70%] items-center gap-1 truncate rounded-md px-2 text-[11.5px] font-medium",
                useContext ? "bg-accent-soft text-accent" : "bg-hover text-fg-3 line-through",
              )}
              title={useContext ? "Claude can see what you're looking at. Click to exclude." : "Context excluded"}
            >
              <Eye size={11} className="shrink-0" /> <span className="truncate">{contextLabel}</span>
            </button>
            )}
            <span className="flex-1" />
            <Button
              variant="primary"
              size="icon"
              aria-label="Send"
              disabled={busy || !input.trim()}
              onClick={() => send(input)}
              className="h-7 w-7 rounded-lg"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={15} />}
            </Button>
          </div>
        </div>
        <div className="mt-1.5 px-1 text-[11px] text-fg-3">
          <Kbd>↵</Kbd> send · <Kbd>⇧↵</Kbd> new line · <Kbd>⌘J</Kbd> toggle
        </div>
      </div>
    </aside>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[13.5px] whitespace-pre-wrap text-accent-fg">{text}</div>
    </div>
  );
}

function AssistantTurn({
  parts,
  proposals,
  streaming,
  working,
}: {
  parts: ChatPart[];
  proposals: Record<number, Proposal>;
  streaming?: string;
  working?: boolean;
}) {
  return (
    <div className="space-y-2">
      {parts.map((p, i) => {
        if (p.type === "text") return <Prose key={i} text={p.text} />;
        if (p.type === "tool") {
          const { icon, text } = toolLabel(p.name, p.input);
          return (
            <div key={i} className="flex items-center gap-1.5 text-[12px] text-fg-3">
              {icon} <span className="truncate">{text}</span>
            </div>
          );
        }
        if (p.type === "commit") return <CommitCard key={i} c={p} />;
        const prop = proposals[p.id];
        if (!prop) return null;
        if (prop.action === "permission") return <PermissionCard key={i} p={prop} />;
        if (prop.action === "draft_reply") return <DraftCard key={i} p={prop} />;
        return <ProposalCard key={i} p={prop} />;
      })}
      {streaming && <Prose text={streaming} />}
      {working && (
        <div className="flex items-center gap-2 text-[12px] text-fg-3">
          <Loader2 size={12} className="animate-spin" /> Thinking…
        </div>
      )}
    </div>
  );
}

function Prose({ text }: { text: string }) {
  return (
    <div className="prose-chat text-[13.5px] leading-relaxed text-fg">
      <Markdown>{text}</Markdown>
    </div>
  );
}

const ACTION_ICON: Record<string, React.ReactNode> = {
  add_task: <Plus size={14} />,
  edit_task: <Pencil size={13} />,
  dismiss_task: <X size={14} />,
  keep_task: <Check size={14} />,
  done_task: <Check size={14} />,
  add_rule: <Brain size={14} />,
  mute_sender: <BellOff size={14} />,
  edit_package: <Package size={14} />,
  hide_package: <Package size={14} />,
  not_package: <PackageX size={14} />,
};

function ProposalCard({ p }: { p: Proposal }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const decide = async (action: "apply" | "reject") => {
    setBusy(true);
    try {
      const res = await api.post<{ status: string; result?: string }>(`/api/chat/proposals/${p.id}`, { action });
      if (action === "apply") toast.success(res.result ?? "Applied");
    } catch (e) {
      toast.error(String(e));
    }
    await Promise.all([qc.invalidateQueries({ queryKey: ["chat"] }), qc.invalidateQueries({ queryKey: ["bootstrap"] })]);
    setBusy(false);
  };
  const due = typeof p.payload.due === "string" ? dueInfo(p.payload.due)?.long : null;
  const detail = [due, p.payload.reason && String(p.payload.reason).replace("_", " "), p.payload.scope && `applies to ${p.payload.scope}`]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={cn(
        "rounded-xl border p-3",
        p.status === "pending" ? "border-accent/35 bg-accent-soft/40" : "border-line bg-bg",
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className={cn("mt-0.5", p.status === "applied" ? "text-green" : "text-accent")}>{ACTION_ICON[p.action] ?? <Sparkles size={14} />}</span>
        <div className="min-w-0 flex-1">
          <div className={cn("text-[13.5px] font-medium", p.status === "rejected" && "text-fg-3 line-through")}>{p.summary}</div>
          {detail && <div className="mt-0.5 text-[12px] text-fg-3">{detail}</div>}
          {p.payload.rule_text && <div className="mt-1 text-[12.5px] text-fg-2 italic">“{p.payload.rule_text}”</div>}
        </div>
      </div>
      {p.status === "pending" ? (
        <div className="mt-2.5 flex gap-1.5 pl-6">
          <Button size="sm" variant="primary" disabled={busy} onClick={() => decide("apply")}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={13} />} Apply
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide("reject")}>
            No thanks
          </Button>
        </div>
      ) : (
        <div className={cn("mt-1.5 pl-6 text-[12px]", p.status === "applied" ? "text-green" : p.status === "failed" ? "text-red" : "text-fg-3")}>
          {p.status === "applied" ? `✓ ${p.result ?? "Applied"}` : p.status === "failed" ? `Couldn't apply: ${p.result}` : "Declined"}
        </div>
      )}
    </div>
  );
}

/** Approve/deny one file edit or command in Code mode. Claude is paused until you answer. */
function PermissionCard({ p }: { p: Proposal }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const decide = async (action: "apply" | "reject") => {
    setBusy(true);
    try {
      await api.post(`/api/chat/proposals/${p.id}`, { action });
    } catch (e) {
      toast.error(String(e));
    }
    await qc.invalidateQueries({ queryKey: ["chat"] });
    setBusy(false);
  };
  const tool = String(p.payload.tool);
  const input = (p.payload.input ?? {}) as Record<string, string>;
  const pending = p.status === "pending";
  return (
    <div className={cn("overflow-hidden rounded-xl border", pending ? "border-amber/50" : "border-line")}>
      <div className={cn("flex items-center gap-2 px-3 py-2 text-[12.5px]", pending ? "bg-amber-soft" : "bg-bg")}>
        {tool === "Bash" ? <Terminal size={13} /> : <FileCode size={13} />}
        <span className="min-w-0 flex-1 truncate font-medium">{shortPath(p.summary)}</span>
        {!pending && (
          <span className={cn("text-[11.5px] font-medium", p.status === "applied" ? "text-green" : "text-red")}>
            {p.status === "applied" ? "Approved" : p.result === "timed out" ? "Timed out" : "Denied"}
          </span>
        )}
      </div>
      {pending && (
        <>
          <div className="max-h-72 overflow-auto border-t border-line bg-card font-mono text-[11.5px] leading-relaxed">
            {tool === "Bash" && <pre className="px-3 py-2 whitespace-pre-wrap">{input.command}</pre>}
            {tool === "Edit" && (
              <>
                <pre className="bg-red-soft/60 px-3 py-2 whitespace-pre-wrap text-fg-2">{prefix(input.old_string, "- ")}</pre>
                <pre className="bg-green-soft/60 px-3 py-2 whitespace-pre-wrap">{prefix(input.new_string, "+ ")}</pre>
              </>
            )}
            {tool === "Write" && <pre className="px-3 py-2 whitespace-pre-wrap">{String(input.content ?? "").slice(0, 4000)}</pre>}
            {!["Bash", "Edit", "Write"].includes(tool) && <pre className="px-3 py-2 whitespace-pre-wrap">{JSON.stringify(input, null, 2)}</pre>}
          </div>
          <div className="flex gap-1.5 border-t border-line px-3 py-2">
            <Button size="sm" variant="primary" disabled={busy} onClick={() => decide("apply")}>
              <Check size={13} /> Approve
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide("reject")}>
              Deny
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

const prefix = (text: string | undefined, mark: string) =>
  String(text ?? "")
    .split("\n")
    .map((l) => mark + l)
    .join("\n");

/** One commit per Code-mode answer, with Revert and (for backend changes) Restart. */
function CommitCard({ c }: { c: CommitInfo }) {
  const [busy, setBusy] = useState<"revert" | "restart" | null>(null);
  const [reverted, setReverted] = useState<CommitInfo | null>(null);
  const needsRestart = (reverted ?? c).python_changed;

  const revert = async () => {
    setBusy("revert");
    try {
      const res = await api.post<CommitInfo>("/api/code/revert", { hash: c.hash });
      setReverted(res);
      toast.success(`Reverted ${c.hash}`, {
        description: res.ui_changed ? "Ask Claude to rebuild the frontend, or run npm run build in web/ui." : undefined,
      });
    } catch (e) {
      toast.error(String(e));
    }
    setBusy(null);
  };

  const restart = async () => {
    setBusy("restart");
    await api.post("/api/restart").catch(() => undefined);
    // Wait for launchd to bring the server back.
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 750));
      try {
        await api.get("/api/bootstrap");
        toast.success("Dashboard restarted with the new code");
        setBusy(null);
        return;
      } catch {
        /* still restarting */
      }
    }
    toast.error("The dashboard didn't come back. Check ~/.daily-dash/logs/web.log");
    setBusy(null);
  };

  return (
    <div className="rounded-xl border border-line bg-bg p-3">
      <div className="flex items-center gap-2 text-[12.5px]">
        <GitCommit size={14} className="text-accent" />
        <span className="font-medium">Committed</span>
        <code className="rounded bg-hover px-1 font-mono text-[11.5px]">{c.hash}</code>
        <span className="text-fg-3">
          · {c.files.length} {c.files.length === 1 ? "file" : "files"}
        </span>
        {reverted && <span className="ml-auto text-[11.5px] font-medium text-fg-3">Reverted in {reverted.hash}</span>}
      </div>
      <div className="mt-1.5 space-y-0.5 pl-6 font-mono text-[11.5px] text-fg-3">
        {c.files.slice(0, 8).map((f) => (
          <div key={f} className="truncate">
            {f}
          </div>
        ))}
        {c.files.length > 8 && <div>…and {c.files.length - 8} more</div>}
      </div>
      <div className="mt-2.5 flex gap-1.5 pl-6">
        {needsRestart && (
          <Button size="sm" variant="primary" disabled={!!busy} onClick={restart}>
            {busy === "restart" ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />} Restart dashboard
          </Button>
        )}
        {!reverted && (
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={revert}>
            {busy === "revert" ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Revert
          </Button>
        )}
      </div>
    </div>
  );
}

/** A reply Claude drafted. In the dashboard it can be copied; the Gmail extension inserts it into the reply box. */
function DraftCard({ p }: { p: Proposal }) {
  const qc = useQueryClient();
  const body = String(p.payload.body ?? "");
  const mark = async (action: "apply" | "reject") => {
    await api.post(`/api/chat/proposals/${p.id}`, { action }).catch(() => undefined);
    qc.invalidateQueries({ queryKey: ["chat"] });
  };
  const copy = async () => {
    await navigator.clipboard.writeText(body);
    toast.success("Draft copied — paste it into your reply");
    mark("apply");
  };
  return (
    <div className={cn("rounded-xl border p-3", p.status === "pending" ? "border-accent/35 bg-accent-soft/40" : "border-line bg-bg")}>
      <div className="flex items-center gap-2 text-[13.5px] font-medium">
        <Mail size={14} className="text-accent" /> {p.summary}
        {p.payload.reply_all ? <span className="text-[11.5px] font-normal text-fg-3">· reply all</span> : null}
      </div>
      <pre className="mt-2 max-h-64 overflow-auto rounded-lg border border-line bg-card px-3 py-2 font-sans text-[13px] leading-relaxed whitespace-pre-wrap">
        {body}
      </pre>
      {p.status === "pending" ? (
        <div className="mt-2.5 flex items-center gap-1.5">
          <Button size="sm" variant="primary" onClick={copy}>
            <Check size={13} /> Copy
          </Button>
          <Button size="sm" variant="ghost" onClick={() => mark("reject")}>
            No thanks
          </Button>
          <span className="ml-auto text-[11.5px] text-fg-3">In Gmail, the extension can insert it for you</span>
        </div>
      ) : (
        <div className={cn("mt-1.5 text-[12px]", p.status === "applied" ? "text-green" : "text-fg-3")}>
          {p.status === "applied" ? "✓ Used" : "Declined"}
        </div>
      )}
    </div>
  );
}
