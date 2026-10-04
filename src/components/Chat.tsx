"use client";

import Link from "next/link";
import { Suspense, use, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AppWindow,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  AudioLines,
  Brain,
  Check,
  ChevronDown,
  Clock,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Globe,
  KeyRound,
  Laptop,
  MessageSquare,
  Mic,
  MonitorSmartphone,
  Paperclip,
  Plug,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
  Sparkles,
  Square,
  Terminal,
  ThumbsDown,
  ThumbsUp,
  Volume2,
  X,
} from "lucide-react";
import {
  confirmConnectCard,
  resolveCard,
  resumeDot,
  sendMessage,
  startConversation,
  startVoiceConversation,
  stopDot,
} from "@/app/actions";
import { mergeMessages, useStore } from "@/lib/store";
import { startCall } from "@/lib/voiceCall";
import Dot3DLazy from "./Dot3DLazy";
import DotOrb from "./DotOrb";
import type { Attachment, Dot, Message } from "@/lib/types";

const SUGGESTIONS = [
  { label: "Research", text: "Research the best noise-cancelling headphones under $300 and give me a shortlist with sources" },
  { label: "Routine", text: "Every weekday at 8am, send me a short briefing on the top AI news" },
  { label: "Browse", text: "Open Hacker News in your browser and tell me the top 5 stories" },
];

// Older messages of a conversation load on open (the live snapshot only carries recent ones).
const historyLoads = new Map<string, Promise<true>>();
function loadHistory(convId: string) {
  let p = historyLoads.get(convId);
  if (!p) {
    p = fetch(`/api/conversations/${convId}`)
      .then((r) => r.json() as Promise<{ messages: Message[] }>)
      .then((r) => (mergeMessages(r.messages), true as const))
      .catch(() => true as const);
    historyLoads.set(convId, p);
  }
  return p;
}

function HistoryLoader({ convId }: { convId: string }) {
  use(loadHistory(convId));
  return null;
}

