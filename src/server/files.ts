import "server-only";
import fs from "node:fs";
import path from "node:path";
import { db, DATA_DIR, id, getSetting, setSetting } from "./db";
import * as computer from "./computer";
import { apps as composioApps, signedIn as composioSignedIn, executeTool, getAppUrl } from "./composio";
import { createStoredFileToken } from "./links";
import type { Attachment } from "@/lib/types";

// Files that move between the user and a dot. The canonical copy lives in .data/files/<id>
// (for previews and downloads); a working copy goes into the dot's computer so it can use it.

const DIR = path.join(DATA_DIR, "files");
export const MAX_UPLOAD = 25 * 1024 * 1024;

type Row = { id: string; dot_id: string; name: string; mime: string; size: number; source: string; box_path: string | null; drive_file_id: string | null; created_at: number };

const safeName = (name: string) => name.replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_").replace(/^\.+/, "").slice(0, 120) || "file";

export function guessMime(name: string): string {
  const ext = path.extname(name).toLowerCase();
  return (
    {
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
      ".pdf": "application/pdf", ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv", ".json": "application/json",
      ".html": "text/html", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".zip": "application/zip",
      ".py": "text/x-python", ".js": "text/javascript", ".ts": "text/plain",
    } as Record<string, string>
  )[ext] ?? "application/octet-stream";
}

/** Thrown when files.upload() is called but Google Drive is not connected. */
export class DriveNotConnectedError extends Error {
  constructor() { super("DRIVE_NOT_CONNECTED"); this.name = "DriveNotConnectedError"; }
}

