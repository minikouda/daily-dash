import { BellOff, Copy, EyeOff, ExternalLink, Mail, MoreHorizontal, PackageX, Sparkles, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { useState } from "react";
import Markdown from "react-markdown";
import { toast } from "sonner";
import { useFeedbackAction, type Bootstrap, type Highlight, type Package, type PackageStatus } from "../api";
import { ago, etaInfo, shortDate } from "../lib/dates";
import { carrierName, cn, senderName } from "../lib/utils";
import { Button, Card, Chip, MenuContent, MenuItem, MenuRoot, MenuSep, MenuTrigger, PopContent, PopRoot, PopTrigger, Textarea, Tip } from "./ui";

const STEPS: PackageStatus[] = ["ordered", "shipped", "in_transit", "out_for_delivery", "delivered"];
export const STATUS_LABEL: Record<PackageStatus, string> = {
  ordered: "Ordered",
  shipped: "Shipped",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  exception: "Needs attention",
};

export function PackageCard({ p, compact }: { p: Package; compact?: boolean }) {
  const fb = useFeedbackAction();
  const step = STEPS.indexOf(p.status);
  const eta = etaInfo(p.eta);
  const act = (action: string, message: string) =>
    fb.mutate({ path: `/api/packages/${encodeURIComponent(p.key)}/action`, body: { action }, message });
  const statusTone =
    p.status === "exception" ? "text-red" : p.status === "delivered" ? "text-green" : p.status === "out_for_delivery" ? "text-amber" : "text-fg";

  return (
    <div className={cn("group rounded-xl border border-line bg-card p-3.5 shadow-card", p.archived && "opacity-60")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium">{p.description || "Package"}</div>
          <div className="mt-0.5 truncate text-[12.5px] text-fg-3">
            {p.merchant}
            {p.carrier && p.merchant !== carrierName(p.carrier) && <> · {carrierName(p.carrier)}</>}
          </div>
        </div>
        <div className="text-right">
          <div className={cn("text-[13px] font-semibold", statusTone)}>{STATUS_LABEL[p.status]}</div>
          {p.status === "delivered" ? (
            p.delivered_at && <div className="text-[12px] text-fg-3">{ago(p.delivered_at)}</div>
          ) : (
            eta && (
              <div className={cn("text-[12px]", eta.tone === "today" ? "font-medium text-amber" : "text-fg-3")}>
                {eta.tone === "overdue" ? eta.label : `Arrives ${eta.tone === "today" || eta.tone === "soon" ? eta.label.toLowerCase() : eta.label}`}
              </div>
            )
          )}
        </div>
      </div>

      {p.status !== "exception" && (
        <div className="mt-3 flex gap-1" aria-label={STATUS_LABEL[p.status]}>
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={cn(
                "h-1 flex-1 rounded-full",
                i <= step ? (p.status === "delivered" ? "bg-green" : "bg-accent") : "bg-line",
                i === step && p.status !== "delivered" && "animate-pulse",
              )}
            />
          ))}
        </div>
      )}

      {!compact && (
        <div className="mt-3 flex items-center gap-1.5 text-[12px]">
          {p.tracking_number && (
            <Tip label="Copy tracking number">
              <button
                onClick={() => (navigator.clipboard.writeText(p.tracking_number!), toast("Copied tracking number"))}
                className="flex items-center gap-1 rounded-md bg-hover px-1.5 py-0.5 font-mono text-[11.5px] text-fg-2 hover:text-fg"
              >
                {p.tracking_number} <Copy size={11} />
              </button>
            </Tip>
          )}
          {!p.tracking_number && p.order_number && <span className="font-mono text-[11.5px] text-fg-3">Order {p.order_number}</span>}
          <span className="flex-1" />
          {p.tracking_url && (
            <a href={p.tracking_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-accent hover:bg-accent-soft">
              Track <ExternalLink size={11} />
            </a>
          )}
          <MenuRoot>
            <MenuTrigger asChild>
              <Button size="icon" variant="ghost" aria-label="More" className="h-6 w-6">
                <MoreHorizontal size={14} />
              </Button>
            </MenuTrigger>
            <MenuContent>
              {p.source?.link && (
                <MenuItem icon={<Mail size={14} />} onSelect={() => window.open(p.source!.link!, "_blank")}>
                  Open email
                </MenuItem>
              )}
              {p.archived ? (
                <MenuItem icon={<EyeOff size={14} />} onSelect={() => act("unhide", "Package restored")}>Show again</MenuItem>
              ) : (
                <MenuItem icon={<EyeOff size={14} />} onSelect={() => act("hide", "Package hidden")}>Hide</MenuItem>
              )}
              <MenuSep />
              <MenuItem icon={<PackageX size={14} />} danger onSelect={() => act("not_package", "Removed — Claude will learn this isn't a shipment")}>
                Not a package
              </MenuItem>
            </MenuContent>
          </MenuRoot>
        </div>
      )}
    </div>
  );
}

