"""Dashboard backend: a JSON API under /api plus the built React app (web/ui -> web/dist).

Every user decision goes through here and is logged as feedback (learn.record),
which the learner later turns into proposed rules.
"""

import json
import os
import subprocess
import sys
import threading
from datetime import datetime, timedelta, timezone
from email.utils import parseaddr
from functools import lru_cache

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .. import chat, config, db, gmail, learn, todos
from ..db import now_iso

DIST = config.PACKAGE_DIR / "web" / "dist"
app = FastAPI(title="Daily Dash")

# Every write must carry this header. Browsers won't send a custom header to
# another origin without a CORS preflight (which this server never approves),
# so other websites can't trigger runs or changes on 127.0.0.1. The dashboard
# and the Gmail extension both send it.
CSRF_HEADER = "x-daily-dash"


@app.middleware("http")
async def require_header_for_writes(request: Request, call_next):
    if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get(CSRF_HEADER) != "1":
        return JSONResponse({"detail": "missing X-Daily-Dash header"}, status_code=403)
    return await call_next(request)


def cfg() -> dict:
    return config.load()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


# --- serialization ---------------------------------------------------------------------

def _source(row) -> dict | None:
    if not row["source_msg_id"]:
        return None
    account, thread = row["account"], row["thread_id"]
    return {
        "id": row["source_msg_id"], "account": account, "sender": row["mail_sender"],
        "sender_email": parseaddr(row["mail_sender"] or "")[1].lower() or None,
        "subject": row["mail_subject"], "received_at": row["mail_received"],
        "link": gmail.thread_link(account, thread) if account and thread else None,
    }


JOIN_MSG = (" LEFT JOIN messages m ON m.id = {t}.source_msg_id",
            "m.thread_id, m.sender AS mail_sender, m.subject AS mail_subject, m.received_at AS mail_received")


def _select(table: str, alias: str) -> str:
    join, cols = JOIN_MSG
    return f"SELECT {alias}.*, {cols} FROM {table} {alias}" + join.format(t=alias)


def todo_json(row) -> dict:
    return {
        "id": row["id"], "title": row["title"], "notes": row["notes"] or "", "due": row["due"],
        "kind": row["kind"], "priority": row["priority"], "status": row["status"], "origin": row["origin"],
        "snoozed_until": row["snoozed_until"], "has_reminder": bool(row["reminder_id"]),
        "created_at": row["created_at"], "updated_at": row["updated_at"], "source": _source(row),
    }


def package_json(row) -> dict:
    return {
        "key": row["key"], "tracking_number": row["tracking_number"], "order_number": row["order_number"],
        "carrier": row["carrier"], "merchant": row["merchant"], "description": row["description"],
        "status": row["status"], "eta": row["eta"], "tracking_url": row["tracking_url"],
        "last_update": row["last_update"], "delivered_at": row["delivered_at"],
        "archived": bool(row["archived"]), "source": _source(row),
    }


def highlight_json(row) -> dict:
    return {
        "id": row["source_msg_id"], "headline": row["headline"], "why": row["why"] or "",
        "created_at": row["created_at"], "rating": row["rating"], "source": _source(row),
    }


def rule_json(row) -> dict:
    return {k: row[k] for k in ("id", "kind", "scope", "text", "rationale", "status", "origin",
                                "created_at", "decided_at")} | {"evidence": json.loads(row["evidence"] or "[]")}


