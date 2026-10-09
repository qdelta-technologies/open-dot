"use client";

import { useEffect, useState } from "react";
import { Download, Trash2 } from "lucide-react";
import { getLeadsSummary, removeLead, resumeLinkedInBrowsing } from "@/app/actions";

type Summary = Awaited<ReturnType<typeof getLeadsSummary>>;

/** Leads your dots saved from pages they read, each with the profile link and the text it came from. */
export default function LeadsSection() {
  const [data, setData] = useState<Summary | null>(null);

  const load = () => getLeadsSummary().then(setData).catch(() => setData({ total: 0, recent: [], paused: null }));
  useEffect(() => {
    load();
  }, []);

  if (!data) return <div className="surface animate-pulse h-20 rounded-lg" />;

  return (
    <div className="space-y-3">
      {data.paused && (
        <div className="surface flex flex-wrap items-center gap-3 px-4 py-3 text-body-sm">
          <span className="min-w-0 flex-1">LinkedIn browsing is paused because LinkedIn showed a check or warning. Deal with it yourself, then resume.</span>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => resumeLinkedInBrowsing().then(load)}
          >
            Resume
          </button>
        </div>
      )}
      <div className="surface flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[14px]">{data.total} saved lead{data.total === 1 ? "" : "s"}</div>
          <div className="text-caption text-foreground/55">Each one has its profile link and the text it was read from.</div>
        </div>
        {data.total > 0 && (
          <a href="/api/leads" className="btn-secondary inline-flex items-center gap-1.5">
            <Download className="size-4" strokeWidth={1.75} /> Download CSV
          </a>
        )}
      </div>
      {data.recent.map((l) => (
        <div key={l.id} className="surface flex items-start gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <a href={l.profileUrl} target="_blank" rel="noreferrer" className="block truncate text-[14px] hover:underline">
              {l.name}
            </a>
            <div className="truncate text-caption text-foreground/60">{[l.headline, l.company].filter(Boolean).join(" · ")}</div>
          </div>
          <button
            type="button"
            aria-label={`Remove ${l.name}`}
            className="text-foreground/45 hover:text-foreground"
            onClick={() => removeLead(l.id).then(load)}
          >
            <Trash2 className="size-4" strokeWidth={1.75} />
          </button>
        </div>
      ))}
    </div>
  );
}
