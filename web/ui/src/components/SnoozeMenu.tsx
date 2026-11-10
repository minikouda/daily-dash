import { AlarmClock } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTriage } from "../api";
import { snoozeOptions } from "../lib/dates";
import { cn } from "../lib/utils";
import { useUI } from "../store";
import { Kbd, MenuContent, MenuItem, MenuLabel, MenuRoot, MenuTrigger, Modal } from "./ui";

/** Keyboard-driven snooze picker (opened with S from any list). */
export function SnoozeDialog() {
  const { snoozing, askSnooze } = useUI();
  const triage = useTriage();
  const [sel, setSel] = useState(0);
  const options = snoozeOptions();
  const pick = (i: number) => {
    if (snoozing) triage.mutate({ id: snoozing.id, action: "snooze", until: options[i].until.toISOString() });
    askSnooze(null);
    setSel(0);
  };
  return (
    <Modal open={!!snoozing} onOpenChange={(o) => !o && askSnooze(null)} title="Snooze" className="w-[min(380px,calc(100vw-32px))]">
      <div
        tabIndex={0}
        autoFocus
        className="outline-none"
        onKeyDown={(e) => {
          const i = options.findIndex((o) => o.key === e.key);
          if (i >= 0) return (e.preventDefault(), pick(i));
          if (e.key === "ArrowDown" || e.key === "j") (e.preventDefault(), setSel((s) => Math.min(s + 1, options.length - 1)));
          if (e.key === "ArrowUp" || e.key === "k") (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)));
          if (e.key === "Enter") (e.preventDefault(), pick(sel));
        }}
      >
        <div className="border-b border-line px-4 pt-3.5 pb-3">
          <div className="text-[12px] font-medium text-fg-3">Snooze until</div>
          <div className="truncate text-[14px] font-medium">{snoozing?.title}</div>
        </div>
        <div className="p-1.5">
          {options.map((o, i) => (
            <button
              key={o.key}
              onMouseEnter={() => setSel(i)}
              onClick={() => pick(i)}
              className={cn("flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-[13.5px]", sel === i && "bg-hover")}
            >
              <AlarmClock size={14} className="text-fg-3" />
              <span className="flex-1">{o.label}</span>
              <span className="text-[12px] text-fg-3">{o.hint}</span>
              <Kbd>{o.key}</Kbd>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/** Snooze presets; number keys 1-4 pick one while the menu is open. */
export function SnoozeMenu({
  taskId,
  children,
  open: openProp,
  onOpenChange,
}: {
  taskId: number;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}) {
  const triage = useTriage();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const options = snoozeOptions();
  const pick = (until: Date) => {
    triage.mutate({ id: taskId, action: "snooze", until: until.toISOString() });
    setOpen(false);
  };
  return (
    <MenuRoot open={open} onOpenChange={setOpen}>
      <MenuTrigger asChild>{children}</MenuTrigger>
      <MenuContent
        onKeyDown={(e) => {
          const o = options.find((x) => x.key === e.key);
          if (o) {
            e.preventDefault();
            pick(o.until);
          }
        }}
      >
        <MenuLabel>Snooze until</MenuLabel>
        {options.map((o) => (
          <MenuItem key={o.key} shortcut={o.key} icon={<AlarmClock size={14} />} onSelect={() => pick(o.until)}>
            <span>{o.label}</span>
            <span className="ml-2 text-[12px] text-fg-3">{o.hint}</span>
          </MenuItem>
        ))}
      </MenuContent>
    </MenuRoot>
  );
}
