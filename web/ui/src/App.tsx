import { CircleAlert, Loader2 } from "lucide-react";
import { useEffect } from "react";
import { Toaster } from "sonner";
import { Route, Switch, useLocation } from "wouter";
import { useData } from "./api";
import { ChatPanel } from "./components/ChatPanel";
import { CommandPalette, ShortcutsHelp } from "./components/CommandPalette";
import { DismissDialog } from "./components/DismissDialog";
import { Sidebar } from "./components/Sidebar";
import { SnoozeDialog } from "./components/SnoozeMenu";
import { TaskDrawer } from "./components/TaskDrawer";
import { TipProvider } from "./components/ui";
import { useHotkeys } from "./lib/hotkeys";
import { viewportWidth } from "./lib/textSize";
import { InboxPage } from "./pages/Inbox";
import { LearningPage } from "./pages/Learning";
import { PackagesPage } from "./pages/Packages";
import { SettingsPage } from "./pages/Settings";
import { TasksPage } from "./pages/Tasks";
import { TodayPage } from "./pages/Today";
import { useUI } from "./store";

export function App() {
  const { data, error, isLoading } = useData();
  const { setPaletteOpen, setHelpOpen, openTask, chatOpen, setChatOpen, chatWidth, setChatDraft } = useUI();
  const [loc, nav] = useLocation();

  // ?task=<id> opens that task's drawer; ?chat opens the chat; ?ask=<text> opens it with a draft question.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = Number(params.get("task"));
    if (id) openTask(id);
    if (params.has("chat") || params.has("ask")) setChatOpen(true);
    if (params.get("ask")) setChatDraft(params.get("ask")!);
    // Consume the parameters so a reload doesn't repeat them.
    if ([...params.keys()].length) window.history.replaceState(null, "", window.location.pathname);
  }, [openTask, setChatOpen, setChatDraft]);

  useHotkeys({
    "mod+k": () => setPaletteOpen(true),
    "mod+j": () => setChatOpen(!chatOpen),
    "?": () => setHelpOpen(true),
    // On Tasks, C focuses the inline quick-add instead.
    c: () => loc !== "/tasks" && setPaletteOpen(true),
    "g t": () => nav("/"),
    "g i": () => nav("/inbox"),
    "g l": () => nav("/tasks"),
    "g p": () => nav("/packages"),
    "g r": () => nav("/learning"),
    "g s": () => nav("/settings"),
  });

  return (
    <TipProvider>
      <div className="flex h-full">
        <Sidebar data={data} />
        <main className="min-w-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-fg-3">
              <Loader2 className="animate-spin" size={20} />
            </div>
          ) : error || !data ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <CircleAlert className="text-red" />
              <div className="font-medium">Can't reach the Daily Dash server</div>
              <div className="text-[13px] text-fg-3">{String(error)}</div>
            </div>
          ) : (
            <Switch>
              <Route path="/"><TodayPage data={data} /></Route>
              <Route path="/inbox"><InboxPage data={data} /></Route>
              <Route path="/tasks"><TasksPage data={data} /></Route>
              <Route path="/packages"><PackagesPage data={data} /></Route>
              <Route path="/learning"><LearningPage data={data} /></Route>
              <Route path="/settings"><SettingsPage data={data} /></Route>
              <Route><TodayPage data={data} /></Route>
            </Switch>
          )}
        </main>
        <ChatPanel />
      </div>
      <TaskDrawer />
      <DismissDialog />
      <SnoozeDialog />
      <CommandPalette />
      <ShortcutsHelp />
      <Toaster
        position="bottom-right"
        theme="system"
        // Sit left of the chat panel when it's open, so toasts never cover the message box.
        style={chatOpen ? { right: Math.min(chatWidth, Math.max(380, viewportWidth() - 480)) + 24 } : undefined}
        toastOptions={{
          className: "!rounded-xl !border-line !bg-card !text-fg !shadow-pop",
          descriptionClassName: "!text-fg-3",
        }}
      />
    </TipProvider>
  );
}
