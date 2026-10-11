import { describe, expect, it } from "vitest";
import { US_TIME_ZONES, usZoneFor } from "../web/src/timezones";

describe("usZoneFor", () => {
  it("keeps the seven US zones as they are", () => {
    for (const z of US_TIME_ZONES) expect(usZoneFor(z.zone)).toBe(z.zone);
  });

  it("maps a zone with the same clock all year to its US zone", () => {
    expect(usZoneFor("America/Detroit", 2026)).toBe("America/New_York");
    expect(usZoneFor("America/Indiana/Indianapolis", 2026)).toBe("America/New_York");
    expect(usZoneFor("America/Kentucky/Louisville", 2026)).toBe("America/New_York");
    expect(usZoneFor("America/Boise", 2026)).toBe("America/Denver");
    expect(usZoneFor("US/Central", 2026)).toBe("America/Chicago");
  });

  it("has no US zone for one outside the US or an unknown name", () => {
    expect(usZoneFor("Europe/London", 2026)).toBeNull();
    expect(usZoneFor("Asia/Tokyo", 2026)).toBeNull();
    expect(usZoneFor("Mars/Olympus", 2026)).toBeNull();
  });
});
