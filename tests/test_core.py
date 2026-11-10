from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from daily_dash import packages, pipeline, reminders, todos


def msg(i, received="2026-10-30T15:00:00+00:00", account="me@gmail.com"):
    return {"id": f"m{i}", "thread_id": f"t{i}", "account": account, "received_at": received,
            "from": "x@y.com", "sender_email": "x@y.com", "subject": "s", "snippet": "",
            "labels": [], "body": ""}


def pkg(**kw):
    base = {"tracking_number": None, "carrier": None, "order_number": None, "merchant": "Amazon",
            "description": "Thing", "status": "shipped", "eta": None, "tracking_url": None,
            "source_message_id": "m1"}
    return base | kw


# --- packages -------------------------------------------------------------------

def test_valid_ups_number_gets_library_carrier_and_url():
    p = packages.normalize(pkg(tracking_number="1Z 999 AA1 0123456784", carrier=None))
    assert p["tracking_number"] == "1Z999AA10123456784"
    assert p["carrier"] == "ups"
    assert "1Z999AA10123456784" in p["tracking_url"]


def test_unrecognized_number_keeps_llm_carrier_and_fallback_url():
    p = packages.normalize(pkg(tracking_number="92612999897543581074711582", carrier="usps"))
    assert p["carrier"] == "usps"
    assert p["tracking_url"].startswith("https://tools.usps.com/")


def test_carrier_page_preferred_over_email_redirect():
    p = packages.normalize(pkg(tracking_number="9405536208192279106120", carrier="usps",
                               tracking_url="http://mclicks.brilliantmade.com/track/click/31127050/tools.usps.com"))
    assert p["tracking_url"] == "https://tools.usps.com/go/TrackConfirmAction?tLabels=9405536208192279106120"


def test_email_link_kept_when_carrier_has_no_public_page():
    p = packages.normalize(pkg(tracking_number="TBA123456789000", tracking_url="https://www.amazon.com/progress-tracker/x"))
    assert p["carrier"] == "amazon" and p["tracking_url"] == "https://www.amazon.com/progress-tracker/x"


def test_order_only_package_keyed_by_merchant_and_order():
    p = packages.normalize(pkg(order_number="113-555", merchant="Amazon.com"))
    assert p["key"] == "order:amazoncom:113-555"


def test_nothing_to_key_on_is_dropped():
    assert packages.normalize(pkg()) is None


def test_status_progression_and_out_of_order_email(conn):
    p = packages.normalize(pkg(tracking_number="1Z999AA10123456784", status="shipped", eta="2026-11-03"))
    packages.upsert(conn, p, "2026-10-30T10:00:00+00:00", "a")
    packages.upsert(conn, p | {"status": "out_for_delivery"}, "2026-11-03T08:00:00+00:00", "a")
    # An older "shipped" email processed late must not move it backwards.
    packages.upsert(conn, p | {"status": "shipped"}, "2026-10-31T10:00:00+00:00", "a")
    row = conn.execute("SELECT * FROM packages").fetchone()
    assert row["status"] == "out_for_delivery"
    packages.upsert(conn, p | {"status": "delivered"}, "2026-11-03T20:00:00+00:00", "a")
    row = conn.execute("SELECT * FROM packages").fetchone()
    assert row["status"] == "delivered" and row["delivered_at"] == "2026-11-03T20:00:00+00:00"
    assert row["eta"] == "2026-11-03"


def test_order_record_folds_into_tracking_record(conn):
    first = packages.normalize(pkg(order_number="113-555", status="ordered"))
    packages.upsert(conn, first, "2026-10-29T10:00:00+00:00", "a")
    second = packages.normalize(pkg(order_number="113-555", tracking_number="TBA123456789000", status="shipped"))
    packages.upsert(conn, second, "2026-10-30T10:00:00+00:00", "a")
    rows = conn.execute("SELECT * FROM packages").fetchall()
    assert len(rows) == 1
    assert rows[0]["key"] == "TBA123456789000" and rows[0]["status"] == "shipped"
    assert rows[0]["carrier"] == "amazon"


