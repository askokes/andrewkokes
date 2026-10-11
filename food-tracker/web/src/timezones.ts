// The time zones the app offers: the seven US ones, by the names people use.

export const US_TIME_ZONES = [
  { zone: "America/New_York", label: "Eastern (New York)" },
  { zone: "America/Chicago", label: "Central (Chicago)" },
  { zone: "America/Denver", label: "Mountain (Denver)" },
  { zone: "America/Phoenix", label: "Arizona (no daylight saving)" },
  { zone: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { zone: "America/Anchorage", label: "Alaska" },
  { zone: "Pacific/Honolulu", label: "Hawaii" },
] as const;

/** Minutes ahead of UTC in `zone` at `at`, or null if the zone is unknown. */
function offsetAt(zone: string, at: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    }).formatToParts(at);
    const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const local = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"));
    return Math.round((local - at.getTime()) / 60000);
  } catch {
    return null;
  }
}

/**
 * The US zone a phone's zone keeps the same clock as, winter and summer ("America/Detroit" is Eastern,
 * "America/Boise" Mountain), or null for a zone outside the US.
 */
export function usZoneFor(zone: string, year = new Date().getUTCFullYear()): string | null {
  if (US_TIME_ZONES.some((z) => z.zone === zone)) return zone;
  const dates = [new Date(Date.UTC(year, 0, 15, 12)), new Date(Date.UTC(year, 6, 15, 12))];
  const clock = (z: string) => dates.map((d) => offsetAt(z, d));
  const theirs = clock(zone);
  if (theirs.includes(null)) return null;
  return US_TIME_ZONES.find((z) => clock(z.zone).every((o, i) => o === theirs[i]))?.zone ?? null;
}
