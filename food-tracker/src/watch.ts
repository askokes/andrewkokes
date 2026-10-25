// Apple Watch activity: the day's calories burned and steps, sent by an Apple
// Shortcut on the person's iPhone. Apple keeps Health data on the phone with no
// web API, so the Shortcut reads the day's totals from the Health app and posts
// them here with the person's sync key.
//
// Access lets this one path through without signing in (scripts/cloudflare.mjs),
// so the key is all the sign-in it has: random, shown once, and stored only as
// a SHA-256 hash. It can add a day's activity and nothing else.
import { Hono, type Context } from "hono";
import { addDays, isCalendarDate, localDate } from "./dates";
import type { AppEnv } from "./env";
import type { WatchDay, WatchKeyResponse, WatchStatus } from "./food/types";
import { getUser, noProfile, type UserRow } from "./profile";
import { isObject } from "./validate";

export const WATCH_SYNC_PATH = "/api/watch/sync";
/** A sync is a few short fields. */
const MAX_SYNC_BYTES = 4096;

/** The most a day can hold, past which the Shortcut is sending the wrong thing. */
export const WATCH_LIMITS = { active: 10_000, resting: 5_000, steps: 200_000 } as const;
type Field = keyof typeof WATCH_LIMITS;
const LABELS: Record<Field, string> = { active: "active calories", resting: "resting calories", steps: "steps" };

/** 24 random bytes, URL-safe: 32 characters to paste into the Shortcut. */
export function newSyncKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashSyncKey(key: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A number as a Shortcut sends it: a number, text such as "612 kcal" or
 * "8,412", or a list (samples that weren't grouped by day, or several lines
 * of text), which is added up. undefined when nothing was sent, NaN when it
 * isn't a number at all.
 */
export function readAmount(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? raw : NaN;
  const parts = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/\r?\n/) : null;
  if (!parts) return NaN;
  if (typeof raw === "string" && parts.length === 1) {
    const text = raw.trim();
    if (!text) return undefined;
    const match = /^\d[\d,]*(?:\.\d+)?/.exec(text);
    if (!match || /^\d+,\d{1,2}(?!\d)/.test(text)) return NaN;
    return Number(match[0].replace(/,/g, ""));
  }
  let total: number | undefined;
  for (const part of parts) {
    const n = readAmount(part);
    if (n === undefined) continue;
    total = (total ?? 0) + n;
  }
  return total;
}

type Values = Partial<Record<Field, number>>;
/** Most days one sync may carry (the iPhone app sends the last week). */
export const MAX_SYNC_DAYS = 14;
type SyncInput =
  | { ok: true; key: string; values: Values; yesterday: Values; days: { date: string; values: Values }[] }
  | { ok: false; status: 400 | 401; message: string };

/** One day's fields, from the Shortcut's flat body or a `days` entry. */
function readValues(from: Record<string, unknown>, prefix: string, where: string): { ok: true; values: Values } | { ok: false; message: string } {
  const values: Values = {};
  for (const f of Object.keys(WATCH_LIMITS) as Field[]) {
    const field = `${prefix}${f}`;
    const n = readAmount(from[field]);
    if (n === undefined) continue;
    if (Number.isNaN(n)) return { ok: false, message: `The ${where}${field} field should be a number, like ${f === "steps" ? "8412" : "612"}.` };
    if (n > WATCH_LIMITS[f]) return { ok: false, message: `${Math.round(n).toLocaleString("en-US")} ${LABELS[f]} is more than a day can hold. Check the Shortcut's ${where}${field} field.` };
    values[f] = Math.round(n);
  }
  return { ok: true, values };
}

export function parseSync(body: unknown): SyncInput {
  if (!isObject(body)) return { ok: false, status: 400, message: "The Shortcut didn't send JSON. Set its Request Body to JSON." };
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(key)) {
    return { ok: false, status: 401, message: "The Shortcut needs your sync key in a field named key. It's on the Goals tab under Apple Watch." };
  }
  // Today's totals so far, and (optionally) yesterday's whole day in yesterday_active and so on, so a
  // day the Shortcut didn't run, or last ran before bedtime, still ends up complete.
  const today = readValues(body, "", "");
  if (!today.ok) return { ok: false, status: 400, message: today.message };
  const yesterday = readValues(body, "yesterday_", "");
  if (!yesterday.ok) return { ok: false, status: 400, message: yesterday.message };
  // The iPhone app instead sends whole days by date: `days: [{ date, active, resting, steps }]`.
  const days: { date: string; values: Values }[] = [];
  if (body.days !== undefined) {
    if (!Array.isArray(body.days) || body.days.length > MAX_SYNC_DAYS) {
      return { ok: false, status: 400, message: `days should be a list of up to ${MAX_SYNC_DAYS} days.` };
    }
    for (const d of body.days) {
      if (!isObject(d) || typeof d.date !== "string" || !isCalendarDate(d.date)) return { ok: false, status: 400, message: "Each day needs a date like 2026-10-22." };
      const read = readValues(d, "", `${d.date} `);
      if (!read.ok) return { ok: false, status: 400, message: read.message };
      if (Object.keys(read.values).length) days.push({ date: d.date, values: read.values });
    }
  }
  if (!Object.keys(today.values).length && !Object.keys(yesterday.values).length && !days.length) {
    return { ok: false, status: 400, message: "Nothing to sync. The Shortcut's fields should be named active, resting and steps." };
  }
  return { ok: true, key, values: today.values, yesterday: yesterday.values, days };
}

