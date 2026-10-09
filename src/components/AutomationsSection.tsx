"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { getAutomations } from "@/app/actions";

type Data = Awaited<ReturnType<typeof getAutomations>>;

const KIND_LABEL = { run: "Ran", created: "Created", deleted: "Deleted" } as const;
const STATUS_STYLE: Record<string, string> = {
  ok: "bg-success/15 text-success",
  error: "bg-destructive/15 text-destructive",
  waiting: "bg-warning/20 text-foreground/70",
  created: "bg-foreground/[0.06] text-foreground/65",
  deleted: "bg-foreground/[0.06] text-foreground/65",
};

/** Every automation, and a record of what each one did: runs, creations and deletions, with a copy in Google Drive. */
export default function AutomationsSection() {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setBusy(true);
    getAutomations()
      .then(setData)
      .catch(() => setData({ routines: [], log: [], timezone: "UTC" }))
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (!data) return <div className="surface animate-pulse h-20 rounded-lg" />;

  const fmt = (ms: number | null) =>
    ms ? new Date(ms).toLocaleString(undefined, { timeZone: data.timezone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 text-caption text-foreground/55">Times are in {data.timezone}.</div>
        <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={load} disabled={busy}>
          <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} strokeWidth={1.75} /> Refresh
        </button>
      </div>

      <div className="surface divide-y divide-black/[0.06]">
        {data.routines.length === 0 && <div className="px-4 py-4 text-body-sm text-foreground/55">No automations right now. Ask a dot to set one up in chat.</div>}
        {data.routines.map((r) => (
          <div key={r.id} className="flex items-start gap-3 px-4 py-3">
            <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${r.enabled ? "bg-success" : "bg-foreground/25"}`} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px]">{r.name}</span>
                <span className="rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[11px] text-foreground/60">{r.once ? "Runs once" : "Repeats"}</span>
                <span className="text-caption text-foreground/45">{r.dotName}</span>
              </div>
              <div className="mt-0.5 text-body-sm text-foreground/55">
                {r.enabled && r.nextRunAt ? `Next: ${fmt(r.nextRunAt)}` : r.once ? "Already started" : "Paused"}
                {r.lastRunAt ? ` · Last: ${fmt(r.lastRunAt)}` : ""}
                {!r.once && r.schedule ? ` · ${r.schedule}` : ""}
              </div>
              {r.lastError && <div className="mt-0.5 text-caption text-destructive">Last run failed: {r.lastError.slice(0, 160)}</div>}
            </div>
          </div>
        ))}
      </div>

      <div>
        <div className="eyebrow mb-2">Record</div>
        <div className="surface divide-y divide-black/[0.06]">
          {data.log.length === 0 && <div className="px-4 py-4 text-body-sm text-foreground/55">Nothing yet. Runs, creations and deletions will be listed here.</div>}
          {data.log.map((e) => (
            <div key={e.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS_STYLE[e.status] ?? STATUS_STYLE.created}`}>
                  {KIND_LABEL[e.kind]}
                  {e.kind === "run" ? ` · ${e.status}` : ""}
                </span>
                <span className="text-[14px]">{e.routineName}</span>
                <span className="text-caption text-foreground/45">{e.dotName}</span>
                <span className="ml-auto font-mono text-[11px] text-foreground/40">{fmt(e.createdAt)}</span>
              </div>
              <div className="mt-1 text-body-sm text-foreground/60">{e.summary}</div>
              {e.driveUrl && (
                <a href={e.driveUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-caption text-foreground/55 hover:text-foreground">
                  <ExternalLink className="size-3" strokeWidth={1.75} /> Open log in Drive
                </a>
              )}
            </div>
          ))}
        </div>
        <p className="mt-2 text-caption text-foreground/45">Each entry is also saved as a file in Google Drive, under QDot Logs.</p>
      </div>
    </div>
  );
}
