import * as DialogP from "@radix-ui/react-dialog";
import * as Menu from "@radix-ui/react-dropdown-menu";
import * as PopoverP from "@radix-ui/react-popover";
import * as TooltipP from "@radix-ui/react-tooltip";
import { X } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { Tone } from "../lib/dates";
import { cn } from "../lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "icon";

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }
>(({ variant = "secondary", size = "md", className, ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50",
      size === "md" && "h-8 px-3 text-[13px]",
      size === "sm" && "h-7 px-2.5 text-xs",
      size === "icon" && "h-7 w-7",
      variant === "primary" && "bg-accent text-accent-fg hover:opacity-90",
      variant === "secondary" && "border border-line bg-card text-fg shadow-card hover:bg-hover",
      variant === "ghost" && "text-fg-2 hover:bg-hover hover:text-fg",
      variant === "danger" && "text-red hover:bg-red-soft",
      className,
    )}
    {...props}
  />
));

export const Kbd = ({ children, className }: { children: ReactNode; className?: string }) => (
  <kbd
    className={cn(
      "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-line-strong bg-card px-1 font-mono text-[10.5px] font-medium text-fg-3",
      className,
    )}
  >
    {children}
  </kbd>
);

const TONES: Record<Tone | "neutral" | "accent" | "green" | "blue", string> = {
  overdue: "bg-red-soft text-red",
  today: "bg-amber-soft text-amber",
  soon: "bg-amber-soft text-amber",
  week: "bg-hover text-fg-2",
  later: "bg-hover text-fg-3",
  neutral: "bg-hover text-fg-2",
  accent: "bg-accent-soft text-accent",
  green: "bg-green-soft text-green",
  blue: "bg-blue-soft text-blue",
};

export const Chip = ({
  tone = "neutral",
  children,
  className,
  title,
}: {
  tone?: keyof typeof TONES;
  children: ReactNode;
  className?: string;
  title?: string;
}) => (
  <span
    title={title}
    className={cn("inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-[11.5px] font-medium whitespace-nowrap", TONES[tone], className)}
  >
    {children}
  </span>
);

export function Tip({ label, children, side = "top" }: { label: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <TooltipP.Root delayDuration={350}>
      <TooltipP.Trigger asChild>{children}</TooltipP.Trigger>
      <TooltipP.Portal>
        <TooltipP.Content
          side={side}
          sideOffset={6}
          className="z-50 animate-in rounded-md bg-fg px-2 py-1 text-xs text-bg shadow-pop"
        >
          {label}
        </TooltipP.Content>
      </TooltipP.Portal>
    </TooltipP.Root>
  );
}

export const TipProvider = TooltipP.Provider;

/* Dropdown menu */
export const MenuRoot = Menu.Root;
export const MenuTrigger = Menu.Trigger;

export function MenuContent({
  children,
  align = "end",
  className,
  onKeyDown,
}: {
  children: ReactNode;
  align?: "start" | "end" | "center";
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}) {
  return (
    <Menu.Portal>
      <Menu.Content
        onKeyDown={onKeyDown}
        align={align}
        sideOffset={6}
        className={cn("z-50 min-w-[220px] animate-in rounded-xl border border-line bg-card p-1 shadow-pop", className)}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {children}
      </Menu.Content>
    </Menu.Portal>
  );
}

export function MenuItem({
  children,
  onSelect,
  shortcut,
  icon,
  danger,
}: {
  children: ReactNode;
  onSelect: () => void;
  shortcut?: string;
  icon?: ReactNode;
  danger?: boolean;
}) {
  return (
    <Menu.Item
      onSelect={onSelect}
      className={cn(
        "flex h-8 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[13px] outline-none select-none data-[highlighted]:bg-hover",
        danger ? "text-red" : "text-fg",
      )}
    >
      {icon && <span className="flex w-4 justify-center text-fg-3">{icon}</span>}
      <span className="flex-1">{children}</span>
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </Menu.Item>
  );
}

export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <Menu.Label className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-fg-3 uppercase">{children}</Menu.Label>
);
export const MenuSep = () => <Menu.Separator className="my-1 h-px bg-line" />;

/* Popover */
export const PopRoot = PopoverP.Root;
export const PopTrigger = PopoverP.Trigger;
export const PopAnchor = PopoverP.Anchor;
export function PopContent({ children, className, align = "start" }: { children: ReactNode; className?: string; align?: "start" | "end" | "center" }) {
  return (
    <PopoverP.Portal>
      <PopoverP.Content
        align={align}
        sideOffset={6}
        className={cn("z-50 animate-in rounded-xl border border-line bg-card p-3 shadow-pop", className)}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {children}
      </PopoverP.Content>
    </PopoverP.Portal>
  );
}

/* Centered dialog */
export function Modal({
  open,
  onOpenChange,
  title,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <DialogP.Root open={open} onOpenChange={onOpenChange}>
      <DialogP.Portal>
        <DialogP.Overlay className="fixed inset-0 z-40 bg-black/25 backdrop-blur-[1px]" />
        <DialogP.Content
          className={cn(
            "fixed top-[14vh] left-1/2 z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 animate-in rounded-2xl border border-line bg-card shadow-pop outline-none",
            className,
          )}
          aria-describedby={undefined}
        >
          <DialogP.Title className="sr-only">{title}</DialogP.Title>
          {children}
        </DialogP.Content>
      </DialogP.Portal>
    </DialogP.Root>
  );
}

/* Right-side drawer */
/** Non-modal so the chat panel stays usable; `right` leaves room for a docked panel. */
export function Drawer({
  open,
  onOpenChange,
  title,
  children,
  right = 0,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  children: ReactNode;
  right?: number;
}) {
  return (
    <DialogP.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogP.Portal>
        <DialogP.Content
          aria-describedby={undefined}
          style={{ right }}
          onInteractOutside={(e) => {
            const t = e.target as HTMLElement | null;
            // Clicks in the chat, menus, dialogs or toasts shouldn't close the drawer.
            if (t?.closest("[data-chat-panel], [role=menu], [role=dialog], [data-sonner-toaster]")) e.preventDefault();
          }}
          className="fixed top-0 z-40 flex h-full w-[min(480px,100vw)] animate-drawer flex-col border-l border-line bg-card shadow-pop outline-none"
        >
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
            <DialogP.Title className="text-[13px] font-medium text-fg-3">{title}</DialogP.Title>
            <DialogP.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X size={16} />
              </Button>
            </DialogP.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </DialogP.Content>
      </DialogP.Portal>
    </DialogP.Root>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-hover text-fg-3">{icon}</div>
      <div className="text-[15px] font-medium">{title}</div>
      {children && <div className="mt-1 max-w-sm text-[13px] text-fg-3">{children}</div>}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between px-1">
      <h2 className="text-[12px] font-semibold tracking-wide text-fg-3 uppercase">{children}</h2>
      {right}
    </div>
  );
}

export const Card = ({ children, className }: { children: ReactNode; className?: string }) => (
  <section className={cn("rounded-2xl border border-line bg-card shadow-card", className)}>{children}</section>
);

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "w-full resize-none rounded-lg border border-line bg-bg px-3 py-2 text-[13px] outline-none placeholder:text-fg-3 focus:border-accent",
        props.className,
      )}
    />
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "h-8 w-full rounded-lg border border-line bg-bg px-3 text-[13px] outline-none placeholder:text-fg-3 focus:border-accent",
        props.className,
      )}
    />
  );
}
