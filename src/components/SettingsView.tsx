"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Bell,
  CheckCircle2,
  Download,
  ChevronDown,
  Eye,
  EyeOff,
  KeyRound,
  Laptop,
  Lock,
  LogOut,
  Moon,
  Plus,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sun,
  Zap,
} from "lucide-react";
import {
  checkAuthStatus,
  connectApp,
  deletePassword,
  getCloudflareConfig,
  getCloudKey,
  getAnthropicKey,
  getGoogleKey,
  getGroqKey,
  getOpenAIKey,
  getOpenRouterKey,
  addAppAccount,
  getAppAccounts,
  getProfile,
  removeAppAccount,
  renameAppAccount,
  saveProfile,
  lockApp,
  refreshApps,
  savePassword,
  setCloudflareWorker,
  setCloudKey,
  setDefaultModel,
  setAnthropicKey,
  setGoogleKey,
  setGroqKey,
  setOpenAIKey,
  setOpenRouterKey,
  signInComposio,
  signOutComposio,
} from "@/app/actions";
import type { AppAccount } from "@/server/composio";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { openAfter } from "@/lib/popup";
import { Empty, PageHeader, RemoveButton, RuleEditor, Section } from "./SettingsKit";
import ModelPicker from "./ModelPicker";
import { TriggersKey } from "./Triggers";
import StorageManager from "./StorageManager";
import LeadsSection from "./LeadsSection";

const noop = () => () => {};
const notificationPermission = () => ("Notification" in window ? Notification.permission : "unsupported");

export default function SettingsView() {
  const passwords = useStore((s) => s.passwords);
  const computer = useStore((s) => s.computer);
  const permission = useSyncExternalStore(noop, notificationPermission, () => "default");
  const [, force] = useState(0);
  const [form, setForm] = useState({ site: "", username: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="rails mx-auto min-h-full max-w-[1080px] px-4 sm:px-8 pb-16">
        <PageHeader eyebrow="Settings" title="Settings" description="Configure your AI engine, integrations, notifications, and workspace security." />

        <ProfileSection />

        <Section collapsible defaultOpen openOnHash={["cloudflare-worker"]} eyebrow="Engine" title="Models & computers" description="Models run on your Cloudflare AI Worker (free, fast), Google Gemini, OpenRouter, or OpenAI GPT models.">
          <ProviderGroup>
            <CloudflareWorkerKey />
            <GoogleKey />
            <GroqKey />
            <OpenModelsKey />
            <AnthropicKey />
            <OpenAIKey />
          </ProviderGroup>
          <CloudKey />
          <div className="surface mb-3 flex items-center gap-3 p-4">
            <div className="flex-1">
              <div className="text-[14px]">Default model</div>
              <div className="text-body-sm text-foreground/55">Used by every dot that doesn&apos;t pick its own (pick per dot from its header).</div>
            </div>
            <ModelPicker allowDefault={false} value={computer.model || null} onChange={(m) => start(() => setDefaultModel(m))} />
          </div>
          <dl className="surface divide-y divide-black/[0.06]">
            {[
              ["Models available", computer.models.length ? `${computer.models.length} available` : "Loading…", true],
              ["Dot computers", computer.docker ? `Docker containers · ${computer.image}` : "Docker not available in this environment", computer.docker],
            ].map(([k, v, ok]) => (
              <div key={String(k)} className="flex items-center gap-4 px-4 py-2.5">
                <dt className="eyebrow w-36 shrink-0">{k}</dt>
                <dd className={`flex-1 text-body-sm ${ok ? "" : "text-warning"}`}>{v}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section collapsible defaultOpen
          id="apps"
          eyebrow="Apps"
          title="Your apps, via Composio"
          description="Sign in with your Composio account to give your dots Gmail, Calendar, Slack, Notion, GitHub, and 500+ more apps. Dots read on their own and ask before sending, posting, or changing anything."
        >
          <AppsList />
        </Section>

        <Section collapsible
          id="storage"
          eyebrow="Storage & Files"
          title="Cloud & Local Storage"
          description="Your attachments and Google Drive backup."
        >
          <StorageManager />
        </Section>

        <Section collapsible
          id="leads"
          eyebrow="Leads"
          title="Saved leads"
          description="People your dots found by reading real pages."
        >
          <LeadsSection />
        </Section>

        <Section collapsible eyebrow="Approvals" title="Rules for all dots" description="These apply to every dot, on top of each dot's own rules.">
          <RuleEditor dotId={null} name="a dot" />
        </Section>

        <Section collapsible
          eyebrow="Passwords"
          title="Saved logins"
          description="Your dots can securely use these to log into websites in their browser. Encrypted with AES-256-GCM. Typed directly into the page and never shown to the model."
        >
          <div className="space-y-3">
            {passwords.length > 0 ? (
              <div className="surface divide-y divide-black/[0.06]">
                {passwords.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 py-2 pr-2 pl-4">
                    <KeyRound className="size-3.5 text-foreground/40" strokeWidth={1.75} />
                    <span className="w-40 truncate text-[14px]">{p.site}</span>
                    <span className="min-w-0 flex-1 truncate text-body-sm text-foreground/55">{p.username}</span>
                    <span className="font-mono text-[12px] tracking-widest text-foreground/35">••••••••</span>
                    <RemoveButton label="Delete password" onClick={() => start(() => deletePassword(p.id))} />
                  </div>
                ))}
              </div>
            ) : (
              <Empty>No saved logins yet.</Empty>
            )}
            <form
              className="surface space-y-3 p-4"
              autoComplete="off"
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => {
                  const err = await savePassword(form.site, form.username, form.password);
                  setError(err);
                  if (!err) setForm({ site: "", username: "", password: "" });
                });
              }}
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <input className="field" placeholder="Site, e.g. github.com" value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })} />
                <input className="field" placeholder="Username or email" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
                <input className="field" type="password" placeholder="Password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1.5 text-caption text-foreground/45">
                  <Lock className="size-3" strokeWidth={2} /> AES-256-GCM encrypted
                </span>
                {error && <span className="text-caption text-destructive">{error}</span>}
                <button className="btn-primary ml-auto h-8 px-3 text-[13px]" disabled={pending}>
                  Save login
                </button>
              </div>
            </form>
          </div>
        </Section>

        <Section collapsible
          id="triggers"
          eyebrow="Triggers"
          title="Wake dots from your apps"
          description="Let a dot act when something happens, like a new email or a GitHub issue. Triggers run through a Composio developer project, so they need its API key. Then add them from a dot's Setup page."
        >
          <TriggersKey />
        </Section>

        <AccessSecuritySection />

        <Section collapsible eyebrow="Notifications" title="Notifications" description={'Get notified when a dot finishes something or needs you, like "Your research is ready".'}>
          <div className="surface flex items-center gap-3 p-4">
            <Bell className="size-4 text-foreground/50" strokeWidth={1.5} />
            <span className="flex-1 text-body-sm">
              {permission === "granted"
                ? "Notifications are on."
                : permission === "denied"
                  ? "Notifications are blocked in your browser settings for this site."
                  : permission === "unsupported"
                    ? "This browser doesn't support notifications."
                    : "Notifications are off."}
            </span>
            {permission === "default" && (
              <button className="btn-primary h-8 px-3 text-[13px]" onClick={() => Notification.requestPermission().then(() => force((n) => n + 1))}>
                Turn on
              </button>
            )}
            {permission === "granted" && <span className="rounded-xs bg-success/12 px-1.5 py-0.5 font-mono text-[11px] tracking-wider text-success uppercase">On</span>}
          </div>
        </Section>

        <AppearanceSection />

        <InstallAppSection />
      </div>
    </div>
  );
}

