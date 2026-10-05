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
  if (lower.includes("vision") || lower.includes("moondream") || lower.includes("mistral-small") || lower.includes("uform")) return "vision";
  if (lower.includes("coder") || lower.includes("sql") || lower.includes("glm-5.3") || lower.includes("kimi-k2.7")) return "coding";
  if (
    lower.includes("1b") ||
    lower.includes("3b") ||
    lower.includes("fp8") && lower.includes("8b") ||
    lower.includes("gpt-oss-20b") ||
    lower.includes("glm-4.7") ||
    lower.includes("granite") ||
    lower.includes("mistral-7b") ||
    lower.includes("gemma")
  ) return "fast";
  return "general";
}

export const DEFAULT_CLOUDFLARE_MODELS = [
  // ── General Chat & Flagship Reasoning ──
  { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", name: "Llama 3.3 70B Instruct (Fast FP8)", parameters: "70B", context_length: 131072, category: "general" as const, description: "Flagship 70B model running on high-speed FP8 edge GPU hardware" },
  { id: "@cf/meta/llama-4-scout-17b-16e-instruct", name: "Meta Llama 4 Scout 17B (16E MoE)", parameters: "17B MoE", context_length: 131072, category: "general" as const, description: "Meta's flagship multimodal mixture-of-experts model for text, vision, and agentic workflows" },
  { id: "@cf/qwen/qwq-32b", name: "QwQ 32B Reasoning", parameters: "32B", context_length: 32768, category: "general" as const, description: "Alibaba's advanced thinking and reasoning model competing with DeepSeek-R1 and o1-mini" },
  { id: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b", name: "DeepSeek R1 Distill Qwen 32B", parameters: "32B", context_length: 131072, category: "general" as const, description: "DeepSeek R1 chain-of-thought reasoning architecture distilled into 32B" },
  { id: "@cf/qwen/qwen2.5-72b-instruct", name: "Qwen 2.5 72B Instruct", parameters: "72B", context_length: 32768, category: "general" as const, description: "Advanced 72B reasoning and structured thinking with high precision" },
  { id: "@cf/nvidia/nemotron-3-120b-a12b", name: "NVIDIA Nemotron 3 Super 120B", parameters: "120B", context_length: 262144, category: "general" as const, description: "NVIDIA's hybrid MoE flagship with leading accuracy for multi-agent applications" },
  { id: "@cf/openai/gpt-oss-120b", name: "OpenAI GPT-OSS 120B", parameters: "120B", context_length: 131072, category: "general" as const, description: "OpenAI's open-weight model designed for production reasoning and agentic tasks" },
  { id: "@cf/qwen/qwen3.8-27b", name: "Qwen 3.8 27B Agentic", parameters: "27B", context_length: 131072, category: "general" as const, description: "Alibaba's 27B instruction-tuned model designed for vision, text generation, and agentic workloads" },
  { id: "@cf/qwen/qwen3-30b-a3b-fp8", name: "Qwen 3 30B FP8 (MoE)", parameters: "30B MoE", context_length: 32768, category: "general" as const, description: "Next-gen MoE model with groundbreaking reasoning, agent capabilities, and multilingual support" },
  { id: "@cf/moonshotai/kimi-k2.6", name: "Kimi K2.6 (1T MoE Agentic)", parameters: "1T MoE", context_length: 262144, category: "general" as const, description: "Frontier-scale 1T parameter model with 262k context and multi-turn tool calling" },
  { id: "@cf/zai-org/glm-5.3-flash", name: "GLM 5.3 Flash (320B MoE)", parameters: "320B MoE", context_length: 131072, category: "general" as const, description: "Natively multimodal 320B model (18B active) approaching frontier intelligence at high speed" },
  { id: "@cf/meta/llama-3.1-70b-instruct", name: "Llama 3.1 70B Instruct", parameters: "70B", context_length: 131072, category: "general" as const, description: "High-intelligence 70B general knowledge and complex instruction following" },
  { id: "@cf/meta/llama-3.1-8b-instruct", name: "Llama 3.1 8B Instruct", parameters: "8B", context_length: 131072, category: "general" as const, description: "Capable 8B model with wide knowledge base and low edge latency" },

  // ── Coding & Technical ──
  { id: "@cf/qwen/qwen2.5-coder-32b-instruct", name: "Qwen 2.5 Coder 32B Instruct", parameters: "32B", context_length: 32768, category: "coding" as const, description: "Premier open-source code generation, debugging, and multi-file architecture" },
  { id: "@cf/zai-org/glm-5.3", name: "GLM 5.3 Agentic Coder (1M ctx)", parameters: "1M Coder", context_length: 1048576, category: "coding" as const, description: "Flagship agentic coding model with 1M context window and tool-driven development workflows" },
  { id: "@cf/moonshotai/kimi-k2.7-code", name: "Kimi K2.7 Code (1T MoE)", parameters: "1T Coder", context_length: 262144, category: "coding" as const, description: "Frontier-scale 1T MoE model with 262k context, structured outputs, and coding excellence" },
  { id: "@cf/deepseek-ai/deepseek-coder-6.7b-instruct", name: "DeepSeek Coder 6.7B Instruct", parameters: "6.7B", context_length: 16384, category: "coding" as const, description: "Fast, specialized code completion, syntax analysis, and scripting" },
  { id: "@cf/defog/sqlcoder-7b-2", name: "SQLCoder 7B-2", parameters: "7B", context_length: 8192, category: "coding" as const, description: "State-of-the-art text-to-SQL generation and database query optimization" },

  // ── Vision & Multimodal ──
  { id: "@cf/mistralai/mistral-small-3.1-24b-instruct", name: "Mistral Small 3.1 24B (Vision 128k)", parameters: "24B Vision", context_length: 131072, category: "vision" as const, description: "State-of-the-art vision understanding and 128k context without compromising text speed" },
  { id: "@cf/meta/llama-3.2-11b-vision-instruct", name: "Llama 3.2 11B Vision Instruct", parameters: "11B Vision", context_length: 131072, category: "vision" as const, description: "Multimodal text and image understanding, document and UI inspection" },
  { id: "@cf/meta/llama-3.2-90b-vision-instruct", name: "Llama 3.2 90B Vision Instruct", parameters: "90B Vision", context_length: 131072, category: "vision" as const, description: "High-resolution multimodal visual reasoning and detailed image comprehension" },
  { id: "@cf/moondream/moondream3.1-9B-A2B", name: "Moondream 3.1 9B Vision", parameters: "9B Vision", context_length: 32768, category: "vision" as const, description: "Fast, efficient 9B MoE vision language model for OCR, UI pointing, and object detection" },

  // ── Fast, Light & Edge ──
  { id: "@cf/meta/llama-3.2-3b-instruct", name: "Llama 3.2 3B Instruct", parameters: "3B", context_length: 131072, category: "fast" as const, description: "Ultra-fast low-latency agent execution and routine tasks" },
  { id: "@cf/meta/llama-3.2-1b-instruct", name: "Llama 3.2 1B Instruct", parameters: "1B", context_length: 131072, category: "fast" as const, description: "Instant sub-second edge response for quick status checks and summaries" },
  { id: "@cf/meta/llama-3.1-8b-instruct-fp8", name: "Llama 3.1 8B (Fast FP8)", parameters: "8B FP8", context_length: 131072, category: "fast" as const, description: "Llama 3.1 8B quantized to FP8 precision for ultra-low latency edge responses" },
  { id: "@cf/openai/gpt-oss-20b", name: "OpenAI GPT-OSS 20B", parameters: "20B", context_length: 65536, category: "fast" as const, description: "OpenAI's open-weight model for lower latency and efficient developer workflows" },
  { id: "@cf/zai-org/glm-4.7-flash", name: "GLM 4.7 Flash (128k ctx)", parameters: "Flash 128k", context_length: 131072, category: "fast" as const, description: "Fast multilingual model with 131k context window and multi-turn tool calling" },
  { id: "@cf/ibm-granite/granite-4.0-h-micro", name: "IBM Granite 4.0 Micro", parameters: "Micro", context_length: 32768, category: "fast" as const, description: "Efficient agentic model built for tool calling, instruction following, and RAG" },
  { id: "@cf/mistral/mistral-7b-instruct-v0.2", name: "Mistral 7B Instruct v0.2", parameters: "7B", context_length: 32768, category: "fast" as const, description: "Reliable, high-throughput lightweight general reasoning" },
  { id: "@cf/google/gemma-2-9b-it", name: "Google Gemma 2 9B IT", parameters: "9B", context_length: 8192, category: "fast" as const, description: "Google's efficient 9B instruction-tuned model built on Gemini tech" },
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
