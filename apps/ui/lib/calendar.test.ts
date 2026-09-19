import { describe, expect, it } from "vitest";
import { calendarFallback, filterCalendarItems, itemsForDay, monthDays, normalizeCalendarView, shiftAnchor, startOfWeek, weekDays } from "./calendar";

describe("Kairo UI v2 Calendar behavior", () => {
  it("supports the approved persistent views", () => {
    expect(normalizeCalendarView("month")).toBe("month");
    expect(normalizeCalendarView("list")).toBe("list");
    expect(normalizeCalendarView("unknown")).toBe("week");
  });

  it("builds Monday-first week and six-row month ranges", () => {
    const anchor = new Date("2026-09-02T12:00:00Z");
    expect(startOfWeek(anchor).toISOString().slice(0, 10)).toBe("2026-08-31");
    expect(weekDays(anchor)).toHaveLength(7);
    expect(monthDays(anchor)).toHaveLength(42);
  });

  it("filters channels and returns scheduled items for a day", () => {
    const items = calendarFallback();
    expect(filterCalendarItems(items, "LinkedIn", "all").every((item) => item.channel === "LinkedIn")).toBe(true);
    expect(itemsForDay(items, new Date("2026-08-31T00:00:00Z"))).toHaveLength(1);
  });

  it("moves week and month anchors correctly", () => {
    expect(shiftAnchor(new Date("2026-08-31T00:00:00Z"), "week", 1).toISOString().slice(0, 10)).toBe("2026-09-07");
    expect(shiftAnchor(new Date("2026-08-31T00:00:00Z"), "month", 1).getUTCMonth()).toBe(8);
  });
});