function saveRecord(dotId: string, fileId: string, name: string, mime: string, size: number, source: "user" | "dot", boxPath: string | null, driveFileId: string | null): Attachment {
  db()
    .prepare("INSERT INTO files (id, dot_id, name, mime, size, source, box_path, drive_file_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(fileId, dotId, name, mime, size, source, boxPath, driveFileId, Date.now());
  return { id: fileId, name, mime, size };
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Fetch a file's content from Google Drive via Composio. Returns the raw bytes. */
export async function fetchFromDrive(driveFileId: string): Promise<Buffer> {
  const out = await executeTool("GOOGLEDRIVE_DOWNLOAD_FILE", { fileId: driveFileId });
  const raw = out.match(/"s3url"\s*:\s*"([^"]+)"/)?.[1];
  if (!raw) throw new Error(`Google Drive did not return a download link: ${out.slice(0, 200)}`);
  const url = JSON.parse(`"${raw}"`) as string;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't download the file from Google Drive (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

function save(dotId: string, name: string, mime: string, data: Buffer, source: "user" | "dot", boxPath: string | null): Attachment {
  fs.mkdirSync(DIR, { recursive: true });
  const fileId = id("file");
  fs.writeFileSync(path.join(DIR, fileId), data);
  return saveRecord(dotId, fileId, name, mime, data.length, source, boxPath, null);
}

/** The user attached a file. It is kept on the server (and in the dot's workspace). Saving to Google Drive is not switched on yet. */
export async function upload(dotId: string, name: string, mime: string, data: Buffer): Promise<Attachment & { boxPath: string }> {
  const disk = diskUsage();
  if (disk && disk.used / disk.total >= 0.9) {
    throw new Error(`The server disk is almost full (${Math.round((disk.used / disk.total) * 100)}%). Attachments are paused. Free some space in Settings → Storage.`);
  }

  const clean = safeName(name);
  const mimeType = mime || guessMime(clean);

  // Working copy on the dot's computer, so the dot can read it
  const boxPath = await computer.writeFile(dotId, `uploads/${clean}`, data);
  const saved = save(dotId, clean, mimeType, data, "user", boxPath);
  void backupToDrive(saved.id);
  return { ...saved, boxPath };
}

/** The dot shares a file from its computer with the user. */
export async function shareFromComputer(dotId: string, p: string): Promise<Attachment> {
  const data = await computer.readFile(dotId, p);
  if (data.length > MAX_UPLOAD * 4) throw new Error("That file is too large to share (over 100 MB).");
  const name = safeName(path.basename(p));
  return save(dotId, name, guessMime(name), data, "dot", p);
}

export function get(fileId: string): (Attachment & { dotId: string; boxPath: string | null; driveFileId: string | null; data: () => Buffer }) | null {
  const r = db().prepare("SELECT * FROM files WHERE id = ?").get(fileId) as Row | undefined;
  if (!r) return null;
  return {
    id: r.id, name: r.name, mime: r.mime, size: r.size, dotId: r.dot_id, boxPath: r.box_path, driveFileId: r.drive_file_id ?? null,
    data: () => {
      const p = path.join(DIR, r.id);
      return fs.existsSync(p) ? fs.readFileSync(p) : Buffer.alloc(0);
    },
  };
}

export function boxPathOf(fileId: string): string | null {
  return get(fileId)?.boxPath ?? null;
}

export type StoredFile = {
  id: string;
  dotId: string;
  dotName?: string;
  name: string;
  mime: string;
  size: number;
  source: string;
  boxPath: string | null;
  createdAt: number;
  driveFileId: string | null;
  localCopy: boolean;
};

/** List all files stored in the system, with associated dot name. */
export function listFiles(): StoredFile[] {
  try {
    const rows = db()
      .prepare(
        `SELECT f.*, d.name as dot_name 
         FROM files f 
         LEFT JOIN dots d ON f.dot_id = d.id 
         ORDER BY f.created_at DESC`
      )
      .all() as (Row & { dot_name?: string })[];
    return rows.map((r) => ({
      id: r.id,
      dotId: r.dot_id,
      dotName: r.dot_name,
      name: r.name,
      mime: r.mime,
      size: r.size,
      source: r.source,
      boxPath: r.box_path,
      createdAt: r.created_at,
      driveFileId: r.drive_file_id ?? null,
      localCopy: fs.existsSync(path.join(DIR, r.id)),
    }));
  } catch (err) {
    console.warn("[files] Failed to list files:", err);
    return [];
  }
}

/** Permanently delete a file from disk and database to reclaim storage space. */
export async function deleteFile(fileId: string): Promise<boolean> {
  const f = get(fileId);
  if (!f) return false;

  // 1. Delete canonical file from .data/files/<fileId>
  try {
    const filePath = path.join(DIR, fileId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.warn(`[files] Failed to remove canonical file ${fileId}:`, err);
  }

  // 2. Delete copy from dot's workspace uploads folder
  if (f.dotId && f.name) {
    try {
      await computer.runCommand(f.dotId, `rm -f "uploads/${f.name}"`).catch(() => null);
    } catch {
      // ignore
    }
  }

  // 3. Remove record from database
  try {
    db().prepare("DELETE FROM files WHERE id = ?").run(fileId);
  } catch (err) {
    console.warn(`[files] Failed to delete database record for ${fileId}:`, err);
  }

  return true;
}

/** Delete all files in the system to recover maximum Railway container storage. */
export async function deleteAllFiles(): Promise<{ count: number; freedBytes: number }> {
  const all = listFiles();
  let totalBytes = 0;
  for (const f of all) {
    totalBytes += f.size;
    await deleteFile(f.id);
  }
  return { count: all.length, freedBytes: totalBytes };
}

export function diskUsage(): { total: number; used: number } | null {
  try {
    const s = fs.statfsSync(DATA_DIR);
    const total = Number(s.bsize) * Number(s.blocks);
    const free = Number(s.bsize) * Number(s.bavail);
    return total > 0 ? { total, used: Math.max(0, total - free) } : null;
  } catch {
    return null;
  }
}

/** Attachments still on the server, plus the real disk usage. */
export function getStorageStats(): {
  totalFiles: number;
  totalBytes: number;
  railwayLimitBytes: number;
  percentUsed: number;
  diskUsedBytes: number | null;
  diskTotalBytes: number | null;
} {
  try {
    const rows = db().prepare("SELECT id, size FROM files").all() as { id: string; size: number }[];
    const local = rows.filter((r) => fs.existsSync(path.join(DIR, r.id)));
    const totalFiles = local.length;
    const totalBytes = local.reduce((n, r) => n + Number(r.size), 0);
    const disk = diskUsage();
    const railwayLimitBytes = disk?.total ?? 500 * 1024 * 1024;
    const used = disk?.used ?? totalBytes;
    const percentUsed = Math.min(100, Math.round((used / railwayLimitBytes) * 100));
    return { totalFiles, totalBytes, railwayLimitBytes, percentUsed, diskUsedBytes: disk?.used ?? null, diskTotalBytes: disk?.total ?? null };
  } catch (err) {
    console.warn("[files] Failed to read storage stats:", err);
    return { totalFiles: 0, totalBytes: 0, railwayLimitBytes: 500 * 1024 * 1024, percentUsed: 0, diskUsedBytes: null, diskTotalBytes: null };
  }
}

// ---------------- backup to Google Drive, and cleanup of backed-up copies ----------------

const BACKUP_FOLDER_NAME = "QDot Uploads";
const BACKUP_FOLDER_KEY = "drive_backup_folder_id";
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const backingUp = new Set<string>();

const driveIdOf = (out: string) => out.match(/"id"\s*:\s*"([A-Za-z0-9_-]{15,})"/)?.[1] ?? null;

async function ensureBackupFolder(): Promise<string> {
  const saved = getSetting(BACKUP_FOLDER_KEY);
  if (saved) return saved;
  let folderId: string | null = null;
  try {
    const found = await executeTool("GOOGLEDRIVE_FIND_FOLDER", { name: BACKUP_FOLDER_NAME });
    if (found.includes(BACKUP_FOLDER_NAME)) folderId = driveIdOf(found);
  } catch {
    // not found: create it below
  }
  if (!folderId) {
    const created = await executeTool("GOOGLEDRIVE_CREATE_FOLDER", { name: BACKUP_FOLDER_NAME });
    folderId = driveIdOf(created);
    if (!folderId) throw new Error(`Couldn't create the Drive folder: ${created.slice(0, 200)}`);
  }
  setSetting(BACKUP_FOLDER_KEY, folderId);
  return folderId;
}

const dotFolderLocks = new Map<string, Promise<string>>();

/** False only when Drive says the folder is gone or in the Bin; any other hiccup keeps the saved folder. */
async function driveFolderAlive(folderId: string): Promise<boolean> {
  try {
    const out = await executeTool("GOOGLEDRIVE_GET_FILE_METADATA", { fileId: folderId, fields: "id,trashed" });
    if (/"trashed"\s*:\s*true/i.test(out)) return false;
    if (/not\s*found|404/i.test(out) && !driveIdOf(out)) return false;
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return !/not\s*found|404/i.test(msg);
  }
}

/** "QDot Uploads/<dot name>": one Drive folder per dot, remembered by id so renaming a dot keeps its files together. */
async function ensureDotFolder(dotId: string): Promise<string> {
  const root = await ensureBackupFolder();
  const key = `drive_dot_folder:${dotId}`;
  const saved = getSetting(key);
  if (saved && (await driveFolderAlive(saved))) return saved;
  const pending = dotFolderLocks.get(dotId);
  if (pending) return pending;
  const job = (async () => {
    try {
      const row = db().prepare("SELECT name FROM dots WHERE id = ?").get(dotId) as { name: string } | undefined;
      const name = (row?.name || "Dot").replace(/[\\/:*?"<>|]/g, "-").trim() || "Dot";
      const created = await executeTool("GOOGLEDRIVE_CREATE_FOLDER", { name, parent_id: root });
      const folderId = driveIdOf(created);
      if (!folderId) throw new Error(created.slice(0, 200));
      setSetting(key, folderId);
      return folderId;
    } catch (err) {
      console.warn("[files] Couldn't create the dot's Drive folder, using the main folder:", err instanceof Error ? err.message : err);
      return root;
    } finally {
      dotFolderLocks.delete(dotId);
    }
  })();
  dotFolderLocks.set(dotId, job);
  return job;
}

/** Copy an attachment into its dot's folder inside "QDot Uploads" in Google Drive, using a temporary link Drive can fetch. */
export async function backupToDrive(fileId: string): Promise<boolean> {
  if (backingUp.has(fileId)) return false;
  const f = get(fileId);
  if (!f || f.driveFileId || !composioSignedIn() || !isGoogleDriveConnected()) return false;
  backingUp.add(fileId);
  try {
    const folder = await ensureDotFolder(f.dotId);
    const { token } = createStoredFileToken(fileId, 15 * 60_000);
    const url = `${getAppUrl()}/api/public-files/${token}`;
    const out = await withTimeout(
      executeTool("GOOGLEDRIVE_UPLOAD_FROM_URL", { source_url: url, name: f.name, mime_type: f.mime, parent_folder_id: folder }),
      120_000,
      "Google Drive took too long to fetch the file.",
    );
    const newId = driveIdOf(out);
    if (!newId || /"successful"\s*:\s*false/i.test(out)) throw new Error(`Drive did not confirm the upload: ${out.slice(0, 200)}`);
    db().prepare("UPDATE files SET drive_file_id = ? WHERE id = ?").run(newId, fileId);
    return true;
  } catch (err) {
    console.warn(`[files] Drive backup of ${f.name} failed:`, err instanceof Error ? err.message : err);
    return false;
  } finally {
    backingUp.delete(fileId);
  }
}

/** Delete the server copy of files that are safely in Drive and older than a week. Never touches files without a Drive copy. */
export async function reclaimBackedUp(): Promise<number> {
  const rows = db().prepare("SELECT id FROM files WHERE drive_file_id IS NOT NULL AND created_at < ?").all(Date.now() - RETENTION_MS) as { id: string }[];
  let removed = 0;
  for (const { id: fid } of rows) {
    const f = get(fid);
    const p = path.join(DIR, fid);
    if (!f || !fs.existsSync(p)) continue;
    try {
      fs.unlinkSync(p);
      removed++;
    } catch {
      continue;
    }
    if (f.dotId && f.name) await computer.runCommand(f.dotId, `rm -f "uploads/${f.name}"`).catch(() => null);
  }
  return removed;
}

/** Every 15 minutes: retry backups that failed, then clear out server copies that are old and backed up. */
export function startFileMaintenance() {
  const tick = async () => {
    try {
      if (composioSignedIn() && isGoogleDriveConnected()) {
        const pending = db()
          .prepare("SELECT id FROM files WHERE drive_file_id IS NULL AND source = 'user' AND created_at > ? ORDER BY created_at LIMIT 3")
          .all(Date.now() - RETENTION_MS) as { id: string }[];
        for (const r of pending) await backupToDrive(r.id);
      }
      const removed = await reclaimBackedUp();
      if (removed) console.log(`[files] Removed ${removed} server copies that were already backed up to Drive`);
    } catch (err) {
      console.warn("[files] maintenance failed:", err);
    }
  };
  setTimeout(() => void tick(), 30_000);
  setInterval(() => void tick(), 15 * 60_000);
}

export type DriveQuota = { limit: number | null; usage: number; usageInDrive: number; usageInTrash: number };
let quotaCache: { at: number; value: DriveQuota } | null = null;

/** The user's real Google Drive storage (bytes), read through Composio. Cached for a minute. */
export async function getDriveQuota(): Promise<DriveQuota> {
  if (quotaCache && Date.now() - quotaCache.at < 60_000) return quotaCache.value;
  let out = await withTimeout(callExecute({ fields: "storageQuota" }), 45_000, "Google Drive took too long to answer.");
  if (!/"usage"/i.test(out)) out = await withTimeout(callExecute({}), 45_000, "Google Drive took too long to answer.");
  const num = (key: string): number | null => {
    const m = out.match(new RegExp(`"${key}"\\s*:\\s*"?(\\d+)"?`, "i"));
    return m ? Number(m[1]) : null;
  };
  const usage = num("usage");
  if (usage === null) throw new Error(`Couldn't read Drive storage: ${out.slice(0, 200)}`);
  const value: DriveQuota = { limit: num("limit"), usage, usageInDrive: num("usageInDrive") ?? 0, usageInTrash: num("usageInDriveTrash") ?? 0 };
  quotaCache = { at: Date.now(), value };
  return value;
}

function callExecute(args: Record<string, unknown>) {
  return executeTool("GOOGLEDRIVE_GET_ABOUT", args);
}

export function isGoogleDriveConnected(): boolean {
  if (!composioSignedIn()) return false;
  try {
    const list = composioApps();
    return list.some(
      (a) =>
        (a.slug.toLowerCase().includes("googledrive") ||
          a.slug.toLowerCase().includes("google_drive") ||
          a.name.toLowerCase().includes("drive")) &&
        a.connected
    );
  } catch {
    return false;
  }
}

