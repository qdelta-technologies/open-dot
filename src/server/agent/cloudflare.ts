import "server-only";
import OpenAI from "openai";
import { getSetting, setSetting } from "../db";
import { seal, unseal } from "../vault";
import type { ModelMeta } from "@/lib/types";

// Cloudflare Workers AI integration for OpenDot.
// Connects to a deployed opendot-worker (or local wrangler dev server) via OpenAI-compatible API.
// Models carry a "cloudflare:" prefix, e.g. "cloudflare:@cf/meta/llama-3.3-70b-instruct-fp8-fast".

export const CLOUDFLARE_PREFIX = "cloudflare:";
const URL_SETTING = "cloudflare_worker_url";
const TOKEN_SETTING = "cloudflare_worker_token";

const MAIN_PREFERENCE = [
  /@cf\/meta\/llama-3\.3-70b/i,
  /@cf\/qwen\/qwen2\.5-72b/i,
  /@cf\/deepseek-ai\/deepseek-r1/i,
  /@cf\/meta\/llama-3\.1-8b/i,
];

const SMALL_PREFERENCE = [
  /@cf\/meta\/llama-3\.1-8b/i,
  /@cf\/meta\/llama-3\.3-70b/i,
  /@cf\/qwen/i,
];

const g = globalThis as unknown as {
  __dotsCloudflare?: { url: string; token?: string; client: OpenAI };
  __dotsCloudflareModels?: { at: number; ids: string[]; meta: Record<string, ModelMeta> };
};

function envUrl(): string | null {
  return process.env.CLOUDFLARE_WORKER_URL || null;
}

function envToken(): string | null {
  return process.env.CLOUDFLARE_WORKER_TOKEN || null;
}

export function cloudflareWorkerUrl(): string | null {
  const raw = getSetting(URL_SETTING);
  if (raw && raw.trim()) return raw.trim();
  if (envUrl()) return envUrl();
  return null;
}

export function cloudflareWorkerToken(): string | null {
  const sealed = getSetting(TOKEN_SETTING);
  if (sealed) {
    try {
      return unseal(sealed);
    } catch {
      // ignore
    }
  }
  return envToken();
}

export const cloudflareSource = (): "env" | "settings" | null =>
  getSetting(URL_SETTING) ? "settings" : envUrl() ? "env" : null;

export const isCloudflareModel = (model: string) =>
  model.startsWith(CLOUDFLARE_PREFIX) || model.startsWith("@cf/");

export const cloudflareId = (model: string) =>
  model.startsWith(CLOUDFLARE_PREFIX) ? model.slice(CLOUDFLARE_PREFIX.length) : model;

export function cloudflare(): OpenAI {
  const url = cloudflareWorkerUrl();
  if (!url) throw new Error("No Cloudflare Worker URL set. Add one in Settings.");
  const token = cloudflareWorkerToken() || "dummy-token";

  // Clean baseURL to ensure it has /v1
  const cleanUrl = url.replace(/\/+$/, "");
  const baseURL = cleanUrl.endsWith("/v1") ? cleanUrl : `${cleanUrl}/v1`;

  if (!g.__dotsCloudflare || g.__dotsCloudflare.url !== url || g.__dotsCloudflare.token !== token) {
    g.__dotsCloudflare = {
      url,
      token,
      client: new OpenAI({
        apiKey: token,
        baseURL,
      }),
    };
  }
  return g.__dotsCloudflare.client;
}

/** Check the worker URL and token by listing models. Returns error string or null. */
export async function saveCloudflareConfig(urlInput: string, tokenInput?: string): Promise<string | null> {
  const url = urlInput.trim();
  const token = tokenInput ? tokenInput.trim() : "";

  if (!url) {
    setSetting(URL_SETTING, null);
    setSetting(TOKEN_SETTING, null);
    g.__dotsCloudflare = undefined;
    g.__dotsCloudflareModels = undefined;
    return null;
  }

  // Validate format
  try {
    new URL(url);
  } catch {
    return "Please enter a valid URL (e.g. https://opendot-worker.yourname.workers.dev).";
  }

  const cleanUrl = url.replace(/\/+$/, "");
  const checkUrl = cleanUrl.endsWith("/v1") ? `${cleanUrl}/models` : `${cleanUrl}/v1/models`;

  try {
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(checkUrl, { headers });
    if (res.status === 401 || res.status === 403) return "Worker rejected token (Unauthorized).";
    if (!res.ok) return `Couldn't reach Cloudflare Worker (${res.status}: ${res.statusText}).`;

    const data = (await res.json()) as any;
    if (!data || !Array.isArray(data.data)) {
      return "Connected, but the endpoint did not return an OpenAI-compatible /v1/models list.";
    }
  } catch (err) {
    return `Couldn't connect to Cloudflare Worker: ${err instanceof Error ? err.message : String(err)}`;
  }

  setSetting(URL_SETTING, cleanUrl);
  setSetting(TOKEN_SETTING, token ? seal(token) : null);
  g.__dotsCloudflare = undefined;
  g.__dotsCloudflareModels = undefined;
  return null;
}

export function formatContext(len?: number | null): string | null {
  if (!len) return null;
  if (len >= 1_000_000) {
    const m = Math.round((len / 1_000_000) * 10) / 10;
    return `${m}M ctx`;
  }
  return `${Math.round(len / 1024)}k ctx`;
}

function inferCategory(id: string): "general" | "coding" | "vision" | "fast" {
  const lower = id.toLowerCase();
  if (lower.includes("vision") || lower.includes("uform")) return "vision";
  if (lower.includes("coder") || lower.includes("sql")) return "coding";
  if (lower.includes("1b") || lower.includes("3b") || lower.includes("mistral") || lower.includes("gemma")) return "fast";
  return "general";
}

