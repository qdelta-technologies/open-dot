import "server-only";
import * as repo from "../repo";
import * as computer from "../computer";
import { RISKY_CLICK } from "../computer/dom-actions";
import { runOnUserComputer } from "../computer/shell";
import { credentialFor } from "../vault";
import { emit } from "../bus";
import * as composio from "../composio";
import * as files from "../files";
import * as leads from "../leads";
import { recordAutomation } from "../automationLog";
import { localTimeToMs, userTimeZone } from "../timezone";
import { postVideo as postLinkedInVideo } from "../linkedinVideo";
import { postInstagram } from "../instagramPost";
import { collectInstagramLeads } from "../instagramLeads";
import { createFileToken, createStoredFileToken, isSafeWorkspacePath } from "../links";
import type { Dot, RuleDecision } from "@/lib/types";

export type ToolCtx = { dot: Dot; signal: AbortSignal; depth: number };

type Schema = { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: false };

export type ToolDef = {
  name: string;
  description: string;
  parameters: Schema | Record<string, unknown>;
  /** Strict JSON-schema mode (our own tools). Composio's MCP tools have open-ended args, so they run non-strict. */
  strict?: boolean;
  /** Short present-tense label shown while running, e.g. "Running commands". */
  label: string;
  /** Natural-language description of the action, matched against the user's rules. Omit for always-safe tools. */
  describe?: (args: Record<string, unknown>, ctx: ToolCtx) => string;
  /** What happens when no user rule matches. */
  defaultDecision?: (ctx: ToolCtx, args: Record<string, unknown>) => RuleDecision | Promise<RuleDecision>;
  /** Runs before rules/approval; a returned string short-circuits as the tool's output (e.g. "app not connected"). */
  precheck?: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<string | null>;
  /** How long the tool may run before the dot is told it timed out (default 35s). Posting tools wait on other services and need longer. */
  timeoutMs?: number;
  /** Extra detail for the approval card (e.g. the exact tool and arguments). */
  detail?: (args: Record<string, unknown>) => string;
  /** "pause" tools stop the run and wait for the user (question / approval / connect-an-app card). */
  pause?: "question" | "approval" | "connect";
  execute?: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<string>;
};

const obj = (properties: Record<string, unknown>, required = Object.keys(properties)): Schema => ({
  type: "object", properties, required, additionalProperties: false,
});
const str = (description: string) => ({ type: "string", description });
const nullableStr = (description: string) => ({ type: ["string", "null"], description });
const s = (v: unknown) => String(v ?? "");

// Delegation is injected by the runtime to avoid a circular import.
let consultImpl: ((target: Dot, message: string, from: Dot, depth: number, signal: AbortSignal) => Promise<string>) | null = null;
export function setConsult(fn: typeof consultImpl) {
  consultImpl = fn;
}

