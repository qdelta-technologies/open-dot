"use client";

import React, { memo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Code2, Copy } from "lucide-react";
import { useSmoothStream } from "@/lib/useSmoothStream";

/** Markdown Code Block with Header & 1-Click Copy */
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

/**
 * Strips <think>...</think> reasoning blocks from DeepSeek R1 and reasoning models.
 * While actively streaming inside an unclosed <think> tag, suppresses the raw reasoning text
 * so the user only sees clean, finished output.
 */
function cleanThinkingBlock(text: string): { cleanText: string; isThinking: boolean } {
  if (!text) return { cleanText: "", isThinking: false };

  // 1. Remove all completed <think>...</think> blocks
  let clean = text.replace(/<think>[\s\S]*?<\/think>\s*/gi, "");

  // 2. Check if currently streaming inside an unclosed <think> tag
  if (/<think>/i.test(clean)) {
    clean = clean.replace(/<think>[\s\S]*$/gi, "");
    return { cleanText: clean.trim(), isThinking: true };
  }

  return { cleanText: clean.trim(), isThinking: false };
}

/**
 * Balances incomplete markdown structures while streaming so the parser
 * doesn't flicker, break, or jump abruptly (e.g. unclosed code blocks).
 */
function balanceStreamingMarkdown(text: string): string {
  if (!text) return "";
  // Check for unclosed triple-backtick code fences
  const fences = text.match(/```/g);
  if (fences && fences.length % 2 !== 0) {
    return text + "\n```";
  }
  return text;
}

export const StreamingMarkdown = memo(function StreamingMarkdown({
  text,
  isStreaming = false,
}: {
  text: string;
  isStreaming?: boolean;
}) {
  const { cleanText, isThinking } = cleanThinkingBlock(text);
  // Use our smooth 60fps streaming interpolation hook
  const rawStreamedText = useSmoothStream(cleanText, isStreaming);
  const balancedText = isStreaming ? balanceStreamingMarkdown(rawStreamedText) : rawStreamedText;

  if (!balancedText && isThinking) {
    return (
      <div className="flex items-center gap-2 py-1.5 text-foreground/50 text-[13px] italic font-sans animate-pulse">
        <span>Reasoning through response…</span>
      </div>
    );
  }

  return (
    <div className="dot-prose relative">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ node, inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || "");
            const isInline = inline || (!match && !String(children).includes("\n"));
            if (isInline) {
              return (
                <code
                  className="rounded-md bg-black/[0.06] dark:bg-white/[0.1] px-1.5 py-0.5 font-mono text-[13px] text-foreground"
                  {...props}
                >
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
            return (
              <td className="border-b border-black/[0.04] dark:border-white/[0.04] px-4 py-2.5 text-foreground/80">
                {children}
              </td>
            );
          },
          h1({ children }) {
            return (
              <h1 className="mt-6 mb-3 text-xl font-semibold tracking-tight text-foreground first:mt-0">{children}</h1>
            );
          },
          h2({ children }) {
            return (
              <h2 className="mt-5 mb-2.5 text-lg font-medium tracking-tight text-foreground first:mt-0">{children}</h2>
            );
          },
          h3({ children }) {
            return (
              <h3 className="mt-4 mb-2 text-[16px] font-medium tracking-tight text-foreground first:mt-0">{children}</h3>
            );
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
            return (
              <blockquote className="my-3 border-l-2 border-brand pl-4 italic text-foreground/70">
                {children}
              </blockquote>
            );
          },
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand hover:underline underline-offset-2"
              >
                {children}
              </a>
            );
          },
        }}
      >
        {balancedText || (isStreaming ? "" : "…")}
      </Markdown>

      {/* Sleek animated streaming cursor (pulsing indicator while generating) */}
      {isStreaming && (
        <span
          className="inline-block size-2 ml-1 align-middle rounded-full bg-brand animate-pulse shadow-[0_0_8px_rgba(var(--brand-rgb,138,43,226),0.6)]"
          aria-hidden="true"
        />
      )}
    </div>
  );
});
