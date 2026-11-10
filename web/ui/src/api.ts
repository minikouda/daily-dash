import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export type Source = {
  id: string;
  account: string;
  sender: string | null;
  sender_email: string | null;
  subject: string | null;
  received_at: string | null;
  link: string | null;
};

export type TaskStatus = "inbox" | "open" | "done" | "dismissed";
export type Kind = "deadline" | "payment" | "reply" | "event" | "todo";

export type Task = {
  id: number;
  title: string;
  notes: string;
  due: string | null;
  kind: Kind;
  priority: 1 | 2 | 3;
  status: TaskStatus;
  origin: "email" | "manual";
  snoozed_until: string | null;
  has_reminder: boolean;
  created_at: string;
  updated_at: string;
  source: Source | null;
};

export type PackageStatus = "ordered" | "shipped" | "in_transit" | "out_for_delivery" | "delivered" | "exception";

export type Package = {
  key: string;
  tracking_number: string | null;
  order_number: string | null;
  carrier: string | null;
  merchant: string | null;
  description: string | null;
  status: PackageStatus;
  eta: string | null;
  tracking_url: string | null;
  last_update: string;
  delivered_at: string | null;
  archived: boolean;
  source: Source | null;
};

export type Highlight = {
  id: string;
  headline: string;
  why: string;
  created_at: string;
  rating: string | null;
  source: Source | null;
};

export type Rule = {
  id: number;
  kind: "instruction" | "ignore_sender" | "retire";
  scope: "todos" | "packages" | "highlights" | "general";
  text: string;
  rationale: string | null;
  status: "proposed" | "active" | "rejected" | "retired" | "accepted";
  origin: "learned" | "user";
  created_at: string;
  decided_at: string | null;
  evidence: number[];
};

export type FeedbackEvent = {
  id: number;
  created_at: string;
  item_type: string;
  action: string;
  reason: string | null;
  note: string | null;
  before_json: string | null;
  after_json: string | null;
  sender: string | null;
  subject: string | null;
  reviewed_at: string | null;
};

export type Run = {
  id: number;
  kind: string;
  started_at: string;
  finished_at: string | null;
  ok: number | null;
  fetched: number;
  extracted: number;
};

export type Bootstrap = {
  now: string;
  timezone: string;
  tasks: Task[];
  packages: Package[];
  highlights: Highlight[];
  briefing: { id: number; created_at: string; body: string; vote: string | null } | null;
  rules: Rule[];
  feedback: FeedbackEvent[];
  learn: {
    last: { at: string; reviewed?: number; proposed?: number; summary?: string; error?: string } | null;
    pending: number;
    running: boolean;
  };
  runs: Run[];
  accounts: { email: string; connected: boolean; last_fetch: string | null }[];
  reminders: { enabled: boolean; list: string };
};

export type EmailMessage = {
  id: string;
  account: string;
  from: string;
  subject: string;
  received_at: string;
  body: string;
  link: string;
};

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      // Required by the server on writes; other websites can't send it (see app.py).
      "X-Daily-Dash": "1",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* not json */
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return res.json();
}

export const api = {
  get: <T>(p: string) => request<T>("GET", p),
  post: <T>(p: string, b?: unknown) => request<T>("POST", p, b ?? {}),
  patch: <T>(p: string, b: unknown) => request<T>("PATCH", p, b),
};

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: true, retry: 1 } },
});

const KEY = ["bootstrap"];

/** All dashboard data. Polls quickly while a run or learner review is in flight. */
export function useData() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get<Bootstrap>("/api/bootstrap"),
    refetchInterval: (q) => {
      const d = q.state.data;
      const busy = d && (d.learn.running || d.runs.some((r) => !r.finished_at));
      return busy ? 2_500 : 30_000;
    },
  });
}

export function useEmail(id: string | undefined) {
  return useQuery({
    queryKey: ["email", id],
    queryFn: () => api.get<EmailMessage>(`/api/messages/${id}`),
    enabled: !!id,
    staleTime: Infinity,
    retry: 0,
  });
}

/** Optimistically patch one task in the cached bootstrap. */
function patchTask(qc: ReturnType<typeof useQueryClient>, id: number, change: Partial<Task>) {
  qc.setQueryData<Bootstrap>(KEY, (d) =>
    d ? { ...d, tasks: d.tasks.map((t) => (t.id === id ? { ...t, ...change } : t)) } : d,
  );
}

