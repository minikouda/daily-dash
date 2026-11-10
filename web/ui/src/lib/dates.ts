import * as chrono from "chrono-node";
import {
  addDays,
  differenceInCalendarDays,
  endOfDay,
  format,
  formatDistanceToNowStrict,
  formatISO,
  isSameYear,
  nextSaturday,
  parseISO,
  set,
  startOfDay,
} from "date-fns";

/** Due values are "YYYY-MM-DD" (date only) or an ISO datetime with offset. */
export const isDateOnly = (due: string) => due.length === 10;

export function dueDate(due: string): Date {
  // Date-only items are due at the end of that local day.
  return isDateOnly(due) ? endOfDay(parseISO(due)) : parseISO(due);
}

export type Tone = "overdue" | "today" | "soon" | "week" | "later";

export function dueInfo(due: string | null, now = new Date()): { label: string; tone: Tone; long: string } | null {
  if (!due) return null;
  const d = dueDate(due);
  const days = differenceInCalendarDays(d, now);
  const time = isDateOnly(due) ? "" : format(d, d.getMinutes() ? "h:mm a" : "h a");
  const long = format(d, isSameYear(d, now) ? "EEEE, MMM d" : "EEEE, MMM d, yyyy") + (time ? ` · ${time}` : "");
  if (d < now) {
    const label = days === 0 ? `Overdue${time ? ` · ${time}` : ""}` : `${-days}d overdue`;
    return { label, tone: "overdue", long };
  }
  if (days === 0) return { label: time ? `Today ${time}` : "Today", tone: "today", long };
  if (days === 1) return { label: time ? `Tomorrow ${time}` : "Tomorrow", tone: "soon", long };
  if (days < 7) return { label: format(d, "EEE") + (time ? ` ${time}` : ""), tone: "week", long };
  return { label: format(d, isSameYear(d, now) ? "MMM d" : "MMM d, yyyy"), tone: "later", long };
}

export const BUCKETS = ["Overdue", "Today", "Tomorrow", "This week", "Later", "No date"] as const;
export type Bucket = (typeof BUCKETS)[number];

export function bucketOf(due: string | null, now = new Date()): Bucket {
  if (!due) return "No date";
  const d = dueDate(due);
  if (d < now) return "Overdue";
  const days = differenceInCalendarDays(d, now);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7) return "This week";
  return "Later";
}

export function sortByDue<T extends { due: string | null; priority: number; id: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const da = a.due ? dueDate(a.due).getTime() : Infinity;
    const db = b.due ? dueDate(b.due).getTime() : Infinity;
    return da - db || a.priority - b.priority || b.id - a.id;
  });
}

/** Encode a picked date back into a due value. */
export function toDue(d: Date, withTime: boolean): string {
  return withTime ? formatISO(d) : format(d, "yyyy-MM-dd");
}

/** Natural-language date inside free text: "pay rent fri 5pm" -> title + due. */
export function parseQuick(text: string, ref = new Date()): { title: string; due: string | null; label: string | null } {
  const results = chrono.parse(text, ref, { forwardDate: true });
  const r = results[results.length - 1];
  if (!r) return { title: text.trim(), due: null, label: null };
  const hasTime = r.start.isCertain("hour");
  const date = r.start.date();
  const title = (text.slice(0, r.index) + text.slice(r.index + r.text.length)).replace(/\s{2,}/g, " ").trim();
  const due = toDue(date, hasTime);
  return { title: title || text.trim(), due, label: dueInfo(due, ref)?.long ?? null };
}

/** Parse a due typed into a date field ("next tue", "nov 12 3pm", "2026-11-12"). */
export function parseDueInput(text: string, ref = new Date()): string | null {
  const t = text.trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const r = chrono.parse(t, ref, { forwardDate: true })[0];
  return r ? toDue(r.start.date(), r.start.isCertain("hour")) : null;
}

export type SnoozeOption = { key: string; label: string; hint: string; until: Date };

export function snoozeOptions(now = new Date()): SnoozeOption[] {
  const at8 = (d: Date) => set(startOfDay(d), { hours: 8 });
  const tomorrow = at8(addDays(now, 1));
  const weekend = at8(nextSaturday(now));
  const nextWeek = at8(addDays(startOfDay(now), ((8 - now.getDay()) % 7) || 7));
  return [
    { key: "1", label: "Tomorrow", hint: format(tomorrow, "EEE h a"), until: tomorrow },
    { key: "2", label: "This weekend", hint: format(weekend, "EEE h a"), until: weekend },
    { key: "3", label: "Next week", hint: format(nextWeek, "EEE MMM d"), until: nextWeek },
    { key: "4", label: "In a month", hint: format(at8(addDays(now, 30)), "MMM d"), until: at8(addDays(now, 30)) },
  ];
}

export const ago = (iso: string | null | undefined) =>
  iso ? formatDistanceToNowStrict(parseISO(iso), { addSuffix: true }) : "never";

export const shortDate = (iso: string) => {
  const d = parseISO(iso);
  return format(d, isSameYear(d, new Date()) ? "MMM d, h:mm a" : "MMM d, yyyy");
};

export function etaInfo(eta: string | null, now = new Date()): { label: string; tone: Tone } | null {
  if (!eta) return null;
  const d = parseISO(eta.slice(0, 10));
  const days = differenceInCalendarDays(d, now);
  if (days < 0) return { label: `was due ${format(d, "EEE")}`, tone: "overdue" };
  if (days === 0) return { label: "Today", tone: "today" };
  if (days === 1) return { label: "Tomorrow", tone: "soon" };
  if (days < 7) return { label: format(d, "EEEE"), tone: "week" };
  return { label: format(d, "MMM d"), tone: "later" };
}
