"""Feedback -> rules.

Every decision in the UI is logged as a feedback event. Two things use them:

1. Episodic examples: the most recent corrections (dismissals with a reason,
   edited dates/titles, "not a package", ...) are shown to the extraction
   prompt verbatim, so the next run sees concrete mistakes to avoid.
2. Rules: the learner step asks Claude to distill un-reviewed feedback into
   short, general rules ("Skip LinkedIn 'saved job expiring' notices").
   Claude only *proposes*; a rule reaches extraction once the user accepts it.
   That keeps a bad generalization, or text planted in an email, from
   silently changing behavior.

Muting a sender is the one direct rule: the user asked for it explicitly, so
it is active immediately and enforced before Claude sees any mail.
"""

import json
import logging

from . import llm
from .db import now_iso

log = logging.getLogger(__name__)

CORRECTIVE = {
    ("todo", "dismiss"), ("todo", "edit"), ("todo", "add"),
    ("package", "not_package"), ("highlight", "not_important"), ("highlight", "useful"),
    ("briefing", "vote"),
}
MAX_RULE_CHARS = 240


# --- recording --------------------------------------------------------------------

def record(conn, item_type: str, item_id, action: str, *, reason: str | None = None,
           note: str | None = None, before: dict | None = None, after: dict | None = None,
           source_msg_id: str | None = None) -> int:
    sender = subject = None
    if source_msg_id:
        m = conn.execute("SELECT sender, subject FROM messages WHERE id = ?", (source_msg_id,)).fetchone()
        if m:
            sender, subject = m["sender"], m["subject"]
    cur = conn.execute(
        "INSERT INTO feedback (created_at, item_type, item_id, action, reason, note, before_json,"
        " after_json, sender, subject) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (now_iso(), item_type, str(item_id), action, reason, (note or "").strip() or None,
         json.dumps(before, ensure_ascii=False) if before else None,
         json.dumps(after, ensure_ascii=False) if after else None, sender, subject),
    )
    return cur.lastrowid


def undo(conn, feedback_id: int) -> None:
    conn.execute("DELETE FROM feedback WHERE id = ? AND reviewed_at IS NULL", (feedback_id,))


# --- rules ---------------------------------------------------------------------------

def mute_sender(conn, sender_email: str, feedback_id: int | None = None) -> int:
    sender_email = sender_email.lower().strip()
    row = conn.execute(
        "SELECT id FROM rules WHERE kind = 'ignore_sender' AND text = ? AND status = 'active'", (sender_email,)
    ).fetchone()
    if row:
        return row["id"]
    cur = conn.execute(
        "INSERT INTO rules (kind, scope, text, rationale, evidence, status, origin, created_at, decided_at)"
        " VALUES ('ignore_sender', 'general', ?, 'You muted this sender.', ?, 'active', 'user', ?, ?)",
        (sender_email, json.dumps([feedback_id] if feedback_id else []), now_iso(), now_iso()),
    )
    return cur.lastrowid


def muted_senders(conn) -> list[str]:
    return [r["text"] for r in conn.execute(
        "SELECT text FROM rules WHERE kind = 'ignore_sender' AND status = 'active'")]


def active_instructions(conn) -> list[dict]:
    return [dict(r) for r in conn.execute(
        "SELECT id, scope, text FROM rules WHERE kind = 'instruction' AND status = 'active' ORDER BY id")]


def add_user_rule(conn, text: str, scope: str = "general") -> int:
    cur = conn.execute(
        "INSERT INTO rules (kind, scope, text, status, origin, created_at, decided_at)"
        " VALUES ('instruction', ?, ?, 'active', 'user', ?, ?)",
        (scope, text.strip()[:MAX_RULE_CHARS], now_iso(), now_iso()),
    )
    return cur.lastrowid


def decide(conn, rule_id: int, status: str, text: str | None = None) -> None:
    if text is not None:
        conn.execute("UPDATE rules SET text = ? WHERE id = ?", (text.strip()[:MAX_RULE_CHARS], rule_id))
    conn.execute("UPDATE rules SET status = ?, decided_at = ? WHERE id = ?", (status, now_iso(), rule_id))


# --- prompt context ------------------------------------------------------------------

