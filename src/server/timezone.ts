import "server-only";
import { getSetting, setSetting } from "./db";

// The user's own time zone. The server runs in UTC, so schedules and "now" must be worked out in the user's zone.

export const TIMEZONE_KEY = "profile_timezone";

export function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function userTimeZone(): string {
  const saved = getSetting(TIMEZONE_KEY);
  if (saved && validTimeZone(saved)) return saved;
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Remember the browser's time zone the first time it is seen (an explicit choice is never overwritten). */
export function syncTimeZone(tz: string) {
  if (!getSetting(TIMEZONE_KEY) && validTimeZone(tz)) setSetting(TIMEZONE_KEY, tz);
}

export function nowInZone(tz = userTimeZone()): string {
  return new Date().toLocaleString("en-GB", { timeZone: tz, dateStyle: "full", timeStyle: "long" });
}

function offsetMs(at: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(at));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** "2026-10-10T09:00" (a wall-clock time in the user's zone) as a real moment in time. Null when it can't be read. */
export function localTimeToMs(local: string, tz = userTimeZone()): number | null {
  const m = local.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  let at = guess - offsetMs(guess, tz);
  at = guess - offsetMs(at, tz); // once more, in case the first guess crossed a daylight-saving change
  return Number.isFinite(at) ? at : null;
}
