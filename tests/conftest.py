import os
import tempfile

# Must be set before daily_dash.config is imported anywhere.
os.environ["DAILY_DASH_HOME"] = tempfile.mkdtemp(prefix="daily-dash-test-")

import pytest  # noqa: E402

from daily_dash import config, db  # noqa: E402


@pytest.fixture
def conn():
    if config.DB_PATH.exists():
        config.DB_PATH.unlink()
    c = db.connect()
    yield c
    c.close()


@pytest.fixture
def cfg():
    c = config.load()
    c["reminders"]["enabled"] = False
    return c
