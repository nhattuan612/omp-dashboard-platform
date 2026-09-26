import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

const MAX_FRAME_BYTES = 64 * 1024 * 1024;
const STARTUP_TIMEOUT_MS = 15_000;

export class AcpWorker {
  constructor({ command, args, cwd, env = process.env }) {
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.env = env;
    this.child = null;
    this.status = "idle";
    this.startedAt = null;
    this.lastError = null;
    this.stderr = "";
    this.nextId = 0;
    this.pending = new Map();
    this.buffer = "";
    this.decoder = new StringDecoder("utf8");
    this.failure = null;
    this.startPromise = null;
    this.closedPromise = null;
    this.resolveClosed = null;
    this.stopping = false;
    this.onNotification = null;
    this.onRequest = null;
    this.onClose = null;
    this.closeNotified = false;
  }
  

  summary() {
    return {
      pid: this.child?.pid ?? null,
      status: this.status,
      startedAt: this.startedAt,
      lastError: this.lastError,
      stderr: this.stderr,
    };
  }

  async start() {
    if (this.status === "ready") return this.summary();
    if (this.failure) throw this.failure;
    if (this.startPromise) return this.startPromise;
    this.status = "starting";
    this.startedAt = Date.now();
    this.startPromise = this.#start().catch((error) => {
      this.startPromise = null;
      throw error;
    });
    return this.startPromise;
  }


  async #start() {
    try {
      const child = spawn(this.command, this.args, {
        cwd: this.cwd,
        env: this.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.child = child;
      this.closedPromise = new Promise((resolve) => { this.resolveClosed = resolve; });
      child.stdout.on("data", (chunk) => this.#read(chunk));
      child.stderr.on("data", (chunk) => {
        this.stderr = `${this.stderr}${chunk.toString()}`.slice(-4000);
      });
      child.on("error", (error) => this.#fail(error));
      child.on("close", (code, signal) => {
        this.resolveClosed?.(code);
        if (this.stopping) {
          this.status = "closed";
          this.#notifyClose(null);
        } else {
          this.#fail(new Error(`OMP ACP exited (${code ?? signal})`));
        }
      });
      await this.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: {
          terminal: false,
          auth: { terminal: false },
          elicitation: { form: {} },
        },
        clientInfo: { name: "OMP Web Console", version: "0.1.0" },
      }, STARTUP_TIMEOUT_MS);
      await this.request("authenticate", { methodId: "agent" }, STARTUP_TIMEOUT_MS);
      if (this.failure) throw this.failure;
      this.status = "ready";
      return this.summary();
    } catch (error) {
      this.#fail(error);
      if (this.child) await this.stop().catch(() => {});
      throw error;
    }
  }

  request(method, params = {}, timeoutMs = 120_000) {
    if (this.failure) return Promise.reject(this.failure);
    if (!this.child?.stdin?.writable) return Promise.reject(new Error("OMP ACP worker chưa chạy"));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      let timer;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.pending.delete(id);
          reject(Object.assign(new Error(`OMP ACP không phản hồi: ${method}`), { code: "UPSTREAM_TIMEOUT" }));
        }, timeoutMs);
        timer.unref?.();
      }
      this.pending.set(id, {
        method,
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.#write({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method, params = {}) {
    if (this.failure) throw this.failure;
    this.#write({ jsonrpc: "2.0", method, params });
  }

  respond(id, result) {
    this.#write({ jsonrpc: "2.0", id, result });
  }

  respondError(id, code, message) {
    this.#write({ jsonrpc: "2.0", id, error: { code, message } });
  }

  #write(frame) {
    if (!this.child?.stdin?.writable) throw new Error("OMP ACP worker chưa chạy");
    const line = JSON.stringify(frame);
    if (Buffer.byteLength(line) > MAX_FRAME_BYTES) throw new Error("ACP frame vượt giới hạn");
    this.child.stdin.write(`${line}\n`, (error) => {
      if (error) this.#fail(error);
    });
  }

  #read(chunk) {
    this.buffer += this.decoder.write(chunk);
    if (Buffer.byteLength(this.buffer) > MAX_FRAME_BYTES) {
      this.#fail(new Error("OMP ACP frame vượt giới hạn"));
      this.buffer = "";
      return;
    }
    let newline;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let frame;
      try { frame = JSON.parse(line); }
      catch {
        this.#fail(new Error("OMP ACP trả JSON không hợp lệ"));
        return;
      }
      if (frame.id != null && !frame.method) {
        const pending = this.pending.get(frame.id);
        if (!pending) continue;
        this.pending.delete(frame.id);
        if (frame.error) pending.reject(Object.assign(new Error(frame.error.message || `${pending.method} failed`), { code: "UPSTREAM_ERROR" }));
        else pending.resolve(frame.result);
        continue;
      }
      if (typeof frame.method !== "string") continue;
      if (frame.id != null) {
        if (typeof this.onRequest !== "function") {
          this.respondError(frame.id, -32601, "ACP method is not supported by this client");
          continue;
        }
        Promise.resolve(this.onRequest(frame, this)).then(
          (result) => this.respond(frame.id, result ?? {}),
          (error) => this.respondError(frame.id, -32603, error?.message || "ACP client request failed"),
        );
      } else {
        try { this.onNotification?.(frame); }
        catch (error) { this.#fail(error); return; }
      }
    }
  }

  #fail(error) {
    if (this.failure) return;
    this.failure = Object.assign(new Error("OMP ACP worker không thể tiếp tục"), { cause: error });
    this.lastError = this.failure.message;
    this.status = "error";
    for (const pending of this.pending.values()) pending.reject(this.failure);
    this.pending.clear();
    this.#notifyClose(this.failure);
  }

  #notifyClose(error) {
    if (this.closeNotified) return;
    this.closeNotified = true;
    this.onClose?.(error);
  }

  async stop() {
    if (!this.child) return;
    const child = this.child;
    this.stopping = true;
    child.kill("SIGTERM");
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 1500);
    timer.unref?.();
    await this.closedPromise;
    clearTimeout(timer);
    this.status = "closed";
  }
}
