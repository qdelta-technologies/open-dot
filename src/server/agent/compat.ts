import "server-only";
import type OpenAI from "openai";
import { isGoogleModel } from "./google";
import { isAnthropicModel } from "./anthropic";

// Google and Anthropic only support Chat Completions (/v1/chat/completions).
// The runtime uses the OpenAI Responses API (/v1/responses) which those providers don't have.
// This adapter translates Responses API calls into Chat Completions calls and re-emits
// the same streaming events the runtime expects, so runtime.ts needs minimal changes.

export function needsCompat(model: string): boolean {
  return isGoogleModel(model) || isAnthropicModel(model);
}

function toMessages(instructions: string, input: any[]): any[] {
  const msgs: any[] = [];
  if (instructions) msgs.push({ role: "system", content: instructions });

  for (const item of input) {
    if (item.role === "user") {
      const content =
        typeof item.content === "string"
          ? item.content
          : Array.isArray(item.content)
          ? item.content.map((p: any) => {
              if (p.type === "input_text") return { type: "text", text: p.text };
              if (p.type === "input_image")
                return { type: "image_url", image_url: { url: p.image_url, detail: p.detail ?? "auto" } };
              return { type: "text", text: String(p.text ?? "") };
            })
          : String(item.content ?? "");
      msgs.push({ role: "user", content });
    } else if (item.role === "assistant") {
      msgs.push({ role: "assistant", content: typeof item.content === "string" ? item.content : "" });
    } else if (item.type === "function_call") {
      // Merge into the preceding assistant message if possible, otherwise create one.
      const prev = msgs[msgs.length - 1];
      const thoughtSig = (item as any).thought_signature ?? (item as any).thoughtSignature;
      const extraContent = (item as any).extra_content ?? (thoughtSig ? { google: { thought_signature: thoughtSig } } : undefined);
      const toolCall: any = {
        id: item.call_id,
        type: "function",
        function: { name: item.name, arguments: item.arguments },
      };
      if (extraContent) toolCall.extra_content = extraContent;
      if (thoughtSig) {
        toolCall.thought_signature = thoughtSig;
        toolCall.thoughtSignature = thoughtSig;
      }
      if (prev?.role === "assistant" && !prev.tool_calls) {
        prev.tool_calls = [toolCall];
        if (!prev.content) prev.content = null;
        if (extraContent && !prev.extra_content) prev.extra_content = extraContent;
        if (thoughtSig && !prev.thought_signature) {
          prev.thought_signature = thoughtSig;
          prev.thoughtSignature = thoughtSig;
        }
      } else if (prev?.role === "assistant" && prev.tool_calls) {
        prev.tool_calls.push(toolCall);
        if (extraContent && !prev.extra_content) prev.extra_content = extraContent;
        if (thoughtSig && !prev.thought_signature) {
          prev.thought_signature = thoughtSig;
          prev.thoughtSignature = thoughtSig;
        }
      } else {
        const asstMsg: any = { role: "assistant", content: null, tool_calls: [toolCall] };
        if (extraContent) asstMsg.extra_content = extraContent;
        if (thoughtSig) {
          asstMsg.thought_signature = thoughtSig;
          asstMsg.thoughtSignature = thoughtSig;
        }
        msgs.push(asstMsg);
      }
    } else if (item.type === "function_call_output") {
      msgs.push({ role: "tool", content: item.output, tool_call_id: item.call_id });
    }
  }

  return msgs;
}

function toTools(tools: any[]): any[] {
  return tools
    .filter((t) => t.type === "function")
    .map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description ?? "", parameters: t.parameters, strict: t.strict },
    }));
}

/**
 * Streaming compat: makes a Chat Completions streaming call and yields fake Responses API events.
 * Returns a Promise so connection errors surface in the same try-block as responses.create() would.
 */
