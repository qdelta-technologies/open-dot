import "server-only";
import OpenAI from "openai";
import { getSetting, setSetting } from "../db";
import { seal, unseal } from "../vault";

// Cloudflare Workers AI via QDelta Responses API adapter.
// Enabled when the user adds a secret key in Settings, or sets QDELTA_API_KEY / QDELTA_BASE_URL.
// Dots pick these models with a "qdelta:" prefix, e.g. "qdelta:qdelta-llama-4-scout".

export const QDELTA_PREFIX = "qdelta:";
export const DEFAULT_QDELTA_BASE_URL = "https://qdelta-ai.qdelta-work.workers.dev/v1";
const KEY_SETTING = "qdelta_key";
const URL_SETTING = "qdelta_base_url";

const g = globalThis as unknown as {
  __dotsQDelta?: { key: string; url: string; client: OpenAI };
  __dotsQDeltaModels?: { at: number; ids: string[] };
};

function envKey(): string | null {
  return process.env.QDELTA_API_KEY || process.env.QDELTA_KEY || null;
}

function envBaseUrl(): string | null {
  return process.env.QDELTA_BASE_URL || null;
}

export function qdeltaKey(): string | null {
  if (envKey()) return envKey();
  const sealed = getSetting(KEY_SETTING);
  if (!sealed) return null;
  try {
    return unseal(sealed);
  } catch {
    return null;
  }
}

export function qdeltaBaseUrl(): string {
  if (envBaseUrl()) return envBaseUrl()!;
  return getSetting(URL_SETTING) || DEFAULT_QDELTA_BASE_URL;
}

export const qdeltaSource = (): "env" | "settings" | null =>
  envKey() ? "env" : getSetting(KEY_SETTING) ? "settings" : null;

export const isQDeltaModel = (model: string) => model.startsWith(QDELTA_PREFIX);
export const qdeltaModelId = (model: string) => model.slice(QDELTA_PREFIX.length);

export function qdeltaClient(): OpenAI {
  const key = qdeltaKey();
  if (!key) throw new Error("No QDelta / Cloudflare AI key configured. Add one in Settings.");
  const url = qdeltaBaseUrl().replace(/\/+$/, "");

  if (!g.__dotsQDelta || g.__dotsQDelta.key !== key || g.__dotsQDelta.url !== url) {
    g.__dotsQDelta = {
      key,
      url,
      client: new OpenAI({
        apiKey: key,
        baseURL: url,
      }),
    };
  }
  return g.__dotsQDelta.client;
}

/** Check the key against the Cloudflare Worker, then save it encrypted. An empty key removes it. */
export async function saveQDeltaConfig(key: string, baseUrl?: string): Promise<string | null> {
  if (envKey()) return "The QDelta key is set by QDELTA_API_KEY.";
  const cleanKey = key.trim();
  const cleanUrl = (baseUrl?.trim() || qdeltaBaseUrl()).replace(/\/+$/, "");

  if (!cleanKey) {
    setSetting(KEY_SETTING, null);
    g.__dotsQDelta = undefined;
    g.__dotsQDeltaModels = undefined;
    return null;
  }

  try {
    const res = await fetch(`${cleanUrl}/models`, {
      headers: { Authorization: `Bearer ${cleanKey}` },
    });
    if (res.status === 401 || res.status === 403) {
      return "Cloudflare Worker rejected that API secret (401 Unauthorized).";
    }
    if (!res.ok) {
      return `Couldn't check Cloudflare Worker (${res.status} ${res.statusText}).`;
    }
  } catch (err) {
    return `Couldn't reach Cloudflare Worker: ${err instanceof Error ? err.message : String(err)}`;
  }

  setSetting(KEY_SETTING, seal(cleanKey));
  setSetting(URL_SETTING, cleanUrl);
  g.__dotsQDelta = undefined;
  g.__dotsQDeltaModels = undefined;
  return null;
}

/** Models from QDelta Cloudflare Worker, cached for 1 hour. */
export async function qdeltaModels(): Promise<string[]> {
  if (!qdeltaKey()) return [];
  if (g.__dotsQDeltaModels && Date.now() - g.__dotsQDeltaModels.at < 3_600_000) {
    return g.__dotsQDeltaModels.ids;
  }

  const url = qdeltaBaseUrl().replace(/\/+$/, "");
  const key = qdeltaKey();
  try {
    const res = await fetch(`${url}/models`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { data } = (await res.json()) as { data: { id: string }[] };
    const ids = data.map((m) => QDELTA_PREFIX + m.id);
    g.__dotsQDeltaModels = { at: Date.now(), ids };
    return ids;
  } catch (err) {
    console.warn("[dots] couldn't list QDelta Cloudflare models:", err instanceof Error ? err.message : err);
    return [QDELTA_PREFIX + "qdelta-llama-4-scout", QDELTA_PREFIX + "qdelta-llama-3.1-8b"];
  }
}
