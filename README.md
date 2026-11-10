# Daily Dash

A local dashboard that reads your Gmail every couple of hours, and gets better at it from your feedback.

- **Today**: the morning briefing, a 7-day strip, what's due soon, packages arriving, and emails worth reading
- **Inbox**: everything Claude found in email lands here first. Triage it from the keyboard: keep, mark done, snooze, or dismiss with a reason.
- **Tasks**: kept tasks plus your own, grouped by due date. They sync both ways with Apple Reminders (list "Daily Dash").
- **Packages**: every shipment, from ordered to delivered, with carrier tracking links
- **Learning**: rules Claude proposes from your feedback, for you to accept, edit or reject; rules you write yourself; muted senders; your feedback log

- **Ask Claude** (`⌘J`): a chat panel on any page. Claude can look up your tasks, packages, rules and runs, and search or read Gmail (read-only). Changes it suggests appear as buttons you approve. Each chat is one persistent `claude` conversation, with only the `dash` MCP tools (`chat_tools.py`) and no file or shell access.

Press `?` in the app for keyboard shortcuts, and `⌘K` for the command palette.

## Gmail extension (Chrome)

`web/extension` adds Daily Dash to Gmail:
- **In Gmail:** a pill in the bottom-left with live counts (overdue, to triage, due today, packages arriving). Click it to open the dashboard; an existing dashboard tab is reused.
- **Ask Claude** (floating window in Gmail, draggable): reads what's on screen. With an email open, that's the subject plus each expanded message in the thread; on the inbox or a label, it's the visible rows (sender, subject, snippet, date, unread). It's the same conversation as the dashboard's chat panel, with suggestions shown as Apply buttons. Untick "include" to ask without sending the page. Ask it to **draft a reply**: the draft appears as a card, and **Insert into reply** opens Gmail's Reply (or Reply all) and types it above the quoted thread. You review and press Send; nothing is ever sent for you, and your Google sign-in stays read-only.
- **Check mail (↻ next to the pill, or the toolbar popup):** asks "Check mail now? No / Check now" first, so a stray click doesn't start a run. The toolbar badge shows triage + overdue counts.
- **Shortcuts:** `⌥⇧D` opens the dashboard, `⌥⇧A` opens or closes the Ask Claude window. Change them at chrome://extensions/shortcuts.

Install: open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick `web/extension`. The extension only talks to `http://127.0.0.1:8765`; it reads the Gmail page only when you send a question from the Ask Claude window, and sends that text only to your local server.

## How feedback makes it smarter

Every decision is logged: kept, done, dismissed (and why), edited (old value → new), "Claude missed this", "not a package", "not worth highlighting", briefing 👍/👎, plus any note you type for Claude.

1. **Examples:** the latest corrections go into every extraction prompt verbatim.
2. **Rules:** after the morning digest, or when you click **Review now**, Claude reads the new feedback and *proposes* general rules. A rule only affects extraction once you accept it, so a bad generalization, or text planted in an email, can't change behavior on its own.
3. **Muting a sender** takes effect immediately, and that sender's mail never reaches Claude.

Emails are read with the Gmail API (read-only) and understood by Claude through `claude -p`, using your Claude Code login. Claude runs with no tools, so email content can't make it do anything. All data stays in `~/.daily-dash/`.

## Setup

```sh
cd ~/daily-dash
uv sync
uv run daily-dash init          # creates ~/.daily-dash/config.toml
```

### Gmail setup (one time)

1. Go to <https://console.cloud.google.com/>, create a project (e.g. "daily-dash"), then open **APIs & Services → Library** and enable the **Gmail API**.
2. **APIs & Services → OAuth consent screen**: user type **External**, app name "Daily Dash", your email as support/developer contact. Under **Audience → Test users**, add every Gmail address you'll connect. Leave the app in **Testing**.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, application type **Desktop app**. Download the JSON and save it as `~/.daily-dash/credentials.json`.
4. Authorize each account (this opens the browser; pick that account):
   ```sh
   uv run daily-dash auth you@gmail.com
   uv run daily-dash auth you@school.edu
   ```
   Apps in Testing mode get refresh tokens that expire after 7 days, so you'd have to re-authorize weekly. To avoid that, set the app to **In production** on the consent screen after the first authorization works. For your own unverified app, Google then just shows a one-time "unverified app" warning, which you can click through.

**Berkeley account:** if Google says the app is blocked by your organization, Berkeley doesn't allow unreviewed OAuth apps. Instead, add a Gmail filter in the Berkeley account that forwards everything to your personal Gmail, and remove the Berkeley address from `config.toml`.

Edit `~/.daily-dash/config.toml` to list your accounts and any senders to ignore.

### Try it

```sh
uv run daily-dash run refresh --since 7d --dry-run   # print what would be extracted; stores nothing
uv run daily-dash run digest                         # real run + morning briefing
uv run daily-dash web                                # http://127.0.0.1:8765
```

The first time Reminders is used, macOS asks whether the app running it (your terminal, or `uv` under launchd) may control Reminders. Allow it.

### Run it automatically

```sh
scripts/install-launchd.sh            # web (always on), digest 08:00, refresh every 4h
scripts/install-launchd.sh uninstall
```

Logs: `~/.daily-dash/logs/`. Run history and logs are also on the Settings page.

## How it works

```
Gmail API (per-account token) → skip promos/social/ignored senders → batches of 20 → claude -p (JSON schema)
  → todos (dedupe by title+date, or update an existing one) / packages (merged by tracking or order number)
  → highlights → SQLite → Apple Reminders sync (push new, pull completed/deleted) → web UI
```

- Tracking numbers are validated with [`tracking-numbers`](https://pypi.org/project/tracking-numbers/) (data from jkeen/tracking_number_data), which provides the carrier and tracking link without any API.
- Package status comes from shipping emails only (no carrier API polling).
- Delivered packages auto-hide after 3 days.

## Development

```sh
uv run pytest                       # backend tests
cd web/ui && npm install            # frontend (React + Vite + Tailwind)
npm run dev                         # http://localhost:5173, proxies /api to :8765
npm run build                       # builds into src/daily_dash/web/dist, served by FastAPI
uv run daily-dash learn             # run the feedback review from the CLI
```

After `npm run build`, restart the web agent: `launchctl kickstart -k gui/$(id -u)/com.$USER.dailydash.web`.