/** The model-provider cards, folded into one row that shows who is connected. */
function ProviderGroup({ children }: { children: React.ReactNode }) {
  const computer = useStore((s) => s.computer);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem("qdot-settings-providers") === "1") setOpen(true);
    } catch {
      // ignore
    }
    if (window.location.hash === "#cloudflare-worker") setOpen(true);
  }, []);

  const providers: [string, boolean][] = [
    ["Cloudflare", Boolean(computer.cloudflare)],
    ["Google", Boolean(computer.google)],
    ["Groq", Boolean(computer.groq)],
    ["OpenRouter", Boolean(computer.openRouter)],
    ["Anthropic", Boolean(computer.anthropic)],
    ["OpenAI", Boolean(computer.hasKey)],
  ];
  const connected = providers.filter(([, on]) => on).length;

  return (
    <div className="mb-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          const next = !open;
          setOpen(next);
          try {
            localStorage.setItem("qdot-settings-providers", next ? "1" : "0");
          } catch {
            // ignore
          }
        }}
        className="surface group flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-left"
      >
        <span className="min-w-0 flex-1 basis-40">
          <span className="block text-[14px]">Model providers</span>
          <span className="block text-caption text-foreground/55">
            {connected} of {providers.length} connected
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {providers.map(([name, on]) => (
            <span key={name} className="inline-flex items-center gap-1.5 rounded-full bg-foreground/[0.05] px-2 py-0.5 text-[12px] text-foreground/70">
              <span className={`size-1.5 rounded-full ${on ? "bg-success" : "bg-foreground/25"}`} />
              {name}
            </span>
          ))}
        </span>
        <ChevronDown className={`size-4 shrink-0 text-foreground/45 transition-transform duration-200 group-hover:text-foreground ${open ? "rotate-180" : ""}`} strokeWidth={1.75} />
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

function ProfileSection() {
  const [form, setForm] = useState({ name: "", role: "", company: "" });
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    getProfile()
      .then((p) => setForm({ name: p.name, role: p.role, company: p.company || p.defaultCompany }))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const set = (patch: Partial<typeof form>) => {
    setSaved(false);
    setForm((f) => ({ ...f, ...patch }));
  };

  return (
    <Section collapsible defaultOpen
      id="profile"
      eyebrow="Profile"
      title="About you & your company"
      description="Your dots use this to know who they work for and what your business does. Leave your name empty and they will not guess one."
    >
      <div className="space-y-2.5">
        <div className="grid gap-2 sm:grid-cols-2">
          <input className="field" placeholder="Your name" value={form.name} disabled={!loaded} onChange={(e) => set({ name: e.target.value })} />
          <input className="field" placeholder="Your role, e.g. Co-Founder" value={form.role} disabled={!loaded} onChange={(e) => set({ role: e.target.value })} />
        </div>
        <textarea
          className="field min-h-40 resize-y"
          placeholder="About your company: what you do, services, ideal clients, tone..."
          value={form.company}
          disabled={!loaded}
          onChange={(e) => set({ company: e.target.value })}
        />
        <div className="flex items-center gap-3">
          {saved && <span className="text-caption text-foreground/45">Saved</span>}
          <button
            className="btn-primary ml-auto h-8 px-3 text-[13px]"
            disabled={pending || !loaded}
            onClick={() => start(async () => { await saveProfile(form); setSaved(true); })}
          >
            Save
          </button>
        </div>
      </div>
    </Section>
  );
}

