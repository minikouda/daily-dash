// Talks to the local Daily Dash server. Content scripts can't fetch 127.0.0.1
// from Gmail's origin, so they ask this worker instead.
const DASH = "http://127.0.0.1:8765";
const HEADERS = { "X-Daily-Dash": "1" }; // the server requires it on writes

async function summary() {
  const res = await fetch(`${DASH}/api/summary`);
  if (!res.ok) throw new Error(`server returned ${res.status}`);
  return res.json();
}

async function updateBadge() {
  try {
    const s = await summary();
    const n = s.inbox + s.overdue;
    chrome.action.setBadgeText({ text: n ? String(n) : "" });
    chrome.action.setBadgeBackgroundColor({ color: s.overdue ? "#d4382c" : "#4f46e5" });
    return s;
  } catch {
    chrome.action.setBadgeText({ text: "off" });
    chrome.action.setBadgeBackgroundColor({ color: "#8f8a83" });
    return null;
  }
}

/** Focus an existing dashboard tab (navigating it to `path`) or open a new one. */
async function openDashboard(path = "/") {
  const url = DASH + path;
  const [tab] = await chrome.tabs.query({ url: `${DASH}/*` });
  if (tab) {
    await chrome.tabs.update(tab.id, path === "/" && !tab.url.includes("?") ? { active: true } : { active: true, url });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

/** JSON call to the dashboard API (the floating chat uses this for history and proposals). */
async function api(method, path, body) {
  if (!path.startsWith("/api/")) throw new Error("only /api/ paths");
  const res = await fetch(DASH + path, {
    method,
    headers: { ...HEADERS, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `server returned ${res.status}`);
  return data;
}

// Chat turns stream back over a port, one event per line of the server's NDJSON.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "chat") return;
  let aborted = false;
  const ctrl = new AbortController();
  port.onDisconnect.addListener(() => {
    aborted = true;
    ctrl.abort();
  });
  port.onMessage.addListener(async (req) => {
    try {
      const res = await fetch(`${DASH}/api/chat/send`, {
        method: "POST",
        headers: { ...HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify(req),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const detail = (await res.json().catch(() => ({}))).detail || res.statusText;
        port.postMessage({ type: "error", message: String(detail) });
      } else {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done || aborted) break;
          buf += dec.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (line) port.postMessage(JSON.parse(line));
          }
        }
      }
    } catch (e) {
      if (!aborted) port.postMessage({ type: "error", message: `Can't reach Daily Dash: ${e.message}` });
    }
    if (!aborted) port.postMessage({ type: "__end" });
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    switch (msg.type) {
      case "api":
        return api(msg.method, msg.path, msg.body);
      case "summary":
        return updateBadge();
      case "open":
        await openDashboard(msg.path ?? "/");
        return true;
      case "refresh": {
        const res = await fetch(`${DASH}/api/run/refresh`, { method: "POST", headers: HEADERS });
        updateBadge();
        return res.ok ? "started" : (await res.json()).detail;
      }
    }
  })().then(reply, (e) => reply({ error: String(e) }));
  return true; // async reply
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "open-dashboard") return openDashboard("/");
  if (command === "ask-about-email") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url?.startsWith("https://mail.google.com/")) {
      const shown = await chrome.tabs.sendMessage(tab.id, { type: "toggle-chat" }).catch(() => false);
      if (shown !== false) return;
    }
    return openDashboard("/?chat");
  }
});

chrome.alarms.create("badge", { periodInMinutes: 2 });
chrome.alarms.onAlarm.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);
chrome.runtime.onInstalled.addListener(updateBadge);
