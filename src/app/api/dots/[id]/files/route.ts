import { MAX_UPLOAD, upload, DriveNotConnectedError } from "@/server/files";

// The user attaches files in chat. Returns the stored attachments.
export async function POST(req: Request, ctx: RouteContext<"/api/dots/[id]/files">) {
  const { id } = await ctx.params;
  const form = await req.formData();
  const out = [];
  for (const entry of form.getAll("file")) {
    if (!(entry instanceof File)) continue;
    if (entry.size > MAX_UPLOAD) return Response.json({ error: `${entry.name} is over 25 MB.` }, { status: 413 });
    try {
      const f = await upload(id, entry.name, entry.type, Buffer.from(await entry.arrayBuffer()));
      out.push({ id: f.id, name: f.name, mime: f.mime, size: f.size });
    } catch (err) {
      if (err instanceof DriveNotConnectedError) {
        return Response.json({ error: "DRIVE_NOT_CONNECTED" }, { status: 402 });
      }
      console.error("[files] upload failed:", err);
      return Response.json({ error: err instanceof Error ? err.message : "Upload failed." }, { status: 500 });
    }
  }
  return Response.json({ files: out });
}