/** The line the Shortcut can show when it's done. */
export function syncedText(values: Values, yesterday: Values = {}) {
  const list = (v: Values) =>
    (Object.keys(WATCH_LIMITS) as Field[])
      .filter((f) => v[f] !== undefined)
      .map((f) => `${v[f]!.toLocaleString("en-US")} ${f === "steps" ? "steps" : `${f} cal`}`)
      .join(", ");
  const lines = [];
  if (Object.keys(values).length) lines.push(`Synced today: ${list(values)}.`);
  if (Object.keys(yesterday).length) lines.push(`Yesterday: ${list(yesterday)}.`);
  return lines.join(" ");
}

/**
 * POST /api/watch/sync from the Shortcut. Plain text answers, so the Shortcut
 * can show them as they are. Outside the signed-in API: no Access token, no
 * cookies, just the key in the body.
 */
export async function watchSync(c: Context<AppEnv>) {
  c.header("Cache-Control", "no-store");
  if (Number(c.req.header("Content-Length") ?? 0) > MAX_SYNC_BYTES) return c.text("That's too much to sync at once.", 413);
  const raw = await c.req.text();
  if (raw.length > MAX_SYNC_BYTES) return c.text("That's too much to sync at once.", 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    body = undefined;
  }
  const input = parseSync(body);
  if (!input.ok) return c.text(input.message, input.status);

  const db = c.env.DB;
  const user = await db
    .prepare("SELECT id, timezone FROM users WHERE watch_key_hash = ?")
    .bind(await hashSyncKey(input.key))
    .first<{ id: number; timezone: string }>();
  if (!user) return c.text("That sync key isn't right. Make a new one on the Goals tab under Apple Watch and paste it into the Shortcut.", 401);

  // A field that wasn't sent keeps what it had. A zero never replaces a real
  // number: that's what an unreadable Health app gives, and the day's totals
  // only ever go up.
  const keep = (col: string) =>
    `${col} = CASE WHEN excluded.${col} IS NULL OR (excluded.${col} = 0 AND ${col} > 0) THEN ${col} ELSE excluded.${col} END`;
  const upsert = db.prepare(
    `INSERT INTO watch_days (user_id, log_date, active_kcal, resting_kcal, steps, synced_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, log_date) DO UPDATE SET
       ${keep("active_kcal")}, ${keep("resting_kcal")}, ${keep("steps")}, synced_at = excluded.synced_at`,
  );
  const today = localDate(user.timezone);
  const now = new Date().toISOString();
  // Dated days count only from two weeks back to tomorrow (a phone a time zone ahead); others are skipped.
  const earliest = addDays(today, -(MAX_SYNC_DAYS - 1));
  const latest = addDays(today, 1);
  const dated = input.days.filter((d) => d.date >= earliest && d.date <= latest);
  const writes: [string, Values][] = [
    [today, input.values],
    [addDays(today, -1), input.yesterday],
    ...dated.map((d): [string, Values] => [d.date, d.values]),
  ];
  const statements = writes
    .filter(([, v]) => Object.keys(v).length > 0)
    .map(([date, v]) => upsert.bind(user.id, date, v.active ?? null, v.resting ?? null, v.steps ?? null, now));
  if (statements.length) await db.batch(statements);
  const text = syncedText(input.values, input.yesterday);
  if (!input.days.length) return c.text(text);
  const days = `Synced ${dated.length} ${dated.length === 1 ? "day" : "days"}.`;
  return c.text(text ? `${text} ${days}` : days);
}

interface WatchRow {
  log_date: string;
  active_kcal: number | null;
  resting_kcal: number | null;
  steps: number | null;
  synced_at: string;
}

const watchDay = (r: WatchRow): WatchDay => ({ activeKcal: r.active_kcal, restingKcal: r.resting_kcal, steps: r.steps, syncedAt: r.synced_at });

/** Each day's Watch activity from `from` to `to`, by date. */
export async function watchDaysBetween(db: D1Database, userId: number, from: string, to: string) {
  const { results } = await db
    .prepare("SELECT log_date, active_kcal, resting_kcal, steps, synced_at FROM watch_days WHERE user_id = ? AND log_date BETWEEN ? AND ?")
    .bind(userId, from, to)
    .all<WatchRow>();
  return new Map(results.map((r) => [r.log_date, watchDay(r)]));
}

export async function watchOn(db: D1Database, userId: number, date: string): Promise<WatchDay | null> {
  return (await watchDaysBetween(db, userId, date, date)).get(date) ?? null;
}

/** For /api/me: whether a key is set, and when anything last came in. */
export async function watchStatus(db: D1Database, user: UserRow): Promise<WatchStatus> {
  const last = await db.prepare("SELECT MAX(synced_at) AS at FROM watch_days WHERE user_id = ?").bind(user.id).first<{ at: string | null }>();
  return { connected: user.watch_connected === 1, lastSync: last?.at ?? null };
}

export const watchRoutes = new Hono<AppEnv>();

// A new key. Any old one stops working, so a lost key is fixed by making another.
watchRoutes.post("/watch/key", async (c) => {
  const db = c.env.DB;
  const user = await getUser(db, c.get("email"));
  if (!user) return noProfile(c);
  const key = newSyncKey();
  await db.prepare("UPDATE users SET watch_key_hash = ? WHERE id = ?").bind(await hashSyncKey(key), user.id).run();
  const body: WatchKeyResponse = { key, syncUrl: new URL(WATCH_SYNC_PATH, c.req.url).href };
  return c.json(body, 201);
});

// Disconnect: the key stops working. What was synced stays.
watchRoutes.delete("/watch/key", async (c) => {
  const db = c.env.DB;
  const user = await getUser(db, c.get("email"));
  if (!user) return noProfile(c);
  await db.prepare("UPDATE users SET watch_key_hash = NULL WHERE id = ?").bind(user.id).run();
  return c.json(await watchStatus(db, { ...user, watch_connected: 0 }));
});
