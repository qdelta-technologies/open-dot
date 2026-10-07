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
  /@cf\/meta\/llama-4-scout/i,
  /@cf\/meta\/llama-3\.1-8b/i,
  /@cf\/qwen\/qwen2\.5-coder/i,
  /@cf\/deepseek-ai\/deepseek-r1/i,
];

const SMALL_PREFERENCE = [
  /@cf\/meta\/llama-3\.1-8b/i,
  /@cf\/meta\/llama-4-scout/i,
  /@cf\/qwen/i,
];

const g = globalThis as unknown as {
  __dotsCloudflare?: { url: string; token?: string; client: OpenAI };
  __dotsCloudflareClients?: Map<string, OpenAI>;
  __dotsCloudflareExhausted?: Map<string, number>;
  __dotsCloudflareModels?: { at: number; ids: string[]; meta: Record<string, ModelMeta> };
};

export const DEFAULT_WORKER_URL = "https://opendot-worker.qdelta-work.workers.dev";
export const DEFAULT_WORKER_URLS = [
  "https://opendot-worker.qdelta-work.workers.dev",
  "https://opendot-worker.saiprabathn.workers.dev",
];

function envUrl(): string | null {
  return process.env.CLOUDFLARE_WORKER_URL || null;
}

function envToken(): string | null {
  return process.env.CLOUDFLARE_WORKER_TOKEN || null;
}

const EXHAUSTED_SETTING = "cf_exhausted_workers";

function getExhaustedMap(): Map<string, number> {
  const map = new Map<string, number>();
  if (g.__dotsCloudflareExhausted) {
    for (const [k, v] of g.__dotsCloudflareExhausted.entries()) {
      map.set(k, v);
    }
  }
  try {
    const raw = getSetting(EXHAUSTED_SETTING);
    if (raw) {
      const obj = JSON.parse(raw);
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "number") map.set(k, Math.max(v, map.get(k) ?? 0));
      }
    }
  } catch {}
  return map;
}

function saveExhaustedMap(map: Map<string, number>) {
  g.__dotsCloudflareExhausted = map;
  try {
    const obj: Record<string, number> = {};
    for (const [k, v] of map.entries()) obj[k] = v;
    setSetting(EXHAUSTED_SETTING, JSON.stringify(obj));
  } catch {}
}

export function clearExhaustedWorkers() {
  g.__dotsCloudflareExhausted = new Map();
  try {
    setSetting(EXHAUSTED_SETTING, null);
  } catch {}
}

/** Parses configured worker URLs into a clean array. Combines settings, env variables, and defaults. */
export function cloudflareWorkerUrls(): string[] {
  const settingRaw = getSetting(URL_SETTING) || "";
  const envRaw = envUrl() || "";
  const combined = `${settingRaw},${envRaw}`;
  const list = Array.from(
    new Set(
      combined
        .split(/[\n,]+/)
        .map((u) => u.trim().replace(/\/+$/, ""))
        .filter(Boolean)
    )
  );
  return list.length ? list : DEFAULT_WORKER_URLS;
}

/** Check which workers are still available (not marked exhausted within the last 12 hours). */
export function getAvailableWorkerUrls(): string[] {
  const all = cloudflareWorkerUrls();
  const exhausted = getExhaustedMap();
  const now = Date.now();
  let changed = false;
  // Clear entries older than 12 hours (daily reset window)
  for (const [u, ts] of exhausted.entries()) {
    if (now - ts > 12 * 60 * 60 * 1000) {
      exhausted.delete(u);
      changed = true;
    }
  }
  if (changed) saveExhaustedMap(exhausted);

  const available = all.filter((u) => !exhausted.has(u));
  return available.length ? available : all;
}

/** Mark a specific worker URL as exhausted (e.g. 10,000 neurons daily limit reached). */
export function markWorkerExhausted(url: string, reason?: string) {
  const clean = url.trim().replace(/\/+$/, "");
  const exhausted = getExhaustedMap();
  exhausted.set(clean, Date.now());
  saveExhaustedMap(exhausted);
  console.warn(`[cloudflare] Marked worker ${clean} as exhausted (${reason ?? "quota"}). Remaining active workers: ${getAvailableWorkerUrls().length}`);
}