export async function responsesStreamCompat(
  client: OpenAI,
  params: {
    model: string;
    instructions: string;
    input: any[];
    tools: any[];
    max_output_tokens?: number;
  },
  options?: { signal?: AbortSignal }
): Promise<AsyncGenerator<any>> {
  const messages = toMessages(params.instructions, params.input);
  const convertedTools = toTools(params.tools);
  const isGoogle = isGoogleModel(params.model) || params.model.toLowerCase().includes("gemini");

  // Google AI Studio's OpenAI-compatible streaming endpoint frequently hangs / drops headers with tools.
  // Using non-streaming for Google models executes in ~2 seconds with complete thought signatures!
  if (isGoogle) {
    const res: any = await (client.chat.completions as any).create(
      {
        model: params.model,
        messages,
        ...(convertedTools.length ? { tools: convertedTools } : {}),
        stream: false,
        max_tokens: params.max_output_tokens ?? 2048,
        parallel_tool_calls: false,
      },
      options
    );

    const messageId = `msg_cc_${Date.now()}`;
    const responseId = `resp_cc_${Date.now()}`;
    const choice = res.choices?.[0];
    const msg = choice?.message ?? {};
    const text = msg.content || "";
    const rawToolCalls: any[] = msg.tool_calls || [];

    async function* googleGen(): AsyncGenerator<any> {
      yield { type: "response.output_item.added", item: { type: "message", id: messageId, role: "assistant", content: [] } };
      if (text) {
        yield { type: "response.output_text.delta", item_id: messageId, delta: text };
      }
      yield {
        type: "response.output_item.done",
        item: { type: "message", id: messageId, role: "assistant", content: [{ type: "output_text", text }] },
      };

      const output: any[] = [];
      if (text || !rawToolCalls.length) {
        output.push({
          type: "message",
          id: messageId,
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text, annotations: [] }],
        });
      }

      for (let i = 0; i < rawToolCalls.length; i++) {
        const tc = rawToolCalls[i];
        const id = tc.id || `call_${i}_${Date.now()}`;
        const itemId = `fc_${id}`;
        const name = tc.function?.name || "";
        const args = tc.function?.arguments || "{}";
        const extraContent = tc.extra_content;
        const thoughtSig = tc.thought_signature ?? extraContent?.google?.thought_signature;

        yield {
          type: "response.output_item.added",
          item: { type: "function_call", id: itemId, call_id: id, name },
        };
        yield {
          type: "response.function_call_arguments.delta",
          item_id: itemId,
          delta: args,
        };
        yield {
          type: "response.output_item.done",
          item: { type: "function_call", id: itemId, call_id: id, name, arguments: args },
        };

        output.push({
          type: "function_call",
          id: itemId,
          call_id: id,
          name,
          arguments: args,
          status: "completed",
          extra_content: extraContent,
          thought_signature: thoughtSig,
        } as any);
      }

      yield { type: "response.completed", response: { id: responseId, object: "response", status: "completed", output, output_text: text } };
    }

    return googleGen();
  }

  const ccStream: any = await (client.chat.completions as any).create(
    {
      model: params.model,
      messages,
      ...(convertedTools.length ? { tools: convertedTools } : {}),
      stream: true,
      max_tokens: params.max_output_tokens ?? 2048,
      parallel_tool_calls: false,
    },
    options
  );

  const messageId = `msg_cc_${Date.now()}`;
  const responseId = `resp_cc_${Date.now()}`;

  async function* gen(): AsyncGenerator<any> {
    yield { type: "response.output_item.added", item: { type: "message", id: messageId, role: "assistant", content: [] } };

    let fullText = "";
    let globalThoughtSig: string | null = null;
    let globalExtraContent: any = null;
    const toolCalls: Record<number, { id: string; name: string; arguments: string; extra_content?: any; thought_signature?: string }> = {};
    const toolItemIds: Record<number, string> = {};

    for await (const chunk of ccStream) {
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};

      // Check any part of chunk/choice/delta for thought_signature or reasoning
      const chunkSig =
        (chunk as any).thought_signature ??
        (chunk as any).thoughtSignature ??
        (choice as any).thought_signature ??
        (choice as any).thoughtSignature ??
        (delta as any).thought_signature ??
        (delta as any).thoughtSignature ??
        (delta as any).thought ??
        (delta as any).reasoning ??
        (delta as any).reasoning_content ??
        (delta as any).extra_content?.google?.thought_signature ??
        (choice as any).extra_content?.google?.thought_signature ??
        (chunk as any).extra_content?.google?.thought_signature;

      if (chunkSig && typeof chunkSig === "string") {
        globalThoughtSig = chunkSig;
      }

      const chunkExtra = (delta as any).extra_content ?? (choice as any).extra_content ?? (chunk as any).extra_content;
      if (chunkExtra) {
        globalExtraContent = chunkExtra;
      }

      if (delta.content) {
        fullText += delta.content;
        yield { type: "response.output_text.delta", item_id: messageId, delta: delta.content };
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx: number = tc.index ?? 0;
          const tcSig =
            (tc as any).thought_signature ??
            (tc as any).thoughtSignature ??
            (tc as any).extra_content?.google?.thought_signature ??
            chunkSig ??
            globalThoughtSig;
          if (tcSig && typeof tcSig === "string") globalThoughtSig = tcSig;
          const tcExtra = (tc as any).extra_content ?? chunkExtra ?? globalExtraContent;

          if (!(idx in toolCalls)) {
            const id = tc.id ?? `call_${idx}_${Date.now()}`;
            const itemId = `fc_${id}`;
            toolCalls[idx] = { id, name: tc.function?.name ?? "", arguments: "", extra_content: tcExtra, thought_signature: tcSig } as any;
            toolItemIds[idx] = itemId;
            yield {
              type: "response.output_item.added",
              item: { type: "function_call", id: itemId, call_id: id, name: tc.function?.name ?? "" },
            };
          }
          if (tc.function?.name && !toolCalls[idx].name) toolCalls[idx].name = tc.function.name;
          if (tcExtra) (toolCalls[idx] as any).extra_content = tcExtra;
          if (tcSig) (toolCalls[idx] as any).thought_signature = tcSig;
          if (tc.function?.arguments) {
            toolCalls[idx].arguments += tc.function.arguments;
            yield { type: "response.function_call_arguments.delta", item_id: toolItemIds[idx], delta: tc.function.arguments };
          }
        }
      }
    }

    // Ensure all tool calls carry the signature if one was discovered anywhere in the stream
    for (const tc of Object.values(toolCalls)) {
      if (!(tc as any).thought_signature && globalThoughtSig) {
        (tc as any).thought_signature = globalThoughtSig;
      }
      if (!(tc as any).extra_content && (globalExtraContent || globalThoughtSig)) {
        (tc as any).extra_content = globalExtraContent ?? { google: { thought_signature: globalThoughtSig } };
      }
    }

    // Emit done events and build the final Response-shaped output
    yield {
      type: "response.output_item.done",
      item: { type: "message", id: messageId, role: "assistant", content: [{ type: "output_text", text: fullText }] },
    };

    const output: any[] = [];
    if (fullText || !Object.keys(toolCalls).length) {
      output.push({
        type: "message",
        id: messageId,
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: fullText, annotations: [] }],
      });
    }
    for (const [idxStr, tc] of Object.entries(toolCalls)) {
      const itemId = toolItemIds[Number(idxStr)];
      yield {
        type: "response.output_item.done",
        item: { type: "function_call", id: itemId, call_id: tc.id, name: tc.name, arguments: tc.arguments },
      };
      output.push({
        type: "function_call",
        id: itemId,
        call_id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
        status: "completed",
        extra_content: (tc as any).extra_content,
        thought_signature: (tc as any).thought_signature,
      } as any);
    }

    yield { type: "response.completed", response: { id: responseId, object: "response", status: "completed", output, output_text: fullText } };
  }

  return gen();
}

/** Non-streaming compat for dot-to-dot consults (setConsult in runtime.ts). */
export async function responsesCompat(
  client: OpenAI,
  params: { model: string; instructions: string; input: any[]; tools: any[]; max_output_tokens?: number },
  options?: { signal?: AbortSignal }
): Promise<any> {
  const messages = toMessages(params.instructions, params.input);
  const convertedTools = toTools(params.tools);

  const result: any = await (client.chat.completions as any).create(
    {
      model: params.model,
      messages,
      ...(convertedTools.length ? { tools: convertedTools } : {}),
      max_tokens: params.max_output_tokens ?? 2048,
    },
    options
  );

  const choice = result.choices?.[0];
  const text: string = choice?.message?.content ?? "";
  const tcList: any[] = choice?.message?.tool_calls ?? [];

  const output: any[] = [];
  if (text) output.push({ type: "message", role: "assistant", content: [{ type: "output_text", text }] });
  for (const tc of tcList) {
    output.push({ type: "function_call", call_id: tc.id, name: tc.function.name, arguments: tc.function.arguments });
  }

  return { id: `resp_cc_${Date.now()}`, output, output_text: text, status: "completed" };
}
