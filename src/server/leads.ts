import "server-only";
import { db, id, getSetting, setSetting } from "./db";

// Lead research and outreach. Every lead must carry its evidence (the profile link and the text it was read from), so nothing is guessed.
// LinkedIn browsing is paced and capped, and it stops by itself when LinkedIn shows a check (QDot never solves those).

export const LEAD_STATUSES = ["new", "contacted", "replied", "client", "not_interested"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export type Lead = {
  id: string;
  dotId: string;
  name: string;
  headline: string;
  company: string;
  location: string;
  email: string;
  phone: string;
  status: LeadStatus;
  lastContactedAt: number | null;
  profileUrl: string;
  sourceUrl: string;
  evidence: string;
  notes: string;
  createdAt: number;
};

type Row = {
  id: string; dot_id: string; name: string; headline: string; company: string; location: string; email: string; phone: string;
  status: string; last_contacted_at: number | null; profile_url: string; source_url: string; evidence: string; notes: string; created_at: number;
};

const toLead = (r: Row): Lead => ({
  id: r.id, dotId: r.dot_id, name: r.name, headline: r.headline, company: r.company, location: r.location, email: r.email ?? "", phone: r.phone ?? "",
  status: (LEAD_STATUSES as readonly string[]).includes(r.status) ? (r.status as LeadStatus) : "new",
  lastContactedAt: r.last_contacted_at == null ? null : Number(r.last_contacted_at),
  profileUrl: r.profile_url, sourceUrl: r.source_url, evidence: r.evidence, notes: r.notes, createdAt: Number(r.created_at),
});

const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const EMAIL = /^[^\s@<>[\]]+@[^\s@<>[\]]+\.[A-Za-z]{2,}$/;
export const cleanEmail = (v: unknown) => {
  const e = clip(v, 200).toLowerCase();
  return EMAIL.test(e) ? e : "";
};
/** Digits with an optional leading +. A bare 10-digit number gets the country code of the user's region when it is known. */
export function cleanPhone(v: unknown, defaultCountry = ""): string {
  const raw = clip(v, 40);
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return "";
  if (raw.trim().startsWith("+") || raw.trim().startsWith("00") || digits.length > 10) return `+${digits.replace(/^00/, "")}`;
  return defaultCountry ? `+${defaultCountry}${digits}` : `+${digits}`;
}

export function addLead(
  dotId: string,
  f: {
    name: string; headline?: string; company?: string; location?: string; email?: string; phone?: string;
    profileUrl: string; sourceUrl?: string; evidence: string; notes?: string;
  },
): { ok: true; lead: Lead; duplicate: boolean } | { ok: false; reason: string } {
  const name = clip(f.name, 120);
  const profileUrl = clip(f.profileUrl, 400).split("?")[0].replace(/\/+$/, "");
  const evidence = clip(f.evidence, 800);
  if (!name) return { ok: false, reason: "A lead needs a name." };
  if (!/^https?:\/\//i.test(profileUrl)) return { ok: false, reason: "A lead needs the full profile link (https://...) of the page you read." };
  if (evidence.length < 20) return { ok: false, reason: "Add the exact text you read on the page as evidence (at least a short line). Leads are never filled in from memory." };
  const existing = db().prepare("SELECT * FROM leads WHERE profile_url = ?").get(profileUrl) as Row | undefined;
  if (existing) return { ok: true, lead: toLead(existing), duplicate: true };
  const email = cleanEmail(f.email);
  const phone = cleanPhone(f.phone, regionCallingCode());
  const row: Row = {
    id: id("lead"), dot_id: dotId, name, headline: clip(f.headline, 200), company: clip(f.company, 160), location: clip(f.location, 120),
    email, phone, status: "new", last_contacted_at: null,
    profile_url: profileUrl, source_url: clip(f.sourceUrl, 400), evidence, notes: clip(f.notes, 400), created_at: Date.now(),
  };
  db()
    .prepare(
      "INSERT INTO leads (id, dot_id, name, headline, company, location, email, phone, status, profile_url, source_url, evidence, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(row.id, row.dot_id, row.name, row.headline, row.company, row.location, row.email, row.phone, row.status, row.profile_url, row.source_url, row.evidence, row.notes, row.created_at);
  return { ok: true, lead: toLead(row), duplicate: false };
}

export function listLeads(limit = 200, dotId?: string): Lead[] {
  const rows = (dotId
    ? db().prepare("SELECT * FROM leads WHERE dot_id = ? ORDER BY created_at DESC LIMIT ?").all(dotId, limit)
    : db().prepare("SELECT * FROM leads ORDER BY created_at DESC LIMIT ?").all(limit)) as Row[];
  return rows.map(toLead);
}

/** Find one lead by its id, profile link, email, or exact name (case-insensitive). */
export function findLead(key: string): Lead | null {
  const k = clip(key, 400);
  if (!k) return null;
  const hit =
    (db().prepare("SELECT * FROM leads WHERE id = ? OR profile_url = ? OR lower(email) = lower(?)").get(k, k.replace(/\/+$/, ""), k) as Row | undefined) ??
    (db().prepare("SELECT * FROM leads WHERE lower(name) = lower(?) OR lower(name) = lower(?)").get(k, k.startsWith("@") ? k : `@${k}`) as Row | undefined);
  return hit ? toLead(hit) : null;
}

export function updateLead(
  key: string,
  patch: { email?: string; phone?: string; status?: string; notes?: string; company?: string; headline?: string },
): { ok: true; lead: Lead } | { ok: false; reason: string } {
  const lead = findLead(key);
  if (!lead) return { ok: false, reason: `No lead matches "${key}". Use list_leads to see the saved ones.` };
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  const put = (col: string, v: string | number | null) => (sets.push(`${col} = ?`), vals.push(v));
  if (patch.email !== undefined && patch.email !== "") {
    const e = cleanEmail(patch.email);
    if (!e) return { ok: false, reason: `"${patch.email}" is not a valid email address.` };
    put("email", e);
  }
  if (patch.phone !== undefined && patch.phone !== "") {
    const ph = cleanPhone(patch.phone, regionCallingCode());
    if (!ph) return { ok: false, reason: `"${patch.phone}" is not a valid phone number. Include the country code, like +91...` };
    put("phone", ph);
  }
  if (patch.status !== undefined && patch.status !== "") {
    const st = patch.status.toLowerCase().replace(/\s+/g, "_");
    if (!(LEAD_STATUSES as readonly string[]).includes(st)) return { ok: false, reason: `Status must be one of: ${LEAD_STATUSES.join(", ")}.` };
    put("status", st);
    if (st === "contacted") put("last_contacted_at", Date.now());
  }
  if (patch.notes) put("notes", clip(patch.notes, 400));
  if (patch.company) put("company", clip(patch.company, 160));
  if (patch.headline) put("headline", clip(patch.headline, 200));
  if (!sets.length) return { ok: false, reason: "Nothing to update." };
  db().prepare(`UPDATE leads SET ${sets.join(", ")} WHERE id = ?`).run(...vals, lead.id);
  return { ok: true, lead: findLead(lead.id)! };
}

export function markContacted(leadId: string) {
  db().prepare("UPDATE leads SET status = CASE WHEN status IN ('new') THEN 'contacted' ELSE status END, last_contacted_at = ? WHERE id = ?").run(Date.now(), leadId);
}

export function countLeads(): number {
  return Number((db().prepare("SELECT COUNT(*) AS n FROM leads").get() as { n: number }).n);
}

export function deleteLead(leadId: string) {
  db().prepare("DELETE FROM leads WHERE id = ?").run(leadId);
}

const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

export function leadsCsv(): string {
  const head = ["Name", "Headline", "Company", "Location", "Email", "Phone", "Status", "Last contacted", "Profile link", "Found on", "Evidence (text read on the page)", "Notes", "Saved at"];
  const rows = listLeads(5000).map((l) =>
    [
      l.name, l.headline, l.company, l.location, l.email, l.phone, l.status, l.lastContactedAt ? new Date(l.lastContactedAt).toISOString() : "",
      l.profileUrl, l.sourceUrl, l.evidence, l.notes, new Date(l.createdAt).toISOString(),
    ].map(csvCell).join(","),
  );
  return [head.map(csvCell).join(","), ...rows].join("\r\n");
}

// ---------------- the user's region (for phone numbers without a country code) ----------------

const REGION_CODES: Record<string, string> = {
  "Asia/Calcutta": "91", "Asia/Kolkata": "91", "Asia/Dubai": "971", "Asia/Singapore": "65", "Europe/London": "44", "Asia/Karachi": "92",
  "America/New_York": "1", "America/Chicago": "1", "America/Los_Angeles": "1", "Australia/Sydney": "61", "Asia/Dhaka": "880", "Asia/Colombo": "94",
};
export function regionCallingCode(): string {
  const saved = getSetting("default_country_code");
  if (saved) return saved;
  const tz = getSetting("profile_timezone") ?? "";
  return REGION_CODES[tz] ?? "";
}

// ---------------- message templates ----------------

export type Template = { id: string; name: string; purpose: string; subject: string; body: string; updatedAt: number };
type TRow = { id: string; name: string; purpose: string; subject: string; body: string; updated_at: number };
const toTemplate = (r: TRow): Template => ({ id: r.id, name: r.name, purpose: r.purpose ?? "", subject: r.subject, body: r.body, updatedAt: Number(r.updated_at) });

export function listTemplates(): Template[] {
  return (db().prepare("SELECT * FROM templates ORDER BY name COLLATE NOCASE").all() as TRow[]).map(toTemplate);
}

/** Find a template by name, ignoring case, spaces and a leading "template" ("Template 1", "template1", "1" all match). */
export function findTemplate(name: string): Template | null {
  const norm = (v: string) => v.toLowerCase().replace(/^template\s*/, "").replace(/\s+/g, "");
  const want = norm(name);
  if (!want) return null;
  return listTemplates().find((t) => norm(t.name) === want) ?? null;
}

export function saveTemplate(name: string, subject: string, body: string, purpose = ""): Template | { error: string } {
  const n = clip(name, 80);
  if (!n) return { error: "A template needs a name." };
  if (!body.trim()) return { error: "A template needs a body." };
  const existing = findTemplate(n);
  const now = Date.now();
  if (existing) {
    // an update that gives no purpose keeps the one already saved
    db().prepare("UPDATE templates SET name = ?, purpose = ?, subject = ?, body = ?, updated_at = ? WHERE id = ?").run(n, purpose.trim() ? clip(purpose, 160) : existing.purpose, clip(subject, 200), body.trim().slice(0, 6000), now, existing.id);
    return listTemplates().find((t) => t.id === existing.id)!;
  }
  const tid = id("tpl");
  db().prepare("INSERT INTO templates (id, name, purpose, subject, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(tid, n, clip(purpose, 160), clip(subject, 200), body.trim().slice(0, 6000), now, now);
  return listTemplates().find((t) => t.id === tid)!;
}

export function deleteTemplate(templateId: string) {
  db().prepare("DELETE FROM templates WHERE id = ?").run(templateId);
}

/** Fill {name}, {first_name}, {company} for one lead. Anything unknown is left out cleanly, never as a bracket. */
export function fillTemplate(text: string, lead: Pick<Lead, "name" | "company">): string {
  const full = lead.name.replace(/^@/, "").trim();
  const first = full.split(/\s+/)[0] || full;
  return text
    .replace(/\{\{?\s*first_name\s*\}?\}/gi, first)
    .replace(/\{\{?\s*name\s*\}?\}/gi, full)
    .replace(/\{\{?\s*company\s*\}?\}/gi, lead.company || "your company");
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
