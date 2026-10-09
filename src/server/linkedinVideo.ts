import "server-only";
import { executeTool, runWorkbench } from "./composio";

// Posting a video to LinkedIn. Composio's ready-made LinkedIn tools only cover text and images, so this runs LinkedIn's own
// video steps (announce the upload, send the bytes in pieces, finish it, create the post) through Composio's workbench,
// which sends the requests as the connected LinkedIn account. Every step is reported so a failure shows exactly where.

const MAX_BYTES = 200 * 1024 * 1024;

const SCRIPT = String.raw`
import requests, json, inspect, re, sys

URL = __URL__
TEXT = __TEXT__
AUTHOR = __AUTHOR__
TITLE = __TITLE__
VERSIONS = ["202510", "202509", "202506", "202504", "202411"]

def say(step, msg):
    print("QDOT_STEP", step, msg, flush=True)

def px(method, endpoint, body=None, headers=None, query=None):
    sig = inspect.signature(proxy_execute).parameters
    kw = dict(method=method, endpoint=endpoint, toolkit="linkedin")
    if body is not None:
        kw["body"] = body
    if query:
        kw["query_params"] = query
    if headers:
        if "headers" in sig:
            kw["headers"] = headers
        else:
            for pname in ("parameters", "params"):
                if pname in sig:
                    kw[pname] = [{"name": k, "value": v, "type": "header"} for k, v in headers.items()]
                    break
    return proxy_execute(**kw)

def unpack(res):
    # proxy_execute may return (data, error) or a single object; keep both readable
    if isinstance(res, tuple) and len(res) == 2:
        return res[0], res[1]
    return res, None

def as_dict(x):
    if isinstance(x, dict):
        for k in ("data", "response", "body"):
            if isinstance(x.get(k), dict):
                inner = x[k]
                if "value" in inner or "id" in inner or "uploadInstructions" in json.dumps(inner)[:400]:
                    return inner
        return x
    try:
        return json.loads(x)
    except Exception:
        return {}

say(0, "helper signature: " + str(inspect.signature(proxy_execute)))

r = requests.get(URL, timeout=120)
r.raise_for_status()
data = r.content
size = len(data)
say(1, "fetched the video: %d bytes" % size)

init = None
used = None
for v in VERSIONS:
    hdr = {"LinkedIn-Version": v, "X-Restli-Protocol-Version": "2.0.0", "Content-Type": "application/json"}
    res = px("POST", "/rest/videos?action=initializeUpload",
             {"initializeUploadRequest": {"owner": AUTHOR, "fileSizeBytes": size, "uploadCaptions": False, "uploadThumbnail": False}}, hdr)
    out, err = unpack(res)
    txt = json.dumps(out, default=str) if not isinstance(out, str) else out
    if "uploadInstructions" in txt:
        init, used = as_dict(out), v
        break
    say(2, "version %s did not work: %s %s" % (v, txt[:300], err or ""))
    if not re.search(r"version|426|NONEXISTENT", txt + str(err), re.I):
        break
if not init:
    say("STOP", "could not start the LinkedIn video upload")
    sys.exit(0)

value = init.get("value", init)
video_urn = value.get("video")
token = value.get("uploadToken", "")
parts = value.get("uploadInstructions", [])
say(2, "upload started with API version %s: %s, %d part(s)" % (used, video_urn, len(parts)))

etags = []
for i, p in enumerate(parts):
    chunk = data[p["firstByte"]: p["lastByte"] + 1]
    pr = requests.put(p["uploadUrl"], data=chunk, headers={"Content-Type": "application/octet-stream"}, timeout=300)
    if pr.status_code >= 300:
        say("STOP", "sending part %d failed: %s %s" % (i + 1, pr.status_code, pr.text[:200]))
        sys.exit(0)
    etags.append(pr.headers.get("etag", "").strip('"'))
say(3, "sent %d part(s)" % len(etags))

hdr = {"LinkedIn-Version": used, "X-Restli-Protocol-Version": "2.0.0", "Content-Type": "application/json"}
res = px("POST", "/rest/videos?action=finalizeUpload",
         {"finalizeUploadRequest": {"video": video_urn, "uploadToken": token, "uploadedPartIds": etags}}, hdr)
out, err = unpack(res)
say(4, "finished the upload: " + (json.dumps(out, default=str)[:300] if not isinstance(out, str) else out[:300]) + (" " + str(err) if err else ""))

post = {
    "author": AUTHOR,
    "commentary": TEXT,
    "visibility": "PUBLIC",
    "distribution": {"feedDistribution": "MAIN_FEED", "targetEntities": [], "thirdPartyDistributionChannels": []},
    "content": {"media": ({"title": TITLE, "id": video_urn} if TITLE else {"id": video_urn})},
    "lifecycleState": "PUBLISHED",
    "isReshareDisabledByAuthor": False,
}
res = px("POST", "/rest/posts", post, hdr)
out, err = unpack(res)
txt = json.dumps(out, default=str) if not isinstance(out, str) else out
say(5, "created the post: " + txt[:600] + (" " + str(err) if err else ""))
m = re.search(r"urn:li:(?:share|ugcPost):\d+", txt)
if not m and not err:
    # LinkedIn answers a created post with an empty body and puts its id in a header, so look the post up
    import time
    time.sleep(4)
    ghdr = {"LinkedIn-Version": used, "X-Restli-Protocol-Version": "2.0.0"}
    for author_q in (AUTHOR, AUTHOR.replace(":", "%3A")):
        res = px("GET", "/rest/posts", None, ghdr, {"author": author_q, "q": "author", "count": "10", "sortBy": "LAST_MODIFIED"})
        out, err2 = unpack(res)
        d = as_dict(out)
        found = None
        for el in (d.get("elements") or []):
            if el.get("commentary") == TEXT:
                found = el
                break
        if found:
            m = re.search(r"urn:li:(?:share|ugcPost):\d+", json.dumps(found))
            say(6, "found the new post: " + str(found.get("id") or ""))
            break
        say(6, "post lookup found nothing yet: " + (json.dumps(out, default=str)[:300] if not isinstance(out, str) else out[:300]) + (" " + str(err2) if err2 else ""))
if m:
    say("DONE", "https://www.linkedin.com/feed/update/" + m.group(0))
elif not err:
    say("ACCEPTED", "LinkedIn accepted the post (no error), but its link could not be read back")
`;