/** One connected app. Expands to list its accounts, with rename, remove and add another. */
function ConnectedApp({ app }: { app: { slug: string; name: string; logo?: string } }) {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<AppAccount[] | null>(null);
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newAlias, setNewAlias] = useState("");
  const [pending, start] = useTransition();

  const load = () =>
    getAppAccounts(app.slug).then((r) => {
      setAccounts(r.accounts);
      setRaw(r.raw);
      if (r.error) setError(r.error);
    });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && accounts === null) start(() => load());
  };

  const run = (job: () => Promise<string | null>) =>
    start(async () => {
      setError(null);
      const err = await job();
      if (err) setError(err);
      setEditing(null);
      setConfirming(null);
      await load();
    });

  return (
    <div className={`bg-card ${open ? "sm:col-span-2" : ""}`}>
      <button type="button" onClick={toggle} className="flex w-full items-center gap-3 px-4 py-2.5 text-left" aria-expanded={open}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={app.logo} alt="" className="size-5 rounded-xs object-contain" />
        <span className="flex-1 truncate text-[14px]">{app.name}</span>
        <span className="size-1.5 rounded-full bg-success" title="Connected" />
        <span className="text-caption text-foreground/40">{open ? "Hide" : "Accounts"}</span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-black/[0.06] px-4 py-3">
          {accounts === null && <div className="text-caption text-foreground/50">Loading accounts…</div>}
          {accounts?.length === 0 && (
            <div className="text-caption text-foreground/50">
              Couldn&apos;t read the accounts list.
              {raw && <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px]">{raw}</pre>}
            </div>
          )}
          {accounts?.map((acc) => (
            <div key={acc.id} className="rounded-lg border border-black/[0.08] p-3 dark:border-white/[0.1]">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[13px] font-medium">{acc.alias ?? "Default (no name)"}</span>
                <span className="rounded-xs bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[11px] tracking-wider text-foreground/50 uppercase">{acc.status}</span>
              </div>
              {acc.label && <div className="mt-0.5 text-caption break-all text-foreground/60">{acc.label}</div>}
              <div className="mt-0.5 font-mono text-[11px] break-all text-foreground/35">{acc.id}</div>

              {editing === acc.id ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input className="field h-9 min-w-0 flex-1 basis-40 text-[13px]" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="New name, e.g. qdelta-page" autoFocus />
                  <button className="btn-primary h-9 px-3 text-[13px]" disabled={pending} onClick={() => run(() => renameAppAccount(app.slug, acc.id, draft))}>Save</button>
                  <button className="btn-quiet h-9 px-3 text-[13px]" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              ) : confirming === acc.id ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-destructive">Remove this account for every dot?</span>
                  <button className="btn-quiet h-9 px-3 text-[13px] text-destructive" disabled={pending} onClick={() => run(() => removeAppAccount(app.slug, acc.id))}>Remove</button>
                  <button className="btn-quiet h-9 px-3 text-[13px]" onClick={() => setConfirming(null)}>Cancel</button>
                </div>
              ) : (
                <div className="mt-2 flex gap-2">
                  <button className="btn-secondary h-9 px-3 text-[13px]" onClick={() => { setEditing(acc.id); setDraft(acc.alias ?? ""); }}>Rename</button>
                  <button className="btn-quiet h-9 px-3 text-[13px] text-destructive" onClick={() => setConfirming(acc.id)}>Remove</button>
                </div>
              )}
            </div>
          ))}

          {adding ? (
            <div className="flex flex-wrap items-center gap-2">
              <input className="field h-9 min-w-0 flex-1 basis-40 text-[13px]" value={newAlias} onChange={(e) => setNewAlias(e.target.value)} placeholder={`Name for the new ${app.name} account`} autoFocus />
              <button
                className="btn-primary h-9 px-3 text-[13px]"
                disabled={pending || !newAlias.trim()}
                onClick={() =>
                  start(() =>
                    openAfter(() => addAppAccount(app.slug, newAlias), setError).then(() => {
                      setAdding(false);
                      setNewAlias("");
                    })
                  )
                }
              >
                Sign in
              </button>
              <button className="btn-quiet h-9 px-3 text-[13px]" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn-secondary h-9 px-3 text-[13px]" onClick={() => setAdding(true)}>
                <Plus className="size-3.5" strokeWidth={2} /> Add another {app.name} account
              </button>
              <button className="btn-quiet h-9 px-3 text-[13px]" disabled={pending} onClick={() => start(() => load())}>
                <RefreshCw className="size-3.5" strokeWidth={1.75} /> Refresh
              </button>
            </div>
          )}
          {error && <div className="text-caption break-words text-destructive">{error}</div>}
        </div>
      )}
    </div>
  );
}

