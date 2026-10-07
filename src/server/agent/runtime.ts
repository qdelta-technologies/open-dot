import "server-only";
import type {
  ResponseComputerToolCall, ResponseFunctionToolCall, ResponseInputContent, ResponseInputItem, Response, Tool,
} from "openai/resources/responses/responses";
import { clientFor, isReasoningModel, modelFor, supportsComputerTool } from "./client";
import { needsCompat, responsesStreamCompat, responsesCompat } from "./compat";
import { isGroqModel } from "./groq";
import { cloudflareForUrl, cloudflareWorkerUrl, cloudflareWorkerUrls, getAvailableWorkerUrls, isCloudflareModel, markWorkerExhausted } from "./cloudflare";
import { systemPrompt, type Trigger } from "./prompt";
import { COMPUTER_ENABLED, findTool, setConsult, toolsForDot, type ToolCtx } from "./tools";
import { review } from "./review";
import * as repo from "../repo";
import * as computer from "../computer";
import type { ComputerAction } from "../computer/browser";
import { emit } from "../bus";
import * as composio from "../composio";
import type { AppTrigger, Attachment, CardData, Dot, Routine } from "@/lib/types";
import * as files from "../files";
import { extractText } from "unpdf";

type Call = ResponseFunctionToolCall | ResponseComputerToolCall;
type Pending = {
  responseId: string;
  calls: Call[];
  outputs: ResponseInputItem[];
  index: number; // next call to process
  cardId: string | null; // card the run is waiting on
  trigger: Trigger;
};
type InboxItem = { text: string; trigger: Trigger; conversationId: string; attachments?: Attachment[] };
// `after`: work queued while the dot was busy (e.g. an approval answered in another conversation).
type RunState = { running: boolean; abort: AbortController | null; inbox: InboxItem[]; after: (() => void)[] };

const MAX_STEPS = 60;
const g = globalThis as unknown as { __dotsRuns?: Map<string, RunState> };
const runs = (g.__dotsRuns ??= new Map());
const state = (dotId: string): RunState => {
  let s = runs.get(dotId);
  if (!s) runs.set(dotId, (s = { running: false, abort: null, inbox: [], after: [] }));
  s.after ??= [];
  return s;
};

// ---------------------------------------------------------------- public API

export function sendMessage(dotId: string, text: string, attachments: Attachment[] = [], conversationId?: string) {
  const dot = repo.getDot(dotId);
  if (!dot) throw new Error("No such dot");
  const conv = conversationId ?? repo.latestConversationId(dotId);
  repo.addMessage({ dotId, role: "user", text, attachments, conversationId: conv });
  if (dot.status === "paused") {
    repo.addMessage({ dotId, role: "system", text: `${dot.name} is paused. Resume it to pick this up.`, conversationId: conv });
  }
  state(dotId).inbox.push({ text, trigger: { kind: "chat" }, attachments, conversationId: conv });
  void pump(dotId);
}

/** Work handed off from a voice call. The user's words are already in the chat as voice lines, so no extra user message. */
export function queueTask(dotId: string, text: string, conversationId: string) {
  const dot = repo.getDot(dotId);
  if (!dot) throw new Error("No such dot");
  repo.addMessage({ dotId, role: "activity", text: `Voice task · ${text}`, conversationId, channelId: null });
  if (dot.status === "paused") repo.addMessage({ dotId, role: "system", text: `${dot.name} is paused. Resume it to pick this up.`, conversationId });
  state(dotId).inbox.push({ text: `${text}\n\n(Asked on a voice call.)`, trigger: { kind: "chat" }, conversationId });
  void pump(dotId);
}

/** The user posts in a channel: mentioned dots answer (@Name); otherwise the lead does, delegating as needed. */
export function sendToChannel(channelId: string, text: string) {
  const ch = repo.getChannel(channelId);
  if (!ch) throw new Error("No such channel");
  repo.addMessage({ dotId: ch.leadId, role: "user", text, channelId });
  const members = ch.memberIds.map((id) => repo.getDot(id)).filter((d): d is Dot => Boolean(d));
  const mentioned = members.filter((d) => new RegExp(`@${d.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
  const responders = mentioned.length ? mentioned : members.filter((d) => d.id === ch.leadId);
  for (const d of responders) {
    if (d.status === "paused") {
      repo.addMessage({ dotId: d.id, role: "system", text: `${d.name} is paused.`, channelId });
      continue;
    }
    state(d.id).inbox.push({
      text: `[#${ch.name}] ${text}`,
      trigger: { kind: "channel", channelId, name: ch.name },
      conversationId: repo.workConversation(d.id, "channel", channelId, `#${ch.name}`),
    });
    void pump(d.id);
  }
}

export function runRoutine(routine: Routine) {
  const dot = repo.getDot(routine.dotId);
  if (!dot || dot.status === "paused" || !routine.enabled) return;
  // Each routine keeps its own conversation, so its runs read like a log you can open any time.
  const conv = repo.workConversation(dot.id, "chat", `routine:${routine.id}`, `Routine · ${routine.name}`);
  repo.addMessage({ dotId: dot.id, role: "system", text: `Routine "${routine.name}" started`, from: `routine:${routine.name}`, conversationId: conv });
  state(dot.id).inbox.push({ text: `[Routine: ${routine.name}] ${routine.instruction}`, trigger: { kind: "routine", name: routine.name }, conversationId: conv });
  void pump(dot.id).then(() => {
    repo.updateRoutine(routine.id, { lastRunAt: Date.now(), lastError: null });
  }).catch((err: unknown) => {
    repo.updateRoutine(routine.id, { lastRunAt: Date.now(), lastError: err instanceof Error ? err.message : String(err) });
  });
}

