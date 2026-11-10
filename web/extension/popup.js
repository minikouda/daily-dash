const $ = (s) => document.querySelector(s);
const send = (msg) => chrome.runtime.sendMessage(msg);

(async () => {
  const s = await send({ type: "summary" });
  if (!s) {
    $("#body").innerHTML = '<div class="off">The dashboard isn\'t running at 127.0.0.1:8765.</div>';
    return;
  }
  const stat = (n, label, cls = "") => `<div class="stat ${n && cls}"><b>${n}</b><span>${label}</span></div>`;
  $("#body").innerHTML = `<div class="stats">
    ${stat(s.inbox, "to triage")}${stat(s.overdue, "overdue", "red")}
    ${stat(s.due_today, "due today")}${stat(s.arriving_today, "packages today")}
  </div>`;
  if (s.last_check?.finished_at) {
    const mins = Math.round((Date.now() - new Date(s.last_check.finished_at)) / 60000);
    $("#note").textContent = `Mail checked ${mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`}`;
  }
})();

document.querySelectorAll("[data-open]").forEach((b) =>
  b.addEventListener("click", () => send({ type: "open", path: b.dataset.open }).then(() => window.close())),
);

$("#ask").addEventListener("click", async () => {
  // In Gmail: open the floating chat on the page. Elsewhere: the dashboard's chat.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const shown = tab?.url?.startsWith("https://mail.google.com/")
    ? await chrome.tabs.sendMessage(tab.id, { type: "toggle-chat" }).catch(() => false)
    : false;
  if (!shown) await send({ type: "open", path: "/?chat" });
  window.close();
});

// Ask before starting a run: misclicks are easy in a popup.
$("#refresh").addEventListener("click", () => {
  $("#confirm").hidden = false;
  $("#yes").focus();
});
$("#no").addEventListener("click", () => ($("#confirm").hidden = true));
$("#yes").addEventListener("click", async () => {
  $("#confirm").hidden = true;
  const r = await send({ type: "refresh" });
  $("#note").textContent = r === "started" ? "Checking mail… new items will show in a minute or two." : `Couldn't start: ${r?.error ?? r}`;
});