function AppsList() {
  const apps = useStore((s) => s.apps);
  const signedIn = useStore((s) => s.computer.composio);
  const signInError = useSearchParams().get("composio_error");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const connected = apps.filter((a) => a.connected);
  const suggested = apps.filter((a) => !a.connected);

  if (!signedIn) {
    return (
      <div className="surface overflow-hidden">
        <div className="flex items-center gap-4 p-5">
          <div className="flex -space-x-2">
            {["gmail", "googlecalendar", "slack", "notion", "github"].map((slug) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={slug} src={`https://logos.composio.dev/api/${slug}`} alt="" className="size-8 rounded-full border-2 border-card bg-card object-contain p-1 shadow-sm" />
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-medium">Composio For You</div>
            <div className="text-body-sm text-foreground/55">One sign-in connects your dots to the apps you already use. No API keys.</div>
          </div>
          <button
            className="btn-primary shrink-0"
            disabled={pending}
            onClick={() => start(() => openAfter(signInComposio, setError))}
          >
            Sign in with Composio
          </button>
        </div>
        {(error || signInError) && <div className="border-t border-black/[0.06] px-5 py-2.5 text-caption text-destructive">{error ?? signInError}</div>}
      </div>
    );
  }

  const connect = (slug: string) => {
    setBusy(slug);
    start(() => openAfter(() => connectApp(slug), setError).finally(() => setBusy(null)));
  };

  return (
    <div className="space-y-3">
      <div className="surface flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="https://logos.composio.dev/api/composio" alt="" className="size-6 rounded-xs object-contain" />
        <div className="min-w-0 flex-1 basis-40">
          <div className="text-[14px]">Composio For You</div>
          <div className="text-caption text-foreground/50">Signed in · {connected.length} app{connected.length === 1 ? "" : "s"} connected</div>
        </div>
        <span className="rounded-xs bg-success/12 px-1.5 py-0.5 font-mono text-[11px] tracking-wider text-success uppercase">Connected</span>
        <button className="btn-quiet" disabled={pending} onClick={() => start(() => refreshApps())} title="Refresh">
          <RefreshCw className="size-3.5" strokeWidth={1.75} />
        </button>
        <button className="btn-quiet" disabled={pending} onClick={() => start(() => signOutComposio())}>
          <LogOut className="size-3.5" strokeWidth={1.75} /> Sign out
        </button>
      </div>

      {connected.length > 0 && (
        <div className="surface grid gap-px overflow-hidden bg-black/[0.06] sm:grid-cols-2">
          {connected.map((a) => (
            <ConnectedApp key={a.slug} app={a} />
          ))}
        </div>
      )}

      {suggested.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="eyebrow">Connect more</span>
            <a href="/apps" className="btn-quiet">Browse all apps →</a>
          </div>
          <div className="flex flex-wrap gap-2">
            {suggested.map((a) => (
              <button
                key={a.slug}
                className="flex h-9 items-center gap-2 rounded-md border border-black/10 bg-card pr-3 pl-2 text-[13px] transition-colors hover:border-black/25"
                disabled={pending}
                onClick={() => connect(a.slug)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.logo} alt="" className="size-4 object-contain" />
                {busy === a.slug ? "Opening…" : a.name}
                <Plus className="size-3 text-foreground/40" strokeWidth={2} />
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <p className="text-caption text-destructive">{error}</p>}
    </div>
  );
}

/** Optional E2B key: each dot gets a cloud computer that keeps working while you're away. */
function CloudKey() {
  const computer = useStore((s) => s.computer);
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const saved = computer.cloudKey !== null;

  const handleStartEdit = async () => {
    setEditing(true);
    try {
      const val = await getCloudKey();
      if (val) setKey(val);
    } catch {}
  };

  useEffect(() => {
    if (editing && !key) {
      void getCloudKey().then((val) => {
        if (val) setKey(val);
      });
    }
  }, [editing]);

  const save = (value: string) =>
    start(async () => {
      const err = await setCloudKey(value);
      setError(err);
      if (!err) {
        setKey("");
        setEditing(false);
        setShowKey(false);
      }
    });

  return (
    <div id="cloud-key" className="surface mb-3 scroll-mt-6 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <div className="text-[14px]">
            Cloud computers <span className="text-foreground/40">· optional</span>
          </div>
          <div className="text-body-sm text-foreground/55">
            {computer.cloudKey === "env"
              ? "Connected from E2B_API_KEY."
              : saved
                ? "Connected. Each dot gets its own E2B cloud computer that keeps working while you're away."
                : "Paste an E2B API key (from e2b.dev) to give each dot a cloud computer that keeps working while you're away."}
          </div>
        </div>
        {saved && !editing && (
          <>
            <button className="btn-quiet h-8 px-3 text-[13px]" disabled={pending} onClick={() => save("")}>
              Remove
            </button>
            <button className="btn-secondary h-8 px-3 text-[13px]" onClick={handleStartEdit}>
              Change
            </button>
          </>
        )}
      </div>
      {(editing || !saved) && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save(key);
          }}
        >
          <div className="relative flex-1">
            <input
              className="field font-mono text-[13px] pr-9 w-full"
              type={showKey ? "text" : "password"}
              placeholder="e2b_..."
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground/40 hover:text-foreground p-1 transition-colors"
              title={showKey ? "Hide key" : "Show key"}
            >
              {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {editing && (
            <button
              type="button"
              className="btn-secondary shrink-0"
              onClick={() => {
                setEditing(false);
                setError(null);
                setShowKey(false);
              }}
            >
              Cancel
            </button>
          )}
          <button className="btn-primary shrink-0" disabled={pending || !key.trim()}>
            {pending ? "Checking…" : "Save"}
          </button>
        </form>
      )}
      {error && <p className="mt-2 text-caption text-destructive">{error}</p>}
    </div>
  );
}

/** Cloudflare AI Worker: connect opendot-worker URL and optional auth token. */
function CloudflareWorkerKey() {
  const computer = useStore((s) => s.computer);
  const cfCount = computer.models.filter((m) => m.startsWith("cloudflare:")).length;
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const saved = Boolean(computer.cloudflare?.url);

  const handleStartEdit = async () => {
    setEditing(true);
    try {
      const cfg = await getCloudflareConfig();
      if (cfg.url) setUrl(cfg.url);
      if (cfg.token) setToken(cfg.token);
    } catch {
      setUrl(computer.cloudflare?.url || "");
    }
  };

  useEffect(() => {
    if (editing && (!url || !token)) {
      void getCloudflareConfig().then((cfg) => {
        if (cfg.url && !url) setUrl(cfg.url);
        if (cfg.token && !token) setToken(cfg.token);
      });
    }
  }, [editing]);

  const save = (urlVal: string, tokenVal?: string) =>
    start(async () => {
      const err = await setCloudflareWorker(urlVal, tokenVal);
      setError(err);
      if (!err) {
        setUrl("");
        setToken("");
        setEditing(false);
        setShowToken(false);
      }
    });

  return (
    <div id="cloudflare-worker" className="surface mb-3 scroll-mt-6 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex items-center gap-2 text-[14px]">
            Cloudflare AI Worker <span className="rounded-xs bg-success/12 px-1.5 py-0.5 font-mono text-[11px] tracking-wider text-success uppercase">Recommended · Fast</span>
          </div>
          <div className="text-body-sm text-foreground/55">
            {computer.cloudflare?.source === "env"
              ? `Connected from CLOUDFLARE_WORKER_URL${cfCount ? ` · ${cfCount} edge models in the model picker` : ""}.`
              : computer.cloudflare?.source === "default"
                ? `Connected to default Cloudflare Workers AI edge proxy${cfCount ? ` · ${cfCount} edge models in the model picker` : ""}.`
              : saved
                ? `Connected to ${computer.cloudflare?.url}${cfCount ? ` · ${cfCount} edge models in the model picker` : ""}. Multi-worker failover active.`
                : "Connect one or more opendot-worker URLs (comma-separated). When a worker reaches Cloudflare's daily 10k neuron limit, QDot automatically switches to the next worker."}
          </div>
        </div>
        {saved && !editing && (
          computer.cloudflare?.source === "env" || computer.cloudflare?.source === "default"
            ? <span className="rounded-md bg-foreground/[0.06] px-2.5 py-1 font-mono text-[11px] text-foreground/45 uppercase tracking-wider">Environment variable</span>
            : <div className="flex items-center gap-2">
                <button className="btn-quiet h-8 px-3 text-[13px]" disabled={pending} onClick={() => save("")}>Remove</button>
                <button className="btn-secondary h-8 px-3 text-[13px]" onClick={handleStartEdit}>Change</button>
              </div>
        )}
      </div>
      {(editing || !saved) && computer.cloudflare?.source !== "env" && computer.cloudflare?.source !== "default" && (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            save(url, token);
          }}
        >
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              className="field font-mono text-[13px] flex-1"
              type="text"
              placeholder="https://worker1.workers.dev, https://worker2.workers.dev (comma-separated for failover)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoComplete="off"
            />
            <div className="relative sm:w-52">
              <input
                className="field font-mono text-[13px] pr-9 w-full"
                type={showToken ? "text" : "password"}
                placeholder="Token (Optional)"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground/40 hover:text-foreground p-1 transition-colors"
                title={showToken ? "Hide token" : "Show token"}
              >
                {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            {editing && (
              <button
                type="button"
                className="btn-secondary shrink-0"
                onClick={() => {
                  setEditing(false);
                  setShowToken(false);
                }}
              >
                Cancel
              </button>
            )}
            <button className="btn-primary shrink-0" disabled={pending || !url.trim()}>
              {pending ? "Connecting…" : "Save"}
            </button>
          </div>
        </form>
      )}
      {error && <p className="mt-2 text-caption text-destructive">{error}</p>}
    </div>
  );
}

/** Google AI Studio key: adds Gemini 2.0/2.5 models — reliable free tier, great for night automations. */
function GoogleKey() {
  const computer = useStore((s) => s.computer);
  const googleCount = computer.models.filter((m) => m.startsWith("google:")).length;
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const saved = computer.google !== null && computer.google !== undefined;

  const handleStartEdit = async () => {
    setEditing(true);
    try {
      const val = await getGoogleKey();
      if (val) setKey(val);
    } catch {}
  };

  useEffect(() => {
    if (editing && !key) {
      void getGoogleKey().then((val) => { if (val) setKey(val); });
    }
  }, [editing]);

  const save = (value: string) =>
    start(async () => {
      const err = await setGoogleKey(value);
      setError(err);
      if (!err) { setKey(""); setEditing(false); setShowKey(false); }
    });

  return (
    <div id="google-key" className="surface mb-3 scroll-mt-6 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex items-center gap-2 text-[14px]">
            Google Gemini <span className="rounded-xs bg-blue-500/12 px-1.5 py-0.5 font-mono text-[11px] tracking-wider text-blue-600 dark:text-blue-400 uppercase">Free · Reliable</span>
          </div>
          <div className="text-body-sm text-foreground/55">
            {computer.google === "env"
              ? `Connected from GOOGLE_AI_API_KEY${googleCount ? ` · ${googleCount} Gemini models in the model picker` : ""}.`
              : saved
                ? `Connected${googleCount ? ` · ${googleCount} Gemini models in the model picker` : ""}. Stored encrypted.`
                : "Paste a Google AI Studio key (from aistudio.google.com) — free tier gives 1M tokens/day on Gemini Flash. Great for night automation."}
          </div>
        </div>
        {saved && !editing && (
          computer.google === "env"
            ? <span className="rounded-md bg-foreground/[0.06] px-2.5 py-1 font-mono text-[11px] text-foreground/45 uppercase tracking-wider">Environment variable</span>
            : <div className="flex items-center gap-2">
                <button className="btn-quiet h-8 px-3 text-[13px]" disabled={pending} onClick={() => save("")}>Remove</button>
                <button className="btn-secondary h-8 px-3 text-[13px]" onClick={handleStartEdit}>Change</button>
              </div>
        )}
      </div>
      {(editing || !saved) && computer.google !== "env" && (
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); save(key); }}>
          <div className="relative flex-1">
            <input
              className="field font-mono text-[13px] pr-9 w-full"
              type={showKey ? "text" : "password"}
              placeholder="AIza..."
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
            />
            <button type="button" onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground/40 hover:text-foreground p-1 transition-colors"
              title={showKey ? "Hide key" : "Show key"}>
              {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {editing && (
            <button type="button" className="btn-secondary shrink-0"
              onClick={() => { setEditing(false); setError(null); setShowKey(false); }}>
              Cancel
            </button>
          )}
          <button className="btn-primary shrink-0" disabled={pending || !key.trim()}>
            {pending ? "Checking…" : "Save"}
          </button>
        </form>
      )}
      {error && <p className="mt-2 text-caption text-destructive">{error}</p>}
    </div>
  );
}

