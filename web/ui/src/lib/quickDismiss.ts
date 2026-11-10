import { toast } from "sonner";
import { useTriage, useUndo, type Task } from "../api";
import { useUI } from "../store";

/** Dismiss without asking why. The toast offers Undo, or "Why?" to add a reason after all. */
export function useQuickDismiss() {
  const triage = useTriage();
  const undo = useUndo();
  const { askDismiss } = useUI();
  return (task: Task) =>
    triage.mutate(
      { id: task.id, action: "dismiss", silent: true },
      {
        onSuccess: (res) =>
          toast("Dismissed", {
            description: task.title,
            action: { label: "Undo", onClick: () => undo.mutate(res.feedback_id) },
            cancel: { label: "Why?", onClick: () => askDismiss(task, res.feedback_id) },
          }),
      },
    );
}
