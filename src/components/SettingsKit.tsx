"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ChevronDown, X } from "lucide-react";
import * as actions from "@/app/actions";
import { useStore } from "@/lib/store";
import type { RuleDecision } from "@/lib/types";

/** Two-column settings block: label + description on the left, controls on the right. Optionally foldable (the choice is remembered). */
export function Section({
  id,
  eyebrow,
  title,
  description,
  collapsible = false,
  defaultOpen = false,
  openOnHash,
  children,
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Extra element ids inside this section that should open it when they are in the page address (#...). */
  openOnHash?: string[];
  children: React.ReactNode;
}) {
  const key = `qdot-settings-open:${id ?? eyebrow ?? title}`;
  const [open, setOpen] = useState(!collapsible || defaultOpen);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!collapsible) return;
    try {
      const saved = localStorage.getItem(key);
      if (saved === "1") setOpen(true);
      else if (saved === "0") setOpen(false);
    } catch {
      // storage unavailable
    }
    const hash = window.location.hash.replace(/^#/, "");
    if (hash && (hash === id || openOnHash?.includes(hash))) {
      setOpen(true);
      setTimeout(() => (document.getElementById(hash) ?? ref.current)?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(key, next ? "1" : "0");
    } catch {
      // ignore
    }
  };

  const showBody = !collapsible || open;
  return (
    <section
      ref={ref}
      id={id}
      className={`grid gap-5 border-t border-black/[0.06] first:border-t-0 first:pt-2 md:grid-cols-[240px_1fr] md:gap-10 ${collapsible && !open ? "py-4" : "py-8"}`}
    >
      <div>
        {collapsible ? (
          <button type="button" onClick={toggle} aria-expanded={open} className="group flex w-full items-start gap-3 text-left">
            <span className="min-w-0 flex-1">
              {eyebrow && <span className="eyebrow mb-1.5 block">{eyebrow}</span>}
              <span className="block text-[15px] leading-snug font-medium">{title}</span>
            </span>
            <ChevronDown className={`mt-1 size-4 shrink-0 text-foreground/45 transition-transform duration-200 group-hover:text-foreground ${open ? "rotate-180" : ""}`} strokeWidth={1.75} />
          </button>
        ) : (
          <>
            {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
            <h2 className="text-[15px] leading-snug font-medium">{title}</h2>
          </>
        )}
        {description && showBody && <p className="mt-1.5 text-body-sm text-foreground/55">{description}</p>}
      </div>
      {showBody && <div className="min-w-0">{children}</div>}
    </section>
  );
}

export function PageHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return (
    <div className="pt-10 pb-6">
      <div className="eyebrow text-brand-readable/80">{eyebrow}</div>
      <h1 className="text-h1 mt-2">{title}</h1>
      {description && <p className="mt-2 max-w-[560px] text-body-sm text-foreground/55">{description}</p>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-black/10 px-4 py-5 text-center text-body-sm text-foreground/45">{children}</div>;
}

export function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground/35 transition-colors hover:bg-black/[0.05] hover:text-foreground" onClick={onClick} aria-label={label}>
      <X className="size-3.5" strokeWidth={1.75} />
    </button>
  );
}

const DECISIONS: { value: RuleDecision; label: string; tone: string; hint: string }[] = [
  { value: "allow", label: "Allow", tone: "bg-success/12 text-success", hint: "Allow: does it automatically, without asking." },
  { value: "ask", label: "Ask", tone: "bg-warning/15 text-warning", hint: "Ask: waits for your approval every time." },
  { value: "never", label: "Never", tone: "bg-destructive/10 text-destructive", hint: "Never: blocked completely." },
];

const RULE_EXAMPLES = ["send emails", "reply to emails", "delete files", "post on social media"];

export function RuleEditor({ dotId, name }: { dotId: string | null; name: string }) {
  const all = useStore((s) => s.rules);
  const rules = useMemo(() => all.filter((r) => r.dotId === dotId), [all, dotId]);
  const [action, setAction] = useState("");
  const [decision, setDecision] = useState<RuleDecision>("ask");
  const [pending, start] = useTransition();

  return (
    <div className="space-y-3">
      {rules.length > 0 && (
        <div className="surface divide-y divide-black/[0.06]">
          {rules.map((r) => {
            const d = DECISIONS.find((x) => x.value === r.decision)!;
            return (
              <div key={r.id} className="flex items-center gap-3 py-2 pr-2 pl-4">
                <span className="min-w-0 flex-1 text-body-sm text-foreground/60">
                  When {name} wants to <span className="text-foreground">{r.action}</span>
                </span>
                <span className={`shrink-0 rounded-xs px-1.5 py-0.5 font-mono text-[11px] tracking-wider uppercase ${d.tone}`}>{d.label}</span>
                <RemoveButton label="Delete rule" onClick={() => start(() => actions.deleteRule(r.id))} />
              </div>
            );
          })}
        </div>
      )}
      <form
        className="surface space-y-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!action.trim()) return;
          start(() => actions.addRule(dotId, action, decision));
          setAction("");
        }}
      >
        <label className="block">
          <span className="eyebrow mb-1.5 block">When {name} wants to</span>
          <input className="field" placeholder="reply to emails for me" value={action} onChange={(e) => setAction(e.target.value)} />
          {!action && (
            <span className="mt-1.5 flex flex-wrap gap-1.5">
              {RULE_EXAMPLES.map((ex) => (
                <button key={ex} type="button" onClick={() => setAction(ex)} className="rounded-full border border-black/10 px-2.5 py-0.5 text-[12px] text-foreground/55 transition-colors hover:border-black/25 hover:text-foreground">
                  {ex}
                </button>
              ))}
            </span>
          )}
        </label>
        <div>
          <span className="eyebrow mb-1.5 block">It should</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {DECISIONS.map((d) => (
              <button
                key={d.value}
                type="button"
                onClick={() => setDecision(d.value)}
                className={`h-8 rounded-md border px-3 text-[13px] transition-colors ${decision === d.value ? `border-current ${d.tone} font-medium` : "border-black/10 text-foreground/70 hover:border-black/25"}`}
              >
                {d.label}
              </button>
            ))}
            <button className="btn-primary ml-auto h-8 px-3 text-[13px]" disabled={pending || !action.trim()}>
              Add rule
            </button>
          </div>
          <p className="mt-2 text-caption text-foreground/50">{DECISIONS.find((d) => d.value === decision)!.hint}</p>
        </div>
      </form>
      <p className="text-caption text-foreground/45">One short, natural-language rule per action. &ldquo;Ask first&rdquo; wins if rules conflict. Built-in safety checks always apply.</p>
    </div>
  );
}
