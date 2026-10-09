import * as computer from "@/server/computer";
import { mimeForPath, verifyFileToken } from "@/server/links";
import { get as getStoredFile, readContent } from "@/server/files";

// A short-lived, signed link to one workspace file. No login: the signature and expiry are the access control.
const MAX_BYTES = 100 * 1024 * 1024;

async function load(token: string) {
  const link = verifyFileToken(token);
  if (!link) return null;
  if (link.kind === "stored") {
    const f = getStoredFile(link.fileId);
    // the server copy may be gone after the 7-day cleanup: readContent falls back to the Drive backup
    const data = f ? await readContent(link.fileId) : null;
    if (!f || !data || !data.length || data.length > MAX_BYTES) return null;
    return { data, name: f.name, mime: f.mime || mimeForPath(f.name) };
  }
  const data = await computer.readFile(link.dotId, link.path).catch(() => null);
  if (!data || data.length > MAX_BYTES) return null;
  return { data, name: link.path.split("/").pop() ?? "file", mime: mimeForPath(link.path) };
}

function headers(f: { data: Buffer; name: string; mime: string }) {
  return {
    "Content-Type": f.mime,
    "Content-Length": String(f.data.length),
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "X-Content-Type-Options": "nosniff",
  };
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const f = await load(token);
  if (!f) return new Response("This link has expired or is not valid.", { status: 404 });
  return new Response(new Uint8Array(f.data), { headers: headers(f) });
}

export async function HEAD(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const f = await load(token);
  if (!f) return new Response(null, { status: 404 });
  return new Response(null, { headers: headers(f) });
}
