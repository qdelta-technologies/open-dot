import "server-only";
import OpenAI from "openai";
import { db, getSetting, setSetting } from "../db";
import { seal, unseal } from "../vault";

// Open models through OpenRouter. Off until the user adds an OpenRouter key (Settings, or OPENROUTER_API_KEY).
// Dots pick these models like any other; their ids carry an "openrouter:" prefix, e.g. "openrouter:qwen/qwen3.8-27b:free".
// OpenRouter's Responses API is stateless, so the runtime keeps each chat's history for these models itself.

export const OPENROUTER_PREFIX = "openrouter:";
const BASE_URL = "https://openrouter.ai/api/v1";
const KEY_SETTING = "openrouter_key";
const HEADERS = { "HTTP-Referer": "https://github.com/composio-community/open-dot", "X-Title": "QDot" };

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export type OpenModelMeta = {
  isFree: boolean;
  paidUntil?: number | null;
  contextLength?: number | null;
  contextFormatted?: string | null;
  parameters?: string | null;
};

export function formatContext(len?: number | null): string | null {
  if (!len) return null;
  if (len >= 1_000_000) {
    const m = Math.round((len / 1_000_000) * 10) / 10;
    return `${m}M ctx`;
  }
  return `${Math.round(len / 1024)}k ctx`;
}

export function parseParameters(id: string, name?: string, desc?: string): string | null {
  const match =
    id.match(/(?:^|[-_/])(\d+(?:\.\d+)?b)(?:[-_:]|$)/i) ||
    name?.match(/(?:^|[\s(])(\d+(?:\.\d+)?B)(?:[\s)]|$)/i) ||
    desc?.match(/(\d+(?:\.\d+)?B)\s*(?:active|total|parameters|parameter)/i);
  return match ? match[1].toUpperCase() : null;
}

// Best first when an open model has to be picked for the user (no OpenAI key yet, or no choice made).
const MAIN_PREFERENCE = [
  /gemma.*(26b|31b|it)/i,
  /nemotron/i,
  /qwen.*(27b|32b|72b|instruct)/i,
  /ling/i,
  /inkling/i,
  /laguna/i,
  /free/i,
];
const SMALL_PREFERENCE = [
  /mini/i,
  /small/i,
  /nano/i,
  /nemotron.*lightning/i,
  /flash/i,
  /free/i,
];

const g = globalThis as unknown as {
  __dotsOpenRouter?: { key: string; client: OpenAI };
  __dotsOpenModels?: { at: number; ids: string[]; meta: Record<string, OpenModelMeta> };
};

function envKey(): string | null {
  return process.env.OPENROUTER_API_KEY || null;
}

export function openRouterKey(): string | null {
  const sealed = getSetting(KEY_SETTING);
  if (sealed) {
    try {
      return unseal(sealed);
    } catch {
      // ignore
    }
  }
  return envKey();
}

export const openRouterSource = (): "env" | "settings" | null => (getSetting(KEY_SETTING) ? "settings" : envKey() ? "env" : null);

export const isOpenRouterModel = (model: string) => model.startsWith(OPENROUTER_PREFIX);
export const openRouterId = (model: string) => model.slice(OPENROUTER_PREFIX.length);

export function openrouter(): OpenAI {
  const key = openRouterKey();
  if (!key) throw new Error("No OpenRouter key yet. Add one in Settings to use open models.");
  if (g.__dotsOpenRouter?.key !== key) g.__dotsOpenRouter = { key, client: new OpenAI({ apiKey: key, baseURL: BASE_URL, defaultHeaders: HEADERS }) };
  return g.__dotsOpenRouter.client;
}

/** Check the key with OpenRouter, then save it encrypted. An empty key removes it. Returns an error or null. */
export async function saveOpenRouterKey(key: string): Promise<string | null> {
  if (!key) {
    setSetting(KEY_SETTING, null);
    g.__dotsOpenModels = undefined;
    (globalThis as any).__dotsResetModels?.();
    return null;
  }
  try {
    const res = await fetch(`${BASE_URL}/key`, { headers: { Authorization: `Bearer ${key}` } });
    if (res.status === 401 || res.status === 403) return "OpenRouter didn't accept that key.";
    if (!res.ok) return `Couldn't check the key with OpenRouter (${res.status}).`;
  } catch (err) {
    return `Couldn't reach OpenRouter: ${err instanceof Error ? err.message : String(err)}`;
  }
  setSetting(KEY_SETTING, seal(key));
  g.__dotsOpenModels = undefined;
  (globalThis as any).__dotsResetModels?.();
  return null;
}

/**
 * Free models from OpenRouter (and models that turned paid within a 30-day grace window).
 * If a model turns paid, it remains shown as "Paid (Grace period)" for 30 days before being removed.
 */
