"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, LayoutGrid, LogOut, PanelLeftClose, Plus, Search, Settings, SquarePen, Trash2, X } from "lucide-react";
import { checkAuthStatus, deleteConversation, deleteConversations, lockApp } from "@/app/actions";
import { markRead, useStore } from "@/lib/store";
import {
  setDesktopSidebarOpen,
  setSidebarOpen,
  toggleDesktopSidebar,
  useDesktopSidebarOpen,
  useSidebarOpen,
} from "@/lib/ui";
import { statusDot, timeAgo } from "@/lib/status";
import ThemeToggle from "./ThemeToggle";
import DotOrb from "./DotOrb";
import type { Conversation, Message } from "@/lib/types";

export function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <span className="flex -space-x-1">
        <span className="size-3 rounded-full bg-foreground ring-2 ring-card" />
        <span className="size-3 rounded-full bg-brand ring-2 ring-card" />
        <span className="size-3 rounded-full bg-highlight ring-2 ring-card" />
      </span>
      <span className="text-[15px] font-medium tracking-tight">QDot</span>
    </span>
  );
}

/** Last readable line of a conversation, for the preview under its title. */
function preview(messages: Message[], convId: string): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.conversationId !== convId) continue;
    if (m.role === "card" && m.card?.status === "pending") return `Needs you: ${m.card.title}`;
    if ((m.role === "dot" || m.role === "user") && m.text) return (m.role === "user" ? "You: " : "") + m.text.replace(/[#*_`>|[\]]/g, "").replace(/\s+/g, " ");
  }
  return "";
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const activeConv = useSearchParams().get("c");
  const dots = useStore((s) => s.dots);
  const messages = useStore((s) => s.messages);
  const lastRead = useStore((s) => s.lastRead);
  const conversations = useStore((s) => s.conversations);
  const loaded = useStore((s) => s.loaded);
  const connected = useStore((s) => s.connected);
  const model = useStore((s) => s.computer.model);
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [scope, setScope] = useState<"dot" | "all">("dot");
  const [autoOpen, setAutoOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [, start] = useTransition();
  const activeDot = pathname.match(/^\/dots\/([^/]+)/)?.[1];
  const drawerOpen = useSidebarOpen();
  const desktopOpen = useDesktopSidebarOpen();

  useEffect(() => {
    checkAuthStatus().then((s) => setAuthEnabled(s.enabled));
    try {
      const v = localStorage.getItem("qdot-sidebar-scope");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (v === "all" || v === "dot") setScope(v);
      setAutoOpen(localStorage.getItem("qdot-sidebar-automations") === "1");
    } catch {
      // storage unavailable
    }
  }, []);

  const chooseScope = (v: "dot" | "all") => {
    setScope(v);
    try {
      localStorage.setItem("qdot-sidebar-scope", v);
    } catch {
      // ignore
    }
  };
  const toggleAutomations = () => {
    const next = !autoOpen;
    setAutoOpen(next);
    try {
      localStorage.setItem("qdot-sidebar-automations", next ? "1" : "0");
    } catch {
      // ignore
    }
  };

  // Save current route so the app can restore it after a mobile background kill
  useEffect(() => {
    if (pathname === "/" || pathname.startsWith("/login")) return;
    try {
      const full = pathname + (activeConv ? `?c=${activeConv}` : "");
      localStorage.setItem("qdot-lastRoute", full);
    } catch { /* localStorage unavailable */ }
  }, [pathname, activeConv]);

  // Keyboard shortcut: Ctrl+B or Cmd+B to toggle sidebar
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        if (typeof window !== "undefined" && window.innerWidth < 768) {
          setSidebarOpen(!drawerOpen);
        } else {
          toggleDesktopSidebar();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  const dotById = useMemo(() => new Map(dots.map((d) => [d.id, d])), [dots]);

  // Chats are ordered by when they were started, not by activity, so rows never jump while a dot works.
  // With a dot open the list shows that dot's chats; "All dots" (or searching) shows everything.
  const recent = useMemo(() => {
    const query = q.trim().toLowerCase();
    const sorted = [...conversations].sort((a, b) => b.createdAt - a.createdAt);
    if (!query) return scope === "all" || !activeDot ? sorted : sorted.filter((c) => c.dotId === activeDot);
    const hits = new Set(messages.filter((m) => m.conversationId && m.text.toLowerCase().includes(query)).map((m) => m.conversationId));
    return sorted.filter((c) => c.title.toLowerCase().includes(query) || hits.has(c.id) || dotById.get(c.dotId)?.name.toLowerCase().includes(query));
  }, [conversations, messages, q, dotById, scope, activeDot]);

  const isAutomation = (c: Conversation) => /^(Routine|Trigger) · /.test(c.title);
  const sections = useMemo(() => {
    const startOfToday = new Date().setHours(0, 0, 0, 0);
    const day = 24 * 60 * 60 * 1000;
    const groups: { key: string; label: string; items: Conversation[] }[] = [
      { key: "today", label: "Today", items: [] },
      { key: "yesterday", label: "Yesterday", items: [] },
      { key: "earlier", label: "Earlier", items: [] },
    ];
    const autos: Conversation[] = [];
    for (const c of recent) {
      if (isAutomation(c)) autos.push(c);
      else if (c.createdAt >= startOfToday) groups[0].items.push(c);
      else if (c.createdAt >= startOfToday - day) groups[1].items.push(c);
      else groups[2].items.push(c);
    }
    const out = groups.filter((g) => g.items.length);
    if (autos.length) out.push({ key: "auto", label: "Automations", items: autos });
    return out;
  }, [recent]);

  const unread = (c: Conversation) => {
    const since = lastRead[c.dotId];
    return since !== undefined && c.updatedAt > since && messages.some((m) => m.conversationId === c.id && m.role === "dot" && m.createdAt > since);
  };

  const remove = (c: Conversation) =>
    start(async () => {
      await deleteConversation(c.id);
      setConfirming(null);
      if (c.id === activeConv) router.push(`/dots/${c.dotId}`);
    });

  const closeSearch = () => (setSearching(false), setQ(""));

  // Chats you can see right now (an automation group that is folded away is not selectable)
  const visibleIds = useMemo(
    () => sections.filter((sec) => sec.key !== "auto" || autoOpen || Boolean(q)).flatMap((sec) => sec.items.map((c) => c.id)),
    [sections, autoOpen, q],
  );
  const stopSelecting = () => (setSelecting(false), setPicked(new Set()), setConfirmBulk(false));
  const toggle = (cid: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(cid)) next.delete(cid);
      else next.add(cid);
      return next;
    });
  const deletePicked = () =>
    start(async () => {
      const ids = [...picked];
      await deleteConversations(ids);
      const goBack = activeConv && ids.includes(activeConv);
      stopSelecting();
      if (goBack) router.push(activeDot ? `/dots/${activeDot}` : "/");
    });

  if (pathname === "/login") return null;

  return (
    <>
      {/* Phones / narrow windows: the sidebar is a drawer over a dimmed backdrop */}
      {drawerOpen && <div className="fixed inset-0 z-40 bg-black/25 md:hidden" onClick={() => setSidebarOpen(false)} />}
      <aside
        data-sidebar-root
        // Picking anything in the drawer closes it on mobile.
        onClickCapture={(e) => {
          if (typeof window !== "undefined" && window.innerWidth < 768 && (e.target as HTMLElement).closest("a")) {
            setSidebarOpen(false);
          }
        }}
        className={`fixed inset-y-0 left-0 z-50 flex w-[300px] max-w-[85vw] shrink-0 flex-col bg-background transition-all duration-200 ease-in-out md:static md:z-auto md:shadow-none ${
          drawerOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full md:translate-x-0"
        } ${desktopOpen ? "md:ml-0 md:opacity-100" : "md:-ml-[300px] md:opacity-0 md:pointer-events-none"}`}
      >
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center gap-1.5 px-3 sm:px-4">
        <Link href="/" className="mr-auto">
          <Wordmark />
        </Link>
        <button
          className={`flex size-9 items-center justify-center rounded-full border border-black/10 text-foreground/70 transition-colors hover:border-black/25 hover:text-foreground ${searching ? "bg-card" : ""}`}
          onClick={() => (searching ? closeSearch() : setSearching(true))}
          title="Search chats"
          aria-label="Search chats"
        >
          <Search className="size-4" strokeWidth={1.75} />
        </button>
        <Link
          href="/"
          className="flex size-9 items-center justify-center rounded-full border border-black/10 text-foreground/70 transition-colors hover:border-black/25 hover:text-foreground"
          title="New chat"
          aria-label="New chat"
          onClick={() => { try { localStorage.removeItem("qdot-lastRoute"); } catch {} }}
        >
          <SquarePen className="size-4" strokeWidth={1.75} />
        </Link>

        {/* Mobile close button: prominent 'X' button */}
        <button
          className="flex size-9 items-center justify-center rounded-full border border-black/10 text-foreground/70 transition-colors hover:border-black/25 hover:text-foreground md:hidden"
          onClick={() => setSidebarOpen(false)}
          title="Close sidebar"
          aria-label="Close sidebar"
        >
          <X className="size-4" strokeWidth={1.75} />
        </button>

        {/* Desktop collapse button: PanelLeftClose */}
        <button
          className="hidden md:flex size-9 items-center justify-center rounded-full border border-black/10 text-foreground/70 transition-colors hover:border-black/25 hover:text-foreground"
          onClick={() => setDesktopSidebarOpen(false)}
          title="Collapse sidebar (Ctrl+B)"
          aria-label="Collapse sidebar"
        >
          <PanelLeftClose className="size-4" strokeWidth={1.75} />
        </button>
      </div>

      {searching && (
        <div className="relative mx-3 mb-2">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-foreground/35" strokeWidth={1.75} />
          <input
            autoFocus
            className="field h-9 bg-popover pr-8 pl-8"
            placeholder="Search chats and dots"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && closeSearch()}
          />
          <button className="absolute top-1/2 right-2.5 -translate-y-1/2 text-foreground/40 hover:text-foreground" onClick={closeSearch} aria-label="Close search">
            <X className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
      )}

      {/* Your dots: a horizontal row of characters */}
      {!q && (
        <div className="shrink-0 pb-1">
          <div className="flex gap-0.5 overflow-x-auto px-2.5 pb-1 [scrollbar-width:none]">
            {!loaded &&
              !dots.length &&
              [0, 1, 2].map((i) => (
                <div key={i} className="flex w-[54px] shrink-0 flex-col items-center gap-1 py-1.5" aria-hidden="true">
                  <span className="skeleton size-10 rounded-full" />
                  <span className="skeleton h-2.5 w-9 rounded" />
                </div>
              ))}
            {dots.map((d) => (
              <Link
                key={d.id}
                href={`/dots/${d.id}`}
                onClick={() => markRead(d.id)}
                className={`flex w-[54px] shrink-0 flex-col items-center gap-1 rounded-lg py-1.5 transition-colors ${activeDot === d.id ? "bg-black/[0.05]" : "hover:bg-black/[0.03]"}`}
                title={`${d.name}${d.purpose ? ` · ${d.purpose}` : ""}`}
              >
                <span className="relative">
                  <DotOrb look={d.look} status={d.status} size={40} still />
                  {d.status !== "idle" && <span className={`absolute right-0 bottom-0.5 size-2.5 rounded-full ring-2 ring-card ${statusDot(d)}`} />}
                </span>
                <span className="w-full truncate text-center text-[12px] text-foreground/70">{d.name}</span>
              </Link>
            ))}
            <Link href="/new" className="flex w-[54px] shrink-0 flex-col items-center gap-1 rounded-lg py-1.5 text-foreground/45 hover:bg-black/[0.03] hover:text-foreground" title="New dot">
              <span className="flex size-10 items-center justify-center rounded-full border border-dashed border-black/20">
                <Plus className="size-4" strokeWidth={1.75} />
              </span>
              <span className="text-[12px]">New</span>
            </Link>
          </div>
        </div>
      )}

      {!q && activeDot && dotById.get(activeDot) && (
        <div className="mx-3 mb-1 flex shrink-0 gap-1 rounded-full bg-black/[0.04] p-0.5 text-[12px]" role="tablist" aria-label="Which chats to show">
          {(["dot", "all"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={scope === v}
              onClick={() => chooseScope(v)}
              className={`min-w-0 flex-1 truncate rounded-full px-2.5 py-1 transition-colors ${scope === v ? "bg-card text-foreground shadow-2xs" : "text-foreground/55 hover:text-foreground"}`}
            >
              {v === "dot" ? dotById.get(activeDot)?.name : "All dots"}
            </button>
          ))}
        </div>
      )}

      {/* Recent chats */}
      {q && <div className="eyebrow shrink-0 px-4 pt-2 pb-1.5">Chats matching “{q}”</div>}
      {loaded && visibleIds.length > 0 && (
        <div className="mx-3 mb-1 flex shrink-0 items-center gap-2 text-[12px]">
          {selecting ? (
            <>
              <button
                type="button"
                className="rounded-full px-2 py-1 text-foreground/70 hover:bg-black/[0.05] hover:text-foreground"
                onClick={() => setPicked(picked.size === visibleIds.length ? new Set() : new Set(visibleIds))}
              >
                {picked.size === visibleIds.length ? "Clear all" : `Select all (${visibleIds.length})`}
              </button>
              <span className="ml-auto text-foreground/50">{picked.size} selected</span>
              <button type="button" className="rounded-full px-2 py-1 text-foreground/70 hover:bg-black/[0.05] hover:text-foreground" onClick={stopSelecting}>
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="ml-auto rounded-full px-2 py-1 text-foreground/55 hover:bg-black/[0.05] hover:text-foreground"
              onClick={() => (setSelecting(true), setConfirmBulk(false))}
            >
              Select
            </button>
          )}
        </div>
      )}
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {!loaded && (
          <div role="status" aria-label="Loading chats" className="space-y-0.5">
            {[68, 54, 62, 46, 58, 50].map((w, i) => (
              <div key={i} className="flex items-center gap-3 px-2.5 py-2.5" aria-hidden="true">
                <span className="skeleton size-[42px] shrink-0 rounded-full" />
                <span className="min-w-0 flex-1 space-y-2">
                  <span className="skeleton block h-3 rounded" style={{ width: `${w}%` }} />
                  <span className="skeleton block h-2.5 w-[86%] rounded" />
                </span>
              </div>
            ))}
          </div>
        )}
        {sections.map((sec) => (
          <div key={sec.key} className="mb-1">
            {sec.key === "auto" ? (
              <button
                type="button"
                onClick={toggleAutomations}
                aria-expanded={autoOpen || Boolean(q)}
                className="flex w-full items-center gap-1.5 px-2.5 pt-2 pb-1 text-left text-[12px] text-foreground/50 hover:text-foreground"
              >
                <ChevronDown className={`size-3.5 transition-transform ${autoOpen || q ? "" : "-rotate-90"}`} strokeWidth={1.75} />
                Automations · {sec.items.length}
              </button>
            ) : (
              <div className="px-2.5 pt-2 pb-1 text-[12px] text-foreground/45">{sec.label}</div>
            )}
            {(sec.key !== "auto" || autoOpen || Boolean(q)) &&
        sec.items.map((c) => {
          const d = dotById.get(c.dotId);
          if (!d) return null;
          if (confirming === c.id) {
            return (
              <div key={c.id} className="my-0.5 flex items-center gap-2 rounded-lg bg-destructive/[0.06] px-3 py-2.5">
                <span className="min-w-0 flex-1 truncate text-[13px] text-destructive">Delete “{c.title}”?</span>
                <button className="btn-quiet h-7 px-2 text-[12px] text-destructive" onClick={() => remove(c)}>
                  Delete
                </button>
                <button className="btn-quiet size-7 p-0" onClick={() => setConfirming(null)} aria-label="Cancel">
                  <X className="size-3.5" strokeWidth={2} />
                </button>
              </div>
            );
          }
          if (selecting) {
            const on = picked.has(c.id);
            return (
              <button
                key={c.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(c.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors ${on ? "bg-brand/[0.08]" : "hover:bg-black/[0.03]"}`}
              >
                <span className={`flex size-5 shrink-0 items-center justify-center rounded-md border ${on ? "border-brand bg-brand text-white" : "border-black/25 bg-card"}`}>
                  {on && <Check className="size-3.5" strokeWidth={3} />}
                </span>
                <DotOrb look={d.look} status={d.status} size={32} still />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{c.title}</span>
                  <span className="block truncate text-[12px] text-foreground/50">{d.name}</span>
                </span>
              </button>
            );
          }
          const line = preview(messages, c.id);
          return (
            <div key={c.id} className={`group relative flex items-center rounded-xl transition-colors ${c.id === activeConv ? "bg-card shadow-2xs" : "hover:bg-black/[0.03]"}`}>
              <Link href={`/dots/${d.id}?c=${c.id}`} onClick={() => markRead(d.id)} className="flex min-w-0 flex-1 items-center gap-3 px-2.5 py-2.5 [@media(hover:none)]:pr-12">
                <DotOrb look={d.look} status={d.status} size={42} still />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate text-[15px] font-medium">{c.title}</span>
                    {unread(c) && <span className="size-2 shrink-0 self-center rounded-full bg-brand" />}
                    <span className="ml-auto shrink-0 font-mono text-[11px] text-foreground/35 group-hover:invisible">{timeAgo(c.createdAt).replace(" ago", "")}</span>
                  </span>
                  <span className="block truncate text-[13px] text-foreground/50">
                    <span className="text-foreground/65">{d.name}</span>
                    {line ? ` · ${line}` : ""}
                  </span>
                </span>
              </Link>
              <button
                className="absolute top-2 right-2 hidden size-6 items-center justify-center rounded text-foreground/40 group-hover:flex hover:bg-black/[0.05] hover:text-destructive [@media(hover:none)]:top-1/2 [@media(hover:none)]:right-1.5 [@media(hover:none)]:flex [@media(hover:none)]:size-10 [@media(hover:none)]:-translate-y-1/2 [@media(hover:none)]:rounded-full"
                onClick={() => setConfirming(c.id)}
                aria-label={`Delete ${c.title}`}
                title="Delete chat"
              >
                <Trash2 className="size-3.5" strokeWidth={1.75} />
              </button>
            </div>
          );
        })}
          </div>
        ))}
        {loaded && !recent.length && (
          <p className="px-3 py-6 text-center text-caption text-foreground/45">
            {q ? "No chats match." : dots.length ? "No chats yet. Pick a dot above to start one." : "Create your first dot to start chatting."}
          </p>
        )}
      </nav>

      {selecting && picked.size > 0 && (
        <div className="mx-3 mb-2 flex shrink-0 items-center gap-2 rounded-xl bg-destructive/[0.07] px-3 py-2">
          {confirmBulk ? (
            <>
              <span className="min-w-0 flex-1 text-[13px] text-destructive">
                Delete {picked.size} chat{picked.size === 1 ? "" : "s"} for good?
              </span>
              <button type="button" className="btn-quiet h-7 px-2 text-[12px] text-destructive" onClick={deletePicked}>
                Delete
              </button>
              <button type="button" className="btn-quiet size-7 p-0" onClick={() => setConfirmBulk(false)} aria-label="Cancel">
                <X className="size-3.5" strokeWidth={2} />
              </button>
            </>
          ) : (
            <button type="button" className="flex flex-1 items-center justify-center gap-1.5 text-[13px] text-destructive" onClick={() => setConfirmBulk(true)}>
              <Trash2 className="size-3.5" strokeWidth={1.75} /> Delete {picked.size} selected
            </button>
          )}
        </div>
      )}

      {/* Bottom */}
      <div className="flex shrink-0 items-center gap-2 p-3">
        <Link
          href="/apps"
          className={`flex h-10 flex-1 items-center justify-center gap-2 rounded-full border text-[14px] transition-colors ${pathname === "/apps" ? "border-foreground bg-card" : "border-black/10 hover:border-black/25 dark:border-white/10 dark:hover:border-white/25"}`}
        >
          <LayoutGrid className="size-4" strokeWidth={1.5} /> Apps
        </Link>
        <ThemeToggle />
        <Link
          href="/settings"
          className={`relative flex size-10 items-center justify-center rounded-full border transition-colors ${pathname === "/settings" ? "border-foreground bg-card" : "border-black/10 hover:border-black/25 dark:border-white/10 dark:hover:border-white/25"}`}
          title={`Settings · ${model || "model"} · ${connected ? "connected" : "reconnecting"}`}
          aria-label="Settings"
        >
          <Settings className="size-4" strokeWidth={1.5} />
          <span className={`absolute top-0.5 right-0.5 size-2 rounded-full ring-2 ring-background ${connected ? "bg-success" : "bg-foreground/25"}`} />
        </Link>
        {authEnabled && (
          <button
            type="button"
            onClick={() => {
              start(async () => {
                await lockApp();
                router.replace("/login");
                router.refresh();
              });
            }}
            className="flex size-10 items-center justify-center rounded-full border border-black/10 text-foreground/60 transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive dark:border-white/10"
            title="Lock workspace / Logout"
            aria-label="Lock workspace / Logout"
          >
            <LogOut className="size-4" strokeWidth={1.5} />
          </button>
        )}
      </div>
      </aside>
    </>
  );
}
