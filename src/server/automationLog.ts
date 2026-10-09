import "server-only";
import { db, id } from "./db";
import { saveLogFile } from "./files";
import { userTimeZone } from "./timezone";

// A record of what automations did: every run, every creation, every deletion. Rows live in QDot (so they survive a Drive problem),
// and each one is also written as a small readable file into Google Drive under "QDot Logs/<dot>" when Drive is connected.

export type AutomationLogKind = "run" | "created" | "deleted";
export type AutomationLogStatus = "ok" | "error" | "waiting" | "created" | "deleted";

export type AutomationLogEntry = {
  id: string;
  kind: AutomationLogKind;
  routineId: string | null;
  routineName: string;
  dotId: string | null;
  dotName: string;
  status: AutomationLogStatus;
  summary: string;
  /** Link to the log file in Google Drive, once it has been backed up. */
  driveUrl: string | null;
  createdAt: number;
};

const when = (ms: number) => new Date(ms).toLocaleString("en-GB", { timeZone: userTimeZone(), dateStyle: "medium", timeStyle: "medium" });
const clean = (v: string, n: number) => v.replace(/\r/g, "").trim().slice(0, n);

export function recordAutomation(e: {
  kind: AutomationLogKind;
  routineId: string | null;
  routineName: string;
  dotId: string | null;
  dotName: string;
  status: AutomationLogStatus;
  summary: string;
  detail?: string;
}): void {
  try {
    const at = Date.now();
    const heading = e.kind === "run" ? "Automation run" : e.kind === "created" ? "Automation created" : "Automation deleted";
    const text = [
      `# ${heading}: ${e.routineName}`,
      "",
      `- **When:** ${when(at)} (${userTimeZone()})`,
      `- **Dot:** ${e.dotName || "unknown"}`,
      `- **Result:** ${e.status}`,
      "",
      "## What happened",
      clean(e.summary, 1500) || "(nothing recorded)",
      ...(e.detail ? ["", "## Details", clean(e.detail, 6000)] : []),
      "",
    ].join("\n");
    let fileId: string | null = null;
    if (e.dotId) {
      const stamp = new Date(at).toISOString().slice(0, 16).replace("T", " ").replace(":", "");
      fileId = saveLogFile(e.dotId, `${stamp} ${e.kind} - ${e.routineName}.md`, text);
    }
    db()
      .prepare("INSERT INTO automation_log (id, kind, routine_id, routine_name, dot_id, dot_name, status, summary, drive_file_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      // drive_file_id holds QDot's own log file id; the Drive id is looked up from the file record when listing
      .run(id("alog"), e.kind, e.routineId, e.routineName, e.dotId, e.dotName, e.status, clean(e.summary, 800), fileId, at);
  } catch (err) {
    console.warn("[automations] could not write the log:", err instanceof Error ? err.message : err);
  }
}

export function listAutomationLog(limit = 60): AutomationLogEntry[] {
  const rows = db()
    .prepare(
      `SELECT l.*, f.drive_file_id AS drive_id FROM automation_log l LEFT JOIN files f ON f.id = l.drive_file_id ORDER BY l.created_at DESC LIMIT ?`,
    )
    .all(limit) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    kind: r.kind as AutomationLogKind,
    routineId: (r.routine_id as string) ?? null,
    routineName: r.routine_name as string,
    dotId: (r.dot_id as string) ?? null,
    dotName: (r.dot_name as string) ?? "",
    status: r.status as AutomationLogStatus,
    summary: r.summary as string,
    driveUrl: r.drive_id ? `https://drive.google.com/file/d/${r.drive_id as string}/view` : null,
    createdAt: Number(r.created_at),
  }));
}
