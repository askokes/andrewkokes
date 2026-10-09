import { describe, expect, it } from "vitest";
import { addDays, isCalendarDate, isValidTimeZone, localDate } from "../src/dates";

describe("localDate", () => {
  // 2026-03-01 03:30 UTC is still Feb 28 in Chicago and already Mar 1 in Tokyo.
  const instant = new Date("2026-03-01T03:30:00Z");

  it("uses the user's time zone, not UTC", () => {
    expect(localDate("America/Chicago", instant)).toBe("2026-02-28");
    expect(localDate("Asia/Tokyo", instant)).toBe("2026-03-01");
    expect(localDate("UTC", instant)).toBe("2026-03-01");
  });

  it("zero-pads months and days", () => {
    expect(localDate("UTC", new Date("2026-01-05T12:00:00Z"))).toBe("2026-01-05");
  });
});

describe("isValidTimeZone", () => {
  it.each(["America/Chicago", "Europe/London", "UTC"])("accepts %s", (tz) => {
    expect(isValidTimeZone(tz)).toBe(true);
  });
  it.each(["", "Mars/Olympus", "Chicago", "x".repeat(100)])("rejects %j", (tz) => {
    expect(isValidTimeZone(tz)).toBe(false);
  });
});

describe("isCalendarDate", () => {
  it.each(["2026-10-09", "2024-02-29", "2000-01-01"])("accepts %s", (d) => {
    expect(isCalendarDate(d)).toBe(true);
  });
  it.each(["", "2026-02-30", "2025-02-29", "2026-13-01", "2026-1-5", "2026-10-09T00:00:00Z", "today"])(
    "rejects %j",
    (d) => {
      expect(isCalendarDate(d)).toBe(false);
    },
  );
});

describe("addDays", () => {
  it("crosses month and year ends", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