const ACTION_COPY: Record<string, string> = {
  keep: "Kept",
  done: "Marked done",
  dismiss: "Dismissed",
  snooze: "Snoozed",
  reopen: "Reopened",
  restore: "Restored",
};

export type TriageArgs = { id: number; action: string; reason?: string; note?: string; until?: string; silent?: boolean };

export function useTriage() {
  const qc = useQueryClient();
  const undo = useUndo();
  return useMutation({
    mutationFn: ({ id, ...b }: TriageArgs) =>
      api.post<{ task: Task; feedback_id: number }>(`/api/todos/${id}/triage`, b),
    onMutate: ({ id, action, until }) => {
      const status: Partial<Record<string, TaskStatus>> = {
        keep: "open", done: "done", dismiss: "dismissed", reopen: "open", restore: "open",
      };
      patchTask(qc, id, action === "snooze" ? { snoozed_until: until ?? null } : { status: status[action] });
    },
    onSuccess: (res, v) => {
      patchTask(qc, v.id, res.task);
      if (!v.silent) {
        toast(ACTION_COPY[v.action] ?? "Updated", {
          description: res.task.title,
          action: { label: "Undo", onClick: () => undo.mutate(res.feedback_id) },
        });
      }
    },
    onError: (e) => toast.error(String(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useEditTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...b }: { id: number } & Partial<Pick<Task, "title" | "due" | "notes" | "priority" | "kind">> & { clear_due?: boolean; note?: string }) =>
      api.patch<{ task: Task; feedback_id: number | null }>(`/api/todos/${id}`, b),
    onMutate: ({ id, clear_due, note: _note, ...change }) => patchTask(qc, id, clear_due ? { ...change, due: null } : change),
    onSuccess: (res) => patchTask(qc, res.task.id, res.task),
    onError: (e) => toast.error(String(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useAddTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { title: string; due?: string | null; priority?: number; kind?: string; missed?: boolean; note?: string }) =>
      api.post<{ task: Task }>("/api/todos", b),
    onSuccess: (res, v) => {
      toast.success(v.missed ? "Added — Claude will learn from this" : "Task added", { description: res.task.title });
    },
    onError: (e) => toast.error(String(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUndo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (feedbackId: number) => api.post(`/api/undo/${feedbackId}`),
    onSuccess: () => toast("Undone"),
    onError: (e) => toast.error(String(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Generic action that returns a feedback id and offers Undo. */
export function useFeedbackAction() {
  const qc = useQueryClient();
  const undo = useUndo();
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown; message: string }) =>
      api.post<{ feedback_id: number }>(path, body),
    onSuccess: (res, v) => {
      toast(v.message, { action: { label: "Undo", onClick: () => undo.mutate(res.feedback_id) } });
    },
    onError: (e) => toast.error(String(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function usePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown; message?: string }) => api.post(path, body),
    onSuccess: (_r, v) => v.message && toast(v.message),
    onError: (e) => toast.error(String(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

// --- chat ------------------------------------------------------------------------------

export type ChatPart =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; input: Record<string, unknown> }
  | { type: "proposal"; id: number }
  | ({ type: "commit" } & CommitInfo);

export type CommitInfo = { hash: string; files: string[]; python_changed: boolean; ui_changed: boolean };
export type ChatMode = "assistant" | "code";

export type ChatMessage = { id: number; role: "user" | "assistant"; parts: ChatPart[]; created_at: string };

export type Proposal = {
  id: number;
  action: string;
  payload: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  summary: string;
  status: "pending" | "applied" | "rejected" | "failed";
  result: string | null;
};

export type ChatState = { session_id: string; mode: ChatMode; messages: ChatMessage[]; proposals: Record<number, Proposal> };

export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "text_end" }
  | { type: "thinking" }
  | { type: "tool"; name: string; input: Record<string, unknown> }
  | { type: "proposal"; proposal: Proposal }
  | ({ type: "commit" } & CommitInfo)
  | { type: "error"; message: string }
  | { type: "done" };

/** POST a chat turn and yield the newline-delimited JSON events as they stream in. */
export async function* streamChat(body: { session_id: string; message: string; context: object }): AsyncGenerator<ChatEvent> {
  const res = await fetch("/api/chat/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Daily-Dash": "1" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* not json */
    }
    yield { type: "error", message: String(detail) };
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) yield JSON.parse(line) as ChatEvent;
    }
  }
}
