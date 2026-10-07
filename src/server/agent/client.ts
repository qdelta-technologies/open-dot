import "server-only";
import OpenAI from "openai";
import { db, getSetting, setSetting } from "../db";
import { seal, unseal } from "../vault";
import {
  cloudflare,
  cloudflareId,
  cloudflareModelsAndMeta,
  cloudflareWorkerUrl,
  DEFAULT_CLOUDFLARE_MODELS,
  isCloudflareModel,
  preferredCloudflareModel,
  smallCloudflareModel,
} from "./cloudflare";
import {
  isOpenRouterModel,
  openModelsAndMeta,
  openRouterId,
  openRouterKey,
  openrouter,
  preferredOpenModel,
  smallOpenModel,
} from "./openrouter";
import {
  groq,
  groqId,
  groqKey,
  groqModelsAndMeta,
  isGroqModel,
} from "./groq";
import {
  googleClient,
  googleId,
  googleKey,
  googleModelsAndMeta,
  isGoogleModel,
  preferredGoogleModel,
  smallGoogleModel,
} from "./google";
import {
  anthropicClient,
  anthropicId,
  anthropicKey,
  anthropicModelsAndMeta,
  isAnthropicModel,
} from "./anthropic";
import type { ModelMeta } from "@/lib/types";

// Models are chosen from what the configured providers can actually use. Precedence:
// dot's own choice → default picked in Settings → DOTS_MODEL → best available.
const MAIN_PREFERENCE = ["gpt-4o", "gpt-4o-mini", "o3-mini", "o1"];
const REVIEW_PREFERENCE = ["gpt-4o-mini", "o3-mini"];

const g = globalThis as unknown as {
  __dotsOpenAI?: OpenAI;
  __dotsOpenAIKey?: string;
  __dotsModels?: Promise<{ main: string; review: string; available: string[]; meta: Record<string, ModelMeta> }>;
  __dotsResolved?: { main: string; review: string; available: string[]; meta: Record<string, ModelMeta> };
};

// The key comes from OPENAI_API_KEY (development) or from Settings, sealed with the vault key (the desktop app).
const KEY_SETTING = "openai_key";

export function apiKey(): string | null {
  const sealed = getSetting(KEY_SETTING);
  if (sealed) {
    try {
      return unseal(sealed);
    } catch {
      // ignore
    }
  }
  return process.env.OPENAI_API_KEY || null;
}

export function hasKey(): boolean {
  return Boolean(apiKey());
}

/** Where the key came from, for Settings. */
export function keySource(): "env" | "settings" | null {
  return getSetting(KEY_SETTING) ? "settings" : process.env.OPENAI_API_KEY ? "env" : null;
}

export function openai(): OpenAI {
  const key = apiKey();
  if (!key) throw new Error("No OpenAI API key yet. Add one in Settings.");
  if (!g.__dotsOpenAI || g.__dotsOpenAIKey !== key) {
    g.__dotsOpenAI = new OpenAI({ apiKey: key });
    g.__dotsOpenAIKey = key;
  }
  return g.__dotsOpenAI;
}

/** Check the key works, then save it (encrypted) and re-pick models for it. Returns an error message or null. */
export async function saveApiKey(key: string): Promise<string | null> {
  try {
    await new OpenAI({ apiKey: key }).models.list();
  } catch (err) {
    return err instanceof Error && /401|Incorrect API key|invalid/i.test(err.message)
      ? "OpenAI didn't accept that key."
      : `Couldn't check the key: ${err instanceof Error ? err.message : String(err)}`;
  }
  setSetting(KEY_SETTING, seal(key));
  resetModels();
  return null;
}

/** Chat-capable models worth offering in a picker (no audio/image/embedding/realtime variants). */
function isAgentModel(id: string): boolean {
  if (!/^(gpt-4|o[1-9])/.test(id)) return false;
  if (/audio|realtime|transcribe|tts|image|embedding|search|moderation|chat-latest|-\d{4}-\d{2}-\d{2}$|0613|0314|1106|0125|preview/.test(id))
    return false;
  return true;
}