export const DEFAULT_CLOUDFLARE_MODELS = [
  { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", name: "Llama 3.3 70B Instruct (Fast FP8)", parameters: "70B", context_length: 131072, category: "general" as const },
  { id: "@cf/qwen/qwen2.5-72b-instruct", name: "Qwen 2.5 72B Instruct", parameters: "72B", context_length: 32768, category: "general" as const },
  { id: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b", name: "DeepSeek R1 Distill Qwen 32B", parameters: "32B", context_length: 131072, category: "general" as const },
  { id: "@cf/meta/llama-3.1-70b-instruct", name: "Llama 3.1 70B Instruct", parameters: "70B", context_length: 131072, category: "general" as const },
  { id: "@cf/meta/llama-3.1-8b-instruct", name: "Llama 3.1 8B Instruct", parameters: "8B", context_length: 131072, category: "general" as const },

  { id: "@cf/qwen/qwen2.5-coder-32b-instruct", name: "Qwen 2.5 Coder 32B Instruct", parameters: "32B", context_length: 32768, category: "coding" as const },
  { id: "@cf/deepseek-ai/deepseek-coder-6.7b-instruct", name: "DeepSeek Coder 6.7B Instruct", parameters: "6.7B", context_length: 16384, category: "coding" as const },
  { id: "@cf/defog/sqlcoder-7b-2", name: "SQLCoder 7B-2", parameters: "7B", context_length: 8192, category: "coding" as const },

  { id: "@cf/meta/llama-3.2-11b-vision-instruct", name: "Llama 3.2 11B Vision Instruct", parameters: "11B Vision", context_length: 131072, category: "vision" as const },
  { id: "@cf/meta/llama-3.2-90b-vision-instruct", name: "Llama 3.2 90B Vision Instruct", parameters: "90B Vision", context_length: 131072, category: "vision" as const },

  { id: "@cf/meta/llama-3.2-3b-instruct", name: "Llama 3.2 3B Instruct", parameters: "3B", context_length: 131072, category: "fast" as const },
  { id: "@cf/meta/llama-3.2-1b-instruct", name: "Llama 3.2 1B Instruct", parameters: "1B", context_length: 131072, category: "fast" as const },
  { id: "@cf/mistral/mistral-7b-instruct-v0.2", name: "Mistral 7B Instruct v0.2", parameters: "7B", context_length: 32768, category: "fast" as const },
  { id: "@cf/google/gemma-2-9b-it", name: "Google Gemma 2 9B IT", parameters: "9B", context_length: 8192, category: "fast" as const },
];

/** Models from the Cloudflare AI Worker with metadata. */
export async function cloudflareModelsAndMeta(): Promise<{ ids: string[]; meta: Record<string, ModelMeta> }> {
  const url = cloudflareWorkerUrl();
  if (!url) return { ids: [], meta: {} };

  const now = Date.now();
  if (g.__dotsCloudflareModels && now - g.__dotsCloudflareModels.at < 60_000) {
    return { ids: g.__dotsCloudflareModels.ids, meta: g.__dotsCloudflareModels.meta };
  }

  const token = cloudflareWorkerToken() || "";
  const cleanUrl = url.replace(/\/+$/, "");
  const modelsUrl = cleanUrl.endsWith("/v1") ? `${cleanUrl}/models` : `${cleanUrl}/v1/models`;

  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let rawList: Array<{
    id: string;
    name?: string;
    description?: string;
    context_length?: number;
    parameters?: string;
    category?: "general" | "coding" | "vision" | "fast";
  }> = DEFAULT_CLOUDFLARE_MODELS;

  try {
    const res = await fetch(modelsUrl, { headers });
    if (res.ok) {
      const data = (await res.json()) as { data?: Array<any> };
      if (data?.data && Array.isArray(data.data) && data.data.length > 0) {
        // Merge with defaults to ensure all models are available
        const fetchedIds = new Set(data.data.map((d: any) => d.id));
        rawList = [
          ...data.data,
          ...DEFAULT_CLOUDFLARE_MODELS.filter((m) => !fetchedIds.has(m.id)),
        ];
      }
    }
  } catch {
    // Keep DEFAULT_CLOUDFLARE_MODELS on network errors
  }

  const ids: string[] = [];
  const meta: Record<string, ModelMeta> = {};

  for (const m of rawList) {
    const fullId = CLOUDFLARE_PREFIX + m.id;
    ids.push(fullId);
    meta[fullId] = {
      isFree: true,
      contextLength: m.context_length || 131072,
      contextFormatted: formatContext(m.context_length || 131072),
      parameters: m.parameters || (m.id.includes("70b") ? "70B" : m.id.includes("72b") ? "72B" : m.id.includes("32b") ? "32B" : m.id.includes("90b") ? "90B" : m.id.includes("11b") ? "11B" : "8B"),
      category: m.category || inferCategory(m.id),
      description: m.description || null,
    };
  }

  g.__dotsCloudflareModels = { at: now, ids, meta };
  return { ids, meta };
}

const pick = (ids: string[], prefs: RegExp[]) =>
  prefs.map((re) => ids.find((id) => re.test(cloudflareId(id)))).find(Boolean) ?? ids[0];

export const preferredCloudflareModel = (ids: string[]) => pick(ids, MAIN_PREFERENCE);
export const smallCloudflareModel = (ids: string[]) => pick(ids, SMALL_PREFERENCE);
