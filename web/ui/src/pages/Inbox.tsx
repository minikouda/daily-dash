import { CheckCheck, PartyPopper } from "lucide-react";
import { Link } from "wouter";
import { usePost, type Bootstrap } from "../api";
import { TaskList } from "../components/TaskList";
import { Button, Card, Empty, Kbd } from "../components/ui";
import { bucketOf, sortByDue } from "../lib/dates";

export function InboxPage({ data }: { data: Bootstrap }) {
  const post = usePost();
  const items = sortByDue(data.tasks.filter((t) => t.status === "inbox"));
  const dated = items.filter((t) => t.due && ["Overdue", "Today", "Tomorrow", "This week"].includes(bucketOf(t.due)));
  const later = items.filter((t) => !dated.includes(t));
  const pendingFeedback = data.learn.pending;

  return (
    <div className="mx-auto max-w-[820px] px-8 py-8">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight">Inbox</h1>
          <p className="mt-1 max-w-[520px] text-[13.5px] text-fg-2">
            Everything Claude found in your email lands here first. Keep what matters; dismiss the rest with a reason, and Claude
            learns from it.
          </p>
        </div>
        {items.length > 1 && (
          <Button disabled={post.isPending} onClick={() => post.mutate({ path: "/api/inbox/keep-all", message: `Kept ${items.length} items` })}>
            <CheckCheck size={14} /> Keep all {items.length}
          </Button>
        )}
      </header>

      {items.length ? (
        <>
          <TaskList
            variant="inbox"
            sections={[
              { title: "Due this week", tasks: dated },
              { title: "Later or no date", tasks: later },
            ]}
          />
          <div className="sticky bottom-4 mt-8 flex justify-center">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-line bg-card/95 px-4 py-2 text-[12px] text-fg-3 shadow-pop backdrop-blur">
              <span><Kbd>J</Kbd> <Kbd>K</Kbd> move</span>
              <span><Kbd>Y</Kbd> keep</span>
              <span><Kbd>E</Kbd> done</span>
              <span><Kbd>X</Kbd> dismiss</span>
              <span><Kbd>⇧X</Kbd> dismiss + why</span>
              <span><Kbd>S</Kbd> snooze</span>
              <span><Kbd>↵</Kbd> details &amp; edit</span>
            </div>
          </div>
        </>
      ) : (
        <Card>
          <Empty icon={<PartyPopper size={20} />} title="Inbox zero">
            New items appear here after each mail check.
            {pendingFeedback > 0 && (
              <>
                {" "}You've given {pendingFeedback} pieces of feedback since Claude last reviewed —{" "}
                <Link href="/learning" className="text-accent">see what it learned</Link>.
              </>
            )}
          </Empty>
        </Card>
      )}
    </div>
  );
}