/** A Composio trigger fired: run its dot on the instruction, in the trigger's own chat, from a fresh context. */
export function runTrigger(t: AppTrigger, event: Record<string, unknown>) {
  const dot = repo.getDot(t.dotId);
  if (!dot || dot.status === "paused" || !t.enabled) return;
  const conv = repo.workConversation(dot.id, "chat", `trigger:${t.id}`, `Trigger · ${t.name}`);
  repo.addMessage({ dotId: dot.id, role: "system", text: `Trigger "${t.name}" fired`, from: `trigger:${t.name}`, conversationId: conv });
  const data = JSON.stringify(event, null, 1).slice(0, 6000);
  state(dot.id).inbox.push({ text: `[Trigger: ${t.name}] ${t.instruction}\n\nWhat happened (${t.toolkit} event data):\n${data}`, trigger: { kind: "trigger", name: t.name }, conversationId: conv });
  void pump(dot.id);
}

export function stop(dotId: string) {
  const s = state(dotId);
  s.inbox = [];
  s.abort?.abort();
  repo.setActivity(dotId, null);
  const dot = repo.getDot(dotId);
  if (dot && dot.status === "working") {
    repo.updateDot(dotId, { status: repo.pendingCards(dotId).length ? "waiting" : "idle" });
    repo.addMessage({ dotId, role: "system", text: `${dot.name} was stopped.` });
  }
}

export function pause(dotId: string) {
  const dot = repo.getDot(dotId);
  if (!dot || dot.status === "paused") return;
  repo.updateDot(dotId, { status: "paused" });
  state(dotId).abort?.abort();
  repo.addMessage({ dotId, role: "system", text: `Paused. Any ongoing work was stopped, and ${dot.name} won't message you until you resume it.` });
  void computer.sleep(dotId).catch(() => {}); // its computer sleeps too (cloud boxes keep their state)
}

export function resume(dotId: string) {
  const dot = repo.getDot(dotId);
  if (!dot || dot.status !== "paused") return;
  const waiting = repo.pendingCards(dotId).length > 0;
  repo.updateDot(dotId, { status: waiting ? "waiting" : "idle" });
  repo.addMessage({ dotId, role: "system", text: `${dot.name} resumed.` });
  void pump(dotId);
}

/** The user answered a card: approve / deny / always allow an action, or answer a question. */
export async function resolveCard(messageId: string, choice: "approve" | "deny" | "always" | "answer", answer?: string) {
  const msg = repo.getMessage(messageId);
  const card = msg?.card;
  if (!msg || !card || card.status !== "pending") return;
  const dot = repo.getDot(msg.dotId);
  if (!dot || dot.status === "paused") return;

  const approved = choice === "approve" || choice === "always";
  const status: CardData["status"] = choice === "answer" ? "answered" : approved ? "approved" : "denied";
  repo.updateMessage(messageId, { card: { ...card, status, answer } });
  if (choice === "always" && card.ruleAction) repo.addRule({ dotId: dot.id, action: card.ruleAction, decision: "allow" });

  const convId = msg.conversationId ?? repo.latestConversationId(dot.id);
  const pending = parsePending(repo.threadOf(convId).pending);
  if (!pending || pending.cardId !== messageId) return;

  await withRun(dot.id, async (signal) => {
    repo.routeToConversation(dot.id, convId);
    repo.routeToChannel(dot.id, pending.trigger.kind === "channel" ? pending.trigger.channelId : null);
    const call = pending.calls[pending.index];
    pending.cardId = null;
    if (call.type === "computer_call") {
      if (!approved) {
        // Can't return a computer_call_output without acknowledging the checks; restart the thread instead.
        repo.setThread(dot.id, null, null);
        await turn(dot.id, `(I denied the on-screen action you asked about: ${card.detail ?? card.title}. Don't do it.)`, pending.trigger, signal, [], convId);
        return;
      }
      pending.outputs.push(await execComputer(dot, call, call.pending_safety_checks));
    } else {
      const def = findTool(call.name);
      let output: string;
      if (def?.pause === "question") output = `The user answered: ${answer ?? ""}`;
      else if (def?.pause === "approval") output = approved ? "The user approved. Go ahead." : "The user denied this. Do not do it; tell them briefly what you'll do instead, if anything.";
      else if (def?.pause === "connect") output = approved ? "Connected. Continue with the task." : "The user chose not to connect this app right now. Continue without it or tell them what you need.";
      else if (approved && def?.execute) output = await execTool(dot, call, signal);
      else output = "The user denied this action. Don't retry it; continue without it or ask what they'd prefer.";
      pending.outputs.push({ type: "function_call_output", call_id: call.call_id, output });
    }
    pending.index++;
    if (await processCalls(dot, pending, signal)) return;
    await drive(dot, pending.responseId, pending.outputs, pending.trigger, signal);
  });
}

// ---------------------------------------------------------------- run loop

async function pump(dotId: string) {
  const s = state(dotId);
  if (s.running) return;
  const dot = repo.getDot(dotId);
  if (!dot || dot.status === "paused" || !s.inbox.length) return;
  // Batch only items bound for the same place: a channel's messages go back to that channel.
  const where = (i: InboxItem) => (i.trigger.kind === "channel" ? `channel:${i.trigger.channelId}` : `conv:${i.conversationId}`);
  const head = where(s.inbox[0]);
  let n = 0;
  while (n < s.inbox.length && where(s.inbox[n]) === head) n++;
  const batch = s.inbox.splice(0, n);
  const trigger = batch.find((b) => b.trigger.kind === "chat")?.trigger ?? batch[batch.length - 1].trigger;
  const attachments = batch.flatMap((b) => b.attachments ?? []);
  const conversationId = batch[0].conversationId;
  let text = batch.map((b) => b.text).join("\n\n");
  // Catch the text agent up on anything said on a voice call in this chat.
  const voice = conversationId ? repo.takeVoiceTranscript(conversationId, dot.name) : "";
  if (voice) text = `[Voice call in this chat since your last turn — you (on the call) and the user said:]\n${voice}\n\n[Now:]\n${text}`;
  await withRun(dotId, (signal) => turn(dotId, text, trigger, signal, attachments, conversationId));
}

