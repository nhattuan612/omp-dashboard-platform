import { LlmAdapter, LlmError } from "@deepseek-ai/dsh-llm";
import { OmpGatewayClient, OmpGatewayError } from "./client.mjs";

export const name = "llm-omp-gateway";
export const inject = ["llm"];

const DEFAULT_PROVIDER = "omp-google-pro";
const DEFAULT_MODEL = "gemini-3.8-flash";

function textFromMessage(message) {
  return (message?.content || [])
    .map((block) => block?.type === "text" ? block.text : "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function latestUserPrompt(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user" || message.source?.kind === "tool") continue;
    const text = textFromMessage(message);
    if (text) return text;
  }
  throw new LlmError("OMP Gateway không nhận được user prompt mới", "INVALID_REQUEST");
}

function usageFromRaw(raw) {
  const usage = raw?.message?.usage;
  if (!usage) return null;
  return {
    inputTokens: Number(usage.input || 0),
    outputTokens: Number(usage.output || 0),
    totalTokens: Number(usage.total || 0),
    ...(Number(usage.cacheRead || 0) > 0 ? { cacheReadTokens: Number(usage.cacheRead) } : {}),
    ...(Number(usage.cacheWrite || 0) > 0 ? { cacheWriteTokens: Number(usage.cacheWrite) } : {}),
  };
}

class OmpAdapter extends LlmAdapter {
  constructor(config) {
    super();
    this.provider = config.provider || DEFAULT_PROVIDER;
    this.model = config.model || DEFAULT_MODEL;
    this.cwd = config.cwd || process.cwd();
    this.client = new OmpGatewayClient({ baseUrl: config.baseUrl || "http://127.0.0.1:4177" });
  }

  providerInfo(provider) {
    return { id: provider, name: "OMP · Gemini Pro" };
  }

  async listModels(provider) {
    return [{ provider, id: this.model, name: this.model, description: "OMP quản lý Google Antigravity/Gemini Pro" }];
  }

  async resolveModel(provider, model) {
    return { provider, id: model || this.model, name: model || this.model };
  }

  async *stream(options) {
    const sessionId = String(options.sessionId || "dsh-default");
    const prompt = latestUserPrompt(options.messages);
    const session = await this.client.createSession({ sessionId, cwd: this.cwd });
    const images = options.messages.at(-1)?.content
      ?.filter((block) => block?.type === "image")
      .map((block) => ({ mimeType: block.mimeType, data: block.data })) || [];
    let sawText = false;
    try {
      for await (const event of this.client.streamPrompt(session.sessionId, prompt, {
        signal: options.signal,
        ...(images.length ? { images } : {}),
      })) {
        if (event.type === "text-start") {
          yield { type: "block-start", index: event.index ?? 0, blockType: "text" };
          sawText = true;
        } else if (event.type === "text-delta") {
          yield { type: "text-delta", index: event.index ?? 0, text: event.text };
        } else if (event.type === "text-end") {
          yield { type: "block-end", index: event.index ?? 0, block: { type: "text", text: event.text } };
        } else if (event.type === "response") {
          const usage = usageFromRaw(event.raw);
          if (usage) yield { type: "usage", usage };
        } else if (event.type === "error") {
          throw new LlmError(event.message || "OMP Gateway error", "OMP_GATEWAY_ERROR");
        } else if (event.type === "finish") {
          yield { type: "finish", reason: options.signal?.aborted ? { kind: "aborted", failure: { message: "OMP request aborted", code: "ABORTED" } } : { kind: "stop" } };
          return;
        }
      }
      if (sawText) yield { type: "finish", reason: { kind: "stop" } };
      else throw new LlmError("OMP không trả về nội dung", "EMPTY_RESPONSE");
    } catch (error) {
      if (error instanceof LlmError) throw error;
      if (error instanceof OmpGatewayError) throw new LlmError(error.message, "OMP_GATEWAY_ERROR", { cause: error });
      throw error;
    }
  }
}

export function apply(ctx, config = {}) {
  const provider = config.provider || DEFAULT_PROVIDER;
  ctx.llm.registerAdapter([provider], new OmpAdapter({ ...config, provider }));
}