def todo_by_id(conn, todo_id: int) -> dict:
    row = conn.execute(_select("todos", "t") + " WHERE t.id = ?", (todo_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "no such task")
    return todo_json(row)


# --- read ----------------------------------------------------------------------------------

_learning = threading.Lock()


@app.get("/api/bootstrap")
def bootstrap():
    """Everything the UI shows, in one round trip (the data set is small)."""
    c = cfg()
    week_ago = (utc_now() - timedelta(days=7)).isoformat()
    with db.session() as conn:
        tasks = [todo_json(r) for r in conn.execute(
            _select("todos", "t") + " WHERE t.status IN ('inbox', 'open')"
            " OR (t.status IN ('done', 'dismissed') AND t.updated_at > ?)", (week_ago,))]
        pkgs = [package_json(r) for r in conn.execute(
            _select("packages", "p") + " WHERE p.dismissed = 0 AND (p.archived = 0 OR p.last_update > ?)",
            (week_ago,))]
        hls = [highlight_json(r) for r in conn.execute(
            _select("highlights", "h") + " WHERE h.dismissed = 0 AND h.created_at > ?"
            " ORDER BY h.created_at DESC", (week_ago,))]
        b = conn.execute("SELECT * FROM briefings ORDER BY id DESC LIMIT 1").fetchone()
        rules = [rule_json(r) for r in conn.execute(
            "SELECT * FROM rules WHERE status != 'rejected' OR decided_at > ? ORDER BY id DESC", (week_ago,))]
        fb = [dict(r) for r in conn.execute(
            "SELECT id, created_at, item_type, action, reason, note, before_json, after_json, sender, subject,"
            " reviewed_at FROM feedback ORDER BY id DESC LIMIT 60")]
        runs = [dict(r) for r in conn.execute(
            "SELECT id, kind, started_at, finished_at, ok, fetched, extracted FROM runs ORDER BY id DESC LIMIT 12")]
        accounts = [{"email": a, "connected": gmail.token_path(a).exists(),
                     "last_fetch": db.get_state(conn, f"last_fetch:{a}")} for a in c["accounts"]]
        last_learn = db.get_state(conn, "last_learn")
        pending = conn.execute("SELECT COUNT(*) FROM feedback WHERE reviewed_at IS NULL").fetchone()[0]
    return {
        "now": now_iso(), "timezone": c["timezone"],
        "tasks": tasks, "packages": pkgs, "highlights": hls,
        "briefing": dict(b) if b else None,
        "rules": rules, "feedback": fb,
        "learn": {"last": json.loads(last_learn) if last_learn else None, "pending": pending,
                  "running": _learning.locked()},
        "runs": runs, "accounts": accounts,
        "reminders": {"enabled": c["reminders"]["enabled"], "list": c["reminders"]["list_name"]},
    }


@app.get("/api/summary")
def summary():
    """Counts for the Gmail extension's pill and popup."""
    from zoneinfo import ZoneInfo
    tz = ZoneInfo(cfg()["timezone"])
    today = datetime.now(tz).date().isoformat()
    now = utc_now().isoformat()
    with db.session() as conn:
        active = conn.execute(
            "SELECT status, due FROM todos WHERE status IN ('inbox', 'open')"
            " AND (snoozed_until IS NULL OR snoozed_until <= ?)", (now,)).fetchall()
        arriving = conn.execute(
            "SELECT COUNT(*) FROM packages WHERE archived = 0 AND dismissed = 0 AND status != 'delivered'"
            " AND substr(eta, 1, 10) = ?", (today,)).fetchone()[0]
        run = conn.execute("SELECT finished_at, ok FROM runs ORDER BY id DESC LIMIT 1").fetchone()
        proposals = conn.execute("SELECT COUNT(*) FROM rules WHERE status = 'proposed'").fetchone()[0]

    def local_day(due: str) -> str:
        return due if len(due) == 10 else datetime.fromisoformat(due).astimezone(tz).date().isoformat()

    dated = [local_day(r["due"]) for r in active if r["due"]]
    return {
        "inbox": sum(r["status"] == "inbox" for r in active),
        "due_today": sum(d == today for d in dated),
        "overdue": sum(d < today for d in dated),
        "arriving_today": arriving,
        "rule_suggestions": proposals,
        "last_check": dict(run) if run else None,
    }


@lru_cache(maxsize=64)
def _message(account: str, msg_id: str) -> dict:
    m = gmail.get_message(account, msg_id)
    return {k: m[k] for k in ("id", "account", "from", "subject", "received_at", "body")} | {
        "link": gmail.thread_link(account, m["thread_id"])}


@app.get("/api/messages/{msg_id}")
def message(msg_id: str):
    with db.session() as conn:
        row = conn.execute("SELECT account FROM messages WHERE id = ?", (msg_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "unknown message")
    try:
        return _message(row["account"], msg_id)
    except Exception as e:
        raise HTTPException(502, f"couldn't load from Gmail: {e}")


# --- tasks -------------------------------------------------------------------------------

class TriageIn(BaseModel):
    action: str                       # keep | done | dismiss | snooze | reopen | restore
    reason: str | None = None         # for dismiss
    note: str | None = None
    until: str | None = None          # ISO, for snooze


@app.post("/api/todos/{todo_id}/triage")
def triage(todo_id: int, body: TriageIn):
    c = cfg()
    with db.session() as conn:
        row = todos.get(conn, todo_id)
        if row is None:
            raise HTTPException(404, "no such task")
        before = {"status": row["status"], "snoozed_until": row["snoozed_until"], "title": row["title"],
                  "due": row["due"], "kind": row["kind"], "notes": row["notes"]}
        if body.action == "keep":
            todos.set_status(conn, todo_id, "open", c)
            todos.push_one(conn, todo_id, c)
        elif body.action == "done":
            todos.set_status(conn, todo_id, "done", c)
        elif body.action == "dismiss":
            todos.set_status(conn, todo_id, "dismissed", c)
        elif body.action in ("reopen", "restore"):
            todos.set_status(conn, todo_id, "open", c)
            todos.push_one(conn, todo_id, c)
        elif body.action == "snooze":
            if not body.until:
                raise HTTPException(422, "snooze needs until")
            until = datetime.fromisoformat(body.until).astimezone(timezone.utc).isoformat(timespec="seconds")
            todos.snooze(conn, todo_id, until)
        else:
            raise HTTPException(422, f"unknown action {body.action}")
        fid = learn.record(conn, "todo", todo_id, body.action, reason=body.reason, note=body.note,
                           before=before, source_msg_id=row["source_msg_id"])
        if body.action == "dismiss" and body.reason == "mute_sender" and row["source_msg_id"]:
            m = conn.execute("SELECT sender FROM messages WHERE id = ?", (row["source_msg_id"],)).fetchone()
            sender = parseaddr(m["sender"] or "")[1] if m else ""
            if sender:
                learn.mute_sender(conn, sender, fid)
                # Clear the rest of that sender's untriaged items too.
                conn.execute(
                    "UPDATE todos SET status = 'dismissed', updated_at = ? WHERE status = 'inbox' AND source_msg_id IN"
                    " (SELECT id FROM messages WHERE sender LIKE ?)", (now_iso(), f"%{sender}%"))
        return {"task": todo_by_id(conn, todo_id), "feedback_id": fid}


class TodoPatch(BaseModel):
    title: str | None = None
    due: str | None = None
    clear_due: bool = False
    notes: str | None = None
    priority: int | None = None
    kind: str | None = None
    note: str | None = None           # explanation for Claude


@app.patch("/api/todos/{todo_id}")
def edit_todo(todo_id: int, body: TodoPatch):
    changes = {k: v for k, v in body.model_dump(exclude={"note", "clear_due"}).items() if v is not None}
    if body.clear_due:
        changes["due"] = None
    if "title" in changes:
        changes["title"] = changes["title"].strip()
        if not changes["title"]:
            raise HTTPException(422, "title can't be empty")
    with db.session() as conn:
        row = todos.get(conn, todo_id)
        if row is None:
            raise HTTPException(404, "no such task")
        diff = todos.edit(conn, todo_id, changes)
        fid = None
        if diff["after"] and row["origin"] == "email":
            fid = learn.record(conn, "todo", todo_id, "edit", note=body.note,
                               before=diff["before"] | {"title": row["title"]}, after=diff["after"],
                               source_msg_id=row["source_msg_id"])
        if row["status"] == "inbox" and diff["after"]:
            # Fixing an item while triaging means it's worth keeping.
            todos.set_status(conn, todo_id, "open", cfg())
            todos.push_one(conn, todo_id, cfg())
        return {"task": todo_by_id(conn, todo_id), "feedback_id": fid}


class TodoIn(BaseModel):
    title: str
    due: str | None = None
    priority: int = 2
    kind: str = "todo"
    notes: str = ""
    missed: bool = False              # "Claude should have caught this"
    note: str | None = None


@app.post("/api/todos")
def add_todo(body: TodoIn):
    title = body.title.strip()
    if not title:
        raise HTTPException(422, "title can't be empty")
    with db.session() as conn:
        tid = todos.add(conn, title, body.due, body.notes, body.kind, body.priority, origin="manual")
        if tid is None:
            raise HTTPException(409, "that task already exists")
        if body.missed:
            learn.record(conn, "todo", tid, "add", note=body.note,
                         after={"title": title, "due": body.due, "kind": body.kind})
        todos.push_one(conn, tid, cfg())
        return {"task": todo_by_id(conn, tid)}


@app.post("/api/inbox/keep-all")
def keep_all():
    c = cfg()
    with db.session() as conn:
        ids = [r["id"] for r in conn.execute("SELECT id, source_msg_id FROM todos WHERE status = 'inbox'")]
        kept = []
        for tid in ids:
            row = todos.get(conn, tid)
            # Conditional update: a concurrent second click finds nothing left to keep.
            if conn.execute("UPDATE todos SET status = 'open', updated_at = ? WHERE id = ? AND status = 'inbox'",
                            (now_iso(), tid)).rowcount:
                kept.append(tid)
                learn.record(conn, "todo", tid, "keep", before={"status": "inbox", "title": row["title"]},
                             source_msg_id=row["source_msg_id"])
        ids = kept
        for tid in ids:
            todos.push_one(conn, tid, c)
    return {"kept": len(ids)}


class ReasonIn(BaseModel):
    reason: str
    note: str | None = None


@app.post("/api/feedback/{feedback_id}/reason")
def add_reason(feedback_id: int, body: ReasonIn):
    """Attach a reason to a quick dismissal after the fact ("Why?" on the toast)."""
    with db.session() as conn:
        fb = conn.execute("SELECT * FROM feedback WHERE id = ?", (feedback_id,)).fetchone()
        if fb is None:
            raise HTTPException(404, "no such feedback")
        conn.execute("UPDATE feedback SET reason = ?, note = ?, reviewed_at = NULL WHERE id = ?",
                     (body.reason, (body.note or "").strip() or None, feedback_id))
        if body.reason == "mute_sender" and fb["item_type"] == "todo":
            row = todos.get(conn, int(fb["item_id"]))
            m = row and row["source_msg_id"] and conn.execute(
                "SELECT sender FROM messages WHERE id = ?", (row["source_msg_id"],)).fetchone()
            sender = parseaddr(m["sender"] or "")[1] if m else ""
            if sender:
                learn.mute_sender(conn, sender, feedback_id)
    return {"ok": True}


# --- undo ------------------------------------------------------------------------------------

@app.post("/api/undo/{feedback_id}")
def undo(feedback_id: int):
    c = cfg()
    with db.session() as conn:
        fb = conn.execute("SELECT * FROM feedback WHERE id = ?", (feedback_id,)).fetchone()
        if fb is None:
            raise HTTPException(404, "nothing to undo")
        before = json.loads(fb["before_json"] or "{}")
        item = fb["item_id"]
        if fb["item_type"] == "todo":
            tid = int(item)
            if fb["action"] == "edit":
                todos.edit(conn, tid, {k: v for k, v in before.items() if k in todos.EDITABLE})
            elif fb["action"] == "add":
                pass  # undoing the "missed" flag only; the task stays
            else:
                todos.set_status(conn, tid, before.get("status", "open"), c)
                conn.execute("UPDATE todos SET snoozed_until = ? WHERE id = ?", (before.get("snoozed_until"), tid))
                if fb["reason"] == "mute_sender":
                    conn.execute("UPDATE rules SET status = 'retired', decided_at = ?"
                                 " WHERE kind = 'ignore_sender' AND evidence = ?", (now_iso(), json.dumps([feedback_id])))
                if before.get("status") == "open":
                    todos.push_one(conn, tid, c)
        elif fb["item_type"] == "package":
            conn.execute("UPDATE packages SET dismissed = ?, archived = ? WHERE key = ?",
                         (before.get("dismissed", 0), before.get("archived", 0), item))
        elif fb["item_type"] == "highlight":
            conn.execute("UPDATE highlights SET dismissed = ?, rating = ? WHERE source_msg_id = ?",
                         (before.get("dismissed", 0), before.get("rating"), item))
        elif fb["item_type"] == "briefing":
            conn.execute("UPDATE briefings SET vote = ? WHERE id = ?", (before.get("vote"), item))
        conn.execute("DELETE FROM feedback WHERE id = ?", (feedback_id,))
    return {"ok": True}


# --- packages, highlights, briefing ----------------------------------------------------------

class ActionIn(BaseModel):
    action: str
    note: str | None = None


@app.post("/api/packages/{key:path}/action")
def package_action(key: str, body: ActionIn):
    with db.session() as conn:
        row = conn.execute("SELECT * FROM packages WHERE key = ?", (key,)).fetchone()
        if row is None:
            raise HTTPException(404, "no such package")
        before = {"dismissed": row["dismissed"], "archived": row["archived"],
                  "description": row["description"], "tracking_number": row["tracking_number"],
                  "merchant": row["merchant"]}
        if body.action == "hide":
            conn.execute("UPDATE packages SET archived = 1 WHERE key = ?", (key,))
        elif body.action == "unhide":
            conn.execute("UPDATE packages SET archived = 0 WHERE key = ?", (key,))
        elif body.action == "not_package":
            conn.execute("UPDATE packages SET dismissed = 1 WHERE key = ?", (key,))
        else:
            raise HTTPException(422, f"unknown action {body.action}")
        fid = learn.record(conn, "package", key, body.action, note=body.note, before=before,
                           source_msg_id=row["source_msg_id"])
    return {"feedback_id": fid}


@app.post("/api/highlights/{msg_id}/action")
def highlight_action(msg_id: str, body: ActionIn):
    with db.session() as conn:
        row = conn.execute("SELECT * FROM highlights WHERE source_msg_id = ?", (msg_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "no such highlight")
        before = {"dismissed": row["dismissed"], "rating": row["rating"], "headline": row["headline"]}
        if body.action == "useful":
            conn.execute("UPDATE highlights SET rating = 'useful' WHERE source_msg_id = ?", (msg_id,))
        elif body.action in ("not_important", "mute_sender"):
            conn.execute("UPDATE highlights SET rating = 'not_important', dismissed = 1 WHERE source_msg_id = ?", (msg_id,))
        elif body.action == "dismiss":
            conn.execute("UPDATE highlights SET dismissed = 1 WHERE source_msg_id = ?", (msg_id,))
        else:
            raise HTTPException(422, f"unknown action {body.action}")
        action = "not_important" if body.action == "mute_sender" else body.action
        fid = learn.record(conn, "highlight", msg_id, action, note=body.note, before=before,
                           reason="mute_sender" if body.action == "mute_sender" else None, source_msg_id=msg_id)
        if body.action == "mute_sender":
            m = conn.execute("SELECT sender FROM messages WHERE id = ?", (msg_id,)).fetchone()
            sender = parseaddr(m["sender"] or "")[1] if m else ""
            if sender:
                learn.mute_sender(conn, sender, fid)
    return {"feedback_id": fid}


class VoteIn(BaseModel):
    vote: str                         # up | down
    note: str | None = None


@app.post("/api/briefings/{briefing_id}/vote")
def vote_briefing(briefing_id: int, body: VoteIn):
    with db.session() as conn:
        row = conn.execute("SELECT * FROM briefings WHERE id = ?", (briefing_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "no such briefing")
        conn.execute("UPDATE briefings SET vote = ? WHERE id = ?", (body.vote, briefing_id))
        fid = learn.record(conn, "briefing", briefing_id, "vote", reason=body.vote, note=body.note,
                           before={"vote": row["vote"], "excerpt": row["body"][:600]})
    return {"feedback_id": fid}


# --- rules & learning --------------------------------------------------------------------------

class RuleIn(BaseModel):
    text: str
    scope: str = "general"


@app.post("/api/rules")
def add_rule(body: RuleIn):
    if not body.text.strip():
        raise HTTPException(422, "empty rule")
    with db.session() as conn:
        rid = learn.add_user_rule(conn, body.text, body.scope)
    return {"id": rid}


class RuleAction(BaseModel):
    action: str                       # accept | reject | retire | restore | edit
    text: str | None = None


@app.post("/api/rules/{rule_id}")
def rule_action(rule_id: int, body: RuleAction):
    with db.session() as conn:
        row = conn.execute("SELECT * FROM rules WHERE id = ?", (rule_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "no such rule")
        if body.action == "accept" and row["kind"] == "retire":
            learn.accept_retire(conn, rule_id)
        elif body.action == "accept":
            learn.decide(conn, rule_id, "active", body.text)
        elif body.action == "reject":
            learn.decide(conn, rule_id, "rejected")
        elif body.action == "retire":
            learn.decide(conn, rule_id, "retired")
        elif body.action == "restore":
            learn.decide(conn, rule_id, "active")
        elif body.action == "edit" and body.text:
            learn.decide(conn, rule_id, row["status"], body.text)
        else:
            raise HTTPException(422, f"unknown action {body.action}")
    return {"ok": True}


def _learn_job():
    try:
        with db.session() as conn:
            learn.review(conn, cfg())
    except Exception as e:
        with db.session() as conn:
            db.set_state(conn, "last_learn", json.dumps({"at": now_iso(), "error": str(e)[:500]}))
    finally:
        _learning.release()


@app.post("/api/learn")
def run_learn():
    if not _learning.acquire(blocking=False):
        return {"started": False, "reason": "already running"}
    threading.Thread(target=_learn_job, daemon=True).start()
    return {"started": True}


@app.post("/api/run/{kind}")
def run_now(kind: str):
    if kind not in ("digest", "refresh"):
        raise HTTPException(404)
    with db.session() as conn:
        busy = conn.execute(
            "SELECT 1 FROM runs WHERE finished_at IS NULL AND started_at > ?",
            ((utc_now() - timedelta(minutes=30)).isoformat(),)).fetchone()
    if busy:
        raise HTTPException(409, "A mail check is already running")
    log = (config.LOGS_DIR / "manual.log").open("a")
    subprocess.Popen([sys.executable, "-m", "daily_dash.pipeline", "run", kind],
                     stdout=log, stderr=log, start_new_session=True)
    return {"started": True}


@app.get("/api/runs/{run_id}/log")
def run_log(run_id: int):
    with db.session() as conn:
        row = conn.execute("SELECT log FROM runs WHERE id = ?", (run_id,)).fetchone()
    return {"log": row["log"] if row else ""}


# --- chat --------------------------------------------------------------------------------------------

@app.get("/api/chat")
def chat_state(mode: str = "assistant"):
    if mode not in ("assistant", "code"):
        raise HTTPException(422, "mode must be assistant or code")
    with db.session() as conn:
        return chat.history(conn, chat.current_session(conn, mode))


@app.post("/api/chat/new")
def chat_new(mode: str = "assistant"):
    if mode not in ("assistant", "code"):
        raise HTTPException(422, "mode must be assistant or code")
    with db.session() as conn:
        return chat.history(conn, chat.new_session(conn, mode))


class RevertIn(BaseModel):
    hash: str


@app.post("/api/code/revert")
def code_revert(body: RevertIn):
    if not body.hash.isalnum():
        raise HTTPException(422, "bad commit hash")
    try:
        return chat.revert(body.hash)
    except subprocess.CalledProcessError as e:
        raise HTTPException(409, f"git revert failed: {e.stderr.strip()[-300:]}")


@app.post("/api/restart")
def restart():
    """Exit shortly after replying; launchd (KeepAlive) starts a fresh server with the new code."""
    threading.Timer(0.6, lambda: os._exit(0)).start()
    return {"restarting": True}


class ChatIn(BaseModel):
    session_id: str
    message: str
    context: dict = {}


_chatting = threading.Lock()


@app.post("/api/chat/send")
async def chat_send(body: ChatIn):
    if not body.message.strip():
        raise HTTPException(422, "empty message")
    if not _chatting.acquire(blocking=False):
        raise HTTPException(409, "Claude is still answering")

    async def events():
        try:
            async for ev in chat.stream_turn(body.session_id, body.message.strip(), body.context):
                yield json.dumps(ev, ensure_ascii=False) + "\n"
        except Exception as e:
            yield json.dumps({"type": "error", "message": str(e)[:500]}) + "\n"
        finally:
            _chatting.release()

    # Newline-delimited JSON; the UI reads it with fetch() + a stream reader.
    return StreamingResponse(events(), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


class ProposalIn(BaseModel):
    action: str                       # apply | reject


@app.post("/api/chat/proposals/{proposal_id}")
def chat_proposal(proposal_id: int, body: ProposalIn):
    failed, error = False, ""
    with db.session() as conn:
        if body.action == "reject":
            chat.reject(conn, proposal_id)
            return {"status": "rejected"}
        try:
            return chat.apply(conn, proposal_id, cfg())
        except ValueError as e:
            failed = True
            error = str(e)
            conn.execute("UPDATE chat_proposals SET status = 'failed', result = ? WHERE id = ? AND status = 'pending'",
                         (error, proposal_id))
    if failed:
        raise HTTPException(409, error)  # raised after the session commits the 'failed' status


# --- the React app -------------------------------------------------------------------------------

if (DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    if path.startswith("api/"):
        raise HTTPException(404)
    f = DIST / path
    if path and f.is_file():
        return FileResponse(f)
    index = DIST / "index.html"
    if not index.exists():
        return HTMLResponse("<p>Frontend not built. Run <code>npm run build</code> in web/ui.</p>", 503)
    return FileResponse(index)
