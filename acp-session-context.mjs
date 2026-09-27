import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { AcpWorker } from "./acp-worker.mjs";

const RESPONSE_TIMEOUT_MS = 10_000;
const MODEL_CONFIG_ID = "model";
const THINKING_CONFIG_ID = "thinking";

function contentText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => item?.text || "").filter(Boolean).join("\n");
  if (value && typeof value === "object") return value.text || "";
  return "";
}

function imageAttachments(value) {
  const blocks = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
  return blocks.flatMap((block) => {
    const type = String(block?.mimeType || block?.mime_type || block?.type || "").toLowerCase();
    const data = block?.data ?? block?.inlineData?.data ?? block?.inline_data?.data ?? "";
    if (!/^image\//.test(type) || typeof data !== "string" || !data) return [];
    return [{ type, data, ...(typeof block.name === "string" ? { name: block.name } : {}) }];
  });
}

function isImageGenerationTool(value) {
  return /(?:^|[\s:_-])(?:image[\s_-]?gen|generate[\s_-]?image(?:[\s_-]?asset)?|create[\s_-]?image|imagen)(?:$|[\s:_-])/i.test(String(value || ""));
}

function modelId(value) {
  return typeof value === "string" ? value.slice(value.indexOf("/") + 1) : "";
}

function modelProvider(value) {
  return typeof value === "string" && value.includes("/") ? value.slice(0, value.indexOf("/")) : "OMP";
}

function acpImage(value) {
  const match = typeof value === "string" && value.match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i);
  return match ? { type: "image", mimeType: match[1], data: match[2] } : null;
}

function jsonError(error) {
  return { code: error?.code || "UPSTREAM_ERROR", message: String(error?.message || "OMP ACP request failed").slice(0, 300) };
}

function promptResultError(result) {
  const error = result?.error && typeof result.error === "object" ? result.error : {};
  const message = result?.errorMessage ?? error.message ?? "";
  const status = Number(result?.errorStatus ?? error.status ?? error.statusCode);
  return {
    ...(message ? { message: String(message) } : {}),
    ...(Number.isFinite(status) ? { status } : {}),
  };
}

export class AcpSessionContext {
  constructor({
    cwd,
    approvalMode,
    tools,
    worker,
    guard,
    onGenerationFinished,
    onSafetyChanged,
    broadcast,
    registerSession,
    unregisterSession,
    onIdle,
  }) {
    this.id = randomUUID();
    this.cwd = cwd;
    this.approvalMode = approvalMode;
    this.tools = tools;
    this.worker = worker;
    this.guard = guard;
    this.onGenerationFinished = onGenerationFinished;
    this.onSafetyChanged = onSafetyChanged;
    this.broadcast = broadcast;
    this.registerSession = registerSession;
    this.unregisterSession = unregisterSession;
    this.onIdle = onIdle;
    this.status = "idle";
    this.startedAt = null;
    this.lastEventAt = null;
    this.lastError = null;
    this.closedAt = null;
    this.clients = new Map();
    this.frames = [];
    this.closeTimer = null;
    this.stopping = false;
    this.sessionId = null;
    this.sessionIds = new Set();
    this.messageCount = 0;
    this.commands = [];
    this.commandUpdatePromise = null;
    this.resolveCommandUpdate = null;
    this.configOptions = [];
    this.assistantContent = [];
    this.promptAgentInvoked = false;
    this.agentTurnStarted = false;
    this.activeTurn = false;
    this.lastPromptAt = 0;
    this.pendingFollowUps = 0;
    this.followUpFailed = false;
    this.pendingElicitations = new Map();
    this.activeLocalCommand = null;
    this.localCommandOutput = "";
    this.commandQueue = Promise.resolve();
  }