def _describe(ev: dict) -> str | None:
    """One line describing a corrective feedback event, for the extraction prompt."""
    before = json.loads(ev["before_json"]) if ev["before_json"] else {}
    after = json.loads(ev["after_json"]) if ev["after_json"] else {}
    src = f'email "{ev["subject"]}" from {ev["sender"]}' if ev["subject"] else "an email"
    note = f' User note: "{ev["note"]}"' if ev["note"] else ""
    kind, action, reason = ev["item_type"], ev["action"], ev["reason"]
    if kind == "todo" and action == "dismiss":
        why = {"not_task": "not a real task", "already_done": "already handled",
               "duplicate": "a duplicate of another task", "mute_sender": "from a sender the user ignores",
               "low_value": "not worth tracking"}.get(reason)
        how = f"dismissed it as {why}" if why else "dismissed it without giving a reason"
        return f'From {src} you extracted the task "{before.get("title")}"; the user {how}.{note}'
    if kind == "todo" and action == "edit":
        parts = [f"{k}: {before.get(k)!r} -> {after.get(k)!r}" for k in after]
        return f'From {src}, the user corrected the task "{before.get("title")}": ' + "; ".join(parts) + "." + note
    if kind == "todo" and action == "add":
        return f'The user added a task by hand that you missed: "{after.get("title")}".{note}'
    if kind == "package" and action == "edit":
        parts = [f"{k}: {before.get(k)!r} -> {after.get(k)!r}" for k in after]
        return f'From {src}, the user corrected the package "{before.get("description")}": ' + "; ".join(parts) + "." + note
    if kind == "package" and action == "not_package":
        return f'From {src} you extracted a package "{before.get("description")}" ({before.get("tracking_number")}); the user says it is not a shipment.{note}'
    if kind == "highlight" and action == "not_important":
        return f'You highlighted "{before.get("headline")}" from {src}; the user says it was not worth highlighting.{note}'
    if kind == "highlight" and action == "useful":
        return f'You highlighted "{before.get("headline")}" from {src}; the user found it useful.{note}'
    return None


def recent_corrections(conn, limit: int = 15) -> list[str]:
    rows = conn.execute(
        "SELECT * FROM feedback WHERE item_type IN ('todo', 'package', 'highlight')"
        " AND action IN ('dismiss', 'edit', 'add', 'not_package', 'not_important', 'useful')"
        " ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [d for d in (_describe(dict(r)) for r in rows) if d]


# --- learner -----------------------------------------------------------------------

def pending_feedback(conn) -> list[dict]:
    return [dict(r) for r in conn.execute(
        "SELECT * FROM feedback WHERE reviewed_at IS NULL ORDER BY id")]


def review(conn, cfg: dict) -> dict:
    """Ask Claude to turn un-reviewed feedback into proposed rules."""
    events = pending_feedback(conn)
    if not events:
        return {"reviewed": 0, "proposed": 0, "summary": "No new feedback."}
    rules = [dict(r) for r in conn.execute(
        "SELECT id, kind, scope, text, status FROM rules WHERE status IN ('active', 'proposed', 'rejected')")]
    payload = []
    for ev in events:
        payload.append({
            "feedback_id": ev["id"], "item_type": ev["item_type"], "action": ev["action"],
            "reason": ev["reason"], "user_note": ev["note"],
            "item_before": json.loads(ev["before_json"]) if ev["before_json"] else None,
            "item_after": json.loads(ev["after_json"]) if ev["after_json"] else None,
            "email_sender": ev["sender"], "email_subject": ev["subject"],
        })
    stats = conn.execute(
        "SELECT action, COUNT(*) n FROM feedback GROUP BY action").fetchall()
    result = llm.learn(payload, rules, {r["action"]: r["n"] for r in stats}, cfg)

    proposed = 0
    known = {r["text"].strip().lower() for r in rules}
    valid_ids = {ev["id"] for ev in events}
    for p in result["proposals"]:
        text = p["text"].strip()[:MAX_RULE_CHARS]
        if not text or text.lower() in known:
            continue
        evidence = [i for i in p["evidence"] if i in valid_ids]
        conn.execute(
            "INSERT INTO rules (kind, scope, text, rationale, evidence, status, origin, created_at)"
            " VALUES ('instruction', ?, ?, ?, ?, 'proposed', 'learned', ?)",
            (p["scope"], text, p["rationale"][:400], json.dumps(evidence), now_iso()),
        )
        proposed += 1
    active_ids = {r["id"] for r in rules if r["status"] == "active" and r["kind"] == "instruction"}
    for r in result["retire"]:
        if r["rule_id"] in active_ids:
            # Retiring is also only a suggestion: flag it as a proposal to drop.
            conn.execute(
                "INSERT INTO rules (kind, scope, text, rationale, evidence, status, origin, created_at)"
                " SELECT 'retire', scope, text, ?, ?, 'proposed', 'learned', ? FROM rules WHERE id = ?",
                (r["reason"][:400], json.dumps([r["rule_id"]]), now_iso(), r["rule_id"]),
            )
            proposed += 1
    conn.executemany("UPDATE feedback SET reviewed_at = ? WHERE id = ?", [(now_iso(), ev["id"]) for ev in events])
    conn.execute(
        "INSERT INTO state (key, value) VALUES ('last_learn', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (json.dumps({"at": now_iso(), "reviewed": len(events), "proposed": proposed, "summary": result["summary"]}),),
    )
    log.info("learner reviewed %d events, proposed %d", len(events), proposed)
    return {"reviewed": len(events), "proposed": proposed, "summary": result["summary"]}


def accept_retire(conn, proposal_id: int) -> None:
    """Accepting a 'retire' proposal retires the rule it points at."""
    row = conn.execute("SELECT evidence FROM rules WHERE id = ? AND kind = 'retire'", (proposal_id,)).fetchone()
    if row:
        for rid in json.loads(row["evidence"] or "[]"):
            conn.execute("UPDATE rules SET status = 'retired', decided_at = ? WHERE id = ?", (now_iso(), rid))
    conn.execute("UPDATE rules SET status = 'accepted', decided_at = ? WHERE id = ?", (now_iso(), proposal_id))
