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
export const googleId = (model: string) => model.slice(GOOGLE_PREFIX.length);

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
  (globalThis as any).__dotsResetModels?.();
  return null;
}

export const GOOGLE_MODELS = [
  { id: "gemini-2.5-pro-preview-06-05",   name: "Gemini 2.5 Pro",   parameters: "Pro",   context_length: 1048576, category: "general" as const, description: "Google's most capable model — advanced reasoning, 1M context, multimodal" },
  { id: "gemini-2.5-flash-preview-04-17", name: "Gemini 2.5 Flash", parameters: "Flash", context_length: 1048576, category: "fast"    as const, description: "Fast, efficient Gemini with 1M context — ideal for automation and long docs" },
  { id: "gemini-2.0-flash",               name: "Gemini 2.0 Flash", parameters: "Flash", context_length: 1048576, category: "fast"    as const, description: "Stable free-tier model with tool calling, multimodal and 1M context" },
  { id: "gemini-1.5-flash",               name: "Gemini 1.5 Flash", parameters: "Flash", context_length: 1048576, category: "fast"    as const, description: "Proven fast model for routine tasks and scheduled automations" },
];

export const preferredGoogleModel = () => GOOGLE_PREFIX + "gemini-2.0-flash";
export const smallGoogleModel = () => GOOGLE_PREFIX + "gemini-2.0-flash";

export function googleModelsAndMeta(): { ids: string[]; meta: Record<string, ModelMeta> } {
  if (!googleKey()) return { ids: [], meta: {} };
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