async function withRun(dotId: string, fn: (signal: AbortSignal) => Promise<void>) {
  const s = state(dotId);
  if (s.running) {
    s.after.push(() => void withRun(dotId, fn)); // e.g. an approval answered in another conversation
    return;
  }
  s.running = true;
  s.abort = new AbortController();
  const startedAt = Date.now();
  repo.updateDot(dotId, { status: "working" });
  try {
    await fn(s.abort.signal);
  } catch (err) {
    if (!s.abort.signal.aborted) {
      console.error("[dots] run failed", err);
      const msg = err instanceof Error ? err.message : String(err);
      const isNeuronExhausted = /4006|daily free allocation|10,000 neurons|neurons/i.test(msg);
      const is429 = /409|429|rate limit|quota|provider returned error|conflict/i.test(msg);
      const isModelDeprecated = /no longer available to new users|is not found for API version/i.test(msg);
      const isThoughtSigError = /thought_signature/i.test(msg);
      const friendlyMsg = isNeuronExhausted
        ? `⚡ Cloudflare daily free limit reached (10,000 neurons). Connect your second opendot-worker in Settings to double your capacity, or wait for daily reset at 00:00 UTC (5:30 AM IST).`
        : is429
        ? `The model provider is temporarily busy (rate limit). Please try again in a moment or switch to another model in Settings.`
        : isModelDeprecated
        ? `⚠️ Google AI has retired older Gemini models for new API keys. Please select **Gemini 3.5 Flash** from the model dropdown in the top-right corner.`
        : isThoughtSigError
        ? `⚠️ Tool execution signature required by Google. Please retry or switch to **Gemini 3.5 Flash** in the top-right model dropdown.`
        : `Something went wrong: ${msg}`;
      repo.addMessage({ dotId, role: "system", text: friendlyMsg });
    }
  } finally {
    s.running = false;
    s.abort = null;
    repo.routeToChannel(dotId, null);
    repo.setActivity(dotId, null);
    const dot = repo.getDot(dotId);
    if (dot && dot.status !== "paused") {
      repo.updateDot(dotId, { status: repo.pendingCards(dotId).length ? "waiting" : "idle" });
      notifyFinished(dot, startedAt);
    }
    repo.routeToConversation(dotId, null);
    const next = dot?.status !== "paused" ? s.after.shift() : undefined;
    if (next) next();
    else if (dot?.status !== "paused" && s.inbox.length) void pump(dotId);
  }
}

function notifyFinished(dot: Dot, since: number) {
  const fresh = repo.dotMessages(dot.id, 20).filter((m) => m.createdAt >= since && (m.role === "dot" || m.role === "card"));
  const last = fresh[fresh.length - 1];
  if (!last || last.title) return; // titled updates already notified
  const body = last.role === "card" ? `Needs your approval: ${last.card?.title ?? ""}` : last.text;
  emit({ type: "notify", dotId: dot.id, title: last.role === "card" ? `${dot.name} needs you` : dot.name, body: body.slice(0, 160) });
}

async function turn(dotId: string, text: string, trigger: Trigger, signal: AbortSignal, attachments: Attachment[], conversationId: string) {
  repo.routeToConversation(dotId, conversationId);
  repo.routeToChannel(dotId, trigger.kind === "channel" ? trigger.channelId : null);
  const dot = repo.getDot(dotId)!;
  let { thread } = repo.getThread(dotId);
  const pending = parsePending(repo.getThread(dotId).pending);
  const input: ResponseInputItem[] = [];
  // Trigger runs start clean for each event, so a busy inbox doesn't pile up context. An approval
  // still open from the previous event expires, the same as when the user sends a new message.
  const fresh = trigger.kind === "trigger";
  if (pending) {
    const closed = closePending(dot, pending);
    if (closed && !fresh) input.push(...closed);
    else thread = null;
  }
  if (fresh) {
    repo.resetThread(conversationId);
    thread = null;
  }
  const { stateless } = clientFor(await modelFor(dot.model));
  if (!fresh && (stateless ? !repo.getHistory(dotId).length : !thread)) input.unshift(...rebuildContext(dotId, text));
  input.push(await userInput(text, attachments, stateless));
  await drive(dot, thread, input, trigger, signal, conversationId);
}

async function drive(dot: Dot, prevId: string | null, input: ResponseInputItem[], trigger: Trigger, signal: AbortSignal, conversationId?: string | null) {
  const convId = conversationId ?? repo.currentConversation(dot.id);
  for (let step = 0; step < MAX_STEPS; step++) {
    signal.throwIfAborted();
    let resp: Response;
    try {
      resp = await respond(dot, prevId, input, trigger, signal, convId);
    } catch (err) {
      if (!prevId || signal.aborted || clientFor(await modelFor(dot.model)).stateless || !/previous|not found|No tool output/i.test(String(err))) throw err;
      // The server-side thread is gone or broken: rebuild from our transcript and carry on.
      const userText = input.filter((i) => "role" in i && i.role === "user").map((i) => ("content" in i ? String(i.content) : "")).join("\n");
      input = [...rebuildContext(dot.id, userText), { role: "user", content: userText || "Continue." }];
      prevId = null;
      resp = await respond(dot, null, input, trigger, signal, convId);
    }
    repo.setThread(dot.id, clientFor(await modelFor(dot.model)).stateless ? null : resp.id, null);

    let calls = resp.output.filter((o): o is Call => o.type === "function_call" || o.type === "computer_call");
    if (!calls.length) {
      const fallback = extractFallbackCalls(dot, resp);
      if (fallback.length) {
        resp.output.push(...fallback);
        calls = fallback;
      } else {
        // Auto-nudge if the model stopped prematurely with a "please wait" promise or empty placeholder template
        const lastMsg = resp.output.findLast((o) => o.type === "message");
        const msgText = lastMsg && "content" in lastMsg && Array.isArray(lastMsg.content)
          ? lastMsg.content.map((c) => ("text" in c ? c.text : "")).join("")
          : "";
        const isStalledPromise =
          /(?:please wait while I|let me proceed with|let me search for|searching for more information)/i.test(msgText) ||
          /(?:\*\s*\*\*Founder\*\*:\s*$\s*\*\s*\*\*Website\*\*:\s*$)/m.test(msgText);
        if (isStalledPromise && step < 10) {
          input = [{ role: "user", content: "Proceed immediately. Execute web_search and your app tools right now to retrieve the actual details and update the sheet." }];
          continue;
        }
        return;
      }
    }
    const pending: Pending = { responseId: resp.id, calls, outputs: [], index: 0, cardId: null, trigger };
    if (await processCalls(dot, pending, signal)) return; // waiting on the user
    prevId = resp.id;
    input = pending.outputs;
  }
  repo.addMessage({ dotId: dot.id, role: "system", text: `Stopped after ${MAX_STEPS} steps. Say "continue" to keep going.` });
}

