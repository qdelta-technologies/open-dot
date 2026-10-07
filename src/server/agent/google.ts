import "server-only";
import OpenAI from "openai";
import { getSetting, setSetting } from "../db";
import { seal, unseal } from "../vault";
import type { ModelMeta } from "@/lib/types";

// Google AI Studio — OpenAI-compatible endpoint. Free tier: 1M tokens/day on Flash models.
// Models carry a "google:" prefix, e.g. "google:gemini-2.0-flash".

export const GOOGLE_PREFIX = "google:";
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
const KEY_SETTING = "google_key";

const g = globalThis as unknown as { __dotsGoogle?: { key: string; client: OpenAI } };

function envKey(): string | null {
  return process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || null;
}

export function googleKey(): string | null {
  const sealed = getSetting(KEY_SETTING);
  if (sealed) {
    try { return unseal(sealed); } catch { }
  }
  return envKey();
}

export const googleSource = (): "env" | "settings" | null =>
  getSetting(KEY_SETTING) ? "settings" : envKey() ? "env" : null;

export const isGoogleModel = (model: string) => model.startsWith(GOOGLE_PREFIX);
export const googleId = (model: string) => {
  let id = model.slice(GOOGLE_PREFIX.length);
  // Strip legacy "models/" prefix that was briefly stored in the DB
  if (id.startsWith("models/")) id = id.slice("models/".length);
  // Google retired gemini-2.5 models for new keys (404), and gemini-3.5-flash has temporary 503 load.
  // Route legacy and high-load models to the verified operational gemini-3.5-flash-lite!
  if (
    id === "gemini-2.5-pro" ||
    id === "gemini-2.5-flash" ||
    id === "gemini-2.5-flash-lite" ||
    id === "gemini-2.0-flash" ||
    id === "gemini-3.5-flash" ||
    id === "gemini-flash-latest"
  ) {
    return "gemini-3.5-flash-lite";
  }
  return id;
};

export function googleClient(): OpenAI {
  const key = googleKey();
  if (!key) throw new Error("No Google AI API key. Add one in Settings.");
  if (g.__dotsGoogle?.key !== key) {
    g.__dotsGoogle = { key, client: new OpenAI({ apiKey: key, baseURL: BASE_URL }) };
  }
  return g.__dotsGoogle.client;
}

export async function saveGoogleKey(key: string): Promise<string | null> {
  if (!key) {
    setSetting(KEY_SETTING, null);
    g.__dotsGoogle = undefined;
    g2.__dotsGoogleModels = undefined;
    (globalThis as any).__dotsResetModels?.();
    return null;
  }
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
    if (res.status === 400 || res.status === 401 || res.status === 403) return "Google AI didn't accept that key. Get one at aistudio.google.com.";
    if (!res.ok) return `Couldn't verify the key (${res.status}).`;
  } catch (err) {
    return `Couldn't reach Google AI: ${err instanceof Error ? err.message : String(err)}`;
  }
  setSetting(KEY_SETTING, seal(key));
  g.__dotsGoogle = undefined;
  g2.__dotsGoogleModels = undefined;
  (globalThis as any).__dotsResetModels?.();
  return null;
}

// Display metadata for verified models on Google AI Studio
export const GOOGLE_MODELS = [
  { id: "gemini-3.5-flash-lite",     name: "Gemini 3.5 Flash Lite",     parameters: "Flash Lite", context_length: 1048576, category: "fast" as const, description: "Google Gemini 3.5 — 1M context, verified text, tool calling & image support" },
  { id: "gemini-flash-lite-latest",  name: "Gemini Flash Lite (Latest)", parameters: "Flash Lite", context_length: 1048576, category: "fast" as const, description: "Official Google auto-updating latest Flash Lite endpoint" },
  { id: "gemini-3.1-flash-lite",     name: "Gemini 3.1 Flash Lite",     parameters: "Flash Lite", context_length: 1048576, category: "fast" as const, description: "Compact, verified reliable Gemini 3.1 model" },
];
const META_MAP = new Map(GOOGLE_MODELS.map((m) => [m.id, m]));

// Sorted preference list: verified working models first
const PREFERRED_IDS = [
  "gemini-3.5-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-3.1-flash-lite",
];

export const preferredGoogleModel = (available?: string[]) => {
  if (available) {
    for (const p of PREFERRED_IDS) {
      const full = GOOGLE_PREFIX + p;
      if (available.includes(full)) return full;
    }
    if (available.length) return available[0];
  }
  return GOOGLE_PREFIX + "gemini-3.5-flash-lite";
};
export const smallGoogleModel = (available?: string[]) => preferredGoogleModel(available);

const g2 = globalThis as unknown as { __dotsGoogleModels?: { key: string; result: { ids: string[]; meta: Record<string, ModelMeta> } } };

export async function googleModelsAndMeta(): Promise<{ ids: string[]; meta: Record<string, ModelMeta> }> {
  const key = googleKey();
  if (!key) return { ids: [], meta: {} };

  if (g2.__dotsGoogleModels?.key === key) return g2.__dotsGoogleModels.result;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`
    );
    if (!res.ok) throw new Error(`${res.status}`);
    const json: any = await res.json();

    const rawModels: any[] = json.models ?? json.data ?? [];
    const availableSet = new Set<string>();
    for (const m of rawModels) {
      const raw = String(m.id ?? m.name ?? "").replace(/^models\//, "");
      availableSet.add(raw);
    }

    const ids: string[] = [];
    const meta: Record<string, ModelMeta> = {};

    for (const m of GOOGLE_MODELS) {
      // If models were returned from Google, verify the model is listed; otherwise keep the verified model
      if (availableSet.size > 0 && !availableSet.has(m.id)) continue;
      const fullId = GOOGLE_PREFIX + m.id;
      ids.push(fullId);
      meta[fullId] = {
        isFree: true,
        contextLength: m.context_length,
        contextFormatted: "1M ctx",
        parameters: m.parameters,
        category: m.category,
        description: m.description,
      };
    }

    const result = ids.length ? { ids, meta } : fallbackModelsAndMeta();
    g2.__dotsGoogleModels = { key, result };
    return result;
  } catch {
    return fallbackModelsAndMeta();
  }
}

function fallbackModelsAndMeta(): { ids: string[]; meta: Record<string, ModelMeta> } {
  const ids: string[] = [];
  const meta: Record<string, ModelMeta> = {};
  for (const m of GOOGLE_MODELS) {
    const fullId = GOOGLE_PREFIX + m.id;
    ids.push(fullId);
    meta[fullId] = {
      isFree: true,
      contextLength: m.context_length,
      contextFormatted: "1M ctx",
      parameters: m.parameters,
      category: m.category,
      description: m.description,
    };
  }
  return { ids, meta };
}
