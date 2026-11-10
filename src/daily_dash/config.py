"""Paths and user configuration.

Everything user-specific lives in DAILY_DASH_HOME (default ~/.daily-dash):
config.toml, credentials.json (Google OAuth client), tokens/, dash.db, logs/.
"""

import os
import tomllib
from pathlib import Path

HOME = Path(os.environ.get("DAILY_DASH_HOME", Path.home() / ".daily-dash"))
TOKENS_DIR = HOME / "tokens"
LOGS_DIR = HOME / "logs"
DB_PATH = HOME / "dash.db"
CREDENTIALS_PATH = HOME / "credentials.json"
CONFIG_PATH = HOME / "config.toml"

PACKAGE_DIR = Path(__file__).parent

DEFAULTS = {
    "timezone": "America/Los_Angeles",
    "accounts": [],
    # How far back the very first fetch for an account goes.
    "initial_lookback_days": 7,
    # Hard cap per account per run so a backlog can't blow up one prompt.
    "max_messages_per_run": 150,
    "ignore_senders": [],
    "claude": {
        "bin": "claude",
        # Background jobs: email extraction, briefing, learning review.
        "model": "sonnet",
        "effort": "",
        # Chat (dashboard panel and Gmail window: Q&A, reply drafts). Quick turns
        # matter more than deep reasoning here.
        "chat_model": "sonnet",
        "chat_effort": "low",
        # Code mode (editing this project).
        "code_model": "sonnet",
        "code_effort": "medium",
        "batch_size": 20,
        "timeout_seconds": 600,
    },
    "reminders": {
        "enabled": True,
        "list_name": "Daily Dash",
        # Push TODOs without a due date too.
        "push_undated": True,
        # Alert this many hours before deadline/payment items with a time.
        "deadline_lead_hours": 24,
        # Time of day used for date-only items (alert + due).
        "default_hour": 9,
    },
    "web": {"host": "127.0.0.1", "port": 8765},
    "delivered_archive_days": 3,
}

CONFIG_TEMPLATE = """\
# daily-dash configuration
timezone = "America/Los_Angeles"

# Gmail / Google Workspace accounts to digest. Authorize each once with:
#   uv run daily-dash auth <email>
accounts = [
  "you@gmail.com",
  "you@school.edu",
]

initial_lookback_days = 7
max_messages_per_run = 150

# Sender addresses or domains to skip entirely (substring match).
ignore_senders = []

[claude]
model = "sonnet"          # extraction, briefing, learning review
batch_size = 20
chat_model = "sonnet"     # chat panel + Gmail window (e.g. "haiku" for faster, cheaper replies)
chat_effort = "low"       # low | medium | high
code_model = "sonnet"     # Code mode
code_effort = "medium"

[reminders]
enabled = true
list_name = "Daily Dash"
push_undated = true
deadline_lead_hours = 24
default_hour = 9

[web]
host = "127.0.0.1"
port = 8765
"""


def _merge(base: dict, override: dict) -> dict:
    out = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _merge(out[key], value)
        else:
            out[key] = value
    return out


def ensure_home() -> None:
    for d in (HOME, TOKENS_DIR, LOGS_DIR):
        d.mkdir(parents=True, exist_ok=True)
    os.chmod(HOME, 0o700)
    if not CONFIG_PATH.exists():
        CONFIG_PATH.write_text(CONFIG_TEMPLATE)


def load() -> dict:
    ensure_home()
    with CONFIG_PATH.open("rb") as f:
        return _merge(DEFAULTS, tomllib.load(f))