/** Stream one model response, mirroring text into the transcript as it arrives. */
async function respond(dot: Dot, prevId: string | null, input: ResponseInputItem[], trigger: Trigger, signal: AbortSignal, conversationId?: string | null): Promise<Response> {
  const convId = conversationId ?? repo.currentConversation(dot.id);
  const appModel = await modelFor(dot.model);
  const { client, model, stateless } = clientFor(appModel);
  const dotTools = toolsForDot(dot);
  const tools: Tool[] = [
    ...dotTools
      .filter((t) => stateless || t.name !== "web_search")
      .map((t): Tool => ({
        type: "function",
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        strict: !stateless && t.strict !== false,
      })),
    // For OpenAI native Responses API, use their server-side search tool
    ...(!stateless ? [{ type: "web_search" as const }] : []),
  ];
  if (!stateless && COMPUTER_ENABLED && supportsComputerTool(model)) tools.push({ type: "computer" } as Tool);

  // Groq's free tier allows ~8k tokens per request (input + max output), so keep tool definitions within a budget.
  const onGroq = isGroqModel(appModel);
  if (onGroq) {
    let used = 0;
    const kept = tools.filter((t) => {
      used += JSON.stringify(t).length;
      return used <= 9000;
    });
    tools.length = 0;
    tools.push(...kept);
  }
  const maxOut = onGroq ? 1024 : 2048;

  // Stateless providers get the whole conversation every time; the app keeps it (trimmed) per chat.
  const history = stateless ? (repo.getHistory(dot.id) as ResponseInputItem[]) : [];
  repo.setActivity(dot.id, "Thinking");
  const isCloudflare = isCloudflareModel(appModel);
  const allWorkers = cloudflareWorkerUrls();
  const availableWorkers = getAvailableWorkerUrls();
  // Candidate workers to try in priority order: available workers first, then all remaining workers
  const candidateWorkers: (string | null)[] = isCloudflare
    ? Array.from(new Set([...availableWorkers, ...allWorkers]))
    : [null];

  let lastErr: unknown = null;

  for (let workerIdx = 0; workerIdx < candidateWorkers.length; workerIdx++) {
    const workerUrl = candidateWorkers[workerIdx];
    const activeClient = workerUrl ? cloudflareForUrl(workerUrl) : client;
    const activeModel = model;

    let stream: any = null;
    try {
      stream = needsCompat(appModel) && stateless
        ? await responsesStreamCompat(activeClient, { model: activeModel, instructions: systemPrompt(dot, trigger), input: [...history, ...input], tools, max_output_tokens: maxOut }, { signal })
        : await activeClient.responses.create(
            stateless
              ? { model: activeModel, instructions: systemPrompt(dot, trigger), input: [...history, ...input], tools, parallel_tool_calls: false, store: false, stream: true, max_output_tokens: maxOut }
              : {
                  model: activeModel,
                  instructions: systemPrompt(dot, trigger),
                  input,
                  previous_response_id: prevId ?? undefined,
                  tools,
                  ...(isReasoningModel(activeModel) ? { reasoning: { effort: "medium" as const } } : {}),
                  truncation: "auto",
                  parallel_tool_calls: false,
                  store: true,
                  stream: true,
                },
            { signal },
          );
    } catch (err) {
      const errMsg = String(err);
      const isContextOverflow = /context length|maximum context|input_tokens|8007|reduce the length/i.test(errMsg);
      if (isContextOverflow && stateless && history.length > 0) {
        console.warn(`[dots] Context limit reached for ${appModel}. Auto-pruning history and retrying...`);
        const pruned = history.slice(-4);
        repo.setHistory(dot.id, pruned);
        try {
          stream = needsCompat(appModel)
            ? await responsesStreamCompat(activeClient, { model: activeModel, instructions: systemPrompt(dot, trigger), input: [...pruned, ...input], tools, max_output_tokens: 1500 }, { signal })
            : await activeClient.responses.create(
                { model: activeModel, instructions: systemPrompt(dot, trigger), input: [...pruned, ...input], tools, parallel_tool_calls: false, store: false, stream: true, max_output_tokens: 1500 },
                { signal },
              );
        } catch (retryErr) {
          lastErr = retryErr;
        }
      } else {
        lastErr = err;
      }

      if (!stream) {
        const isNeuronExhausted = /4006|daily free allocation|10,000 neurons|neurons/i.test(errMsg);
        const isRateLimit = /409|429|rate limit|quota|busy|conflict/i.test(errMsg);

        if (workerUrl && (isNeuronExhausted || isRateLimit) && workerIdx + 1 < candidateWorkers.length) {
          const nextWorker = candidateWorkers[workerIdx + 1]!;
          markWorkerExhausted(workerUrl, isNeuronExhausted ? "10,000 daily neurons limit reached" : "Rate limit");
          console.warn(`[dots] Worker ${workerUrl} failed (${errMsg}). Failing over to ${nextWorker}...`);
          repo.addMessage({
            dotId: dot.id,
            role: "system",
            conversationId: convId,
            text: `⚡ Cloudflare Worker (${workerUrl.replace(/^https?:\/\//, "")}) ${isNeuronExhausted ? "daily free 10k neuron limit reached" : "temporarily busy"}. Switching automatically to backup worker (${nextWorker.replace(/^https?:\/\//, "")})...`,
          });
          continue;
        }

        if (isRateLimit && !isCloudflareModel(appModel) && Boolean(cloudflareWorkerUrl())) {
          console.warn(`[dots] Model ${appModel} hit rate limit (429). Failing over to Cloudflare Meta Llama 4 Scout 17B...`);
          repo.addMessage({
            dotId: dot.id,
            role: "system",
            conversationId: convId,
            text: `⚡ Selected model (${appModel.replace(/^openrouter:|^cloudflare:/, "")}) hit a temporary provider rate limit. Continuing automatically with Meta Llama 4 Scout 17B on Cloudflare edge...`,
          });
          const fallbackClient = clientFor("cloudflare:@cf/meta/llama-4-scout-17b-16e-instruct");
          try {
            stream = await fallbackClient.client.responses.create(
              {
                model: fallbackClient.model,
                instructions: systemPrompt(dot, trigger),
                input: [...history, ...input],
                tools,
                parallel_tool_calls: false,
                store: false,
                stream: true,
                max_output_tokens: 2048,
              },
              { signal },
            );
          } catch (scoutErr) {
            throw scoutErr;
          }
        } else {
          throw err;
        }
      }
    }

    const drafts = new Map<string, { id: string; text: string }>();
    let final: Response | null = null;
    let streamFailed = false;
    let streamError: unknown = null;

    try {
      for await (const ev of stream) {
        switch (ev.type) {
          case "response.output_item.added":
            if (String(ev.item.type).includes("web_search")) repo.setActivity(dot.id, "Searching the web");
            else if (ev.item.type === "computer_call") repo.setActivity(dot.id, "Using its computer");
            else if (ev.item.type === "message") repo.setActivity(dot.id, "Writing");
            break;
          case "response.output_text.delta": {
            let d = drafts.get(ev.item_id);
            if (!d) {
              const m = repo.addMessage({ dotId: dot.id, role: "dot", text: "", conversationId: convId });
              drafts.set(ev.item_id, (d = { id: m.id, text: "" }));
            }
            d.text += ev.delta;
            emit({ type: "message_delta", id: d.id, dotId: dot.id, delta: ev.delta, conversationId: convId });
            break;
          }
          case "response.output_item.done":
            if (ev.item.type === "message") {
              const d = drafts.get(ev.item.id);
              if (d) {
                const clean = d.text.replace(/<think>[\s\S]*?<\/think>\s*/gi, "").trim();
                d.text = clean;
                repo.updateMessage(d.id, { text: clean });
              }
            } else if (String(ev.item.type).includes("web_search")) {
              const action = (ev.item as { action?: { query?: string } }).action;
              activity(dot.id, "Searched the web", action?.query);
            }
            break;
          case "response.completed":
            final = ev.response;
            break;
          case "response.failed":
            throw new Error(ev.response.error?.message ?? "The model request failed");
          case "error":
            throw new Error(ev.message);
        }
      }
    } catch (sErr) {
      streamFailed = true;
      streamError = sErr;
    } finally {
      for (const d of drafts.values()) repo.updateMessage(d.id, { text: d.text || "…" });
    }

    if (streamFailed) {
      const sErrMsg = String(streamError);
      const isNeuronExhausted = /4006|daily free allocation|10,000 neurons|neurons/i.test(sErrMsg);
      const isRateLimit = /409|429|rate limit|quota|busy|conflict/i.test(sErrMsg);
      const hasDeliveredText = Array.from(drafts.values()).some((d) => d.text.trim().length > 0);

      // If no text was delivered and this worker hit quota/rate limit, failover to the next worker!
      if (workerUrl && (isNeuronExhausted || isRateLimit) && !hasDeliveredText && workerIdx + 1 < candidateWorkers.length) {
        const nextWorker = candidateWorkers[workerIdx + 1]!;
        markWorkerExhausted(workerUrl, isNeuronExhausted ? "10,000 daily neurons limit reached" : "Rate limit");
        console.warn(`[dots] Worker ${workerUrl} stream failed (${sErrMsg}). Failing over to ${nextWorker}...`);
        repo.addMessage({
          dotId: dot.id,
          role: "system",
          conversationId: convId,
          text: `⚡ Cloudflare Worker (${workerUrl.replace(/^https?:\/\//, "")}) ${isNeuronExhausted ? "daily free 10k neuron limit reached" : "temporarily busy"}. Switching automatically to backup worker (${nextWorker.replace(/^https?:\/\//, "")})...`,
        });
        continue;
      }
      throw streamError;
    }

    if (final) {
      if (stateless) repo.setHistory(dot.id, trimHistory([...history, ...input, ...replayable(final.output)]));
      return final;
    }
  }

  throw lastErr || new Error("The model stream ended unexpectedly");
}

