import "server-only";
import { executeTool } from "./composio";
import { addLead } from "./leads";

// Leads from people who already reached out on Instagram: commenters on the account's own posts, and people who sent a DM.
// Each lead keeps the exact comment or message as its evidence. Nothing here searches for strangers.

type Json = unknown;

/** Composio replies are JSON, sometimes wrapped in text. Return the parsed value, or null. */
function parse(out: string): Json {
  try {
    return JSON.parse(out);
  } catch {
    const start = out.search(/[{[]/);
    if (start < 0) return null;
    const open = out[start];
    const close = open === "{" ? "}" : "]";
    const end = out.lastIndexOf(close);
    if (end <= start) return null;
    try {
      return JSON.parse(out.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function walk(v: Json, visit: (o: Record<string, unknown>) => void) {
  if (Array.isArray(v)) v.forEach((x) => walk(x, visit));
  else if (v && typeof v === "object") {
    visit(v as Record<string, unknown>);
    Object.values(v as Record<string, unknown>).forEach((x) => walk(x, visit));
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const nameOf = (o: Record<string, unknown>): string => {
  const from = (o.from ?? o.user ?? {}) as Record<string, unknown>;
  return str(o.username) || str(from.username) || "";
};

export type CollectResult = { saved: string[]; duplicates: number; skipped: number; notes: string[] };

export async function collectInstagramLeads(dotId: string, opts: { posts: number; dms: boolean }): Promise<CollectResult> {
  const result: CollectResult = { saved: [], duplicates: 0, skipped: 0, notes: [] };
  const seen = new Set<string>();

  let me = { id: "", username: "" };
  try {
    const info = parse(await executeTool("INSTAGRAM_GET_USER_INFO", {}));
    walk(info, (o) => {
      if (!me.username && str(o.username)) me = { id: String(o.id ?? ""), username: str(o.username) };
    });
  } catch {
    result.notes.push("Could not read the account's own name, so its own comments may be included.");
  }

  const keep = (username: string, text: string, kind: "comment" | "dm", source: string) => {
    const clean = username.replace(/^@/, "").trim();
    if (!clean || clean.toLowerCase() === me.username.toLowerCase() || !text.trim() || seen.has(clean.toLowerCase())) {
      result.skipped++;
      return;
    }
    seen.add(clean.toLowerCase());
    const r = addLead(dotId, {
      name: `@${clean}`,
      profileUrl: `https://www.instagram.com/${clean}`,
      sourceUrl: source,
      evidence: kind === "comment" ? `Commented on your post: "${text.trim()}"` : `Sent you a message: "${text.trim()}"`,
      notes: kind === "comment" ? "Instagram comment" : "Instagram message",
    });
    if (!r.ok) result.skipped++;
    else if (r.duplicate) result.duplicates++;
    else result.saved.push(`@${clean}`);
  };

  // comments on the most recent posts
  const media = parse(await executeTool("INSTAGRAM_LIST_MEDIA", { limit: Math.min(Math.max(opts.posts, 1), 10) }));
  const posts: { id: string; permalink: string }[] = [];
  walk(media, (o) => {
    if (str(o.id) && (o.caption !== undefined || o.media_url !== undefined || o.permalink !== undefined || o.timestamp !== undefined) && posts.length < opts.posts)
      posts.push({ id: str(o.id), permalink: str(o.permalink) });
  });
  if (!posts.length) result.notes.push("No posts were returned for this account.");
  for (const p of posts) {
    const comments = parse(await executeTool("INSTAGRAM_GET_MEDIA_COMMENTS", { media_id: p.id }));
    walk(comments, (o) => {
      const text = str(o.text) || str(o.message);
      const who = nameOf(o);
      if (text && who) keep(who, text, "comment", p.permalink);
    });
  }

  // people who sent a message
  if (opts.dms) {
    const convs = parse(await executeTool("INSTAGRAM_LIST_ALL_CONVERSATIONS", { limit: 15 }));
    const ids: string[] = [];
    walk(convs, (o) => {
      if (str(o.id) && (o.participants !== undefined || o.updated_time !== undefined) && ids.length < 15) ids.push(str(o.id));
    });
    for (const cid of ids) {
      const msgs = parse(await executeTool("INSTAGRAM_LIST_ALL_MESSAGES", { conversation_id: cid, limit: 10 }));
      walk(msgs, (o) => {
        const text = str(o.message) || str(o.text);
        const who = nameOf(o);
        if (text && who) keep(who, text, "dm", "");
      });
    }
  }
  if (!result.saved.length && !result.duplicates) result.notes.push("No one new was found. If you expected comments, the posts may have none yet.");
  return result;
}
