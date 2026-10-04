"use client";

import { useMemo, useState } from "react";
import {
  Brain,
  Check,
  ChevronDown,
  Code2,
  Cpu,
  Eye,
  Search,
  Sparkles,
  Zap,
} from "lucide-react";
import { useStore } from "@/lib/store";

const CF = "cloudflare:";
const OPEN = "openrouter:";

export type ModelCategory = "all" | "general" | "coding" | "vision" | "fast";

function parseModelId(id: string): {
  cleanId: string;
  name: string;
  category: "general" | "coding" | "vision" | "fast";
  badge?: string;
  desc?: string;
} {
  const isCf = id.startsWith(CF);
  const isOpen = id.startsWith(OPEN);
  const raw = isCf ? id.slice(CF.length) : isOpen ? id.slice(OPEN.length) : id;
  const lower = raw.toLowerCase();

  // Categories & labels for Cloudflare Workers AI and common models
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
    badge: isCf ? "Edge" : isOpen ? "OpenRouter" : undefined,
    desc: isCf ? "Cloudflare Workers AI model" : undefined,
  };
}

const CATEGORIES: { id: ModelCategory; label: string; icon: typeof Brain }[] = [
  { id: "all", label: "✨ All", icon: Sparkles },
  { id: "general", label: "🧠 General", icon: Brain },
  { id: "coding", label: "💻 Coding", icon: Code2 },
  { id: "vision", label: "👁️ Vision", icon: Eye },
  { id: "fast", label: "⚡ Fast", icon: Zap },
];

const CLOUDFLARE_CATALOG = [
  // General & Chat
  "cloudflare:@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "cloudflare:@cf/qwen/qwen2.5-72b-instruct",
  "cloudflare:@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
  "cloudflare:@cf/meta/llama-3.1-70b-instruct",
  "cloudflare:@cf/meta/llama-3.1-8b-instruct",
  // Coding
  "cloudflare:@cf/qwen/qwen2.5-coder-32b-instruct",
  "cloudflare:@cf/deepseek-ai/deepseek-coder-6.7b-instruct",
  "cloudflare:@cf/defog/sqlcoder-7b-2",
  // Vision
  "cloudflare:@cf/meta/llama-3.2-11b-vision-instruct",
  "cloudflare:@cf/meta/llama-3.2-90b-vision-instruct",
  // Fast & Routines
  "cloudflare:@cf/meta/llama-3.2-3b-instruct",
  "cloudflare:@cf/meta/llama-3.2-1b-instruct",
  "cloudflare:@cf/mistral/mistral-7b-instruct-v0.2",
  "cloudflare:@cf/google/gemma-2-9b-it",
];

/**
 * Enhanced Categorized Model Dropdown with responsive placement.
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
  const cloudflareConnected = useStore((s) => Boolean(s.computer.cloudflare));
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<ModelCategory>("all");

  const current = value ?? fallback;
  const isCfActive = cloudflareConnected || (models && models.some((m) => m.startsWith(CF))) || (fallback && fallback.startsWith(CF));
  const combinedList = isCfActive ? [...new Set([...models, ...CLOUDFLARE_CATALOG])] : models;
  const list = combinedList.length ? combinedList : fallback ? [fallback] : CLOUDFLARE_CATALOG;

  const parsedList = useMemo(() => {
    return list.map((id) => {
      const parsed = parseModelId(id);
      const meta = modelMeta?.[id];
      const category = meta?.category || parsed.category;
      const desc = meta?.description || parsed.desc;
      const params = meta?.parameters;
      const ctx = meta?.contextFormatted;
      const isCf = id.startsWith(CF);

      return {
        id,
        name: parsed.name,
        category,
        badge: parsed.badge,
        desc,
        params,
        ctx,
        isCf,
      };
    });
  }, [list, modelMeta]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return parsedList.filter((m) => {
      if (activeCategory !== "all" && m.category !== activeCategory) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        (m.desc && m.desc.toLowerCase().includes(q))
      );
    });
  }, [parsedList, search, activeCategory]);

  const currentParsed = current ? parseModelId(current) : null;

  return (
    <div
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setOpen(false);
          setSearch("");
        }
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-card hover:bg-popover font-mono tracking-wide text-foreground/80 transition-all hover:border-black/25 dark:hover:border-white/25 hover:text-foreground active:scale-[0.98] ${
          compact ? "h-7.5 px-2.5 text-[11px]" : "h-9 px-3 text-[12px]"
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Choose model and capability profile"
      >
        <Cpu className="size-3.5 text-brand shrink-0" strokeWidth={1.75} />
        {value === null && allowDefault ? <span className="text-foreground/45">Default ·</span> : null}
        <span className="max-w-36 sm:max-w-44 truncate font-sans text-[12px] font-medium text-foreground/90">
          {currentParsed ? currentParsed.name : "Select model…"}
        </span>
        <ChevronDown
          className={`size-3.5 text-foreground/40 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          strokeWidth={1.75}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className={`surface absolute right-0 z-50 flex max-h-[min(480px,75vh)] w-88 sm:w-96 flex-col overflow-hidden shadow-2xl border border-black/10 dark:border-white/15 bg-card dark:bg-[#1e1e1e] ${
            placement === "top" ? "bottom-full mb-2 origin-bottom-right" : "top-full mt-2 origin-top-right"
          }`}
        >
          {/* Header & Search */}
          <div className="border-b border-black/[0.06] dark:border-white/[0.08] p-2.5 bg-popover/60 dark:bg-[#252525]">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-foreground/40" />
              <input
                autoFocus
                type="text"
                placeholder="Search models (e.g. 70B, coder, vision)…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="field h-8 bg-card dark:bg-[#1a1a1a] pl-8 pr-3 text-[12px]"
              />
            </div>

            {/* Category Pills */}
            <div className="mt-2 flex flex-wrap gap-1">
              {CATEGORIES.map((cat) => {
                const Icon = cat.icon;
                const active = activeCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setActiveCategory(cat.id)}
                    className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                      active
                        ? "bg-foreground text-card"
                        : "bg-black/[0.04] dark:bg-white/[0.06] text-foreground/65 hover:text-foreground hover:bg-black/[0.08] dark:hover:bg-white/[0.1]"
                    }`}
                  >
                    <Icon className="size-3" />
                    {cat.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Model Options Stream */}
          <div className="flex-1 overflow-y-auto p-1.5 space-y-1 divide-y divide-black/[0.03] dark:divide-white/[0.03]">
            {allowDefault && !search && activeCategory === "all" && (
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
                    Uses system default ({fallback ? parseModelId(fallback).name : "Cloudflare Edge"})
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
                      {m.isCf && <span className="text-brand">Cloudflare Edge</span>}
                      {m.ctx && <span>· {m.ctx}</span>}
                    </div>
                  </div>
                  {selected && <Check className="size-4 shrink-0 text-foreground mt-0.5" strokeWidth={2} />}
                </button>
              );
            })}

            {!filtered.length && (
              <div className="p-4 text-center text-caption text-foreground/45">
                No models match “{search}”.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