/** The parts of a response worth sending back next turn: what the model said and the tools it called. */
function replayable(output: Response["output"]): ResponseInputItem[] {
  const items: ResponseInputItem[] = [];
  for (const o of output) {
    if (o.type === "message") {
      const text = o.content.map((c) => ("text" in c ? c.text : "")).join("");
      if (text) items.push({ role: "assistant", content: text });
    } else if (o.type === "function_call") {
      items.push({
        type: "function_call",
        call_id: o.call_id,
        name: o.name,
        arguments: o.arguments,
        extra_content: (o as any).extra_content,
        thought_signature: (o as any).thought_signature,
      } as any);
    }
  }
  return items;
}

/** Keep the replayed history bounded: drop the oldest turns, always cutting at a user message. */
function trimHistory(items: ResponseInputItem[], maxItems = 24, maxChars = 32_000): ResponseInputItem[] {
  const size = (list: ResponseInputItem[]) => JSON.stringify(list).length;
  let start = 0;
  while (items.length - start > maxItems || size(items.slice(start)) > maxChars) {
    const next = items.findIndex((it, i) => i > start && "role" in it && it.role === "user");
    if (next < 0) break;
    start = next;
  }
  return items.slice(start);
}

/** Execute tool calls in order. Returns true if the run paused to wait for the user. */
async function processCalls(dot: Dot, pending: Pending, signal: AbortSignal): Promise<boolean> {
  for (; pending.index < pending.calls.length; pending.index++) {
    signal.throwIfAborted();
    savePending(dot.id, pending);
    const call = pending.calls[pending.index];

    if (call.type === "computer_call") {
      if (call.pending_safety_checks?.length) {
        const detail = call.pending_safety_checks.map((c) => c.message ?? c.code ?? "Sensitive action").join("\n");
        return pauseFor(dot, pending, { kind: "approval", status: "pending", title: "Review an on-screen action", detail, tool: "computer" });
      }
      pending.outputs.push(await execComputer(dot, call, []));
      continue;
    }

    const def = findTool(call.name);
    const args = safeParse(call.arguments);
    if (!def) {
      pending.outputs.push({ type: "function_call_output", call_id: call.call_id, output: `Unknown tool ${call.name}` });
      continue;
    }
    if (def.pause === "question") {
      return pauseFor(dot, pending, { kind: "question", status: "pending", title: String(args.question ?? ""), options: (args.options as string[]) ?? [] });
    }
    if (def.pause === "approval") {
      return pauseFor(dot, pending, { kind: "approval", status: "pending", title: String(args.action ?? ""), detail: String(args.details ?? ""), tool: def.name });
    }

    if (def.pause === "connect") {
      const toolkit = String(args.toolkit ?? "").trim().toLowerCase();
      const started = await composio.startConnect(toolkit).catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }));
      if ("error" in started) {
        pending.outputs.push({ type: "function_call_output", call_id: call.call_id, output: `Couldn't start connecting ${toolkit}: ${started.error}` });
        continue;
      }
      if (started.already) {
        pending.outputs.push({ type: "function_call_output", call_id: call.call_id, output: "Already connected." });
        continue;
      }
      pauseFor(dot, pending, {
        kind: "connect", status: "pending", title: `Connect ${started.name}`, toolkit, url: started.url,
        detail: `${dot.name} needs access to your ${started.name} to continue. You'll sign in with ${started.name} directly; ${dot.name} never sees your password.`,
      });
      const cardId = pending.cardId!;
      // Resume on its own as soon as the connection goes live (the OAuth callback route also resolves it).
      void started.wait().then(() => resolveCard(cardId, "approve")).catch(() => {});
      return true;
    }

    const ctx: ToolCtx = { dot, signal, depth: 0 };
    const blocked = await def.precheck?.(args, ctx).catch(() => null);
    if (blocked) {
      pending.outputs.push({ type: "function_call_output", call_id: call.call_id, output: blocked });
      continue;
    }
    if (def.describe) {
      const action = def.describe(args, ctx);
      repo.setActivity(dot.id, "Checking your rules");
      const verdict = await review(dot.id, action, (await def.defaultDecision?.(ctx, args)) ?? "allow");
      if (verdict.decision === "never") {
        activity(dot.id, "Blocked by your rule", verdict.rule?.action);
        pending.outputs.push({ type: "function_call_output", call_id: call.call_id, output: `Not allowed: the user's rule says never ${verdict.rule?.action ?? "do this"}. Don't try to work around it.` });
        continue;
      }
      if (verdict.decision === "ask") {
        return pauseFor(dot, pending, {
          kind: "approval", status: "pending", title: capitalize(action), tool: def.name, ruleAction: verdict.rule?.action ?? action,
          detail: [def.detail?.(args), verdict.rule ? `Your rule: ask first when it wants to ${verdict.rule.action}.` : null].filter(Boolean).join("\n\n") || undefined,
        });
      }
    }

    // Anti-loop breaker: prevent model from executing the exact same tool call 3+ times in a row
    const callSignature = `${call.name}:${call.arguments}`;
    const recentOutputs = pending.outputs.slice(-2);
    const isLooping =
      recentOutputs.length >= 2 &&
      recentOutputs.every((o) => o.type === "function_call_output" && (o as any).signature === callSignature);

    if (isLooping) {
      pending.outputs.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: "Loop breaker: You have executed this exact tool with identical arguments 2 times consecutively. Stop repeating this action. Try a different strategy, inspect previous results, or report your findings to the user.",
      });
      continue;
    }

    const toolResult = await execTool(dot, call, signal);
    const outputItem = { type: "function_call_output" as const, call_id: call.call_id, output: toolResult };
    (outputItem as any).signature = callSignature;
    pending.outputs.push(outputItem);
  }
  savePending(dot.id, pending);
  return false;
}