# --- todos / extraction ---------------------------------------------------------------

def extraction(**kw):
    return {"summary": "", "todos": [], "packages": [], "highlights": []} | kw


def todo(title, due=None, src="m1", existing=None, kind="deadline", priority=2, notes=""):
    return {"title": title, "notes": notes, "due": due, "kind": kind, "priority": priority,
            "existing_todo_id": existing, "source_message_id": src}


def test_apply_extraction_creates_and_dedupes(conn):
    batch = [msg(1), msg(2)]
    result = extraction(
        todos=[todo("Submit HW 8", "2026-11-04", "m1"), todo("Submit HW 8!", "2026-11-04", "m2"),
               todo("Ghost", None, "not-in-batch")],
        packages=[pkg(tracking_number="1Z999AA10123456784", source_message_id="m2")],
        highlights=[{"headline": "Prof replied", "why": "", "source_message_id": "m1"}],
    )
    stats = pipeline.apply_extraction(conn, result, batch)
    assert stats["todos_new"] == 1  # punctuation-only difference is the same task; unknown source ignored
    assert conn.execute("SELECT COUNT(*) FROM packages").fetchone()[0] == 1
    assert conn.execute("SELECT COUNT(*) FROM highlights").fetchone()[0] == 1


def test_existing_todo_updated_instead_of_duplicated(conn):
    tid = todos.add(conn, "Pay PG&E bill", "2026-11-05", kind="payment")
    result = extraction(todos=[todo("Pay PG&E bill $84", "2026-11-07", existing=tid, priority=1)])
    stats = pipeline.apply_extraction(conn, result, [msg(1)])
    assert stats == {"todos_new": 0, "todos_updated": 1, "packages": 0, "highlights": 0}
    row = conn.execute("SELECT * FROM todos WHERE id = ?", (tid,)).fetchone()
    assert row["due"] == "2026-11-07" and row["priority"] == 1


def test_done_todo_not_reopened_by_new_email(conn, cfg):
    tid = todos.add(conn, "Submit form", "2026-11-05")
    todos.set_status(conn, tid, "done", cfg)
    result = extraction(todos=[todo("Submit form", "2026-11-05", existing=tid)])
    pipeline.apply_extraction(conn, result, [msg(1)])
    assert conn.execute("SELECT status FROM todos WHERE id = ?", (tid,)).fetchone()[0] == "done"
    assert conn.execute("SELECT COUNT(*) FROM todos").fetchone()[0] == 1


def test_prefilter():
    cfg = {"ignore_senders": ["noreply@spam.com"]}
    assert pipeline.keep(msg(1), cfg)
    assert not pipeline.keep(msg(1) | {"sender_email": "noreply@spam.com"}, cfg)
    assert not pipeline.keep(msg(1) | {"labels": ["CATEGORY_PROMOTIONS"]}, cfg)


# --- reminders timing ---------------------------------------------------------------

def test_alert_times(cfg):
    tz = ZoneInfo(cfg["timezone"])
    future = (datetime.now(tz) + timedelta(days=5)).replace(hour=17, minute=0, second=0, microsecond=0)
    due, remind = reminders.alert_times({"due": future.isoformat(), "kind": "deadline"}, cfg)
    assert datetime.fromisoformat(remind) == future - timedelta(hours=24)
    day = (datetime.now(tz) + timedelta(days=3)).date().isoformat()
    due, remind = reminders.alert_times({"due": day, "kind": "todo"}, cfg)
    assert due == remind and datetime.fromisoformat(due).hour == 9
    past = (datetime.now(tz) - timedelta(days=1)).date().isoformat()
    assert reminders.alert_times({"due": past, "kind": "todo"}, cfg)[1] is None
    assert reminders.alert_times({"due": None, "kind": "todo"}, cfg) == (None, None)
