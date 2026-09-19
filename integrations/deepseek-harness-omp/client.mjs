const DEFAULT_BASE_URL = "http://127.0.0.1:4177";

export class OmpGatewayError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "OmpGatewayError";
    this.status = status;
  }
}

function urlFor(baseUrl, path) {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

async function responseJson(response) {
  let body;
  try { body = await response.json(); }
  catch { body = {}; }
  if (!response.ok) throw new OmpGatewayError(body.message || `OMP Gateway HTTP ${response.status}`, response.status);
  return body;
}

async function* parseSse(response) {
  if (!response.body) throw new OmpGatewayError("OMP Gateway không trả SSE body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "message";
  let data = [];
  const emit = () => {
    if (!data.length) return null;
    const raw = data.join("\n");
    const payload = (() => { try { return JSON.parse(raw); } catch { return raw; } })();
    const result = { event, data: payload };
    event = "message";
    data = [];
    return result;
  };
  try {
    while (true) {
      const item = await reader.read();
      buffer += decoder.decode(item.value || new Uint8Array(), { stream: !item.done });
      let split;
      while ((split = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const block = buffer.slice(0, split);
        buffer = buffer.slice(split).replace(/^\r?\n\r?\n/, "");
        for (const line of block.split(/\r?\n/)) {
          if (!line || line.startsWith(":")) continue;
          const index = line.indexOf(":");
          const key = index < 0 ? line : line.slice(0, index);
          const value = index < 0 ? "" : line.slice(index + 1).replace(/^ /, "");
          if (key === "event") event = value;
          if (key === "data") data.push(value);
        }
        const result = emit();
        if (result) yield result;
      }
      if (item.done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

export function normalizeOmpEvent(event) {
  if (event.event === "bridge_status") return { type: "status", status: event.data.status, context: event.data };
  if (event.event === "bridge_error") return { type: "error", source: "bridge", message: event.data.message, raw: event.data };
  if (event.event === "omp_stderr") return { type: "activity", level: "error", label: "OMP stderr", text: event.data.text };
  const frame = event.data || {};
  if (frame.type === "ready") return { type: "status", status: "ready", protocolVersion: frame.protocolVersion };
  if (frame.type === "turn_start") return { type: "turn-start" };
  if (frame.type === "message_start") return { type: `${frame.message?.role || "message"}-start`, message: frame.message };
  if (frame.type === "message_end") return { type: `${frame.message?.role || "message"}-end`, message: frame.message };
  if (frame.type === "message_update") {
    const update = frame.assistantMessageEvent || {};
    if (update.type === "text_start") return { type: "text-start", index: update.contentIndex };
    if (update.type === "text_delta") return { type: "text-delta", index: update.contentIndex, text: update.delta || "" };
    if (update.type === "text_end") return { type: "text-end", index: update.contentIndex, text: update.content || "" };
    if (update.type === "thinking_start") return { type: "reasoning-start", index: update.contentIndex };
    if (update.type === "thinking_delta") return { type: "reasoning-delta", index: update.contentIndex, text: update.delta || "" };
    if (update.type === "thinking_end") return { type: "reasoning-end", index: update.contentIndex, text: update.content || "" };
    return { type: "activity", label: "message_update", raw: frame };
  }
  if (frame.type === "tool_execution_start") return { type: "tool-start", tool: frame.tool, raw: frame };
  if (frame.type === "tool_execution_end") return { type: "tool-end", tool: frame.tool, raw: frame };
  if (frame.type === "extension_ui_request") return { type: "extension-request", request: frame };
  if (frame.type === "turn_end" || frame.type === "agent_end") return { type: "finish", reason: "stop", raw: frame };
  if (frame.type === "error") return { type: "error", source: "omp", message: frame.message || "OMP error", raw: frame };
  if (frame.type === "response") return { type: "response", command: frame.command, success: frame.success, data: frame.data, raw: frame };
  return { type: "raw", raw: event };
}

function isReadyEvent(event) {
  return event?.event === "bridge_status" && event.data?.status === "ready"
    || event?.event === "omp" && event.data?.type === "ready";
}

export class OmpGatewayClient {
  constructor({ baseUrl = DEFAULT_BASE_URL, fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== "function") throw new Error("Node fetch không khả dụng");
    this.baseUrl = baseUrl;
    this.fetch = fetchImpl;
  }

  async capabilities() {
    return responseJson(await this.fetch(urlFor(this.baseUrl, "/api/omp/v1/capabilities")));
  }

  async createSession({ sessionId, cwd } = {}) {
    return responseJson(await this.fetch(urlFor(this.baseUrl, "/api/omp/v1/sessions"), {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, cwd }),
    }));
  }

  async getSession(sessionId) {
    return responseJson(await this.fetch(urlFor(this.baseUrl, `/api/omp/v1/sessions/${encodeURIComponent(sessionId)}`)));
  }

  async prompt(sessionId, message, { behavior = "prompt", useEgoBrowser = false, images } = {}) {
    return responseJson(await this.fetch(urlFor(this.baseUrl, `/api/omp/v1/sessions/${encodeURIComponent(sessionId)}/prompt`), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, behavior, useEgoBrowser, ...(images ? { images } : {}) }),
    }));
  }

  async command(sessionId, command) {
    return responseJson(await this.fetch(urlFor(this.baseUrl, `/api/omp/v1/sessions/${encodeURIComponent(sessionId)}/command`), {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command }),
    }));
  }

  async abort(sessionId) {
    return responseJson(await this.fetch(urlFor(this.baseUrl, `/api/omp/v1/sessions/${encodeURIComponent(sessionId)}/abort`), {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }));
  }

  async close(sessionId) {
    return responseJson(await this.fetch(urlFor(this.baseUrl, `/api/omp/v1/sessions/${encodeURIComponent(sessionId)}`), { method: "DELETE" }));
  }

  async *events(sessionId, { signal } = {}) {
    const response = await this.fetch(urlFor(this.baseUrl, `/api/omp/v1/sessions/${encodeURIComponent(sessionId)}/events`), { signal });
    if (!response.ok) throw new OmpGatewayError(`Không mở được SSE OMP Gateway (${response.status})`, response.status);
    yield* parseSse(response);
  }

  async *streamPrompt(sessionId, message, options = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      const events = this.events(sessionId, { signal: controller.signal });
      const iterator = events[Symbol.asyncIterator]();
      const buffered = [];
      while (true) {
        const item = await iterator.next();
        if (item.done) throw new OmpGatewayError("OMP context đóng trước khi sẵn sàng");
        buffered.push(item.value);
        if (item.value.event === "bridge_error" || item.value.event === "bridge_status" && item.value.data?.status === "error") {
          throw new OmpGatewayError(item.value.data?.message || item.value.data?.text || "OMP context lỗi");
        }
        if (isReadyEvent(item.value)) break;
      }
      await this.prompt(sessionId, message, options);
      for (const event of buffered) yield normalizeOmpEvent(event);
      let item = await iterator.next();
      while (!item.done) {
        const normalized = normalizeOmpEvent(item.value);
        yield normalized;
        if (normalized.type === "finish" || normalized.type === "error") return;
        item = await iterator.next();
      }
    } finally {
      options.signal?.removeEventListener("abort", abort);
      controller.abort();
    }
  }
}

export { DEFAULT_BASE_URL };
