import "server-only";
import fs from "node:fs";
import path from "node:path";
import { db, DATA_DIR, id } from "./db";
import * as computer from "./computer";
import { apps as composioApps, signedIn as composioSignedIn } from "./composio";
import type { Attachment } from "@/lib/types";

// Files that move between the user and a dot. The canonical copy lives in .data/files/<id>
// (for previews and downloads); a working copy goes into the dot's computer so it can use it.

const DIR = path.join(DATA_DIR, "files");
export const MAX_UPLOAD = 25 * 1024 * 1024;

type Row = { id: string; dot_id: string; name: string; mime: string; size: number; source: string; box_path: string | null; created_at: number };

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

function save(dotId: string, name: string, mime: string, data: Buffer, source: "user" | "dot", boxPath: string | null): Attachment {
  fs.mkdirSync(DIR, { recursive: true });
  const fileId = id("file");
  fs.writeFileSync(path.join(DIR, fileId), data);
  db()
    .prepare("INSERT INTO files (id, dot_id, name, mime, size, source, box_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(fileId, dotId, name, mime, data.length, source, boxPath, Date.now());
  return { id: fileId, name, mime, size: data.length };
}

/** The user attached a file: store it and put a copy in the dot's workspace under uploads/. */
export async function upload(dotId: string, name: string, mime: string, data: Buffer): Promise<Attachment & { boxPath: string }> {
  const clean = safeName(name);
  const boxPath = await computer.writeFile(dotId, `uploads/${clean}`, data);
  return { ...save(dotId, clean, mime || guessMime(clean), data, "user", boxPath), boxPath };
}

/** The dot shares a file from its computer with the user. */
export async function shareFromComputer(dotId: string, p: string): Promise<Attachment> {
  const data = await computer.readFile(dotId, p);
  if (data.length > MAX_UPLOAD * 4) throw new Error("That file is too large to share (over 100 MB).");
  const name = safeName(path.basename(p));
  return save(dotId, name, guessMime(name), data, "dot", p);
}

export function get(fileId: string): (Attachment & { dotId: string; boxPath: string | null; data: () => Buffer }) | null {
  const r = db().prepare("SELECT * FROM files WHERE id = ?").get(fileId) as Row | undefined;
  if (!r) return null;
  return {
    id: r.id, name: r.name, mime: r.mime, size: r.size, dotId: r.dot_id, boxPath: r.box_path,
    data: () => fs.readFileSync(path.join(DIR, r.id)),
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

/** Get disk usage summary vs Railway 500 MB limit. */
export function getStorageStats(): {
  totalFiles: number;
  totalBytes: number;
  railwayLimitBytes: number;
  percentUsed: number;
} {
  try {
    const r = db()
      .prepare("SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as total_size FROM files")
      .get() as { count: number; total_size: number } | undefined;
    const totalFiles = r?.count ?? 0;
    const totalBytes = Number(r?.total_size ?? 0);
    const railwayLimitBytes = 500 * 1024 * 1024; // 500 MB container disk limit
    const percentUsed = Math.min(100, Math.round((totalBytes / railwayLimitBytes) * 100));
    return { totalFiles, totalBytes, railwayLimitBytes, percentUsed };
  } catch {
    return { totalFiles: 0, totalBytes: 0, railwayLimitBytes: 500 * 1024 * 1024, percentUsed: 0 };
  }
}

/** Check if user has connected Google Drive via Composio. */
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

