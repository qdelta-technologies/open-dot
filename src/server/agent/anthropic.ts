import "server-only";
import OpenAI from "openai";
import { getSetting, setSetting } from "../db";
import { seal, unseal } from "../vault";
import type { ModelMeta } from "@/lib/types";

// Anthropic Claude — OpenAI-compatible endpoint.
// Models carry a "claude:" prefix, e.g. "claude:claude-sonnet-5-5".

export const ANTHROPIC_PREFIX = "claude:";
const BASE_URL = "https://api.anthropic.com/v1/";
const KEY_SETTING = "anthropic_key";

const g = globalThis as unknown as { __dotsAnthropic?: { key: string; client: OpenAI } };

function envKey(): string | null {
  return process.env.ANTHROPIC_API_KEY || null;
}

export function anthropicKey(): string | null {
  const sealed = getSetting(KEY_SETTING);
  if (sealed) {
    try { return unseal(sealed); } catch { }
  }
  return envKey();
}

export const anthropicSource = (): "env" | "settings" | null =>
  getSetting(KEY_SETTING) ? "settings" : envKey() ? "env" : null;

export const isAnthropicModel = (model: string) => model.startsWith(ANTHROPIC_PREFIX);
export const anthropicId = (model: string) => model.slice(ANTHROPIC_PREFIX.length);

export function anthropicClient(): OpenAI {
  const key = anthropicKey();
  if (!key) throw new Error("No Anthropic API key. Add one in Settings.");
  if (g.__dotsAnthropic?.key !== key) {
    g.__dotsAnthropic = {
      key,
      client: new OpenAI({
        apiKey: key,
        baseURL: BASE_URL,
        defaultHeaders: { "anthropic-version": "2023-06-01" },
      }),
    };
  }
  return g.__dotsAnthropic.client;
}

export async function saveAnthropicKey(key: string): Promise<string | null> {
  if (!key) {
    setSetting(KEY_SETTING, null);
    g.__dotsAnthropic = undefined;
    (globalThis as any).__dotsResetModels?.();
    return null;
  }
  try {
    const res = await fetch(`${BASE_URL}models`, {
      headers: { Authorization: `Bearer ${key}`, "anthropic-version": "2023-06-01" },
    });
    if (res.status === 401 || res.status === 403) return "Anthropic didn't accept that key. Get one at console.anthropic.com.";
    if (!res.ok) return `Couldn't verify the key (${res.status}).`;
  } catch (err) {
    return `Couldn't reach Anthropic: ${err instanceof Error ? err.message : String(err)}`;
  }
  setSetting(KEY_SETTING, seal(key));
  g.__dotsAnthropic = undefined;
  (globalThis as any).__dotsResetModels?.();
  return null;
}

export const ANTHROPIC_MODELS = [
  { id: "claude-opus-5-5",         name: "Claude Opus 5.5",    parameters: "Opus",   context_length: 200000, category: "general" as const, description: "Most capable Claude — advanced reasoning, research, complex agent tasks" },
  { id: "claude-sonnet-5-5",       name: "Claude Sonnet 5.5",  parameters: "Sonnet", context_length: 200000, category: "general" as const, description: "Best balance of intelligence and speed for everyday agent tasks" },
  { id: "claude-sonnet-4-6",       name: "Claude Sonnet 4.6",  parameters: "Sonnet", context_length: 200000, category: "general" as const, description: "Fast, highly capable — great for coding and automation" },
  { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", parameters: "Haiku",  context_length: 200000, category: "fast"    as const, description: "Fastest Claude — ideal for quick tasks and high-volume night automation" },
];

export const preferredAnthropicModel = () => ANTHROPIC_PREFIX + "claude-sonnet-5-5";
export const smallAnthropicModel = () => ANTHROPIC_PREFIX + "claude-haiku-4-5-20251001";

export function anthropicModelsAndMeta(): { ids: string[]; meta: Record<string, ModelMeta> } {
  if (!anthropicKey()) return { ids: [], meta: {} };
  const ids: string[] = [];
  const meta: Record<string, ModelMeta> = {};
  for (const m of ANTHROPIC_MODELS) {
    const fullId = ANTHROPIC_PREFIX + m.id;
    ids.push(fullId);
    meta[fullId] = {
      isFree: false,
      contextLength: m.context_length,
      contextFormatted: "200k ctx",
      parameters: m.parameters,
      category: m.category,
      description: m.description,
    };
  }
  return { ids, meta };
}