/** Optional OpenRouter key: adds open models (Nemotron, Gemma, Qwen, DeepSeek, Kimi, GLM, Llama…) to every model picker. */
function OpenModelsKey() {
  const computer = useStore((s) => s.computer);
  const openCount = computer.models.filter((m) => m.startsWith("openrouter:")).length;
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const saved = computer.openRouter !== null;

  const handleStartEdit = async () => {
    setEditing(true);
    try {
      const existing = await getOpenRouterKey();
      if (existing) setKey(existing);
    } catch {}
  };

  useEffect(() => {
    if (editing && !key) {
      void getOpenRouterKey().then((existing) => {
        if (existing) setKey(existing);
      });
    }
  }, [editing]);

  const save = (value: string) =>
    start(async () => {
      const err = await setOpenRouterKey(value);
      setError(err);
      if (!err) {
        setKey("");
        setEditing(false);
        setShowKey(false);
      }
    });

  return (
    <div id="open-models" className="surface mb-3 scroll-mt-6 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex items-center gap-2 text-[14px]">
            OpenRouter <span className="rounded-xs bg-emerald-500/12 px-1.5 py-0.5 font-mono text-[11px] tracking-wider text-emerald-600 dark:text-emerald-400 uppercase">Open Models</span>
          </div>
          <div className="text-body-sm text-foreground/55">
            {computer.openRouter === "env"
              ? `Connected from OPENROUTER_API_KEY${openCount ? ` · ${openCount} open models in the model picker` : ""}.`
              : saved
                ? `Connected${openCount ? ` · ${openCount} open models in the model picker` : ""}. Stored encrypted on this computer.`
                : "Paste an OpenRouter key (from openrouter.ai) to run dots on open models like Nemotron, Gemma, Qwen, and DeepSeek."}
          </div>
        </div>
        {saved && !editing && (
          computer.openRouter === "env"
            ? <span className="rounded-md bg-foreground/[0.06] px-2.5 py-1 font-mono text-[11px] text-foreground/45 uppercase tracking-wider">Environment variable</span>
            : <div className="flex items-center gap-2">
                <button className="btn-quiet h-8 px-3 text-[13px]" disabled={pending} onClick={() => save("")}>Remove</button>
                <button className="btn-secondary h-8 px-3 text-[13px]" onClick={handleStartEdit}>Change</button>
              </div>
        )}
      </div>
      {(editing || !saved) && computer.openRouter !== "env" && (
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); save(key); }}>
          <div className="relative flex-1">
            <input
              className="field font-mono text-[13px] pr-9 w-full"
              type={showKey ? "text" : "password"}
              placeholder="sk-or-..."
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground/40 hover:text-foreground p-1 transition-colors"
              title={showKey ? "Hide key" : "Show key"}
            >
              {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {editing && (
            <button type="button" className="btn-secondary shrink-0"
              onClick={() => { setEditing(false); setError(null); setShowKey(false); }}>
              Cancel
            </button>
          )}
          <button className="btn-primary shrink-0" disabled={pending || !key.trim()}>
            {pending ? "Checking…" : "Save"}
          </button>
        </form>
      )}
      {error && <p className="mt-2 text-caption text-destructive">{error}</p>}
    </div>
  );
}

