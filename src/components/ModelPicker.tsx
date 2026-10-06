"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Cloud,
  Search,
  Sparkles,
} from "lucide-react";
import { useStore } from "@/lib/store";

const CF = "cloudflare:";

export type ModelCategory = "all" | "general" | "coding" | "vision" | "fast";

function parseModelId(id: string): {
  cleanId: string;
  name: string;
  category: "general" | "coding" | "vision" | "fast";
  badge?: string;
  desc?: string;
} {
  const isCf = id.startsWith(CF);
  const raw = isCf ? id.slice(CF.length) : id;
  const lower = raw.toLowerCase();

  // Categories & labels for Cloudflare Workers AI and common models
  if (lower.includes("llama-4-scout")) {
    return {
      cleanId: raw,
      name: "Meta Llama 4 Scout 17B",
      category: "general",
      badge: "Llama 4",
      desc: "Meta's flagship multimodal mixture-of-experts model for text, vision & agentic workflows",
    };
  }
  if (lower.includes("qwq-32b")) {
    return {
      cleanId: raw,
      name: "QwQ 32B Reasoning",
      category: "general",
      badge: "Reasoning",
      desc: "Alibaba's advanced thinking and reasoning model competing with DeepSeek-R1 and o1",
    };
  }
  if (lower.includes("nemotron-3-ultra-550b") || lower.includes("ultra-550b")) {
    return {
      cleanId: raw,
      name: "NVIDIA Nemotron 3 Ultra 550B",
      category: "general",
      badge: "550B MoE",
      desc: "NVIDIA's massive 550B MoE flagship with frontier-grade reasoning",
    };
  }
  if (lower.includes("nemotron-3-nano-omni") || lower.includes("nano-omni")) {
    return {
      cleanId: raw,
      name: "NVIDIA Nemotron 3 Nano Omni 30B",
      category: "general",
      badge: "Omni 30B",
      desc: "NVIDIA's 30B omni reasoning model with structured thinking",
    };
  }
  if (lower.includes("nemotron-3.5-lightning") || lower.includes("nemotron-3.5")) {
    return {
      cleanId: raw,
      name: "NVIDIA Nemotron 3.5 Lightning",
      category: "fast",
      badge: "Lightning",
      desc: "NVIDIA's ultra-fast agentic reasoning and function calling model",
    };
  }
  if (lower.includes("nemotron-3")) {
    return {
      cleanId: raw,
      name: "NVIDIA Nemotron 3 120B",
      category: "general",
      badge: "Nemotron",
      desc: "NVIDIA's hybrid MoE flagship with leading accuracy for multi-agent applications",
    };
  }
  if (lower.includes("gemma-4-31b")) {
    return {
      cleanId: raw,
      name: "Google Gemma 4 31B IT",
      category: "general",
      badge: "Gemma 4",
      desc: "Google's 31B flagship open model with state-of-the-art reasoning",
    };
  }
  if (lower.includes("gemma-4-26b")) {
    return {
      cleanId: raw,
      name: "Google Gemma 4 26B-A4B IT",
      category: "general",
      badge: "Gemma 4",
      desc: "Google's 26B MoE instruction model built on Gemini research",
    };
  }
  if (lower.includes("laguna-s")) {
    return {
      cleanId: raw,
      name: "Poolside Laguna S 2.1",
      category: "coding",
      badge: "Coder",
      desc: "Poolside's specialized software engineering and coding model",
    };
  }
  if (lower.includes("laguna-xs")) {
    return {
      cleanId: raw,
      name: "Poolside Laguna XS 2.1",
      category: "coding",
      badge: "Fast Code",
      desc: "Lightweight code synthesis and debugging model by Poolside",
    };
  }
  if (lower.includes("north-mini-code")) {
    return {
      cleanId: raw,
      name: "Cohere North Mini Code",
      category: "coding",
      badge: "Code",
      desc: "Cohere's compact code generation and programming agent",
    };
  }
  if (lower.includes("inkling-small")) {
    return {
      cleanId: raw,
      name: "Thinking Machines Inkling Small",
      category: "fast",
      badge: "Small",
      desc: "Lightweight tool-calling and reasoning model",
    };
  }
  if (lower.includes("inkling")) {
    return {
      cleanId: raw,
      name: "Thinking Machines Inkling",
      category: "general",
      badge: "Agentic",
      desc: "Frontier tool-calling and problem-solving model",
    };
  }
  if (lower.includes("ling-3.1") || lower.includes("ling-3.0")) {
    return {
      cleanId: raw,
      name: "Ling 3.1 Flash",
      category: "fast",
      badge: "Flash",
      desc: "High-speed reasoning and tool-calling model by Inclusion AI",
    };
  }
  if (lower.includes("lfm-2.5") || lower.includes("liquid")) {
    return {
      cleanId: raw,
      name: "Liquid LFM 2.5 2.6B",
      category: "fast",
      badge: "Edge",
      desc: "Liquid neural network architecture for ultra-fast edge inference",
    };
  }

  if (lower.includes("openrouter/free")) {
    return {
      cleanId: raw,
      name: "OpenRouter Auto Free Router",
      category: "general",
      badge: "Auto Free",
      desc: "Automatically routes to the best available free model on OpenRouter",
    };
  }
  if (lower.includes("gpt-oss-120b")) {
    return {
      cleanId: raw,
      name: "OpenAI GPT-OSS 120B",
      category: "general",
      badge: "OpenAI OSS",
      desc: "OpenAI's open-weight model designed for production reasoning and agentic tasks",
    };
  }
  if (lower.includes("gpt-oss-20b")) {
    return {
      cleanId: raw,
      name: "OpenAI GPT-OSS 20B",
      category: "fast",
      badge: "Fast OSS",
      desc: "OpenAI's open-weight model for lower latency and efficient developer workflows",
    };
  }
  if (lower.includes("qwen3.8-27b")) {
    return {
      cleanId: raw,
      name: "Qwen 3.8 27B Agentic",
      category: "general",
      badge: "Agentic",
      desc: "Alibaba's 27B instruction-tuned model designed for vision & agentic workloads",
    };
  }
  if (lower.includes("qwen3-30b")) {
    return {
      cleanId: raw,
      name: "Qwen 3 30B FP8 (MoE)",
      category: "general",
      badge: "MoE FP8",
      desc: "Next-gen MoE model with groundbreaking reasoning & multilingual support",
    };
  }
  if (lower.includes("kimi-k2.7") || (lower.includes("kimi") && lower.includes("code"))) {
    return {
      cleanId: raw,
      name: "Kimi K2.7 Code (1T MoE)",
      category: "coding",
      badge: "1T Coder",
      desc: "Frontier-scale 1T MoE model with 262k context, structured outputs & coding excellence",
    };
  }
  if (lower.includes("kimi-k2.6")) {
    return {
      cleanId: raw,
      name: "Kimi K2.6 (1T MoE Agentic)",
      category: "general",
      badge: "1T MoE",
      desc: "Frontier-scale 1T parameter model with 262k context and multi-turn tool calling",
    };
  }
  if (lower.includes("glm-5.3-flash")) {
    return {
      cleanId: raw,
      name: "GLM 5.3 Flash (320B MoE)",
      category: "general",
      badge: "Frontier",
      desc: "Natively multimodal 320B model (18B active) approaching frontier intelligence",
    };
  }
  if (lower.includes("glm-5.3")) {
    return {
      cleanId: raw,
      name: "GLM 5.3 Agentic Coder (1M)",
      category: "coding",
      badge: "1M Context",
      desc: "Flagship agentic coding model with 1M context window and tool-driven development",
    };
  }
  if (lower.includes("glm-4.7")) {
    return {
      cleanId: raw,
      name: "GLM 4.7 Flash (128k ctx)",
      category: "fast",
      badge: "Flash 128k",
      desc: "Fast multilingual model with 131k context window and multi-turn tool calling",
    };
  }
  if (lower.includes("mistral-small-3.1") || lower.includes("mistral-small")) {
    return {
      cleanId: raw,
      name: "Mistral Small 3.1 24B",
      category: "vision",
      badge: "128k Vision",
      desc: "State-of-the-art vision understanding and 128k context without compromising speed",
    };
  }
  if (lower.includes("moondream")) {
    return {
      cleanId: raw,
      name: "Moondream 3.1 9B Vision",
      category: "vision",
      badge: "OCR & UI",
      desc: "Fast, efficient 9B MoE vision language model for OCR, UI pointing & object detection",
    };
  }
  if (lower.includes("granite-4.0") || lower.includes("granite")) {
    return {
      cleanId: raw,
      name: "IBM Granite 4.0 Micro",
      category: "fast",
      badge: "Micro",
      desc: "Efficient agentic model built for tool calling, instruction following & RAG",
    };
  }
  if (lower.includes("llama-3.1-8b-instruct-fast") || lower.includes("8b-instruct-fast")) {
    return {
      cleanId: raw,
      name: "Llama 3.1 8B Instruct Fast",
      category: "fast",
      badge: "Fast Edge",
      desc: "High-throughput 8B model optimized for real-time conversation and edge latency",
    };
  }
  if (lower.includes("llama-3.1-8b-instruct-fp8") || (lower.includes("8b") && lower.includes("fp8"))) {
    return {
      cleanId: raw,
      name: "Llama 3.1 8B (Fast FP8)",
      category: "fast",
      badge: "Fast FP8",
      desc: "Llama 3.1 8B quantized to FP8 precision for ultra-low latency edge responses",
    };
  }
  if (lower.includes("llama-3.3-70b")) {
    return {
      cleanId: raw,
      name: "Llama 3.3 70B (Fast FP8)",
      category: "general",
      badge: "Flagship",
      desc: "Meta's flagship 70B model running on high-speed FP8 edge hardware",
    };
  }
  if (lower.includes("qwen2.5-72b")) {
    return {
      cleanId: raw,
      name: "Qwen 2.5 72B Instruct",
      category: "general",
      badge: "Reasoning",
      desc: "Alibaba's advanced 72B reasoning and structured thinking engine",
    };
  }
  if (lower.includes("deepseek-r1")) {
    return {
      cleanId: raw,
      name: "DeepSeek R1 32B",
      category: "general",
      badge: "Chain of Thought",
      desc: "DeepSeek R1 reasoning architecture distilled into 32B parameters",
    };
  }
  if (lower.includes("coder-32b") || (lower.includes("qwen") && lower.includes("coder"))) {
    return {
      cleanId: raw,
      name: "Qwen 2.5 Coder 32B",
      category: "coding",
      badge: "Top Coder",
      desc: "Premier open-source code generation, debugging & refactoring",
    };
  }
  if (lower.includes("deepseek-coder")) {
    return {
      cleanId: raw,
      name: "DeepSeek Coder 6.7B",
      category: "coding",
      badge: "Fast Code",
      desc: "Specialized code completion, syntax analysis & scripting",
    };
  }
  if (lower.includes("sqlcoder")) {
    return {
      cleanId: raw,
      name: "SQLCoder 7B-2",
      category: "coding",
      badge: "SQL DB",
      desc: "State-of-the-art text-to-SQL query generation",
    };
  }
  if (lower.includes("90b-vision")) {
    return {
      cleanId: raw,
      name: "Llama 3.2 90B Vision",
      category: "vision",
      badge: "Vision 90B",
      desc: "High-resolution multimodal visual reasoning & chart analysis",
    };
  }
  if (lower.includes("vision") || lower.includes("uform")) {
    return {
      cleanId: raw,
      name: "Llama 3.2 11B Vision",
      category: "vision",
      badge: "Vision",
      desc: "Multimodal text and image understanding, document inspection",
    };
  }
  if (lower.includes("llama-3.2-3b")) {
    return {
      cleanId: raw,
      name: "Llama 3.2 3B Instruct",
      category: "fast",
      badge: "Ultra Fast",
      desc: "Ultra-fast low-latency agent execution & routine tasks",
    };
  }
  if (lower.includes("llama-3.2-1b")) {
    return {
      cleanId: raw,
      name: "Llama 3.2 1B Instruct",
      category: "fast",
      badge: "Sub-Second",
      desc: "Instant sub-second edge response for quick status checks",
    };
  }
  if (lower.includes("mistral-7b")) {
    return {
      cleanId: raw,
      name: "Mistral 7B Instruct v0.2",
      category: "fast",
      badge: "Fast 7B",
      desc: "Reliable, high-throughput lightweight general reasoning",
    };
  }
  if (lower.includes("gemma-2-9b")) {
    return {
      cleanId: raw,
      name: "Google Gemma 2 9B IT",
      category: "fast",
      badge: "Gemma 2",
      desc: "Google's efficient 9B model built on Gemini research",
    };
  }
  if (lower.includes("llama-3.1-70b")) {
    return {
      cleanId: raw,
      name: "Llama 3.1 70B Instruct",
      category: "general",
      badge: "70B",
      desc: "High-intelligence 70B general knowledge & instruction following",
    };
  }
  if (lower.includes("llama-3.1-8b")) {
    return {
      cleanId: raw,
      name: "Llama 3.1 8B Instruct",
      category: "general",
      badge: "Edge",
      desc: "Capable 8B model with wide knowledge base & fast latency",
    };
  }
  if (lower.includes("gpt-4o-mini")) {
    return {
      cleanId: raw,
      name: "GPT-4o Mini",
      category: "fast",
      badge: "Fast",
      desc: "Fast, intelligent OpenAI multimodal model",
    };
  }
  if (lower.includes("gpt-4o")) {
    return {
      cleanId: raw,
      name: "GPT-4o",
      category: "general",
      badge: "Flagship",
      desc: "OpenAI flagship reasoning and multimodal engine",
    };
  }

  // Custom or unlisted fallback
  const clean = raw.replace(/^@cf\/[^/]+\//, "");
  const formatted = clean
    .split(/[-_/]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return {
    cleanId: raw,
    name: formatted || raw,
    category: "general",
    badge: "Edge",
    desc: "Cloudflare Workers AI model",
  };
}


const CLOUDFLARE_CATALOG = [
  // ── Flagship Reasoning & Multimodal Agent ──
  "cloudflare:@cf/meta/llama-4-scout-17b-16e-instruct",
  "cloudflare:@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
  "cloudflare:@cf/qwen/qwq-32b",

  // ── Coding & Technical ──
  "cloudflare:@cf/qwen/qwen2.5-coder-32b-instruct",

  // ── Vision & Multimodal ──
  "cloudflare:@cf/mistralai/mistral-small-3.1-24b-instruct",

  // ── Fast, Light & High-Throughput ──
  "cloudflare:@cf/meta/llama-3.2-3b-instruct",
  "cloudflare:@cf/meta/llama-3.2-1b-instruct",
  "cloudflare:@cf/meta/llama-3.1-8b-instruct-fast",
  "cloudflare:@cf/meta/llama-3.1-8b-instruct-fp8",
];

/**
 * Enhanced Categorized Model Dropdown for Cloudflare Workers AI models.
 */
export default function ModelPicker({
  value,
  onChange,
  allowDefault = true,
  compact = false,
  placement = "bottom",
}: {
  value: string | null;
  onChange: (model: string | null) => void;
  allowDefault?: boolean;
  compact?: boolean;
  placement?: "top" | "bottom" | "auto";
}) {
  const models = useStore((s) => s.computer.models);
  const modelMeta = useStore((s) => s.computer.modelMeta);
  const fallback = useStore((s) => s.computer.model);
  const current = value ?? fallback;

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, [open]);

  const list = useMemo(() => {
    const cfFromKey = (models || []).filter((m) => m.startsWith(CF));
    return [...new Set([...CLOUDFLARE_CATALOG, ...cfFromKey])];
  }, [models]);

  const parsedList = useMemo(() => {
    return list.map((id) => {
      const parsed = parseModelId(id);
      const meta = modelMeta?.[id];
      const category = meta?.category || parsed.category;
      const desc = meta?.description || parsed.desc;
      const params = meta?.parameters;
      const ctx = meta?.contextFormatted;

      return {
        id,
        name: parsed.name,
        category,
        badge: parsed.badge,
        desc,
        params,
        ctx,
      };
    });
  }, [list, modelMeta]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return parsedList;
    return parsedList.filter((m) => {
      return (
        m.name.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        (m.desc && m.desc.toLowerCase().includes(q))
      );
    });
  }, [parsedList, search]);

  const currentParsed = current ? parseModelId(current) : null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1 sm:gap-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-card hover:bg-popover font-mono tracking-wide text-foreground/80 transition-all hover:border-black/25 dark:hover:border-white/25 hover:text-foreground active:scale-[0.98] ${
          compact ? "h-7.5 px-1.5 sm:px-2.5 text-[11px]" : "h-9 px-3 text-[12px]"
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Choose Cloudflare model"
      >
        <Cloud className="size-3.5 text-amber-500 shrink-0" strokeWidth={1.75} />
        {value === null && allowDefault ? <span className="hidden sm:inline text-foreground/45">Default ·</span> : null}
        <span className="max-w-[70px] sm:max-w-44 truncate font-sans text-[11px] sm:text-[12px] font-medium text-foreground/90">
          {currentParsed ? currentParsed.name : "Select model…"}
        </span>
        <ChevronDown
          className={`size-3 text-foreground/40 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          strokeWidth={1.75}
        />
      </button>

      {open && (
        <>
          {/* Mobile backdrop for tap-away dismissal */}
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] sm:hidden"
            onClick={() => {
              setOpen(false);
              setSearch("");
            }}
          />
          <div
            role="listbox"
            className={`surface fixed inset-x-2 top-16 z-50 flex max-h-[min(540px,82vh)] flex-col overflow-hidden shadow-2xl border border-black/10 dark:border-white/15 bg-card dark:bg-[#1e1e1e] sm:absolute sm:inset-auto sm:right-0 sm:w-96 ${
              placement === "top" ? "sm:bottom-full sm:mb-2 sm:origin-bottom-right" : "sm:top-full sm:mt-2 sm:origin-top-right"
            }`}
          >
            {/* Header: Search */}
            <div className="border-b border-black/[0.06] dark:border-white/[0.08] p-2 bg-popover/60 dark:bg-[#252525]">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-foreground/40" />
                <input
                  autoFocus
                  type="text"
                  placeholder="Search models (e.g. coder, vision, fast)…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="field h-8 bg-card dark:bg-[#1a1a1a] pl-8 pr-3 text-[12px]"
                />
              </div>
            </div>

            {/* Model Options List */}
            <div className="flex-1 overflow-y-auto p-1.5 space-y-1 divide-y divide-black/[0.03] dark:divide-white/[0.03]">
              {allowDefault && !search && (
                <button
                  type="button"
                  role="option"
                  aria-selected={value === null}
                  onClick={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                  className={`flex w-full items-start gap-2.5 rounded-lg p-2 text-left transition-colors ${
                    value === null ? "bg-black/[0.06] dark:bg-white/[0.08]" : "hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                  }`}
                >
                  <Sparkles className="size-4 text-brand mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-medium text-foreground">Default Model</span>
                      <span className="rounded-xs bg-brand/10 dark:bg-brand/20 px-1.5 py-0.5 font-mono text-[9px] text-brand uppercase font-medium">
                        Auto
                      </span>
                    </div>
                    <p className="mt-0.5 text-caption text-foreground/50">
                      Uses system default ({fallback ? parseModelId(fallback).name : "Meta Llama 4 Scout 17B"})
                    </p>
                  </div>
                  {value === null && <Check className="size-4 shrink-0 text-foreground" strokeWidth={2} />}
                </button>
              )}

              {filtered.map((m) => {
                const selected = m.id === value || (value === null && m.id === fallback);
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onChange(m.id);
                      setOpen(false);
                    }}
                    className={`flex w-full items-start gap-2.5 rounded-lg p-2 text-left transition-colors ${
                      selected ? "bg-black/[0.06] dark:bg-white/[0.08]" : "hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-medium text-foreground">{m.name}</span>
                        {m.badge && (
                          <span
                            className={`rounded-xs px-1.5 py-0.2 font-mono text-[9px] font-semibold uppercase ${
                              m.category === "coding"
                                ? "bg-purple-500/15 text-purple-600 dark:text-purple-400"
                                : m.category === "vision"
                                ? "bg-blue-500/15 text-blue-600 dark:text-blue-400"
                                : m.category === "fast"
                                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                                : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                            }`}
                          >
                            {m.badge}
                          </span>
                        )}
                        {m.params && (
                          <span className="font-mono text-[10px] text-foreground/45">
                            {m.params}
                          </span>
                        )}
                      </div>
                      {m.desc && <p className="mt-0.5 text-caption text-foreground/50 line-clamp-1">{m.desc}</p>}
                      <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-foreground/40">
                        <span className="text-amber-600 dark:text-amber-400">⚡ Cloudflare Workers AI</span>
                        {m.ctx && <span>· {m.ctx}</span>}
                      </div>
                    </div>
                    {selected && <Check className="size-4 shrink-0 text-foreground mt-0.5" strokeWidth={2} />}
                  </button>
                );
              })}

              {!filtered.length && (
                <div className="py-8 text-center text-caption text-foreground/45">
                  No Cloudflare models match “{search}”.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