function pauseFor(dot: Dot, pending: Pending, card: CardData): true {
  const msg = repo.addMessage({ dotId: dot.id, role: "card", text: card.title, card });
  pending.cardId = msg.id;
  savePending(dot.id, pending);
  return true;
}

async function execTool(dot: Dot, call: ResponseFunctionToolCall, signal: AbortSignal): Promise<string> {
  const def = findTool(call.name)!;
  const args = safeParse(call.arguments);
  repo.setActivity(dot.id, def.label);
  activity(dot.id, def.label, summarize(args));
  try {
    // 35-second timeout guard: ensures network/browser tools never freeze automations indefinitely
    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`Tool ${def.name} timed out after 35s`)), 35_000);
      signal.addEventListener("abort", () => clearTimeout(timeoutId), { once: true });
    });

    const executionPromise = def.execute!(args, { dot, signal, depth: 0 });
    const result = await Promise.race([executionPromise, timeoutPromise]);
    if (timeoutId) clearTimeout(timeoutId);
    return result;
  } catch (err) {
    if (signal.aborted) throw err;
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function execComputer(
  dot: Dot, call: ResponseComputerToolCall, ack: ResponseComputerToolCall.PendingSafetyCheck[],
): Promise<ResponseInputItem> {
  repo.setActivity(dot.id, "Using its computer");
  activity(dot.id, "Using its computer");
  const actions = (call.actions ?? (call.action ? [call.action] : [])) as ComputerAction[];
  for (const a of actions) await computer.doAction(dot.id, a);
  const shot = await computer.screenshot(dot.id);
  return {
    type: "computer_call_output",
    call_id: call.call_id,
    output: { type: "computer_screenshot", image_url: `data:image/png;base64,${shot.toString("base64")}` },
    acknowledged_safety_checks: ack.map((c) => ({ id: c.id, code: c.code, message: c.message })),
  };
}

/** Close out calls left hanging (the user moved on / the run was stopped). Returns null if the thread must be reset. */
function closePending(dot: Dot, pending: Pending): ResponseInputItem[] | null {
  if (pending.cardId) {
    const card = repo.getMessage(pending.cardId)?.card;
    if (card?.status === "pending") repo.updateMessage(pending.cardId, { card: { ...card, status: "expired" } });
  }
  const outputs = [...pending.outputs];
  for (let i = pending.index; i < pending.calls.length; i++) {
    const call = pending.calls[i];
    if (call.type === "computer_call") return null;
    outputs.push({ type: "function_call_output", call_id: call.call_id, output: "Not run — the user sent a new message first." });
  }
  repo.setThread(dot.id, pending.responseId, null);
  return outputs;
}

function rebuildContext(dotId: string, exclude: string): ResponseInputItem[] {
  return repo
    .conversationMessages(repo.currentConversation(dotId), 40)
    .filter((m) => (m.role === "user" || m.role === "dot") && m.text && m.text !== exclude)
    .map((m) => ({
      role: m.role === "user" ? ("user" as const) : ("assistant" as const),
      content: m.text.replace(/<think>[\s\S]*?<\/think>\s*/gi, "").trim(),
    }));
}

// ---------------------------------------------------------------- dot-to-dot

setConsult(async (target, message, from, _depth, signal) => {
  const channelId = repo.channelRoute(from.id);
  if (!channelId) repo.addMessage({ dotId: target.id, role: "user", text: message, from: `dot:${from.name}` });
  repo.setActivity(target.id, `Helping ${from.name}`);
  try {
    const { client, model, stateless } = clientFor(await modelFor(target.model));
    const consultInput = [...rebuildContext(target.id, message).slice(-12), { role: "user", content: `${from.name} asks: ${message}` }] as ResponseInputItem[];
    const consultTools: Tool[] = stateless
      ? [
          {
            type: "function",
            name: "web_search",
            description: "Search the web for real-time news, current events, live facts, documentation, or online information.",
            parameters: { type: "object", properties: { query: { type: "string", description: "The search query" } }, required: ["query"] },
            strict: false,
          } as Tool,
        ]
      : [{ type: "web_search" }];
    const res = needsCompat(model) && stateless
      ? await responsesCompat(client, { model, instructions: systemPrompt(target, { kind: "dot", from: from.name }), input: consultInput, tools: consultTools }, { signal })
      : await client.responses.create(
          { model, instructions: systemPrompt(target, { kind: "dot", from: from.name }), input: consultInput, tools: consultTools, ...(stateless ? { store: false } : isReasoningModel(model) ? { reasoning: { effort: "low" as const } } : {}) },
          { signal },
        );
    const reply = (res.output_text || "(no reply)").replace(/<think>[\s\S]*?<\/think>\s*/gi, "").trim();
    // In a channel the member answers in the channel (the user sees the team at work); otherwise in its own chat.
    repo.addMessage({ dotId: target.id, role: "dot", text: reply, from: `dot:${from.name}`, channelId });
    return `${target.name} replied: ${reply}`;
  } finally {
    repo.setActivity(target.id, null);
  }
});

// ---------------------------------------------------------------- helpers

/** A user turn with its attachments: images go as vision input; PDFs/text files get their text extracted and injected directly; all files remain saved in the workspace. */
async function userInput(text: string, attachments: Attachment[], stateless = false): Promise<ResponseInputItem> {
  if (!attachments.length) return { role: "user", content: text };
  const note = `\n\n[Attached: ${attachments.map((a) => `${a.name} (saved in your workspace at ${files.boxPathOf(a.id) ?? `uploads/${a.name}`})`).join("; ")}]`;
  let combinedPrompt = (text || "See the attached files.") + note;
  const parts: ResponseInputContent[] = [];

  for (const a of attachments) {
    const f = files.get(a.id);
    if (!f || f.size > 15 * 1024 * 1024) continue;

    // Images: send as visual input if under 4MB
    if (/^image\/(png|jpeg|gif|webp)$/.test(f.mime) && f.size < 4 * 1024 * 1024) {
      const b64 = f.data().toString("base64");
      parts.push({ type: "input_image", image_url: `data:${f.mime};base64,${b64}`, detail: "auto" });
      continue;
    }

    // PDF documents: extract clean text directly so all models (Llama, GPT, Claude) can read them without token explosion
    const isPdf = f.mime === "application/pdf" || a.name.toLowerCase().endsWith(".pdf");
    if (isPdf) {
      try {
        const res = await extractText(new Uint8Array(f.data()), { mergePages: true });
        const docText = typeof res?.text === "string" ? res.text.trim() : "";
        if (docText) {
          const preview = docText.length > 8000
            ? docText.slice(0, 8000) + `\n\n...[truncated: showing first 8,000 characters of ${docText.length}. Use read_file to read more]`
            : docText;
          combinedPrompt += `\n\n--- Content of attached PDF "${a.name}" ---\n${preview}\n--- End of PDF ---`;
        }
      } catch (err) {
        console.warn(`[agent] Failed to extract text from PDF attachment ${a.name}:`, err);
      }
      continue;
    }

    // Text / Code / Data files: extract text content up to 8,000 characters
    const isTextLike = /^text\//.test(f.mime) ||
      f.mime === "application/json" ||
      /\.(txt|md|csv|json|py|js|ts|tsx|jsx|html|css|yaml|yml|xml|log|sh)$/i.test(a.name);
    if (isTextLike) {
      try {
        const str = f.data().toString("utf8");
        const preview = str.length > 8000
          ? str.slice(0, 8000) + `\n\n...[truncated: showing first 8,000 characters of ${str.length}. Use read_file to read more]`
          : str;
        combinedPrompt += `\n\n--- Content of attached file "${a.name}" ---\n${preview}\n--- End of file ---`;
      } catch (err) {
        console.warn(`[agent] Failed to extract text from file attachment ${a.name}:`, err);
      }
    }
  }

  // Prepend text part before image parts
  parts.unshift({ type: "input_text", text: combinedPrompt });
  return { role: "user", content: parts };
}

function activity(dotId: string, label: string, detail?: string) {
  const last = repo.dotMessages(dotId, 1)[0];
  const text = detail ? `${label} · ${detail}` : label;
  if (last?.role === "activity" && last.text === text) return;
  repo.addMessage({ dotId, role: "activity", text });
}

function summarize(a: Record<string, unknown>): string | undefined {
  const v = a.command ?? a.url ?? a.path ?? a.site ?? a.fact ?? a.name ?? a.dot_name;
  if (typeof v !== "string") return undefined;
  return v.length > 80 ? v.slice(0, 77) + "…" : v;
}

function savePending(dotId: string, pending: Pending) {
  repo.setThread(dotId, pending.responseId, JSON.stringify(pending));
}

function parsePending(raw: string | null): Pending | null {
  return raw ? (JSON.parse(raw) as Pending) : null;
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function parseLooseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    try {
      return (new Function("return (" + text + ")"))();
    } catch {
      return null;
    }
  }
}