export async function openModelsAndMeta(): Promise<{ ids: string[]; meta: Record<string, OpenModelMeta> }> {
  if (!openRouterKey()) return { ids: [], meta: {} };
  if (g.__dotsOpenModels && Date.now() - g.__dotsOpenModels.at < 3_600_000) {
    return { ids: g.__dotsOpenModels.ids, meta: g.__dotsOpenModels.meta };
  }

  const res = await fetch(`${BASE_URL}/models`);
  if (!res.ok) throw new Error(`OpenRouter models: ${res.status}`);
  const { data } = (await res.json()) as {
    data: {
      id: string;
      name?: string;
      description?: string;
      context_length?: number;
      pricing?: { prompt?: string | number; completion?: string | number };
      supported_parameters?: string[];
      created?: number;
    }[];
  };

  const now = Date.now();
  const conn = db();

  // Prepare SQLite upsert & lookup
  const getStatus = conn.prepare("SELECT * FROM open_model_status WHERE id = ?");
  const upsertStatus = conn.prepare(`
    INSERT INTO open_model_status (id, is_free, first_paid_at, last_seen_at, context_length, parameters)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      is_free = excluded.is_free,
      first_paid_at = excluded.first_paid_at,
      last_seen_at = excluded.last_seen_at,
      context_length = excluded.context_length,
      parameters = excluded.parameters
  `);

  // Check every tool-capable model
  for (const m of data) {
    const supportsTools = m.supported_parameters && m.supported_parameters.includes("tools");
    if (!supportsTools) continue;

    const isCurrentlyFree =
      (Number(m.pricing?.prompt ?? 0) === 0 && Number(m.pricing?.completion ?? 0) === 0) || m.id.endsWith(":free");

    const param = parseParameters(m.id, m.name, m.description);
    const ctxLen = m.context_length ?? null;

    const existing = getStatus.get(m.id) as { id: string; is_free: number; first_paid_at: number | null } | undefined;

    if (existing) {
      let firstPaidAt = existing.first_paid_at;
      if (existing.is_free === 1 && !isCurrentlyFree) {
        // Just transitioned from Free to Paid -> start 1-month grace period
        firstPaidAt = existing.first_paid_at ?? now;
      } else if (isCurrentlyFree) {
        // Currently free -> clear grace period
        firstPaidAt = null;
      }
      upsertStatus.run(m.id, isCurrentlyFree ? 1 : 0, firstPaidAt, now, ctxLen, param);
    } else if (isCurrentlyFree) {
      // Newly discovered free model
      upsertStatus.run(m.id, 1, null, now, ctxLen, param);
    }
  }

  // Purge any models that turned paid and whose 30-day grace period has expired
  conn.prepare("DELETE FROM open_model_status WHERE is_free = 0 AND first_paid_at IS NOT NULL AND (? - first_paid_at) >= ?").run(now, THIRTY_DAYS_MS);

  // Retrieve all valid free models + models in the 30-day grace period
  const activeRows = conn
    .prepare(
      `SELECT id, is_free, first_paid_at, context_length, parameters FROM open_model_status
       WHERE is_free = 1 OR (first_paid_at IS NOT NULL AND (? - first_paid_at) < ?)
       ORDER BY is_free DESC, last_seen_at DESC`,
    )
    .all(now, THIRTY_DAYS_MS) as { id: string; is_free: number; first_paid_at: number | null; context_length: number | null; parameters: string | null }[];

  const ids: string[] = [];
  const meta: Record<string, OpenModelMeta> = {};

  for (const row of activeRows) {
    const fullId = OPENROUTER_PREFIX + row.id;
    ids.push(fullId);
    meta[fullId] = {
      isFree: row.is_free === 1,
      paidUntil: row.first_paid_at ? row.first_paid_at + THIRTY_DAYS_MS : null,
      contextLength: row.context_length,
      contextFormatted: formatContext(row.context_length),
      parameters: row.parameters,
    };
  }

  g.__dotsOpenModels = { at: now, ids, meta };
  return { ids, meta };
}

export async function openModels(): Promise<string[]> {
  return (await openModelsAndMeta()).ids;
}

export async function openModelMeta(): Promise<Record<string, OpenModelMeta>> {
  return (await openModelsAndMeta()).meta;
}

const pick = (ids: string[], prefs: RegExp[]) => prefs.map((re) => ids.find((id) => re.test(openRouterId(id)))).find(Boolean) ?? ids[0];
export const preferredOpenModel = (ids: string[]) => pick(ids, MAIN_PREFERENCE);
export const smallOpenModel = (ids: string[]) => pick(ids, SMALL_PREFERENCE);
