import json
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from daily_dash import db, learn, packages, todos
from daily_dash.web import app as webapp


@pytest.fixture
def client(conn, monkeypatch):
    base = webapp.config.load()
    monkeypatch.setattr(webapp, "cfg", lambda: {**base, "reminders": {**base["reminders"], "enabled": False}})
    return TestClient(webapp.app, headers={"X-Daily-Dash": "1"})


def seed(conn):
    today = date.today()
    conn.execute("INSERT INTO messages (id, account, thread_id, received_at, sender, subject) VALUES"
                 " ('m1', 'me@gmail.com', 't1', ?, 'LinkedIn <jobs-noreply@linkedin.com>', 'Your saved job expires')",
                 (db.now_iso(),))
    a = todos.add(conn, "Apply to job", (today + timedelta(days=1)).isoformat(), source_msg_id="m1",
                  account="me@gmail.com")
    b = todos.add(conn, "Pay bill", (today + timedelta(days=3)).isoformat(), kind="payment",
                  source_msg_id="m1", account="me@gmail.com")
    c = todos.add(conn, "Buy milk", None, origin="manual")
    p = packages.normalize({"tracking_number": "1Z999AA10123456784", "carrier": None, "order_number": None,
                            "merchant": "Apple", "description": "Cable", "status": "out_for_delivery",
                            "eta": today.isoformat(), "tracking_url": None, "source_message_id": "m1"})
    packages.upsert(conn, p, db.now_iso(), "me@gmail.com")
    conn.execute("INSERT INTO highlights (source_msg_id, account, headline, why, created_at)"
                 " VALUES ('m1', 'me@gmail.com', 'Saved job expiring', '', ?)", (db.now_iso(),))
    conn.commit()
    return a, b, c


def status(conn, tid):
    return conn.execute("SELECT status FROM todos WHERE id = ?", (tid,)).fetchone()[0]


def test_bootstrap_shape(conn, client):
    a, b, c = seed(conn)
    data = client.get("/api/bootstrap").json()
    by_id = {t["id"]: t for t in data["tasks"]}
    assert by_id[a]["status"] == "inbox" and by_id[c]["status"] == "open"
    assert by_id[a]["source"]["subject"] == "Your saved job expires"
    assert by_id[a]["source"]["link"].startswith("https://mail.google.com/")
    assert data["packages"][0]["carrier"] == "ups"
    assert data["highlights"][0]["headline"] == "Saved job expiring"
    assert data["learn"]["pending"] == 0


def test_triage_records_feedback_and_undo(conn, client):
    a, b, _ = seed(conn)
    r = client.post(f"/api/todos/{a}/triage", json={"action": "dismiss", "reason": "not_task", "note": "job ads"})
    assert r.status_code == 200 and r.json()["task"]["status"] == "dismissed"
    fb = conn.execute("SELECT * FROM feedback").fetchone()
    assert (fb["action"], fb["reason"], fb["note"]) == ("dismiss", "not_task", "job ads")
    assert fb["subject"] == "Your saved job expires"
    assert "Apply to job" in learn.recent_corrections(conn)[0]

    client.post(f"/api/undo/{fb['id']}")
    assert status(conn, a) == "inbox"
    assert conn.execute("SELECT COUNT(*) FROM feedback").fetchone()[0] == 0

    client.post(f"/api/todos/{b}/triage", json={"action": "keep"})
    assert status(conn, b) == "open"
    until = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    client.post(f"/api/todos/{a}/triage", json={"action": "snooze", "until": until})
    assert status(conn, a) == "open"  # snoozing an inbox item keeps it


def test_edit_is_a_correction(conn, client):
    a, *_ = seed(conn)
    r = client.patch(f"/api/todos/{a}", json={"due": "2030-01-02", "note": "real deadline is later"})
    assert r.json()["task"]["due"] == "2030-01-02" and r.json()["task"]["status"] == "open"
    fb = conn.execute("SELECT * FROM feedback WHERE action = 'edit'").fetchone()
    assert json.loads(fb["after_json"]) == {"due": "2030-01-02"}
    assert "2030-01-02" in learn.recent_corrections(conn)[0]


def test_mute_sender_blocks_future_mail(conn, client):
    a, b, _ = seed(conn)
    client.post(f"/api/todos/{a}/triage", json={"action": "dismiss", "reason": "mute_sender"})
    assert learn.muted_senders(conn) == ["jobs-noreply@linkedin.com"]
    assert status(conn, b) == "dismissed"  # same sender's other inbox items cleared
    from daily_dash.pipeline import keep
    msg = {"sender_email": "jobs-noreply@linkedin.com", "labels": []}
    assert not keep(msg, {"ignore_senders": []}, learn.muted_senders(conn))


