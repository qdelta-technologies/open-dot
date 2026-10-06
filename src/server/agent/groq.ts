import "server-only";
import OpenAI from "openai";
import { getSetting, setSetting } from "../db";
import { seal, unseal } from "../vault";
import type { ModelMeta } from "@/lib/types";

export const GROQ_PREFIX = "groq:";
const BASE_URL = "https://api.groq.com/openai/v1";
const KEY_SETTING = "groq_key";

export const DEFAULT_GROQ_MODELS = [
  {
    id: "llama-3.3-70b-versatile",
    name: "Llama 3.3 70B Versatile",
    description: "Meta's flagship 70B model running at 300+ tokens/sec on Groq LPUs",
    context_length: 131072,
    parameters: "70B",
    category: "general" as const,
  },
  {
    id: "qwen-2.5-coder-32b",
    name: "Qwen 2.5 Coder 32B",
    description: "Alibaba's premier code generation & technical model on Groq hardware",
    context_length: 32768,
    parameters: "32B",
    category: "coding" as const,
  },
  {
    id: "deepseek-r1-distill-llama-70b",
    name: "DeepSeek R1 Distill 70B",
    description: "DeepSeek's chain-of-thought reasoning architecture running at extreme speed",
    context_length: 131072,
    parameters: "70B",
    category: "general" as const,
  },
  {
    id: "llama-3.1-8b-instant",
    name: "Llama 3.1 8B Instant",
    description: "Ultra-low latency model running at 800+ tokens/sec for instantaneous responses",
    context_length: 131072,
    parameters: "8B",
    category: "fast" as const,
  },
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

export async function groqModelsAndMeta(): Promise<{ ids: string[]; meta: Record<string, ModelMeta> }> {
  if (!groqKey()) return { ids: [], meta: {} };
  const ids = DEFAULT_GROQ_MODELS.map((m) => `${GROQ_PREFIX}${m.id}`);
  const meta: Record<string, ModelMeta> = {};
  for (const m of DEFAULT_GROQ_MODELS) {
    meta[`${GROQ_PREFIX}${m.id}`] = {
      isFree: true,
      description: m.description,
      parameters: m.parameters,
      contextLength: m.context_length,
      contextFormatted: `${Math.round(m.context_length / 1024)}k ctx`,
      category: m.category,
    };
  }
  return { ids, meta };
}