/** Optional Anthropic key: adds Claude Opus, Sonnet, and Haiku models to the model picker. */
function AnthropicKey() {
  const computer = useStore((s) => s.computer);
  const claudeCount = computer.models.filter((m) => m.startsWith("claude:")).length;
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const saved = computer.anthropic !== null && computer.anthropic !== undefined;

  const handleStartEdit = async () => {
    setEditing(true);
    try {
      const val = await getAnthropicKey();
      if (val) setKey(val);
    } catch {}
  };

  useEffect(() => {
    if (editing && !key) {
      void getAnthropicKey().then((val) => { if (val) setKey(val); });
    }
  }, [editing]);

  const save = (value: string) =>
    start(async () => {
      const err = await setAnthropicKey(value);
      setError(err);
      if (!err) { setKey(""); setEditing(false); setShowKey(false); }
    });

  return (
    <div id="anthropic-key" className="surface mb-3 scroll-mt-6 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex items-center gap-2 text-[14px]">
            Anthropic <span className="rounded-xs bg-violet-500/12 px-1.5 py-0.5 font-mono text-[11px] tracking-wider text-violet-600 dark:text-violet-400 uppercase">Claude Models</span>
          </div>
          <div className="text-body-sm text-foreground/55">
            {computer.anthropic === "env"
              ? `Connected from ANTHROPIC_API_KEY${claudeCount ? ` · ${claudeCount} Claude models in the model picker` : ""}.`
              : saved
                ? `Connected${claudeCount ? ` · ${claudeCount} Claude models in the model picker` : ""}. Stored encrypted.`
                : "Paste an Anthropic API key (from console.anthropic.com) to run dots on Claude Opus, Sonnet, and Haiku models."}
          </div>
        </div>
        {saved && !editing && (
          computer.anthropic === "env"
            ? <span className="rounded-md bg-foreground/[0.06] px-2.5 py-1 font-mono text-[11px] text-foreground/45 uppercase tracking-wider">Environment variable</span>
            : <div className="flex items-center gap-2">
                <button className="btn-quiet h-8 px-3 text-[13px]" disabled={pending} onClick={() => save("")}>Remove</button>
                <button className="btn-secondary h-8 px-3 text-[13px]" onClick={handleStartEdit}>Change</button>
              </div>
        )}
      </div>
      {(editing || !saved) && computer.anthropic !== "env" && (
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); save(key); }}>
          <div className="relative flex-1">
            <input
              className="field font-mono text-[13px] pr-9 w-full"
              type={showKey ? "text" : "password"}
              placeholder="sk-ant-..."
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
            />
            <button type="button" onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground/40 hover:text-foreground p-1 transition-colors"
              title={showKey ? "Hide key" : "Show key"}>
              {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {editing && (
            <button type="button" className="btn-secondary shrink-0"
              onClick={() => { setEditing(false); setError(null); setShowKey(false); }}>
              Cancel
            </button>
          )}
          <button className="btn-primary shrink-0" disabled={pending || !key.trim()}>
            {pending ? "Checking…" : "Save"}
          </button>
        </form>
      )}
      {error && <p className="mt-2 text-caption text-destructive">{error}</p>}
    </div>
  );
}

