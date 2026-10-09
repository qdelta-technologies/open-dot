"use client";

import { useEffect, useState } from "react";
import { Download, Pencil, Trash2 } from "lucide-react";
import { getLeadsSummary, removeLead, resumeLinkedInBrowsing, setLeadStatus, updateLeadContact } from "@/app/actions";

type Summary = Awaited<ReturnType<typeof getLeadsSummary>>;

const STATUSES = [
  ["new", "New"],
  ["contacted", "Contacted"],
  ["replied", "Replied"],
  ["client", "Client"],
  ["not_interested", "Not interested"],
] as const;

/** Leads your dots saved from pages they read, each with the profile link and the text it came from. */
export default function LeadsSection() {
  const [data, setData] = useState<Summary | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ email: "", phone: "" });
  const [error, setError] = useState<string | null>(null);

  const load = () => getLeadsSummary().then(setData).catch(() => setData({ total: 0, recent: [], paused: null }));
  useEffect(() => {
    load();
  }, []);

  if (!data) return <div className="surface animate-pulse h-20 rounded-lg" />;

  const saveContact = async (leadId: string) => {
    setError(null);
    const err = await updateLeadContact(leadId, draft.email, draft.phone);
    if (err) return setError(err);
    setEditing(null);
    load();
  };

  return (
    <div className="space-y-3">
      {data.paused && (
        <div className="surface flex flex-wrap items-center gap-3 px-4 py-3 text-body-sm">
          <span className="min-w-0 flex-1">LinkedIn browsing is paused because LinkedIn showed a check or warning. Deal with it yourself, then resume.</span>
          <button type="button" className="btn-secondary" onClick={() => resumeLinkedInBrowsing().then(load)}>
            Resume
          </button>
        </div>
      )}
      <div className="surface flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[14px]">
            {data.total} saved lead{data.total === 1 ? "" : "s"}
          </div>
          <div className="text-caption text-foreground/55">Each one has its profile link and the text it was read from.</div>
        </div>
        {data.total > 0 && (
          <a href="/api/leads" className="btn-secondary inline-flex items-center gap-1.5">
            <Download className="size-4" strokeWidth={1.75} /> Download CSV
          </a>
        )}
      </div>
      {data.recent.map((l) => (
        <div key={l.id} className="surface px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <a href={l.profileUrl} target="_blank" rel="noreferrer" className="block truncate text-[14px] hover:underline">
                {l.name}
              </a>
              <div className="truncate text-caption text-foreground/60">{[l.headline, l.company].filter(Boolean).join(" · ")}</div>
              <div className="mt-0.5 truncate text-caption text-foreground/55">
                {l.email || l.phone ? [l.email, l.phone].filter(Boolean).join(" · ") : "No email or phone yet"}
              </div>
            </div>
            <select
              aria-label={`Status of ${l.name}`}
              className="field h-8 w-auto py-0 text-[12px]"
              value={l.status}
              onChange={(e) => setLeadStatus(l.id, e.target.value).then(load)}
            >
              {STATUSES.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label={`Edit contact details of ${l.name}`}
              className="text-foreground/45 hover:text-foreground"
              onClick={() => (setEditing(editing === l.id ? null : l.id), setDraft({ email: l.email, phone: l.phone }), setError(null))}
            >
              <Pencil className="size-4" strokeWidth={1.75} />
            </button>
            <button type="button" aria-label={`Remove ${l.name}`} className="text-foreground/45 hover:text-destructive" onClick={() => removeLead(l.id).then(load)}>
              <Trash2 className="size-4" strokeWidth={1.75} />
            </button>
          </div>
          {editing === l.id && (
            <div className="mt-3 space-y-2">
              <input className="field" placeholder="Email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
              <input className="field" placeholder="Phone or WhatsApp, with country code (+91...)" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
              {error && <div className="text-caption text-destructive">{error}</div>}
              <button type="button" className="btn-secondary" onClick={() => saveContact(l.id)}>
                Save
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
