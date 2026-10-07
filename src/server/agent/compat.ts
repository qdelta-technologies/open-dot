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
      const toolCall = {
        id: item.call_id,
        type: "function",
        function: { name: item.name, arguments: item.arguments },
      };
      if (prev?.role === "assistant" && !prev.tool_calls) {
        prev.tool_calls = [toolCall];
        if (!prev.content) prev.content = null;
      } else if (prev?.role === "assistant" && prev.tool_calls) {
        prev.tool_calls.push(toolCall);
      } else {
        msgs.push({ role: "assistant", content: null, tool_calls: [toolCall] });
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
    const toolCalls: Record<number, { id: string; name: string; arguments: string }> = {};
    const toolItemIds: Record<number, string> = {};

    for await (const chunk of ccStream) {
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};

      if (delta.content) {
        fullText += delta.content;
        yield { type: "response.output_text.delta", item_id: messageId, delta: delta.content };
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx: number = tc.index ?? 0;
          if (!(idx in toolCalls)) {
            const id = tc.id ?? `call_${idx}_${Date.now()}`;
            const itemId = `fc_${id}`;
            toolCalls[idx] = { id, name: tc.function?.name ?? "", arguments: "" };
            toolItemIds[idx] = itemId;
            yield {
              type: "response.output_item.added",
              item: { type: "function_call", id: itemId, call_id: id, name: tc.function?.name ?? "" },
            };
          }
          if (tc.function?.name && !toolCalls[idx].name) toolCalls[idx].name = tc.function.name;
          if (tc.function?.arguments) {
            toolCalls[idx].arguments += tc.function.arguments;
            yield { type: "response.function_call_arguments.delta", item_id: toolItemIds[idx], delta: tc.function.arguments };
          }
        }
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
      output.push({ type: "function_call", id: itemId, call_id: tc.id, name: tc.name, arguments: tc.arguments, status: "completed" });
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