function rank(id: string): number {
  const m = id.match(/^gpt-(\d+)(?:\.(\d+))?/);
  const version = m ? Number(m[1]) * 100 + Number(m[2] ?? 0) : id.startsWith("o") ? 400 : 0;
  const tier = /-(pro)/.test(id) ? 0.5 : /-(mini)/.test(id) ? -0.3 : /-(nano)/.test(id) ? -0.6 : 0;
  return version + tier;
}

async function resolveOpenAI(): Promise<{ main: string; review: string; available: string[] } | null> {
  if (!apiKey()) return null;
  let ids: string[] = [];
  try {
    for await (const m of openai().models.list()) ids.push(m.id);
  } catch (err) {
    console.warn("[dots] couldn't list models:", err instanceof Error ? err.message : err);
    return null;
  }
  const set = new Set(ids);
  const pick = (envVar: string | undefined, prefs: string[]) => envVar || prefs.find((id) => set.has(id)) || prefs[0];
  const available = ids.filter(isAgentModel).sort((a, b) => rank(b) - rank(a) || a.localeCompare(b));
  if (available.length === 0) return null;
  return {
    main: pick(process.env.DOTS_MODEL, MAIN_PREFERENCE),
    review: pick(process.env.DOTS_REVIEW_MODEL, REVIEW_PREFERENCE),
    available,
  };
}

/** OpenAI models, Cloudflare Worker models, OpenRouter models, Groq LPU models, and Google Gemini models. */
async function resolve() {
  const [oa, cfData, openData, groqData, googleData, anthropicData] = await Promise.all([
    resolveOpenAI(),
    cloudflareModelsAndMeta().catch((err) => {
      console.warn("[dots] couldn't list Cloudflare models:", err instanceof Error ? err.message : err);
      return { ids: [] as string[], meta: {} as Record<string, ModelMeta> };
    }),
    openModelsAndMeta().catch((err) => {
      console.warn("[dots] couldn't list OpenRouter models:", err instanceof Error ? err.message : err);
      return { ids: [] as string[], meta: {} as Record<string, ModelMeta> };
    }),
    groqModelsAndMeta().catch((err) => {
      console.warn("[dots] couldn't list Groq models:", err instanceof Error ? err.message : err);
      return { ids: [] as string[], meta: {} as Record<string, ModelMeta> };
    }),
    googleModelsAndMeta().catch((err) => {
      console.warn("[dots] couldn't list Google models:", err instanceof Error ? err.message : err);
      return { ids: [] as string[], meta: {} as Record<string, ModelMeta> };
    }),
    Promise.resolve(anthropicModelsAndMeta()),
  ]);

  const cf = cfData.ids;

  let mainDefault = process.env.DOTS_MODEL;
  let reviewDefault = process.env.DOTS_REVIEW_MODEL;

  if (!mainDefault) {
    if (cf.length) mainDefault = preferredCloudflareModel(cf);
    else if (googleData.ids.length) mainDefault = preferredGoogleModel(googleData.ids);
    else if (oa?.main) mainDefault = oa.main;
    else mainDefault = "cloudflare:@cf/meta/llama-4-scout-17b-16e-instruct";
  }

  if (!reviewDefault) {
    if (cf.length) reviewDefault = smallCloudflareModel(cf);
    else if (googleData.ids.length) reviewDefault = smallGoogleModel(googleData.ids);
    else if (oa?.review) reviewDefault = oa.review;
    else reviewDefault = "cloudflare:@cf/meta/llama-3.1-8b-instruct-fast";
  }

  const resolved = {
    main: mainDefault,
    review: reviewDefault,
    available: [...(oa?.available ?? []), ...cf, ...googleData.ids, ...anthropicData.ids, ...openData.ids, ...groqData.ids],
    meta: { ...cfData.meta, ...googleData.meta, ...anthropicData.meta, ...openData.meta, ...groqData.meta },
  };


  g.__dotsResolved = resolved;
  console.log(`[dots] default ${resolved.main} (agent), ${resolved.review} (rule review); ${resolved.available.length} models available`);
  return resolved;
}

