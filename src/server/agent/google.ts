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
  const id = model.slice(GOOGLE_PREFIX.length);
  // Strip legacy "models/" prefix that was briefly stored in the DB
  return id.startsWith("models/") ? id.slice("models/".length) : id;
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
    const res = await fetch(`${BASE_URL}models`, { headers: { Authorization: `Bearer ${key}` } });
    if (res.status === 401 || res.status === 403) return "Google AI didn't accept that key. Get one at aistudio.google.com.";
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

// Display metadata for well-known models. Dynamically fetched model IDs may not be in this list.
export const GOOGLE_MODELS = [
  { id: "gemini-2.5-pro",         name: "Gemini 2.5 Pro",         parameters: "Pro",   context_length: 1048576, category: "general" as const, description: "Google's most capable model — advanced reasoning, 1M context, multimodal" },
  { id: "gemini-2.5-flash",       name: "Gemini 2.5 Flash",       parameters: "Flash", context_length: 1048576, category: "fast"    as const, description: "Fast, efficient Gemini with 1M context — ideal for automation and long docs" },
  { id: "gemini-2.0-flash",       name: "Gemini 2.0 Flash",       parameters: "Flash", context_length: 1048576, category: "fast"    as const, description: "Reliable free-tier model with tool calling, multimodal and 1M context" },
  { id: "gemini-2.0-flash-lite",  name: "Gemini 2.0 Flash Lite",  parameters: "Flash", context_length: 1048576, category: "fast"    as const, description: "Lightweight free-tier model for quick tasks" },
  { id: "gemini-1.5-flash",       name: "Gemini 1.5 Flash",       parameters: "Flash", context_length: 1048576, category: "fast"    as const, description: "Fast model for routine tasks and scheduled automations" },
  { id: "gemini-1.5-flash-8b",    name: "Gemini 1.5 Flash 8B",    parameters: "Flash", context_length:  1048576, category: "fast"    as const, description: "Smallest and fastest Gemini model" },
  { id: "gemini-1.5-pro",         name: "Gemini 1.5 Pro",         parameters: "Pro",   context_length: 2097152, category: "general" as const, description: "Strong reasoning with 2M context window" },
];
const META_MAP = new Map(GOOGLE_MODELS.map((m) => [m.id, m]));

// Sorted preference list for picking a default: most capable stable models first.
const PREFERRED_IDS = ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-pro", "gemini-1.5-flash"];

export const preferredGoogleModel = (available?: string[]) => {
  if (available) {
    for (const p of PREFERRED_IDS) {
      const full = GOOGLE_PREFIX + p;
      if (available.includes(full)) return full;
    }
    if (available.length) return available[0];
  }
  return GOOGLE_PREFIX + "gemini-2.0-flash";
};
export const smallGoogleModel = (available?: string[]) => preferredGoogleModel(available);

const g2 = globalThis as unknown as { __dotsGoogleModels?: { key: string; result: { ids: string[]; meta: Record<string, ModelMeta> } } };

export async function googleModelsAndMeta(): Promise<{ ids: string[]; meta: Record<string, ModelMeta> }> {
  const key = googleKey();
  if (!key) return { ids: [], meta: {} };

  if (g2.__dotsGoogleModels?.key === key) return g2.__dotsGoogleModels.result;

  try {
    const res = await fetch(`${BASE_URL}models`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`${res.status}`);
    const json: any = await res.json();
    const rawIds: string[] = (json.data ?? []).map((m: any) => String(m.id)).filter(Boolean);
    // Filter to chat-capable Gemini models (skip embedding, tuned, etc.)
    const ids: string[] = [];
    const meta: Record<string, ModelMeta> = {};
    for (const raw of rawIds) {
      if (!raw.startsWith("gemini")) continue;
      const fullId = GOOGLE_PREFIX + raw;
      ids.push(fullId);
      const known = META_MAP.get(raw);
      meta[fullId] = {
        isFree: true,
        contextLength: known?.context_length ?? 1048576,
        contextFormatted: "1M ctx",
        parameters: known?.parameters ?? (raw.includes("pro") ? "Pro" : "Flash"),
        category: known?.category ?? (raw.includes("pro") ? "general" : "fast"),
        description: known?.description ?? `Gemini model: ${raw}`,
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
  // If the models endpoint is unreachable, offer a minimal safe set so the UI still works.
  const ids: string[] = [];
  const meta: Record<string, ModelMeta> = {};
  for (const m of [GOOGLE_MODELS[2], GOOGLE_MODELS[3]]) { // gemini-2.0-flash, gemini-2.0-flash-lite
    const fullId = GOOGLE_PREFIX + m.id;
    ids.push(fullId);
    meta[fullId] = { isFree: true, contextLength: m.context_length, contextFormatted: "1M ctx", parameters: m.parameters, category: m.category, description: m.description };
  }
  return { ids, meta };
}
