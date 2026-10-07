import "server-only";
import OpenAI from "openai";
import { getSetting, setSetting } from "../db";
import { seal, unseal } from "../vault";
import type { ModelMeta } from "@/lib/types";

export const GROQ_PREFIX = "groq:";
const BASE_URL = "https://api.groq.com/openai/v1";
const KEY_SETTING = "groq_key";

// Fallback list used when the live API call fails
export const DEFAULT_GROQ_MODELS = [
  { id: "llama-3.1-8b-instant",          name: "Llama 3.1 8B Instant",        description: "Ultra-fast 8B on Groq LPUs",                   context_length: 131072, parameters: "8B",  category: "fast"    as const },
  { id: "gemma2-9b-it",                  name: "Gemma 2 9B",                   description: "Google Gemma 2 9B instruction-tuned on Groq",   context_length: 8192,   parameters: "9B",  category: "fast"    as const },
  { id: "llama3-70b-8192",               name: "Llama 3 70B",                  description: "Meta Llama 3 70B on Groq LPUs",                 context_length: 8192,   parameters: "70B", category: "general" as const },
];

const g = globalThis as unknown as {
  __dotsGroq?: { key: string; client: OpenAI };
};

function envKey(): string | null {
  return process.env.GROQ_API_KEY || null;
}

export function groqKey(): string | null {
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

export const groqSource = (): "env" | "settings" | null => (getSetting(KEY_SETTING) ? "settings" : envKey() ? "env" : null);

export const isGroqModel = (model: string) => model.startsWith(GROQ_PREFIX);
export const groqId = (model: string) => model.slice(GROQ_PREFIX.length);

export function groq(): OpenAI {
  const key = groqKey();
  if (!key) throw new Error("No Groq key yet. Add one in Settings to use Groq models.");
  if (g.__dotsGroq?.key !== key) {
    g.__dotsGroq = {
      key,
      client: new OpenAI({
        apiKey: key,
        baseURL: BASE_URL,
      }),
    };
  }
  return g.__dotsGroq.client;
}

/** Check the key with Groq, then save it encrypted. An empty key removes it. */
export async function saveGroqKey(key: string): Promise<string | null> {
  if (!key) {
    setSetting(KEY_SETTING, null);
    (globalThis as any).__dotsResetModels?.();
    return null;
  }
  try {
    const res = await fetch(`${BASE_URL}/models`, { headers: { Authorization: `Bearer ${key}` } });
    if (res.status === 401 || res.status === 403) return "Groq didn't accept that key. Please verify it at console.groq.com.";
    if (!res.ok) return `Couldn't check the key with Groq (${res.status}).`;
  } catch (err) {
    return `Couldn't reach Groq: ${err instanceof Error ? err.message : String(err)}`;
  }
  setSetting(KEY_SETTING, seal(key));
  (globalThis as any).__dotsResetModels?.();
  return null;
}

function inferCategory(id: string): "general" | "fast" | "coding" {
  if (/coder|code|qwen.*coder/i.test(id)) return "coding";
  if (/8b|3b|1b|instant|lite|flash|mini/i.test(id)) return "fast";
  return "general";
}

function inferParams(id: string): string {
  const m = id.match(/(\d+(?:\.\d+)?)[bB]/);
  return m ? `${m[1]}B` : "?";
}

export async function groqModelsAndMeta(): Promise<{ ids: string[]; meta: Record<string, ModelMeta> }> {
  const key = groqKey();
  if (!key) return { ids: [], meta: {} };

  let liveModels: { id: string; context_window?: number }[] = [];
  try {
    const res = await fetch(`${BASE_URL}/models`, { headers: { Authorization: `Bearer ${key}` } });
    if (res.ok) {
      const data = await res.json() as { data?: { id: string; context_window?: number }[] };
      // Exclude audio/vision/embedding models — keep only chat-capable LLMs
      liveModels = (data.data ?? []).filter(
        (m) => !/whisper|tts|vision|embed|guard|preview/i.test(m.id)
      );
    }
  } catch { /* fall through to static list */ }

  const source = liveModels.length > 0 ? liveModels : DEFAULT_GROQ_MODELS.map((m) => ({ id: m.id, context_window: m.context_length }));

  const ids = source.map((m) => `${GROQ_PREFIX}${m.id}`);
  const meta: Record<string, ModelMeta> = {};
  for (const m of source) {
    const ctx = m.context_window ?? 8192;
    const static_ = DEFAULT_GROQ_MODELS.find((s) => s.id === m.id);
    meta[`${GROQ_PREFIX}${m.id}`] = {
      isFree: true,
      description: static_?.description ?? `${m.id} on Groq LPUs`,
      parameters: static_?.parameters ?? inferParams(m.id),
      contextLength: ctx,
      contextFormatted: ctx >= 1024 ? `${Math.round(ctx / 1024)}k ctx` : `${ctx} ctx`,
      category: static_?.category ?? inferCategory(m.id),
    };
  }
  return { ids, meta };
}