export function HighlightRow({ h }: { h: Highlight }) {
  const fb = useFeedbackAction();
  const act = (action: string, message: string) => fb.mutate({ path: `/api/highlights/${h.id}/action`, body: { action }, message });
  return (
    <div className="group flex items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-hover/60">
      <span className={cn("mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full", h.rating === "useful" ? "bg-green" : "bg-fg-3/50")} />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-[450]">{h.headline}</div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12.5px] text-fg-3">
          {h.source?.sender && <span className="shrink-0">{senderName(h.source.sender)}</span>}
          {h.why && <span className="truncate">· {h.why}</span>}
        </div>
      </div>
      <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
        {h.source?.link && (
          <Tip label="Open in Gmail">
            <a href={h.source.link} target="_blank" rel="noreferrer" className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-3 hover:bg-hover hover:text-fg">
              <ExternalLink size={14} />
            </a>
          </Tip>
        )}
        <Tip label="Useful — more like this">
          <Button size="icon" variant="ghost" aria-label="Useful" onClick={() => act("useful", "Noted — more like this")}>
            <ThumbsUp size={14} className={h.rating === "useful" ? "text-green" : undefined} />
          </Button>
        </Tip>
        <MenuRoot>
          <MenuTrigger asChild>
            <Button size="icon" variant="ghost" aria-label="Not useful">
              <X size={15} />
            </Button>
          </MenuTrigger>
          <MenuContent>
            <MenuItem icon={<EyeOff size={14} />} onSelect={() => act("dismiss", "Hidden")}>Hide (read it)</MenuItem>
            <MenuItem icon={<ThumbsDown size={14} />} onSelect={() => act("not_important", "Noted — fewer like this")}>Not worth highlighting</MenuItem>
            {h.source?.sender_email && (
              <MenuItem icon={<BellOff size={14} />} danger onSelect={() => act("mute_sender", `Muted ${h.source!.sender_email}`)}>
                Mute {senderName(h.source.sender)}
              </MenuItem>
            )}
          </MenuContent>
        </MenuRoot>
      </div>
    </div>
  );
}

export function BriefingCard({ briefing }: { briefing: NonNullable<Bootstrap["briefing"]> }) {
  const fb = useFeedbackAction();
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const vote = (v: "up" | "down", n?: string) =>
    fb.mutate({ path: `/api/briefings/${briefing.id}/vote`, body: { vote: v, note: n }, message: v === "up" ? "Thanks — noted" : "Got it — Claude will adjust" });
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles size={15} className="text-accent" />
        <span className="text-[13px] font-semibold">Morning briefing</span>
        <span className="text-[12px] text-fg-3">· {shortDate(briefing.created_at)}</span>
        <span className="ml-auto flex items-center gap-0.5">
          <Tip label="Helpful">
            <Button size="icon" variant="ghost" aria-label="Helpful" onClick={() => vote("up")}>
              <ThumbsUp size={14} className={briefing.vote === "up" ? "text-green" : undefined} />
            </Button>
          </Tip>
          <PopRoot open={open} onOpenChange={setOpen}>
            <PopTrigger asChild>
              <Button size="icon" variant="ghost" aria-label="Not helpful">
                <ThumbsDown size={14} className={briefing.vote === "down" ? "text-red" : undefined} />
              </Button>
            </PopTrigger>
            <PopContent align="end" className="w-80">
              <div className="mb-2 text-[13px] font-medium">What should the briefing do differently?</div>
              <Textarea rows={3} value={note} autoFocus onChange={(e) => setNote(e.target.value)} placeholder="e.g. Shorter. Don't list job rejections." />
              <div className="mt-2 flex justify-end">
                <Button size="sm" variant="primary" onClick={() => (vote("down", note || undefined), setOpen(false), setNote(""))}>
                  Send to Claude
                </Button>
              </div>
            </PopContent>
          </PopRoot>
        </span>
      </div>
      <div className="prose-brief text-[14px] leading-relaxed text-fg-2">
        <Markdown>{briefing.body}</Markdown>
      </div>
    </Card>
  );
}

export const Count = ({ n, label, tone }: { n: number; label: string; tone?: "red" | "amber" | "accent" }) => (
  <Chip tone={tone === "red" ? "overdue" : tone === "amber" ? "today" : tone === "accent" ? "accent" : "neutral"} className="h-6 px-2 text-[12.5px]">
    <span className="font-semibold tabular-nums">{n}</span> {label}
  </Chip>
);