/** Forget the resolved model list (a key/URL was added or removed). */
export function resetModels() {
  g.__dotsModels = undefined;
  g.__dotsResolved = undefined;
}
(globalThis as any).__dotsResetModels = resetModels;

/** The API client for a model, the model id that API expects, and whether it keeps conversation state. */
export function clientFor(model: string): { client: OpenAI; model: string; stateless: boolean } {
  if (isCloudflareModel(model)) {
    return { client: cloudflare(), model: cloudflareId(model), stateless: true };
  }
  if (isGroqModel(model)) {
    return { client: groq(), model: groqId(model), stateless: true };
  }
  if (isGoogleModel(model)) {
    return { client: googleClient(), model: googleId(model), stateless: true };
  }
  if (isAnthropicModel(model)) {
    return { client: anthropicClient(), model: anthropicId(model), stateless: true };
  }
  if (isOpenRouterModel(model)) {
    return { client: openrouter(), model: openRouterId(model), stateless: true };
  }
  return { client: openai(), model, stateless: false };
}

/** True when any model provider is set up (Cloudflare, OpenAI, OpenRouter, Groq, or Google). */
export function canThink(): boolean {
  return hasKey() || Boolean(cloudflareWorkerUrl()) || Boolean(openRouterKey()) || Boolean(groqKey()) || Boolean(googleKey()) || Boolean(anthropicKey());
}

export function models(): Promise<{ main: string; review: string; available: string[]; meta: Record<string, ModelMeta> }> {
  g.__dotsModels ??= resolve().catch((err) => {
    g.__dotsModels = undefined;
    throw err;
  });
  return g.__dotsModels;
}

/** The model a dot should run on right now. */
export async function modelFor(dotModel: string | null): Promise<string> {
  const m = await models();
  // Groq/Google retire model IDs; a stored ID that's no longer listed would 404 forever.
  const usable = (id: string | null | undefined): id is string =>
    Boolean(id) &&
    !(id!.startsWith("openrouter:") && !openRouterKey()) &&
    !((id!.startsWith("groq:") || id!.startsWith("google:")) && m.available.length > 0 && !m.available.includes(id!));
  if (usable(dotModel)) return dotModel;
  const def = getSetting("default_model");
  if (usable(def)) return def;
  return m.main;
}

/** Best-known model info for display, without blocking. */
export function knownModels(): { main: string; review: string; available: string[]; defaultModel: string; meta: Record<string, ModelMeta> } {
  if (!g.__dotsResolved && (cloudflareWorkerUrl() || openRouterKey() || groqKey() || hasKey())) {
    void resolve();
  }
  const cfUrl = cloudflareWorkerUrl();
  const r = g.__dotsResolved ?? {
    main: process.env.DOTS_MODEL || (cfUrl ? "cloudflare:@cf/meta/llama-4-scout-17b-16e-instruct" : MAIN_PREFERENCE[0]),
    review: process.env.DOTS_REVIEW_MODEL || (cfUrl ? "cloudflare:@cf/meta/llama-3.1-8b-instruct-fast" : REVIEW_PREFERENCE[0]),
    available: cfUrl ? DEFAULT_CLOUDFLARE_MODELS.map((m) => "cloudflare:" + m.id) : [],
    meta: {},
  };
  const def = getSetting("default_model");
  return { ...r, defaultModel: def || r.main };
}

/** gpt-5.x / gpt-6 / o-series accept `reasoning`; gpt-4.1 and friends reject it. */
export function isReasoningModel(model: string): boolean {
  return !isCloudflareModel(model) && !isOpenRouterModel(model) && /^(gpt-[5-9]|o[1-9])/.test(model) && !/chat/.test(model);
}

/** OpenAI's GA computer tool needs a recent model; older ones get the page-reading tools only. */
export function supportsComputerTool(model: string): boolean {
  return /^gpt-5\.[4-9]|^gpt-[6-9]|computer-use/.test(model);
}
