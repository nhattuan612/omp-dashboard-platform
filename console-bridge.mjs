import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import { AcpWorker } from "./acp-worker.mjs";
import { AcpSessionContext } from "./acp-session-context.mjs";
const OMP_BIN = join(homedir(), ".bun/bin/omp");

const GEMINI_PIN_EXTENSION = join(dirname(fileURLToPath(import.meta.url)), "gemini-account-pin-extension.mjs");
const MAX_LINE_BYTES = 1_048_576;
const MAX_RAW_FRAMES = 300;
const MAX_WORKSPACE_FILE_BYTES = 512 * 1024;
const MAX_WORKSPACE_FILE_TEXT_CHARS = 200_000;
const SAFE_WORKSPACE_FILE_EXTENSIONS = new Set([".c", ".cc", ".cpp", ".css", ".csv", ".go", ".h", ".html", ".java", ".js", ".json", ".jsx", ".md", ".py", ".rs", ".sh", ".sql", ".toml", ".ts", ".tsx", ".txt", ".xml", ".yaml", ".yml"]);
const IDLE_CLOSE_MS = 15 * 60 * 1000;
const SAFETY_MIN_REQUEST_GAP_MS = 1_000;
const testSafetyCooldown = process.env.NODE_ENV === "test" ? Number(process.env.OMP_DASHBOARD_TEST_SAFETY_COOLDOWN_MS) : NaN;
const SAFETY_COOLDOWN_MS = Number.isSafeInteger(testSafetyCooldown) && testSafetyCooldown > 0
  ? [testSafetyCooldown]
  : [15 * 60 * 1000, 60 * 60 * 1000, 6 * 60 * 60 * 1000, 24 * 60 * 60 * 1000];
const SAFETY_WINDOW_MS = 10 * 60 * 1000;
const SAFETY_STATE_FILE = process.env.OMP_SAFETY_STATE_FILE || join(homedir(), ".omp", "usage-dashboard", "safety-state.json");
const MAX_RPC_REASSEMBLED_BYTES = 64 * 1024 * 1024;
const GENERAL_CHAT_CWD = process.env.OMP_DASHBOARD_GENERAL_WORKSPACE || join(homedir(), "Documents", "OMP General Chat");
const DEFAULT_WORKSPACE_ROOTS = [
  process.cwd(),
  process.env.OMP_DASHBOARD_WORKSPACE || "",
  GENERAL_CHAT_CWD,
  join(homedir(), "Documents", "CODE"),
];
const ALLOWED_WORKSPACE_ROOTS = [...new Set([
  ...DEFAULT_WORKSPACE_ROOTS,
  ...(process.env.OMP_ALLOWED_WORKSPACES || "").split(delimiter).filter(Boolean),
].filter(Boolean).map((value) => resolve(value)))];

function safeString(value, limit = 4000) {
  return String(value ?? "").slice(0, limit);
}

const SENSITIVE_PATH_PATTERN = /(?:secret|credential|token|password|cookie|private.?key)/i;
const BLOCKED_DIRECTORY_PATTERN = /^(backups?|quarantine|node_modules)$/i;

function isSafeWorkspaceDirectory(value) {
  const path = String(value || "").replace(/^@/, "").replace(/\\/g, "/").trim();
  if (!path) return false;
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every((part) => !part.startsWith(".") && !BLOCKED_DIRECTORY_PATTERN.test(part) && !SENSITIVE_PATH_PATTERN.test(part));
}

function isSafeWorkspaceFilePath(value) {
  const path = String(value || "").replace(/^@/, "").replace(/\\/g, "/").trim();
  if (!path) return false;
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return false;
  const name = parts[parts.length - 1];
  const extension = name.includes(".") ? `.${name.split(".").pop().toLowerCase()}` : "";
  if (!SAFE_WORKSPACE_FILE_EXTENSIONS.has(extension)) return false;
  return parts.every((part) => !part.startsWith(".") && !BLOCKED_DIRECTORY_PATTERN.test(part) && !SENSITIVE_PATH_PATTERN.test(part));
}

function redact(value, key = "") {
  if (/(token|secret|password|authorization|api[-_]?key|client[-_]?secret|cookie|code)/i.test(key)) {
    return "[redacted]";
  }
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redact(entryValue, entryKey)]));
  }
  return value;
}

function sse(res, event, payload) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function isGenerationCommand(type) {
  return type === "prompt" || type === "steer" || type === "follow_up" || type === "abort_retry";
}

function isProvider429(frame) {
  const message = frame?.message || {};
  const text = String(message.errorMessage || frame?.errorMessage || "");
  return Number(message.errorStatus || frame?.errorStatus) === 429 || /429|resource[_ ]exhausted|quota|rate limit/i.test(text);
}

class ProviderSafetyGuard {
  #enabled = true;
  #policyMode = "auto";
  #activeAccountProtected = true;
  #blockedUntil = 0;
  #consecutive429 = 0;
  #recent429At = [];
  #activeTurns = 0;
  #lastRequestAt = 0;
  #lastDecision = { code: "ready", at: Date.now(), message: "Safety Guard sẵn sàng" };

  constructor() {
    try {
      const state = JSON.parse(readFileSync(SAFETY_STATE_FILE, "utf8"));
      this.#blockedUntil = Number.isFinite(state.blockedUntil) ? state.blockedUntil : 0;
      this.#consecutive429 = Number.isFinite(state.consecutive429) ? state.consecutive429 : 0;
      this.#recent429At = Array.isArray(state.recent429At) ? state.recent429At.filter((at) => Number.isFinite(at)) : [];
      if (state.lastDecision && typeof state.lastDecision === "object") this.#lastDecision = state.lastDecision;
    } catch { /* first boot: no persisted provider state */ }
  }