function extractBalancedBracket(str: string, startFrom = 0): { text: string; start: number; end: number } | null {
  const start = str.indexOf("[", startFrom);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let quoteChar = "";
  for (let i = start; i < str.length; i++) {
    const char = str[i];
    const prev = str[i - 1];
    if ((char === '"' || char === "'") && prev !== "\\") {
      if (!inString) {
        inString = true;
        quoteChar = char;
      } else if (char === quoteChar) {
        inString = false;
      }
    }
    if (!inString) {
      if (char === "[") depth++;
      else if (char === "]") {
        depth--;
        if (depth === 0) {
          return { text: str.slice(start, i + 1), start, end: i + 1 };
        }
      }
    }
  }
  return null;
}

function extractBalancedParen(str: string, startFrom = 0): { text: string; start: number; end: number } | null {
  const start = str.indexOf("(", startFrom);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let quoteChar = "";
  for (let i = start; i < str.length; i++) {
    const char = str[i];
    const prev = str[i - 1];
    if ((char === '"' || char === "'") && prev !== "\\") {
      if (!inString) {
        inString = true;
        quoteChar = char;
      } else if (char === quoteChar) {
        inString = false;
      }
    }
    if (!inString) {
      if (char === "(") depth++;
      else if (char === ")") {
        depth--;
        if (depth === 0) {
          return { text: str.slice(start + 1, i), start, end: i + 1 };
        }
      }
    }
  }
  return null;
}

