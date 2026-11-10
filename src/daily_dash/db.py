"""SQLite storage. One connection per call site; WAL so the web app and the
pipeline can run at the same time."""

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS messages (
    id          TEXT PRIMARY KEY,          -- Gmail message id
    account     TEXT NOT NULL,
    thread_id   TEXT,
    received_at TEXT NOT NULL,             -- ISO 8601 UTC
    sender      TEXT,
    subject     TEXT,
    snippet     TEXT,
    skipped     INTEGER NOT NULL DEFAULT 0, -- filtered out before extraction
    processed   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS todos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint   TEXT UNIQUE,
    title         TEXT NOT NULL,
    notes         TEXT,
    due           TEXT,                     -- 'YYYY-MM-DD' or ISO datetime with offset
    kind          TEXT NOT NULL DEFAULT 'todo',
    priority      INTEGER NOT NULL DEFAULT 2, -- 1 high .. 3 low
    origin        TEXT NOT NULL DEFAULT 'email',
    source_msg_id TEXT,
    account       TEXT,
    status        TEXT NOT NULL DEFAULT 'open', -- inbox (awaiting triage) | open | done | dismissed
    snoozed_until TEXT,
    reminder_id   TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS packages (
    key           TEXT PRIMARY KEY,         -- tracking number, or order:<merchant>:<order no>
    tracking_number TEXT,
    order_number  TEXT,
    carrier       TEXT,
    merchant      TEXT,
    description   TEXT,
    status        TEXT NOT NULL,            -- ordered|shipped|in_transit|out_for_delivery|delivered|exception
    eta           TEXT,
    tracking_url  TEXT,
    last_update   TEXT NOT NULL,            -- received_at of the email that set the status
    source_msg_id TEXT,
    account       TEXT,
    delivered_at  TEXT,
    archived      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS highlights (
    source_msg_id TEXT PRIMARY KEY,
    account       TEXT,
    headline      TEXT NOT NULL,
    why           TEXT,
    created_at    TEXT NOT NULL,
    dismissed     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS briefings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    body       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    ok          INTEGER,
    fetched     INTEGER DEFAULT 0,
    extracted   INTEGER DEFAULT 0,
    log         TEXT
);

CREATE TABLE IF NOT EXISTS state (
    key   TEXT PRIMARY KEY,
    value TEXT
);

-- Every user decision on an extracted item. The learner reads these to
-- propose rules; recent corrections are also shown to extraction as examples.
CREATE TABLE IF NOT EXISTS feedback (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT NOT NULL,
    item_type   TEXT NOT NULL,              -- todo | package | highlight | briefing
    item_id     TEXT NOT NULL,
    action      TEXT NOT NULL,              -- keep | done | dismiss | edit | snooze | add | not_package | useful | not_important | vote
    reason      TEXT,                       -- not_task | already_done | duplicate | wrong_info | mute_sender | low_value | up | down | other
    note        TEXT,                       -- free text the user typed, for Claude
    before_json TEXT,                       -- the item as extracted / before the change
    after_json  TEXT,
    sender      TEXT,
    subject     TEXT,
    reviewed_at TEXT                        -- set once the learner has read it
);

-- Learned or hand-written guidance for extraction. Only 'active' rules reach
-- the extraction prompt; Claude's suggestions start as 'proposed'.
CREATE TABLE IF NOT EXISTS rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL DEFAULT 'instruction', -- instruction | ignore_sender
    scope       TEXT NOT NULL DEFAULT 'general',     -- todos | packages | highlights | general
    text        TEXT NOT NULL,
    rationale   TEXT,
    evidence    TEXT,                       -- JSON list of feedback ids
    status      TEXT NOT NULL DEFAULT 'proposed',    -- proposed | active | rejected | retired
    origin      TEXT NOT NULL DEFAULT 'learned',     -- learned | user
    created_at  TEXT NOT NULL,
    decided_at  TEXT
);

-- Dashboard chat. Each session is one persistent `claude` conversation.
CREATE TABLE IF NOT EXISTS chat_sessions (
    id          TEXT PRIMARY KEY,           -- the claude session uuid
    created_at  TEXT NOT NULL,
    turns       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,
    role        TEXT NOT NULL,              -- user | assistant
    parts       TEXT NOT NULL,              -- JSON list of {type: text|tool|proposal, ...}
    created_at  TEXT NOT NULL
);

-- Changes the chat suggested; applied only when the user clicks them.
CREATE TABLE IF NOT EXISTS chat_proposals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,
    action      TEXT NOT NULL,
    payload     TEXT NOT NULL,
    summary     TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending', -- pending | applied | rejected | failed
    result      TEXT,
    created_at  TEXT NOT NULL
);
"""

# Columns added after the first release; applied to existing databases.
MIGRATIONS = [
    ("todos", "snapshot", "TEXT"),            # JSON of the item exactly as Claude extracted it
    ("packages", "dismissed", "INTEGER NOT NULL DEFAULT 0"),
    ("highlights", "rating", "TEXT"),         # useful | not_important
    ("briefings", "vote", "TEXT"),
    ("chat_sessions", "mode", "TEXT NOT NULL DEFAULT 'assistant'"),  # assistant | code
]


def _migrate(conn) -> None:
    for table, column, decl in MIGRATIONS:
        cols = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
        if column not in cols:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect() -> sqlite3.Connection:
    config.ensure_home()
    conn = sqlite3.connect(config.DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(SCHEMA)
    _migrate(conn)
    return conn


@contextmanager
def session():
    conn = connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def get_state(conn, key: str, default=None):
    row = conn.execute("SELECT value FROM state WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_state(conn, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO state (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )
