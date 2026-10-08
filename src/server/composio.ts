import "server-only";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError, type OAuthClientProvider, type OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import { emit } from "./bus";
import { getSetting, setSetting } from "./db";
import { seal, unseal } from "./vault";
import type { RuleDecision, ToolkitState } from "@/lib/types";

// Composio For You: Composio's consumer product. The user signs in with their own Composio account
// (OAuth, no developer key) and their dots get the user's apps through Composio's hosted MCP server.
// Every tool call still runs through our loop, so rules and approval cards apply.

export const MCP_URL = "https://connect.composio.dev/mcp";

export function getAppUrl(originOverride?: string): string {
  if (originOverride && !originOverride.includes("localhost:3100")) {
    return originOverride.replace(/\/+$/, "");
  }
  if (process.env.DOTS_PUBLIC_URL) {
    return process.env.DOTS_PUBLIC_URL.replace(/\/+$/, "");
  }
  if (process.env.APP_URL) {
    return process.env.APP_URL.replace(/\/+$/, "");
  }
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
  }
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`.replace(/\/+$/, "");
  }
  if (process.env.RAILWAY_STATIC_URL) {
    return `https://${process.env.RAILWAY_STATIC_URL}`.replace(/\/+$/, "");
  }
  return originOverride ? originOverride.replace(/\/+$/, "") : "http://localhost:3100";
}

export function getRedirectUrl(originOverride?: string): string {
  return `${getAppUrl(originOverride)}/api/composio/oauth`;
}

export const SUGGESTED = ["gmail", "googlecalendar", "slack", "notion", "github", "googledrive", "linear", "outlook"];
const HIDDEN_TOOLS = /REMOTE_BASH|REMOTE_WORKBENCH|SKILL|SUBMIT_FEEDBACK|WAIT_FOR_CONNECTIONS/;

// ---------- OAuth storage (sealed with the vault key) ----------

type Stored = { client?: OAuthClientInformationMixed; tokens?: OAuthTokens; verifier?: string; discovery?: OAuthDiscoveryState };
const load = (): Stored => {
  const raw = getSetting("composio_oauth");
  try {
    return raw ? (JSON.parse(unseal(raw)) as Stored) : {};
  } catch {
    return {};
  }
};
const save = (patch: Partial<Stored>) => setSetting("composio_oauth", seal(JSON.stringify({ ...load(), ...patch })));

class Provider implements OAuthClientProvider {
  pendingUrl: URL | null = null;
  originOverride?: string;

  constructor(originOverride?: string) {
    this.originOverride = originOverride;
  }

  get redirectUrl() {
    return getRedirectUrl(this.originOverride);
  }
  get clientMetadata(): OAuthClientMetadata {
    const rUrl = getRedirectUrl(this.originOverride);
    return {
      client_name: "QDot",
      redirect_uris: [rUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }
  clientInformation() {
    const current = load().client;
    const targetRedirect = getRedirectUrl(this.originOverride);
    if (current && "redirect_uris" in current && Array.isArray((current as any).redirect_uris)) {
      if (!(current as any).redirect_uris.includes(targetRedirect)) {
        return undefined;
      }
    }
    return current;
  }
  saveClientInformation(client: OAuthClientInformationMixed) {
    save({ client });
  }
  tokens() {
    return load().tokens;
  }
  saveTokens(tokens: OAuthTokens) {
    save({ tokens });
  }
  redirectToAuthorization(url: URL) {
    this.pendingUrl = url;
  }
  saveCodeVerifier(verifier: string) {
    save({ verifier });
  }
  codeVerifier() {
    const v = load().verifier;
    if (!v) throw new Error("Missing PKCE verifier; start sign-in again.");
    return v;
  }
  saveDiscoveryState(discovery: OAuthDiscoveryState) {
    save({ discovery });
  }
  discoveryState() {
    return load().discovery;
  }
  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope === "all") setSetting("composio_oauth", null);
    else save({ [scope === "client" ? "client" : scope]: undefined } as Partial<Stored>);
  }
}

// ---------- connection ----------

type State = {
  client: Client | null;
  pending: StreamableHTTPClientTransport | null; // transport waiting for the OAuth code
  tools: McpTool[];
  connected: string[]; // app slugs connected in the user's Composio account
  connecting: Promise<void> | null;
};
const g = globalThis as unknown as { __dotsComposio?: State };
const st = (g.__dotsComposio ??= { client: null, pending: null, tools: [], connected: [], connecting: null });

export const signedIn = () => Boolean(st.client) || Boolean(load().tokens);

/** Connect with saved tokens, or return the sign-in URL if the user needs to (re)authorize. */
async function connect(originOverride?: string): Promise<{ url: string } | null> {
  const provider = new Provider(originOverride);
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), { authProvider: provider });
  const client = new Client({ name: "dots", version: "1.0.0" });
  try {
    await client.connect(transport);
  } catch (err) {
    if (err instanceof UnauthorizedError && provider.pendingUrl) {
      st.pending = transport;
      return { url: provider.pendingUrl.toString() };
    }
    throw err;
  }
  st.client = client;
  st.pending = null;
  await refresh();
  return null;
}

async function ensureClient(originOverride?: string): Promise<Client> {
  if (st.client) return st.client;
  if (!load().tokens) throw new Error("Composio isn't connected. Sign in from Settings → Apps.");
  st.connecting ??= connect(originOverride)
    .then((r) => {
      if (r) throw new Error("Your Composio sign-in expired. Sign in again from Settings → Apps.");
    })
    .finally(() => (st.connecting = null));
  await st.connecting;
  return st.client!;
}

/** Start sign-in. Returns the Composio authorization URL, or null if already signed in. */
export async function signIn(originOverride?: string): Promise<string | null> {
  if (st.client) {
    await st.client.close().catch(() => {});
    st.client = null;
  }
  const r = await connect(originOverride);
  return r?.url ?? null;
}

/** OAuth redirect lands here with the code. */
export async function finishSignIn(code: string) {
  if (!st.pending) throw new Error("No sign-in in progress.");
  await st.pending.finishAuth(code);
  st.pending = null;
  const r = await connect();
  if (r) throw new Error("Composio sign-in didn't complete. Try again.");
}

export async function signOut() {
  await st.client?.close().catch(() => {});
  st.client = null;
  st.tools = [];
  st.connected = [];
  setSetting("composio_oauth", null);
  publish();
}

/** Re-list Composio's tools (their descriptions also carry which apps the user has connected). */
export async function refresh() {
  const client = st.client ?? (await ensureClient());
  const { tools } = await client.listTools();
  st.tools = tools.filter((t) => !HIDDEN_TOOLS.test(t.name));
  const search = tools.find((t) => t.name === "COMPOSIO_SEARCH_TOOLS")?.description ?? "";
  const listed = search.match(/connected the apps:\s*([^.\n]+)/i)?.[1];
  if (listed) st.connected = listed.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  publish();
}

export function apps(): ToolkitState[] {
  const slugs = [...st.connected, ...SUGGESTED.filter((s) => !st.connected.includes(s))];
  return slugs.map((slug) => ({ slug, name: prettyName(slug), logo: `https://logos.composio.dev/api/${slug}`, connected: st.connected.includes(slug) }));
}

function publish() {
  emit({ type: "composio", data: apps() });
}

const NAMES: Record<string, string> = {
  gmail: "Gmail", googlecalendar: "Google Calendar", googledrive: "Google Drive", googlesheets: "Google Sheets", googledocs: "Google Docs",
  github: "GitHub", linkedin: "LinkedIn", metaads: "Meta Ads", posthog: "PostHog", serpapi: "SerpApi", youtube: "YouTube",
  google_search_console: "Search Console", outlook: "Outlook", notion: "Notion", slack: "Slack", linear: "Linear", figma: "Figma", reddit: "Reddit", ahrefs: "Ahrefs",
};
const prettyName = (slug: string) => NAMES[slug] ?? slug.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// ---------- calling tools ----------

const clip = (s: string, n = 30_000) => (s.length > n ? `${s.slice(0, n)}…[truncated]` : s);

export async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  const normalizedArgs: Record<string, unknown> = { ...args };
  if (typeof normalizedArgs.tools === "string") {
    try {
      normalizedArgs.tools = JSON.parse(normalizedArgs.tools);
    } catch {
      try {
        normalizedArgs.tools = JSON.parse((normalizedArgs.tools as string).replace(/'/g, '"'));
      } catch {}
    }
  }
  if (Array.isArray(normalizedArgs.tools)) {
    normalizedArgs.tools = normalizedArgs.tools.map((t: any) => {
      if (!t || typeof t !== "object") return t;
      let toolArgs = t.arguments;
      if (typeof toolArgs === "string") {
        try {
          toolArgs = JSON.parse(toolArgs);
        } catch {
          try {
            toolArgs = JSON.parse((toolArgs as string).replace(/'/g, '"'));
          } catch {}
        }
      }
      return { ...t, arguments: toolArgs };
    });
  }
  if (typeof normalizedArgs.toolkits === "string") {
    try {
      normalizedArgs.toolkits = JSON.parse(normalizedArgs.toolkits);
    } catch {
      try {
        normalizedArgs.toolkits = JSON.parse((normalizedArgs.toolkits as string).replace(/'/g, '"'));
      } catch {}
    }
  }

  const run = async () => {
    const client = await ensureClient();
    const res = await client.callTool({ name, arguments: normalizedArgs }, undefined, { timeout: 5 * 60_000 });
    const content = (res.content ?? []) as { type: string; text?: string }[];
    const text = content.map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n");
    return (res.isError ? "Error: " : "") + clip(text || "(no output)");
  };
  try {
    return await run();
  } catch (err) {
    // Session dropped (e.g. server restarted it): reconnect once with the saved tokens.
    st.client = null;
    if (err instanceof Error && /expired|isn't connected/.test(err.message)) throw err;
    return run();
  }
}

let metaSession: string | null = null;

/** Run one Composio app tool (for example GOOGLEDRIVE_GET_ABOUT) through the meta tools this connection exposes. */
export async function executeTool(slug: string, args: Record<string, unknown>): Promise<string> {
  const run = async () => {
    if (!metaSession) {
      const found = await callTool("COMPOSIO_SEARCH_TOOLS", { queries: [{ use_case: `run ${slug}` }], session: { generate_id: true } });
      metaSession =
        found.match(/"[A-Za-z_]*session[A-Za-z_]*"\s*:\s*"([^"]{4,})"/i)?.[1] ??
        found.match(/"session"\s*:\s*\{[^{}]*?"id"\s*:\s*"([^"]+)"/i)?.[1] ??
        null;
      if (!metaSession) {
        const at = found.search(/session/i);
        throw new Error(`Composio did not return a session id. Around "session": ${at >= 0 ? found.slice(Math.max(0, at - 60), at + 260) : "(not mentioned) " + found.slice(0, 160)}`);
      }
    }
    return callTool("COMPOSIO_MULTI_EXECUTE_TOOL", {
      tools: [{ tool_slug: slug, arguments: args }],
      sync_response_to_workbench: false,
      thought: `QDot is running ${slug}`,
      session_id: metaSession,
    });
  };
  let out = await run();
  if (/session/i.test(out) && /error|invalid|expired/i.test(out.slice(0, 200))) {
    metaSession = null;
    out = await run();
  }
  return out;
}

// ---------- read vs write, for approvals ----------

const READ_VERB = /(?:^|_)(GET|LIST|SEARCH|FETCH|FIND|READ|RETRIEVE|QUERY|DESCRIBE|LOOKUP|VIEW|CHECK|COUNT|EXPORT|DOWNLOAD)(_|$)/i;
type ExecItem = { tool_slug?: string; arguments?: unknown };

export function executeItems(args: Record<string, unknown>): ExecItem[] {
  let tools = args.tools;
  if (typeof tools === "string") {
    try {
      tools = JSON.parse(tools);
    } catch {
      try {
        tools = JSON.parse((tools as string).replace(/'/g, '"'));
      } catch {}
    }
  }
  return Array.isArray(tools) ? (tools as ExecItem[]) : [];
}

/** Reads run automatically; anything else (send, post, create, update, delete…) asks first. */
export function executeDecision(args: Record<string, unknown>): RuleDecision {
  const items = executeItems(args);
  if (!items.length) return "allow";
  return items.every((i) => READ_VERB.test(String(i.tool_slug ?? "").toUpperCase())) ? "allow" : "ask";
}

export function describeExecute(args: Record<string, unknown>): string {
  const items = executeItems(args);
  const apps = [...new Set(items.map((i) => prettyName(String(i.tool_slug ?? "").split("_")[0].toLowerCase())))].filter(Boolean);
  const actions = items.map((i) => String(i.tool_slug ?? "").split("_").slice(1).join(" ").toLowerCase()).filter(Boolean);
  const thought = typeof args.thought === "string" && args.thought.trim() ? args.thought.trim().replace(/\.$/, "") : null;
  if (thought) return `${thought.replace(/^./, (c) => c.toLowerCase())}${apps.length ? ` (using ${apps.join(", ")})` : ""}`;
  if (apps.length && actions.length) return `use ${apps.join(", ")} to ${actions.join(", ")}`;
  if (apps.length) return `use ${apps.join(", ")}`;
  return "run app action";
}

export function executeDetail(args: Record<string, unknown>): string {
  return executeItems(args)
    .map((i) => `${i.tool_slug}\n${JSON.stringify(i.arguments ?? {}, null, 1).slice(0, 700)}`)
    .join("\n\n");
}

export function mcpTools(): McpTool[] {
  return st.tools;
}

// ---------- accounts of one app ----------

export type AppAccount = { id: string; alias: string | null; status: string; label: string | null };

const NAME_KEYS = ["user_name", "display_name", "account_name", "full_name", "name", "label", "username"];

/** The connected accounts of one app. Parsed leniently; `raw` is returned only when nothing could be read. */
export async function listAppAccounts(toolkit: string): Promise<{ accounts: AppAccount[]; raw: string }> {
  const raw = await listAccounts(toolkit);
  let data: unknown = null;
  try {
    data = JSON.parse(raw);
  } catch {
    const m = raw.match(/[\[{][\s\S]*[\]}]/);
    if (m) {
      try {
        data = JSON.parse(m[0]);
      } catch {
        // not JSON
      }
    }
  }
  const accounts: AppAccount[] = [];
  const seen = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : typeof o.account_id === "string" ? o.account_id : null;
    if (id && typeof o.status === "string") {
      if (seen.has(id)) return;
      seen.add(id);
      const email = JSON.stringify(o).match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? null;
      const name = NAME_KEYS.map((k) => o[k]).find((x): x is string => typeof x === "string" && x.toLowerCase() !== toolkit.toLowerCase());
      accounts.push({
        id,
        alias: typeof o.alias === "string" && o.alias.trim() ? o.alias : null,
        status: o.status,
        label: [name, email].filter(Boolean).join(" · ") || null,
      });
      return;
    }
    Object.values(o).forEach(walk);
  };
  walk(data);
  return { accounts, raw: accounts.length ? "" : raw.slice(0, 800) };
}

/** Rename or remove one account. Returns an error message, or null on success. */
export async function changeAppAccount(toolkit: string, action: "rename" | "remove", accountId: string, alias?: string): Promise<string | null> {
  const out = await callTool("COMPOSIO_MANAGE_CONNECTIONS", {
    toolkits: [{ name: toolkit, action, account_id: accountId, ...(action === "rename" ? { alias } : {}) }],
  });
  const failed = /"successful"\s*:\s*false/i.test(out) || /"error"\s*:\s*"[^"]+"/i.test(out);
  await refresh().catch(() => {});
  return failed ? out.slice(0, 300) : null;
}

// ---------- connecting an app ----------

export async function isConnected(toolkit: string): Promise<boolean> {
  if (st.connected.includes(toolkit)) return true;
  const out = await callTool("COMPOSIO_MANAGE_CONNECTIONS", { toolkits: [{ name: toolkit, action: "list" }] });
  const active = /"status"\s*:\s*"ACTIVE"/i.test(out);
  if (active && !st.connected.includes(toolkit)) {
    st.connected.push(toolkit);
    publish();
  }
  return active;
}

/** Create a Composio auth link for an app. `wait()` resolves once the connection is active. */
const activeCount = (out: string) => (out.match(/"status"\s*:\s*"ACTIVE"/gi) ?? []).length;
const listAccounts = (toolkit: string) => callTool("COMPOSIO_MANAGE_CONNECTIONS", { toolkits: [{ name: toolkit, action: "list" }] }).catch(() => "");

/** With an alias, adds another account of an app that is already connected (e.g. a second LinkedIn login). */
export async function startConnect(toolkit: string, originOverride?: string, alias?: string | null) {
  const label = alias?.trim() || null;
  if (!label && (await isConnected(toolkit))) return { already: true as const };
  const baseline = label ? activeCount(await listAccounts(toolkit)) : 0;
  const redirectUrl = getRedirectUrl(originOverride);
  const out = await callTool("COMPOSIO_MANAGE_CONNECTIONS", {
    toolkits: [{ name: toolkit, action: "add", ...(label ? { alias: label } : {}), redirect_url: redirectUrl, callback_url: redirectUrl }],
  });
  const url = out.match(/"redirect_url"\s*:\s*"([^"]+)"/)?.[1] ?? out.match(/https:\/\/[^\s"')\]]+/)?.[0];
  if (!url) throw new Error(`Composio didn't return a sign-in link for ${toolkit}: ${out.slice(0, 300)}`);
  return {
    already: false as const,
    name: label ? `${prettyName(toolkit)} (${label})` : prettyName(toolkit),
    url,
    wait: async () => {
      const deadline = Date.now() + 10 * 60_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 5000));
        if (label ? activeCount(await listAccounts(toolkit)) > baseline : await isConnected(toolkit).catch(() => false)) return;
      }
      throw new Error("Timed out waiting for the connection.");
    },
  };
}
