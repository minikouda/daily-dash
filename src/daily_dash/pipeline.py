"""One run: fetch new mail -> filter -> extract with Claude -> store -> sync Reminders.

  digest   the morning run; also writes the briefing shown at the top of Today
  refresh  the periodic run; only calls Claude when there is new mail
"""

import argparse
import fcntl
import io
import json
import logging
import sys
from datetime import datetime, timedelta, timezone

from . import config, db, gmail, learn, llm, packages, todos

log = logging.getLogger("daily_dash")


def setup_logging(buf: io.StringIO) -> None:
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%H:%M:%S")
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    for h in (logging.StreamHandler(sys.stderr), logging.StreamHandler(buf)):
        h.setFormatter(fmt)
        root.addHandler(h)
    logging.getLogger("googleapiclient").setLevel(logging.WARNING)


def keep(msg: dict, cfg: dict, muted: list[str] | tuple = ()) -> bool:
    """Cheap prefilter before anything reaches Claude. `muted` holds senders
    muted from the dashboard; config ignore_senders are substring matches."""
    sender = msg["sender_email"]
    if any(s.lower() in sender for s in cfg["ignore_senders"]) or sender in muted:
        return False
    if "CATEGORY_PROMOTIONS" in msg["labels"] or "SPAM" in msg["labels"]:
        return False
    return True


def fetch_all(conn, cfg: dict, since: timedelta | None, record: bool = True) -> list[dict]:
    """New, kept messages across accounts. With record=False nothing is written
    (dry run): every kept message in the window is returned."""
    new: list[dict] = []
    muted = learn.muted_senders(conn)
    for account in cfg["accounts"]:
        key = f"last_fetch:{account}"
        last = db.get_state(conn, key)
        if since is not None:
            after = datetime.now(timezone.utc) - since
        elif last:
            # Small overlap; message-id dedupe makes re-fetching harmless.
            after = datetime.fromisoformat(last) - timedelta(minutes=10)
        else:
            after = datetime.now(timezone.utc) - timedelta(days=cfg["initial_lookback_days"])
        started = db.now_iso()
        try:
            msgs = gmail.fetch_since(account, after, cfg["max_messages_per_run"])
        except Exception as e:
            log.error("fetch failed for %s: %s", account, e)
            continue
        fresh = 0
        if not record:
            kept = [m for m in msgs if keep(m, cfg, muted)]
            new += kept
            log.info("%s: %d fetched, %d kept (dry run)", account, len(msgs), len(kept))
            continue
        for m in msgs:
            skipped = 0 if keep(m, cfg, muted) else 1
            cur = conn.execute(
                "INSERT OR IGNORE INTO messages (id, account, thread_id, received_at, sender, subject,"
                " snippet, skipped) VALUES (?,?,?,?,?,?,?,?)",
                (m["id"], account, m["thread_id"], m["received_at"], m["from"], m["subject"],
                 m["snippet"], skipped),
            )
            if cur.rowcount and not skipped:
                new.append(m)
                fresh += 1
        db.set_state(conn, key, started)
        conn.commit()
        log.info("%s: %d fetched, %d new for extraction", account, len(msgs), fresh)
    return new


def apply_extraction(conn, result: dict, batch: list[dict]) -> dict:
    by_id = {m["id"]: m for m in batch}
    stats = {"todos_new": 0, "todos_updated": 0, "packages": 0, "highlights": 0}
    for t in result["todos"]:
        src = by_id.get(t["source_message_id"])
        if src is None:
            continue
        if t.get("existing_todo_id") and todos.update_from_email(conn, t["existing_todo_id"], t):
            stats["todos_updated"] += 1
        elif todos.add(conn, t["title"], t.get("due"), t.get("notes", ""), t["kind"], t["priority"],
                       "email", src["id"], src["account"]):
            stats["todos_new"] += 1
    for p in result["packages"]:
        src = by_id.get(p["source_message_id"])
        pkg = packages.normalize(p) if src else None
        if pkg is None:
            continue
        if conn.execute("SELECT 1 FROM packages WHERE key = ? AND dismissed = 1", (pkg["key"],)).fetchone():
            continue  # the user said this isn't a shipment
        packages.upsert(conn, pkg, src["received_at"], src["account"])
        stats["packages"] += 1
    for h in result["highlights"]:
        src = by_id.get(h["source_message_id"])
        if src is None:
            continue
        conn.execute(
            "INSERT OR IGNORE INTO highlights (source_msg_id, account, headline, why, created_at)"
            " VALUES (?,?,?,?,?)",
            (src["id"], src["account"], h["headline"], h.get("why", ""), src["received_at"]),
        )
        stats["highlights"] += 1
    conn.executemany("UPDATE messages SET processed = 1 WHERE id = ?", [(i,) for i in by_id])
    return stats


def archive_delivered(conn, cfg: dict) -> None:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=cfg["delivered_archive_days"])).isoformat()
    conn.execute(
        "UPDATE packages SET archived = 1 WHERE status = 'delivered' AND archived = 0"
        " AND COALESCE(delivered_at, last_update) < ?",
        (cutoff,),
    )