/** Optional Groq key: adds ultra-fast LPU inference models (Llama, Mixtral, Gemma) to the model picker. */
function GroqKey() {
  const computer = useStore((s) => s.computer);
  const groqCount = computer.models.filter((m) => m.startsWith("groq:")).length;
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const saved = computer.groq !== null && computer.groq !== undefined;

  const handleStartEdit = async () => {
    setEditing(true);
    try {
      const val = await getGroqKey();
      if (val) setKey(val);
    } catch {}
  };

  useEffect(() => {
    if (editing && !key) {
      void getGroqKey().then((val) => { if (val) setKey(val); });
    }
  }, [editing]);

  const save = (value: string) =>
    start(async () => {
      const err = await setGroqKey(value);
      setError(err);
      if (!err) { setKey(""); setEditing(false); setShowKey(false); }
    });

  return (
    <div id="groq-key" className="surface mb-3 scroll-mt-6 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex items-center gap-2 text-[14px]">
            Groq <span className="rounded-xs bg-orange-500/12 px-1.5 py-0.5 font-mono text-[11px] tracking-wider text-orange-600 dark:text-orange-400 uppercase">Ultra-Fast LPU</span>
          </div>
          <div className="text-body-sm text-foreground/55">
            {computer.groq === "env"
              ? `Connected from GROQ_API_KEY${groqCount ? ` · ${groqCount} Groq models in the model picker` : ""}.`
              : saved
                ? `Connected${groqCount ? ` · ${groqCount} Groq models in the model picker` : ""}. Stored encrypted.`
                : "Paste a Groq API key (from console.groq.com) to run dots on Llama, Mixtral, and Gemma at extremely fast speeds."}
          </div>
        </div>
        {saved && !editing && (
          computer.groq === "env"
            ? <span className="rounded-md bg-foreground/[0.06] px-2.5 py-1 font-mono text-[11px] text-foreground/45 uppercase tracking-wider">Environment variable</span>
            : <div className="flex items-center gap-2">
                <button className="btn-quiet h-8 px-3 text-[13px]" disabled={pending} onClick={() => save("")}>Remove</button>
                <button className="btn-secondary h-8 px-3 text-[13px]" onClick={handleStartEdit}>Change</button>
              </div>
        )}
      </div>
      {(editing || !saved) && computer.groq !== "env" && (
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); save(key); }}>
          <div className="relative flex-1">
            <input
              className="field font-mono text-[13px] pr-9 w-full"
              type={showKey ? "text" : "password"}
              placeholder="gsk_..."
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
            />
            <button type="button" onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground/40 hover:text-foreground p-1 transition-colors"
              title={showKey ? "Hide key" : "Show key"}>
              {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {editing && (
            <button type="button" className="btn-secondary shrink-0"
              onClick={() => { setEditing(false); setError(null); setShowKey(false); }}>
              Cancel
            </button>
          )}
          <button className="btn-primary shrink-0" disabled={pending || !key.trim()}>
            {pending ? "Checking…" : "Save"}
          </button>
        </form>
      )}
      {error && <p className="mt-2 text-caption text-destructive">{error}</p>}
    </div>
  );
}