/** Built-in web search: fast, free, and works with all model providers (Cloudflare, Groq, OpenRouter, etc.). */
async function searchWeb(query: string): Promise<string> {
  const q = query.trim();
  if (!q) return "No query provided.";

  // 0. Tavily, then Serper (Google results), when keys are configured (fresher than DuckDuckGo).
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (tavilyKey) {
    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${tavilyKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, max_results: 6, include_answer: true, topic: "general" }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        const parts: string[] = [];
        if (data.answer) parts.push(`**Answer**: ${data.answer}`);
        (data.results ?? []).forEach((r: any, i: number) =>
          parts.push(`${i + 1}. **${r.title}**
   ${String(r.content ?? "").slice(0, 400)}
   Source: ${r.url}`),
        );
        if (parts.length) return parts.join("\n\n");
      }
    } catch (err) {
      console.warn("[web_search] Tavily failed, falling back:", err);
    }
  }

  const serperKey = process.env.SERPER_API_KEY;
  if (serperKey) {
    try {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q, num: 8 }),
        signal: AbortSignal.timeout(12_000),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        const parts: string[] = [];
        const box = data.answerBox;
        if (box) parts.push(`**Answer**: ${box.answer || box.snippet || box.title || ""}${box.link ? `\nSource: ${box.link}` : ""}`);
        const items: any[] = [...(data.topStories ?? []).slice(0, 3), ...(data.organic ?? [])].slice(0, 8);
        items.forEach((r, i) => parts.push(`${i + 1}. **${r.title}**
   ${r.snippet ?? r.source ?? ""}${r.date ? ` (${r.date})` : ""}
   Source: ${r.link}`));
        if (parts.length) return parts.join("\n\n");
      }
    } catch (err) {
      console.warn("[web_search] Serper failed, falling back:", err);
    }
  }
  // 1. DuckDuckGo HTML Search
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(12_000),
    });

    if (res.ok) {
      const html = await res.text();
      const decodeHtml = (str: string) =>
        str
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&#x27;/g, "'")
          .replace(/<[^>]+>/g, "")
          .trim();

      const cleanUrl = (raw: string) => {
        if (!raw) return "";
        if (raw.includes("uddg=")) {
          try {
            return decodeURIComponent(raw.split("uddg=")[1].split("&")[0]);
          } catch {
            return raw;
          }
        }
        return raw;
      };

      const blocks = html.split("result__body").slice(1);
      const results: { title: string; snippet: string; url: string }[] = [];

      for (const b of blocks.slice(0, 6)) {
        const titleMatch = b.match(/class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        const snippetMatch = b.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i);

        if (titleMatch) {
          const url = cleanUrl(titleMatch[1]);
          const title = decodeHtml(titleMatch[2]);
          const snippet = snippetMatch ? decodeHtml(snippetMatch[1]) : "";
          if (title) results.push({ title, snippet, url });
        }
      }

      if (results.length > 0) {
        return results
          .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.snippet}\n   Source: ${r.url}`)
          .join("\n\n");
      }
    }
  } catch (err) {
    console.warn("[web_search] DuckDuckGo search failed, trying fallback:", err);
  }

  // 2. Fallback: DuckDuckGo Instant Answer API
  try {
    const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      const data = (await res.json()) as any;
      const parts: string[] = [];
      if (data.AbstractText) parts.push(`**${data.Heading || "Summary"}**: ${data.AbstractText}\nSource: ${data.AbstractURL || ""}`);
      if (Array.isArray(data.RelatedTopics)) {
        for (const t of data.RelatedTopics.slice(0, 4)) {
          if (t.Text) parts.push(`- ${t.Text} (${t.FirstURL || ""})`);
        }
      }
      if (parts.length > 0) return parts.join("\n\n");
    }
  } catch (err) {
    console.warn("[web_search] Instant Answer fallback failed:", err);
  }

  return `No search results found for "${q}". Try a different or simpler search query.`;
}

export const TOOLS: ToolDef[] = [
  {
    name: "web_search",
    label: "Searching the web",
    description: "Search the web for real-time news, current events, live facts, documentation, or online information. Returns titles, snippets, and source URLs.",
    parameters: obj({ query: str("The search query") }),
    describe: (a) => `search the web for "${s(a.query)}"`,
    defaultDecision: () => "allow",
    execute: (a) => searchWeb(s(a.query)),
  },
  {
    name: "run_command",
    label: "Running commands",
    description: "Run a bash command on your own computer (Linux; the working directory is your persistent workspace). Use it for scripts, data work, downloads, installing packages, etc.",
    parameters: obj({ command: str("The bash command to run") }),
    describe: (a) => `run \`${s(a.command)}\` on its own computer`,
    // Isolated computers (cloud/docker) run freely; the sandbox-folder fallback lives on the user's Mac, so ask.
    defaultDecision: (ctx) => (computer.modeFor(ctx.dot.id) === "local" ? "ask" : "allow"),
    execute: (a, ctx) => computer.runCommand(ctx.dot.id, s(a.command), ctx.signal),
  },
  {
    name: "read_file",
    label: "Reading a file",
    description: "Read a text file or PDF document from your workspace.",
    parameters: obj({ path: str("Path relative to your workspace") }),
    execute: async (a, ctx) => {
      const filePath = s(a.path);
      const lower = filePath.toLowerCase();
      if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".gif") || lower.endsWith(".webp") || lower.endsWith(".zip") || lower.endsWith(".tar") || lower.endsWith(".gz") || lower.endsWith(".exe") || lower.endsWith(".bin")) {
        return `[Binary file (${filePath}): read_file only supports text files and PDFs (e.g. .pdf, .txt, .md, .csv, .json, .js, .ts, .py, .html, .log).]`;
      }
      const buf = await computer.readFile(ctx.dot.id, filePath).catch(() => null);
      if (!buf) return `No such file: ${filePath}`;
      if (lower.endsWith(".pdf")) {
        try {
          const { extractText } = await import("unpdf");
          const res = await extractText(new Uint8Array(buf), { mergePages: true });
          const text = typeof res?.text === "string" ? res.text.trim() : "";
          if (!text) return `[PDF file (${filePath}) contains no extractable text (it may be a scanned image).]`;
          return text.length > 12_000 ? text.slice(0, 12_000) + `\n\n...[truncated: showing first 12,000 characters of ${text.length}]` : text;
        } catch (err) {
          return `Failed to extract text from PDF ${filePath}: ${err}`;
        }
      }
      const text = buf.toString("utf8");
      return text.length > 12_000 ? text.slice(0, 12_000) + `\n\n...[truncated: showing first 12,000 characters of ${text.length}]` : text;
    },
  },
  {
    name: "write_file",
    label: "Writing a file",
    description: "Create or overwrite a text file in your workspace (reports, notes, code). Use share_file to hand a finished file to the user.",
    parameters: obj({ path: str("Path relative to your workspace"), content: str("Full file contents") }),
    execute: async (a, ctx) => `Wrote ${s(a.content).length} chars to ${await computer.writeFile(ctx.dot.id, s(a.path), s(a.content))}`,
  },
  {
    name: "share_file",
    label: "Sharing a file",
    description:
      "Send a file from your computer to the user in chat (reports, spreadsheets, images, exports, code). They get a notification and can preview or download it. Write the file first, then share it.",
    parameters: obj({ path: str("Path of the file in your workspace"), note: str("A short message to go with it") }),
    execute: async (a, ctx) => {
      const att = await files.shareFromComputer(ctx.dot.id, s(a.path));
      const text = s(a.note) || `Here's ${att.name}.`;
      repo.addMessage({ dotId: ctx.dot.id, role: "dot", text, attachments: [att] });
      emit({ type: "notify", dotId: ctx.dot.id, title: `${ctx.dot.name} sent ${att.name}`, body: text.slice(0, 160) });
      return `Shared ${att.name} (${att.size} bytes) with the user. Don't repeat its contents unless asked.`;
    },
  },
  {
    name: "public_file_link",
    label: "Creating a temporary link",
    description:
      "Make a private web link (valid for 10 minutes, covers only that one file) for a file in your workspace, so another service can fetch it, for example to put an attached photo or video into Google Drive, or to give Instagram a public address for media. Attached files are in your workspace at uploads/<filename>. Create the link right before you use it.",
    parameters: obj({ path: str("Path of the file in your workspace, for example uploads/photo.jpg") }),
    describe: (a) => `create a temporary web link for "${s(a.path)}"`,
    defaultDecision: () => "allow",
    execute: async (a, ctx) => {
      const p = s(a.path).trim().replace(/^\.\//, "");
      if (!isSafeWorkspacePath(p)) return "That path is not allowed. Use a path inside your workspace, such as uploads/photo.jpg.";
      const data = await computer.readFile(ctx.dot.id, p).catch(() => null);
      if (!data) return `I couldn't find "${p}" in your workspace. Check the name with ls uploads.`;
      const { token, expiresAt } = createFileToken(ctx.dot.id, p);
      const url = `${composio.getAppUrl()}/api/public-files/${token}`;
      const mins = Math.round((expiresAt - Date.now()) / 60_000);
      return `Link for ${p} (${data.length} bytes), valid for about ${mins} minutes: ${url}`;
    },
  },
  {
    name: "app_file_key",
    label: "Preparing a file for an app",
    timeoutMs: 2 * 60_000,
    description:
      "Get the file key that an app tool needs in its file or image field (named s3key), for a file in your workspace. Use it before posting a photo or video with LinkedIn and similar tools: then pass {name, mimetype, s3key} in the tool's images or file field. Attached files are in your workspace at uploads/<filename>.",
    parameters: obj({ path: str("Path of the file in your workspace, for example uploads/photo.jpg") }),
    describe: (a) => `prepare "${s(a.path)}" for an app`,
    defaultDecision: () => "allow",
    execute: async (a, ctx) => {
      const link = await fileLink(ctx.dot.id, s(a.path));
      if ("error" in link) return link.error;
      const { url, name } = link;
      try {
        const out = await composio.uploadFileForTools(url, name);
        if (!out.s3key) return `The upload ran but I could not read a file key from it. Raw result: ${out.raw}`;
        return `File key for ${name}: use {"name": "${name}", "mimetype": "${files.guessMime(name)}", "s3key": "${out.s3key}"} in the tool's images/file field.`;
      } catch (err) {
        return `Could not prepare the file: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    name: "linkedin_post_video",
    label: "Posting a video to LinkedIn",
    timeoutMs: 4 * 60_000,
    description:
      "Publish a LinkedIn post with an attached video. LinkedIn's normal post tool cannot take video, so use this one. Give the video's path (uploads/<name>) and the exact post text the user wants. The user must approve it first.",
    parameters: obj({ path: str("Path of the video in your workspace, for example uploads/clip.mp4"), text: str("The exact post text, word for word as the user gave it") }),
    describe: (a) => `post the video "${s(a.path)}" to LinkedIn`,
    detail: (a) => `Post text: ${s(a.text)}
Media: video ${s(a.path)}
Account: your connected LinkedIn account`,
    defaultDecision: () => "ask",
    execute: async (a, ctx) => {
      const link = await fileLink(ctx.dot.id, s(a.path));
      if ("error" in link) return link.error;
      const text = s(a.text).trim();
      if (!text) return "No post text was given. Ask the user for the exact wording.";
      return runOnce(`linkedin-video|${link.name}|${text}`, async () => {
        try {
          const r = await postLinkedInVideo(link.url, text, "", link.size);
          if (r.ok) return r.link ? `Published on LinkedIn. Link: ${r.link}. Tell the user in one plain sentence.` : `${r.log} Reply in two plain sentences, with no JSON or code.`;
          return `The video was NOT posted. Tell the user in plain words, with no JSON or code: ${r.log}`;
        } catch (err) {
          return `The video was NOT posted: ${err instanceof Error ? err.message : String(err)}`;
        }
      });
    },
  },
  {
    name: "open_url",
    label: "Browsing the web",
    description: "Open a URL in your browser (you'll see it via the computer tool / read_page). Your browser keeps its logins.",
    parameters: obj({ url: str("URL to open") }),
    describe: (a) => `open ${s(a.url)} in its browser`,
    defaultDecision: () => "allow",
    execute: async (a, ctx) => {
      const url = s(a.url);
      const onLinkedIn = leads.isLinkedIn(url);
      if (onLinkedIn) {
        const stop = await leads.linkedInGate(ctx.dot.id);
        if (stop) return stop;
      }
      const out = await computer.openUrl(ctx.dot.id, url);
      if (onLinkedIn && leads.looksLikeLinkedInCheck(`${url} ${out}`)) {
        leads.pauseLinkedIn(`a check or login wall appeared at ${url.slice(0, 120)}`);
        return `${out}\n\nSTOP: LinkedIn is showing a check, login wall or warning. Do NOT try to solve it, retry, or go around it. Tell the user plainly what you see and wait for them.`;
      }
      return out;
    },
  },
  {
    name: "instagram_post",
    label: "Posting to Instagram",
    timeoutMs: 6 * 60_000,
    description:
      "Publish a photo or a Reel (video) to the user's connected Instagram account. Give the file's path (uploads/<name>), the exact caption the user wants, and kind: photo or reel. Needs an Instagram Business or Creator account. The user must approve it first.",
    parameters: obj({
      path: str("Path of the photo or video in your workspace, for example uploads/photo.jpg"),
      caption: str("The exact caption, word for word as the user gave it"),
      kind: str("photo or reel"),
    }),
    describe: (a) => `post "${s(a.path)}" to Instagram`,
    detail: (a) => `Caption: ${s(a.caption)}\nMedia: ${s(a.kind) || "photo"} ${s(a.path)}\nAccount: your connected Instagram account`,
    defaultDecision: () => "ask",
    execute: async (a, ctx) => {
      const link = await fileLink(ctx.dot.id, s(a.path), 30);
      if ("error" in link) return link.error;
      const kind = /reel|video/i.test(s(a.kind)) || /^video\//i.test(link.mime) ? "reel" : "photo";
      return runOnce(`instagram|${link.name}|${s(a.caption).trim()}`, async () => {
        try {
          const r = await postInstagram(link.url, s(a.caption).trim(), kind, link.mime, link.size);
          return r.ok ? `${r.message} Tell the user in one plain sentence.` : `NOT posted. Tell the user in plain words, with no JSON or code: ${r.message}`;
        } catch (err) {
          return `NOT posted: ${err instanceof Error ? err.message : String(err)}`;
        }
      });
    },
  },
  {
    name: "save_lead",
    label: "Saving a lead",
    description:
      "Save one lead you found by reading a real page. Required: name, the full profile link, and evidence: the exact text you read on the page (headline, role, company). Never fill any field from memory or guess; leave unknown fields empty. Duplicates are skipped.",
    parameters: obj({
      name: str("Full name as shown on the page"),
      headline: nullableStr("Headline or role as shown"),
      company: nullableStr("Company as shown"),
      location: nullableStr("Location as shown"),
      profile_url: str("Full link of the profile page you read"),
      source_url: nullableStr("The search or list page where you found them"),
      evidence: str("The exact text you read on the page for this person"),
      notes: nullableStr("Why they fit, in a short line"),
    }),
    describe: (a) => `save the lead ${s(a.name)}`,
    defaultDecision: () => "allow",
    execute: async (a, ctx) => {
      const r = leads.addLead(ctx.dot.id, {
        name: s(a.name), headline: s(a.headline), company: s(a.company), location: s(a.location),
        profileUrl: s(a.profile_url), sourceUrl: s(a.source_url), evidence: s(a.evidence), notes: s(a.notes),
      });
      if (!r.ok) return `Not saved: ${r.reason}`;
      return r.duplicate ? `${r.lead.name} was already saved.` : `Saved ${r.lead.name}. ${leads.countLeads()} lead(s) in total.`;
    },
  },
  {
    name: "instagram_collect_leads",
    label: "Collecting Instagram leads",
    timeoutMs: 4 * 60_000,
    description:
      "Save people who already reached out on the user's connected Instagram account as leads: those who commented on the account's recent posts, and optionally those who sent a direct message. Each lead keeps the exact comment or message as evidence. It cannot search for strangers.",
    parameters: obj({
      posts: { type: "integer", description: "How many of the most recent posts to read comments from (1 to 10)" },
      include_dms: { type: "boolean", description: "Also save people who sent a direct message" },
    }),
    describe: () => "collect leads from Instagram comments and messages",
    defaultDecision: () => "allow",
    execute: async (a, ctx) => {
      try {
        const r = await collectInstagramLeads(ctx.dot.id, { posts: Math.min(Math.max(Number(a.posts) || 5, 1), 10), dms: a.include_dms === true });
        const names = r.saved.slice(0, 15).join(", ");
        return [
          `Saved ${r.saved.length} new lead(s)${names ? `: ${names}` : ""}.`,
          r.duplicates ? `${r.duplicates} were already saved.` : "",
          r.notes.join(" "),
          "Tell the user in plain words; they can see the leads in Settings, Saved leads.",
        ]
          .filter(Boolean)
          .join(" ");
      } catch (err) {
        return `Could not collect Instagram leads: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    name: "list_leads",
    label: "Checking saved leads",
    description: "List the leads saved so far (newest first), so you do not repeat work.",
    parameters: obj({}),
    defaultDecision: () => "allow",
    execute: async () => {
      const all = leads.listLeads(40);
      return all.length ? all.map((l) => `${l.name} | ${l.headline} | ${l.company} | ${l.profileUrl}`).join("\n") : "No leads saved yet.";
    },
  },
  {
    name: "linkedin_resume",
    label: "Resuming LinkedIn",
    description: "Only after the user has told you they dealt with LinkedIn's check or warning themselves: allow LinkedIn browsing again.",
    parameters: obj({}),
    describe: () => "resume LinkedIn browsing",
    defaultDecision: () => "ask",
    execute: async () => {
      leads.resumeLinkedIn();
      return "LinkedIn browsing is allowed again. Go slowly.";
    },
  },
  {
    name: "read_page",
    label: "Reading the web",
    description: "Get the visible text of the page currently open in your browser.",
    parameters: obj({}),
    execute: (_a, ctx) => computer.readPage(ctx.dot.id),
  },
  {
    name: "click",
    label: "Using its computer",
    description:
      "Click something on the page open in your browser by its visible text (a button, link, tab, option, checkbox or label), e.g. \"Continue\" or \"Row F seat 12\". Read the page first so you use the exact text.",
    parameters: obj({ text: str("The visible text of what to click") }),
    describe: (a) => `click "${s(a.text)}" in its browser`,
    defaultDecision: (_c, a) => (RISKY_CLICK.test(s(a.text)) ? "ask" : "allow"),
    execute: (a, ctx) => computer.clickText(ctx.dot.id, s(a.text)),
  },
  {
    name: "type_text",
    label: "Using its computer",
    description: "Type into a field on the page open in your browser, found by its label, placeholder or name. Set submit to press Enter afterwards. Never use it for passwords (use sign_in).",
    parameters: obj({ field: str("Label, placeholder or name of the field"), text: str("What to type"), submit: { type: "boolean", description: "Press Enter after typing" } }, ["field", "text", "submit"]),
    describe: (a) => `type "${s(a.text).slice(0, 60)}" into "${s(a.field)}" in its browser`,
    defaultDecision: () => "allow",
    execute: (a, ctx) => computer.typeText(ctx.dot.id, s(a.field), s(a.text), Boolean(a.submit)),
  },
  {
    name: "sign_in",
    label: "Signing in",
    description:
      "Fill the login form on the current browser page using the user's saved password for a site. You never see the password. Open the site's sign-in page first, then submit the form yourself afterwards.",
    parameters: obj({ site: str("Site/domain of the login, e.g. github.com") }),
    describe: (a) => `sign in to ${s(a.site)} with the user's saved password`,
    defaultDecision: () => "ask",
    execute: async (a, ctx) => {
      const cred = credentialFor(s(a.site));
      if (!cred) return `No saved password for ${s(a.site)}. Ask the user to add one under Passwords (never ask them to paste it in chat), or to take over your computer and log in themselves.`;
      return computer.fillLogin(ctx.dot.id, cred.username, cred.password);
    },
  },
  {
    name: "run_on_my_computer",
    label: "On your computer",
    description: "Run a bash command on the USER's own computer (their Mac). Only use when the task truly needs their machine; prefer your own computer.",
    parameters: obj({ command: str("The bash command to run on the user's computer") }),
    describe: (a) => `run \`${s(a.command)}\` on the user's personal computer`,
    defaultDecision: () => "ask",
    execute: async (a, ctx) => {
      if (!repo.getDot(ctx.dot.id)?.localAccess)
        return "You no longer have access to the user's computer. They can allow access again from this dot's settings on that computer.";
      return runOnUserComputer(s(a.command), ctx.signal);
    },
  },
  {
    name: "remember",
    label: "Remembering",
    description: "Save a durable fact or preference about the user or their work to your memory, so you know it in future conversations.",
    parameters: obj({ fact: str("The fact, written as a short standalone sentence") }),
    execute: async (a, ctx) => (repo.addMemory(ctx.dot.id, s(a.fact)), "Saved to memory."),
  },
  {
    name: "forget",
    label: "Updating memory",
    description: "Delete a memory that is wrong or outdated.",
    parameters: obj({ memory_id: str("The id shown in your memory list") }),
    execute: async (a) => (repo.deleteMemory(s(a.memory_id)), "Forgotten."),
  },
  {
    name: "save_skill",
    label: "Learning a skill",
    description: "Save a reusable skill: step-by-step markdown instructions for a task you'll repeat. Updates the skill if the name exists.",
    parameters: obj({ name: str("Short skill name"), description: str("One line: when to use it"), instructions: str("Markdown instructions") }),
    execute: async (a, ctx) => (repo.upsertSkill(ctx.dot.id, s(a.name), s(a.description), s(a.instructions)), `Skill "${s(a.name)}" saved.`),
  },
  {
    name: "use_skill",
    label: "Using a skill",
    description: "Load the full instructions of one of your saved skills.",
    parameters: obj({ name: str("Skill name") }),
    execute: async (a, ctx) => {
      const skill = repo.listSkills(ctx.dot.id).find((k) => k.name.toLowerCase() === s(a.name).toLowerCase());
      return skill ? skill.body : `No skill named "${s(a.name)}".`;
    },
  },
  {
    name: "create_routine",
    label: "Setting up a routine",
    description:
      "Create an automation: either a recurring task on a schedule (a cron expression), or a ONE-TIME task (run_once_at) that runs once and then deletes itself. Results reach the user via send_update.",
    parameters: obj({
      name: str("Short name"),
      instruction: str("What to do each time, written as a full instruction to yourself"),
      schedule: nullableStr("For a recurring routine: 5-field cron expression in the user's local timezone, e.g. '0 8 * * 1-5' for weekdays at 8am. Null for a one-time routine."),
      run_once_at: nullableStr("For a one-time routine: the user's local date and time like 2026-10-10T09:00. Null for a recurring routine."),
    }),
    describe: (a) => (s(a.run_once_at) ? `set up a one-time routine "${s(a.name)}" (${s(a.run_once_at)})` : `set up a recurring routine "${s(a.name)}" (${s(a.schedule)})`),
    defaultDecision: () => "allow",
    execute: async (a, ctx) => {
      const tz = userTimeZone();
      const onceText = s(a.run_once_at).trim();
      const once = onceText && onceText !== "null" && onceText !== "undefined";
      let r;
      if (once) {
        const at = localTimeToMs(onceText, tz);
        if (at === null) return `I could not read the time "${onceText}". Use a local date and time like 2026-10-10T09:00.`;
        if (at < Date.now() + 20_000) return "That time has already passed. Pick a time in the future (at least a minute from now).";
        r = repo.addRoutine({ dotId: ctx.dot.id, name: s(a.name), instruction: s(a.instruction), schedule: "once", timezone: tz, runAt: at });
      } else {
        if (!repo.validSchedule(s(a.schedule))) return `Invalid cron expression: ${s(a.schedule)}`;
        r = repo.addRoutine({ dotId: ctx.dot.id, name: s(a.name), instruction: s(a.instruction), schedule: s(a.schedule), timezone: tz });
      }
      recordAutomation({
        kind: "created", routineId: r.id, routineName: r.name, dotId: ctx.dot.id, dotName: ctx.dot.name, status: "created",
        summary: once ? `One-time routine created, to run once at ${onceText} (${tz}) and then delete itself.` : `Recurring routine created: ${s(a.schedule)} (${tz}).`,
        detail: `Instruction: ${s(a.instruction)}`,
      });
      const next = r.nextRunAt ? new Date(r.nextRunAt).toLocaleString("en-GB", { timeZone: tz, dateStyle: "full", timeStyle: "short" }) : "unknown";
      return `Routine created (id ${r.id}). ${once ? "It runs ONCE, then deletes itself." : "It repeats."} Next run: ${next} (${tz}). Tell the user this in plain words.`;
    },
  },
  {
    name: "update_routine",
    label: "Updating routine",
    description: "Update an existing routine or automation when the user asks for changes (e.g. change time/schedule, modify instructions, or change name).",
    parameters: obj(
      {
        routine: str("The routine id (e.g. rtn_...) or routine name to update"),
        name: nullableStr("New name, or leave null to keep unchanged"),
        instruction: nullableStr("New instruction, or leave null to keep unchanged"),
        schedule: nullableStr("New 5-field cron schedule, or leave null to keep unchanged"),
      },
      ["routine"]
    ),
    describe: (a) => `update routine "${s(a.routine)}"`,
    defaultDecision: () => "allow",
    execute: async (a, ctx) => {
      const target = repo.findRoutine(ctx.dot.id, s(a.routine));
      if (!target) return `Routine "${s(a.routine)}" not found. Existing routines: ${repo.listRoutines(ctx.dot.id).map((r) => `${r.name} (${r.id})`).join(", ") || "none"}`;
      const patch: { name?: string; instruction?: string; schedule?: string } = {};
      if (a.name && s(a.name) !== "null" && s(a.name) !== "undefined") patch.name = s(a.name);
      if (a.instruction && s(a.instruction) !== "null" && s(a.instruction) !== "undefined") patch.instruction = s(a.instruction);
      if (a.schedule && s(a.schedule) !== "null" && s(a.schedule) !== "undefined") {
        if (!repo.validSchedule(s(a.schedule))) return `Invalid cron expression: ${s(a.schedule)}`;
        patch.schedule = s(a.schedule);
      }
      const updated = repo.updateRoutine(target.id, patch);
      return `Routine "${updated?.name ?? target.name}" updated successfully. Schedule: ${updated?.schedule}.`;
    },
  },
  {
    name: "delete_routine",
    label: "Updating routines",
    description: "Delete one of your routines.",
    parameters: obj({ routine_id: str("Routine id") }),
    describe: (a) => `delete routine ${s(a.routine_id)}`,
    defaultDecision: () => "allow",
    execute: async (a, ctx) => {
      const target = repo.getRoutine(s(a.routine_id)) ?? repo.findRoutine(ctx.dot.id, s(a.routine_id));
      if (!target) return `Routine "${s(a.routine_id)}" not found.`;
      repo.deleteRoutine(target.id);
      recordAutomation({
        kind: "deleted", routineId: target.id, routineName: target.name, dotId: target.dotId, dotName: ctx.dot.name, status: "deleted",
        summary: `Deleted by ${ctx.dot.name}. It was ${target.once ? "a one-time routine" : `a recurring routine (${target.schedule})`}: ${target.instruction.slice(0, 200)}`,
      });
      return `Routine "${target.name}" deleted.`;
    },
  },
  {
    name: "send_update",
    label: "Messaging you",
    description:
      "Send a notification alert for async background tasks or finished routine work. NEVER use this tool for normal conversation, greetings, or immediate chat replies (just write text directly into the chat).",
    parameters: obj({ title: nullableStr("Short notification title (e.g. 'Research Complete'). Leave null if none."), text: str("The message (markdown)") }),
    execute: async (a, ctx) => {
      const rawTitle = a.title ? String(a.title).trim() : null;
      const title = !rawTitle || rawTitle.toLowerCase() === "null" || rawTitle.toLowerCase() === "undefined" ? null : rawTitle;
      repo.addMessage({ dotId: ctx.dot.id, role: "dot", text: s(a.text), title });
      emit({ type: "notify", dotId: ctx.dot.id, title: title ?? ctx.dot.name, body: s(a.text).slice(0, 160) });
      return "Delivered to the user.";
    },
  },
  {
    name: "message_dot",
    label: "Messaging another dot",
    description: "Ask another of the user's dots for help or hand off a sub-task. Returns their reply.",
    parameters: obj({ dot_name: str("The other dot's name"), message: str("Your message to them, with all needed context") }),
    describe: (a) => `message the dot "${s(a.dot_name)}"`,
    defaultDecision: () => "allow",
    execute: async (a, ctx) => {
      const target = repo.findDotByName(s(a.dot_name));
      if (!target) return `No dot named "${s(a.dot_name)}". Available: ${repo.listDots().map((d) => d.name).join(", ")}`;
      if (target.id === ctx.dot.id) return "That's you.";
      if (target.status === "paused") return `${target.name} is paused.`;
      if (ctx.depth >= 2 || !consultImpl) return "Too many nested hand-offs; do it yourself.";
      return consultImpl(target, s(a.message), ctx.dot, ctx.depth + 1, ctx.signal);
    },
  },
  {
    name: "ask_user",
    label: "Waiting for you",
    description: "Ask the user a clarification question when you genuinely need their decision (e.g. choosing between project options or ambiguous instructions). Never use this to report search results or when an answer is not found — write that directly in the chat instead.",
    parameters: obj({ question: str("The question"), options: { type: "array", items: { type: "string" }, description: "Suggested answers (may be empty)" } }),
    pause: "question",
  },
  {
    name: "request_approval",
    label: "Waiting for approval",
    description:
      "Ask the user to approve an action before you take it (sending messages on their behalf, purchases, deleting things, submitting forms, anything irreversible or public). Wait for their decision.",
    parameters: obj({ action: str("What you want to do, one line"), details: str("Exactly what will happen: recipients, amounts, content, etc.") }),
    pause: "approval",
  },
];

// ---------- Composio For You: the user's apps (Gmail, Calendar, Slack, Notion, GitHub…) ----------

TOOLS.push({
  name: "app_connect",
  label: "Connecting an app",
  description:
    "Ask the user to connect one of their apps to Composio (shows a Connect card with a sign-in link) and wait until they finish. Use the exact toolkit slug from COMPOSIO_SEARCH_TOOLS. To add an ADDITIONAL account of an app that is already connected (for example a second LinkedIn login), also pass a short alias.",
  parameters: obj({
    toolkit: str("Toolkit slug, e.g. gmail, googlecalendar, slack, notion, github"),
    alias: nullableStr("Only to add another account of an already-connected app: a short label like \"qdelta-linkedin\". Otherwise null."),
  }),
  pause: "connect",
});

/** Composio's hosted MCP tools, wrapped so they pass our rules and approval cards. */
function composioTools(): ToolDef[] {
  return composio.mcpTools().map((t): ToolDef => {
    const base = {
      name: t.name,
      description: t.description ?? t.name,
      parameters: t.inputSchema as Record<string, unknown>,
      strict: false,
      execute: (a: Record<string, unknown>) => composio.callTool(t.name, a),
    };
    if (t.name === "COMPOSIO_MULTI_EXECUTE_TOOL") {
      return {
        ...base,
        label: "Using your apps",
        precheck: async (a) =>
          composio.executeItems(a).some((i) => /^INSTAGRAM_(CREATE_MEDIA_CONTAINER|POST_IG_USER_MEDIA|POST_IG_USER_MEDIA_PUBLISH|CREATE_POST)/i.test(String(i.tool_slug ?? "")))
            ? "Do not post to Instagram with these generic tools. Use the instagram_post tool (path, caption, kind). It checks the file and asks the user first."
            : null,
        describe: (a) => composio.describeExecute(a),
        defaultDecision: (_ctx, a) => composio.executeDecision(a),
        detail: (a) => composio.executeDetail(a),
      };
    }
    if (t.name === "COMPOSIO_MANAGE_CONNECTIONS") {
      return {
        ...base,
        description: "List or check existing app connections. To connect a new app or service (Twitter, Google, GitHub, Slack, etc.), always call app_connect with the toolkit slug instead.",
        label: "Checking app connections",
        // New connections go through app_connect so the user gets a proper Connect card.
        precheck: async (a) =>
          composio.toolkitList(a).some((k) => (k.action ?? "add") === "add")
            ? "To connect an app, call app_connect with the toolkit slug instead (it shows the user a Connect card)."
            : null,
        describe: (a) => `change app connections (${JSON.stringify(a.toolkits ?? []).slice(0, 120)})`,
        defaultDecision: (_ctx, a) =>
          composio.toolkitList(a).every((k) => k.action === "list") ? "allow" : "ask",
      };
    }
    return { ...base, label: t.name === "COMPOSIO_SEARCH_TOOLS" ? "Finding app tools" : "Checking app tools" };
  });
}

/** A short-lived private link to one of the dot's files: from its workspace, or the stored attachment (even if only in Drive now). */
async function fileLink(dotId: string, rawPath: string, ttlMin = 10): Promise<{ url: string; name: string; size: number; mime: string } | { error: string }> {
  const p = rawPath.trim().replace(/^\.\//, "");
  if (!isSafeWorkspacePath(p)) return { error: "That path is not allowed. Use a path inside your workspace, such as uploads/photo.jpg." };
  const name = p.split("/").pop() ?? p;
  const base = composio.getAppUrl();
  const data = await computer.readFile(dotId, p).catch(() => null);
  if (data) return { url: `${base}/api/public-files/${createFileToken(dotId, p, ttlMin * 60_000).token}`, name, size: data.length, mime: files.guessMime(name) };
  const found = files.findForDot(dotId, name);
  const names = new Set(found.map((f) => f.name.toLowerCase()));
  if (!found.length) return { error: `I couldn't find "${name}" in your workspace or among your attachments. Ask the user to attach it again.` };
  if (names.size > 1) return { error: `Several attachments match "${name}": ${[...names].slice(0, 8).join(", ")}. Ask the user which one they mean.` };
  const content = await files.readContent(found[0].id);
  if (!content.length) return { error: `"${name}" is in the list but its content could not be read from the server or Google Drive. Tell the user.` };
  return { url: `${base}/api/public-files/${createStoredFileToken(found[0].id, ttlMin * 60_000).token}`, name, size: content.length, mime: files.guessMime(name) };
}

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** Look up a tool by name, including Composio's dynamic ones. */
export function findTool(name: string): ToolDef | undefined {
  return TOOL_BY_NAME.get(name) ?? composioTools().find((t) => t.name === name);
}

export function toolsForDot(dot: Dot): ToolDef[] {
  const signedIn = composio.signedIn();
  return [
    ...TOOLS.filter((t) => (t.name !== "run_on_my_computer" || dot.localAccess) && ((t.name !== "app_connect" && t.name !== "linkedin_post_video" && t.name !== "instagram_post" && t.name !== "instagram_collect_leads") || signedIn)),
    ...(signedIn ? composioTools() : []),
  ];
}

export const COMPUTER_ENABLED = (process.env.DOTS_COMPUTER_TOOL ?? "computer") !== "off";

/**
 * Posting tools run at most once per identical request. While one is still running, a retry waits for the same run; after a success
 * the earlier result is returned and nothing is sent again. Only a clear failure lets the same request be tried again.
 */
const postRuns = new Map<string, { at: number; promise: Promise<string> }>();
async function runOnce(key: string, run: () => Promise<string>): Promise<string> {
  const now = Date.now();
  for (const [k, v] of postRuns) if (now - v.at > 30 * 60_000) postRuns.delete(k);
  const prev = postRuns.get(key);
  if (prev) return `${await prev.promise}\n\n(This exact post was already requested, so it was NOT sent a second time. Do not try again unless the result above says it failed.)`;
  const promise = run();
  postRuns.set(key, { at: now, promise });
  promise.then((r) => (/NOT posted/i.test(r) ? postRuns.delete(key) : undefined)).catch(() => postRuns.delete(key));
  return promise;
}
