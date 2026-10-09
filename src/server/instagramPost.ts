import "server-only";
import { executeTool } from "./composio";

// Posting a photo or a Reel to Instagram through Composio's Instagram tools: make a media container from a public link to the
// file, wait until Instagram has processed it, then publish it. Needs an Instagram Business or Creator account.

export type InstagramResult = { ok: boolean; link: string | null; message: string };

const IMAGE_TYPES = /^image\/(jpeg|png)$/i;
const VIDEO_TYPES = /^video\/(mp4|quicktime)$/i;
const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_VIDEO = 100 * 1024 * 1024;

const failed = (out: string) => /"successful"\s*:\s*false|^Error:/i.test(out.trim().slice(0, 300));
const idIn = (out: string) => out.match(/"id"\s*:\s*"?(\d{8,})"?/)?.[1] ?? null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const brief = (out: string) => out.replace(/\s+/g, " ").slice(0, 300);

export async function postInstagram(url: string, caption: string, kind: "photo" | "reel", mime: string, size: number): Promise<InstagramResult> {
  if (kind === "photo" && !IMAGE_TYPES.test(mime)) return { ok: false, link: null, message: `Instagram photos must be JPG or PNG, and this file is ${mime || "unknown"}. WebP is not accepted.` };
  if (kind === "reel" && !VIDEO_TYPES.test(mime)) return { ok: false, link: null, message: `Instagram videos must be MP4 or MOV, and this file is ${mime || "unknown"}.` };
  if (kind === "photo" && size > MAX_IMAGE) return { ok: false, link: null, message: `That photo is ${(size / 1048576).toFixed(1)} MB. Instagram's limit is 8 MB.` };
  if (kind === "reel" && size > MAX_VIDEO) return { ok: false, link: null, message: `That video is ${(size / 1048576).toFixed(0)} MB. The limit here is 100 MB.` };
  if (caption.length > 2200) return { ok: false, link: null, message: "The caption is longer than Instagram's 2,200 character limit." };

  const created = await executeTool("INSTAGRAM_CREATE_MEDIA_CONTAINER", {
    content_type: kind,
    caption,
    ...(kind === "photo" ? { image_url: url } : { video_url: url, share_to_feed: true }),
  });
  const creationId = failed(created) ? null : idIn(created);
  if (!creationId)
    return { ok: false, link: null, message: `Instagram would not accept the file. Check that the account is a Business or Creator account. Details: ${brief(created)}` };

  // Instagram fetches and processes the file; a Reel takes a while.
  const deadline = Date.now() + (kind === "reel" ? 4 * 60_000 : 60_000);
  let ready = false;
  let last = "";
  while (Date.now() < deadline) {
    await sleep(kind === "reel" ? 6000 : 3000);
    last = await executeTool("INSTAGRAM_GET_POST_STATUS", { creation_id: creationId });
    if (/FINISHED|PUBLISHED/i.test(last) && !/ERROR/i.test(last)) {
      ready = true;
      break;
    }
    if (/"status_code"\s*:\s*"?(ERROR|EXPIRED)/i.test(last)) return { ok: false, link: null, message: `Instagram could not process the file: ${brief(last)}` };
  }
  if (!ready) return { ok: false, link: null, message: `Instagram is still processing the file, so it was NOT published. Try again in a few minutes. Last status: ${brief(last)}` };

  let igUserId = "me";
  try {
    const me = await executeTool("INSTAGRAM_GET_USER_INFO", {});
    igUserId = idIn(me) ?? "me";
  } catch {
    // "me" is accepted by the publish tool
  }
  const published = await executeTool("INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH", { ig_user_id: igUserId, creation_id: creationId });
  const mediaId = failed(published) ? null : idIn(published);
  if (!mediaId) return { ok: false, link: null, message: `Instagram did not confirm the post, so assume it was NOT published. Details: ${brief(published)}` };

  let link: string | null = null;
  try {
    const info = await executeTool("INSTAGRAM_GET_IG_MEDIA", { ig_media_id: mediaId, fields: "permalink" });
    link = info.match(/https:\/\/www\.instagram\.com\/[^"\s\\]+/)?.[0] ?? null;
  } catch {
    // the link is a nice-to-have
  }
  return { ok: true, link, message: link ? `Published on Instagram: ${link}` : "Published on Instagram. The direct link could not be read back, so open your profile to see it." };
}
