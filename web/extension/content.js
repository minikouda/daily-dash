// Daily Dash inside Gmail: a status pill (bottom-left) and a floating
// "Ask Claude" window that reads what you're looking at: the open email
// thread, or the visible message list. Everything lives in a shadow root so
// Gmail's CSS can't touch it (and it can't touch Gmail's). Network calls go
// through the extension's background worker (background.js).
(() => {
  if (window.__dailyDash) return;
  window.__dailyDash = true;

  const VIEW_CHARS = 14000;

  // --- reading Gmail -----------------------------------------------------------------

  const clean = (s) => (s || "").replace(/​| /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  /** The open thread: subject plus each expanded message (sender, date, body), latest kept if too long. */
  function readEmail() {
    const subject = document.querySelector("h2.hP")?.textContent?.trim();
    if (!subject) return null;
    const msgs = [...document.querySelectorAll("div.adn")]
      .map((m) => {
        const from = m.querySelector("span.gD");
        const body = m.querySelector("div.a3s");
        if (!body) return null; // collapsed message
        const sender = from ? `${from.getAttribute("name") || from.textContent} <${from.getAttribute("email") || ""}>` : "";
        const date = m.querySelector("span.g3")?.getAttribute("title") || "";
        return `From: ${sender}\nDate: ${date}\n\n${clean(body.innerText)}`;
      })
      .filter(Boolean);
    let text = `Subject: ${subject}\n\n` + msgs.join("\n\n---\n\n");
    if (text.length > VIEW_CHARS) text = `Subject: ${subject}\n\n[earlier messages trimmed]\n…` + text.slice(-VIEW_CHARS);
    const sender = msgs.length ? msgs[msgs.length - 1].split("\n")[0].replace("From: ", "") : "";
    return { kind: "email", label: subject, text, sender };
  }

  /** The visible message list (inbox, label or search results). */
  function readList() {
    const rows = [...document.querySelectorAll("tr.zA")].filter((r) => r.offsetParent !== null).slice(0, 60);
    if (!rows.length) return null;
    const lines = rows.map((r) => {
      const who = [...r.querySelectorAll("span.yP, span.zF")].map((s) => s.getAttribute("name") || s.textContent).join(", ");
      const email = r.querySelector("span.yP, span.zF")?.getAttribute("email") || "";
      const subject = r.querySelector("span.bog")?.textContent || "";
      const snippet = clean(r.querySelector("span.y2")?.textContent || "").replace(/^[-–]\s*/, "");
      const date = r.querySelector("td.xW span")?.getAttribute("title") || r.querySelector("td.xW span")?.textContent || "";
      const unread = r.classList.contains("zE") ? "UNREAD " : "";
      return `- ${unread}${date} | ${who}${email ? ` <${email}>` : ""} | ${subject} — ${snippet}`;
    });
    const label = document.title.replace(/ - .*$/, "").trim() || "Inbox";
    return { kind: "list", label: `${label}, ${rows.length} messages shown`, text: lines.join("\n").slice(0, VIEW_CHARS) };
  }

  const readView = () => readEmail() || readList();

  // --- filling Gmail's reply box (never sends) ------------------------------------------

  const visible = (el) => !!el && el.offsetParent !== null;
  const lastVisible = (sel) => [...document.querySelectorAll(sel)].filter(visible).pop() || null;

  /** Gmail's message editor in the open thread (an inline reply box), if one is open. */
  const replyEditor = () => lastVisible('div[contenteditable="true"][role="textbox"], div.Am.editable[contenteditable="true"]');

  function replyButton(all) {
    return all
      ? lastVisible('[role="button"][data-tooltip="Reply all"], span.ams.bkI')
      : lastVisible('[role="button"][data-tooltip="Reply"], span.ams.bkH');
  }

  /** Gmail ignores bare .click() on many controls; send the full mouse sequence. */
  function press(el) {
    for (const type of ["mousedown", "mouseup", "click"])
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  }

  async function waitFor(fn, ms) {
    for (let t = 0; t < ms; t += 100) {
      const v = fn();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  }

  /** Open Reply (or Reply all) if needed and type the draft at the top of the editor. */
  async function insertReply(body, all) {
    let editor = replyEditor();
    if (!editor) {
      const btn = replyButton(all) || replyButton(!all);
      if (!btn) throw new Error("Open the email first: Gmail's Reply button isn't on screen.");
      press(btn);
      editor = await waitFor(replyEditor, 5000);
      if (!editor) throw new Error("Gmail's reply box didn't open. Click Reply, then try Insert again.");
    }
    editor.focus();
    const range = document.createRange();
    range.setStart(editor, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    // insertText goes through Gmail's own editing pipeline, so Gmail saves the draft and Undo works.
    if (!document.execCommand("insertText", false, body.trim() + "\n\n")) {
      editor.insertAdjacentText("afterbegin", body.trim() + "\n\n");
    }
    editor.scrollIntoView({ block: "center" });
  }

  // --- tiny, safe markdown (escape first, then a few constructs) ----------------------

  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>');
  }
  function markdown(md) {
    const out = [];
    let list = null;
    const close = () => list && (out.push(`</${list}>`), (list = null));
    const lines = md.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*\|.*\|\s*$/.test(line)) {
        close();
        const rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
        i--;
        const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
        const body = rows.filter((r) => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
        out.push("<table>" + body.map((r, n) => `<tr>${cells(r).map((c) => (n ? `<td>${c}</td>` : `<th>${c}</th>`)).join("")}</tr>`).join("") + "</table>");
        continue;
      }
      const ul = line.match(/^\s*[-*]\s+(.*)/);
      const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
      if (ul || ol) {
        const tag = ul ? "ul" : "ol";
        if (list !== tag) (close(), out.push(`<${tag}>`), (list = tag));
        out.push(`<li>${inline((ul || ol)[1])}</li>`);
        continue;
      }
      close();
      const h = line.match(/^#{1,4}\s+(.*)/);
      if (h) out.push(`<p><b>${inline(h[1])}</b></p>`);
      else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
    }
    close();
    return out.join("");
  }

  // --- UI ------------------------------------------------------------------------------

  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:2147483000;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
  <style>
    :host { all: initial; }
    * { box-sizing: border-box; }
    .ui { --bg:#fff; --bg2:#f7f7f5; --fg:#1c1b19; --fg2:#57534e; --fg3:#8f8a83; --line:#e7e5e0; --hover:#f0efec;
          --accent:#4f46e5; --accent-fg:#fff; --soft:#eef0ff; --red:#d4382c; --green:#22804a;
          font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Google Sans", Roboto, "PingFang SC", sans-serif; color: var(--fg); }
    @media (prefers-color-scheme: dark) {
      .ui { --bg:#1c1c1d; --bg2:#151516; --fg:#ededeb; --fg2:#b3b0aa; --fg3:#7d7a75; --line:#2f2f31; --hover:#262628;
            --accent:#8b85ff; --accent-fg:#0e0e14; --soft:#24233d; --red:#ff6b5f; --green:#5fd08e; }
    }
    button { all: unset; cursor: pointer; }
    .bar { display:flex; gap:6px; align-items:center; font-weight:500; font-size:13px; }
    .pill { display:flex; align-items:center; gap:8px; height:34px; padding:0 14px; border-radius:17px; background:var(--bg);
            box-shadow:0 2px 10px rgba(0,0,0,.14),0 0 0 1px rgba(0,0,0,.06); white-space:nowrap; }
    .pill:hover { background:var(--soft); }
    .pill.ask { background:var(--accent); color:var(--accent-fg); }
    .logo { width:18px; height:18px; border-radius:6px; background:#4f46e5; display:grid; place-items:center; flex:none; }
    .count { color:var(--fg2); font-weight:400; } .count b { color:var(--fg); font-weight:600; } .red b { color:var(--red); }

    .win { position:fixed; width:420px; height:min(640px, calc(100vh - 100px)); left:16px; bottom:62px; display:none;
           flex-direction:column; background:var(--bg); border-radius:16px; overflow:hidden;
           box-shadow:0 24px 64px -12px rgba(0,0,0,.35), 0 0 0 1px rgba(0,0,0,.08); }
    .win.open { display:flex; }
    .head { display:flex; align-items:center; gap:8px; padding:10px 10px 10px 14px; border-bottom:1px solid var(--line); cursor:move; user-select:none; }
    .head .title { font-weight:600; font-size:14px; flex:1; }
    .icon { width:28px; height:28px; display:grid; place-items:center; border-radius:8px; color:var(--fg3); font-size:15px; }
    .icon:hover { background:var(--hover); color:var(--fg); }
    .ctx { display:flex; align-items:center; gap:8px; padding:8px 14px; background:var(--bg2); border-bottom:1px solid var(--line); font-size:12.5px; color:var(--fg2); }
    .ctx .chip { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ctx .chip b { color:var(--fg); font-weight:600; }
    .ctx label { display:flex; align-items:center; gap:5px; cursor:pointer; flex:none; }
    .msgs { flex:1; overflow-y:auto; padding:14px; display:flex; flex-direction:column; gap:12px; }
    .user { align-self:flex-end; max-width:85%; background:var(--accent); color:var(--accent-fg); padding:8px 12px; border-radius:16px 16px 4px 16px; white-space:pre-wrap; }
    .user .via { display:block; font-size:11px; opacity:.75; margin-top:2px; }
    .bot { font-size:13.5px; } .bot p { margin:0 0 6px; } .bot ul, .bot ol { margin:0 0 6px; padding-left:20px; }
    .bot li { margin:2px 0; } .bot a { color:var(--accent); } .bot code { font:12px ui-monospace,Menlo,monospace; background:var(--hover); padding:1px 4px; border-radius:4px; }
    .bot table { border-collapse:collapse; font-size:12.5px; margin:4px 0 8px; display:block; overflow-x:auto; }
    .bot th, .bot td { border-bottom:1px solid var(--line); padding:3px 8px 3px 0; text-align:left; vertical-align:top; } .bot th { color:var(--fg3); }
    .tool { font-size:12px; color:var(--fg3); }
    .working { font-size:12px; color:var(--fg3); }
    .err { font-size:12.5px; color:var(--red); background:color-mix(in srgb, var(--red) 12%, transparent); padding:6px 10px; border-radius:10px; }
    .prop { border:1px solid color-mix(in srgb, var(--accent) 35%, transparent); background:color-mix(in srgb, var(--soft) 60%, transparent); border-radius:12px; padding:10px 12px; }
    .prop.done { border-color:var(--line); background:var(--bg2); }
    .prop .s { font-weight:500; } .prop .d { font-size:12px; color:var(--fg3); }
    .prop .btns { display:flex; gap:6px; margin-top:8px; }
    .btn { height:28px; padding:0 12px; border-radius:8px; font-size:12.5px; font-weight:500; display:inline-flex; align-items:center; }
    .btn.primary { background:var(--accent); color:var(--accent-fg); } .btn.ghost { color:var(--fg2); } .btn.ghost:hover { background:var(--hover); }
    .ok { color:var(--green); font-size:12px; } .no { color:var(--fg3); font-size:12px; }
    .prop.draft .body { margin:8px 0 0; max-height:220px; overflow:auto; white-space:pre-wrap; word-break:break-word;
      font:13px/1.5 inherit; font-family:inherit; background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:8px 10px; }
    .sugg { display:flex; flex-direction:column; gap:6px; margin-top:auto; }
    .sugg .lead { font-weight:600; font-size:14.5px; } .sugg .sub { font-size:12.5px; color:var(--fg3); margin-bottom:4px; }
    .sugg button { border:1px solid var(--line); border-radius:10px; padding:7px 10px; font-size:13px; color:var(--fg2); }
    .sugg button:hover { background:var(--soft); color:var(--fg); }
    .compose { border-top:1px solid var(--line); padding:10px; }
    .box { display:flex; align-items:flex-end; gap:6px; border:1px solid var(--line); border-radius:12px; background:var(--bg2); padding:6px 6px 6px 10px; }
    .box:focus-within { border-color: color-mix(in srgb, var(--accent) 60%, transparent); }
    textarea { all:unset; flex:1; min-height:44px; max-height:160px; overflow-y:auto; font-size:13.5px; line-height:1.45; white-space:pre-wrap; word-break:break-word; }
    textarea::placeholder { color:var(--fg3); }
    .send { width:30px; height:30px; border-radius:8px; background:var(--accent); color:var(--accent-fg); display:grid; place-items:center; font-weight:700; }
    .send[disabled] { opacity:.5; cursor:default; }
    .hint { font-size:11px; color:var(--fg3); margin:6px 2px 0; }
    .pill.check { width:34px; padding:0; justify-content:center; font-size:16px; color:var(--fg2); }
    .pill.check.busy { animation: spin 1s linear infinite; pointer-events:none; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .confirm { position:fixed; left:16px; bottom:58px; width:250px; display:none; background:var(--bg); border-radius:12px; padding:12px;
               box-shadow:0 12px 32px -8px rgba(0,0,0,.3), 0 0 0 1px rgba(0,0,0,.08); }
    .confirm.open { display:block; }
    .confirm .q { font-weight:600; font-size:13.5px; } .confirm .d { font-size:12.5px; color:var(--fg3); margin-top:2px; }
    .confirm .btns { display:flex; justify-content:flex-end; gap:6px; margin-top:10px; }
    .toast { position:fixed; left:16px; bottom:58px; background:var(--bg); color:var(--fg); font-size:12.5px; padding:8px 12px; border-radius:10px;
             box-shadow:0 8px 24px -6px rgba(0,0,0,.25), 0 0 0 1px rgba(0,0,0,.06); display:none; }
    .toast.show { display:block; }
  </style>
  <div class="ui">
    <div class="bar">
      <button class="pill open" title="Open Daily Dash (⌥⇧D)">
        <span class="logo"><svg viewBox="0 0 32 32" width="12" height="12"><path d="M9 16.5l4.5 4.5L23 11" stroke="#fff" stroke-width="3.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <span class="label">Daily Dash</span>
      </button>
      <button class="pill ask" title="Ask Claude about what you're reading (⌥⇧A)">✦ Ask Claude</button>
      <button class="pill check" title="Check mail now">↻</button>
    </div>
    <div class="confirm" role="dialog" aria-label="Confirm mail check">
      <div class="q">Check mail now?</div>
      <div class="d">Fetches new email and has Claude read it.</div>
      <div class="btns"><button class="btn ghost no">No</button><button class="btn primary yes">Check now</button></div>
    </div>
    <div class="win" role="dialog" aria-label="Ask Claude">
      <div class="head">
        <span class="logo"><svg viewBox="0 0 32 32" width="12" height="12"><path d="M9 16.5l4.5 4.5L23 11" stroke="#fff" stroke-width="3.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <span class="title">Ask Claude</span>
        <button class="icon new" title="New conversation">✎</button>
        <button class="icon dash" title="Open in Daily Dash">↗</button>
        <button class="icon close" title="Close (Esc)">✕</button>
      </div>
      <div class="ctx"><span class="chip"></span><label><input type="checkbox" class="use" checked> include</label></div>
      <div class="msgs"></div>
      <div class="compose">
        <div class="box"><textarea rows="2" placeholder="Ask about this email…"></textarea><button class="send" title="Send (Enter)">↑</button></div>
        <div class="hint">Enter to send · Shift+Enter for a new line · reads only what's on screen, sends it to your local Daily Dash</div>
      </div>
    </div>
    <div class="toast"></div>
  </div>`;
  document.documentElement.appendChild(host);

  const $ = (s) => root.querySelector(s);
  const label = $(".label");
  const win = $(".win");
  const msgsEl = $(".msgs");
  const input = $("textarea");
  const sendBtn = $(".send");
  const useView = $(".use");
  const send = (msg) => chrome.runtime.sendMessage(msg);
  const call = (method, path, body) =>
    send({ type: "api", method, path, body }).then((r) => {
      if (r && r.error) throw new Error(r.error);
      return r;
    });

  let state = null; // {session_id, messages, proposals}
  let busy = false;
  let view = null;

  // --- pill counts ---------------------------------------------------------------------

  async function refreshCounts() {
    const s = await send({ type: "summary" }).catch(() => null);
    if (!s) return (label.innerHTML = 'Daily Dash <span class="count">· offline</span>');
    const bits = [];
    if (s.overdue) bits.push(`<span class="count red"><b>${s.overdue}</b> overdue</span>`);
    if (s.inbox) bits.push(`<span class="count"><b>${s.inbox}</b> to triage</span>`);
    if (s.due_today) bits.push(`<span class="count"><b>${s.due_today}</b> due today</span>`);
    if (s.arriving_today) bits.push(`<span class="count"><b>${s.arriving_today}</b> 📦 today</span>`);
    label.innerHTML = bits.length ? bits.join(' <span class="count">·</span> ') : "Daily Dash";
  }

  // --- context chip --------------------------------------------------------------------

  function refreshView() {
    view = readView();
    const chip = $(".chip");
    if (!view) chip.innerHTML = "Nothing readable on this page";
    else if (view.kind === "email") chip.innerHTML = `Reading email: <b>${esc(view.label)}</b>`;
    else chip.innerHTML = `Reading list: <b>${esc(view.label)}</b>`;
    input.placeholder = view?.kind === "email" ? "Ask about this email…" : "Ask about these messages…";
    if (state && !state.messages.length && !busy) renderMessages();
  }

  // --- rendering -----------------------------------------------------------------------

  const TOOL_TEXT = {
    dashboard_overview: () => "Looked over your dashboard",
    list_tasks: (i) => (i.query ? `Looked for tasks matching “${i.query}”` : "Listed your tasks"),
    get_task: (i) => `Opened task #${i.task_id}`,
    list_packages: () => "Checked packages",
    list_highlights: () => "Read your highlights",
    list_rules: () => "Checked your rules",
    recent_feedback: () => "Reviewed your recent feedback",
    run_history: () => "Checked recent mail runs",
    search_email: (i) => `Searched email: ${i.query}`,
    read_email: () => "Read an email",
  };

  function suggestions() {
    const qs =
      view?.kind === "email"
        ? ["What do I need to do about this email?", "Draft a reply for me", "Make this a task with the right due date", "Summarize this thread in 3 bullets"]
        : ["What here needs my attention today?", "Which of these can I safely ignore?", "Anything with a deadline in this list?", "Summarize the unread ones"];
    return `<div class="sugg"><div class="lead">${view?.kind === "email" ? "Ask about this email" : "Ask about your messages"}</div>
      <div class="sub">Claude sees what's on screen, plus your Daily Dash tasks and Gmail search. Changes it suggests are buttons you approve.</div>
      ${qs.map((q) => `<button data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div>`;
  }

  function draftHtml(p) {
    const body = String(p.payload?.body || "");
    const who = p.payload?.reply_all ? "Reply all" : "Reply";
    if (p.status === "pending")
      return `<div class="prop draft" data-id="${p.id}"><div class="s">✉︎ ${esc(p.summary)}</div>
        <pre class="body">${esc(body)}</pre>
        <div class="btns"><button class="btn primary" data-draft="insert">Insert into ${who.toLowerCase()}</button>
        <button class="btn ghost" data-draft="copy">Copy</button><button class="btn ghost" data-act="reject">No thanks</button></div></div>`;
    return `<div class="prop done"><div class="s">✉︎ ${esc(p.summary)}</div>${
      p.status === "applied" ? '<span class="ok">✓ Used — review it in Gmail and send when ready</span>' : '<span class="no">Declined</span>'}</div>`;
  }

  function proposalHtml(p) {
    if (!p) return "";
    if (p.action === "draft_reply") return draftHtml(p);
    const due = p.payload?.due ? ` · due ${esc(String(p.payload.due))}` : "";
    if (p.status === "pending")
      return `<div class="prop" data-id="${p.id}"><div class="s">${esc(p.summary)}</div><div class="d">${esc(p.action.replace("_", " "))}${due}</div>
        <div class="btns"><button class="btn primary" data-act="apply">Apply</button><button class="btn ghost" data-act="reject">No thanks</button></div></div>`;
    const res = p.status === "applied" ? `<span class="ok">✓ ${esc(p.result || "Applied")}</span>` : `<span class="no">${p.status === "failed" ? esc(`Couldn't apply: ${p.result}`) : "Declined"}</span>`;
    return `<div class="prop done"><div class="s">${esc(p.summary)}</div>${res}</div>`;
  }

  function partsHtml(parts) {
    return parts
      .map((p) => {
        if (p.type === "text") return `<div class="bot">${markdown(p.text)}</div>`;
        if (p.type === "tool") return `<div class="tool">· ${esc((TOOL_TEXT[p.name] || (() => p.name))(p.input || {}))}</div>`;
        if (p.type === "proposal") return proposalHtml(state.proposals[p.id]);
        return "";
      })
      .join("");
  }

  function renderMessages(live) {
    if (!state) return;
    if (!state.messages.length && !live) {
      msgsEl.innerHTML = suggestions();
      return;
    }
    let html = state.messages
      .map((m) =>
        m.role === "user"
          ? `<div class="user">${esc(m.parts[0].text)}${m.parts[0].context ? `<span class="via">${esc(m.parts[0].context)}</span>` : ""}</div>`
          : partsHtml(m.parts),
      )
      .join("");
    if (live) {
      html += `<div class="user">${esc(live.message)}${live.via ? `<span class="via">${esc(live.via)}</span>` : ""}</div>`;
      html += partsHtml(live.parts);
      if (live.streaming) html += `<div class="bot">${markdown(live.streaming)}</div>`;
      else if (!live.error) html += `<div class="working">Claude is thinking…</div>`;
      if (live.error) html += `<div class="err">${esc(live.error)}</div>`;
    }
    msgsEl.innerHTML = html;
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  async function loadChat() {
    try {
      state = await call("GET", "/api/chat");
      renderMessages();
    } catch (e) {
      msgsEl.innerHTML = `<div class="err">Daily Dash isn't reachable at 127.0.0.1:8765 (${esc(e.message)}).</div>`;
    }
  }

  // --- sending -------------------------------------------------------------------------

  function ask(text) {
    const message = text.trim();
    if (!message || busy || !state) return;
    refreshView();
    busy = true;
    sendBtn.disabled = true;
    input.value = "";
    const ctx = useView.checked && view ? { gmail: { kind: view.kind, label: view.label, text: view.text } } : {};
    const live = { message, via: ctx.gmail ? `Gmail · ${view.label}` : "", parts: [], streaming: "", error: null };
    renderMessages(live);
    const port = chrome.runtime.connect({ name: "chat" });
    port.onMessage.addListener(async (ev) => {
      switch (ev.type) {
        case "delta":
          live.streaming += ev.text;
          break;
        case "text_end":
          if (live.streaming) live.parts.push({ type: "text", text: live.streaming });
          live.streaming = "";
          break;
        case "tool":
          live.parts.push({ type: "tool", name: ev.name, input: ev.input });
          break;
        case "proposal":
          state.proposals[ev.proposal.id] = ev.proposal;
          live.parts.push({ type: "proposal", id: ev.proposal.id });
          break;
        case "error":
          live.error = ev.message;
          break;
        case "__end":
          port.disconnect();
          busy = false;
          sendBtn.disabled = false;
          if (!live.error) await loadChat();
          else renderMessages(live);
          refreshCounts();
          return;
      }
      renderMessages(live);
    });
    port.postMessage({ session_id: state.session_id, message, context: ctx });
  }

  msgsEl.addEventListener("click", async (e) => {
    const q = e.target.closest("[data-q]");
    if (q) return ask(q.dataset.q);
    const d = e.target.closest("[data-draft]");
    if (d) {
      const id = d.closest(".prop").dataset.id;
      const p = state.proposals[id];
      try {
        if (d.dataset.draft === "insert") {
          await insertReply(String(p.payload.body), !!p.payload.reply_all);
          toast("Draft inserted — review it and press Send when ready.");
        } else {
          await navigator.clipboard.writeText(String(p.payload.body));
          toast("Draft copied.");
        }
        await call("POST", `/api/chat/proposals/${id}`, { action: "apply" });
        await loadChat();
      } catch (err) {
        toast(err.message, 7000);
      }
      return;
    }
    const act = e.target.closest("[data-act]");
    if (act) {
      const id = act.closest(".prop").dataset.id;
      act.parentElement.querySelectorAll("button").forEach((b) => (b.disabled = true));
      try {
        await call("POST", `/api/chat/proposals/${id}`, { action: act.dataset.act });
      } catch (err) {
        alert(`Daily Dash: ${err.message}`);
      }
      await loadChat();
      refreshCounts();
    }
  });

  input.addEventListener("keydown", (e) => {
    e.stopPropagation(); // keep Gmail's single-key shortcuts out of the text box
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      ask(input.value);
    }
    if (e.key === "Escape") toggle(false);
  });
  ["keypress", "keyup"].forEach((t) => input.addEventListener(t, (e) => e.stopPropagation()));
  sendBtn.addEventListener("click", () => ask(input.value));

  // --- window behavior -----------------------------------------------------------------

  function toggle(force) {
    const open = force ?? !win.classList.contains("open");
    win.classList.toggle("open", open);
    if (open) {
      refreshView();
      if (!state) loadChat();
      setTimeout(() => input.focus(), 30);
    }
    return open;
  }

  $(".ask").addEventListener("click", () => toggle());
  $(".close").addEventListener("click", () => toggle(false));
  $(".open").addEventListener("click", () => send({ type: "open", path: "/" }));
  $(".dash").addEventListener("click", () => send({ type: "open", path: "/?chat" }));
  $(".new").addEventListener("click", async () => {
    if (busy) return;
    state = await call("POST", "/api/chat/new").catch(() => state);
    renderMessages();
    input.focus();
  });

  // Check mail, behind a Yes/No bubble so a stray click doesn't start a run.
  const confirmEl = $(".confirm");
  const checkBtn = $(".check");
  const toastEl = $(".toast");
  const toast = (text, ms = 4000) => {
    toastEl.textContent = text;
    toastEl.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => toastEl.classList.remove("show"), ms);
  };
  const askCheck = (open) => {
    confirmEl.classList.toggle("open", open);
    if (open) {
      win.classList.remove("open");
      setTimeout(() => $(".yes").focus(), 0);
    }
  };
  checkBtn.addEventListener("click", () => askCheck(!confirmEl.classList.contains("open")));
  $(".no").addEventListener("click", () => askCheck(false));
  confirmEl.addEventListener("keydown", (e) => {
    e.stopPropagation(); // Gmail shortcuts stay out of this
    if (e.key === "Escape") askCheck(false);
  });
  $(".yes").addEventListener("click", async () => {
    askCheck(false);
    checkBtn.classList.add("busy");
    const r = await send({ type: "refresh" }).catch((e) => ({ error: String(e) }));
    if (r === "started") {
      toast("Checking mail… new items show up in a minute or two.");
      // Poll until the run finishes, then refresh the counts.
      for (let i = 0; i < 40; i++) {
        await new Promise((res) => setTimeout(res, 6000));
        const s = await send({ type: "summary" }).catch(() => null);
        if (s?.last_check?.finished_at && Date.now() - new Date(s.last_check.finished_at) < 60_000) break;
      }
      refreshCounts();
      toast("Mail check finished.");
    } else {
      toast(`Couldn't start: ${r?.error ?? r}`, 6000);
    }
    checkBtn.classList.remove("busy");
  });

  // Drag the window by its header.
  $(".head").addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    const r = win.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    const move = (ev) => {
      win.style.left = `${Math.max(0, Math.min(window.innerWidth - r.width, ev.clientX - dx))}px`;
      win.style.top = `${Math.max(0, Math.min(window.innerHeight - 60, ev.clientY - dy))}px`;
      win.style.bottom = "auto";
    };
    const up = () => (window.removeEventListener("pointermove", move), window.removeEventListener("pointerup", up));
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg.type === "toggle-chat") reply(toggle());
    if (msg.type === "current-email") reply(readEmail());
  });

  // Gmail is a single-page app: keep the context chip in sync with what's open.
  let lastKey = "";
  setInterval(() => {
    if (!win.classList.contains("open")) return;
    const v = readEmail()?.label ?? `list:${document.title}`;
    if (v !== lastKey) (lastKey = v), refreshView();
  }, 1000);

  refreshCounts();
  setInterval(refreshCounts, 60_000);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && refreshCounts());
})();
