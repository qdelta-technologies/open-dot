import "server-only";
import crypto from "node:crypto";

// Short-lived download links for files in a dot's workspace, so outside services (Google Drive, Instagram, ...)
// can fetch a file by web address without a login. A link is signed, expires, and covers exactly one file.

const DEFAULT_TTL_MS = 10 * 60_000;

function secret(): string {
  return process.env.VAULT_KEY || process.env.ACCESS_PASSWORD || "qdot-dev-link-secret";
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** True for a plain relative path inside the workspace. */
export function isSafeWorkspacePath(p: string): boolean {
  if (!p || p.startsWith("/") || p.startsWith("\\") || /^[A-Za-z]:/.test(p)) return false;
  return !p.split(/[\\/]+/).some((seg) => seg === ".." || seg === "");
}

export function createFileToken(dotId: string, path: string, ttlMs = DEFAULT_TTL_MS): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + ttlMs;
  const payload = b64(JSON.stringify({ d: dotId, p: path, e: expiresAt }));
  return { token: `${payload}.${sign(payload)}`, expiresAt };
}

export function verifyFileToken(token: string): { dotId: string; path: string } | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { d, p, e } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { d: string; p: string; e: number };
    if (typeof d !== "string" || typeof p !== "string" || typeof e !== "number" || Date.now() > e) return null;
    if (!isSafeWorkspacePath(p)) return null;
    return { dotId: d, path: p };
  } catch {
    return null;
  }
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
  zip: "application/zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export const mimeForPath = (p: string) => MIME[p.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
