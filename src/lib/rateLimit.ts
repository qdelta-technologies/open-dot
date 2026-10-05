import { headers } from "next/headers";
import type { NextRequest } from "next/server";

interface RateLimitState {
  count: number;
  resetAt: number;
}

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

// In-memory store for tracking failed login attempts by IP
const attemptsMap = new Map<string, RateLimitState>();

// Periodic cleanup of expired entries
if (typeof setInterval !== "undefined") {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [ip, state] of attemptsMap.entries()) {
      if (now > state.resetAt) {
        attemptsMap.delete(ip);
      }
    }
  }, 5 * 60 * 1000);
  if (timer.unref) {
    timer.unref();
  }
}

/** Extracts client IP from incoming Next.js server headers. */
export async function getClientIp(): Promise<string> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for");
    if (forwarded) {
      return forwarded.split(",")[0].trim();
    }
    return h.get("x-real-ip") || h.get("cf-connecting-ip") || "unknown";
  } catch {
    return "unknown";
  }
}

/** Extracts client IP from NextRequest (API routes / middleware). */
export function getRequestIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.headers.get("x-real-ip") || req.headers.get("cf-connecting-ip") || "unknown";
}

/** Checks whether the given IP is currently locked out. */
export function checkRateLimit(ip: string): { allowed: boolean; waitMinutes?: number } {
  const now = Date.now();
  const entry = attemptsMap.get(ip);

  if (!entry) return { allowed: true };

  // Lockout period has passed
  if (now > entry.resetAt) {
    attemptsMap.delete(ip);
    return { allowed: true };
  }

  if (entry.count >= MAX_ATTEMPTS) {
    const remainingSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    const waitMinutes = Math.max(1, Math.ceil(remainingSeconds / 60));
    return { allowed: false, waitMinutes };
  }

  return { allowed: true };
}

/** Increments failed attempt counter for an IP. */
export function recordFailedAttempt(ip: string): { count: number; remaining: number } {
  const now = Date.now();
  const entry = attemptsMap.get(ip);

  if (!entry || now > entry.resetAt) {
    attemptsMap.set(ip, { count: 1, resetAt: now + LOCKOUT_MS });
    return { count: 1, remaining: MAX_ATTEMPTS - 1 };
  }

  entry.count += 1;
  const remaining = Math.max(0, MAX_ATTEMPTS - entry.count);
  return { count: entry.count, remaining };
}

/** Clears rate limit state upon successful authentication. */
export function resetRateLimit(ip: string): void {
  attemptsMap.delete(ip);
}
