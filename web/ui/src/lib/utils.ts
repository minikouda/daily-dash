import { clsx, type ClassValue } from "clsx";

export const cn = (...v: ClassValue[]) => clsx(v);

export function senderName(sender: string | null | undefined): string {
  if (!sender) return "";
  const m = sender.match(/^\s*"?([^"<]+?)"?\s*</);
  return (m ? m[1] : sender.replace(/<.*>/, "")).trim() || sender;
}

const CARRIERS: Record<string, string> = {
  ups: "UPS", usps: "USPS", fedex: "FedEx", dhl: "DHL", amazon: "Amazon", ontrac: "OnTrac", lasership: "LaserShip",
};
export const carrierName = (c: string | null) => (c ? CARRIERS[c] ?? c.toUpperCase() : "");

export const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
};