  #persist() {
    try {
      mkdirSync(dirname(SAFETY_STATE_FILE), { recursive: true });
      writeFileSync(SAFETY_STATE_FILE, JSON.stringify({
        blockedUntil: this.#blockedUntil,
        consecutive429: this.#consecutive429,
        recent429At: this.#recent429At,
        lastDecision: this.#lastDecision,
      }));
    } catch { /* local safety telemetry must not stop the gateway */ }
  }

  setPolicy({ enabled = true, mode = "auto", activeAccountProtected = true } = {}) {
    const wasEnabled = this.isEnabled();
    this.#enabled = Boolean(enabled);
    this.#policyMode = mode === "manual" ? "manual" : "auto";
    this.#activeAccountProtected = Boolean(activeAccountProtected);
    if (wasEnabled && !this.isEnabled()) {
      this.#blockedUntil = 0;
      this.#consecutive429 = 0;
      this.#recent429At = [];
      this.#lastRequestAt = 0;
      this.#lastDecision = { code: "disabled", at: Date.now(), message: "Safety Guard đã tắt" };
    }
    this.#persist();
  }

  isEnabled() {
    return this.#enabled && this.#activeAccountProtected;
  }

  beforeRequest() {
    if (!this.isEnabled()) return;
    const now = Date.now();
    if (this.#blockedUntil > now) {
      const retryAt = new Date(this.#blockedUntil).toLocaleTimeString("vi-VN");
      throw new Error(`Google Safety Guard đang cooldown đến ${retryAt}; không retry, không đổi model, không đổi account.`);
    }
    if (this.#lastRequestAt && now - this.#lastRequestAt < SAFETY_MIN_REQUEST_GAP_MS) {
      const waitSeconds = Math.ceil((SAFETY_MIN_REQUEST_GAP_MS - (now - this.#lastRequestAt)) / 1000);
      throw new Error(`Google Safety Guard: còn ${waitSeconds}s trước request tiếp theo.`);
    }
  }

  startTurn() {
    this.#activeTurns += 1;
    if (!this.isEnabled()) return;
    this.#lastRequestAt = Date.now();
  }

  endTurn() {
    this.#activeTurns = Math.max(0, this.#activeTurns - 1);
  }

  on429() {
    if (!this.isEnabled()) return;
    const now = Date.now();
    this.#recent429At = this.#recent429At.filter((at) => now - at < SAFETY_WINDOW_MS);
    this.#recent429At.push(now);
    this.#consecutive429 += 1;
    const cooldown = SAFETY_COOLDOWN_MS[Math.min(this.#consecutive429 - 1, SAFETY_COOLDOWN_MS.length - 1)];
    this.#blockedUntil = Math.max(this.#blockedUntil, now + cooldown);
    this.#lastDecision = {
      code: "429_cooldown",
      at: now,
      retryAt: this.#blockedUntil,
      message: `Google trả 429; dừng request trong ${Math.ceil(cooldown / 60000)} phút`,
    };
    this.#persist();
  }


  onSuccess() {
    if (!this.isEnabled()) return;
    if (this.#blockedUntil <= Date.now()) {
      this.#consecutive429 = 0;
      this.#lastDecision = { code: "healthy", at: Date.now(), message: "Lượt chat gần nhất thành công" };
      this.#persist();
    }
  }

  summary() {
    const now = Date.now();
    const enabled = this.isEnabled();
    this.#recent429At = this.#recent429At.filter((at) => now - at < SAFETY_WINDOW_MS);
    return {
      mode: "protective",
      enabled: this.#enabled,
      policyMode: this.#policyMode,
      activeAccountProtected: this.#activeAccountProtected,
      autoRetry: false,
      modelSwitch: "manual_only",
      maxConcurrentTurns: null,

      activeTurns: this.#activeTurns,
      minRequestGapMs: enabled ? SAFETY_MIN_REQUEST_GAP_MS : 0,
      lastRequestAt: enabled && this.#lastRequestAt ? this.#lastRequestAt : null,
      nextRequestAt: enabled && this.#lastRequestAt ? this.#lastRequestAt + SAFETY_MIN_REQUEST_GAP_MS : null,
      blocked: enabled && this.#blockedUntil > now,
      blockedUntil: enabled && this.#blockedUntil > now ? this.#blockedUntil : null,
      recent429Count: this.#recent429At.length,
      consecutive429: this.#consecutive429,
      lastDecision: this.#lastDecision,
    };
  }
}

async function validCwd(value) {
  const cwd = typeof value === "string" && value.trim()
    ? value.trim()
    : (process.env.OMP_DASHBOARD_WORKSPACE || process.cwd());
  if (!isAbsolute(cwd)) throw new Error("cwd phải là đường dẫn tuyệt đối");
  const canonical = await realpath(cwd).catch(() => null);
  const info = canonical ? await stat(canonical).catch(() => null) : null;
  if (!info?.isDirectory()) throw new Error("cwd không tồn tại hoặc không phải thư mục");
  let allowed = false;
  for (const root of ALLOWED_WORKSPACE_ROOTS) {
    const canonicalRoot = await realpath(root).catch(() => root);
    if (canonical === canonicalRoot || canonical.startsWith(`${canonicalRoot}${sep}`)) {
      allowed = true;
      break;
    }
  }
  if (!allowed) throw Object.assign(new Error("cwd nằm ngoài workspace được phép"), { code: "FORBIDDEN", field: "cwd" });
  return canonical;
}

async function listAcpSessions(cwd, env = process.env) {
  const child = spawn(OMP_BIN, ["acp"], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "";
  const decoder = new StringDecoder("utf8");
  let nextId = 0;
  const pending = new Map();
  let stderr = "";
  let processFailure = null;
  let isClosed = false;
  const rejectAll = (error) => { for (const item of pending.values()) item.reject(error); pending.clear(); };
  const failProcess = () => {
    processFailure ||= Object.assign(new Error("OMP ACP không khả dụng"), { code: "UPSTREAM_UNAVAILABLE" });
    rejectAll(processFailure);
    return processFailure;
  };
  const closed = new Promise((resolve) => child.once("close", (code) => {
    isClosed = true;
    if (pending.size) failProcess();
    resolve(code);
  }));
  child.on("error", failProcess);
  child.stdin.on("error", failProcess);
  const timer = setTimeout(() => {
    failProcess();
    child.kill("SIGTERM");
  }, 15000);
  const response = (id, method, params) => new Promise((resolve, reject) => {
    const key = String(id);
    if (processFailure) return reject(processFailure);
    if (isClosed || !child.stdin?.writable) return reject(failProcess());
    pending.set(key, { resolve, reject, method });
    try {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`, (error) => {
        if (error) failProcess();
      });
    } catch {
      failProcess();
    }
  });
  child.stdout.on("data", (chunk) => {
    buffer += decoder.write(chunk);
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      try {
        const frame = JSON.parse(line);
        if (frame.id === undefined || frame.id === null) continue;
        const item = pending.get(String(frame.id));
        if (!item) continue;
        pending.delete(String(frame.id));
        if (frame.error) item.reject(new Error(frame.error.message || `${item.method} failed`));
        else item.resolve(frame.result);
      } catch {
        rejectAll(new Error("ACP trả frame không hợp lệ"));
      }
    }
  });
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-2000); });
  try {
    await response(nextId++, "initialize", {
      protocolVersion: 1,
      clientCapabilities: { terminal: false, auth: { terminal: false } },
      clientInfo: { name: "OMP Web Console", version: "0.1.0" },
    });
    await response(nextId++, "authenticate", { methodId: "agent" });
    const result = await response(nextId++, "_omp/sessions/listAll", { limit: 1000 });
    return { sessions: result?.sessions || [], total: result?.total || 0 };
  } catch (error) {
    if (error?.code === "UPSTREAM_UNAVAILABLE") throw error;
    throw new Error(`${error.message}${stderr ? ` (${safeString(stderr, 300)})` : ""}`);
  } finally {
    clearTimeout(timer);
    rejectAll(new Error("ACP session listing closed"));
    if (!isClosed) child.kill("SIGTERM");
    await closed;
  }
}

const OMP_TOOL_ID_RE = /^[a-z][a-z0-9_:-]{0,63}$/;
function normalizeTools(value) {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return [...new Set(items.map((item) => String(item || "").trim()).filter((item) => OMP_TOOL_ID_RE.test(item)))].slice(0, 64);
}

class ConsoleContext {
  constructor({ cwd, guard, onGenerationFinished, onSafetyChanged, onIdle, approvalMode = "always-ask", planYolo = false, planYoloModel = null, tools = [], env = process.env }) {
    this.id = randomUUID();
    this.cwd = cwd;
    this.approvalMode = ["always-ask", "write", "yolo"].includes(approvalMode) ? approvalMode : "always-ask";
    this.planYolo = planYolo === true;
    this.planYoloModel = this.planYolo && typeof planYoloModel === "string" ? planYoloModel : null;
    this.tools = normalizeTools(tools);
    this.env = env;
    this.guard = guard;
    this.onGenerationFinished = onGenerationFinished;
    this.onSafetyChanged = onSafetyChanged;
    this.onIdle = onIdle;
    this.child = null;
    this.status = "idle";
    this.protocolVersion = null;
    this.startedAt = null;
    this.lastEventAt = null;
    this.lastError = null;
    this.buffer = "";
    this.decoder = new StringDecoder("utf8");
    this.rpcChunkState = null;
    this.frames = [];
    this.clients = new Map();
    this.closeTimer = null;
    this.closedAt = null;
    this.stopping = false;
    this.activeTurn = false;
    this.lastPromptAt = 0;
    this.safetyConfigured = false;
  }

  summary() {
    const safety = this.guard.summary();
    const contextNextRequestAt = this.guard.isEnabled() && this.lastPromptAt ? this.lastPromptAt + SAFETY_MIN_REQUEST_GAP_MS : 0;
    return {
      id: this.id,
      cwd: this.cwd,
      status: this.status,
      pid: this.child?.pid ?? null,
      protocolVersion: this.protocolVersion,
      startedAt: this.startedAt,
      lastEventAt: this.lastEventAt,
      lastError: this.lastError,
      stderr: this.stderr,
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
    };
  }

  publicSummary() {
    const summary = this.summary();
    const { cwd, lastError, stderr, ...safe } = summary;
    return {
      ...safe,
      error: lastError ? { code: "BRIDGE_ERROR", message: "OMP context đang báo lỗi." } : null,
      stderr: stderr ? { code: "OMP_STDERR", message: "OMP context có lỗi nội bộ; chi tiết không được gửi tới browser." } : null,
    };
  }

  async start() {
    if (this.child) return this.summary();
    this.status = "starting";
    this.startedAt = Date.now();
    this.#broadcast("bridge_status", this.publicSummary());
    const args = ["--approval-mode", this.approvalMode, ...(this.planYolo ? ["--plan-yolo", `--plan=${this.planYoloModel}`, `--plan-yolo-into=${this.planYoloModel}`] : []), "--mode", "rpc", "--extension", GEMINI_PIN_EXTENSION];
    if (this.tools.length) args.push(`--tools=${this.tools.join(",")}`);
    const child = spawn(OMP_BIN, args, {
      cwd: this.cwd,
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stdout.on("data", (chunk) => this.#read(chunk));
    child.stderr.on("data", (chunk) => this.#readStderr(chunk));
    child.on("error", (error) => this.#fail(error));
    child.on("close", (code, signal) => {
      this.child = null;
      this.status = code === 0 || this.stopping ? "closed" : "error";
      this.closedAt = Date.now();
      if (code !== 0 && !this.stopping && !this.lastError) this.lastError = `OMP exited with ${code ?? signal}`;
      this.#broadcast("bridge_status", this.publicSummary());
    });
    return this.summary();
  }

  #writeFrame(frame) {
    const line = JSON.stringify(frame);
    if (Buffer.byteLength(line) > MAX_LINE_BYTES) throw new Error("RPC frame vượt quá 1 MB");
    this.child.stdin.write(`${line}\n`);
  }

  sendLocalCommand(frame) {
    if (!frame || frame.type !== "prompt" || !/^\/dashboard-gemini-pin acc-[a-f0-9]{12}$/.test(String(frame.message || ""))) {
      throw Object.assign(new Error("OMP local command không nằm trong danh sách nội bộ cho phép"), { code: "FORBIDDEN" });
    }
    if (!this.child?.stdin?.writable) throw new Error("OMP context chưa chạy");
    if (this.activeTurn) throw Object.assign(new Error("Không thể ghim account khi OMP đang xử lý lượt chat"), { code: "CONFLICT" });
    this.#writeFrame(frame);
  }

  send(frame) {
    if (!this.child?.stdin?.writable) throw new Error("OMP context chưa chạy");
    if (!frame || typeof frame !== "object" || Array.isArray(frame) || typeof frame.type !== "string") {
      throw new Error("RPC frame phải là object có type");
    }
    const now = Date.now();
    if (frame.type === "set_auto_retry" && frame.enabled === true) frame = { ...frame, enabled: false };
    const continuesActiveTurn = (frame.type === "steer" || frame.type === "follow_up") && this.activeTurn;
    if (isGenerationCommand(frame.type) && !continuesActiveTurn) {
      this.guard.beforeRequest();
      if (this.activeTurn) throw new Error("OMP context đang có lượt chat chạy; request phải vào hàng FIFO.");
      if (this.guard.isEnabled() && this.lastPromptAt && now - this.lastPromptAt < SAFETY_MIN_REQUEST_GAP_MS) {
        const waitSeconds = Math.ceil((SAFETY_MIN_REQUEST_GAP_MS - (now - this.lastPromptAt)) / 1000);
        throw new Error(`Google Safety Guard: chờ ${waitSeconds}s trước request tiếp theo.`);
      }
      this.guard.startTurn();
      this.lastPromptAt = now;
      this.activeTurn = true;
      this.onSafetyChanged?.();
    }
    this.#writeFrame(frame);
  }

  subscribe(clientId, res, { replay = true } = {}) {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.clients.set(clientId, res);
    if (replay) for (const frame of this.frames) sse(res, "omp", frame);
    sse(res, "bridge_status", this.publicSummary());
  }

  unsubscribe(clientId) {
    this.clients.delete(clientId);
    if (!this.clients.size && this.child) {
      this.closeTimer = setTimeout(() => this.stop().finally(() => this.onIdle?.(this.id)), IDLE_CLOSE_MS);
    }
  }

  async stop() {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.rpcChunkState = null;
    if (this.activeTurn) {
      this.activeTurn = false;
      this.guard.endTurn();
    }
    if (!this.child) {
      this.status = "closed";
      this.closedAt = this.closedAt || Date.now();
      this.#broadcast("bridge_status", this.publicSummary());
      return;
    }
    const child = this.child;
    this.stopping = true;
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    if (this.child === child && child.exitCode === null) child.kill("SIGKILL");
  }

  #decodeRpcFrame(frame) {
    if (frame?.type !== "rpc_chunk") return frame;
    const data = typeof frame.data === "string" ? frame.data : "";
    const validBase64 = data.length > 0 && data.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(data);
    const validShape = typeof frame.chunkId === "string"
      && frame.chunkId.length > 0
      && frame.chunkId.length <= 128
      && Number.isInteger(frame.index)
      && Number.isInteger(frame.count)
      && frame.index >= 0
      && frame.count > 0
      && frame.index < frame.count
      && Number.isInteger(frame.byteLength)
      && frame.byteLength > 0
      && frame.byteLength <= MAX_RPC_REASSEMBLED_BYTES;
    if (!validShape || !validBase64) {
      this.rpcChunkState = null;
      throw new Error("OMP gửi rpc_chunk không hợp lệ");
    }
    const chunk = Buffer.from(data, "base64");
    let state = this.rpcChunkState;
    if (!state) {
      if (frame.index !== 0) throw new Error("OMP gửi rpc_chunk bị thiếu chunk đầu tiên");
      state = { chunkId: frame.chunkId, count: frame.count, byteLength: frame.byteLength, nextIndex: 0, bytes: 0, chunks: [] };
      this.rpcChunkState = state;
    }
    if (state.chunkId !== frame.chunkId || state.count !== frame.count || state.byteLength !== frame.byteLength || state.nextIndex !== frame.index) {
      this.rpcChunkState = null;
      throw new Error("OMP gửi rpc_chunk bị xen kẽ hoặc sai thứ tự");
    }
    state.chunks.push(chunk);
    state.bytes += chunk.length;
    state.nextIndex += 1;
    if (state.bytes > state.byteLength || state.bytes > MAX_RPC_REASSEMBLED_BYTES) {
      this.rpcChunkState = null;
      throw new Error("OMP gửi rpc_chunk vượt giới hạn reassembly");
    }
    if (state.nextIndex < state.count) return null;
    if (state.bytes !== state.byteLength) {
      this.rpcChunkState = null;
      throw new Error("OMP gửi rpc_chunk thiếu dữ liệu");
    }
    const bytes = Buffer.concat(state.chunks, state.bytes);
    this.rpcChunkState = null;
    const text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes)) throw new Error("OMP rpc_chunk không phải UTF-8 hợp lệ");
    const decoded = JSON.parse(text);
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("OMP rpc_chunk không chứa JSON object");
    return decoded;
  }

  #read(chunk) {
    this.buffer += this.decoder.write(chunk);
    if (Buffer.byteLength(this.buffer) > MAX_LINE_BYTES * 2) {
      this.#fail(new Error("OMP gửi frame quá lớn hoặc thiếu newline"));
      this.buffer = "";
      return;
    }
    let newline;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      if (Buffer.byteLength(line) > MAX_LINE_BYTES) {
        this.#fail(new Error("OMP gửi frame vượt quá 1 MB"));
        continue;
      }
      try {
        const parsed = JSON.parse(line);
        const frame = this.#decodeRpcFrame(parsed);
        if (!frame) continue;
        if (frame.type === "ready") {
          this.status = "ready";
          this.protocolVersion = frame.protocolVersion ?? null;
          const supported = Array.isArray(frame.supportedProtocolVersions) ? frame.supportedProtocolVersions.map(Number) : [];
          if (supported.includes(2)) {
            this.send({ id: `negotiate-${Date.now()}`, type: "negotiate_protocol", protocolVersion: 2 });
          }
          if (!this.safetyConfigured) {
            this.safetyConfigured = true;
            this.send({ id: `safety-${Date.now()}`, type: "set_auto_retry", enabled: false });
          }
          this.#broadcast("bridge_status", this.publicSummary());
        }
        if (frame.type === "response" && frame.command === "negotiate_protocol" && frame.success && frame.data?.protocolVersion) {
          this.protocolVersion = Number(frame.data.protocolVersion);
          this.#broadcast("bridge_status", this.publicSummary());
        }
        if ((frame.type === "agent_start" || frame.type === "turn_start") && !this.activeTurn) {
          this.guard.startTurn();
          this.activeTurn = true;
        }
        const terminalAgentEnd = frame.type === "agent_end" && frame.isTerminal !== false;
        const localPromptResult = frame.type === "prompt_result" && frame.agentInvoked === false;
        const localPromptResponse = frame.type === "response" && frame.command === "prompt" && frame.success && frame.data?.agentInvoked === false;
        if (terminalAgentEnd || localPromptResult || localPromptResponse) {
          const wasActive = this.activeTurn;
          this.activeTurn = false;
          this.guard.endTurn();
          if (isProvider429(frame)) this.guard.on429();
          else if (frame.message?.role === "assistant" && frame.message?.stopReason !== "error") this.guard.onSuccess();
          this.onSafetyChanged?.();
          if (wasActive) this.onGenerationFinished?.({ frame, contextId: this.id });
        }
        this.#broadcast("omp", frame);
        if (isProvider429(frame)) this.#broadcast("bridge_status", this.publicSummary());
      } catch {
        this.rpcChunkState = null;
        this.#broadcast("bridge_error", { code: "INVALID_OMP_FRAME", message: "OMP gửi dữ liệu không phải JSON." });
      }
    }
  }

  #readStderr(chunk) {
    const text = safeString(chunk.toString(), 1000);
    this.stderr = `${this.stderr}${text}`.slice(-4000);
    this.#broadcast("omp_stderr", { code: "OMP_STDERR", message: "OMP context có lỗi nội bộ; chi tiết không được gửi tới browser." });
  }

  #fail(error) {
    this.status = "error";
    this.lastError = safeString(error?.message || error);
    this.#broadcast("bridge_error", { code: "BRIDGE_ERROR", message: "OMP context không thể tiếp tục." });
    this.#broadcast("bridge_status", this.publicSummary());
  }

  #broadcast(event, payload) {
    this.lastEventAt = Date.now();
    const safePayload = redact(payload);
    if (event === "omp") {
      this.frames.push(safePayload);
      if (this.frames.length > MAX_RAW_FRAMES) this.frames.shift();
    }
    for (const [clientId, res] of this.clients) {
      try {
        sse(res, event, safePayload);
      } catch {
        this.clients.delete(clientId);
      }
    }
  }
}

export class ConsoleBridge {
  #contexts = new Map();
  #acpWorkers = new Map();
  #clients = new Set();
  #guard = new ProviderSafetyGuard();
  #env = process.env;

  #onGenerationFinished;
  #onSafetyChanged;

  constructor({ onGenerationFinished, onSafetyChanged, env = process.env } = {}) {
    this.#env = env;
    this.#onGenerationFinished = onGenerationFinished;
    this.#onSafetyChanged = onSafetyChanged;
  }

  createClient() {
    const id = randomUUID();
    this.#clients.add(id);
    return id;
  }

  removeClient(clientId) {
    this.#clients.delete(clientId);
    for (const context of this.#contexts.values()) context.unsubscribe(clientId);
  }

  async start(body = {}) {
    const cwd = await validCwd(body.cwd);
    if (body.protocol === "acp") return this.#startAcp(body, cwd);
    const context = new ConsoleContext({ cwd, env: this.#env, guard: this.#guard, onGenerationFinished: this.#onGenerationFinished, onSafetyChanged: this.#onSafetyChanged, onIdle: (contextId) => this.#contexts.delete(contextId), approvalMode: body.approvalMode, planYolo: body.planYolo, planYoloModel: body.planYoloModel, tools: body.tools });
    this.#contexts.set(context.id, context);
    await context.start();
    return context.summary();
  }

  #acquireAcpWorker(cwd, approvalMode, planYolo, planYoloModel, tools) {
    const normalizedTools = [...tools].sort();
    const key = JSON.stringify({ cwd, approvalMode, planYolo: planYolo === true, planYoloModel: planYolo ? planYoloModel : null, tools: normalizedTools });
    let record = this.#acpWorkers.get(key);
    if (record && ["error", "closed"].includes(record.worker.status)) {
      this.#acpWorkers.delete(key);
      record = null;
    }
    if (!record) {
      const args = ["--approval-mode", approvalMode, ...(planYolo ? ["--plan-yolo", `--plan=${planYoloModel}`, `--plan-yolo-into=${planYoloModel}`] : []), "--extension", GEMINI_PIN_EXTENSION];
      if (normalizedTools.length) args.push(`--tools=${normalizedTools.join(",")}`);
      args.push("acp");
      const worker = new AcpWorker({ command: OMP_BIN, args, cwd, env: this.#env });
      record = { key, worker, sessions: new Map(), contexts: new Map(), idleTimer: null };
      worker.onNotification = (frame) => record.sessions.get(frame.params?.sessionId)?.onNotification(frame);
      worker.onRequest = (frame) => {
        const context = record.sessions.get(frame.params?.sessionId);
        if (!context) throw new Error("ACP session không tồn tại");
        return context.onRequest(frame);
      };
      worker.onClose = (error) => {
        clearTimeout(record.idleTimer);
        record.idleTimer = null;
        if (this.#acpWorkers.get(key) === record) this.#acpWorkers.delete(key);
        for (const context of record.contexts.values()) context.workerClosed(error);
      };
      this.#acpWorkers.set(key, record);
    }
    clearTimeout(record.idleTimer);
    record.idleTimer = null;
    return record;
  }

  #scheduleAcpWorkerStop(record) {
    clearTimeout(record.idleTimer);
    record.idleTimer = setTimeout(() => {
      if (record.contexts.size) return;
      if (this.#acpWorkers.get(record.key) === record) this.#acpWorkers.delete(record.key);
      void record.worker.stop();
    }, IDLE_CLOSE_MS);
    record.idleTimer.unref?.();
  }

  #releaseAcpContext(record, contextId) {
    this.#contexts.delete(contextId);
    record.contexts.delete(contextId);
    if (!record.contexts.size) this.#scheduleAcpWorkerStop(record);
  }

  #makeAcpContext(record, cwd, approvalMode, tools) {
    const context = new AcpSessionContext({
      cwd,
      approvalMode,
      tools,
      worker: record.worker,
      guard: this.#guard,
      onGenerationFinished: this.#onGenerationFinished,
      onSafetyChanged: this.#onSafetyChanged,
      broadcast: (target, event, payload, options) => this.#broadcastAcpContext(target, event, payload, options),
      registerSession: (sessionId, target) => record.sessions.set(sessionId, target),
      unregisterSession: (sessionId, target) => {
        if (record.sessions.get(sessionId) === target) record.sessions.delete(sessionId);
      },
      onIdle: (contextId) => this.#releaseAcpContext(record, contextId),
    });
    record.contexts.set(context.id, context);
    this.#contexts.set(context.id, context);
    return context;
  }

  #broadcastAcpContext(context, event, payload, { clientId = null, replay = false } = {}) {
    const safePayload = redact(payload);
    if (event === "omp" && !replay) {
      context.frames.push(safePayload);
      if (context.frames.length > MAX_RAW_FRAMES) context.frames.shift();
    }
    const clients = clientId ? [[clientId, context.clients.get(clientId)]] : context.clients;
    for (const [targetId, res] of clients) {
      if (!res) continue;
      try { sse(res, event, safePayload); }
      catch { context.clients.delete(targetId); }
    }
  }

  async #startAcp(body, cwd) {
    const approvalMode = ["always-ask", "write", "yolo"].includes(body.approvalMode) ? body.approvalMode : "always-ask";
    const tools = normalizeTools(body.tools);
    const planYolo = body.planYolo === true;
    const record = this.#acquireAcpWorker(cwd, approvalMode, planYolo, body.planYoloModel, tools);
    const context = this.#makeAcpContext(record, cwd, approvalMode, tools);
    try {
      await context.start({ sessionId: typeof body.ompSessionId === "string" ? body.ompSessionId : null });
      return context.summary();
    } catch (error) {
      await context.stop().catch(() => {});
      if (!record.contexts.size) {
        clearTimeout(record.idleTimer);
        record.idleTimer = null;
        if (this.#acpWorkers.get(record.key) === record) this.#acpWorkers.delete(record.key);
        await record.worker.stop().catch(() => {});
      }
      throw error;
    }
  }

  async prewarm(body = {}) {
    const cwd = await validCwd(body.cwd);
    const approvalMode = ["always-ask", "write", "yolo"].includes(body.approvalMode) ? body.approvalMode : "always-ask";
    const tools = normalizeTools(body.tools);
    const record = this.#acquireAcpWorker(cwd, approvalMode, body.planYolo === true, body.planYoloModel, tools);
    const worker = await record.worker.start();
    if (!record.contexts.size) this.#scheduleAcpWorkerStop(record);
    return { status: worker.status, pid: worker.pid };
  }

  async fork(contextId) {
    const source = this.get(contextId);
    if (!(source instanceof AcpSessionContext)) throw Object.assign(new Error("Chỉ hỗ trợ fork trên ACP session"), { code: "UNSUPPORTED_ACTION" });
    const record = [...this.#acpWorkers.values()].find((item) => item.worker === source.worker);
    if (!record) throw Object.assign(new Error("OMP ACP worker không còn tồn tại"), { code: "UPSTREAM_UNAVAILABLE" });
    const result = await source.fork();
    const context = this.#makeAcpContext(record, source.cwd, source.approvalMode, source.tools);
    context.startedAt = Date.now();
    await context.attachFork(result);
    context.broadcast(context, "bridge_status", context.publicSummary());
    return { sessionId: result.sessionId, context: context.summary() };
  }

  #stopAcpWorkers() {
    const workers = [...this.#acpWorkers.values()];
    return Promise.all(workers.map(async (record) => {
      clearTimeout(record.idleTimer);
      record.idleTimer = null;
      await record.worker.stop().catch(() => {});
      if (this.#acpWorkers.get(record.key) === record) this.#acpWorkers.delete(record.key);
    }));
  }

  async validateWorkspaceDirectory(value) {
    const result = await this.listWorkspaceDirectories(value);
    if (!result.currentPath) throw Object.assign(new Error("Cần chọn một thư mục workspace"), { code: "BAD_REQUEST", field: "cwd" });
    return result.currentPath;
  }

  async listWorkspaceDirectories(pathValue) {
    const roots = [];
    for (const root of ALLOWED_WORKSPACE_ROOTS) {
      const canonical = await realpath(root).catch(() => null);
      const info = canonical ? await stat(canonical).catch(() => null) : null;
      if (info?.isDirectory() && !roots.some((item) => item.path === canonical)) {
        roots.push({ path: canonical, name: basename(canonical) || canonical });
      }
    }
    if (!pathValue) return { roots, currentPath: null, parentPath: null, directories: [] };
    let currentPath;
    try { currentPath = await validCwd(pathValue); }
    catch (error) {
      if (error.code) throw error;
      throw Object.assign(new Error("Đường dẫn phải là thư mục workspace hợp lệ"), { code: "BAD_REQUEST", field: "path" });
    }
    const root = roots.find((item) => currentPath === item.path || currentPath.startsWith(`${item.path}${sep}`));
    if (!root) throw Object.assign(new Error("Thư mục nằm ngoài workspace được phép"), { code: "FORBIDDEN", field: "path" });
    const relativePath = relative(root.path, currentPath);
    if (relativePath && !isSafeWorkspaceDirectory(relativePath)) {
      throw Object.assign(new Error("Đường dẫn workspace chứa thư mục bị chặn"), { code: "FORBIDDEN", field: "path" });
    }
    const entries = await readdir(currentPath, { withFileTypes: true }).catch(() => []);
    const directories = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !isSafeWorkspaceDirectory(entry.name)) continue;
      const candidate = await realpath(join(currentPath, entry.name)).catch(() => null);
      if (!candidate) continue;
      const childRelative = relative(root.path, candidate);
      const info = await stat(candidate).catch(() => null);
      if (!info?.isDirectory() || childRelative.startsWith("..") || isAbsolute(childRelative) || !isSafeWorkspaceDirectory(childRelative)) continue;
      directories.push({ path: candidate, name: entry.name });
    }
    directories.sort((a, b) => a.name.localeCompare(b.name));
    return {
      roots,
      currentPath,
      parentPath: currentPath === root.path ? null : dirname(currentPath),
      directories,
    };
  }

  async listSessions(cwdValue) {
    const cwd = await validCwd(cwdValue || process.cwd());
    const result = await listAcpSessions(cwd, this.#env);
    if (!cwdValue) return result;
    const sessions = result.sessions.filter((session) => session.cwd === cwd);
    return { sessions, total: sessions.length };
  }

  async listFiles(contextId, mention = "@") {
    return this.listWorkspaceFiles(contextId, mention);
  }

  async readWorkspaceFile(contextId, value) {
    const context = this.get(contextId);
    const raw = String(value || "").trim().replace(/^@/, "").replace(/\\/g, "/");
    if (!raw || raw.startsWith("/") || raw.startsWith("~") || raw.startsWith("../") || raw.includes("\0")) throw Object.assign(new Error("Đường dẫn tệp workspace không hợp lệ"), { code: "BAD_REQUEST", field: "path" });
    const root = await realpath(context.cwd);
    const file = await realpath(resolve(root, raw)).catch(() => null);
    const rel = file ? relative(root, file) : "..";
    if (!file || rel.startsWith("..") || isAbsolute(rel)) throw Object.assign(new Error("Tệp nằm ngoài workspace"), { code: "FORBIDDEN", field: "path" });
    const info = await stat(file);
    if (!info.isFile()) throw Object.assign(new Error("Chỉ có thể tham chiếu tệp"), { code: "BAD_REQUEST", field: "path" });
    const relativePath = rel.replace(/\\/g, "/");
    const name = basename(file);
    if (!isSafeWorkspaceFilePath(raw) || !isSafeWorkspaceFilePath(relativePath)) throw Object.assign(new Error("Tệp này không được phép đính kèm"), { code: "FORBIDDEN", field: "path" });
    if (info.size > MAX_WORKSPACE_FILE_BYTES) throw Object.assign(new Error("Tệp vượt giới hạn 512 KB"), { code: "BAD_REQUEST", field: "path" });
    const bytes = await readFile(file);
    if (bytes.includes(0)) throw Object.assign(new Error("Chỉ hỗ trợ tệp văn bản"), { code: "BAD_REQUEST", field: "path" });
    const text = bytes.toString("utf8");
    if (text.includes("\ufffd")) throw Object.assign(new Error("Tệp không phải UTF-8 hợp lệ"), { code: "BAD_REQUEST", field: "path" });
    return { name, path: relativePath, type: "text/plain", size: bytes.length, text: text.slice(0, MAX_WORKSPACE_FILE_TEXT_CHARS), truncated: text.length > MAX_WORKSPACE_FILE_TEXT_CHARS, source: "workspace" };
  }

  async listWorkspaceFiles(contextId, mention = "@") {
    const context = this.get(contextId);
    const root = await realpath(context.cwd);
    const raw = String(mention || "@").replace(/^@/, "").replace(/\\/g, "/");
    if (raw.startsWith("/") || raw.startsWith("~") || raw.startsWith("../")) return { items: [] };
    const lastSlash = raw.lastIndexOf("/");
    const directory = lastSlash >= 0 ? raw.slice(0, lastSlash + 1) : "";
    const prefix = lastSlash >= 0 ? raw.slice(lastSlash + 1) : raw;
    const searchDir = await realpath(resolve(root, directory || ".")).catch(() => null);
    const rel = searchDir ? relative(root, searchDir) : "..";
    if (!searchDir || rel.startsWith("..") || isAbsolute(rel)) return { items: [] };
    const normalizedRel = rel.replace(/\\/g, "/");
    if (normalizedRel && normalizedRel !== "." && !isSafeWorkspaceDirectory(normalizedRel)) return { items: [] };
    const entries = await readdir(searchDir, { withFileTypes: true }).catch(() => []);
    const items = entries.filter((entry) => {
      if (!entry.name.toLowerCase().startsWith(prefix.toLowerCase())) return false;
      const entryRelPath = directory ? `${directory}${entry.name}` : entry.name;
      return entry.isDirectory() ? isSafeWorkspaceDirectory(entryRelPath) : isSafeWorkspaceFilePath(entryRelPath);
    }).map((entry) => {
      const value = `@${directory}${entry.name}${entry.isDirectory() ? "/" : ""}`;
      return { value, label: value, kind: entry.isDirectory() ? "folder" : "file", detail: entry.isDirectory() ? "thư mục" : "tệp" };
    });
    items.sort((a, b) => Number(b.kind === "folder") - Number(a.kind === "folder") || a.label.localeCompare(b.label));
    return { items: items.slice(0, 80) };
  }

  get(contextId) {
    const context = this.#contexts.get(contextId);
    if (!context) throw new Error("OMP context không tồn tại");
    return context;
  }

  subscribe(contextId, clientId, res, options) {
    if (!this.#clients.has(clientId)) throw new Error("Console client không tồn tại");
    this.get(contextId).subscribe(clientId, res, options);
  }

  send(contextId, frame) {
    return this.get(contextId).send(frame);
  }
  sendLocalCommand(contextId, frame) {
    return this.get(contextId).sendLocalCommand(frame);
  }


  async stop(contextId) {
    const context = this.get(contextId);
    await context.stop();
    const summary = context.summary();
    const publicSummary = context.publicSummary();
    this.#contexts.delete(contextId);
    return { ...summary, publicSummary };
  }

  publicSummary(contextId) {
    return this.get(contextId).publicSummary();
  }

  state() {
    return {
      ok: true,
      clients: this.#clients.size,
      safety: this.#guard.summary(),
      contexts: [...this.#contexts.values()].map((context) => context.publicSummary()),
      acpWorkers: [...this.#acpWorkers.values()].map(({ worker, contexts }) => ({ ...worker.summary(), contexts: contexts.size })),
    };
  }

  safety() {
    return this.#guard.summary();
  }

  updateSafetyPolicy(policy) {
    this.#guard.setPolicy(policy);
    this.#onSafetyChanged?.();
  }

  close() {
    const contexts = [...this.#contexts.values()];
    return Promise.all(contexts.map((context) => context.stop()))
      .finally(async () => {
        this.#contexts.clear();
        await this.#stopAcpWorkers();
      });
  }
}
