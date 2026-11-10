"""Apple Reminders sync through JavaScript for Automation (osascript -l JavaScript).

The first call triggers macOS's "allow to control Reminders" prompt for
whatever app runs it (Terminal/Ghostty interactively, or the launchd job).
"""

import json
import subprocess
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

# Each script receives one JSON argument and prints one JSON value.
_PRELUDE = r"""
function getList(R, name) {
  const found = R.lists.whose({name: name});
  if (found.length > 0) return found[0];
  const l = R.List({name: name});
  R.lists.push(l);
  return R.lists.whose({name: name})[0];
}
"""

_CREATE = _PRELUDE + r"""
function run(argv) {
  const a = JSON.parse(argv[0]);
  const R = Application('Reminders');
  const list = getList(R, a.list);
  const props = {name: a.title, body: a.notes || ''};
  if (a.due) props.dueDate = new Date(a.due);
  if (a.remind) props.remindMeDate = new Date(a.remind);
  if (a.priority) props.priority = a.priority;
  const r = R.Reminder(props);
  list.reminders.push(r);
  return JSON.stringify(list.reminders.whose({name: a.title})().map(x => x.id()).pop());
}
"""

_SET_COMPLETED = r"""
function run(argv) {
  const a = JSON.parse(argv[0]);
  const R = Application('Reminders');
  try { R.reminders.byId(a.id).completed = a.completed; return 'true'; }
  catch (e) { return 'false'; }
}
"""

_DELETE = r"""
function run(argv) {
  const a = JSON.parse(argv[0]);
  const R = Application('Reminders');
  try { R.delete(R.reminders.byId(a.id)); return 'true'; } catch (e) { return 'false'; }
}
"""

# {id: completed} for every reminder in the list.
_STATES = _PRELUDE + r"""
function run(argv) {
  const a = JSON.parse(argv[0]);
  const R = Application('Reminders');
  const list = getList(R, a.list);
  const ids = list.reminders.id();
  const done = list.reminders.completed();
  const out = {};
  ids.forEach((id, i) => out[id] = done[i]);
  return JSON.stringify(out);
}
"""


class RemindersError(RuntimeError):
    pass


def _run(script: str, arg: dict, timeout: int = 60):
    proc = subprocess.run(
        ["osascript", "-l", "JavaScript", "-e", script, json.dumps(arg)],
        capture_output=True, text=True, timeout=timeout,
    )
    if proc.returncode != 0:
        raise RemindersError(proc.stderr.strip()[-500:])
    return json.loads(proc.stdout.strip() or "null")


# Reminders priority: 1 high, 5 medium, 9 low, 0 none.
_PRIORITY = {1: 1, 2: 0, 3: 9}


def alert_times(todo: dict, cfg: dict) -> tuple[str | None, str | None]:
    """(due, remind-me) as ISO datetimes for a todo, per the reminders config."""
    if not todo.get("due"):
        return None, None
    rc = cfg["reminders"]
    tz = ZoneInfo(cfg["timezone"])
    raw = todo["due"]
    if len(raw) == 10:  # date only
        due = datetime.combine(date.fromisoformat(raw), datetime.min.time(), tz).replace(hour=rc["default_hour"])
        remind = due
    else:
        due = datetime.fromisoformat(raw)
        if due.tzinfo is None:
            due = due.replace(tzinfo=tz)
        lead = timedelta(hours=rc["deadline_lead_hours"]) if todo["kind"] in ("deadline", "payment") else timedelta(0)
        remind = due - lead
    now = datetime.now(tz)
    if remind < now:
        # Lead time already passed: alert shortly, unless it's already overdue.
        remind = now + timedelta(minutes=5) if due > now else None
    return due.isoformat(), remind.isoformat() if remind else None


def create(todo: dict, cfg: dict) -> str:
    due, remind = alert_times(todo, cfg)
    return _run(_CREATE, {
        "list": cfg["reminders"]["list_name"],
        "title": todo["title"],
        "notes": todo.get("notes") or "",
        "due": due,
        "remind": remind,
        "priority": _PRIORITY.get(todo.get("priority") or 2, 0),
    })


def set_completed(reminder_id: str, completed: bool = True) -> bool:
    return bool(_run(_SET_COMPLETED, {"id": reminder_id, "completed": completed}))


def delete(reminder_id: str) -> bool:
    return bool(_run(_DELETE, {"id": reminder_id}))


def states(cfg: dict) -> dict[str, bool]:
    return _run(_STATES, {"list": cfg["reminders"]["list_name"]}, timeout=120)
