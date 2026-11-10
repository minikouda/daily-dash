"""TODO records and their sync with Apple Reminders.

Lifecycle: tasks found in email start in the 'inbox' (awaiting triage).
Keeping one makes it 'open', which is when it gets an Apple Reminder.
Tasks you add yourself start 'open'.
"""

import hashlib
import json
import logging
import re

from . import reminders
from .db import now_iso

log = logging.getLogger(__name__)

ACTIVE = ("inbox", "open")
EDITABLE = ("title", "due", "notes", "priority", "kind")


def fingerprint(title: str, due: str | None) -> str:
    norm = re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()
    return hashlib.sha1(f"{norm}|{(due or '')[:10]}".encode()).hexdigest()


def get(conn, todo_id: int) -> dict | None:
    row = conn.execute("SELECT * FROM todos WHERE id = ?", (todo_id,)).fetchone()
    return dict(row) if row else None


def open_todos_for_prompt(conn) -> list[dict]:
    rows = conn.execute(
        "SELECT id, title, due, kind FROM todos WHERE status IN ('inbox', 'open')"
        " ORDER BY id DESC LIMIT 200"
    ).fetchall()
    return [dict(r) for r in rows]


def add(conn, title: str, due: str | None = None, notes: str = "", kind: str = "todo",
        priority: int = 2, origin: str = "email", source_msg_id: str | None = None,
        account: str | None = None, status: str | None = None) -> int | None:
    """Insert a task; None if an identical one (same title + day) already exists,
    including one the user dismissed, so dismissed tasks don't come back."""
    ts = now_iso()
    status = status or ("inbox" if origin == "email" else "open")
    snapshot = json.dumps({"title": title, "due": due, "notes": notes, "kind": kind, "priority": priority})
    cur = conn.execute(
        "INSERT INTO todos (fingerprint, title, notes, due, kind, priority, origin, source_msg_id,"
        " account, status, snapshot, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
        " ON CONFLICT(fingerprint) DO NOTHING",
        (fingerprint(title, due), title, notes, due, kind, priority, origin, source_msg_id, account,
         status, snapshot, ts, ts),
    )
    return cur.lastrowid if cur.rowcount else None


def update_from_email(conn, todo_id: int, item: dict) -> bool:
    row = conn.execute("SELECT * FROM todos WHERE id = ? AND status IN ('inbox', 'open')", (todo_id,)).fetchone()
    if row is None:
        return False
    due = item.get("due") or row["due"]
    changed_due = due != row["due"]
    conn.execute(
        "UPDATE todos SET due = ?, notes = ?, priority = MIN(priority, ?), updated_at = ?,"
        " reminder_id = CASE WHEN ? THEN NULL ELSE reminder_id END WHERE id = ?",
        (due, item.get("notes") or row["notes"], item.get("priority") or 2, now_iso(),
         changed_due, todo_id),
    )
    if changed_due and row["reminder_id"]:
        # Due date moved: drop the old reminder; sync recreates it with the new date.
        _safely(reminders.delete, row["reminder_id"])
    return True


def edit(conn, todo_id: int, changes: dict) -> dict | None:
    """Apply user edits; returns {before, after} of the changed fields."""
    row = get(conn, todo_id)
    if row is None:
        return None
    changes = {k: v for k, v in changes.items() if k in EDITABLE and v != row[k]}
    if not changes:
        return {"before": {}, "after": {}}
    sets = ", ".join(f"{k} = ?" for k in changes)
    conn.execute(f"UPDATE todos SET {sets}, updated_at = ? WHERE id = ?",
                 (*changes.values(), now_iso(), todo_id))
    if row["reminder_id"] and ({"title", "due"} & changes.keys()):
        # Recreate the reminder with the new title/date on the next sync.
        _safely(reminders.delete, row["reminder_id"])
        conn.execute("UPDATE todos SET reminder_id = NULL WHERE id = ?", (todo_id,))
    return {"before": {k: row[k] for k in changes}, "after": changes}


def set_status(conn, todo_id: int, status: str, cfg: dict | None = None) -> None:
    row = conn.execute("SELECT reminder_id, status FROM todos WHERE id = ?", (todo_id,)).fetchone()
    if row is None:
        return
    conn.execute("UPDATE todos SET status = ?, snoozed_until = NULL, updated_at = ? WHERE id = ?",
                 (status, now_iso(), todo_id))
    rid = row["reminder_id"]
    if not rid or not (cfg and cfg["reminders"]["enabled"]):
        return
    if status == "done":
        _safely(reminders.set_completed, rid, True)
    elif status in ("dismissed", "inbox"):
        _safely(reminders.delete, rid)
        conn.execute("UPDATE todos SET reminder_id = NULL WHERE id = ?", (todo_id,))
    elif status == "open" and row["status"] == "done":
        _safely(reminders.set_completed, rid, False)


def snooze(conn, todo_id: int, until_iso: str) -> None:
    # Snoozing an inbox item implies keeping it.
    conn.execute(
        "UPDATE todos SET snoozed_until = ?, status = CASE WHEN status = 'inbox' THEN 'open' ELSE status END,"
        " updated_at = ? WHERE id = ?",
        (until_iso, now_iso(), todo_id),
    )


def _safely(fn, *args):
    try:
        return fn(*args)
    except Exception as e:  # Reminders failures must never break the dashboard
        log.warning("reminders call %s failed: %s", fn.__name__, e)
        return None


def push_one(conn, todo_id: int, cfg: dict) -> None:
    """Create the Apple Reminder for one open task right away (used on keep/add)."""
    if not cfg["reminders"]["enabled"]:
        return
    row = get(conn, todo_id)
    if not row or row["status"] != "open" or row["reminder_id"]:
        return
    if not row["due"] and not cfg["reminders"]["push_undated"]:
        return
    rid = _safely(reminders.create, row, cfg)
    if rid:
        conn.execute("UPDATE todos SET reminder_id = ? WHERE id = ?", (rid, todo_id))


def sync_reminders(conn, cfg: dict) -> dict:
    """Pull completions/deletions from Reminders, then push open TODOs that lack one."""
    rc = cfg["reminders"]
    stats = {"pulled_done": 0, "pulled_deleted": 0, "pushed": 0}
    if not rc["enabled"]:
        return stats
    state = reminders.states(cfg)

    for row in conn.execute("SELECT id, reminder_id FROM todos WHERE status = 'open' AND reminder_id IS NOT NULL").fetchall():
        rid = row["reminder_id"]
        if rid not in state:
            # Deleted in Reminders: treat as dismissed there.
            conn.execute("UPDATE todos SET status = 'dismissed', reminder_id = NULL, updated_at = ? WHERE id = ?",
                         (now_iso(), row["id"]))
            stats["pulled_deleted"] += 1
        elif state[rid]:
            conn.execute("UPDATE todos SET status = 'done', updated_at = ? WHERE id = ?", (now_iso(), row["id"]))
            stats["pulled_done"] += 1

    query = "SELECT * FROM todos WHERE status = 'open' AND reminder_id IS NULL"
    if not rc["push_undated"]:
        query += " AND due IS NOT NULL"
    for row in conn.execute(query).fetchall():
        rid = reminders.create(dict(row), cfg)
        if rid:
            conn.execute("UPDATE todos SET reminder_id = ? WHERE id = ?", (rid, row["id"]))
            stats["pushed"] += 1
    return stats