function extractFallbackCalls(dot: Dot, resp: Response): Call[] {
  const dotTools = toolsForDot(dot);
  const knownTools = new Set(dotTools.map((t) => t.name.toLowerCase()));
  const extracted: Call[] = [];

  for (const item of resp.output) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content) {
        if ("text" in part && typeof part.text === "string" && part.text) {
          // 1. Balanced function call matching: [TOOL_NAME(...) or TOOL_NAME(...)
          const toolNameRegex = /(?:\[\s*)?([A-Za-z0-9_]+)\s*\(/g;
          let match;
          while ((match = toolNameRegex.exec(part.text)) !== null) {
            const name = match[1];
            if (!knownTools.has(name.toLowerCase())) continue;

            const openParenIndex = match.index + match[0].length - 1;
            const paren = extractBalancedParen(part.text, openParenIndex);
            if (!paren) continue;

            let fullStart = match.index;
            let fullEnd = paren.end;
            if (part.text[fullEnd] === "]") fullEnd++;
            const fullMatch = part.text.slice(fullStart, fullEnd);

            const inside = paren.text.trim();
            let parsedArgs: Record<string, unknown> = {};

            if (inside.startsWith("{") && inside.endsWith("}")) {
              parsedArgs = parseLooseJson(inside) || {};
            } else {
              const toolsKeyIdx = inside.search(/\btools["':=\s]/);
              if (toolsKeyIdx !== -1) {
                const bracket = extractBalancedBracket(inside, toolsKeyIdx);
                if (bracket) {
                  const parsedTools = parseLooseJson(bracket.text);
                  if (parsedTools) parsedArgs.tools = parsedTools;
                }
              }

              const kvRegex = /([a-zA-Z0-9_]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^,\s\)]+))/g;
              let kv;
              while ((kv = kvRegex.exec(inside)) !== null) {
                const k = kv[1];
                if (k !== "tools") {
                  const v = kv[2] ?? kv[3] ?? kv[4];
                  parsedArgs[k] = v === "true" ? true : v === "false" ? false : v;
                }
              }
            }

            extracted.push({
              type: "function_call",
              call_id: `call_${crypto.randomUUID().slice(0, 8)}`,
              name,
              arguments: JSON.stringify(parsedArgs),
            });
            part.text = part.text.replace(fullMatch, "").trim();
            toolNameRegex.lastIndex = 0;
          }

          // 2. Check for <tool_call> JSON </tool_call>
          const blockRegex = /(?:<tool_call>|```(?:tool_call|json)?\s*<tool_call>)([\s\S]*?)(?:<\/tool_call>|```)/gi;
          let blockMatch;
          while ((blockMatch = blockRegex.exec(part.text)) !== null) {
            const [fullMatch, rawJson] = blockMatch;
            try {
              const parsed = JSON.parse(rawJson.trim());
              const name = parsed.name || parsed.function?.name;
              const args = parsed.arguments || parsed.parameters || parsed.function?.arguments || {};
              if (name && (knownTools.size === 0 || knownTools.has(String(name).toLowerCase()))) {
                extracted.push({
                  type: "function_call",
                  call_id: `call_${crypto.randomUUID().slice(0, 8)}`,
                  name,
                  arguments: typeof args === "string" ? args : JSON.stringify(args),
                });
                part.text = part.text.replace(fullMatch, "").trim();
                blockRegex.lastIndex = 0;
              }
            } catch {}
          }

          // Strip leftover suffix words like "assistant" attached by greedy token completion
          part.text = part.text.replace(/^assistant\s*/i, "").trim();

          // Update message in repo if stripped
          const cleanText = part.text.trim();
          const targetMsg = (item as any).id ? repo.getMessage((item as any).id) : null;
          const lastMsg = targetMsg || repo.dotMessages(dot.id, 1)[0];
          if (lastMsg && lastMsg.role === "dot") {
            if (!cleanText) {
              repo.deleteMessage(lastMsg.id);
            } else {
              repo.updateMessage(lastMsg.id, { text: cleanText });
            }
          }
        }
      }
    }
  }

  return extracted;
}
