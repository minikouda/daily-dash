"""Gmail access: one-time OAuth per account, then read-only fetching.

Each account gets its own token file (tokens/<email>.json). The OAuth client
(credentials.json) is a "Desktop app" client from your own Google Cloud
project, with the Gmail API enabled.
"""

import base64
import os
import re
from datetime import datetime, timezone
from email.utils import parseaddr
from html.parser import HTMLParser
from urllib.parse import quote

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from . import config

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
BODY_CHARS = 4000
# googleapiclient retries 429 / 403 rateLimitExceeded with exponential backoff.
RETRIES = 6

# Gmail search applied to every fetch: skip the noisy tabs and junk up front.
BASE_QUERY = "-category:promotions -category:social -category:forums -in:spam -in:trash -in:chats"


def token_path(email: str):
    return config.TOKENS_DIR / f"{email}.json"


def authorize(email: str) -> str:
    """Interactive browser consent for one account. Returns the address that
    actually signed in (to catch picking the wrong Google account)."""
    config.ensure_home()
    if not config.CREDENTIALS_PATH.exists():
        raise SystemExit(
            f"Missing {config.CREDENTIALS_PATH}. Download your OAuth client "
            "(Desktop app) JSON from Google Cloud Console and save it there."
        )
    flow = InstalledAppFlow.from_client_secrets_file(str(config.CREDENTIALS_PATH), SCOPES)
    creds = flow.run_local_server(port=0, login_hint=email, prompt="consent")
    actual = build("gmail", "v1", credentials=creds, cache_discovery=False) \
        .users().getProfile(userId="me").execute()["emailAddress"]
    path = token_path(actual)
    path.write_text(creds.to_json())
    os.chmod(path, 0o600)
    return actual


def service_for(email: str):
    path = token_path(email)
    if not path.exists():
        raise RuntimeError(f"{email} is not authorized; run: uv run daily-dash auth {email}")
    creds = Credentials.from_authorized_user_file(str(path), SCOPES)
    if not creds.valid:
        creds.refresh(Request())
        path.write_text(creds.to_json())
        os.chmod(path, 0o600)
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "head"):
            self._skip += 1
        elif tag in ("br", "p", "div", "tr", "li", "h1", "h2", "h3", "td"):
            self.parts.append("\n" if tag != "td" else " ")
        if tag == "a":
            href = dict(attrs).get("href") or ""
            # Keep tracking/order links; they're often the only place a tracking number appears.
            if re.search(r"track|order|ship|deliver", href, re.I):
                self.parts.append(f" [link: {href[:300]}] ")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "head") and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if not self._skip:
            self.parts.append(data)


def html_to_text(html: str) -> str:
    p = _TextExtractor()
    p.feed(html)
    return "".join(p.parts)


def _decode(data: str) -> str:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", "replace")


def _walk(part, plain: list, html: list):
    mime = part.get("mimeType", "")
    data = part.get("body", {}).get("data")
    if data and mime == "text/plain":
        plain.append(_decode(data))
    elif data and mime == "text/html":
        html.append(_decode(data))
    for sub in part.get("parts", []) or []:
        _walk(sub, plain, html)


def clean_text(text: str) -> str:
    text = re.sub(r"[ \t ​‌͏]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    return text.strip()


def parse_message(raw: dict, account: str) -> dict:
    payload = raw.get("payload", {})
    headers = {h["name"].lower(): h["value"] for h in payload.get("headers", [])}
    plain, html = [], []
    _walk(payload, plain, html)
    # Prefer HTML when it exists: many senders put only a stub in text/plain,
    # and HTML keeps the tracking links.
    body = html_to_text("\n".join(html)) if html else "\n".join(plain)
    received = datetime.fromtimestamp(int(raw["internalDate"]) / 1000, tz=timezone.utc)
    return {
        "id": raw["id"],
        "thread_id": raw.get("threadId"),
        "account": account,
        "received_at": received.isoformat(timespec="seconds"),
        "from": headers.get("from", ""),
        "sender_email": parseaddr(headers.get("from", ""))[1].lower(),
        "subject": headers.get("subject", ""),
        "snippet": raw.get("snippet", ""),
        "labels": raw.get("labelIds", []),
        "list_unsubscribe": "list-unsubscribe" in headers,
        "body": clean_text(body)[:BODY_CHARS],
    }


def fetch_since(email: str, after: datetime, limit: int) -> list[dict]:
    """Messages received after `after`, oldest first, at most `limit`."""
    svc = service_for(email)
    query = f"after:{int(after.timestamp())} {BASE_QUERY}"
    ids: list[str] = []
    page_token = None
    while len(ids) < limit:
        resp = svc.users().messages().list(
            userId="me", q=query, maxResults=min(100, limit - len(ids)), pageToken=page_token
        ).execute(num_retries=RETRIES)
        ids += [m["id"] for m in resp.get("messages", [])]
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    msgs = [
        parse_message(svc.users().messages().get(userId="me", id=i, format="full").execute(num_retries=RETRIES), email)
        for i in ids
    ]
    return sorted(msgs, key=lambda m: m["received_at"])


def get_message(account: str, msg_id: str, body_chars: int = 20000) -> dict:
    """One message, parsed, with a longer body (for the dashboard's email preview)."""
    raw = service_for(account).users().messages().get(userId="me", id=msg_id, format="full").execute(num_retries=RETRIES)
    payload = raw.get("payload", {})
    plain, html = [], []
    _walk(payload, plain, html)
    msg = parse_message(raw, account)
    body = "\n".join(plain) if plain else html_to_text("\n".join(html))
    msg["body"] = clean_text(body)[:body_chars]
    return msg


def thread_link(account: str, thread_id: str) -> str:
    # /mail/u/<email>/ 404s when Gmail can't map the address to a signed-in slot
    # (expired session, account in another Chrome profile); authuser falls back
    # to the account chooser or login and then opens the thread.
    return f"https://mail.google.com/mail/?authuser={quote(account)}#all/{thread_id}"
