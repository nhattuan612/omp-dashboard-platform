import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute } from "node:path";

const OMP_BIN = process.env.OMP_BIN || `${homedir()}/.bun/bin/omp`;
const MAX_LINE_BYTES = 1_048_576;
const MAX_RAW_FRAMES = 300;
const IDLE_CLOSE_MS = 15 * 60 * 1000;

function safeString(value, limit = 4000) {
  return String(value ?? "").slice(0, limit);
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

async function validCwd(value) {
  const cwd = typeof value === "string" && value.trim() ? value.trim() : process.cwd();
  if (!isAbsolute(cwd)) throw new Error("cwd phải là đường dẫn tuyệt đối");
  const info = await stat(cwd).catch(() => null);
  if (!info?.isDirectory()) throw new Error("cwd không tồn tại hoặc không phải thư mục");
  return cwd;
}

async function listAcpSessions(cwd) {
  const child = spawn(OMP_BIN, ["acp"], { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "";
  let nextId = 0;
  const pending = new Map();
  let stderr = "";
  const timer = setTimeout(() => child.kill("SIGTERM"), 15000);
  const response = (id, method, params) => new Promise((resolve, reject) => {
    pending.set(String(id), { resolve, reject, method });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  const rejectAll = (error) => { for (const item of pending.values()) item.reject(error); pending.clear(); };
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
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
  const closed = new Promise((resolve) => child.on("close", (code) => resolve(code)));
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
    throw new Error(`${error.message}${stderr ? ` (${safeString(stderr, 300)})` : ""}`);
  } finally {
    clearTimeout(timer);
    rejectAll(new Error("ACP session listing closed"));
    child.kill("SIGTERM");
    await closed;
  }
}

class ConsoleContext {
  constructor({ cwd }) {
    this.id = randomUUID();
    this.cwd = cwd;
    this.child = null;
    this.status = "idle";
    this.protocolVersion = null;
    this.startedAt = null;
    this.lastEventAt = null;
    this.lastError = null;
    this.stderr = "";
    this.buffer = "";
    this.frames = [];
    this.clients = new Map();
    this.closeTimer = null;
    this.closedAt = null;
    this.stopping = false;
  }

  summary() {
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
    };
  }

  async start() {
    if (this.child) return this.summary();
    this.status = "starting";
    this.startedAt = Date.now();
    this.#broadcast("bridge_status", this.summary());
    const child = spawn(OMP_BIN, ["--mode", "rpc"], {
      cwd: this.cwd,
      env: process.env,
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
      this.#broadcast("bridge_status", this.summary());
    });
    return this.summary();
  }

  send(frame) {
    if (!this.child?.stdin?.writable) throw new Error("OMP context chưa chạy");
    if (!frame || typeof frame !== "object" || Array.isArray(frame) || typeof frame.type !== "string") {
      throw new Error("RPC frame phải là object có type");
    }
    const line = JSON.stringify(frame);
    if (Buffer.byteLength(line) > MAX_LINE_BYTES) throw new Error("RPC frame vượt quá 1 MB");
    this.child.stdin.write(`${line}\n`);
  }

  subscribe(clientId, res) {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.clients.set(clientId, res);
    for (const frame of this.frames) sse(res, "omp", frame);
    sse(res, "bridge_status", this.summary());
  }

  unsubscribe(clientId) {
    this.clients.delete(clientId);
    if (!this.clients.size && this.child) {
      this.closeTimer = setTimeout(() => this.stop(), IDLE_CLOSE_MS);
    }
  }

  async stop() {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    if (!this.child) {
      this.status = "closed";
      this.closedAt = this.closedAt || Date.now();
      this.#broadcast("bridge_status", this.summary());
      return;
    }
    const child = this.child;
    this.stopping = true;
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    if (this.child === child && child.exitCode === null) child.kill("SIGKILL");
  }

  #read(chunk) {
    this.buffer += chunk.toString();
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
        const frame = JSON.parse(line);
        if (frame.type === "ready") {
          this.status = "ready";
          this.protocolVersion = frame.protocolVersion ?? null;
        }
        this.#broadcast("omp", frame);
      } catch {
        this.#broadcast("bridge_error", { message: "OMP gửi dữ liệu không phải JSON", raw: safeString(line) });
      }
    }
  }

  #readStderr(chunk) {
    const text = safeString(chunk.toString(), 1000);
    this.stderr = `${this.stderr}${text}`.slice(-4000);
    this.#broadcast("omp_stderr", { text });
  }

  #fail(error) {
    this.status = "error";
    this.lastError = safeString(error?.message || error);
    this.#broadcast("bridge_error", { message: this.lastError });
    this.#broadcast("bridge_status", this.summary());
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
  #clients = new Set();

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
    const context = new ConsoleContext({ cwd });
    this.#contexts.set(context.id, context);
    await context.start();
    return context.summary();
  }

  async listSessions(cwdValue) {
    const cwd = await validCwd(cwdValue || process.cwd());
    const result = await listAcpSessions(cwd);
    if (!cwdValue) return result;
    const sessions = result.sessions.filter((session) => session.cwd === cwd);
    return { sessions, total: sessions.length };
  }

  get(contextId) {
    const context = this.#contexts.get(contextId);
    if (!context) throw new Error("OMP context không tồn tại");
    return context;
  }

  subscribe(contextId, clientId, res) {
    if (!this.#clients.has(clientId)) throw new Error("Console client không tồn tại");
    this.get(contextId).subscribe(clientId, res);
  }

  send(contextId, frame) {
    return this.get(contextId).send(frame);
  }

  async stop(contextId) {
    const context = this.get(contextId);
    await context.stop();
    return context.summary();
  }

  state() {
    return { ok: true, clients: this.#clients.size, contexts: [...this.#contexts.values()].map((context) => context.summary()) };
  }

  close() {
    return Promise.all([...this.#contexts.values()].map((context) => context.stop()));
  }
}
