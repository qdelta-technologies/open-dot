import "server-only";
import { db, id, getSetting, setSetting } from "./db";

// Lead research. Every lead must carry its evidence (the profile link and the text it was read from), so nothing is guessed.
// LinkedIn browsing is paced and capped, and it stops by itself when LinkedIn shows a check (QDot never solves those).

export type Lead = {
  id: string;
  dotId: string;
  name: string;
  headline: string;
  company: string;
  location: string;
  profileUrl: string;
  sourceUrl: string;
  evidence: string;
  notes: string;
  createdAt: number;
};

type Row = {
  id: string; dot_id: string; name: string; headline: string; company: string; location: string;
  profile_url: string; source_url: string; evidence: string; notes: string; created_at: number;
};

const toLead = (r: Row): Lead => ({
  id: r.id, dotId: r.dot_id, name: r.name, headline: r.headline, company: r.company, location: r.location,
  profileUrl: r.profile_url, sourceUrl: r.source_url, evidence: r.evidence, notes: r.notes, createdAt: Number(r.created_at),
});

const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export function addLead(
  dotId: string,
  f: { name: string; headline?: string; company?: string; location?: string; profileUrl: string; sourceUrl?: string; evidence: string; notes?: string },
): { ok: true; lead: Lead; duplicate: boolean } | { ok: false; reason: string } {
  const name = clip(f.name, 120);
  const profileUrl = clip(f.profileUrl, 400).split("?")[0].replace(/\/+$/, "");
  const evidence = clip(f.evidence, 800);
  if (!name) return { ok: false, reason: "A lead needs a name." };
  if (!/^https?:\/\//i.test(profileUrl)) return { ok: false, reason: "A lead needs the full profile link (https://...) of the page you read." };
  if (evidence.length < 20) return { ok: false, reason: "Add the exact text you read on the page as evidence (at least a short line). Leads are never filled in from memory." };
  const existing = db().prepare("SELECT * FROM leads WHERE profile_url = ?").get(profileUrl) as Row | undefined;
  if (existing) return { ok: true, lead: toLead(existing), duplicate: true };
  const row: Row = {
    id: id("lead"), dot_id: dotId, name, headline: clip(f.headline, 200), company: clip(f.company, 160), location: clip(f.location, 120),
    profile_url: profileUrl, source_url: clip(f.sourceUrl, 400), evidence, notes: clip(f.notes, 400), created_at: Date.now(),
  };
  db()
    .prepare("INSERT INTO leads (id, dot_id, name, headline, company, location, profile_url, source_url, evidence, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(row.id, row.dot_id, row.name, row.headline, row.company, row.location, row.profile_url, row.source_url, row.evidence, row.notes, row.created_at);
  return { ok: true, lead: toLead(row), duplicate: false };
}

export function listLeads(limit = 200, dotId?: string): Lead[] {
  const rows = (dotId
    ? db().prepare("SELECT * FROM leads WHERE dot_id = ? ORDER BY created_at DESC LIMIT ?").all(dotId, limit)
    : db().prepare("SELECT * FROM leads ORDER BY created_at DESC LIMIT ?").all(limit)) as Row[];
  return rows.map(toLead);
}

export function countLeads(): number {
  return Number((db().prepare("SELECT COUNT(*) AS n FROM leads").get() as { n: number }).n);
}

export function deleteLead(leadId: string) {
  db().prepare("DELETE FROM leads WHERE id = ?").run(leadId);
}

const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

export function leadsCsv(): string {
  const head = ["Name", "Headline", "Company", "Location", "Profile link", "Found on", "Evidence (text read on the page)", "Notes", "Saved at"];
  const rows = listLeads(5000).map((l) =>
    [l.name, l.headline, l.company, l.location, l.profileUrl, l.sourceUrl, l.evidence, l.notes, new Date(l.createdAt).toISOString()].map(csvCell).join(","),
  );
  return [head.map(csvCell).join(","), ...rows].join("\r\n");
}

// ---------------- LinkedIn pacing ----------------

const DEFAULT_DAILY_PAGES = 40;
const MIN_GAP_MS = 15_000;
const lastOpen = new Map<string, number>();
const dayKey = (dotId: string) => `linkedin_pages:${new Date().toISOString().slice(0, 10)}:${dotId}`;

export const isLinkedIn = (url: string) => /(^|\/\/|\.)linkedin\.com/i.test(url);

/** A LinkedIn page that is asking for a check, a login, or that says activity looks unusual. */
export const looksLikeLinkedInCheck = (text: string) =>
  /checkpoint|captcha|authwall|challenge|security verification|unusual activity|let's do a quick security check|verify you're a human|restricted/i.test(text);

export function linkedInPaused(): string | null {
  return getSetting("linkedin_paused");
}

export function pauseLinkedIn(reason: string) {
  setSetting("linkedin_paused", `${new Date().toISOString()} ${reason}`.slice(0, 300));
}

export function resumeLinkedIn() {
  setSetting("linkedin_paused", null);
}

/** Called before every LinkedIn page the dot opens. Returns a message when the dot must not go on. */
export async function linkedInGate(dotId: string): Promise<string | null> {
  const paused = linkedInPaused();
  if (paused)
    return `LinkedIn browsing is paused (${paused}). LinkedIn showed a check or warning. Do NOT try to solve it or go around it. Tell the user, and carry on only after they have dealt with it and say so.`;
  const cap = Math.max(5, Number(getSetting("linkedin_daily_cap")) || DEFAULT_DAILY_PAGES);
  const used = Number(getSetting(dayKey(dotId))) || 0;
  if (used >= cap) return `Today's LinkedIn limit of ${cap} pages is used up. Stop here, save what you have, and tell the user to continue tomorrow.`;
  const wait = MIN_GAP_MS - (Date.now() - (lastOpen.get(dotId) ?? 0));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait + Math.floor(Math.random() * 5000)));
  lastOpen.set(dotId, Date.now());
  setSetting(dayKey(dotId), String(used + 1));
  return null;
}