def dashboard_state(conn) -> dict:
    day_ago = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    return {
        # status 'inbox' = found in email but not yet reviewed by the user
        "open_todos": [dict(r) for r in conn.execute(
            "SELECT title, due, kind, priority, notes, status FROM todos WHERE status IN ('inbox', 'open')"
            " AND (snoozed_until IS NULL OR snoozed_until <= ?) ORDER BY due IS NULL, due LIMIT 60",
            (datetime.now(timezone.utc).isoformat(),))],
        "packages": [dict(r) for r in conn.execute(
            "SELECT merchant, description, carrier, status, eta FROM packages WHERE archived = 0 AND dismissed = 0")],
        "recent_highlights": [dict(r) for r in conn.execute(
            "SELECT headline, why FROM highlights WHERE created_at > ? AND dismissed = 0", (day_ago,))],
    }


def run(kind: str, since: timedelta | None = None, dry_run: bool = False, use_reminders: bool = True) -> int:
    cfg = config.load()
    buf = io.StringIO()
    setup_logging(buf)
    # One run at a time: overlapping runs double the Gmail quota use and
    # race on the same messages. Held until this process exits.
    lock = (config.HOME / "run.lock").open("w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        log.warning("another run is in progress; skipping this %s", kind)
        return 0
    conn = db.connect()
    run_id = conn.execute("INSERT INTO runs (kind, started_at) VALUES (?, ?)", (kind, db.now_iso())).lastrowid
    conn.commit()
    ok, fetched, extracted = False, 0, 0
    try:
        if not cfg["accounts"]:
            log.warning("no accounts configured in %s", config.CONFIG_PATH)
        new = fetch_all(conn, cfg, since, record=not dry_run)
        fetched = len(new)
        size = cfg["claude"]["batch_size"]
        for i in range(0, len(new), size):
            batch = new[i:i + size]
            log.info("extracting %d-%d of %d", i + 1, i + len(batch), len(new))
            result = llm.extract(batch, todos.open_todos_for_prompt(conn), cfg,
                                 learn.active_instructions(conn), learn.recent_corrections(conn))
            if dry_run:
                print(json.dumps(result, indent=2, ensure_ascii=False))
                continue
            stats = apply_extraction(conn, result, batch)
            conn.commit()
            extracted += len(batch)
            log.info("batch: %s", stats)
        if dry_run:
            ok = True
            return 0
        archive_delivered(conn, cfg)
        if use_reminders:
            try:
                log.info("reminders: %s", todos.sync_reminders(conn, cfg))
            except Exception as e:
                log.error("reminders sync failed: %s", e)
        conn.commit()
        if kind == "digest":
            body = llm.briefing(dashboard_state(conn), cfg)
            conn.execute("INSERT INTO briefings (created_at, body) VALUES (?, ?)", (db.now_iso(), body))
            conn.commit()
            log.info("briefing written")
            try:
                log.info("learner: %s", learn.review(conn, cfg))
            except Exception as e:
                log.error("learner failed: %s", e)
        ok = True
        return 0
    except Exception as e:
        log.exception("run failed: %s", e)
        return 1
    finally:
        conn.execute(
            "UPDATE runs SET finished_at = ?, ok = ?, fetched = ?, extracted = ?, log = ? WHERE id = ?",
            (db.now_iso(), int(ok), fetched, extracted, buf.getvalue()[-20000:], run_id),
        )
        conn.commit()
        conn.close()


def parse_since(text: str) -> timedelta:
    unit = text[-1]
    n = int(text[:-1])
    return {"d": timedelta(days=n), "h": timedelta(hours=n)}[unit]


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="daily-dash")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="fetch + extract + sync")
    r.add_argument("kind", choices=["digest", "refresh"], nargs="?", default="refresh")
    r.add_argument("--since", type=parse_since, help="re-scan window, e.g. 7d or 12h")
    r.add_argument("--dry-run", action="store_true", help="print extraction JSON, store nothing")
    r.add_argument("--no-reminders", action="store_true")
    a = sub.add_parser("auth", help="authorize a Gmail account (opens browser)")
    a.add_argument("email")
    w = sub.add_parser("web", help="serve the dashboard")
    w.add_argument("--reload", action="store_true")
    sub.add_parser("init", help="create ~/.daily-dash and a starter config.toml")
    sub.add_parser("learn", help="have Claude review new feedback and propose rules")
    args = p.parse_args(argv)

    if args.cmd == "learn":
        logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
        with db.session() as conn:
            print(json.dumps(learn.review(conn, config.load()), indent=2, ensure_ascii=False))
        return 0

    if args.cmd == "run":
        return run(args.kind, args.since, args.dry_run, not args.no_reminders)
    if args.cmd == "auth":
        actual = gmail.authorize(args.email)
        print(f"authorized {actual}")
        if actual.lower() != args.email.lower():
            print(f"note: you signed in as {actual}, not {args.email}; use that address in config.toml")
        return 0
    if args.cmd == "web":
        import uvicorn
        cfg = config.load()
        uvicorn.run("daily_dash.web.app:app", host=cfg["web"]["host"], port=cfg["web"]["port"], reload=args.reload)
        return 0
    if args.cmd == "init":
        config.ensure_home()
        print(f"config: {config.CONFIG_PATH}\nput your OAuth client JSON at: {config.CREDENTIALS_PATH}")
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
