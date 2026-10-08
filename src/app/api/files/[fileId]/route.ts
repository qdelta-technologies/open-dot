import { get, fetchFromDrive } from "@/server/files";

// Download or preview a file. Images/PDFs render inline; `?download=1` forces a download.
export async function GET(req: Request, ctx: RouteContext<"/api/files/[fileId]">) {
  const { fileId } = await ctx.params;
  const f = get(fileId);
  if (!f) return new Response("Not found", { status: 404 });

  let buf = f.data();
  if (!buf.length && f.driveFileId) {
    // the server copy was cleaned up after the Drive backup: fetch it from Drive
    try {
      buf = await fetchFromDrive(f.driveFileId);
    } catch (err) {
      console.error("[files] Failed to fetch from Google Drive:", err);
      return new Response("Failed to retrieve file from Google Drive", { status: 502 });
    }
  }

  const inline = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)$/.test(f.mime) && new URL(req.url).searchParams.get("download") !== "1";
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": f.mime,
      "Content-Length": String(buf.byteLength),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