  async start({ sessionId = null } = {}) {
    if (this.status === "ready") return this.summary();
    this.status = "starting";
    this.startedAt = Date.now();
    this.#emit("bridge_status", this.publicSummary());
    try {
      await this.worker.start();
      if (sessionId) await this.#loadSession(sessionId);
      else await this.#newSession();
      this.status = "ready";
      this.#emit("bridge_status", this.publicSummary());
      return this.summary();
    } catch (error) {
      this.status = "error";
      this.lastError = String(error?.message || error).slice(0, 300);
      this.#emit("bridge_error", { code: "BRIDGE_ERROR", message: "OMP ACP session không thể khởi tạo." });
      this.#emit("bridge_status", this.publicSummary());
      throw error;
    }
  }

  #resetCommandBootstrap() {
    this.commands = [];
    this.commandUpdatePromise = new Promise((resolve) => { this.resolveCommandUpdate = resolve; });
  }

  async #waitForCommandBootstrap() {
    if (!this.commandUpdatePromise) return;
    let timer;
    await Promise.race([
      this.commandUpdatePromise,
      new Promise((resolve) => { timer = setTimeout(resolve, 250); }),
    ]);
    clearTimeout(timer);
    this.commandUpdatePromise = null;
    this.resolveCommandUpdate = null;
  }

  summary() {
    const safety = this.guard.summary();
    const contextNextRequestAt = this.lastPromptAt ? this.lastPromptAt + 1000 : 0;
    return {
      id: this.id,
      cwd: this.cwd,
      status: this.status,
      pid: this.worker.summary().pid,
      protocolVersion: 1,
      startedAt: this.startedAt,
      lastEventAt: this.lastEventAt,
      lastError: this.lastError,
      stderr: this.worker.summary().stderr,
      clients: this.clients.size,
      closedAt: this.closedAt,
      safety: {
        ...safety,
        approvalMode: this.approvalMode,
        activeTurn: this.activeTurn,
        lastPromptAt: this.lastPromptAt || null,
        nextRequestAt: Math.max(safety.nextRequestAt || 0, contextNextRequestAt) || null,
      },
      tools: this.tools,
      protocol: "acp",
      sessionId: this.sessionId,
    };
  }

  publicSummary() {
    const { cwd, lastError, stderr, ...safe } = this.summary();
    return {
      ...safe,
      error: lastError ? { code: "BRIDGE_ERROR", message: "OMP context đang báo lỗi." } : null,
      stderr: stderr ? { code: "OMP_STDERR", message: "OMP context có lỗi nội bộ; chi tiết không được gửi tới browser." } : null,
    };
  }

  subscribe(clientId, res, { replay = true } = {}) {
    clearTimeout(this.closeTimer);
    this.closeTimer = null;
    this.clients.set(clientId, res);
    if (replay) for (const frame of this.frames) this.broadcast(this, "omp", frame, { clientId, replay: true });
    this.broadcast(this, "bridge_status", this.publicSummary(), { clientId });
  }

  unsubscribe(clientId) {
    this.clients.delete(clientId);
    if (!this.clients.size && this.status !== "closed") {
      clearTimeout(this.closeTimer);
      this.closeTimer = setTimeout(() => { void this.stop(); }, 15 * 60 * 1000);
      this.closeTimer.unref?.();
    }
  }

  sendLocalCommand(frame) {
    if (!frame || frame.type !== "prompt" || !/^\/dashboard-gemini-pin acc-[a-f0-9]{12}$/.test(String(frame.message || ""))) {
      throw Object.assign(new Error("OMP local command không nằm trong danh sách nội bộ cho phép"), { code: "FORBIDDEN" });
    }
    if (this.activeTurn) throw Object.assign(new Error("Không thể ghim account khi OMP đang xử lý lượt chat"), { code: "CONFLICT" });
    return this.send(frame);
  }

  send(frame) {
    if (this.status !== "ready" || !this.sessionId) throw Object.assign(new Error("OMP ACP session chưa chạy"), { code: "UPSTREAM_UNAVAILABLE" });
    if (!frame || typeof frame !== "object" || Array.isArray(frame) || typeof frame.type !== "string") throw new Error("RPC frame phải là object có type");
    if (frame.type === "abort") {
      this.worker.notify("session/cancel", { sessionId: this.sessionId });
      return;
    }
    if (frame.type === "extension_ui_response") return this.#answerElicitation(frame);
    if (frame.type === "steer") throw Object.assign(new Error("ACP chuẩn không hỗ trợ steering giữa lượt; có thể gửi follow-up sau khi lượt hiện tại kết thúc."), { code: "UNSUPPORTED_ACTION" });
    const isFollowUp = frame.type === "follow_up";
    if (isFollowUp) this.pendingFollowUps += 1;
    const operation = this.commandQueue.then(() => this.#handleCommand(frame, isFollowUp));
    this.commandQueue = operation.catch((error) => {
      if (isFollowUp) {
        this.pendingFollowUps = Math.max(0, this.pendingFollowUps - 1);
        if (!this.pendingFollowUps && !this.activeTurn) {
          this.followUpFailed = false;
          this.guard.endTurn();
          this.onSafetyChanged?.();
        }
      }
      this.#respond(frame, false, null, error);
    });
    return operation;

  }
  onNotification(frame) {
    if (frame?.method !== "session/update" || frame.params?.sessionId !== this.sessionId) return;
    const update = frame.params.update || {};
    this.configOptions = update.configOptions || this.configOptions;
    switch (update.sessionUpdate) {
      case "available_commands_update":
        this.commands = Array.isArray(update.availableCommands) ? update.availableCommands : [];
        this.resolveCommandUpdate?.();
        this.resolveCommandUpdate = null;
        this.#emit("omp", { type: "available_commands_update", commands: this.commands });
        break;
      case "config_option_update":
        this.configOptions = Array.isArray(update.configOptions) ? update.configOptions : this.configOptions;
        this.#emit("omp", { type: "config_option_update", configOptions: this.configOptions });
        break;
      case "agent_message_chunk":
        this.#appendContent(update.content);
        if (this.activeLocalCommand) {
          if (update.content?.type === "text") this.localCommandOutput += update.content.text || "";
          break;
        }
        this.promptAgentInvoked = true;
        if (this.activeTurn) this.#startAgentTurn();
        if (update.content?.type === "text" && update.content.text) {
          this.#emit("omp", { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: update.content.text } });
        }
        break;
      case "agent_thought_chunk":
        this.promptAgentInvoked = true;
        if (this.activeTurn) this.#startAgentTurn();
        this.#emit("omp", { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: update.content?.text || "" } });
        break;
      case "tool_call":
        this.promptAgentInvoked = true;
        if (this.activeTurn) this.#startAgentTurn();
        this.#toolCall(update);
        break;
      case "tool_call_update":
        this.#toolCallUpdate(update);
        break;
      case "plan":
        this.#emit("omp", { type: "todo_reminder", todos: update.entries || [] });
        break;
      case "session_info_update":
        this.#emit("omp", { type: "session_info_update", title: update.title, cwd: update.cwd });
        break;
      case "usage_update":
        this.lastUsage = update;
        break;
    }
  }

  async onRequest(frame) {
    const params = frame.params || {};
    if (params.sessionId !== this.sessionId) throw new Error("ACP session ID không khớp");
    if (frame.method === "elicitation/create") {
      this.#emit("omp", this.#elicitationFrame(frame));
      return new Promise((resolve) => this.pendingElicitations.set(String(frame.id), { resolve, request: frame }));
    }
    if (frame.method === "session/request_permission") {
      const options = Array.isArray(params.options) ? params.options : [];
      this.#emit("omp", {
        type: "extension_ui_request",
        id: String(frame.id),
        method: "select",
        title: params.toolCall?.title || "OMP cần quyền thực thi",
        message: params.toolCall?.title || "Cho phép OMP tiếp tục?",
        options: options.map((item) => item.name || item.optionId),
        toolCallId: params.toolCall?.toolCallId,
        toolName: params.toolCall?.title,
      });
      return new Promise((resolve) => this.pendingElicitations.set(String(frame.id), { resolve, request: frame, permissionOptions: options }));
    }
    throw Object.assign(new Error(`ACP client request không được hỗ trợ: ${frame.method}`), { code: "UNSUPPORTED_ACTION" });
  }

  async stop() {
    if (this.status === "closed") return this.summary();
    this.stopping = true;
    clearTimeout(this.closeTimer);
    this.closeTimer = null;
    if (this.activeTurn && this.sessionId) {
      this.worker.notify("session/cancel", { sessionId: this.sessionId });
      this.activeTurn = false;
      this.guard.endTurn();
      this.onSafetyChanged?.();
    }
    for (const pending of this.pendingElicitations.values()) {
      pending.resolve({ action: "cancel" });
    }
    this.pendingElicitations.clear();
    await Promise.all([...this.sessionIds].map(async (sessionId) => {
      await this.worker.request("session/close", { sessionId }, 3000).catch(() => {});
      this.unregisterSession(sessionId, this);
    }));
    this.sessionIds.clear();
    this.sessionId = null;
    this.status = "closed";
    this.onIdle?.(this.id);
    this.#emit("bridge_status", this.publicSummary());
    return this.summary();
  }

  workerClosed(error) {
    if (this.stopping || this.status === "closed") return;
    this.status = "error";
    this.lastError = String(error?.message || "OMP ACP worker exited").slice(0, 300);
    if (this.activeTurn) {
      this.activeTurn = false;
      this.guard.endTurn();
      this.onSafetyChanged?.();
    }
    for (const pending of this.pendingElicitations.values()) pending.resolve({ action: "cancel" });
    this.pendingElicitations.clear();
    this.#emit("bridge_error", { code: "UPSTREAM_ERROR", message: "OMP ACP worker không thể tiếp tục." });
    this.#emit("bridge_status", this.publicSummary());
  }

  async #newSession() {
    this.#resetCommandBootstrap();
    const result = await this.worker.request("session/new", { cwd: this.cwd, mcpServers: [] }, RESPONSE_TIMEOUT_MS);
    if (typeof result?.sessionId !== "string" || !result.sessionId) throw new Error("OMP ACP không trả sessionId mới");
    this.#attachSession(result.sessionId, result.configOptions);
    await this.#waitForCommandBootstrap();
  }

  async #loadSession(sessionId) {
    this.#resetCommandBootstrap();
    const result = await this.worker.request("session/load", { sessionId, cwd: this.cwd, mcpServers: [] }, RESPONSE_TIMEOUT_MS);
    this.#attachSession(sessionId, result?.configOptions);
    await this.#waitForCommandBootstrap();
  }

  #attachSession(sessionId, configOptions) {
    this.sessionId = sessionId;
    this.sessionIds.add(sessionId);
    this.registerSession(sessionId, this);
    if (Array.isArray(configOptions)) {
      this.configOptions = configOptions;
      this.currentModel = configOptions.find((item) => item.id === MODEL_CONFIG_ID)?.currentValue || this.currentModel;
      this.currentThinking = configOptions.find((item) => item.id === THINKING_CONFIG_ID)?.currentValue || this.currentThinking;
    }
  }

  async fork() {
    if (!this.sessionId) throw new Error("ACP session chưa sẵn sàng để fork");
    const result = await this.worker.request("session/fork", { sessionId: this.sessionId, cwd: this.cwd, mcpServers: [] }, RESPONSE_TIMEOUT_MS);
    if (typeof result?.sessionId !== "string" || !result.sessionId) throw new Error("OMP ACP không trả sessionId đã fork");
    return result;
  }

  async attachFork(result) {
    this.#resetCommandBootstrap();
    this.#attachSession(result.sessionId, result.configOptions);
    this.status = "ready";
    await this.#waitForCommandBootstrap();
  }

  async #handleCommand(frame, isFollowUp = false) {
    switch (frame.type) {
      case "get_state":
        return this.#respond(frame, true, { sessionId: this.sessionId, messageCount: this.messageCount });
      case "get_available_commands":
        return this.#respond(frame, true, { commands: this.commands });
      case "get_available_models":
        return this.#respond(frame, true, { models: this.#models() });
      case "get_subagents":
        throw Object.assign(new Error("Danh sách subagents chưa được chuẩn hóa trong ACP của OMP"), { code: "UNSUPPORTED_ACTION" });
      case "prompt":
      case "follow_up":
        return this.#prompt(frame, { isFollowUp });
      case "set_model":
        return this.#setConfig(frame, MODEL_CONFIG_ID, `${frame.provider || modelProvider(frame.modelId)}/${modelId(frame.modelId)}`);
      case "set_thinking_level":
        return this.#setConfig(frame, THINKING_CONFIG_ID, frame.level === "none" ? "off" : frame.level);
      case "switch_session":
        return this.#switchSession(frame);
      case "new_session":
      case "set_auto_retry":
        throw Object.assign(new Error("ACP mỗi chat dùng một context riêng; command này không được hỗ trợ."), { code: "UNSUPPORTED_ACTION" });
      case "get_session_stats":
      case "get_messages":
        throw Object.assign(new Error(`${frame.type} chưa được chuẩn hóa trong ACP của OMP`), { code: "UNSUPPORTED_ACTION" });
      default:
        throw Object.assign(new Error(`OMP RPC command chưa có ánh xạ ACP: ${frame.type}`), { code: "UNSUPPORTED_ACTION" });
    }
  }

  async #setConfig(frame, configId, value) {
    await this.worker.request("session/set_config_option", { sessionId: this.sessionId, configId, value }, RESPONSE_TIMEOUT_MS);
    if (configId === MODEL_CONFIG_ID) this.currentModel = value;
    if (configId === THINKING_CONFIG_ID) this.currentThinking = value;
    return this.#respond(frame, true, { value });
  }

  async #switchSession(frame) {
    let sessionId = "";
    if (typeof frame.sessionPath === "string") {
      const firstLine = (await readFile(frame.sessionPath, "utf8")).split("\n", 1)[0];
      const record = JSON.parse(firstLine);
      sessionId = record.type === "session" ? record.id : "";
    }
    if (!sessionId) throw Object.assign(new Error("Không đọc được OMP session ID để khôi phục ACP"), { code: "NOT_FOUND" });
    await this.#loadSession(sessionId);
    return this.#respond(frame, true, { sessionId, sessionFile: frame.sessionPath || null });
  }


  async #prompt(frame, { isFollowUp = false } = {}) {
    const prompt = [];
    const text = String(frame.message || "");
    if (text) prompt.push({ type: "text", text });
    for (const image of Array.isArray(frame.images) ? frame.images : []) {
      const value = acpImage(image);
      if (value) prompt.push(value);
    }
    if (!prompt.length) throw Object.assign(new Error("Prompt ACP rỗng"), { code: "BAD_REQUEST" });
    if (this.activeTurn) throw Object.assign(new Error("ACP session đã có lượt đang chạy"), { code: "CONFLICT" });
    if (isFollowUp && this.followUpFailed) throw Object.assign(new Error("Follow-up trước đó thất bại"), { code: "UPSTREAM_ERROR" });
    const commandMatch = /^\/([\w:-]+)/.exec(text);
    const commandName = commandMatch?.[1];
    this.activeLocalCommand = ["memory", "dashboard-gemini-pin"].includes(commandName)
      && this.commands.some((item) => item.name === commandName) ? commandName : null;
    this.localCommandOutput = "";
    const now = Date.now();
    if (!isFollowUp) {
      this.guard.beforeRequest();
      if (this.guard.isEnabled() && this.lastPromptAt && now - this.lastPromptAt < 1000) {
        throw Object.assign(new Error(`Google Safety Guard: chờ ${Math.ceil((1000 - (now - this.lastPromptAt)) / 1000)}s trước request tiếp theo.`), { code: "RATE_LIMITED" });
      }
      this.guard.startTurn();
      this.lastPromptAt = now;
    }
    this.activeTurn = true;
    this.promptAgentInvoked = false;
    this.agentTurnStarted = false;
    this.assistantContent = [];
    this.lastUsage = null;
    this.onSafetyChanged?.();
    try {
      const result = await this.worker.request("session/prompt", { sessionId: this.sessionId, prompt }, 0);
      if (this.activeLocalCommand) {
        const output = this.localCommandOutput || contentText(result?.content) || this.assistantContent.map((item) => item.text || "").join("");
        if (this.activeLocalCommand === "memory") this.#emit("omp", { type: "command_output", command: "memory", text: output });
        this.promptAgentInvoked = false;
        this.localCommandOutput = "";
        this.activeLocalCommand = null;
      } else if (!this.promptAgentInvoked && (!commandMatch || !this.commands.some((item) => item.name === commandName))) {
        this.promptAgentInvoked = true;
        this.#startAgentTurn();
      }
      this.messageCount += this.promptAgentInvoked ? 2 : 1;
      if (this.promptAgentInvoked) {
        const usage = this.#normalizeUsage(result?.usage || this.lastUsage);
        const promptError = promptResultError(result);
        const message = {
          role: "assistant",
          content: this.assistantContent,
          model: modelId(this.currentModel) || null,
          provider: modelProvider(this.currentModel),
          stopReason: result?.stopReason === "error" ? "error" : "end_turn",
          ...(promptError.message ? { errorMessage: promptError.message } : {}),
          ...(promptError.status != null ? { errorStatus: promptError.status } : {}),
          ...(usage ? { usage } : {}),
        };
        this.#emit("omp", { type: "message_end", message });
        this.#emit("omp", { type: "agent_end", message, isTerminal: true });
      }
      this.#emit("omp", { type: "prompt_result", id: frame.id, agentInvoked: this.promptAgentInvoked });
      this.#respond(frame, true, { ...(result || {}), agentInvoked: this.promptAgentInvoked });
      this.#finishTurn({
        frame: {
          type: this.promptAgentInvoked ? "agent_end" : "prompt_result",
          message: { role: "assistant", stopReason: result?.stopReason || "end_turn" },
          isTerminal: true,
        },
        isFollowUp,
      });
    } catch (error) {
      this.activeLocalCommand = null;
      this.localCommandOutput = "";
      this.#respond(frame, false, null, error);
      this.#finishTurn({
        frame: {
          type: "agent_end",
          message: { role: "assistant", stopReason: "error", errorMessage: jsonError(error).message, errorStatus: Number(error?.status) || undefined },
          isTerminal: true,
        },
        isFollowUp,
      });
    }
  }

  #startAgentTurn() {
    if (this.agentTurnStarted) return;
    this.agentTurnStarted = true;
    this.#emit("omp", { type: "agent_start" });
  }

  #appendContent(content) {
    if (!content || typeof content !== "object") return;
    if (content.type === "text" && typeof content.text === "string") {
      this.assistantContent.push({ type: "text", text: content.text });
    } else if (content.type === "image" && typeof content.data === "string") {
      this.assistantContent.push({ type: "image", data: content.data, mimeType: content.mimeType });
    }
  }
  #normalizeUsage(usage) {
    if (!usage || typeof usage !== "object") return null;
    const input = Number(usage.inputTokens ?? usage.input ?? 0);
    const output = Number(usage.outputTokens ?? usage.output ?? 0);
    const total = Number(usage.totalTokens ?? usage.total ?? input + output);
    return [input, output, total].every(Number.isFinite) && total > 0 ? { input, output, total } : null;
  }

  #models() {
    const config = this.configOptions.find((item) => item.id === MODEL_CONFIG_ID);
    return (config?.options || []).map((option) => ({
      id: modelId(option.value),
      name: option.name || option.value,
      provider: modelProvider(option.value),
      isDefault: option.value === config.currentValue,
      imageGeneration: /image|imagen/i.test(`${option.value} ${option.name || ""}`),
      ...(option.description ? { description: option.description } : {}),
    })).filter((item) => item.id);
  }

  #respond(frame, success, data, error) {
    this.#emit("omp", {
      type: "response",
      id: frame.id,
      command: frame.type,
      success,
      ...(success ? { data } : { error: jsonError(error) }),
    });
    return data;
  }

  #finishTurn({ frame, isFollowUp = false }) {
    const wasActive = this.activeTurn;
    this.activeTurn = false;
    this.agentTurnStarted = false;
    const failure = frame?.message?.stopReason === "error";
    const rateLimited = frame?.message?.errorStatus === 429 || /429|resource[_ ]exhausted|quota|rate limit/i.test(String(frame?.message?.errorMessage || ""));
    if (rateLimited) this.guard.on429();
    else if (!failure) this.guard.onSuccess();
    if (isFollowUp) {
      this.pendingFollowUps = Math.max(0, this.pendingFollowUps - 1);
      if (failure) this.followUpFailed = true;
    } else if (failure && this.pendingFollowUps) this.followUpFailed = true;
    if (!this.pendingFollowUps) {
      this.followUpFailed = false;
      this.guard.endTurn();
    }
    this.onSafetyChanged?.();
    if (wasActive) this.onGenerationFinished?.({ frame, contextId: this.id });
  }

  #toolCall(update) {
    const id = String(update.toolCallId || "");
    if (!id) return;
    const name = String(update.title || update.kind || "tool");
    const call = { id, name, arguments: update.rawInput ?? {}, intent: update.title || name };
    this.assistantContent.push({ type: "toolCall", ...call });
    this.#emit("omp", { type: "tool_call", toolName: name, toolCallId: id, args: call.arguments, intent: call.intent, status: update.status || "running" });
    this.#emit("omp", { type: "tool_execution_start", toolName: name, toolCallId: id, args: call.arguments, intent: call.intent });
  }

  #toolCallUpdate(update) {
    const id = String(update.toolCallId || "");
    const name = String(update.title || update.kind || "tool");
    const failed = update.status === "failed";
    if (update.status === "completed" || failed) {
      const output = update.rawOutput ?? update.content;
      const attachments = isImageGenerationTool(name) ? imageAttachments(output) : [];
      this.#emit("omp", { type: "tool_execution_end", toolName: name, toolCallId: id, result: contentText(output), isError: failed || update.isError === true, ...(attachments.length ? { attachments } : {}) });
    } else {
      this.#emit("omp", { type: "tool_execution_update", toolName: name, toolCallId: id, partialResult: contentText(update.rawOutput) || contentText(update.content), status: update.status });
    }
  }

  #elicitationFrame(frame) {
    const params = frame.params || {};
    const schema = params.requestedSchema || {};
    const properties = schema.properties || {};
    const property = properties.value || Object.values(properties)[0] || {};
    const options = Array.isArray(property.enum) ? property.enum.map(String) : [];
    const method = options.length ? "select" : property.type === "boolean" ? "confirm" : "input";
    const message = String(params.message || "OMP cần xác nhận");
    const [title, ...rest] = message.split("\n");
    return {
      type: "extension_ui_request",
      id: String(frame.id),
      method,
      title: (rest.length ? title : "OMP cần xác nhận").slice(0, 300),
      message: (rest.length ? rest.join("\n").trim() : message).slice(0, 4000),
      ...(options.length ? { options } : {}),
      ...(typeof property.default === "string" ? { defaultValue: property.default } : {}),
      ...(typeof property.description === "string" ? { placeholder: property.description } : {}),
    };
  }

  #answerElicitation(frame) {
    const pending = this.pendingElicitations.get(String(frame.id));
    if (!pending) throw Object.assign(new Error("Yêu cầu ACP không còn hiệu lực"), { code: "NOT_FOUND" });
    this.pendingElicitations.delete(String(frame.id));
    let response;
    if (pending.permissionOptions) {
      const selected = pending.permissionOptions.find((option) => option.name === frame.value || option.optionId === frame.value);
      response = frame.cancelled ? { outcome: { outcome: "cancelled" } } : selected ? { outcome: { outcome: "selected", optionId: selected.optionId } } : { outcome: { outcome: "cancelled" } };
    } else if (frame.cancelled) response = { action: "cancel" };
    else {
      const value = frame.confirmed != null ? frame.confirmed : frame.value;
      response = { action: "accept", content: { value } };
    }
    pending.resolve(response);
  }


  #emit(event, payload) {
    this.lastEventAt = Date.now();
    this.broadcast(this, event, payload);
  }
}