def test_add_missed_task_and_keep_all(conn, client):
    seed(conn)
    r = client.post("/api/todos", json={"title": "Reply to advisor", "missed": True})
    assert r.status_code == 200 and r.json()["task"]["status"] == "open"
    assert client.post("/api/todos", json={"title": "Reply to advisor"}).status_code == 409
    assert conn.execute("SELECT action FROM feedback").fetchone()[0] == "add"
    assert client.post("/api/inbox/keep-all").json()["kept"] == 2


def test_package_and_highlight_feedback(conn, client):
    seed(conn)
    r = client.post("/api/packages/1Z999AA10123456784/action", json={"action": "not_package"})
    assert r.status_code == 200
    assert client.get("/api/bootstrap").json()["packages"] == []
    client.post("/api/highlights/m1/action", json={"action": "not_important"})
    assert client.get("/api/bootstrap").json()["highlights"] == []
    actions = [r[0] for r in conn.execute("SELECT action FROM feedback ORDER BY id")]
    assert actions == ["not_package", "not_important"]


def test_rules_lifecycle(conn, client, monkeypatch):
    a, *_ = seed(conn)
    client.post(f"/api/todos/{a}/triage", json={"action": "dismiss", "reason": "not_task"})
    captured = {}

    def fake_learn(events, rules, stats, cfg):
        captured["events"] = events
        return {"summary": "LinkedIn expiry notices aren't tasks.",
                "proposals": [{"text": "Skip LinkedIn saved-job expiry notices.", "scope": "todos",
                               "rationale": "dismissed", "evidence": [events[0]["feedback_id"], 999]}],
                "retire": []}

    monkeypatch.setattr(learn.llm, "learn", fake_learn)
    out = learn.review(conn, webapp.cfg())
    conn.commit()
    assert out == {"reviewed": 1, "proposed": 1, "summary": "LinkedIn expiry notices aren't tasks."}
    assert captured["events"][0]["email_subject"] == "Your saved job expires"
    rule = conn.execute("SELECT * FROM rules").fetchone()
    assert rule["status"] == "proposed" and json.loads(rule["evidence"]) == [captured["events"][0]["feedback_id"]]
    assert learn.active_instructions(conn) == []  # proposals don't reach extraction

    client.post(f"/api/rules/{rule['id']}", json={"action": "accept", "text": "Skip LinkedIn saved-job expiry emails."})
    assert learn.active_instructions(conn)[0]["text"] == "Skip LinkedIn saved-job expiry emails."
    assert learn.review(conn, webapp.cfg())["reviewed"] == 0  # feedback marked reviewed

    client.post("/api/rules", json={"text": "Ignore Ed discussion digests.", "scope": "highlights"})
    assert len(learn.active_instructions(conn)) == 2
    client.post(f"/api/rules/{rule['id']}", json={"action": "retire"})
    assert len(learn.active_instructions(conn)) == 1


def test_briefing_vote(conn, client):
    conn.execute("INSERT INTO briefings (created_at, body) VALUES (?, '- hi')", (db.now_iso(),))
    conn.commit()
    client.post("/api/briefings/1/vote", json={"vote": "down", "note": "too long"})
    assert conn.execute("SELECT vote FROM briefings").fetchone()[0] == "down"


def test_spa_fallback(client):
    r = client.get("/tasks")
    assert r.status_code in (200, 503)
    assert client.get("/api/nope").status_code == 404


def test_writes_need_the_header(conn):
    bare = TestClient(webapp.app)
    assert bare.post("/api/run/refresh").status_code == 403
    assert bare.post("/api/restart").status_code == 403
    assert bare.get("/api/summary").status_code == 200  # reads stay open


def test_summary_and_quick_dismiss_reason(conn, client):
    a, b, _ = seed(conn)
    s = client.get("/api/summary").json()
    assert s["inbox"] == 2 and s["arriving_today"] == 1
    fid = client.post(f"/api/todos/{a}/triage", json={"action": "dismiss"}).json()["feedback_id"]
    assert "without giving a reason" in learn.recent_corrections(conn)[0]
    client.post(f"/api/feedback/{fid}/reason", json={"reason": "not_task", "note": "job ads"})
    assert "not a real task" in learn.recent_corrections(conn)[0]
