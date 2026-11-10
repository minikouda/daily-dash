import { useState, type ReactNode } from "react";
import { Button, PopContent, PopRoot, PopTrigger } from "./ui";

/**
 * A small "are you sure?" popover for actions that are easy to misclick and
 * cost a Claude run. `children` is the trigger (must accept a ref, e.g. a button).
 * Yes has focus, so Enter confirms and Esc cancels.
 */
export function ConfirmPop({
  title,
  detail,
  confirmLabel = "Yes",
  onConfirm,
  children,
  align = "end",
}: {
  title: string;
  detail?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  children: ReactNode;
  align?: "start" | "end" | "center";
}) {
  const [open, setOpen] = useState(false);
  return (
    <PopRoot open={open} onOpenChange={setOpen}>
      <PopTrigger asChild>{children}</PopTrigger>
      <PopContent align={align} className="w-64">
        <div className="text-[13.5px] font-medium">{title}</div>
        {detail && <div className="mt-0.5 text-[12.5px] text-fg-3">{detail}</div>}
        <div className="mt-3 flex justify-end gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            No
          </Button>
          <Button size="sm" variant="primary" autoFocus onClick={() => (setOpen(false), onConfirm())}>
            {confirmLabel}
          </Button>
        </div>
      </PopContent>
    </PopRoot>
  );
}