/** `conversation`: a conversation id, "new" for a fresh chat, or undefined for the dot's latest chat. */
export default function Chat({ dot, conversation }: { dot: Dot; conversation?: string }) {
  const router = useRouter();
  const all = useStore((s) => s.messages);
  const conversations = useStore((s) => s.conversations);
  const mine = useMemo(
    () => conversations.filter((c) => c.dotId === dot.id).sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations, dot.id]
  );
  const convId = conversation === "new" ? null : conversation ?? mine[0]?.id ?? null;
  const messages = useMemo(() => (convId ? all.filter((m) => m.conversationId === convId && !m.channelId) : []), [all, convId]);
  const hasKey = useStore((s) => s.computer.hasKey || s.computer.openRouter !== null || s.computer.cloudflare !== null);
  const [, start] = useTransition();

  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  // A chat counts as started once you've written, or talked in voice mode.
  const fresh = !messages.some((m) => m.role === "user" || m.from === "voice");
  // On a fresh chat the welcome panel replaces the dot's canned greeting.
  const shown = fresh && messages[0]?.role === "dot" ? messages.slice(1) : messages;
  // "NEW" marks messages that arrived since the user last looked (captured when the chat opens).
  const lastRead = useStore((s) => s.lastRead[dot.id]);
  const [readAt] = useState(() => lastRead ?? Infinity);
  const firstNew = shown.findIndex((m) => (m.role === "dot" || m.role === "card") && m.createdAt > readAt);
  // Best guess at where the dot is working: its most recently active conversation.
  const workingHere = dot.status === "working" && (convId === mine[0]?.id || !convId);

  const send = (text: string, attachments: Attachment[] = []) =>
    start(async () => {
      if (convId) await sendMessage(dot.id, text, attachments, convId);
      else router.replace(`/dots/${dot.id}?c=${await startConversation(dot.id, text, attachments)}`);
    });

  const voice = async () => {
    const id = convId ?? (await startVoiceConversation(dot.id));
    if (!convId) router.replace(`/dots/${dot.id}?c=${id}`);
    void startCall(dot.id, id);
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    // With flex-col-reverse, scrolling up yields negative or positive offset depending on browser engine
    const isScrolledUp = Math.abs(target.scrollTop) > 80;
    setShowScrollBottom(isScrolledUp);
  };

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-background">
      {convId && (
        <Suspense fallback={null}>
          <HistoryLoader convId={convId} />
        </Suspense>
      )}

      {/* Main chat stream */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex flex-1 flex-col-reverse overflow-y-auto"
      >
        <div className="mx-auto flex min-h-full w-full max-w-[820px] shrink-0 flex-col px-4 sm:px-6">
          <div className="flex-1" />

          {fresh && (
            <div className="mx-auto w-full max-w-[760px] py-4">
              <Welcome dot={dot} onPick={(t) => send(t)} />
            </div>
          )}

          <div className="space-y-6 py-6">
            {shown.map((m, i) => (
              <div key={m.id}>
                {i === firstNew && i > 0 && <NewDivider />}
                {(i === 0 || m.createdAt - shown[i - 1].createdAt > 60 * 60_000) && <DateSeparator ts={m.createdAt} />}
                <MessageRow m={m} dot={dot} onRetry={() => send("Please continue or refine the previous answer.")} />
              </div>
            ))}

            {workingHere && (
              <div className="flex items-center gap-2.5 py-3 pl-1 text-foreground/75">
                <DotOrb look={dot.look} status="working" size={22} />
                <span className="shimmer-text text-[14px] font-medium">{dot.activity ?? "Thinking"}…</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Floating Scroll to Bottom Button */}
      {showScrollBottom && (
        <div className="pointer-events-none absolute bottom-24 left-0 right-0 z-20 flex justify-center">
          <button
            onClick={scrollToBottom}
            className="pointer-events-auto flex size-8.5 items-center justify-center rounded-full border border-black/10 dark:border-white/15 bg-card text-foreground shadow-md transition-all hover:scale-105 active:scale-95"
            title="Scroll to latest message"
            aria-label="Scroll to bottom"
          >
            <ArrowDown className="size-4 text-foreground/70" strokeWidth={2} />
          </button>
        </div>
      )}

      {/* Bottom Composer Area */}
      <div className="mx-auto w-full max-w-[820px] px-4 pb-4 sm:px-6 sm:pb-6">
        {!hasKey && (
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/[0.08] px-3.5 py-2 text-body-sm text-foreground/80">
            <ShieldAlert className="size-4 text-warning" strokeWidth={1.75} />
            <span>
              Configure your Cloudflare AI Worker or OpenAI key in{" "}
              <Link href="/settings#cloudflare-worker" className="underline underline-offset-2 font-medium">
                Settings
              </Link>{" "}
              to enable autonomous agent reasoning.
            </span>
          </div>
        )}
        <Composer key={convId ?? "new"} dot={dot} onSend={send} onVoice={voice} />
      </div>
    </div>
  );
}