/** Optional OpenAI key: adds GPT-4o, o1, o3-mini and other OpenAI models to the model picker. */
function OpenAIKey() {
  const computer = useStore((s) => s.computer);
  const oaiCount = computer.models.filter((m) => !m.includes(":")).length;
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const saved = computer.hasKey || computer.keySource !== null;

  const handleStartEdit = async () => {
    setEditing(true);
    try {
      const val = await getOpenAIKey();
      if (val) setKey(val);
    } catch {}
  };

  useEffect(() => {
    if (editing && !key) {
      void getOpenAIKey().then((val) => { if (val) setKey(val); });
    }
  }, [editing]);

  const save = (value: string) =>
    start(async () => {
      const err = await setOpenAIKey(value);
      setError(err);
      if (!err) { setKey(""); setEditing(false); setShowKey(false); }
    });

  return (
    <div id="openai-key" className="surface mb-3 scroll-mt-6 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex items-center gap-2 text-[14px]">
            OpenAI <span className="rounded-xs bg-green-500/12 px-1.5 py-0.5 font-mono text-[11px] tracking-wider text-green-600 dark:text-green-400 uppercase">GPT Models</span>
          </div>
          <div className="text-body-sm text-foreground/55">
            {computer.keySource === "env"
              ? `Connected from OPENAI_API_KEY${oaiCount ? ` · ${oaiCount} models in the model picker` : ""}.`
              : saved
                ? `Connected${oaiCount ? ` · ${oaiCount} models in the model picker` : ""}. Stored encrypted on this computer.`
                : "Paste an OpenAI API key (from platform.openai.com) to run dots on GPT-4o, o1, o3-mini and other OpenAI models."}
          </div>
        </div>
        {saved && !editing && (
          computer.keySource === "env"
            ? <span className="rounded-md bg-foreground/[0.06] px-2.5 py-1 font-mono text-[11px] text-foreground/45 uppercase tracking-wider">Environment variable</span>
            : <div className="flex items-center gap-2">
                <button className="btn-quiet h-8 px-3 text-[13px]" disabled={pending} onClick={() => save("")}>Remove</button>
                <button className="btn-secondary h-8 px-3 text-[13px]" onClick={handleStartEdit}>Change</button>
              </div>
        )}
      </div>
      {(editing || !saved) && computer.keySource !== "env" && (
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); save(key); }}>
          <div className="relative flex-1">
            <input
              className="field font-mono text-[13px] pr-9 w-full"
              type={showKey ? "text" : "password"}
              placeholder="sk-..."
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground/40 hover:text-foreground p-1 transition-colors"
              title={showKey ? "Hide key" : "Show key"}
            >
              {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {editing && (
            <button type="button" className="btn-secondary shrink-0"
              onClick={() => { setEditing(false); setError(null); setShowKey(false); }}>
              Cancel
            </button>
          )}
          <button className="btn-primary shrink-0" disabled={pending || !key.trim()}>
            {pending ? "Checking…" : "Save"}
          </button>
        </form>
      )}
      {error && <p className="mt-2 text-caption text-destructive">{error}</p>}
    </div>
  );
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <Section collapsible
      eyebrow="Appearance"
      title="Theme"
      description="Choose your preferred color theme or match your operating system settings."
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { id: "light", label: "Light", icon: Sun, desc: "Clean & bright" },
          { id: "dark", label: "Dark", icon: Moon, desc: "Sleek & deep" },
          { id: "system", label: "System", icon: Laptop, desc: "Sync with OS" },
        ].map((item) => {
          const Icon = item.icon;
          const active = mounted && theme === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTheme(item.id as "light" | "dark" | "system")}
              className={`surface flex flex-col items-start p-3.5 text-left transition-[border-color,box-shadow,background-color] ${
                active
                  ? "border-foreground bg-card ring-2 ring-foreground/20 shadow-elevated"
                  : "hover:border-black/20 hover:bg-popover dark:hover:border-white/20"
              }`}
            >
              <div className="flex w-full items-center justify-between">
                <div
                  className={`flex size-8 items-center justify-center rounded-lg border ${
                    active
                      ? "border-foreground bg-foreground text-card"
                      : "border-black/10 bg-popover text-foreground/70 dark:border-white/10"
                  }`}
                >
                  <Icon className="size-4" strokeWidth={1.75} />
                </div>
                {active && <span className="size-2 rounded-full bg-brand" />}
              </div>
              <div className="mt-3 text-[14px] font-medium">{item.label}</div>
              <div className="text-caption text-foreground/50">{item.desc}</div>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

function AccessSecuritySection() {
  const router = useRouter();
  const [auth, setAuth] = useState<{ enabled: boolean; authenticated: boolean } | null>(null);
  const [locking, startLock] = useTransition();

  useEffect(() => {
    checkAuthStatus().then(setAuth).catch(() => setAuth({ enabled: false, authenticated: true }));
  }, []);

  if (!auth) return (
    <Section collapsible eyebrow="Security" title="Master access" description="Protect your workspace and free AI quotas from unauthorized visitors with ACCESS_PASSWORD.">
      <div className="surface animate-pulse h-20 rounded-lg" />
    </Section>
  );

  return (
    <Section collapsible
      eyebrow="Security"
      title="Master access"
      description="Protect your workspace and free AI quotas from unauthorized visitors with ACCESS_PASSWORD."
    >
      <div className="surface flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div
          className={`flex size-9 shrink-0 items-center justify-center rounded-lg border ${
            auth.enabled
              ? "border-success/30 bg-success/10 text-success"
              : "border-black/10 bg-popover text-foreground/40 dark:border-white/10"
          }`}
        >
          {auth.enabled ? <ShieldCheck className="size-4.5" strokeWidth={2} /> : <Lock className="size-4.5" strokeWidth={1.75} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-medium">
              {auth.enabled ? "Password Protection Active" : "Password Protection Inactive"}
            </span>
            {auth.enabled && (
              <span className="rounded-xs bg-success/12 px-1.5 py-0.5 font-mono text-[11px] tracking-wider text-success uppercase">
                Secured
              </span>
            )}
          </div>
          <p className="mt-0.5 text-caption text-foreground/50">
            {auth.enabled
              ? "Configured via ACCESS_PASSWORD in Railway. Authenticated sessions last 30 days."
              : "Set ACCESS_PASSWORD in your Railway environment variables to lock this deployment behind a passcode."}
          </p>
        </div>
        {auth.enabled && (
          <button
            type="button"
            disabled={locking}
            onClick={() => {
              startLock(async () => {
                await lockApp();
                router.replace("/login");
                router.refresh();
              });
            }}
            className="btn-quiet flex shrink-0 items-center gap-1.5 border border-black/10 px-3 py-1.5 text-xs text-foreground/75 hover:border-black/25 hover:text-foreground dark:border-white/10 dark:hover:border-white/25"
          >
            <LogOut className="size-3.5" strokeWidth={1.75} />
            <span>Lock Workspace</span>
          </button>
        )}
      </div>
    </Section>
  );
}

function InstallAppSection() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    // Check if running as installed standalone app
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      Boolean((navigator as unknown as { standalone?: boolean }).standalone);
    setIsStandalone(standalone);

    // Detect iOS
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setIsIOS(ios);

    // Listen for install prompt on Android / Chrome / Edge
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    const handleAppInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setInstalled(true);
      setDeferredPrompt(null);
    }
  };

  return (
    <Section collapsible
      eyebrow="Mobile & Desktop App"
      title="Install QDot"
      description="Run QDot as a fast, full-screen standalone app on your phone, tablet, or desktop with no browser address bar."
    >
      <div className="surface p-4">
        {isStandalone || installed ? (
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-success/30 bg-success/10 text-success">
              <CheckCircle2 className="size-4.5" strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-medium">Installed & Running Standalone</span>
                <span className="rounded-xs bg-success/12 px-1.5 py-0.5 font-mono text-[11px] tracking-wider text-success uppercase">
                  Active
                </span>
              </div>
              <p className="mt-0.5 text-caption text-foreground/50">
                QDot is running in native app mode on this device. Updates will load automatically.
              </p>
            </div>
          </div>
        ) : deferredPrompt ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-brand/30 bg-brand/10 text-brand">
              <Download className="size-4.5" strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium">Ready to install</div>
              <p className="mt-0.5 text-caption text-foreground/50">
                Install QDot to your home screen or desktop with one click for a native-like experience.
              </p>
            </div>
            <button
              type="button"
              onClick={handleInstallClick}
              className="btn-primary flex shrink-0 items-center gap-2 h-9 px-4 text-[13px]"
            >
              <Download className="size-3.5" strokeWidth={2} />
              <span>Install App</span>
            </button>
          </div>
        ) : isIOS ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-black/10 bg-popover text-foreground/70 dark:border-white/10">
                <Smartphone className="size-4.5" strokeWidth={1.75} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium">Add to iPhone / iPad Home Screen</div>
                <p className="mt-0.5 text-caption text-foreground/50">
                  Safari lets you install QDot without downloading from the App Store.
                </p>
              </div>
            </div>
            <div className="rounded-md border border-black/[0.06] bg-popover/50 p-3.5 text-body-sm dark:border-white/[0.06]">
              <ol className="list-decimal space-y-1.5 pl-4 text-foreground/75 text-[13px]">
                <li>Tap the <strong className="text-foreground">Share</strong> icon in the Safari toolbar (at the bottom or top).</li>
                <li>Scroll down and tap <strong className="text-foreground">&quot;Add to Home Screen&quot;</strong>.</li>
                <li>Tap <strong className="text-foreground">Add</strong> in the top-right corner to launch QDot like any native app.</li>
              </ol>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-black/10 bg-popover text-foreground/70 dark:border-white/10">
              <Smartphone className="size-4.5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium">Install from Browser Menu</div>
              <p className="mt-0.5 text-caption text-foreground/50">
                In Chrome, Edge, or Android: open the browser menu (⋮) and tap <strong className="text-foreground">&quot;Install QDot&quot;</strong> or <strong className="text-foreground">&quot;Add to Home screen&quot;</strong>.
              </p>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}