export function cloudflareWorkerUrl(): string | null {
  const available = getAvailableWorkerUrls();
  return available[0] ?? DEFAULT_WORKER_URL;
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

export const cloudflareSource = (): "env" | "settings" | "default" | null =>
  getSetting(URL_SETTING) ? "settings" : envUrl() ? "env" : DEFAULT_WORKER_URL ? "default" : null;

export const isCloudflareModel = (model: string) =>
  model.startsWith(CLOUDFLARE_PREFIX) || model.startsWith("@cf/");

export const cloudflareId = (model: string) =>
  model.startsWith(CLOUDFLARE_PREFIX) ? model.slice(CLOUDFLARE_PREFIX.length) : model;

export function cloudflareForUrl(url: string): OpenAI {
  const token = cloudflareWorkerToken() || "dummy-token";
  const cleanUrl = url.replace(/\/+$/, "");
  const baseURL = cleanUrl.endsWith("/v1") ? cleanUrl : `${cleanUrl}/v1`;

  const clients = (g.__dotsCloudflareClients ??= new Map());
  let client = clients.get(cleanUrl);
  if (!client) {
    client = new OpenAI({
      apiKey: token,
      baseURL,
    });
    clients.set(cleanUrl, client);
  }
  return client;
}

export function cloudflare(): OpenAI {
  const url = cloudflareWorkerUrl();
  if (!url) throw new Error("No Cloudflare Worker URL set. Add one in Settings.");
  return cloudflareForUrl(url);
}

/** Check the worker URL and token by listing models. Supports comma-separated multiple URLs. */
export async function saveCloudflareConfig(urlInput: string, tokenInput?: string): Promise<string | null> {
  const rawUrls = urlInput.split(/[\n,]+/).map((u) => u.trim()).filter(Boolean);
  const token = tokenInput ? tokenInput.trim() : "";

  if (!rawUrls.length) {
    setSetting(URL_SETTING, null);
    setSetting(TOKEN_SETTING, null);
    g.__dotsCloudflare = undefined;
    g.__dotsCloudflareClients = undefined;
    g.__dotsCloudflareExhausted = undefined;
    g.__dotsCloudflareModels = undefined;
    (globalThis as any).__dotsResetModels?.();
    return null;
  }

  // Validate format of each URL
  for (const u of rawUrls) {
    try {
      new URL(u);
    } catch {
      return `Please enter a valid URL: "${u}"`;
    }
  }

  // Test the first URL to verify endpoint connectivity
  const testUrl = rawUrls[0].replace(/\/+$/, "");
  const checkUrl = testUrl.endsWith("/v1") ? `${testUrl}/models` : `${testUrl}/v1/models`;

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

  const cleaned = rawUrls.map((u) => u.replace(/\/+$/, "")).join(", ");
  setSetting(URL_SETTING, cleaned);
  setSetting(TOKEN_SETTING, token ? seal(token) : null);
  clearExhaustedWorkers();
  g.__dotsCloudflare = undefined;
  g.__dotsCloudflareClients = undefined;
  g.__dotsCloudflareModels = undefined;
  (globalThis as any).__dotsResetModels?.();
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
  if (lower.includes("vision") || lower.includes("mistral-small")) return "vision";
  if (lower.includes("coder") || lower.includes("sql")) return "coding";
  if (
    lower.includes("1b") ||
    lower.includes("3b") ||
    lower.includes("8b")
  ) return "fast";
  return "general";
}

export const DEFAULT_CLOUDFLARE_MODELS = [
  // ── Flagship Reasoning & Multimodal Agent ──
  { id: "@cf/meta/llama-4-scout-17b-16e-instruct", name: "Meta Llama 4 Scout 17B (16E MoE)", parameters: "17B MoE", context_length: 131072, category: "general" as const, description: "Meta's flagship multimodal mixture-of-experts model for text, vision, and agentic workflows" },
  { id: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b", name: "DeepSeek R1 Distill Qwen 32B", parameters: "32B", context_length: 131072, category: "general" as const, description: "DeepSeek R1 chain-of-thought reasoning architecture distilled into 32B parameters" },
  { id: "@cf/qwen/qwq-32b", name: "QwQ 32B Reasoning", parameters: "32B", context_length: 32768, category: "general" as const, description: "Alibaba's advanced thinking and reasoning model competing with DeepSeek-R1 and o1-mini" },

  // ── Coding & Technical ──
  { id: "@cf/qwen/qwen2.5-coder-32b-instruct", name: "Qwen 2.5 Coder 32B Instruct", parameters: "32B", context_length: 32768, category: "coding" as const, description: "Premier open-source code generation, debugging, and multi-file architecture" },

  // ── Vision & Multimodal ──
  { id: "@cf/mistralai/mistral-small-3.1-24b-instruct", name: "Mistral Small 3.1 24B (Vision & Text)", parameters: "24B Vision", context_length: 131072, category: "vision" as const, description: "State-of-the-art vision understanding and 128k context without compromising text speed" },

  // ── Large Frontier ──
  { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", name: "Llama 3.3 70B Instruct", parameters: "70B", context_length: 131072, category: "general" as const, description: "Meta's powerful 70B model in fast FP8 precision — best free open model for complex tasks" },
  { id: "@cf/openai/gpt-oss-120b", name: "GPT-OSS 120B", parameters: "120B", context_length: 131072, category: "general" as const, description: "OpenAI's 120B open-weights model for high-capability reasoning and instruction following" },
  { id: "@cf/openai/gpt-oss-20b", name: "GPT-OSS 20B", parameters: "20B", context_length: 131072, category: "general" as const, description: "OpenAI's efficient 20B open-weights model balancing capability and speed" },

  // ── DeepSeek V4 ──
  { id: "@cf/deepseek-ai/deepseek-v4-flash-0731", name: "DeepSeek V4 Flash", parameters: "Fast", context_length: 131072, category: "general" as const, description: "DeepSeek V4 Flash — fast and cost-efficient next-generation reasoning model" },
  { id: "@cf/deepseek-ai/deepseek-v4-pro-0813", name: "DeepSeek V4 Pro", parameters: "Pro", context_length: 131072, category: "general" as const, description: "DeepSeek V4 Pro — full-capability frontier reasoning and agentic model" },

  // ── Qwen 3.8 ──
  { id: "@cf/qwen/qwen3.8-27b", name: "Qwen 3.8 27B", parameters: "27B", context_length: 131072, category: "general" as const, description: "Alibaba's latest Qwen 3.8 generation 27B model with strong reasoning and instruction following" },

  // ── Coding & Technical ──
  { id: "@cf/moonshotai/kimi-k2.7-code", name: "Kimi K2.7 Code", parameters: "Code", context_length: 131072, category: "coding" as const, description: "Moonshot AI's code-specialized model for generation, debugging, and architecture" },

  // ── Multilingual ──
  { id: "@cf/zai-org/glm-4.7-flash", name: "GLM 4.7 Flash", parameters: "Flash", context_length: 131072, category: "fast" as const, description: "Fast multilingual model with tool calling across 100+ languages" },
  { id: "@cf/zai-org/glm-5.2", name: "GLM 5.2", parameters: "Agentic", context_length: 131072, category: "general" as const, description: "ZAI GLM 5.2 optimized for agentic coding workflows with function calling and reasoning" },

  // ── Fast, Light & High-Throughput (Ultra Low Neurons) ──
  { id: "@cf/meta/llama-3.1-8b-instruct-fast", name: "Llama 3.1 8B Instruct Fast", parameters: "8B Fast", context_length: 65536, category: "fast" as const, description: "Instant edge response optimized for speed, low latency, and minimal neuron consumption" },
  { id: "@cf/meta/llama-3.1-8b-instruct-fp8", name: "Llama 3.1 8B (Fast FP8)", parameters: "8B FP8", context_length: 131072, category: "fast" as const, description: "Llama 3.1 8B quantized to FP8 precision for ultra-low latency edge responses" },
  { id: "@cf/meta/llama-3.2-3b-instruct", name: "Llama 3.2 3B Instruct", parameters: "3B", context_length: 131072, category: "fast" as const, description: "Ultra-fast low-latency agent execution and routine tasks" },
  { id: "@cf/meta/llama-3.2-1b-instruct", name: "Llama 3.2 1B Instruct", parameters: "1B", context_length: 131072, category: "fast" as const, description: "Instant sub-second edge response for quick status checks and summaries" },
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