function Welcome({ dot, onPick }: { dot: Dot; onPick: (text: string) => void }) {
  return (
    <div className="flex flex-col items-center pt-8 text-center">
      <div className="dot-grid rounded-full p-2">
        <Dot3DLazy look={dot.look} status={dot.status} size={130} />
      </div>
      <div className="eyebrow mt-3 text-brand-readable/90">Autonomous Assistant</div>
      <h1 className="text-h1 mt-1 font-medium tracking-tight">How can I help you today?</h1>
      {dot.purpose && (
        <div className="mt-2.5 max-w-[540px] rounded-full border border-black/[0.06] dark:border-white/[0.08] bg-card px-4 py-1.5 text-body-sm text-foreground/75">
          <span className="font-semibold mr-1.5 text-foreground/90">Focus:</span>
          {dot.purpose}
        </div>
      )}
      <p className="text-body-sm mt-2 max-w-[460px] text-foreground/55">
        Equipped with private browser automation, computer tools, memory, and scheduled routines.
      </p>
      <div className="mt-6 grid w-full gap-2.5 sm:grid-cols-3">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            onClick={() => onPick(s.text)}
            className="group flex flex-col items-start gap-2 rounded-2xl border border-black/[0.06] dark:border-white/[0.08] bg-card p-4 text-left shadow-xs transition-all hover:border-black/20 dark:hover:border-white/20 hover:shadow-md active:scale-[0.99]"
          >
            <span className="eyebrow flex w-full items-center justify-between text-foreground/60 group-hover:text-brand">
              {s.label}
              <ArrowRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
            </span>
            <span className="text-[13px] leading-snug text-foreground/75">{s.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

type Upload = { key: string; name: string; state: "uploading" | "done" | "error"; file?: Attachment; error?: string };

async function uploadFiles(dotId: string, list: File[]): Promise<{ files?: Attachment[]; error?: string }> {
  const form = new FormData();
  for (const f of list) form.append("file", f);
  const r = await fetch(`/api/dots/${dotId}/files`, { method: "POST", body: form });
  return r.json();
}

function Composer({
  dot,
  onSend,
  onVoice,
}: {
  dot: Dot;
  onSend: (text: string, attachments: Attachment[]) => void;
  onVoice: () => void;
}) {
  const [text, setText] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [pending, start] = useTransition();
  const ready = uploads.filter((u) => u.state === "done" && u.file).map((u) => u.file!);
  const busy = uploads.some((u) => u.state === "uploading");

  const addFiles = (list: File[]) => {
    if (!list.length) return;
    const batch = list.map((f) => ({ key: `${f.name}-${f.size}-${Math.random()}`, name: f.name, state: "uploading" as const }));
    setUploads((u) => [...u, ...batch]);
    void uploadFiles(dot.id, list).then((r) =>
      setUploads((u) =>
        u.map((x) => {
          const i = batch.findIndex((b) => b.key === x.key);
          if (i === -1) return x;
          return r.files?.[i] ? { ...x, state: "done", file: r.files[i] } : { ...x, state: "error", error: r.error ?? "Upload failed" };
        })
      )
    );
  };

  const submit = () => {
    const value = text.trim();
    if ((!value && !ready.length) || busy) return;
    setText("");
    setUploads([]);
    onSend(value, ready);
  };

  if (dot.status === "paused") {
    return (
      <div className="surface flex items-center justify-between gap-4 rounded-2xl px-4 py-3 shadow-[0_8px_32px_-12px_rgba(0,0,0,0.15)]">
        <span className="text-body-sm text-foreground/60">
          {dot.name} is paused. Any ongoing work was stopped, and it won&apos;t message you until you resume it.
        </span>
        <button className="btn-primary h-8 shrink-0 px-3 text-[13px]" onClick={() => start(() => resumeDot(dot.id))}>
          Resume
        </button>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        addFiles([...e.dataTransfer.files]);
      }}
      className="relative"
    >
      <div
        className={`rounded-[28px] border border-black/10 dark:border-white/10 bg-card p-2 pl-3 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.1)] dark:shadow-[0_10px_35px_-10px_rgba(0,0,0,0.35)] transition-all focus-within:border-black/25 dark:focus-within:border-white/25 focus-within:shadow-[0_8px_32px_-10px_rgba(0,0,0,0.15)] dark:focus-within:shadow-[0_14px_45px_-12px_rgba(0,0,0,0.4)] ${
          dragging ? "border-brand border-dashed bg-brand/[0.04]" : ""
        }`}
      >
        {uploads.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5 pl-1 pt-1">
            {uploads.map((u) => (
              <span
                key={u.key}
                className={`flex h-7 items-center gap-1.5 rounded-lg border px-2 text-[12px] ${
                  u.state === "error" ? "border-destructive/40 text-destructive" : "border-black/10 dark:border-white/10 text-foreground/75"
                }`}
                title={u.error}
              >
                <Paperclip className="size-3" strokeWidth={1.75} />
                <span className="max-w-40 truncate">{u.name}</span>
                {u.state === "uploading" && <span className="font-mono text-[10px] text-foreground/40">…</span>}
                <button
                  onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))}
                  aria-label={`Remove ${u.name}`}
                  className="text-foreground/35 hover:text-foreground"
                >
                  <X className="size-3" strokeWidth={2} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          {/* Plus / Attach button */}
          <label
            className="flex size-8.5 shrink-0 cursor-pointer items-center justify-center rounded-full text-foreground/60 transition-colors hover:bg-black/[0.06] dark:hover:bg-white/[0.08] hover:text-foreground"
            title="Attach files or screenshots"
          >
            <Plus className="size-5" strokeWidth={1.75} />
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                addFiles([...(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />
          </label>

          {/* Chat input textarea */}
          <textarea
            rows={1}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const pasted = [...e.clipboardData.files];
              if (pasted.length) {
                e.preventDefault();
                addFiles(pasted);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={dragging ? "Drop files to attach..." : `Ask ${dot.name}...`}
            className="max-h-52 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-[1.5] tracking-default outline-none [field-sizing:content] placeholder:text-foreground/35 text-foreground"
          />

          {/* Voice / Stop / Send Action Button */}
          {dot.status === "working" ? (
            <button
              className="flex size-8.5 shrink-0 items-center justify-center rounded-full bg-foreground text-background shadow-xs transition-all hover:scale-105 active:scale-95"
              onClick={() => start(() => stopDot(dot.id))}
              aria-label="Stop current task"
              title="Stop task"
            >
              <Square className="size-3.5 fill-current" />
            </button>
          ) : text.trim() || ready.length || busy ? (
            <button
              className="flex size-8.5 shrink-0 items-center justify-center rounded-full bg-foreground text-background shadow-xs transition-all hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
              disabled={pending || busy}
              onClick={submit}
              aria-label="Send message"
            >
              <ArrowUp className="size-4" strokeWidth={2.5} />
            </button>
          ) : (
            <button
              className="flex size-8.5 shrink-0 items-center justify-center rounded-full bg-black/[0.05] dark:bg-white/[0.08] text-foreground/75 transition-all hover:bg-black/10 dark:hover:bg-white/15 hover:text-foreground active:scale-95"
              onClick={onVoice}
              aria-label={`Voice conversation with ${dot.name}`}
              title="Start voice mode"
            >
              <Mic className="size-4" strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Markdown Code Block with ChatGPT Header & 1-Click Copy */
function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  return (
    <div className="my-4 overflow-hidden rounded-2xl border border-black/[0.08] dark:border-white/[0.08] bg-[#18181b] shadow-xs text-neutral-100">
      <div className="flex h-9 items-center justify-between border-b border-white/[0.08] bg-[#212124] px-4">
        <div className="flex items-center gap-2 font-mono text-[12px] text-neutral-300">
          <Code2 className="size-3.5 text-neutral-400" strokeWidth={1.75} />
          <span className="capitalize">{language || "Plain text"}</span>
        </div>
        <button
          onClick={copy}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-mono text-neutral-300 transition-colors hover:bg-white/10 hover:text-white active:scale-95"
          title="Copy code to clipboard"
        >
          {copied ? (
            <>
              <Check className="size-3 text-emerald-400" strokeWidth={2} />
              <span className="text-emerald-400">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="size-3" strokeWidth={1.75} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[13.5px] leading-relaxed text-neutral-200">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** Assistant Action Bar (Copy, Thumbs Up/Down, Read Aloud, Regenerate) */
function AssistantActions({ text, onRetry }: { text: string; onRetry?: () => void }) {
  const [copied, setCopied] = useState(false);
  const [liked, setLiked] = useState<boolean | null>(null);
  const [speaking, setSpeaking] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const toggleSpeak = () => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
    } else {
      window.speechSynthesis.cancel();
      const clean = text.replace(/[#*`_]/g, "");
      const u = new SpeechSynthesisUtterance(clean);
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
      setSpeaking(true);
    }
  };

  return (
    <div className="mt-3 flex items-center gap-1 text-foreground/45 transition-opacity opacity-80 hover:opacity-100">
      <button
        onClick={copy}
        title="Copy response"
        className="flex size-7 items-center justify-center rounded-md hover:bg-black/[0.05] dark:hover:bg-white/[0.08] hover:text-foreground transition-colors"
      >
        {copied ? <Check className="size-3.5 text-emerald-500" strokeWidth={2} /> : <Copy className="size-3.5" strokeWidth={1.75} />}
      </button>
      <button
        onClick={() => setLiked(liked === true ? null : true)}
        title="Good response"
        className={`flex size-7 items-center justify-center rounded-md hover:bg-black/[0.05] dark:hover:bg-white/[0.08] hover:text-foreground transition-colors ${
          liked === true ? "text-brand" : ""
        }`}
      >
        <ThumbsUp className="size-3.5" strokeWidth={1.75} />
      </button>
      <button
        onClick={() => setLiked(liked === false ? null : false)}
        title="Bad response"
        className={`flex size-7 items-center justify-center rounded-md hover:bg-black/[0.05] dark:hover:bg-white/[0.08] hover:text-foreground transition-colors ${
          liked === false ? "text-destructive" : ""
        }`}
      >
        <ThumbsDown className="size-3.5" strokeWidth={1.75} />
      </button>
      <button
        onClick={toggleSpeak}
        title={speaking ? "Stop speaking" : "Read aloud"}
        className={`flex size-7 items-center justify-center rounded-md hover:bg-black/[0.05] dark:hover:bg-white/[0.08] hover:text-foreground transition-colors ${
          speaking ? "text-brand animate-pulse" : ""
        }`}
      >
        <Volume2 className="size-3.5" strokeWidth={1.75} />
      </button>
      {onRetry && (
        <button
          onClick={onRetry}
          title="Regenerate response"
          className="flex size-7 items-center justify-center rounded-md hover:bg-black/[0.05] dark:hover:bg-white/[0.08] hover:text-foreground transition-colors"
        >
          <RotateCcw className="size-3.5" strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}

/** Files on a message: images preview inline, everything else is a download chip. */
function Attachments({ items, align = "start" }: { items: Attachment[]; align?: "start" | "end" }) {
  const images = items.filter((a) => /^image\/(png|jpeg|gif|webp)$/.test(a.mime));
  const others = items.filter((a) => !images.includes(a));
  const size = (n: number) => (n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  return (
    <div className={`mt-2.5 flex flex-wrap gap-2 ${align === "end" ? "justify-end" : ""}`}>
      {images.map((a) => (
        <a
          key={a.id}
          href={`/api/files/${a.id}`}
          target="_blank"
          rel="noreferrer"
          className="block overflow-hidden rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-card shadow-xs transition-transform hover:scale-[1.01]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/files/${a.id}`} alt={a.name} className="max-h-64 max-w-[340px] object-contain" />
        </a>
      ))}
      {others.map((a) => (
        <a
          key={a.id}
          href={`/api/files/${a.id}${a.mime === "application/pdf" ? "" : "?download=1"}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2.5 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-card px-3.5 py-2 transition-colors hover:border-black/20 dark:hover:border-white/20"
        >
          <FileText className="size-4 shrink-0 text-foreground/45" strokeWidth={1.5} />
          <span className="min-w-0">
            <span className="block max-w-56 truncate text-[13px] font-medium">{a.name}</span>
            <span className="block font-mono text-[10px] text-foreground/40 uppercase">{size(a.size)}</span>
          </span>
          <Download className="size-3.5 text-foreground/35" strokeWidth={1.75} />
        </a>
      ))}
    </div>
  );
}

const ACTIVITY_ICON: [RegExp, typeof Globe][] = [
  [/^Searched|^Searching/, Search],
  [/^Browsing|^Reading the web/, Globe],
  [/^Using its computer/, MonitorSmartphone],
  [/^Running commands|^Reading a file|^Writing a file/, Terminal],
  [/^Signing in/, KeyRound],
  [/^On your computer/, Laptop],
  [/^Remember|^Updating memory/, Brain],
  [/^Setting up a routine|^Updating routines/, Clock],
  [/^Messaging/, MessageSquare],
  [/^Learning a skill|^Using a skill/, Sparkles],
  [/^Finding app tools|^Using an app|^Connecting an app/, AppWindow],
  [/^Blocked/, X],
];

/** One chat line with structured ChatGPT-grade layout */
export function MessageRow({
  m,
  dot,
  showName = false,
  onRetry,
}: {
  m: Message;
  dot: Dot;
  showName?: boolean;
  onRetry?: () => void;
}) {
  // ── USER MESSAGE (Pill on the right) ──
  if (m.role === "user") {
    return (
      <div className="flex flex-col items-end my-2 pl-8 sm:pl-16">
        {m.from && <span className="eyebrow mb-1 mr-2">{m.from.replace(/^dot:/, "From ").replace(/^routine:/, "Routine · ")}</span>}
        {m.text && (
          <div className="max-w-full rounded-[24px] bg-black/[0.06] text-foreground dark:bg-white/[0.1] px-5 py-3 text-[15px] leading-[1.55] tracking-default whitespace-pre-wrap shadow-xs">
            {m.text}
          </div>
        )}
        {!!m.attachments?.length && <Attachments items={m.attachments} align="end" />}
      </div>
    );
  }

  // ── ACTIVITY / TOOL RUN (Subtle inline line) ──
  if (m.role === "activity") {
    const [label, ...rest] = m.text.split(" · ");
    const Icon = ACTIVITY_ICON.find(([re]) => re.test(label))?.[1] ?? Sparkles;
    return (
      <div className="flex min-w-0 items-center gap-2 py-1 pl-1 text-foreground/45">
        <Icon className="size-3.5 shrink-0 text-brand" strokeWidth={1.5} />
        {showName && <span className="shrink-0 text-[12px] font-medium text-foreground/65">{dot.name}</span>}
        <span className="shrink-0 font-mono text-[11px] tracking-wider whitespace-nowrap uppercase">{label}</span>
        {rest.length > 0 && <span className="truncate font-mono text-[11px] text-foreground/40">{rest.join(" · ")}</span>}
      </div>
    );
  }

  // ── SYSTEM NOTICES ──
  if (m.role === "system") {
    return (
      <div className="flex items-center gap-3 py-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-caption text-foreground/50">{m.text}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    );
  }

  // ── ACTION CARDS (Approval, Question, App Connect) ──
  if (m.role === "card" && m.card) {
    return (
      <div className="my-2">
        <CardRow m={m} />
      </div>
    );
  }

  // ── ASSISTANT MESSAGE (Clean, unboxed prose directly on canvas) ──
  return (
    <div className="my-3 pr-2 sm:pr-6">
      {/* Title tag or Dot author name if needed */}
      {(showName || m.title) && (
        <div className="mb-2 flex items-center gap-2">
          {showName && (
            <div className="flex items-center gap-2">
              <DotOrb look={dot.look} status="idle" size={20} />
              <span className="text-[13px] font-medium text-foreground">{dot.name}</span>
            </div>
          )}
          {m.title && (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-highlight px-2 py-0.5 font-mono text-[10px] tracking-wider text-highlight-foreground uppercase font-medium">
              <Sparkles className="size-3" strokeWidth={2} />
              {m.title}
            </span>
          )}
        </div>
      )}

      {/* Markdown Content */}
      <div className="dot-prose">
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ node, inline, className, children, ...props }: any) {
              const match = /language-(\w+)/.exec(className || "");
              const isInline = inline || (!match && !String(children).includes("\n"));
              if (isInline) {
                return (
                  <code className="rounded-md bg-black/[0.06] dark:bg-white/[0.1] px-1.5 py-0.5 font-mono text-[13px] text-foreground" {...props}>
                    {children}
                  </code>
                );
              }
              return <CodeBlock language={match ? match[1] : "plain text"} code={String(children).replace(/\n$/, "")} />;
            },
            table({ children }) {
              return (
                <div className="my-4 overflow-x-auto rounded-xl border border-black/[0.08] dark:border-white/[0.08]">
                  <table className="w-full text-left text-[14px] border-collapse">{children}</table>
                </div>
              );
            },
            th({ children }) {
              return (
                <th className="border-b border-black/[0.08] dark:border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.04] px-4 py-2.5 font-mono text-[11px] font-medium tracking-wider text-foreground/60 uppercase">
                  {children}
                </th>
              );
            },
            td({ children }) {
              return <td className="border-b border-black/[0.04] dark:border-white/[0.04] px-4 py-2.5 text-foreground/80">{children}</td>;
            },
            h1({ children }) {
              return <h1 className="mt-6 mb-3 text-xl font-semibold tracking-tight text-foreground first:mt-0">{children}</h1>;
            },
            h2({ children }) {
              return <h2 className="mt-5 mb-2.5 text-lg font-medium tracking-tight text-foreground first:mt-0">{children}</h2>;
            },
            h3({ children }) {
              return <h3 className="mt-4 mb-2 text-[16px] font-medium tracking-tight text-foreground first:mt-0">{children}</h3>;
            },
            p({ children }) {
              return <p className="mb-3.5 leading-[1.65] text-foreground/90 last:mb-0">{children}</p>;
            },
            ul({ children }) {
              return <ul className="mb-3.5 list-disc space-y-1.5 pl-5 text-foreground/90 last:mb-0">{children}</ul>;
            },
            ol({ children }) {
              return <ol className="mb-3.5 list-decimal space-y-1.5 pl-5 text-foreground/90 last:mb-0">{children}</ol>;
            },
            li({ children }) {
              return <li className="leading-[1.6]">{children}</li>;
            },
            blockquote({ children }) {
              return <blockquote className="my-3 border-l-2 border-brand pl-4 italic text-foreground/70">{children}</blockquote>;
            },
            a({ href, children }) {
              return (
                <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline underline-offset-2">
                  {children}
                </a>
              );
            },
          }}
        >
          {m.text || "…"}
        </Markdown>
      </div>

      {!!m.attachments?.length && <Attachments items={m.attachments} />}

      {/* Assistant Action Bar */}
      <AssistantActions text={m.text || ""} onRetry={onRetry} />
    </div>
  );
}

function CardRow({ m }: { m: Message }) {
  const card = m.card!;
  const [answer, setAnswer] = useState("");
  const [pending, start] = useTransition();
  const open = card.status === "pending";
  const act = (choice: "approve" | "deny" | "always" | "answer", value?: string) => start(() => resolveCard(m.id, choice, value));

  if (!open) {
    const tone = card.status === "approved" || card.status === "answered" ? "text-success" : card.status === "denied" ? "text-destructive" : "text-foreground/40";
    const Icon = card.status === "denied" ? X : card.status === "expired" ? Clock : Check;
    return (
      <div className="flex max-w-[560px] items-center gap-2.5 rounded-xl border border-black/[0.06] dark:border-white/[0.08] bg-card/60 px-3.5 py-2.5">
        <Icon className={`size-3.5 shrink-0 ${tone}`} strokeWidth={2} />
        <span className="truncate text-body-sm text-foreground/65 font-medium">{card.title}</span>
        <span className={`ml-auto shrink-0 font-mono text-[10px] tracking-wider uppercase ${tone}`}>
          {card.status === "answered" ? `Answered · ${card.answer}` : card.kind === "connect" && card.status === "approved" ? "Connected" : card.status}
        </span>
      </div>
    );
  }

  return (
    <div className="surface max-w-[580px] overflow-hidden rounded-2xl shadow-elevated">
      <div className="flex items-center gap-2 border-b border-black/[0.06] dark:border-white/[0.08] bg-popover px-4 py-2.5">
        <span className="size-2 rounded-full bg-warning" />
        <span className="eyebrow">{card.kind === "question" ? "Question for you" : card.kind === "connect" ? "Connect an app" : "Needs your approval"}</span>
      </div>
      <div className="p-4">
        <div className="text-[15px] leading-snug font-medium">{card.title}</div>
        {card.detail && <div className="mt-1.5 text-body-sm whitespace-pre-wrap text-foreground/65">{card.detail}</div>}

        {card.kind === "connect" && <ConnectActions m={m} />}

        {card.kind === "approval" && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button className="btn-primary h-8 px-3 text-[13px]" disabled={pending} onClick={() => act("approve")}>
              Approve
            </button>
            <button className="btn-secondary h-8 px-3 text-[13px]" disabled={pending} onClick={() => act("deny")}>
              Deny
            </button>
            {card.ruleAction && (
              <button className="btn-quiet ml-auto" disabled={pending} onClick={() => act("always")} title={`Adds a rule: always allow when it wants to ${card.ruleAction}`}>
                Always allow
              </button>
            )}
          </div>
        )}

        {card.kind === "question" && (
          <div className="mt-4 space-y-2.5">
            {!!card.options?.length && (
              <div className="flex flex-wrap gap-2">
                {card.options.map((o) => (
                  <button key={o} className="btn-secondary h-8 px-3 text-[13px]" disabled={pending} onClick={() => act("answer", o)}>
                    {o}
                  </button>
                ))}
              </div>
            )}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (answer.trim()) act("answer", answer.trim());
              }}
            >
              <input className="field h-8" placeholder="Type your own answer" value={answer} onChange={(e) => setAnswer(e.target.value)} />
              <button className="btn-primary h-8 px-3 text-[13px]" disabled={pending || !answer.trim()}>
                Send
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

function ConnectActions({ m }: { m: Message }) {
  const card = m.card!;
  const [pending, start] = useTransition();
  const [notYet, setNotYet] = useState(false);
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <button className="btn-primary h-8 px-3 text-[13px]" disabled={!card.url} onClick={() => window.open(card.url, "_blank", "noopener")}>
        <Plug className="size-3.5" strokeWidth={1.75} /> {card.title}
        <ExternalLink className="size-3 opacity-60" strokeWidth={1.75} />
      </button>
      <button
        className="btn-secondary h-8 px-3 text-[13px]"
        disabled={pending}
        onClick={() => start(async () => setNotYet(!(await confirmConnectCard(m.id))))}
      >
        I&apos;ve connected
      </button>
      <button className="btn-quiet" disabled={pending} onClick={() => start(() => resolveCard(m.id, "deny"))}>
        Not now
      </button>
      {notYet && <span className="text-caption text-foreground/50">Not connected yet. Finish signing in, then try again.</span>}
    </div>
  );
}

function NewDivider() {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="h-px flex-1 bg-brand/40" />
      <span className="font-mono text-[10px] tracking-wider text-brand-readable uppercase font-medium">New</span>
      <span className="h-px flex-1 bg-brand/40" />
    </div>
  );
}

function DateSeparator({ ts }: { ts: number }) {
  const d = new Date(ts);
  const label = d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return <div className="py-3 text-center font-mono text-[10px] tracking-wider text-foreground/35 uppercase">{label}</div>;
}
