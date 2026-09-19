import type { PublishCommandView } from "./api";
import { contentFallback, type ContentItem } from "./content";

export type CalendarView = "month" | "week" | "list";
export type CalendarChannel = "all" | ContentItem["channel"];

export type CalendarItem = ContentItem & {
  scheduledAt: string | null;
};

const fixtureDates = [
  "2026-08-31T10:00:00Z",
  "2026-09-01T12:00:00Z",
  "2026-09-02T09:00:00Z",
  "2026-09-03T14:00:00Z",
  "2026-09-04T11:00:00Z",
  "2026-09-05T15:00:00Z",
];

export function calendarFallback(): CalendarItem[] {
  const source = contentFallback();
  const expanded = [
    ...source,
    { ...source[1]!, id: "content-five", title: "Three Scenic Stops Worth Saving", channel: "LinkedIn" as const, image: "/malta-drive.webp" },
    { ...source[2]!, id: "content-six", title: "Weekend Car Hire Offer", channel: "Facebook" as const, image: "/malta-car.webp" },
    { ...source[0]!, id: "content-seven", title: "Malta Road Trip Checklist", channel: "Instagram" as const, image: "/car-keys.webp" },
    { ...source[3]!, id: "content-eight", title: "Valletta Travel Tips", channel: "LinkedIn" as const, image: "/malta-harbour.webp" },
    { ...source[1]!, id: "content-nine", title: "Hidden Gems of Gozo", channel: "Facebook" as const, image: "/malta-drive.webp" },
  ];
  return expanded.map((item, index) => ({ ...item, media: [...item.media], scheduledAt: index < 6 ? fixtureDates[index]! : null }));
}

export function toCalendarItems(items: ContentItem[], commands: PublishCommandView[]): CalendarItem[] {
  const latest = new Map<string, PublishCommandView>();
  for (const command of [...commands].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) latest.set(command.assetId, command);
  return items.map((item) => {
    const command = latest.get(item.id);
    const scheduledAt = command && !["cancelled", "failed"].includes(command.status) ? command.scheduledFor : null;
    return { ...item, media: [...item.media], scheduledAt };
  });
}

export function normalizeCalendarView(value: string | null | undefined): CalendarView {
  return value === "month" || value === "list" ? value : "week";
}

export function startOfWeek(value: Date): Date {
  const date = new Date(value);
  const day = date.getUTCDay();
  const distance = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + distance);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

export function weekDays(value: Date): Date[] {
  const start = startOfWeek(value);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return date;
  });
}

export function monthDays(value: Date): Date[] {
  const first = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return date;
  });
}

export function shiftAnchor(value: Date, view: CalendarView, direction: -1 | 1): Date {
  const next = new Date(value);
  if (view === "month") {
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + direction);
  }
  else next.setUTCDate(next.getUTCDate() + (7 * direction));
  return next;
}

export function filterCalendarItems(items: CalendarItem[], channel: CalendarChannel, campaign: string): CalendarItem[] {
  return items.filter((item) => (channel === "all" || item.channel === channel) && (campaign === "all" || item.campaignId === campaign));
}

export function itemsForDay(items: CalendarItem[], date: Date): CalendarItem[] {
  const key = dateKey(date);
  return items.filter((item) => item.scheduledAt && dateKey(new Date(item.scheduledAt)) === key).sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));
}

export function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function rangeLabel(value: Date, view: CalendarView): string {
  if (view === "month") return new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(value);
  const days = weekDays(value);
  const start = days[0]!;
  const end = days[6]!;
  const startLabel = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(start);
  const endLabel = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(end);
  return `${startLabel} – ${endLabel}`;
}