export type LinkedInVideoResult = { ok: boolean; link: string | null; log: string };

/** The signed-in LinkedIn member as a person URN, read through the same connection. */
async function authorUrn(): Promise<string | null> {
  for (const slug of ["LINKEDIN_GET_MY_INFO", "LINKEDIN_GET_USER_INFO"]) {
    try {
      const out = await executeTool(slug, {});
      const urn = out.match(/urn:li:person:[A-Za-z0-9_-]+/)?.[0];
      if (urn) return urn;
      const id = out.match(/"(?:sub|id)"\s*:\s*"([A-Za-z0-9_-]{6,})"/)?.[1];
      if (id) return `urn:li:person:${id}`;
    } catch {
      // try the next one
    }
  }
  return null;
}

export async function postVideo(url: string, text: string, title: string, size: number): Promise<LinkedInVideoResult> {
  if (size > MAX_BYTES) return { ok: false, link: null, log: `That video is ${(size / 1048576).toFixed(0)} MB. The limit here is ${MAX_BYTES / 1048576} MB.` };
  const author = await authorUrn();
  if (!author) return { ok: false, link: null, log: "Couldn't read the LinkedIn member id for the connected account." };
  const code = SCRIPT.replace("__URL__", JSON.stringify(url))
    .replace("__TEXT__", JSON.stringify(text))
    .replace("__AUTHOR__", JSON.stringify(author))
    .replace("__TITLE__", JSON.stringify(title));
  const raw = await runWorkbench(code, "QDot is posting a video to LinkedIn");
  const lines = raw.split("\n").filter((l) => l.includes("QDOT_STEP") || /error|traceback|exception/i.test(l));
  const log = (lines.join("\n") || raw).slice(0, 3000);
  const link = raw.match(/QDOT_STEP DONE (https:\/\/www\.linkedin\.com\/feed\/update\/\S+)/)?.[1] ?? null;
  const accepted = raw.includes("QDOT_STEP ACCEPTED");
  return {
    ok: Boolean(link) || accepted,
    link,
    log:
      accepted && !link
        ? "The video post was published on LinkedIn. LinkedIn does not let this connection read posts back (a 403 permission limit), so there is no direct link. Tell the user to open their LinkedIn profile, Posts, to see it."
        : log,
  };
}
