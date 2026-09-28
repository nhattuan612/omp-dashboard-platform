#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { createInterface } from "node:readline";
import { appendFile, mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";

const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(PROJECT_ROOT, "server.mjs");
const FAKE_OMP_FLAG = "--fake-omp";
const TEST_APPROVAL_TIMEOUT_MS = 3000;
const LAUNCHD_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const HOMEBREW_BIN_PATHS = ["/opt/homebrew/bin", "/usr/local/bin"];

function homePath(home, ...parts) {
  return join(home, ".omp", ...parts);
}

async function readFakeSessions(home) {
  try {
    const parsed = JSON.parse(await readFile(homePath(home, "test-sessions.json"), "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeFakeSessions(home, sessions) {
  const path = homePath(home, "test-sessions.json");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(sessions)}\n`, { mode: 0o600 });
}

async function writeFakeMemoryBackend(cwd, backend) {
  const directory = join(cwd, ".omp");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, "memory-backend"), `${backend}\n`, { mode: 0o600 });
}

async function readFakeMemoryBackend(cwd = process.cwd()) {
  try { return (await readFile(join(cwd, ".omp", "memory-backend"), "utf8")).trim() || "off"; }
  catch { return "off"; }
}

async function setFakeMemoryMode(home, mode) {
  await writeFile(homePath(home, "memory-command-mode.txt"), `${mode}\n`, { mode: 0o600 });
}

async function readFakeMemoryMode(home) {
  try { return (await readFile(homePath(home, "memory-command-mode.txt"), "utf8")).trim(); }
  catch { return "normal"; }
}
async function readFakeFrames(home) {
  const directory = homePath(home, "test-frames");
  const files = await readdir(directory).catch(() => []);
  const frames = [];
  for (const file of files.filter((name) => name.endsWith(".jsonl"))) {
    const content = await readFile(join(directory, file), "utf8").catch(() => "");
    for (const line of content.split(/\r?\n/)) {
      if (!line) continue;
      try { frames.push(JSON.parse(line)); } catch {}
    }
  }
  return frames;
}

async function waitForFakeFrame(home, predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frame = (await readFakeFrames(home)).find(predicate);
    if (frame) return frame;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for the expected fake OMP frame");
}

function createSseReader(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  async function next(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const boundary = buffer.search(/\r?\n\r?\n/);
      if (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, "");
        let event = "message";
        const data = [];
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        }
        if (!data.length) continue;
        const parsed = JSON.parse(data.join("\n"));
        return { event, data: parsed };
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("Timed out waiting for an SSE event");
      let timer;
      const chunk = await Promise.race([
        reader.read(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Timed out waiting for an SSE event")), remaining); }),
      ]).finally(() => clearTimeout(timer));
      if (chunk.done) throw new Error("SSE stream closed before the expected event");
      buffer += decoder.decode(chunk.value, { stream: true });
    }
  }

  return {
    next,
    async waitFor(predicate, label, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        let event;
        try { event = await next(deadline - Date.now()); }
        catch (error) { throw new Error(`${label}: ${error.message}`); }
        if (event.event === "error") throw new Error(`${label}: ${JSON.stringify(event.data)}`);
        if (predicate(event)) return event;
      }
      throw new Error(`Timed out waiting for ${label}`);
    },
    cancel() { return reader.cancel(); },
  };
}


async function seedOmpSession(home, sessionId, cwd, title) {
  const sessionRoot = homePath(home, "agent", "sessions");
  await mkdir(sessionRoot, { recursive: true, mode: 0o700 });
  const path = join(sessionRoot, `fixture_${sessionId}.jsonl`);
  const now = new Date().toISOString();
  const lines = [
    { type: "session", id: sessionId, cwd, timestamp: now },
    { type: "title", title },
  ];
  await writeFile(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, { mode: 0o600 });
  const sessions = await readFakeSessions(home);
  if (!sessions.some((item) => item.sessionId === sessionId)) {
    sessions.push({ sessionId, cwd, title, updatedAt: now, _meta: { messageCount: 0 } });
    await writeFakeSessions(home, sessions);
  }
  return path;
}
async function seedUsageRecord(home, sessionId, { pinHash = null, provider, model, input, output, timestamp = new Date().toISOString(), pinTimestamp = timestamp, errorStatus = null, content = null }) {
  const sessionRoot = homePath(home, "agent", "sessions");
  await mkdir(sessionRoot, { recursive: true, mode: 0o700 });
  const records = [
    { type: "session", id: sessionId, cwd: process.cwd(), timestamp },
    ...(pinHash ? [{ type: "credential_pin", hash: pinHash, timestamp: pinTimestamp }] : []),
    {
      type: "message",
      id: `usage-${sessionId}`,
      timestamp,
      message: {
        role: "assistant",
        provider,
        model,
        ...(errorStatus != null ? { errorStatus } : {}),
        ...(content ? { content } : {}),
        usage: { input, output, totalTokens: input + output },
        completedAt: timestamp,
      },
    },
  ];
  const path = join(sessionRoot, `usage_${sessionId}.jsonl`);
  await writeFile(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, { mode: 0o600 });
  return path;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
async function writeUtf8SplitFrame(frame) {
  const bytes = Buffer.from(`${JSON.stringify(frame)}\n`);
  const marker = Buffer.from("🧪");
  const markerOffset = bytes.indexOf(marker);
  if (markerOffset < 0) throw new Error("UTF-8 split fixture marker is missing");
  const write = (chunk) => new Promise((resolve, reject) => {
    process.stdout.write(chunk, (error) => error ? reject(error) : resolve());
  });
  await write(bytes.subarray(0, markerOffset + 1));
  await new Promise((resolve) => setTimeout(resolve, 25));
  await write(bytes.subarray(markerOffset + 1));
}

async function freePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  if (port === 4177) throw new Error("Refusing to use the production dashboard port");
  return port;
}

async function fakeOmp(args) {
  if (args[0] === "usage") {
    await writeFile(join(process.env.HOME, "test-omp-path.txt"), `${process.env.PATH || ""}\n`, { mode: 0o600 });
    const failurePath = homePath(process.env.HOME || "", "usage-dashboard", "test-usage-stderr.txt");
    try {
      const diagnostic = (await readFile(failurePath, "utf8")).trim();
      process.stderr.write(`${diagnostic}\n`);
      process.exitCode = 7;
      return;
    } catch {}
    try {
      await readFile(homePath(process.env.HOME || "", "usage-dashboard", "test-empty-usage.txt"), "utf8");
      process.stdout.write(`${JSON.stringify({ reports: [], accountsWithoutUsage: [], disabledCredentials: [], capacity: {} })}\n`);
      return;
    } catch {}
    let disabledCredentials = [];
    try {
      const fixture = JSON.parse(await readFile(homePath(process.env.HOME || "", "usage-dashboard", "test-disabled-credentials.json"), "utf8"));
      if (Array.isArray(fixture)) disabledCredentials = fixture;
    } catch { /* optional fixture */ }
    process.stdout.write(`${JSON.stringify({ reports: [
      { provider: "google-antigravity", metadata: { email: "smoke-google@example.test" }, limits: [
        { id: "gemini-smoke-5h", label: "Gemini 5h", window: { id: "5h", label: "5h", durationMs: 18000000 }, amount: { used: 10, usedFraction: 0.1, remaining: 90, limit: 100 } },
        { id: "gemini-smoke-weekly", label: "Gemini Weekly", window: { id: "weekly", label: "weekly", durationMs: 604800000 }, amount: { used: 15, usedFraction: 0.15, remaining: 85, limit: 100 } },
        { id: "shared-smoke-5h", label: "Claude & GPT (shared) 5h", window: { id: "5h", label: "5h", durationMs: 18000000 }, amount: { used: 25, usedFraction: 0.25, remaining: 75, limit: 100 } },
        { id: "shared-smoke-weekly", label: "Claude & GPT (shared) Weekly", window: { id: "weekly", label: "weekly", durationMs: 604800000 }, amount: { used: 35, usedFraction: 0.35, remaining: 65, limit: 100 } },
      ] },
      { provider: "google-antigravity", metadata: { email: "smoke-google-alt@example.test" }, limits: [
        { id: "gemini-alt-5h", label: "Gemini 5h", window: { id: "5h", label: "5h", durationMs: 18000000 }, amount: { used: 12, usedFraction: 0.12, remaining: 88, limit: 100 } },
        { id: "gemini-alt-weekly", label: "Gemini Weekly", window: { id: "weekly", label: "weekly", durationMs: 604800000 }, amount: { used: 18, usedFraction: 0.18, remaining: 82, limit: 100 } },
        { id: "shared-alt-5h", label: "Claude & GPT (shared) 5h", window: { id: "5h", label: "5h", durationMs: 18000000 }, amount: { used: 22, usedFraction: 0.22, remaining: 78, limit: 100 } },
        { id: "shared-alt-weekly", label: "Claude & GPT (shared) Weekly", window: { id: "weekly", label: "weekly", durationMs: 604800000 }, amount: { used: 32, usedFraction: 0.32, remaining: 68, limit: 100 } },
      ] },
      { provider: "google-antigravity", metadata: { email: "smoke-usage-only@example.test" }, limits: [
        { id: "usage-google-daily", label: "Usage (Google)", window: { id: "daily", label: "daily", durationMs: 86400000 }, amount: { used: 10, usedFraction: 0.1, remaining: 90, limit: 100 } },
      ] },
      { provider: "google-antigravity", metadata: { email: "smoke-daily-full@example.test" }, limits: [
        { id: "usage-google-daily", label: "Usage (Google)", window: { id: "daily", label: "daily", durationMs: 86400000 }, amount: { used: 10, usedFraction: 0.1, remaining: 90, limit: 100 } },
        { id: "usage-anthropic-daily", label: "Usage (Anthropic)", window: { id: "daily", label: "daily", durationMs: 86400000 }, amount: { used: 20, usedFraction: 0.2, remaining: 80, limit: 100 } },
        { id: "usage-openai-daily", label: "Usage (OpenAI)", window: { id: "daily", label: "daily", durationMs: 86400000 }, amount: { used: 30, usedFraction: 0.3, remaining: 70, limit: 100 } },
      ] },
      { provider: "google-antigravity", metadata: { email: "smoke-missing-week@example.test" }, limits: [
        { id: "gemini-only-five-hour", label: "Gemini 5h", window: { id: "5h", label: "5h", durationMs: 18000000 }, amount: { used: 10, usedFraction: 0.1, remaining: 90, limit: 100 } },
      ] },
      { provider: "google-antigravity", metadata: { email: "smoke-missing-5h@example.test" }, limits: [
        { id: "gemini-only-weekly", label: "Gemini Weekly", window: { id: "weekly", label: "weekly", durationMs: 604800000 }, amount: { used: 10, usedFraction: 0.1, remaining: 90, limit: 100 } },
      ] },
      { provider: "google-antigravity", metadata: { email: "smoke-gemini-only@example.test" }, limits: [
        { id: "gemini-only-5h", label: "Gemini 5h", window: { id: "5h", label: "5h", durationMs: 18000000 }, amount: { used: 10, usedFraction: 0.1, remaining: 90, limit: 100 } },
        { id: "gemini-only-weekly", label: "Gemini Weekly", window: { id: "weekly", label: "weekly", durationMs: 604800000 }, amount: { used: 10, usedFraction: 0.1, remaining: 90, limit: 100 } },
      ] },
      { provider: "google-antigravity", metadata: { email: "smoke-shared-only@example.test" }, limits: [
        { id: "shared-only-5h", label: "Claude & GPT (shared) 5h", window: { id: "5h", label: "5h", durationMs: 18000000 }, amount: { used: 10, usedFraction: 0.1, remaining: 90, limit: 100 } },
        { id: "shared-only-weekly", label: "Claude & GPT (shared) Weekly", window: { id: "weekly", label: "weekly", durationMs: 604800000 }, amount: { used: 10, usedFraction: 0.1, remaining: 90, limit: 100 } },
      ] },
      { provider: "google-gemini-cli", metadata: { email: "smoke-cli@example.test" }, limits: [
        { id: "gemini-cli-smoke-5h", label: "Gemini 5h", window: { id: "5h", label: "5h", durationMs: 18000000 }, amount: { used: 12, usedFraction: 0.12, remaining: 88, limit: 100 } },
        { id: "gemini-cli-smoke-weekly", label: "Gemini Weekly", window: { id: "weekly", label: "weekly", durationMs: 604800000 }, amount: { used: 22, usedFraction: 0.22, remaining: 78, limit: 100 } },
      ] },
      { provider: "openai-codex", metadata: { email: "smoke-google@example.test" }, limits: [{ id: "codex-smoke-5h", label: "GPT 5h", window: { id: "5h", label: "5h", durationMs: 18000000 }, amount: { used: 10, usedFraction: 0.1, remaining: 90, limit: 100 } }] },
    ], accountsWithoutUsage: [], disabledCredentials, capacity: {} })}\n`);
    return;
  }
  if (args[0] === "auth-gateway" && args[1] === "check") {
    try {
      process.stdout.write(await readFile(homePath(process.env.HOME || "", "usage-dashboard", "test-broker-usage.json"), "utf8"));
    } catch {
      process.stdout.write(`${JSON.stringify({ credentials: [] })}\n`);
    }
    return;
  }
  if (args[0] === "config" && args[1] === "get" && args[2] === "memory.backend") {
    process.stdout.write(`${await readFakeMemoryBackend()}\n`);
    return;
  }
  if (args[0] === "config" && args.includes("list")) {
    process.stdout.write(`${JSON.stringify({
      "grep.enabled": { value: true },
      "glob.enabled": { value: true },
      "bash.enabled": { value: true },
      "eval.js": { value: true },
      "lsp.enabled": { value: true },
      "debug.enabled": { value: true },
      "web_search.enabled": { value: true },
      "todo.enabled": { value: true },
    })}\n`);
    return;
  }
  if (args[0] === "share") {
    process.stdout.write(`https://share.example.test/${basename(args[1] || "session.jsonl")}\n`);
    return;
  }
  if (args[0] === "auth-broker" && args[1] === "login") {
    try {
      process.stderr.write(await readFile(homePath(process.env.HOME || "", "usage-dashboard", "test-login-stderr.txt"), "utf8"));
      process.exitCode = 7;
    } catch {}
    return;
  }
  if (args.includes("acp")) {
    const input = createInterface({ input: process.stdin });
    for await (const line of input) {
      let frame;
      try { frame = JSON.parse(line); } catch { continue; }
      let result = {};
      if (frame.method === "_omp/sessions/listAll") {
        const sessions = await readFakeSessions(process.env.HOME);
        result = { sessions, total: sessions.length };
      } else if (frame.method === "initialize") {
        result = { protocolVersion: 1 };
      }
      const response = { jsonrpc: "2.0", id: frame.id, result };
      if (frame.method === "_omp/sessions/listAll" && result.sessions?.some((session) => String(session.title).includes("🧪"))) {
        await writeUtf8SplitFrame(response);
      } else process.stdout.write(`${JSON.stringify(response)}\n`);
    }
    return;
  }
  if (args.includes("--mode") && args.includes("rpc")) {
    const contextId = randomUUID();
    let protocolVersion = 1;
    let followUpPrompt = false;
    let stateSessionPath = null;
    let stateSessionId = null;
    const frameLog = homePath(process.env.HOME, "test-frames", `${process.pid}.jsonl`);
    await mkdir(dirname(frameLog), { recursive: true, mode: 0o700 });
    const emit = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`);
    const emitChunked = (frame) => {
      const bytes = Buffer.from(JSON.stringify(frame));
      const chunkSize = 24;
      const count = Math.ceil(bytes.length / chunkSize);
      const chunkId = `chunk-${randomUUID()}`;
      for (let index = 0; index < count; index += 1) {
        const chunk = bytes.subarray(index * chunkSize, (index + 1) * chunkSize);
        emit({ type: "rpc_chunk", chunkId, index, count, byteLength: bytes.length, data: chunk.toString("base64") });
      }
    };
    emit({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1, 2] });
    const input = createInterface({ input: process.stdin });
    for await (const line of input) {
      let frame;
      try { frame = JSON.parse(line); } catch { continue; }
      await appendFile(frameLog, `${JSON.stringify({ contextId, frame })}\n`, { mode: 0o600 });
      if (frame.type === "negotiate_protocol") {
        protocolVersion = Number(frame.protocolVersion) === 2 ? 2 : 1;
        emit({ type: "response", id: frame.id, command: frame.type, success: true, data: { protocolVersion } });
      } else if (frame.type === "new_session") {
        const id = `fixture-child-${randomUUID()}`;
        await seedOmpSession(process.env.HOME, id, process.cwd(), "Isolated fork child");
      } else if (frame.type === "switch_session" && typeof frame.sessionPath === "string") {
        stateSessionPath = frame.sessionPath;
        const match = basename(frame.sessionPath).match(/^fixture_(.+)\.jsonl$/);
        if (match) stateSessionId = match[1];
        emit({ type: "response", id: frame.id, command: frame.type, success: true, data: { sessionFile: stateSessionPath, sessionId: stateSessionId } });
      } else if (frame.type === "get_available_models") {
        emit({ type: "response", id: frame.id, command: frame.type, success: true, data: { models: [
          { id: "smoke-model", name: "Conflicting Gemini CLI smoke model", provider: "google-gemini-cli" },
          { id: "smoke-model", name: "Gemini Session action smoke model", provider: "google-antigravity", isDefault: true },
          { id: "smoke-image-model", name: "Gemini Fixture Image Model", provider: "google-antigravity", imageGeneration: true },
          { id: "smoke-antigravity-claude", name: "Claude family fixture model", provider: "google-antigravity" },
          { id: "smoke-antigravity-gpt", name: "GPT family fixture model", provider: "google-antigravity" },
          { id: "smoke-cli-gemini", name: "Gemini CLI smoke model", provider: "google-gemini-cli" },
          { id: "smoke-openai-model", name: "Fixture OpenAI Model", provider: "openai-codex" },
          { id: "smoke-external-model", name: "Fixture external OMP model", provider: "anthropic" },
        ] } });
      } else if (frame.type === "get_state") {
        if (!stateSessionPath) {
          stateSessionId = `fixture-runtime-${randomUUID()}`;
          stateSessionPath = await seedOmpSession(process.env.HOME, stateSessionId, process.cwd(), "Recovered runtime session");
        }
        emit({ type: "response", id: frame.id, command: frame.type, success: true, data: { sessionFile: stateSessionPath, sessionId: stateSessionId, messageCount: 0 } });
      } else if (frame.type === "get_available_commands") {
        emit({ type: "response", id: frame.id, command: frame.type, success: true, data: { commands: [
          { name: "dashboard-gemini-pin", source: "extension" },
          { name: "memory", source: "builtin", subcommands: [
            { name: "view" }, { name: "stats" }, { name: "diagnose" }, { name: "queue" },
            { name: "sync" }, { name: "clear" }, { name: "reset" }, { name: "enqueue" }, { name: "rebuild" },
          ] },
        ] } });
      } else if (frame.type === "prompt" && /^\/dashboard-gemini-pin acc-[a-f0-9]{12}$/.test(String(frame.message || ""))) {
        const mode = await readFakeMemoryMode(process.env.HOME);
        if (mode === "pin-account-unavailable") {
          emit({ type: "response", id: frame.id, command: "prompt", success: false, error: "Selected Gemini account is not available in OMP for this session" });
          emit({ type: "prompt_result", id: frame.id, agentInvoked: false });
        } else if (mode === "pin-agent-invoked") {
          emit({ type: "turn_start" });
          emit({ type: "response", id: frame.id, command: "prompt", success: true, data: { agentInvoked: true } });
        } else {
          emit({ type: "response", id: frame.id, command: "prompt", success: true });
          emit({ type: "prompt_result", id: frame.id, agentInvoked: false });
        }
      } else if (frame.type === "prompt" && /^\/memory\s+/.test(String(frame.message || ""))) {
        const subcommand = String(frame.message).trim().split(/\s+/)[1];
        const mode = await readFakeMemoryMode(process.env.HOME);
        if (mode === "upstream-error") {
          emit({ type: "response", id: frame.id, command: "prompt", success: false, error: { message: "fake OMP memory failure" } });
          emit({ type: "prompt_result", id: frame.id, agentInvoked: false });
        } else if (mode === "missing-output") {
          emit({ type: "response", id: frame.id, command: "prompt", success: true, data: { agentInvoked: false } });
          emit({ type: "prompt_result", id: frame.id, agentInvoked: false });
        } else if (mode === "agent-invoked") {
          emit({ type: "turn_start" });
          emit({ type: "response", id: frame.id, command: "prompt", success: true, data: { agentInvoked: true } });
          emit({ type: "agent_end", isTerminal: true, message: { role: "assistant", content: "unexpected agent invocation", model: "smoke-model" } });
        } else if (mode === "delayed-output") {
          emit({ type: "response", id: frame.id, command: "prompt", success: true, data: { agentInvoked: false } });
          await new Promise((resolve) => setTimeout(resolve, 1500));
          emit({ type: "command_output", text: `fake-memory-${subcommand}` });
          emit({ type: "prompt_result", id: frame.id, agentInvoked: false });
        } else {
          emit({ type: "command_output", text: `fake-memory-${subcommand}` });
          emit({ type: "response", id: frame.id, command: "prompt", success: true, data: { agentInvoked: false } });
          emit({ type: "prompt_result", id: frame.id, agentInvoked: false });
        }
      } else if (frame.type === "prompt" && String(frame.message || "").includes("FAKE_ANTIGRAVITY_QUOTA_SEND")) {
        emit({ type: "turn_start" });
        emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "quota-model-guard-response" } });
        emit({ type: "message_end", message: { role: "assistant", content: "quota-model-guard-response" } });
        emit({ type: "agent_end", isTerminal: true, message: { role: "assistant", content: "quota-model-guard-response", model: "smoke-antigravity-gpt" } });
      } else if (frame.type === "prompt" && String(frame.message || "").includes("QUOTA_MODEL_GUARD_CONTRACT")) {
        emit({ type: "turn_start" });
        emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "quota-model-guard-response" } });
        emit({ type: "message_end", message: { role: "assistant", content: "quota-model-guard-response" } });
        emit({ type: "agent_end", isTerminal: true, message: { role: "assistant", content: "quota-model-guard-response", model: "smoke-openai-model" } });
      } else if (frame.type === "prompt" && String(frame.message || "").includes("BODY_TOGGLE_CONTRACT")) {
        const assistant = {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "persisted thinking from OMP" },
            { type: "toolCall", id: "tool-body-1", name: "read", arguments: { path: "src/body.js" } },
            { type: "text", text: "body-final-response" },
          ],
          model: "smoke-model",
        };
        emit({ type: "turn_start" });
        emit({ type: "message_update", message: { role: "assistant", content: [] }, assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "live thinking from OMP" } });
        emit({ type: "message_update", assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: "{\"path\":\"src/body.js\"}", partial: { role: "assistant", content: [{ type: "toolCall", id: "tool-body-1", name: "read", arguments: { path: "src/body.js" } }] } } });
        emit({ type: "todo_reminder", todos: [{ content: "Inspect body events", status: "in_progress" }], attempt: 1, maxAttempts: 3 });
        emit({ type: "tool_execution_start", toolCallId: "tool-body-1", toolName: "read", args: { path: "src/body.js" }, intent: "inspect" });
        emit({ type: "tool_execution_update", toolCallId: "tool-body-1", toolName: "read", args: { path: "src/body.js" }, partialResult: "body output chunk" });
        emit({ type: "tool_execution_end", toolCallId: "tool-body-1", toolName: "read", result: "body output complete", isError: false });
        emit({ type: "message_end", message: { role: "toolResult", toolCallId: "tool-body-1", toolName: "read", content: [{ type: "text", text: "tool result text" }], details: { exitCode: 0 }, isError: false } });
        emit({ type: "message_end", message: assistant });
        emit({ type: "agent_end", isTerminal: true, messages: [assistant], message: assistant });
      } else if (frame.type === "prompt" && String(frame.message || "").includes("RPC_V2_CONTRACT")) {
        emit({ type: "turn_start" });
        const delta = { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "rpc-v2-working" } };
        if (protocolVersion === 2) emitChunked(delta);
        else emit(delta);
        emit({ type: "message_end", message: { role: "assistant", content: "rpc-v2-working" } });
        emit({ type: "agent_end", isTerminal: true, message: { role: "assistant", content: "rpc-v2-working", model: "smoke-model" } });
      } else if (frame.type === "prompt" && String(frame.message || "").includes("NONTERMINAL_CONTRACT")) {
        emit({ type: "turn_start" });
        emit({ type: "agent_end", isTerminal: false, messages: [] });
        emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "terminal-after-maintenance" } });
        emit({ type: "message_end", message: { role: "assistant", content: "terminal-after-maintenance" } });
        emit({ type: "agent_end", isTerminal: true, message: { role: "assistant", content: "terminal-after-maintenance", model: "smoke-model" } });
      } else if (frame.type === "prompt" && String(frame.message || "").includes("LOCAL_COMMAND_CONTRACT")) {
        emit({ type: "command_output", command: "status", text: "local-command-output" });
        emit({ type: "response", id: frame.id, command: "prompt", success: true, data: { agentInvoked: false } });
        emit({ type: "prompt_result", id: frame.id, agentInvoked: false });
      } else if (frame.type === "prompt" && String(frame.message || "").includes("FOLLOW_UP_CONTRACT")) {
        emit({ type: "turn_start" });
        emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "initial-follow-up-turn" } });
        followUpPrompt = true;
      } else if (frame.type === "follow_up" && followUpPrompt) {
        followUpPrompt = false;
        emit({ type: "message_end", message: { role: "assistant", content: "initial-follow-up-turn" } });
        emit({ type: "agent_end", isTerminal: true, message: { role: "assistant", content: "initial-follow-up-turn", model: "smoke-model" } });
        emit({ type: "turn_start" });
        emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "native-follow-up-turn" } });
        emit({ type: "message_end", message: { role: "assistant", content: "native-follow-up-turn" } });
        emit({ type: "agent_end", isTerminal: true, message: { role: "assistant", content: "native-follow-up-turn", model: "smoke-model" } });
      } else if (frame.type === "prompt" && String(frame.message || "").includes("SELECT_APPROVAL_CONTRACT")) {
        emit({ type: "turn_start" });
        emit({ type: "extension_ui_request", id: `select-${randomUUID()}`, method: "select", title: "Select branch", message: "Choose a branch", options: ["feature/main", "feature/release"] });
      } else if (frame.type === "prompt" && String(frame.message || "").includes("INPUT_APPROVAL_CONTRACT")) {
        emit({ type: "turn_start" });
        emit({ type: "extension_ui_request", id: `input-${randomUUID()}`, method: "input", title: "Branch name", message: "Enter branch name", placeholder: "feature/..." });
      } else if (frame.type === "prompt" && String(frame.message || "").includes("APPROVAL_CONTRACT_")) {
        const id = String(frame.message || "").includes("COLLIDING_APPROVAL_ID") ? "shared-upstream-approval" : `approval-${randomUUID()}`;
        emit({ type: "turn_start" });
        emit({ type: "extension_ui_request", id, method: "confirm", title: "Confirm isolated action", message: "Allow the isolated contract action?" });
      } else if (frame.type === "extension_ui_response" && typeof frame.value === "string") {
        const text = `input:${frame.value}`;
        emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: text } });
        emit({ type: "message_end", message: { role: "assistant", content: text } });
        emit({ type: "agent_end", message: { role: "assistant", content: text, model: "smoke-model" } });
      } else if (frame.type === "extension_ui_response") {
        const text = frame.confirmed === true ? "approval:approved" : frame.cancelled === true ? "approval:denied" : "approval:invalid";
        emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: text } });
        emit({ type: "message_end", message: { role: "assistant", content: text } });
        emit({ type: "agent_end", message: { role: "assistant", content: text, model: "smoke-model" } });
      } else if (frame.type === "prompt" && String(frame.message || "").includes("IMAGEGEN_BLOB_CONTRACT")) {
        const outputImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
        const hash = "431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460";
        await mkdir(homePath(process.env.HOME, "agent", "blobs"), { recursive: true, mode: 0o700 });
        await writeFile(homePath(process.env.HOME, "agent", "blobs", `${hash}.png`), Buffer.from(outputImage.split(",")[1], "base64"), { mode: 0o600 });
        emit({ type: "turn_start" });
        emit({ type: "tool_execution_end", toolName: "image_gen", toolCallId: "imagegen-1", result: "generated", attachments: [{ type: "image/png", data: `blob:sha256:${hash}`, name: "generated.png" }] });
        emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "imagegen-reply" } });
        emit({ type: "message_end", message: { role: "assistant", content: "imagegen-reply" } });
        emit({ type: "agent_end", message: { role: "assistant", content: "imagegen-reply", model: "smoke-image-model" } });
      } else if (frame.type === "prompt" && String(frame.message || "").includes("AUTO_IMAGE_MODEL_CONTRACT")) {
        const outputImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
        emit({ type: "turn_start" });
        emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "auto-image-reply" }, { type: "image", type: "image/png", data: outputImage, name: "auto-image.png" }] } });
        emit({ type: "agent_end", message: { role: "assistant", content: [{ type: "text", text: "auto-image-reply" }, { type: "image", type: "image/png", data: outputImage, name: "auto-image.png" }], model: "smoke-image-model" } });
      } else if (frame.type === "prompt" && String(frame.message || "").includes("IMAGEGEN_MISSING_MEDIA_CONTRACT")) {
        emit({ type: "turn_start" });
        emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "ảnh mới đã xong" } });
        emit({ type: "message_end", message: { role: "assistant", content: "ảnh mới đã xong" } });
        emit({ type: "agent_end", message: { role: "assistant", content: "ảnh mới đã xong", model: "smoke-image-model" } });
      } else if (frame.type === "prompt" && String(frame.message || "").includes("LONG_IMAGE_TIMEOUT_CONTRACT")) {
        const outputImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
        emit({ type: "turn_start" });
        await new Promise((resolve) => setTimeout(resolve, 4500));
        emit({ type: "tool_execution_end", toolName: "image_gen", toolCallId: "long-image-1", result: "generated", attachments: [{ type: "image/png", data: outputImage, name: "long-result.png" }] });
        emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "long-image-reply" } });
        emit({ type: "message_end", message: { role: "assistant", content: "long-image-reply" } });
        emit({ type: "agent_end", message: { role: "assistant", content: "long-image-reply", model: "smoke-image-model" } });
      } else if (frame.type === "prompt" && String(frame.message || "").includes("LONG_AUDIT_TIMEOUT_CONTRACT")) {
        emit({ type: "turn_start" });
        await new Promise((resolve) => setTimeout(resolve, 4500));
        emit({ type: "tool_execution_start", toolCallId: "long-audit-1", toolName: "read", args: { path: "src" } });
        await new Promise((resolve) => setTimeout(resolve, 4500));
        emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "long-audit-reply" } });
        emit({ type: "message_end", message: { role: "assistant", content: "long-audit-reply" } });
        emit({ type: "agent_end", message: { role: "assistant", content: "long-audit-reply", model: "smoke-model" } });
      } else if (frame.type === "prompt" && String(frame.message || "").includes("MEDIA_CONTRACT")) {
        const outputImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
        emit({ type: "turn_start" });
        emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "media-reply" } });
        emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "media-reply" }, { type: "image", type: "image/png", data: outputImage, name: "result.png" }] } });
        emit({ type: "agent_end", message: { role: "assistant", content: [{ type: "text", text: "media-reply" }, { type: "image", type: "image/png", data: outputImage, name: "result.png" }], model: "smoke-model" } });
      } else if (frame.type === "prompt" && String(frame.message || "").includes("AUTO_TITLE_CONTRACT")) {
        emit({ type: "turn_start" });
        emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "working" } });
        emit({ type: "message_end", message: { role: "assistant", content: "working" } });
        emit({ type: "agent_end", message: { role: "assistant", content: "working", model: "smoke-model" } });
      } else if (frame.type === "prompt" && String(frame.message || "").includes("LEGACY_CWD_CONTRACT")) {
        emit({ type: "turn_start" });
        emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "working" } });
        emit({ type: "message_end", message: { role: "assistant", content: "working" } });
        emit({ type: "agent_end", message: { role: "assistant", content: "working", model: "smoke-model" } });
      } else if (frame.type === "prompt" && String(frame.message || "").includes("QUEUE_PAUSE_ERROR")) {
        emit({ type: "turn_start" });
        await new Promise((resolve) => setTimeout(resolve, 120));
        emit({ type: "agent_end", isTerminal: true, message: { role: "assistant", stopReason: "error", errorMessage: "fake queue error" } });
      } else if (frame.type === "prompt" && String(frame.message || "").includes("QUEUE_SAFETY_COOLDOWN")) {
        emit({ type: "turn_start" });
        await new Promise((resolve) => setTimeout(resolve, 120));
        emit({ type: "agent_end", isTerminal: true, message: { role: "assistant", stopReason: "error", errorStatus: 429, errorMessage: "fake 429" } });
      } else if (frame.type === "prompt" && String(frame.message || "").includes("QUEUE_PAUSE_TIMEOUT")) {
        emit({ type: "turn_start" });
      } else if (frame.type === "prompt" && String(frame.message || "").includes("CONCURRENT_")) {
        const message = String(frame.message);
        const delayMs = message.includes("SLOW") ? Number(process.env.OMP_DASHBOARD_TEST_SLOW_TURN_MS || 6000) : message.includes("FIFO_ONE") ? 1200 : 20;
        emit({ type: "turn_start" });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        const content = `concurrent:${message}`;
        emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: content } });
        emit({ type: "message_end", message: { role: "assistant", content } });
        emit({ type: "agent_end", isTerminal: true, message: { role: "assistant", content, model: "smoke-model" } });
      } else if (frame.type === "prompt" && String(frame.message || "").includes("SPLIT_UTF8_OMP_CONTRACT")) {
        const content = "Tiếng Việt 🧪";
        emit({ type: "turn_start" });
        await writeUtf8SplitFrame({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: content } });
        emit({ type: "message_end", message: { role: "assistant", content } });
        emit({ type: "agent_end", isTerminal: true, message: { role: "assistant", content, model: "smoke-model" } });
      } else if (frame.type === "prompt" && String(frame.message || "").includes("SSE_ERROR_REDACTION_CONTRACT")) {
        emit({ type: "turn_start" });
        emit({ type: "agent_end", isTerminal: true, message: { role: "assistant", stopReason: "error", errorMessage: "CHAT_FRAME_ERROR_SENTINEL" } });
      } else if (frame.type === "prompt" && String(frame.message || "").includes("ACCOUNT_VERIFICATION_CONTRACT")) {
        emit({ type: "turn_start" });
        emit({ type: "agent_end", isTerminal: true, message: { role: "assistant", stopReason: "error", errorStatus: 403, errorMessage: "Account verification required for test@example.com" } });
      } else if (frame.type === "prompt") {
        emit({ type: "turn_start" });
        emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "working" } });
      } else if (frame.type === "abort") {
        setTimeout(() => emit({ type: "agent_end", message: { role: "assistant", text: "Stopped by contract abort", model: "smoke-model" } }), 250);
      }
    }
    return;
  }
  process.stderr.write("Unexpected fake OMP invocation\n");
  process.exitCode = 2;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  const completed = await Promise.race([exited.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 4000))]);
  if (!completed && child.exitCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
}

async function runContract() {
  const home = await mkdtemp(join(tmpdir(), "omp-session-actions-"));
  let workspaceRoot = join(home, "workspace");
  let server;
  let stdout = "";
  let stderr = "";
  try {
    const sourceDir = join(workspaceRoot, "src");
    const legacyRoot = join(home, "legacy-workspace");
    await mkdir(sourceDir, { recursive: true, mode: 0o700 });
    workspaceRoot = await realpath(workspaceRoot);
    const otherRoot = join(workspaceRoot, "other-project");
    await mkdir(otherRoot, { recursive: true, mode: 0o700 });
    await writeFile(join(otherRoot, "other.txt"), "Attachment from another project.\n", { mode: 0o600 });
    await mkdir(legacyRoot, { recursive: true, mode: 0o700 });
    await mkdir(join(workspaceRoot, ".git"), { recursive: true, mode: 0o700 });
    await writeFile(join(sourceDir, "good.txt"), "Attachment from isolated workspace.\n", { mode: 0o600 });
    const secretsDir = join(workspaceRoot, "secrets");
    await mkdir(secretsDir, { recursive: true, mode: 0o700 });
    await writeFile(join(secretsDir, "config.json"), JSON.stringify({ token: "SUPER_SECRET" }), { mode: 0o600 });
    const outsidePath = join(home, "outside.txt");
    await writeFile(outsidePath, "Outside workspace.\n", { mode: 0o600 });
    await symlink(outsidePath, join(workspaceRoot, "escape.txt"));
    await writeFile(join(workspaceRoot, ".git", "config.txt"), "hidden repository data\n", { mode: 0o600 });
    await writeFile(join(workspaceRoot, "binary.txt"), Buffer.from([0x62, 0x69, 0x6e, 0x00, 0x61, 0x72, 0x79]), { mode: 0o600 });
    await writeFile(join(workspaceRoot, "large.txt"), Buffer.alloc(512 * 1024 + 1, 0x61), { mode: 0o600 });
    const fakeBin = join(home, ".bun", "bin", "omp");
    await mkdir(dirname(fakeBin), { recursive: true, mode: 0o700 });
    const wrapper = `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(fileURLToPath(import.meta.url))} ${FAKE_OMP_FLAG} "$@"\n`;
    await writeFile(fakeBin, wrapper, { mode: 0o700 });

    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, [SERVER_PATH], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        ...(process.platform === "darwin" ? { PATH: LAUNCHD_PATH } : {}),
        NODE_ENV: "test",
        OMP_DASHBOARD_TEST_CHAT_PROTOCOL: "rpc",
        OMP_DASHBOARD_TEST_APPROVAL_TIMEOUT_MS: String(TEST_APPROVAL_TIMEOUT_MS),
        OMP_DASHBOARD_TEST_CHAT_TURN_TIMEOUT_MS: "4000",
        OMP_DASHBOARD_TEST_LONG_CHAT_TURN_TIMEOUT_MS: "5500",
        OMP_DASHBOARD_TEST_SAFETY_COOLDOWN_MS: "1000",
        OMP_DASHBOARD_TEST_SLOW_TURN_MS: "3000",
        HOME: home,
        OMP_BIN: fakeBin,
        OMP_DASHBOARD_PORT: String(port),
        OMP_DASHBOARD_WORKSPACE: workspaceRoot,
        OMP_SAFETY_STATE_FILE: homePath(home, "usage-dashboard", "safety-state.json"),
        OMP_CHAT_RATE_LIMIT: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-8000); });
    server.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-8000); });

    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null) throw new Error(`Isolated dashboard exited early: ${stderr || stdout}`);
      try {
        const response = await fetch(`${baseUrl}/healthz`);
        if (response.ok) { ready = true; break; }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, `Isolated dashboard did not become ready: ${stderr || stdout}`);

    const page = await fetch(`${baseUrl}/chat`);
    assert.equal(page.status, 200, "isolated /chat route must load");
    const cookie = (page.headers.get("set-cookie") || "").split(";")[0];
    assert.match(cookie, /^omp_dashboard_session=/, "isolated dashboard must issue its own session cookie");
    const chatHtml = await page.text();
    assert.match(chatHtml, /\/honpi-dashboard-mark-8138753b\.png/, "chat must reuse the shared dashboard mark");
    assert.doesNotMatch(chatHtml, /data:image\/png;base64,iVBORw0KGgoAAAANSUhEUgAABMw/, "chat must not embed the repeated dashboard mark");
    const quotaPage = await fetch(`${baseUrl}/quota`);
    assert.equal(quotaPage.status, 200, "isolated /quota route must load");
    const quotaHtml = await quotaPage.text();
    assert.match(quotaHtml, /HONPI_QUOTA_CONFIG/, "quota must embed the production client config");
    assert.match(quotaHtml, /\/api\/v1\/quota\/switch/, "quota client must use the direct quota-selection API");
    assert.match(quotaHtml, /\/honpi-dashboard-mark-8138753b\.png/, "quota must reuse the shared dashboard mark");
    const dashboardMark = await fetch(`${baseUrl}/honpi-dashboard-mark-8138753b.png`);
    assert.equal(dashboardMark.status, 200, "shared dashboard mark must load");
    assert.equal(dashboardMark.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal((await dashboardMark.arrayBuffer()).byteLength, 737344);
    assert.equal((await fetch(`${baseUrl}/dashboard-live.js`)).status, 404, "removed dashboard-live route must not return a server error");
    const passes = [];
    passes.push("dashboard pages reuse the cacheable mark and the removed legacy route is absent");

    await api("POST", "/api/refresh");
    const emptyUsageFixture = homePath(home, "usage-dashboard", "test-empty-usage.txt");
    await mkdir(dirname(emptyUsageFixture), { recursive: true, mode: 0o700 });
    await writeFile(emptyUsageFixture, "1\n", { mode: 0o600 });
    const startedLogin = await api("POST", "/api/login", { email: "baseline-google@example.test" });
    assert.equal(startedLogin.status, 202, `OAuth login did not start: ${JSON.stringify(startedLogin.payload)}`);
    assert.equal(startedLogin.payload.accountEmail, "baseline-google@example.test", "OAuth login must retain its target email");
    let loginStatus;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      loginStatus = await api("GET", "/api/login-status");
      if (["complete", "error"].includes(loginStatus.payload.state)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(loginStatus.payload.state, "error", `OAuth without a usage account must fail closed: ${JSON.stringify(loginStatus.payload)}`);
    assert.match(loginStatus.payload.message, /OMP chưa nhận account quota/, `OAuth without a usage account must disclose the usage sync failure: ${JSON.stringify(loginStatus.payload)}`);
    await rm(emptyUsageFixture, { force: true });
    await api("POST", "/api/refresh");
    passes.push("OAuth completion fails closed when OMP usage does not expose the account");

    const loginErrorFixture = homePath(home, "usage-dashboard", "test-login-stderr.txt");
    await writeFile(loginErrorFixture, "https://oauth.example.test/secret\nError: OAUTH_FAILURE_SENTINEL\n    at async /$bunfs/root/omp:1:1\n", { mode: 0o600 });
    const failedLogin = await api("POST", "/api/login", { email: "diagnostic-google@example.test" });
    assert.equal(failedLogin.status, 202, "diagnostic OAuth login did not start");
    for (let attempt = 0; attempt < 100; attempt += 1) {
      loginStatus = await api("GET", "/api/login-status");
      if (loginStatus.payload.state === "error") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.match(loginStatus.payload.message, /OAUTH_FAILURE_SENTINEL/, "OAuth failure must preserve its root diagnostic");
    assert.doesNotMatch(loginStatus.payload.message, /https?:\/\/|\bat async\b|\$bunfs/, "OAuth failure must not expose URLs or stack frames");
    await rm(loginErrorFixture, { force: true });
    passes.push("OAuth errors preserve the root diagnostic without URLs or stack frames");

    const brokerUsageFixture = homePath(home, "usage-dashboard", "test-broker-usage.json");
    await writeFile(emptyUsageFixture, "1\n", { mode: 0o600 });
    await writeFile(brokerUsageFixture, `${JSON.stringify({ credentials: [{
      provider: "google-antigravity",
      email: "broker-google@example.test",
      ok: true,
      report: {
        provider: "google-antigravity",
        metadata: { email: "broker-google@example.test" },
        limits: [
          { id: "broker-gemini-5h", label: "Gemini", window: { id: "5h", label: "5h", durationMs: 18000000 }, amount: { used: 10, usedFraction: 0.1, remaining: 90, limit: 100 } },
          { id: "broker-gemini-weekly", label: "Gemini", window: { id: "weekly", label: "weekly", durationMs: 604800000 }, amount: { used: 15, usedFraction: 0.15, remaining: 85, limit: 100 } },
          { id: "broker-shared-5h", label: "Claude & GPT (shared)", scope: { shared: true }, window: { id: "5h", label: "5h", durationMs: 18000000 }, amount: { used: 20, usedFraction: 0.2, remaining: 80, limit: 100 } },
          { id: "broker-shared-weekly", label: "Claude & GPT (shared)", scope: { shared: true }, window: { id: "weekly", label: "weekly", durationMs: 604800000 }, amount: { used: 25, usedFraction: 0.25, remaining: 75, limit: 100 } },
        ],
      },
    }] })}\n`, { mode: 0o600 });
    await api("POST", "/api/refresh");
    const brokerAccounts = await api("GET", "/api/v1/quota/accounts");
    assert.equal(brokerAccounts.payload.find((account) => account.email === "broker-google@example.test")?.canUse, true, "broker usage fallback must expose an eligible account");
    await rm(emptyUsageFixture, { force: true });
    await rm(brokerUsageFixture, { force: true });
    await api("POST", "/api/refresh");
    passes.push("Quota falls back to the broker usage probe when omp usage is empty");

    const chatClient = await readFile(join(PROJECT_ROOT, "honpi-chat-dashboard-live.js"), "utf8");
    const acpAdapter = await readFile(join(PROJECT_ROOT, "acp-session-context.mjs"), "utf8");
    assert.match(chatClient, /const isServerQueuedTurn = \(queue\) => queue\?\.phase === 'paused' \|\| \(queue\?\.phase === 'fifo' && Number\(queue\.queueAhead\) > 0\);/);
    assert.match(chatClient, /if \(isServerQueuedTurn\(request\.queueState\) && !\['waiting', 'end', 'done', 'error'\]\.includes\(event\)\) return;/);
    assert.match(chatClient, /if \(isServerQueuedTurn\(request\.queueState\)\) \{\s*renderQueueTray\(\);\s*return;\s*\}\s*mountChatTurn\(\);/);
    assert.ok(chatClient.includes("if (previousId !== id) { void loadQuota(); await loadModels(); }"));
    assert.ok(chatClient.includes("if (state.activeId) {\n      const promptSettings = snapshotSettings();"));
    assert.ok(chatClient.includes("if (requestId !== state.sessionLoadRequestId) return;"));
    assert.ok(chatClient.includes("await loadFolders({ silent: true });"));
    passes.push("queued frontend turns remain in the tray until their backend turn dispatches");
    assert.match(chatClient, /function copyText\(value, label = 'nội dung'\)/);
    assert.match(chatClient, /Sao chép code/);
    assert.match(chatClient, /Sao chép Markdown/);
    assert.match(chatClient, /Chỉnh prompt trong ô nhập/);
    assert.match(chatClient, /Tạo nhánh chat từ phản hồi này/);
    assert.match(chatClient, /function fileChangeRows\(blocks\)/);
    assert.match(chatClient, /ai-data-table/);
    assert.match(chatClient, /function readAttachment\(file\)/);
    assert.match(chatClient, /const BROWSER_MODE_PREFERENCE_VERSION = 'manual-v1';/);
    assert.match(chatClient, /function setBrowserMode\(value\)/);
    assert.match(chatClient, /aria-pressed/);
    assert.match(acpAdapter, /isImageGenerationTool\(name\) \? imageAttachments\(output\) : \[\]/);
    passes.push("frontend exposes attachment, copy, prompt-revision, branch, markdown-table, and OMP file-change controls");

    async function api(method, path, body) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      let payload;
      try { payload = JSON.parse(text); } catch { payload = text; }
      return { status: response.status, payload };
    }
    async function apiWithSplitUtf8(path, body, marker) {
      const bytes = Buffer.from(JSON.stringify(body));
      const markerBytes = Buffer.from(marker);
      assert.equal(markerBytes.length, 4, "test marker must be a four-byte UTF-8 code point");
      const markerOffset = bytes.indexOf(markerBytes);
      assert.ok(markerOffset >= 0, "test request must contain the UTF-8 marker");
      const splitOffset = markerOffset + 2;
      const response = await new Promise((resolve, reject) => {
        const req = httpRequest(new URL(path, baseUrl), {
          method: "POST",
          headers: { cookie, "content-type": "application/json", "content-length": String(bytes.length) },
        }, resolve);
        req.once("error", reject);
        req.write(bytes.subarray(0, splitOffset));
        setTimeout(() => req.end(bytes.subarray(splitOffset)), 10);
      });
      const chunks = [];
      for await (const chunk of response) chunks.push(chunk);
      const text = Buffer.concat(chunks).toString("utf8");
      let payload;
      try { payload = JSON.parse(text); } catch { payload = text; }
      return { status: response.statusCode, payload };
    }
    const capabilities = await api("GET", "/api/v1/omp/capabilities");
    assert.equal(capabilities.status, 200, `capabilities request failed: ${JSON.stringify(capabilities.payload)}\n${stderr}\n${stdout}`);
    assert.deepEqual(capabilities.payload.imageGenerationModels, ["smoke-image-model"], "fixture runtime should advertise the image-generation model");
    assert.equal(capabilities.payload.featureStatus.memory, "supported");
    assert.ok(capabilities.payload.features.includes("memory"));
    assert.equal(capabilities.payload.sessionActions?.steer, "unavailable");
    assert.equal(capabilities.payload.featureStatus["agent-hub"], "unavailable");
    assert.ok(!capabilities.payload.commands.includes("set_session_name"), "ACP capability catalog must exclude unimplemented commands");
    passes.push("ACP capability catalog excludes steer, Agent Hub and unsupported session naming");
    const prewarmInput = { cwd: workspaceRoot, approvalMode: "write", browserMode: "ego-browser", tools: [] };
    const prewarmed = await api("POST", "/api/v1/omp/prewarm", prewarmInput);
    assert.equal(prewarmed.status, 202, `ACP prewarm should start a worker: ${JSON.stringify(prewarmed.payload)}`);
    assert.equal(prewarmed.payload.worker.status, "ready");
    assert.ok(Number.isInteger(prewarmed.payload.worker.pid));
    const prewarmedAgain = await api("POST", "/api/omp/v1/prewarm", prewarmInput);
    assert.equal(prewarmedAgain.status, 202);
    assert.equal(prewarmedAgain.payload.worker.pid, prewarmed.payload.worker.pid, "prewarm aliases must reuse the workspace worker");
    const prewarmState = await api("GET", "/api/console/state");
    assert.ok(prewarmState.payload.acpWorkers.some((worker) => worker.pid === prewarmed.payload.worker.pid && worker.contexts === 0), "prewarm must not allocate an ACP session");
    passes.push("ACP prewarm starts and reuses one context-free worker");

    async function createFixture(title, cwd = workspaceRoot) {
      const created = await api("POST", "/api/v1/sessions", { title, cwd, tools: ["read"] });
      assert.equal(created.status, 201, `session creation failed: ${JSON.stringify(created.payload)}`);
      const id = created.payload.id;
      assert.equal(typeof id, "string");
      const path = await seedOmpSession(home, id, cwd, title);
      return { id, path };
    }

    const splitUtf8Session = await createFixture("OMP split UTF-8");
    const splitUtf8Text = "Tiếng Việt 🧪";
    const splitUtf8Stream = await openStream(splitUtf8Session.id, "SPLIT_UTF8_OMP_CONTRACT preserve output", `split-utf8-${randomUUID()}`, [], "smoke-external-model", "omp");
    const splitUtf8Delta = await splitUtf8Stream.reader.waitFor((event) => event.event === "delta", "split UTF-8 OMP delta");
    assert.equal(splitUtf8Delta.data.content, splitUtf8Text, "OMP frames must preserve a multibyte character split across stdout chunks");
    await splitUtf8Stream.reader.waitFor((event) => event.event === "end", "split UTF-8 OMP stream end");
    passes.push("OMP JSONL decoder preserves split UTF-8 assistant text");
    const unicodeBridgeSession = await createFixture("ACP split 🧪");
    const listedBridgeSessions = await api("GET", "/api/console/sessions");
    assert.equal(listedBridgeSessions.status, 200, `ACP session listing failed: ${JSON.stringify(listedBridgeSessions.payload)}`);
    assert.ok(listedBridgeSessions.payload.sessions.some((session) => session.sessionId === unicodeBridgeSession.id && session.title === "ACP split 🧪"), "ACP response must preserve a multibyte character split across stdout chunks");
    passes.push("ACP JSONL decoder preserves split UTF-8 session titles");
    async function action(id, body) {
      return api("POST", `/api/v1/sessions/${encodeURIComponent(id)}/action`, body);
    }
    async function memoryStatus(id) {
      return api("GET", `/api/v1/sessions/${encodeURIComponent(id)}/memory`);
    }
    async function memoryAction(id, body) {
      return api("POST", `/api/v1/sessions/${encodeURIComponent(id)}/memory/action`, body);
    }
    async function listSessions() {
      const result = await api("GET", "/api/v1/sessions?limit=200");
      assert.equal(result.status, 200, `session list failed: ${JSON.stringify(result.payload)}`);
      assert.ok(Array.isArray(result.payload));
      return result.payload;
    }
    async function assertListedField(id, field, expected) {
      const session = (await listSessions()).find((item) => item.id === id);
      assert.ok(session, `session ${id} should remain listed`);
      assert.deepEqual(session[field], expected, `${field} should reflect the committed API state`);
    }

    async function assertReferenceRejected(id, path, status, code, label) {
      const result = await api("POST", `/api/v1/sessions/${encodeURIComponent(id)}/files/reference`, { path });
      assert.equal(result.status, status, `${label}: ${JSON.stringify(result.payload)}`);
      assert.equal(result.payload.error?.code, code, label);
      passes.push(label);
    }
    async function approvalRoundtrip(sessionId, decision) {
      const requestId = `approval-${decision}-${randomUUID()}`;
      const controller = new AbortController();
      let streamReader;
      let streamFinished = false;
      const expectedText = decision === "approve" ? "approval:approved" : "approval:denied";
      try {
        const response = await fetch(`${baseUrl}/api/v1/chat/stream`, {
          method: "POST",
          headers: { cookie, "content-type": "application/json", accept: "text/event-stream" },
          body: JSON.stringify({ sessionId, requestId, prompt: `APPROVAL_CONTRACT_${decision.toUpperCase()}`, model: "smoke-model", tools: ["read"] }),
          signal: controller.signal,
        });
        if (response.status !== 200) throw new Error(`approval stream failed (${response.status}): ${await response.text()}`);
        streamReader = createSseReader(response);
        const started = await streamReader.waitFor((event) => event.event === "start", "approval stream start");
        assert.equal(started.data.sessionId, sessionId);
        const requested = await streamReader.waitFor((event) => event.event === "approval", "approval request event");
        assert.equal(typeof requested.data.id, "string");
        assert.equal(requested.data.sessionId, sessionId);
        assert.equal(requested.data.title, "Confirm isolated action");
        assert.equal(requested.data.message, "Allow the isolated contract action?");
        assert.equal(typeof requested.data.expiresAt, "number");
        assert.ok(requested.data.expiresAt > Date.now());
        assert.equal(requested.data.timeoutMs, TEST_APPROVAL_TIMEOUT_MS);

        if (decision === "deny") {
          const wrongSession = await api("POST", `/api/v1/sessions/${encodeURIComponent(randomUUID())}/approval`, { id: requested.data.id, decision });
          assert.equal(wrongSession.status, 404);
          assert.equal(wrongSession.payload.error?.code, "NOT_FOUND");
        }

        const resolved = await api("POST", `/api/v1/sessions/${encodeURIComponent(sessionId)}/approval`, { id: requested.data.id, decision });
        assert.equal(resolved.status, 200, `approval response failed: ${JSON.stringify(resolved.payload)}`);
        assert.deepEqual(resolved.payload, { success: true, sessionId, id: requested.data.id, decision });
        const forwarded = await waitForFakeFrame(home, (item) => item.frame.type === "extension_ui_response" && item.frame.id === requested.data.id);
        assert.deepEqual(forwarded.frame, decision === "approve"
          ? { type: "extension_ui_response", id: requested.data.id, confirmed: true }
          : { type: "extension_ui_response", id: requested.data.id, cancelled: true });

        const result = await streamReader.waitFor((event) => event.event === "delta" && event.data.content === expectedText, "approval result");
        assert.equal(result.data.content, expectedText);
        const ended = await streamReader.waitFor((event) => event.event === "end", "approval stream completion");
        assert.equal(ended.data.done, true);
        streamFinished = true;
        passes.push(`approval ${decision} is session-scoped and resumes the OMP turn`);
      } finally {
        if (!streamFinished) {
          controller.abort();
          await streamReader?.cancel().catch(() => {});
        }
      }
    }
    async function approvalCollisionRoundtrip(leftSessionId, rightSessionId) {
      let left;
      let right;
      try {
        left = await openStream(leftSessionId, "APPROVAL_CONTRACT_COLLIDING_APPROVAL_ID_A", `approval-collision-a-${randomUUID()}`);
        right = await openStream(rightSessionId, "APPROVAL_CONTRACT_COLLIDING_APPROVAL_ID_B", `approval-collision-b-${randomUUID()}`);
        const [leftRequest, rightRequest] = await Promise.all([
          left.reader.waitFor((event) => event.event === "approval", "first colliding approval"),
          right.reader.waitFor((event) => event.event === "approval", "second colliding approval"),
        ]);
        assert.equal(leftRequest.data.id, "shared-upstream-approval");
        assert.equal(rightRequest.data.id, leftRequest.data.id, "separate OMP workers can reuse an upstream approval ID");
        assert.ok(leftRequest.data.expiresAt > Date.now() && rightRequest.data.expiresAt > Date.now(), "both colliding requests must still be live before resolution");
        const leftResolved = await api("POST", `/api/v1/sessions/${encodeURIComponent(leftSessionId)}/approval`, { id: leftRequest.data.id, decision: "approve" });
        assert.equal(leftResolved.status, 200, `first colliding approval should resolve in its session: ${JSON.stringify(leftResolved.payload)}`);
        const rightResolved = await api("POST", `/api/v1/sessions/${encodeURIComponent(rightSessionId)}/approval`, { id: rightRequest.data.id, decision: "deny" });
        assert.equal(rightResolved.status, 200, `second colliding approval should resolve in its session: ${JSON.stringify(rightResolved.payload)}`);
        const [leftDelta, rightDelta] = await Promise.all([
          left.reader.waitFor((event) => event.event === "delta" && event.data.content === "approval:approved", "first approval result"),
          right.reader.waitFor((event) => event.event === "delta" && event.data.content === "approval:denied", "second approval result"),
        ]);
        assert.equal(leftDelta.data.content, "approval:approved");
        assert.equal(rightDelta.data.content, "approval:denied");
        await Promise.all([
          left.reader.waitFor((event) => event.event === "end", "first approval stream end"),
          right.reader.waitFor((event) => event.event === "end", "second approval stream end"),
        ]);
        passes.push("concurrent approval IDs are isolated by chat session");
      } finally {
        await Promise.all([left?.reader.cancel().catch(() => {}), right?.reader.cancel().catch(() => {})]);
      }
    }
    async function completeSmokeTurn(sessionId, prompt) {
      const response = await fetch(`${baseUrl}/api/v1/chat/stream`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ sessionId, requestId: `auto-title-${randomUUID()}`, prompt, model: "smoke-model", tools: ["read"] }),
      });
      if (response.status !== 200) throw new Error(`smoke stream failed (${response.status}): ${await response.text()}`);
      const reader = createSseReader(response);
      await reader.waitFor((event) => event.event === "start", "smoke stream start");
      await reader.waitFor((event) => event.event === "end", "smoke stream completion");
    }
    async function openStream(sessionId, prompt, label, attachments = [], model = "smoke-model", modelSource = "quota", browserMode) {
      const requestId = `${label}-${randomUUID()}`;
      const response = await fetch(`${baseUrl}/api/v1/chat/stream`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ sessionId, requestId, prompt, model, modelSource, tools: ["read"], attachments, browserMode }),
      });
      if (response.status !== 200) throw new Error(`${label} stream failed (${response.status}): ${await response.text()}`);
      return { response, requestId, reader: createSseReader(response) };
    }
    async function assertStreamError(reader, code, label) {
      let received = "";
      try { await reader.waitFor(() => false, label, 7000); }
      catch (error) { received = String(error.message || error); }
      assert.match(received, new RegExp(code), `${label}: ${received}`);
      return received;
    }
    const chunkedFolderName = "Chunked UTF-8 🧪 request";
    const chunkedFolder = await apiWithSplitUtf8("/api/v1/folders", { name: chunkedFolderName, cwd: workspaceRoot }, "🧪");
    assert.equal(chunkedFolder.status, 201, `split UTF-8 request failed: ${JSON.stringify(chunkedFolder.payload)}`);
    assert.equal(chunkedFolder.payload.name, chunkedFolderName, "a code point split across HTTP chunks must decode intact");
    passes.push("JSON body parser preserves UTF-8 code points split across request chunks");
    const interactiveLoginAt = Math.floor(Date.now() / 1000) - 61;
    const credentialRefreshedAt = interactiveLoginAt + 60;
    const credentialDatabase = homePath(home, "agent", "agent.db");
    await mkdir(dirname(credentialDatabase), { recursive: true, mode: 0o700 });
    await new Promise((resolve, reject) => {
      const sql = `CREATE TABLE IF NOT EXISTS auth_credentials (identity_key TEXT, data TEXT, created_at INTEGER, updated_at INTEGER, credential_type TEXT, provider TEXT); INSERT INTO auth_credentials VALUES ('email:smoke-google@example.test', '{"authorizedAt":${interactiveLoginAt * 1000}}', ${interactiveLoginAt - 7 * 86400}, ${credentialRefreshedAt}, 'oauth', 'google-antigravity');`;
      const child = spawn("/usr/bin/sqlite3", [credentialDatabase, sql], { stdio: "ignore" });
      child.once("error", reject); child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`credential fixture sqlite exited ${code}`)));
    });
    const preDefaultSession = await createFixture("Contract before Gemini default");
    const quotaAccounts = await api("GET", "/api/v1/quota/accounts");
    assert.equal(quotaAccounts.status, 200, `quota accounts failed: ${JSON.stringify(quotaAccounts.payload)}`);
    if (process.platform === "darwin") {
      const ompPath = (await readFile(join(home, "test-omp-path.txt"), "utf8")).trim().split(delimiter);
      for (const directory of HOMEBREW_BIN_PATHS) {
        assert.ok(ompPath.includes(directory), `OMP subprocess PATH must include ${directory}`);
      }
      passes.push("OMP subprocess PATH includes Homebrew bins with a LaunchAgent-style PATH");
    }
    const googleAccount = quotaAccounts.payload.find((account) => account.email === "smoke-google@example.test");
    const googleAltAccount = quotaAccounts.payload.find((account) => account.email === "smoke-google-alt@example.test");
    const usageOnlyAccount = quotaAccounts.payload.find((account) => account.email === "smoke-usage-only@example.test");
    const dailyFullAccount = quotaAccounts.payload.find((account) => account.email === "smoke-daily-full@example.test");
    const missingWeekAccount = quotaAccounts.payload.find((account) => account.email === "smoke-missing-week@example.test");
    const missingFiveHourAccount = quotaAccounts.payload.find((account) => account.email === "smoke-missing-5h@example.test");
    const geminiOnlyAccount = quotaAccounts.payload.find((account) => account.email === "smoke-gemini-only@example.test");
    const sharedOnlyAccount = quotaAccounts.payload.find((account) => account.email === "smoke-shared-only@example.test");
    assert.ok(googleAccount && googleAltAccount, `fixture should expose Google Antigravity accounts: ${JSON.stringify(quotaAccounts.payload)}`);
    assert.notEqual(googleAccount.id, googleAltAccount.id, "same-provider Google credentials must retain distinct account IDs");
    assert.deepEqual([...new Set(quotaAccounts.payload.map((account) => account.providerKey))], ["google-antigravity"]);
    assert.equal(quotaAccounts.payload.some((account) => account.email === "smoke-cli@example.test"), false, "Gemini CLI credentials must not enter Google Antigravity quota");
    assert.equal(quotaAccounts.payload.some((account) => account.providerKey === "openai-codex"), false, "OpenAI credentials must not enter Google quota");
    assert.ok(usageOnlyAccount, "Google usage-only accounts must remain visible");
    assert.equal(usageOnlyAccount.canUse, false, "daily Google usage without Claude and GPT must not qualify");
    assert.equal(usageOnlyAccount.statusCode, "entitlement_unverified", "missing model capability must fail closed");
    assert.equal(usageOnlyAccount.statusLabel, "Thiếu capability model");
    assert.equal(usageOnlyAccount.primaryQuotaLabel, "Ngày", "daily usage must retain its real window label");
    assert.equal(usageOnlyAccount.usage5hPct, 10, "the primary quota value must expose daily telemetry without calling it 5-hour quota");
    assert.ok(dailyFullAccount?.canUse, "Google, Anthropic and OpenAI daily quotas must qualify as a usable Antigravity account");
    assert.equal(dailyFullAccount?.primaryQuotaLabel, "Ngày");
    assert.ok(missingWeekAccount && !missingWeekAccount.canUse, "Gemini 5-hour quota without a weekly bucket must remain unavailable");
    assert.ok(missingFiveHourAccount && !missingFiveHourAccount.canUse, "Gemini weekly quota without a 5-hour bucket must remain unavailable");
    assert.ok(geminiOnlyAccount && !geminiOnlyAccount.canUse, "Gemini-only entitlement must not qualify as a Pro/Ultra quota account");
    assert.ok(sharedOnlyAccount && !sharedOnlyAccount.canUse, "Claude/GPT shared buckets must not substitute for Gemini quota");
    assert.equal(googleAccount.canUse, true, "Gemini 5-hour and weekly quota buckets should qualify");
    assert.equal(googleAccount.tokenLoginIso, new Date(interactiveLoginAt * 1000).toISOString(), "the OAuth display time must use OMP's interactive authorization time, not a later token refresh");
    assert.deepEqual(quotaAccounts.payload.filter((account) => account.isActive), [], "no account should be selected before an explicit choice");
    const unselectedModels = await api("GET", "/api/v1/quota/models");
    assert.equal(unselectedModels.status, 409);
    assert.equal(unselectedModels.payload.error?.code, "ACCOUNT_SELECTION_REQUIRED");
    const baselineSelection = await api("POST", "/api/v1/quota/switch", { accountId: googleAccount.id });
    assert.equal(baselineSelection.status, 200, `baseline account selection failed: ${JSON.stringify(baselineSelection.payload)}`);
    const baselineModels = await api("GET", "/api/v1/quota/models");
    assert.equal(baselineModels.payload.account.id, googleAccount.id, "baseline account selection must update the chat default");
    const allOmpModelsBeforeSelection = await api("GET", "/api/v1/models");
    assert.equal(allOmpModelsBeforeSelection.status, 200);
    assert.ok(allOmpModelsBeforeSelection.payload.some((model) => model.id === "smoke-antigravity-claude"));
    assert.ok(allOmpModelsBeforeSelection.payload.some((model) => model.id === "smoke-antigravity-gpt"));

    const ompSelectionPath = homePath(home, "usage-dashboard", "selected-account.json");
    const ompSelectionSentinel = `${JSON.stringify({ accountId: "omp-global-sentinel", provider: "openai-codex" })}\n`;
    await mkdir(dirname(ompSelectionPath), { recursive: true, mode: 0o700 });
    await writeFile(ompSelectionPath, ompSelectionSentinel, { mode: 0o600 });
    const openAiPin = createHash("sha256")
      .update(["openai-codex", "", "smoke-google@example.test", "", ""].join("\0"))
      .digest("hex");
    const openAiAccountId = `acc-${openAiPin.slice(0, 12)}`;
    const openAiQuotaSwitch = await api("POST", "/api/v1/quota/switch", { accountId: openAiAccountId });
    assert.equal(openAiQuotaSwitch.status, 404, "OpenAI credentials must not be switchable through Gemini quota");
    assert.equal(openAiQuotaSwitch.payload.error?.code, "ACCOUNT_NOT_FOUND");
    const legacyCliSelection = await api("POST", "/api/select-account", { email: "smoke-cli@example.test", provider: "google-gemini-cli" });
    assert.equal(legacyCliSelection.status, 409, "legacy global account selection must reject non-Antigravity Google credentials");
    assert.equal(legacyCliSelection.payload.error?.code, "ACCOUNT_UNAVAILABLE");
    assert.equal(await readFile(ompSelectionPath, "utf8"), ompSelectionSentinel, "rejected legacy selection must not mutate global OMP preference");
    const defaultSwitch = await api("POST", "/api/v1/quota/switch", { accountId: googleAccount.id });
    assert.equal(defaultSwitch.status, 200, `Gemini default selection failed: ${JSON.stringify(defaultSwitch.payload)}`);
    assert.equal(defaultSwitch.payload.scope, "default");
    const preDefaultModels = await api("GET", `/api/v1/quota/models?sessionId=${encodeURIComponent(preDefaultSession.id)}`);
    assert.equal(preDefaultModels.status, 409);
    assert.equal(preDefaultModels.payload.error?.code, "ACCOUNT_SELECTION_REQUIRED", "a pre-existing chat without a pin or creation snapshot must never inherit a later default");
    const parent = await createFixture("Contract parent");
    const changedDefault = await api("POST", "/api/v1/quota/switch", { accountId: googleAltAccount.id });
    assert.equal(changedDefault.status, 200, `Google Antigravity default change failed: ${JSON.stringify(changedDefault.payload)}`);
    const parentModelsAfterDefaultChange = await api("GET", `/api/v1/quota/models?sessionId=${encodeURIComponent(parent.id)}`);
    assert.equal(parentModelsAfterDefaultChange.status, 200);
    assert.equal(parentModelsAfterDefaultChange.payload.account.id, googleAccount.id, "a new chat must retain the default it captured at creation");
    const currentDefaultModels = await api("GET", "/api/v1/quota/models");
    assert.equal(currentDefaultModels.payload.account.id, googleAltAccount.id);
    const restoredDefault = await api("POST", "/api/v1/quota/switch", { accountId: googleAccount.id });
    assert.equal(restoredDefault.status, 200);
    passes.push("Gemini default repairs dashboard chats missing a creation snapshot while preserving captured defaults");
    const googleModelAccess = await api("GET", "/api/v1/quota/models");
    assert.equal(googleModelAccess.status, 200, `selected Gemini models failed: ${JSON.stringify(googleModelAccess.payload)}`);
    assert.equal(googleModelAccess.payload.account.id, googleAccount.id);
    assert.equal(googleModelAccess.payload.account.providerKey, "google-antigravity");
    assert.deepEqual(googleModelAccess.payload.models.map((model) => model.id), ["smoke-model", "smoke-image-model", "smoke-antigravity-claude", "smoke-antigravity-gpt"]);
    assert.equal(googleModelAccess.payload.models.every((model) => model.provider === "google-antigravity"), true);
    assert.equal(googleModelAccess.payload.models.find((model) => model.id === "smoke-model")?.isDefault, true);
    assert.equal(await readFile(ompSelectionPath, "utf8"), ompSelectionSentinel, "quota selection must not rewrite OMP's terminal-global selected account");
    passes.push("Google Antigravity quota lists its full provider catalog and requires explicit selection without changing OMP global state");

    const autoImageTurn = await api("POST", "/api/v1/chat/send", {
      sessionId: parent.id,
      prompt: "tạo một ảnh PNG AUTO_IMAGE_MODEL_CONTRACT",
      model: "smoke-model",
    });
    assert.equal(autoImageTurn.status, 200, `image generation should auto-route before dispatch: ${JSON.stringify(autoImageTurn.payload)}`);
    assert.equal(autoImageTurn.payload.model, "smoke-image-model");
    assert.equal(autoImageTurn.payload.attachments?.[0]?.name, "auto-image.png");
    assert.ok((await readFakeFrames(home)).some((item) => item.frame.type === "set_model" && item.frame.provider === "google-antigravity" && item.frame.modelId === "smoke-image-model"), "image requests must select the native image model");
    passes.push("image generation auto-routes to the native image model");

    const scopedGeminiSession = await createFixture("Session-scoped Gemini selection");
    const scopedSwitch = await api("POST", "/api/v1/quota/switch", { accountId: googleAltAccount.id, sessionId: scopedGeminiSession.id });
    assert.equal(scopedSwitch.status, 200, `session Antigravity selection failed: ${JSON.stringify(scopedSwitch.payload)}`);
    assert.equal(scopedSwitch.payload.scope, "session");
    assert.equal(scopedSwitch.payload.sessionId, scopedGeminiSession.id);
    const scopedAccounts = await api("GET", `/api/v1/quota/accounts?sessionId=${encodeURIComponent(scopedGeminiSession.id)}`);
    assert.deepEqual(scopedAccounts.payload.filter((account) => account.isActive).map((account) => account.id), [googleAltAccount.id]);
    const unchangedDefault = await api("GET", "/api/v1/quota/accounts");
    assert.deepEqual(unchangedDefault.payload.filter((account) => account.isActive).map((account) => account.id), [googleAccount.id]);
    const scopedModels = await api("GET", `/api/v1/quota/models?sessionId=${encodeURIComponent(scopedGeminiSession.id)}`);
    assert.equal(scopedModels.status, 200);
    assert.equal(scopedModels.payload.account.id, googleAltAccount.id);
    assert.deepEqual(scopedModels.payload.models.map((model) => model.id), ["smoke-model", "smoke-image-model", "smoke-antigravity-claude", "smoke-antigravity-gpt"]);
    const scopedPinFrame = (await readFakeFrames(home)).find((item) => item.frame.type === "prompt" && item.frame.message === `/dashboard-gemini-pin ${googleAltAccount.id}`);
    assert.ok(scopedPinFrame, "session selection must pin the exact Antigravity OAuth credential through the local OMP extension command");
    assert.equal(await readFile(ompSelectionPath, "utf8"), ompSelectionSentinel, "session selection must leave terminal-global OMP selection untouched");
    passes.push("Google Antigravity account selection is manually pinned per session and does not alter the new-chat default");

    const failedPinSession = await createFixture("Gemini pin rejection diagnostics");
    await setFakeMemoryMode(home, "pin-account-unavailable");
    const failedPin = await api("POST", "/api/v1/quota/switch", { accountId: googleAltAccount.id, sessionId: failedPinSession.id });
    assert.equal(failedPin.status, 500);
    assert.equal(failedPin.payload.error?.code, "GEMINI_PIN_ACCOUNT_NOT_AVAILABLE");
    assert.equal(JSON.stringify(failedPin.payload).includes("not available in OMP"), false, "OMP pin diagnostics must not leak raw extension errors");
    await setFakeMemoryMode(home, "normal");
    passes.push("Gemini pin failures return a safe machine-readable diagnostic code");

    const unexpectedPinSession = await createFixture("Gemini pin invokes agent");
    await setFakeMemoryMode(home, "pin-agent-invoked");
    const unexpectedPin = await api("POST", "/api/v1/quota/switch", { accountId: googleAltAccount.id, sessionId: unexpectedPinSession.id });
    assert.equal(unexpectedPin.status, 500);
    assert.equal(unexpectedPin.payload.error?.code, "GEMINI_PIN_NOT_LOCAL");
    await waitForFakeFrame(home, (item) => item.frame.type === "abort" && String(item.frame.id || "").startsWith("abort-gemini-pin-"));
    await setFakeMemoryMode(home, "normal");
    passes.push("Gemini pin waits for a local prompt result and aborts any unexpected model turn");

    const staleGeminiSession = await createFixture("Stale Gemini pin");
    const localChatMetadataPath = homePath(home, "usage-dashboard", "chat-metadata.json");
    const localChatMetadata = JSON.parse(await readFile(localChatMetadataPath, "utf8"));
    localChatMetadata.sessions[staleGeminiSession.id] = {
      ...(localChatMetadata.sessions[staleGeminiSession.id] || {}),
      geminiAccountId: "acc-ffffffffffff",
      geminiProvider: "google-antigravity",
      geminiAccountSelectedAt: Date.now(),
    };
    await writeFile(localChatMetadataPath, `${JSON.stringify(localChatMetadata)}\n`, { mode: 0o600 });
    const staleSessionModels = await api("GET", `/api/v1/quota/models?sessionId=${encodeURIComponent(staleGeminiSession.id)}`);
    assert.equal(staleSessionModels.status, 409);
    assert.equal(staleSessionModels.payload.error?.code, "ACCOUNT_UNAVAILABLE", "a stale session pin must fail closed instead of inheriting the global default");
    assert.equal((await api("GET", "/api/v1/quota/models")).payload.account.id, googleAccount.id);
    passes.push("stale per-session Gemini selection never falls back to the global account");

    const disabledCredentialFixture = homePath(home, "usage-dashboard", "test-disabled-credentials.json");
    await writeFile(disabledCredentialFixture, `${JSON.stringify([{ provider: "google-antigravity", email: googleAltAccount.email }])}\n`, { mode: 0o600 });
    await api("POST", "/api/refresh");
    await api("POST", "/api/refresh");
    const providerAuthStatuses = await api("GET", "/api/v1/quota/accounts");
    assert.equal(providerAuthStatuses.payload.find((account) => account.id === googleAccount.id)?.authStatus, "authenticated");
    assert.equal(providerAuthStatuses.payload.find((account) => account.id === googleAltAccount.id)?.authStatus, "disabled");
    await writeFile(disabledCredentialFixture, "[]\n", { mode: 0o600 });
    await api("POST", "/api/refresh");
    await api("POST", "/api/refresh");
    passes.push("Gemini authentication status remains scoped to its provider-specific credential");

    const googlePin = createHash("sha256")
      .update(["google-antigravity", "", "smoke-google@example.test", "", ""].join("\0"))
      .digest("hex");
    await seedUsageRecord(home, randomUUID(), {
      pinHash: googlePin,
      provider: "google-antigravity",
      model: "smoke-model",
      input: 11,
      output: 7,
      timestamp: new Date(Date.now() - 30_000).toISOString(),
    });
    await seedUsageRecord(home, randomUUID(), { pinHash: googlePin, provider: "anthropic", model: "smoke-external-model", input: 100, output: 50 });
    await seedUsageRecord(home, randomUUID(), { pinHash: "f".repeat(64), provider: "google-antigravity", model: "smoke-model", input: 100, output: 50 });
    await seedUsageRecord(home, randomUUID(), {
      pinHash: googlePin,
      provider: "google-antigravity",
      model: "smoke-model",
      input: 100,
      output: 50,
      timestamp: new Date(Date.now() - 10_000).toISOString(),
      pinTimestamp: new Date(Date.now() + 60_000).toISOString(),
      errorStatus: 429,
    });
    await seedUsageRecord(home, randomUUID(), { provider: "anthropic", model: "smoke-external-model", input: 1000, output: 1000 });
    const refreshedQuota = await api("POST", "/api/v1/quota/sync", {});
    assert.equal(refreshedQuota.status, 200, `quota refresh failed: ${JSON.stringify(refreshedQuota.payload)}`);
    assert.notEqual((await api("GET", "/api/v1/quota/accounts")).payload.find((account) => account.id === googleAccount.id)?.generationStatus, "quota_blocked", "a credential pin written after a usage record must not claim its failure");
    const googleFailureAt = new Date(Date.now() - 5_000).toISOString();
    await seedUsageRecord(home, randomUUID(), {
      pinHash: googlePin,
      provider: "google-antigravity",
      model: "smoke-model",
      input: 4,
      output: 2,
      timestamp: googleFailureAt,
      errorStatus: 429,
    });
    const refreshedGeneration = await api("POST", "/api/v1/quota/sync", {});
    assert.equal(refreshedGeneration.status, 200, `generation refresh failed: ${JSON.stringify(refreshedGeneration.payload)}`);
    const providerGeneration = await api("GET", "/api/v1/quota/accounts");
    assert.equal(providerGeneration.payload.find((account) => account.id === googleAccount.id)?.generationStatus, "quota_blocked");
    assert.equal(providerGeneration.payload.find((account) => account.id === googleAccount.id)?.canUse, true, "a historical 429 must not lock an account with live quota remaining");
    assert.equal(providerGeneration.payload.find((account) => account.id === googleAccount.id)?.statusCode, "warning");
    assert.deepEqual(providerGeneration.payload.filter((account) => account.isActive).map((account) => account.id), [googleAccount.id], "Google Protect must not rotate to a sibling account after a 429");
    assert.equal((await api("GET", "/api/v1/quota/protect-status")).payload.selectedAccountId, googleAccount.id);
    const blockedOverview = await api("GET", "/api/v1/quota/overview");
    assert.ok(blockedOverview.payload.statusCounts.warn >= 1, "a historical 429 with live quota remaining must be counted as warning");
    const quotaHistory = await api("GET", "/api/v1/quota/history?scope=all");
    assert.equal(quotaHistory.status, 200, `quota history failed: ${JSON.stringify(quotaHistory.payload)}`);
    assert.equal(quotaHistory.payload.totalRequests, 2, `Gemini history must include only requests pinned before their timestamps: ${JSON.stringify(quotaHistory.payload)}`);
    assert.deepEqual([...new Set(quotaHistory.payload.items.map((item) => item.model))], ["smoke-model"]);
    assert.ok(quotaHistory.payload.items.every((item) => item.accountId === googleAccount.id));
    assert.equal(quotaHistory.payload.items.some((item) => item.model === "smoke-openai-model"), false);
    passes.push("Gemini history and Protect health remain Gemini-only; Google 429 does not auto-switch accounts");

    const manuallySelectedSibling = await api("POST", "/api/v1/quota/switch", { accountId: googleAltAccount.id });
    assert.equal(manuallySelectedSibling.status, 200, `manual alternate Antigravity selection failed: ${JSON.stringify(manuallySelectedSibling.payload)}`);
    assert.equal((await api("GET", "/api/v1/quota/models")).payload.account.id, googleAltAccount.id);
    const recoveredGooglePin = await seedUsageRecord(home, randomUUID(), {
      pinHash: googlePin,
      provider: "google-antigravity",
      model: "smoke-model",
      input: 1,
      output: 1,
      content: "recovered Gemini model response",
    });
    assert.ok(recoveredGooglePin);
    const recoveredQuotaSync = await api("POST", "/api/v1/quota/sync", {});
    assert.equal(recoveredQuotaSync.status, 200, `quota recovery sync failed: ${JSON.stringify(recoveredQuotaSync.payload)}`);
    assert.equal((await api("GET", "/api/v1/quota/accounts")).payload.find((account) => account.id === googleAccount.id)?.generationStatus, "live");
    await seedUsageRecord(home, randomUUID(), {
      pinHash: googlePin,
      provider: "anthropic",
      model: "smoke-external-model",
      errorStatus: 403,
      timestamp: new Date(Date.now() + 1_000).toISOString(),
    });
    const externalFailureSync = await api("POST", "/api/v1/quota/sync", {});
    assert.equal(externalFailureSync.status, 200);
    assert.equal((await api("GET", "/api/v1/quota/accounts")).payload.find((account) => account.id === googleAccount.id)?.generationStatus, "live", "a non-Google model failure must not mark the pinned Gemini account as denied");
    const recoveredGoogleSwitch = await api("POST", "/api/v1/quota/switch", { accountId: googleAccount.id });
    assert.equal(recoveredGoogleSwitch.status, 200, `manual Google account selection after recovery failed: ${JSON.stringify(recoveredGoogleSwitch.payload)}`);
    assert.equal((await api("GET", "/api/v1/quota/models")).payload.account.id, googleAccount.id);
    assert.equal(await readFile(ompSelectionPath, "utf8"), ompSelectionSentinel, "quota changes must never rewrite OMP's terminal-global selected account");
    passes.push("Gemini account changes require manual selection, including after quota recovery");
    const protectStatus = await api("GET", "/api/v1/quota/protect-status");
    assert.equal(protectStatus.status, 200);
    assert.equal(protectStatus.payload.maxConcurrent, null, "global concurrency cap must be unset");
    await writeFakeMemoryBackend(workspaceRoot, "off");
    const memoryOff = await memoryStatus(parent.id);
    assert.equal(memoryOff.status, 200, `Memory off status failed: ${JSON.stringify(memoryOff.payload)}`);
    assert.equal(memoryOff.payload.backend, "off");
    assert.equal(memoryOff.payload.status, "off");
    assert.deepEqual(memoryOff.payload.operations, []);
    assert.equal((await readFakeFrames(home)).some((item) => item.frame.type === "prompt" && /^\/memory\b/.test(String(item.frame.message || ""))), false, "backend off must not invoke Memory commands");
    passes.push("Memory backend off is reported truthfully without dispatching Memory commands");
    await writeFakeMemoryBackend(workspaceRoot, "unsupported");
    const unknownMemory = await memoryStatus(parent.id);
    assert.equal(unknownMemory.status, 200);
    assert.equal(unknownMemory.payload.backend, "unknown");
    assert.equal(unknownMemory.payload.status, "unavailable");
    assert.deepEqual(unknownMemory.payload.operations, []);
    const missingMemorySessionId = `missing-memory-${randomUUID()}`;
    const framesBeforeMissingMemory = await readFakeFrames(home);
    const missingMemorySession = await memoryStatus(missingMemorySessionId);
    assert.equal(missingMemorySession.status, 404);
    assert.equal(missingMemorySession.payload.error?.code, "NOT_FOUND");
    const missingMemoryAction = await memoryAction(missingMemorySessionId, { action: "stats" });
    assert.equal(missingMemoryAction.status, 404);
    assert.equal(missingMemoryAction.payload.error?.code, "NOT_FOUND");
    assert.equal((await readFakeFrames(home)).length, framesBeforeMissingMemory.length, "unknown Memory session must not create an OMP context");
    passes.push("Memory status/actions reject unknown sessions without creating an OMP context");
    await writeFakeMemoryBackend(workspaceRoot, "local");

    const otherMemorySession = await createFixture("Memory other project", otherRoot);
    await writeFakeMemoryBackend(otherRoot, "mnemopi");
    const otherMemory = await memoryStatus(otherMemorySession.id);
    assert.equal(otherMemory.status, 200, `other-project Memory status failed: ${JSON.stringify(otherMemory.payload)}`);
    assert.equal(otherMemory.payload.backend, "mnemopi", "Memory status must use the selected session CWD config");
    const hindsightSession = await createFixture("Memory Hindsight", otherRoot);
    await writeFakeMemoryBackend(otherRoot, "hindsight");
    const hindsightStatus = await memoryStatus(hindsightSession.id);
    assert.ok(hindsightStatus.payload.operations.includes("clear"));
    const hindsightClear = await memoryAction(hindsightSession.id, { action: "clear", expectedBackend: "hindsight", confirmed: true });
    assert.equal(hindsightClear.status, 200, `Hindsight clear adapter failed: ${JSON.stringify(hindsightClear.payload)}`);
    assert.match(hindsightClear.payload.warning, /recall cache cục bộ/);
    assert.match(hindsightClear.payload.warning, /không xóa dữ liệu trên Hindsight server/);
    passes.push("Hindsight clear warning limits deletion to local session state and recall cache");

    const sharpshooterSession = await createFixture("Memory Sharpshooter", otherRoot);
    await writeFakeMemoryBackend(otherRoot, "sharpshooter");
    const sharpshooterStatus = await memoryStatus(sharpshooterSession.id);
    assert.equal(sharpshooterStatus.payload.status, "supported");
    assert.ok(!sharpshooterStatus.payload.operations.includes("clear"));
    assert.ok(!sharpshooterStatus.payload.operations.includes("reset"));
    const sharpshooterClearCount = (await readFakeFrames(home)).filter((item) => item.frame.type === "prompt" && item.frame.message === "/memory clear").length;
    const sharpshooterClear = await memoryAction(sharpshooterSession.id, { action: "clear", expectedBackend: "sharpshooter", confirmed: true });
    assert.equal(sharpshooterClear.status, 409);
    assert.equal(sharpshooterClear.payload.error?.code, "CONFLICT");
    assert.equal((await readFakeFrames(home)).filter((item) => item.frame.type === "prompt" && item.frame.message === "/memory clear").length, sharpshooterClearCount, "Sharpshooter clear must not dispatch");
    await writeFakeMemoryBackend(otherRoot, "mnemopi");
    const localMemory = await memoryStatus(parent.id);
    assert.equal(localMemory.payload.backend, "local");
    assert.ok(localMemory.payload.operations.includes("stats"));

    const clearPromptCount = (await readFakeFrames(home)).filter((item) => item.frame.type === "prompt" && item.frame.message === "/memory clear").length;
    const unconfirmedClear = await memoryAction(parent.id, { action: "clear", expectedBackend: "local" });
    assert.equal(unconfirmedClear.status, 400, `clear must require explicit confirmation: ${JSON.stringify(unconfirmedClear.payload)}`);
    assert.equal(unconfirmedClear.payload.error?.code, "BAD_REQUEST");
    assert.equal((await readFakeFrames(home)).filter((item) => item.frame.type === "prompt" && item.frame.message === "/memory clear").length, clearPromptCount, "unconfirmed clear must not reach OMP");
    const unconfirmedReset = await memoryAction(parent.id, { action: "reset", expectedBackend: "local" });
    assert.equal(unconfirmedReset.status, 400);
    assert.equal(unconfirmedReset.payload.error?.code, "BAD_REQUEST");
    assert.equal((await readFakeFrames(home)).some((item) => item.frame.type === "prompt" && item.frame.message === "/memory reset"), false, "unconfirmed reset must not reach OMP");

    const stats = await memoryAction(parent.id, { action: "stats", expectedBackend: "local" });
    assert.equal(stats.status, 200, `Memory stats failed: ${JSON.stringify(stats.payload)}`);
    assert.equal(stats.payload.backend, "local");
    assert.equal(stats.payload.action, "stats");
    assert.equal(stats.payload.text, "fake-memory-stats");
    const statsFrame = await waitForFakeFrame(home, (item) => item.frame.type === "prompt" && /^\/memory\b/.test(String(item.frame.message || "")));
    assert.equal(stats.payload.sessionId, parent.id);
    passes.push("Memory stats uses the selected OMP session, returns its local command output, and rejects unconfirmed clear");
    assert.equal(statsFrame.frame.message, "/memory stats");
    assert.equal(stderr.includes("fake-memory-stats"), false, "Memory output must not enter server logs");
    const memoryMessages = await api("GET", `/api/v1/sessions/${encodeURIComponent(parent.id)}/messages`);
    assert.equal(memoryMessages.status, 200);
    assert.equal(JSON.stringify(memoryMessages.payload).includes("fake-memory-stats"), false, "Memory output must not be persisted as chat history");

    const rawMemoryCommand = await memoryAction(parent.id, { action: "/memory stats" });
    assert.equal(rawMemoryCommand.status, 400);
    assert.equal(rawMemoryCommand.payload.error?.code, "BAD_REQUEST");
    assert.equal((await readFakeFrames(home)).some((item) => item.frame.type === "prompt" && item.frame.message === "/memory /memory stats"), false);

    const clearCountBeforeMismatch = (await readFakeFrames(home)).filter((item) => item.frame.type === "prompt" && item.frame.message === "/memory clear").length;
    const staleBackendClear = await memoryAction(otherMemorySession.id, { action: "clear", expectedBackend: "local", confirmed: true });
    assert.equal(staleBackendClear.status, 409);
    assert.equal(staleBackendClear.payload.error?.code, "CONFLICT");
    assert.equal((await readFakeFrames(home)).filter((item) => item.frame.type === "prompt" && item.frame.message === "/memory clear").length, clearCountBeforeMismatch);

    const confirmedClear = await memoryAction(otherMemorySession.id, { action: "clear", expectedBackend: "mnemopi", confirmed: true });
    assert.equal(confirmedClear.status, 200, `confirmed Memory clear failed: ${JSON.stringify(confirmedClear.payload)}; server stderr: ${stderr}`);
    assert.match(confirmedClear.payload.warning, /SQLite database/);
    passes.push("Memory mutation requires confirmation and a matching backend; backend-specific clear scope is disclosed");

    await setFakeMemoryMode(home, "upstream-error");
    const failedMemorySession = await createFixture("Memory upstream failure", otherRoot);
    const upstreamMemoryFailure = await memoryAction(failedMemorySession.id, { action: "stats" });
    assert.equal(upstreamMemoryFailure.payload.error?.code, "UPSTREAM_ERROR");
    assert.equal(JSON.stringify(upstreamMemoryFailure.payload).includes("fake OMP memory failure"), false, "upstream Memory diagnostics must not leak");
    await setFakeMemoryMode(home, "missing-output");
    const missingOutputSession = await createFixture("Memory missing output", otherRoot);
    const missingOutput = await memoryAction(missingOutputSession.id, { action: "stats", expectedBackend: "mnemopi" });
    assert.equal(missingOutput.status, 504, `Memory without command output must time out: ${JSON.stringify(missingOutput.payload)}`);
    assert.equal(missingOutput.payload.error?.code, "UPSTREAM_TIMEOUT");
    assert.equal(Object.hasOwn(missingOutput.payload, "text"), false);
    passes.push("Memory never reports success without native command output");

    await setFakeMemoryMode(home, "agent-invoked");
    const agentMemorySession = await createFixture("Memory unexpected agent", otherRoot);
    const unexpectedAgent = await memoryAction(agentMemorySession.id, { action: "stats" });
    assert.equal(unexpectedAgent.payload.error?.code, "UPSTREAM_ERROR", `unexpected Memory agent call must fail closed: ${JSON.stringify(unexpectedAgent.payload)}; stderr: ${stderr}`);
    await setFakeMemoryMode(home, "normal");

    await setFakeMemoryMode(home, "delayed-output");

    const concurrentMemorySession = await createFixture("Memory operation lock", otherRoot);
    const priorFrameIds = new Set((await readFakeFrames(home)).map((item) => item.frame.id).filter(Boolean));
    const pendingMemoryAction = memoryAction(concurrentMemorySession.id, { action: "stats" });
    await waitForFakeFrame(home, (item) => item.frame.type === "prompt" && item.frame.message === "/memory stats" && !priorFrameIds.has(item.frame.id));
    const overlappingMemoryAction = await memoryAction(concurrentMemorySession.id, { action: "stats" });
    assert.equal(overlappingMemoryAction.status, 409);
    assert.equal(overlappingMemoryAction.payload.error?.code, "CONFLICT");
    assert.equal((await pendingMemoryAction).status, 200);
    await setFakeMemoryMode(home, "normal");
    passes.push("Memory RPC errors fail closed, unexpected agent invocation is rejected, and per-context locking prevents output races");
    const invalidBrowserModeResponse = await fetch(`${baseUrl}/api/v1/chat/stream?prompt=VALIDATION_ORDER&model=not-in-catalog&browserMode=invalid`, { headers: { cookie } });
    const invalidBrowserModePayload = await invalidBrowserModeResponse.json();
    assert.equal(invalidBrowserModeResponse.status, 400);
    assert.equal(invalidBrowserModePayload.error?.field, "browserMode", "invalid options must fail before model catalog lookup");
    passes.push("chat validates browser settings before awaiting the model catalog");
    const invalidSendOptions = [
      { field: "thinking", body: { thinking: "unrecognized" } },
      { field: "browserMode", body: { browserMode: "invalid" } },
      { field: "attachments", body: { attachments: "not-an-array" } },
      { field: "requestId", body: { requestId: "contains spaces" } },
    ];
    for (const invalid of invalidSendOptions) {
      const response = await api("POST", "/api/v1/chat/send", {
        prompt: "VALIDATION_ORDER",
        model: "not-in-catalog",
        ...invalid.body,
      });
      assert.equal(response.status, 400, `${invalid.field} must be rejected before catalog lookup: ${JSON.stringify(response.payload)}`);
      assert.equal(response.payload.error?.field, invalid.field, `${invalid.field} validation must win over an unknown model: ${JSON.stringify(response.payload)}`);
    }
    const allCatalogSend = await api("POST", "/api/v1/chat/send", {
      sessionId: parent.id,
      prompt: "QUOTA_MODEL_GUARD_CONTRACT all-source external model",
      model: "smoke-external-model",
      modelSource: "omp",
    });
    assert.equal(allCatalogSend.status, 200, `OMP source should permit any catalog model: ${JSON.stringify(allCatalogSend.payload)}`);
    assert.equal(allCatalogSend.payload.reply, "quota-model-guard-response");
    assert.ok((await readFakeFrames(home)).some((item) => item.frame.type === "set_model" && item.frame.provider === "anthropic" && item.frame.modelId === "smoke-external-model"), "OMP should receive the external provider model");
    passes.push("Chat OMP source can send a model outside the quota account catalog");

    const allCatalogStream = await openStream(
      parent.id,
      "QUOTA_MODEL_GUARD_CONTRACT all-source stream",
      `all-model-${randomUUID()}`,
      [],
      "smoke-external-model",
      "omp",
    );
    assert.equal(allCatalogStream.response.status, 200, "OMP source should allow the external model on chat stream");
    const allCatalogStarted = await allCatalogStream.reader.waitFor((event) => event.event === "start", "all-source stream start");
    assert.equal(allCatalogStarted.data.model, "smoke-external-model");
    const allCatalogEnded = await allCatalogStream.reader.waitFor((event) => event.event === "end", "all-source stream end");
    assert.equal(allCatalogEnded.data.done, true);
    passes.push("Chat OMP source can stream a model outside the quota account catalog");
    const statusErrorSentinel = "STATUS_OMP_STDERR_SENTINEL";
    const usageFailurePath = homePath(home, "usage-dashboard", "test-usage-stderr.txt");
    await mkdir(dirname(usageFailurePath), { recursive: true, mode: 0o700 });
    await writeFile(usageFailurePath, `${statusErrorSentinel}\n`, { mode: 0o600 });
    const failedRefresh = await api("POST", "/api/refresh", {});
    assert.equal(failedRefresh.status, 200, `isolated usage failure should become status data: ${JSON.stringify(failedRefresh.payload)}`);
    const jsonStatus = await api("GET", "/api/status");
    assert.equal(JSON.stringify(jsonStatus.payload).includes(statusErrorSentinel), false, "status JSON must redact raw OMP stderr");
    const statusResponse = await fetch(`${baseUrl}/api/status/events`, { headers: { cookie, accept: "text/event-stream" } });
    assert.equal(statusResponse.status, 200);
    const statusReader = createSseReader(statusResponse);
    const statusEvent = await statusReader.waitFor((event) => event.event === "status", "status SSE failure event");
    const statusSseLeaks = JSON.stringify(statusEvent.data).includes(statusErrorSentinel);
    await statusReader.cancel();
    await rm(usageFailurePath, { force: true });
    const restoredRefresh = await api("POST", "/api/refresh", {});
    assert.equal(restoredRefresh.status, 200, `status fixture cleanup refresh failed: ${JSON.stringify(restoredRefresh.payload)}`);

    const chatFailure = await openStream(splitUtf8Session.id, "SSE_ERROR_REDACTION_CONTRACT raw provider error", `sse-error-${randomUUID()}`, [], "smoke-external-model", "omp");
    let chatErrorEventText = "";
    try { await chatFailure.reader.waitFor(() => false, "chat upstream error event"); }
    catch (error) { chatErrorEventText = error.message; }
    assert.deepEqual(
      { statusSseLeaks, chatSseLeaks: chatErrorEventText.includes("CHAT_FRAME_ERROR_SENTINEL") },
      { statusSseLeaks: false, chatSseLeaks: false },
      `SSE must not expose raw upstream diagnostics: status=${JSON.stringify(statusEvent.data)} chat=${chatErrorEventText}`,
    );
    assert.match(chatErrorEventText, /UPSTREAM_ERROR/);
    assert.match(chatErrorEventText, /Yêu cầu không thành công/);
    const verificationFailure = await openStream(splitUtf8Session.id, "ACCOUNT_VERIFICATION_CONTRACT", `account-verification-${randomUUID()}`, [], "smoke-external-model", "omp");
    const verificationText = await assertStreamError(verificationFailure.reader, "ACCOUNT_VERIFICATION_REQUIRED", "account verification error");
    assert.match(verificationText, /cần xác minh lại/);
    assert.equal(verificationText.includes("test@example.com"), false, "account verification SSE must not expose provider details");
    passes.push("status and chat SSE redact raw OMP/provider diagnostics");

    const invalidModelSource = await api("POST", "/api/v1/chat/send", {
      sessionId: parent.id,
      prompt: "QUOTA_MODEL_GUARD_CONTRACT invalid source",
      model: "smoke-external-model",
      modelSource: "outside",
    });
    assert.equal(invalidModelSource.status, 400, "unknown model source should fail closed");
    assert.equal(invalidModelSource.payload.error?.code, "BAD_REQUEST");

    const implicitQuotaProvider = await api("POST", "/api/v1/chat/send", {
      sessionId: parent.id,
      prompt: "QUOTA_MODEL_GUARD_CONTRACT omitted provider fallback",
      model: "smoke-model",
      modelSource: "quota",
    });
    assert.equal(implicitQuotaProvider.status, 200, `quota source must resolve duplicate model IDs to the selected provider: ${JSON.stringify(implicitQuotaProvider.payload)}`);
    assert.ok((await readFakeFrames(home)).some((item) => item.frame.type === "set_model" && item.frame.provider === "google-antigravity" && item.frame.modelId === "smoke-model"));
    passes.push("Quota source resolves duplicate model IDs to the selected provider when modelProvider is omitted");

    const allCatalogCommand = await api("POST", `/api/omp/v1/sessions/${encodeURIComponent(parent.id)}/command`, {
      type: "set_model",
      provider: "anthropic",
      modelId: "smoke-external-model",
      modelSource: "omp",
    });
    assert.equal(allCatalogCommand.status, 202, `OMP source set_model should accept external catalog model: ${JSON.stringify(allCatalogCommand.payload)}`);
    const allCatalogModelFrame = (await readFakeFrames(home)).find((item) => item.frame.type === "set_model" && item.frame.provider === "anthropic" && item.frame.modelId === "smoke-external-model");
    assert.ok(allCatalogModelFrame, "external catalog model should reach OMP");
    assert.equal(allCatalogModelFrame.frame.modelSource, undefined, "dashboard-only model source must not leak to OMP");
    passes.push("Gateway set_model accepts an OMP catalog model in OMP source mode");

    const deniedQuotaGpt = await api("POST", "/api/v1/chat/send", {
      sessionId: parent.id,
      prompt: "QUOTA_GPT_DENIED_CONTRACT quota source must stay Gemini-only",
      model: "smoke-openai-model",
      modelSource: "quota",
    });
    assert.equal(deniedQuotaGpt.status, 409, `Quota source must reject a separate OpenAI provider model: ${JSON.stringify(deniedQuotaGpt.payload)}`);
    assert.equal(deniedQuotaGpt.payload.error?.code, "MODEL_NOT_ALLOWED_BY_QUOTA");
    assert.equal((await readFakeFrames(home)).some((item) => item.frame.type === "prompt" && String(item.frame.message || "").includes("QUOTA_GPT_DENIED_CONTRACT")), false, "rejected quota model must not reach OMP");
    const deniedQuotaModelCommand = await api("POST", `/api/omp/v1/sessions/${encodeURIComponent(parent.id)}/command`, {
      type: "set_model",
      provider: "openai-codex",
      modelId: "smoke-openai-model",
      modelSource: "quota",
    });
    assert.equal(deniedQuotaModelCommand.status, 409);
    assert.equal(deniedQuotaModelCommand.payload.error?.code, "MODEL_NOT_ALLOWED_BY_QUOTA");
    passes.push("Gemini quota source rejects ChatGPT before OMP dispatch");

    const ompChatGptSend = await api("POST", "/api/v1/chat/send", {
      sessionId: parent.id,
      prompt: "QUOTA_MODEL_GUARD_CONTRACT OMP ChatGPT remains independent",
      model: "smoke-openai-model",
      modelSource: "omp",
    });
    assert.equal(ompChatGptSend.status, 200, `OMP ChatGPT source should remain available: ${JSON.stringify(ompChatGptSend.payload)}`);
    assert.equal(ompChatGptSend.payload.reply, "quota-model-guard-response");
    assert.ok((await readFakeFrames(home)).some((item) => item.frame.type === "set_model" && item.frame.provider === "openai-codex" && item.frame.modelId === "smoke-openai-model"), "OMP should receive the independent ChatGPT model");
    const quotaModelsIncludeAllAntigravityFamilies = await api("GET", "/api/v1/quota/models");
    assert.equal(quotaModelsIncludeAllAntigravityFamilies.payload.account.id, googleAccount.id);
    assert.deepEqual(quotaModelsIncludeAllAntigravityFamilies.payload.models.map((model) => model.id), ["smoke-model", "smoke-image-model", "smoke-antigravity-claude", "smoke-antigravity-gpt"]);
    const antigravityFamilySession = await createFixture("Quota accepts Antigravity Claude and GPT models");
    for (const modelId of ["smoke-antigravity-claude", "smoke-antigravity-gpt"]) {
      const acceptedFamilyModel = await api("POST", `/api/omp/v1/sessions/${encodeURIComponent(antigravityFamilySession.id)}/command`, {
        type: "set_model",
        provider: "google-antigravity",
        modelId,
        modelSource: "quota",
      });
      assert.equal(acceptedFamilyModel.status, 202, `Quota should accept ${modelId} from Google Antigravity: ${JSON.stringify(acceptedFamilyModel.payload)}`);
      assert.ok((await readFakeFrames(home)).some((item) => item.frame.type === "set_model" && item.frame.provider === "google-antigravity" && item.frame.modelId === modelId), `${modelId} must reach OMP as an Antigravity model selection`);
    }
    passes.push("Quota model selection accepts Claude/GPT families from the pinned Google Antigravity provider without sending a prompt");
    const antigravityFamilySend = await api("POST", "/api/v1/chat/send", {
      sessionId: antigravityFamilySession.id,
      prompt: "FAKE_ANTIGRAVITY_QUOTA_SEND",
      model: "smoke-antigravity-gpt",
      modelProvider: "google-antigravity",
      modelSource: "quota",
    });
    assert.equal(antigravityFamilySend.status, 200, `quota source should dispatch a Google Antigravity GPT-family model: ${JSON.stringify(antigravityFamilySend.payload)}`);
    assert.equal(antigravityFamilySend.payload.reply, "quota-model-guard-response");
    const antigravitySendFrames = await readFakeFrames(home);
    assert.ok(antigravitySendFrames.some((item) => item.frame.type === "set_model" && item.frame.provider === "google-antigravity" && item.frame.modelId === "smoke-antigravity-gpt"));
    assert.ok(antigravitySendFrames.some((item) => item.frame.type === "prompt" && String(item.frame.message || "").includes("FAKE_ANTIGRAVITY_QUOTA_SEND")));
    passes.push("Chat send routes non-Gemini models through the pinned Google Antigravity account without a live model call");
    const fullCatalog = await api("GET", "/api/v1/models");
    assert.ok(fullCatalog.payload.some((model) => model.id === "smoke-openai-model"));
    assert.ok(fullCatalog.payload.some((model) => model.id === "smoke-external-model"));
    assert.deepEqual((await api("GET", "/api/v1/quota/accounts")).payload.filter((account) => account.isActive).map((account) => account.id), [googleAccount.id]);
    passes.push("ChatGPT and other OMP models remain available independently of Gemini quota accounts");

    const firstGeminiStream = await openStream(
      parent.id,
      "QUOTA_MODEL_GUARD_CONTRACT first Gemini turn pins before generation",
      `gemini-pin-order-${randomUUID()}`,
      [],
      "smoke-model",
      "quota",
    );
    await firstGeminiStream.reader.waitFor((event) => event.event === "start", "first Gemini stream start");
    await firstGeminiStream.reader.waitFor((event) => event.event === "end", "first Gemini stream completion");
    const allRecordedFrames = await readFakeFrames(home);
    const parentPromptFrame = allRecordedFrames.find((item) => item.frame.type === "prompt" && String(item.frame.message || "").includes("first Gemini turn pins before generation"));
    assert.ok(parentPromptFrame, "the first Gemini model prompt must reach OMP");
    const parentPinFrame = allRecordedFrames.find((item) => item.contextId === parentPromptFrame.contextId && item.frame.type === "prompt" && item.frame.message === `/dashboard-gemini-pin ${googleAccount.id}`);
    assert.ok(parentPinFrame, "the first Gemini turn must install its selected credential into the OMP session");
    const parentContextFrames = allRecordedFrames.filter((item) => item.contextId === parentPinFrame.contextId).map((item) => item.frame);
    const parentPinIndex = parentContextFrames.findIndex((frame) => frame.type === "prompt" && frame.message === `/dashboard-gemini-pin ${googleAccount.id}`);
    const geminiModelIndex = parentContextFrames.findIndex((frame, index) => index > parentPinIndex && frame.type === "set_model" && frame.modelId === "smoke-model");
    const geminiPromptIndex = parentContextFrames.findIndex((frame, index) => index > geminiModelIndex && frame.type === "prompt" && String(frame.message || "").includes("first Gemini turn pins before generation"));
    assert.ok(parentPinIndex >= 0 && geminiModelIndex > parentPinIndex && geminiPromptIndex > geminiModelIndex, "the exact local Gemini pin must precede model selection and generation");
    passes.push("a Gemini session is pinned before its first model selection and generation");
    const concurrentA = await createFixture("Concurrent session A");
    const concurrentB = await createFixture("Concurrent session B");
    const concurrentFirst = await openStream(concurrentA.id, "CONCURRENT_SLOW", `concurrent-a-${randomUUID()}`);
    await concurrentFirst.reader.waitFor((event) => event.event === "lifecycle" && event.data.type === "turn_start", "concurrent session A turn start");
    const concurrentADelta = await concurrentFirst.reader.waitFor((event) => event.event === "delta", "concurrent session A result", 8000);
    assert.equal(String(concurrentADelta.data.content).endsWith("CONCURRENT_SLOW"), true, "session A must receive only its own result");
    await concurrentFirst.reader.waitFor((event) => event.event === "end", "concurrent session A end");

    const fifoSession = await createFixture("Per-session FIFO");
    const fifoBlocker = await openStream(fifoSession.id, "QUEUE_FIFO_BLOCKER", "fifo-blocker");
    await fifoBlocker.reader.waitFor((event) => event.event === "lifecycle" && event.data.type === "turn_start", "FIFO blocker turn start");
    const fifoFirst = await openStream(fifoSession.id, "CONCURRENT_FIFO_ONE", `fifo-one-${randomUUID()}`);
    assert.equal((await fifoFirst.reader.next(5000)).event, "start", "FIFO first stream starts before its queue snapshot");
    const fifoFirstWaiting = await fifoFirst.reader.next(5000);
    const fifoSecond = await openStream(fifoSession.id, "CONCURRENT_FIFO_TWO", `fifo-two-${randomUUID()}`);
    assert.equal((await fifoSecond.reader.next(5000)).event, "start", "FIFO second stream starts before its queue snapshot");
    const fifoSecondWaiting = await fifoSecond.reader.next(5000);
    const fifoThird = await openStream(fifoSession.id, "CONCURRENT_FIFO_THREE", `fifo-three-${randomUUID()}`);
    assert.equal((await fifoThird.reader.next(5000)).event, "start", "FIFO third stream starts before its queue snapshot");
    const fifoThirdWaiting = await fifoThird.reader.next(5000);
    assert.equal(fifoFirstWaiting.event, "waiting", "FIFO first receives one authoritative queue snapshot");
    assert.equal(fifoSecondWaiting.event, "waiting", "FIFO second receives one authoritative queue snapshot");
    assert.equal(fifoThirdWaiting.event, "waiting", "FIFO third receives one authoritative queue snapshot");
    assert.equal(fifoFirstWaiting.data.queueAhead, 1, "first queued order must see the active turn ahead");
    assert.equal(fifoSecondWaiting.data.queueAhead, 2, "second order must retain FIFO position");
    assert.equal(fifoThirdWaiting.data.queueAhead, 3, "third order must retain FIFO position");
    assert.equal(fifoThirdWaiting.data.queuedTurns, 3, "queue snapshot must include all pending orders");
    const stopFifoBlocker = await api("POST", "/api/v1/chat/abort", { requestId: fifoBlocker.requestId, sessionId: fifoSession.id });
    assert.equal(stopFifoBlocker.status, 202);
    await fifoBlocker.reader.waitFor((event) => event.event === "end" && event.data.aborted === true, "FIFO blocker completion");
    const resumeFifo = await action(fifoSession.id, { action: "resume_queue" });
    assert.equal(resumeFifo.status, 200);
    assert.equal(resumeFifo.payload.queuedTurns, 3);
    const fifoSafetyGap = await fifoFirst.reader.waitFor((event) => event.event === "waiting" && event.data.phase === "safety_gap", "Safety Guard gap snapshot");
    assert.ok(fifoSafetyGap.data.retryAfterSeconds > 0, "Safety Guard gap must include a retry countdown");
    const fifoFrames = [];
    const fifoFirstFrame = await waitForFakeFrame(home, (item) => item.frame.type === "prompt" && String(item.frame.message || "").includes("CONCURRENT_FIFO_ONE"));
    fifoFrames.push(fifoFirstFrame);
    const fifoSecondFrame = await waitForFakeFrame(home, (item) => item.frame.type === "prompt" && String(item.frame.message || "").includes("CONCURRENT_FIFO_TWO"));
    fifoFrames.push(fifoSecondFrame);
    const fifoThirdFrame = await waitForFakeFrame(home, (item) => item.frame.type === "prompt" && String(item.frame.message || "").includes("CONCURRENT_FIFO_THREE"));
    fifoFrames.push(fifoThirdFrame);
    assert.equal(fifoFirstFrame.contextId, fifoSecondFrame.contextId, "same session must keep one OMP context");
    assert.ok(fifoFrames[0].frame.message.endsWith("FIFO_ONE") && fifoFrames[1].frame.message.endsWith("FIFO_TWO") && fifoFrames[2].frame.message.endsWith("FIFO_THREE"), "same-session prompts must dispatch FIFO");
    const [fifoFirstDelta, fifoSecondDelta, fifoThirdDelta] = await Promise.all([
      fifoFirst.reader.waitFor((event) => event.event === "delta", "FIFO first delta"),
      fifoSecond.reader.waitFor((event) => event.event === "delta", "FIFO second delta"),
      fifoThird.reader.waitFor((event) => event.event === "delta", "FIFO third delta"),
    ]);
    assert.equal(String(fifoFirstDelta.data.content).endsWith("CONCURRENT_FIFO_ONE"), true, "FIFO first reader must receive only first prompt result");
    assert.equal(String(fifoSecondDelta.data.content).endsWith("CONCURRENT_FIFO_TWO"), true, "FIFO second reader must receive only second prompt result");
    assert.equal(String(fifoThirdDelta.data.content).endsWith("CONCURRENT_FIFO_THREE"), true, "FIFO third reader must receive only third prompt result");
    await Promise.all([
      fifoFirst.reader.waitFor((event) => event.event === "end", "FIFO first end"),
      fifoSecond.reader.waitFor((event) => event.event === "end", "FIFO second end"),
      fifoThird.reader.waitFor((event) => event.event === "end", "FIFO third end"),
    ]);
    passes.push("orders are accepted immediately, sessions dispatch concurrently, and each session remains FIFO");

    const cancelSession = await createFixture("Queue cancel and resume");
    const cancelBlocker = await openStream(cancelSession.id, "QUEUE_CANCEL_BLOCKER", "queue-cancel-blocker");
    await cancelBlocker.reader.waitFor((event) => event.event === "lifecycle" && event.data.type === "turn_start", "queue cancel blocker turn start");
    const cancelled = await openStream(cancelSession.id, "CONCURRENT_QUEUE_CANCELLED", "queue-cancelled");
    const survivor = await openStream(cancelSession.id, "CONCURRENT_QUEUE_SURVIVOR", "queue-survivor");
    await Promise.all([
      cancelled.reader.waitFor((event) => event.event === "start", "cancelled queue start"),
      survivor.reader.waitFor((event) => event.event === "start", "survivor queue start"),
    ]);
    await Promise.all([
      cancelled.reader.waitFor((event) => event.event === "waiting" && event.data.phase === "fifo" && event.data.queueAhead === 1, "cancelled queue position"),
      survivor.reader.waitFor((event) => event.event === "waiting" && event.data.phase === "fifo" && event.data.queueAhead === 2, "survivor queue position"),
    ]);
    const cancelQueued = await api("POST", "/api/v1/chat/abort", { requestId: cancelled.requestId, sessionId: cancelSession.id });
    assert.equal(cancelQueued.status, 202);
    await cancelled.reader.waitFor((event) => event.event === "end", "cancelled queue end");
    const survivorAfterCancel = await survivor.reader.waitFor((event) => event.event === "waiting" && event.data.phase === "fifo" && event.data.queueAhead === 1, "survivor order remains FIFO after cancellation");
    assert.equal(survivorAfterCancel.data.queuedTurns, 1, "cancelling one queued order must retain the other order");
    const abortBlocker = await api("POST", "/api/v1/chat/abort", { requestId: cancelBlocker.requestId, sessionId: cancelSession.id });
    assert.equal(abortBlocker.status, 202);
    await cancelBlocker.reader.waitFor((event) => event.event === "end" && event.data.aborted === true, "active abort completion");
    const survivorPaused = await survivor.reader.waitFor((event) => event.event === "waiting" && event.data.phase === "paused", "queue pauses after active abort");
    assert.equal(survivorPaused.data.reason, "previous_turn_aborted");
    const pausedState = await api("GET", `/api/v1/sessions/${encodeURIComponent(cancelSession.id)}/state`);
    assert.equal(pausedState.payload.queuePaused, true);
    const resumedQueue = await action(cancelSession.id, { action: "resume_queue" });
    assert.equal(resumedQueue.status, 200);
    assert.equal(resumedQueue.payload.queuedTurns, 1);
    await waitForFakeFrame(home, (item) => item.frame.type === "prompt" && String(item.frame.message || "").includes("CONCURRENT_QUEUE_SURVIVOR"));
    assert.equal((await readFakeFrames(home)).some((item) => item.frame.type === "prompt" && String(item.frame.message || "").includes("CONCURRENT_QUEUE_CANCELLED")), false, "cancelled order must never dispatch");
    await survivor.reader.waitFor((event) => event.event === "end", "survivor completion after resume");
    passes.push("queued cancellation preserves FIFO and an explicit resume restarts only the paused session queue");

    const errorSession = await createFixture("Queue pauses after upstream error");
    const errorTurn = await openStream(errorSession.id, "QUEUE_PAUSE_ERROR", "queue-error");
    const errorFollower = await openStream(errorSession.id, "CONCURRENT_QUEUE_AFTER_ERROR", "queue-after-error");
    await errorFollower.reader.waitFor((event) => event.event === "waiting" && event.data.phase === "fifo", "error follower FIFO snapshot");
    await assertStreamError(errorTurn.reader, "UPSTREAM_ERROR", "upstream queue error");
    const errorPaused = await errorFollower.reader.waitFor((event) => event.event === "waiting" && event.data.phase === "paused", "queue pauses after upstream error");
    assert.equal(errorPaused.data.reason, "previous_turn_failed");
    passes.push("an upstream error pauses, rather than drains, its session queue");

    const timeoutSession = await createFixture("Queue pauses after timeout");
    const timeoutTurn = await openStream(timeoutSession.id, "QUEUE_PAUSE_TIMEOUT", "queue-timeout");
    const timeoutFollower = await openStream(timeoutSession.id, "CONCURRENT_QUEUE_AFTER_TIMEOUT", "queue-after-timeout");
    await timeoutFollower.reader.waitFor((event) => event.event === "waiting" && event.data.phase === "fifo", "timeout follower FIFO snapshot");
    await assertStreamError(timeoutTurn.reader, "UPSTREAM_TIMEOUT", "timeout queue error");
    const timeoutPaused = await timeoutFollower.reader.waitFor((event) => event.event === "waiting" && event.data.phase === "paused", "queue pauses after timeout");
    assert.equal(timeoutPaused.data.reason, "previous_turn_failed");
    passes.push("a timeout pauses its session queue without retrying or dropping the next order");

    const cooldownSession = await createFixture("Safety cooldown queue status");
    const cooldownTurn = await openStream(cooldownSession.id, "QUEUE_SAFETY_COOLDOWN", "queue-cooldown");
    const cooldownFollower = await openStream(cooldownSession.id, "CONCURRENT_QUEUE_AFTER_COOLDOWN", "queue-after-cooldown");
    await cooldownFollower.reader.waitFor((event) => event.event === "waiting" && event.data.phase === "fifo", "cooldown follower FIFO snapshot");
    await assertStreamError(cooldownTurn.reader, "RATE_LIMITED", "safety cooldown error");
    await cooldownFollower.reader.waitFor((event) => event.event === "waiting" && event.data.phase === "paused", "queue pauses after cooldown error");
    const resumedCooldown = await action(cooldownSession.id, { action: "resume_queue" });
    assert.equal(resumedCooldown.status, 200);
    const cooldownWaiting = await cooldownFollower.reader.waitFor((event) => event.event === "waiting" && event.data.phase === "safety_cooldown", "Safety Guard cooldown snapshot");
    assert.ok(cooldownWaiting.data.retryAfterSeconds > 0);
    await cooldownFollower.reader.waitFor((event) => event.event === "end", "cooldown follower completion", 7000);
    passes.push("SSE distinguishes FIFO, Safety Guard cooldown, paused, and resumed queue states");

    const queuedAbortSession = await createFixture("Queued non-stream abort");
    const blockingStreamRequestId = `blocking-stream-${randomUUID()}`;
    const blockingStreamResponse = await fetch(`${baseUrl}/api/v1/chat/stream`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ sessionId: queuedAbortSession.id, requestId: blockingStreamRequestId, prompt: "CONCURRENT_SLOW_BLOCKER", model: "smoke-model", browserMode: "none" }),
    });
    assert.equal(blockingStreamResponse.status, 200);
    const blockingStreamReader = createSseReader(blockingStreamResponse);
    await blockingStreamReader.waitFor((event) => event.event === "start", "blocking stream start");
    await waitForFakeFrame(home, (item) => item.frame.type === "prompt" && String(item.frame.message || "").includes("CONCURRENT_SLOW_BLOCKER"));
    const rawPromptDuringChat = await api("POST", `/api/omp/v1/sessions/${encodeURIComponent(queuedAbortSession.id)}/prompt`, {
      behavior: "prompt",
      message: "RAW_PROMPT_DURING_CHAT_CONTRACT",
    });
    assert.equal(rawPromptDuringChat.status, 409, "raw gateway prompt must not bypass the per-session Chat queue");
    const rawSetModelDuringChat = await api("POST", `/api/omp/v1/sessions/${encodeURIComponent(queuedAbortSession.id)}/command`, {
      command: { type: "set_model", provider: "google-antigravity", modelId: "smoke-model" },
    });
    assert.equal(rawSetModelDuringChat.status, 409, "raw set_model must not race with a queued Chat turn");
    assert.equal((await readFakeFrames(home)).some((item) => item.frame.type === "prompt" && String(item.frame.message || "").includes("RAW_PROMPT_DURING_CHAT_CONTRACT")), false);
    const queuedRequestId = `queued-send-${randomUUID()}`;
    const queuedPrompt = "CONCURRENT_ABORT_BEFORE_DISPATCH";
    const queuedSend = fetch(`${baseUrl}/api/v1/chat/send`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ sessionId: queuedAbortSession.id, requestId: queuedRequestId, prompt: queuedPrompt, model: "smoke-model", browserMode: "none" }),
    }).then(async (response) => ({ status: response.status, payload: await response.json() }));
    let queuedMessageFound = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const messages = await api("GET", `/api/v1/sessions/${encodeURIComponent(queuedAbortSession.id)}/messages`);
      queuedMessageFound = messages.status === 200 && messages.payload.some((message) => message.content === queuedPrompt);
      if (queuedMessageFound) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(queuedMessageFound, false, "queued request must stay out of the conversation before dispatch");
    const queuedAbort = await api("POST", "/api/v1/chat/abort", { requestId: queuedRequestId, sessionId: queuedAbortSession.id });
    assert.equal(queuedAbort.status, 202);
    const queuedSendResult = await Promise.race([
      queuedSend,
      new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
    ]);
    assert.ok(queuedSendResult, "aborting a queued non-stream request must settle its pending HTTP request");
    assert.equal(queuedSendResult.status, 200);
    assert.equal(queuedSendResult.payload.aborted, true);
    await blockingStreamReader.waitFor((event) => event.event === "end", "blocking stream completion", 8000);
    passes.push("aborting a queued non-stream request settles it without dispatch");
    const queuedStreamSession = await createFixture("Queued stream abort");
    const streamBlockerRequestId = `stream-blocker-${randomUUID()}`;
    const streamBlockerResponse = await fetch(`${baseUrl}/api/v1/chat/stream`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ sessionId: queuedStreamSession.id, requestId: streamBlockerRequestId, prompt: "CONCURRENT_SLOW_STREAM_ABORT_BLOCKER", model: "smoke-model", browserMode: "none" }),
    });
    assert.equal(streamBlockerResponse.status, 200);
    const streamBlockerReader = createSseReader(streamBlockerResponse);
    await streamBlockerReader.waitFor((event) => event.event === "start", "stream abort blocker start");
    await waitForFakeFrame(home, (item) => item.frame.type === "prompt" && String(item.frame.message || "").includes("CONCURRENT_SLOW_STREAM_ABORT_BLOCKER"));
    const queuedStreamRequestId = `stream-queued-${randomUUID()}`;
    const queuedStreamResponse = await fetch(`${baseUrl}/api/v1/chat/stream`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ sessionId: queuedStreamSession.id, requestId: queuedStreamRequestId, prompt: "CONCURRENT_FAST_STREAM_ABORT_QUEUED", model: "smoke-model", browserMode: "none" }),
    });
    assert.equal(queuedStreamResponse.status, 200);
    const queuedStreamReader = createSseReader(queuedStreamResponse);
    await queuedStreamReader.waitFor((event) => event.event === "start", "queued stream start");
    const queuedStreamAbort = await api("POST", "/api/v1/chat/abort", { requestId: queuedStreamRequestId, sessionId: queuedStreamSession.id });
    assert.equal(queuedStreamAbort.status, 202);
    const queuedStreamEnd = await queuedStreamReader.waitFor((event) => event.event === "end", "queued stream abort end");
    assert.equal(queuedStreamEnd.data.aborted, true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal((await readFakeFrames(home)).some((item) => item.frame.type === "prompt" && String(item.frame.message || "").includes("CONCURRENT_FAST_STREAM_ABORT_QUEUED")), false, "aborted queued stream must not dispatch");
    await streamBlockerReader.waitFor((event) => event.event === "end", "stream abort blocker completion", 8000);
    passes.push("aborting a queued stream cancels it before OMP dispatch");
    const disconnectSession = await createFixture("Queued stream disconnect");
    const disconnectBlockerId = `disconnect-blocker-${randomUUID()}`;
    const disconnectBlockerResponse = await fetch(`${baseUrl}/api/v1/chat/stream`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ sessionId: disconnectSession.id, requestId: disconnectBlockerId, prompt: "CONCURRENT_SLOW_CLIENT_DISCONNECT_BLOCKER", model: "smoke-model", browserMode: "none" }),
    });
    assert.equal(disconnectBlockerResponse.status, 200);
    const disconnectBlockerReader = createSseReader(disconnectBlockerResponse);
    await disconnectBlockerReader.waitFor((event) => event.event === "start", "disconnect blocker start");
    await waitForFakeFrame(home, (item) => item.frame.type === "prompt" && String(item.frame.message || "").includes("CONCURRENT_SLOW_CLIENT_DISCONNECT_BLOCKER"));
    const disconnectedRequestId = `client-disconnect-${randomUUID()}`;
    const disconnectedResponse = await fetch(`${baseUrl}/api/v1/chat/stream`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ sessionId: disconnectSession.id, requestId: disconnectedRequestId, prompt: "CONCURRENT_FAST_CLIENT_DISCONNECT_QUEUED", model: "smoke-model", browserMode: "none" }),
    });
    assert.equal(disconnectedResponse.status, 200);
    const disconnectedReader = createSseReader(disconnectedResponse);
    await disconnectedReader.waitFor((event) => event.event === "start", "queued disconnect stream start");
    await disconnectedReader.cancel();
    await disconnectBlockerReader.waitFor((event) => event.event === "end", "disconnect blocker completion", 8000);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal((await readFakeFrames(home)).some((item) => item.frame.type === "prompt" && String(item.frame.message || "").includes("CONCURRENT_FAST_CLIENT_DISCONNECT_QUEUED")), false, "client disconnect must cancel a queued stream before dispatch");
    passes.push("client disconnect cancels a queued stream before OMP dispatch");

    const activeSendRequestId = `active-send-${randomUUID()}`;
    const activeSend = api("POST", "/api/v1/chat/send", {
      sessionId: queuedAbortSession.id,
      requestId: activeSendRequestId,
      prompt: "ACTIVE_NONSTREAM_ABORT_CONTRACT",
      model: "smoke-model",
      browserMode: "none",
    });
    await waitForFakeFrame(home, (item) => item.frame.type === "prompt" && String(item.frame.message || "").includes("ACTIVE_NONSTREAM_ABORT_CONTRACT"));
    const activeSendAbort = await api("POST", "/api/v1/chat/abort", { requestId: activeSendRequestId, sessionId: queuedAbortSession.id });
    assert.equal(activeSendAbort.status, 202);
    const activeSendResult = await Promise.race([
      activeSend,
      new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
    ]);
    assert.ok(activeSendResult, "aborting an active non-stream request must settle its HTTP request");
    assert.equal(activeSendResult.status, 200);
    assert.equal(activeSendResult.payload.aborted, true);

    const capacitySession = await createFixture("Bounded chat queue");
    const capacityBlockerRequestId = `capacity-blocker-${randomUUID()}`;
    const capacityBlockerResponse = await fetch(`${baseUrl}/api/v1/chat/stream`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ sessionId: capacitySession.id, requestId: capacityBlockerRequestId, prompt: "QUEUE_CAPACITY_BLOCKER", model: "smoke-model", browserMode: "none" }),
    });
    assert.equal(capacityBlockerResponse.status, 200);
    const capacityBlockerReader = createSseReader(capacityBlockerResponse);
    await capacityBlockerReader.waitFor((event) => event.event === "start", "queue capacity blocker start");
    await waitForFakeFrame(home, (item) => item.frame.type === "prompt" && String(item.frame.message || "").includes("QUEUE_CAPACITY_BLOCKER"));
    const capacityRequests = Array.from({ length: 33 }, (_, index) => ({
      requestId: `queue-capacity-${index}-${randomUUID()}`,
      prompt: `QUEUE_CAPACITY_${index}`,
    }));
    const capacityOutcomes = [];
    const capacityResponses = capacityRequests.map(({ requestId, prompt }) => fetch(`${baseUrl}/api/v1/chat/send`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ sessionId: capacitySession.id, requestId, prompt, model: "smoke-model", browserMode: "none" }),
    }).then(async (response) => {
      const result = { requestId, status: response.status, payload: await response.json() };
      capacityOutcomes.push({ status: result.status, payload: result.payload });
      return result;
    }));
    const overflow = await Promise.race([
      Promise.any(capacityResponses.map(async (response) => {
        const result = await response;
        if (result.status === 429) return result;
        throw new Error(`request was not rejected: ${result.status}`);
      })).catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
    assert.ok(overflow, `a full per-session queue must reject overflow instead of retaining it; settled: ${JSON.stringify(capacityOutcomes)}; stderr: ${stderr.slice(-2000)}`);
    assert.equal(overflow.payload.error?.code, "RATE_LIMITED");
    const queueAborts = await Promise.all(capacityRequests.map(({ requestId }) => api("POST", "/api/v1/chat/abort", {
      requestId,
      sessionId: capacitySession.id,
    })));
    assert.ok(queueAborts.some((response) => response.status === 202), "accepted queued requests must be cancellable");
    const settledCapacity = await Promise.all(capacityResponses);
    assert.equal(settledCapacity.filter((response) => response.status === 429).length, 1);
    assert.equal(settledCapacity.filter((response) => response.status === 200 && response.payload.aborted).length, 32);
    const capacityBlockerAbort = await api("POST", "/api/v1/chat/abort", { requestId: capacityBlockerRequestId, sessionId: capacitySession.id });
    assert.equal(capacityBlockerAbort.status, 202);
    await capacityBlockerReader.waitFor((event) => event.event === "end", "queue capacity blocker completion");
    const autoTitleSession = await createFixture("Phiên làm việc mới");
    await completeSmokeTurn(autoTitleSession.id, "AUTO_TITLE_CONTRACT prompt");
    await assertListedField(autoTitleSession.id, "title", "AUTO_TITLE_CONTRACT prompt");
    passes.push("first user prompt auto-names the session");
    const fileList = await api("GET", `/api/v1/sessions/${encodeURIComponent(parent.id)}/files?mention=${encodeURIComponent("@")}`);
    assert.equal(fileList.status, 200);
    assert.ok(fileList.payload.items.some((item) => item.value === "@src/"));
    assert.ok(!fileList.payload.items.some((item) => item.value.startsWith("@.git")));
    assert.ok(!fileList.payload.items.some((item) => item.value.startsWith("@secrets")));
    passes.push("workspace listing includes allowed files and omits .git and sensitive directories");
    const secretsMentionList = await api("GET", `/api/v1/sessions/${encodeURIComponent(parent.id)}/files?mention=${encodeURIComponent("@secrets/")}`);
    assert.equal(secretsMentionList.status, 200);
    assert.equal(secretsMentionList.payload.items.length, 0, "autocomplete mention for secrets/ must not return internal files");
    passes.push("workspace autocomplete mention for @secrets/ returns no files");

    const validReference = await api("POST", `/api/v1/sessions/${encodeURIComponent(parent.id)}/files/reference`, { path: "@src/good.txt" });
    assert.equal(validReference.status, 200, `valid reference failed: ${JSON.stringify(validReference.payload)}`);
    assert.deepEqual(validReference.payload.attachment, {
      name: "good.txt",
      path: "src/good.txt",
      type: "text/plain",
      size: Buffer.byteLength("Attachment from isolated workspace.\n"),
      text: "Attachment from isolated workspace.\n",
      truncated: false,
      source: "workspace",
    });
    passes.push("valid workspace text returns a complete attachment");
    const otherProject = await createFixture("Other project fixture", otherRoot);
    const otherFileList = await api("GET", `/api/v1/sessions/${encodeURIComponent(otherProject.id)}/files?mention=${encodeURIComponent("@")}`);
    assert.equal(otherFileList.status, 200, `other project file listing failed: ${JSON.stringify(otherFileList.payload)}`);
    assert.ok(otherFileList.payload.items.some((item) => item.value === "@other.txt"));
    assert.ok(!otherFileList.payload.items.some((item) => item.value === "@src/"));
    const otherReference = await api("POST", `/api/v1/sessions/${encodeURIComponent(otherProject.id)}/files/reference`, { path: "@other.txt" });
    assert.equal(otherReference.status, 200, `other project reference failed: ${JSON.stringify(otherReference.payload)}`);
    assert.equal(otherReference.payload.attachment.text, "Attachment from another project.\n");
    await assertReferenceRejected(otherProject.id, "@src/good.txt", 403, "FORBIDDEN", "does not read files from the dashboard workspace");
    passes.push("workspace listing and references stay inside the session project");

    const bindingSource = await createFixture("Transcript binding source", workspaceRoot);
    const bindingTarget = await createFixture("Transcript binding target", otherRoot);
    await appendFile(bindingTarget.path, `${JSON.stringify({ type: "message", id: "private-target", timestamp: new Date().toISOString(), message: { role: "assistant", content: "PRIVATE_OTHER_SESSION" } })}\n`);
    const metadataFile = homePath(home, "usage-dashboard", "chat-metadata.json");
    const metadata = JSON.parse(await readFile(metadataFile, "utf8"));
    metadata.sessions[bindingSource.id] = { ...(metadata.sessions[bindingSource.id] || {}), path: bindingTarget.path, cwd: workspaceRoot };
    await writeFile(metadataFile, `${JSON.stringify(metadata)}\n`, { mode: 0o600 });
    const mismatchedTranscript = await api("GET", `/api/v1/sessions/${encodeURIComponent(bindingSource.id)}/messages`);
    assert.equal(mismatchedTranscript.status, 404, `mismatched transcript must be rejected: ${JSON.stringify(mismatchedTranscript.payload)}`);
    passes.push("transcript path and project CWD mismatch is rejected");

    await assertReferenceRejected(parent.id, "../outside.txt", 400, "BAD_REQUEST", "rejects lexical traversal");
    await assertReferenceRejected(parent.id, "src/../../outside.txt", 403, "FORBIDDEN", "rejects canonical traversal");
    await assertReferenceRejected(parent.id, "escape.txt", 403, "FORBIDDEN", "rejects symlink escape");
    await assertReferenceRejected(parent.id, ".git/config.txt", 403, "FORBIDDEN", "rejects .git content");
    await assertReferenceRejected(parent.id, "secrets/config.json", 403, "FORBIDDEN", "rejects sensitive path component reference");
    await assertReferenceRejected(parent.id, "@secrets/config.json", 403, "FORBIDDEN", "rejects sensitive mention path reference");
    await assertReferenceRejected(parent.id, "binary.txt", 400, "BAD_REQUEST", "rejects NUL-containing text");
    await assertReferenceRejected(parent.id, "large.txt", 400, "BAD_REQUEST", "rejects files over 512 KB");
    await approvalRoundtrip(parent.id, "deny");
    await approvalRoundtrip(parent.id, "approve");
    const approvalCollisionSession = await createFixture("Concurrent approval ID collision");
    await approvalCollisionRoundtrip(parent.id, approvalCollisionSession.id);

    {
      const { reader } = await openStream(parent.id, "RPC_V2_CONTRACT prompt", "rpc-v2");
      await reader.waitFor((event) => event.event === "start", "rpc v2 stream start");
      const negotiated = await waitForFakeFrame(home, (item) => item.frame.type === "negotiate_protocol" && item.frame.protocolVersion === 2);
      assert.equal(negotiated.frame.type, "negotiate_protocol");
      const delta = await reader.waitFor((event) => event.event === "delta" && event.data.content === "rpc-v2-working", "rpc v2 reassembled delta");
      assert.equal(delta.data.content, "rpc-v2-working");
      const ended = await reader.waitFor((event) => event.event === "end", "rpc v2 stream completion");
      assert.equal(ended.data.done, true);
      passes.push("RPC v2 negotiation reassembles chunked native events");
    }
    {
      const { reader } = await openStream(parent.id, "BODY_TOGGLE_CONTRACT prompt", "body-toggle");
      await reader.waitFor((event) => event.event === "start", "body stream start");
      const thinking = await reader.waitFor((event) => event.event === "body" && event.data.block?.kind === "thinking", "thinking body block");
      assert.match(thinking.data.block.text, /live thinking from OMP/);
      const todo = await reader.waitFor((event) => event.event === "body" && event.data.block?.kind === "todo", "todo body block");
      assert.equal(todo.data.block.items[0].content, "Inspect body events");
      const tool = await reader.waitFor((event) => event.event === "body" && event.data.block?.kind === "tool", "tool body block");
      assert.equal(tool.data.block.toolName, "read");
      assert.equal(tool.data.block.toolCallId, "tool-body-1");
      const result = await reader.waitFor((event) => event.event === "body" && event.data.block?.kind === "tool_result", "tool result body block");
      assert.equal(result.data.block.text, "tool result text");
      const ended = await reader.waitFor((event) => event.event === "end", "body stream completion");
      assert.equal(ended.data.done, true);
      assert.equal(ended.data.body.filter((block) => block.kind === "tool" && block.toolCallId === "tool-body-1").length, 1);
      assert.equal(ended.data.body.some((block) => block.kind === "thinking" && /persisted thinking from OMP/.test(block.text)), true);
      assert.equal(ended.data.body.some((block) => block.kind === "tool" && block.toolName === "read"), true);
      const messages = await api("GET", `/api/v1/sessions/${encodeURIComponent(parent.id)}/messages`);
      assert.equal(messages.status, 200);
      const assistant = [...messages.payload].reverse().find((item) => item.role === "assistant" && item.content === "body-final-response");
      assert.ok(assistant, "body contract assistant message should be persisted");
      assert.equal(assistant.body.some((block) => block.kind === "todo"), true);
      assert.equal(assistant.body.some((block) => block.kind === "tool_result"), true);
      passes.push("OMP thinking, todo, tool execution, and tool result persist as collapsed-body blocks");
    }
    {
      const transcriptBody = await createFixture("Persisted body transcript");
      const timestamp = new Date().toISOString();
      await appendFile(transcriptBody.path, [
        {
          type: "message",
          id: "persisted-body-assistant",
          timestamp,
          message: {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "thinking restored from transcript" },
              { type: "toolCall", id: "persisted-tool-1", name: "grep", arguments: { pattern: "body" } },
              { type: "text", text: "persisted-body-final" },
            ],
          },
        },
        {
          type: "message",
          id: "persisted-body-result",
          timestamp,
          message: {
            role: "toolResult",
            toolCallId: "persisted-tool-1",
            toolName: "grep",
            content: [{ type: "text", text: "persisted tool result" }],
            isError: false,
          },
        },
      ].map((line) => JSON.stringify(line)).join("\n") + "\n");
      const transcriptMessages = await api("GET", `/api/v1/sessions/${encodeURIComponent(transcriptBody.id)}/messages`);
      assert.equal(transcriptMessages.status, 200);
      const restored = transcriptMessages.payload.find((item) => item.role === "assistant" && item.content === "persisted-body-final");
      assert.ok(restored, "persisted assistant body should be visible after reload");
      assert.equal(restored.body.some((block) => block.kind === "thinking" && /restored from transcript/.test(block.text)), true);
      assert.equal(restored.body.some((block) => block.kind === "tool" && block.toolCallId === "persisted-tool-1"), true);
      assert.equal(restored.body.some((block) => block.kind === "tool_result" && block.text === "persisted tool result"), true);
      assert.equal(transcriptMessages.payload.some((item) => item.role === "toolResult"), false);
      passes.push("persisted OMP assistant and toolResult records reload into one body-toggle message");
    }
    {
      const consecutive = await createFixture("Consecutive assistant transcript");
      const timestamp = new Date().toISOString();
      await appendFile(consecutive.path, [
        { type: "message", id: "consecutive-assistant-one", timestamp, message: { role: "assistant", content: [{ type: "thinking", thinking: "first assistant detail" }] } },
        { type: "message", id: "consecutive-assistant-two", timestamp, message: { role: "assistant", content: [{ type: "text", text: "merged assistant answer" }] } },
      ].map((line) => JSON.stringify(line)).join("\n") + "\n");
      const restored = await api("GET", `/api/v1/sessions/${encodeURIComponent(consecutive.id)}/messages`);
      assert.equal(restored.status, 200);
      const assistants = restored.payload.filter((item) => item.role === "assistant");
      assert.equal(assistants.length, 1);
      assert.equal(assistants[0].content, "merged assistant answer");
      assert.equal(assistants[0].body.some((block) => block.kind === "thinking" && block.text === "first assistant detail"), true);
      passes.push("consecutive persisted assistant records merge without losing body blocks");
    }
    {
      const { reader } = await openStream(parent.id, "LOCAL_COMMAND_CONTRACT prompt", "local-command");
      await reader.waitFor((event) => event.event === "start", "local command stream start");
      const commandBody = await reader.waitFor((event) => event.event === "body" && event.data.block?.kind === "command", "local command body block");
      assert.equal(commandBody.data.block.text, "local-command-output");
      const output = await reader.waitFor((event) => event.event === "command_output", "local command output");
      assert.equal(output.data.text, "local-command-output");
      assert.equal(output.data.bodyBlockId, commandBody.data.block.id);
      const result = await reader.waitFor((event) => event.event === "prompt_result", "local command result");
      assert.equal(result.data.agentInvoked, false);
      const ended = await reader.waitFor((event) => event.event === "end", "local command stream completion");
      assert.equal(ended.data.localOnly, true);
      passes.push("local native command output and prompt result reach SSE once as body plus legacy compatibility event");
    }
    {
      const { reader } = await openStream(parent.id, "NONTERMINAL_CONTRACT prompt", "nonterminal");
      await reader.waitFor((event) => event.event === "start", "nonterminal stream start");
      const delta = await reader.waitFor((event) => event.event === "delta" && event.data.content === "terminal-after-maintenance", "terminal delta after maintenance");
      assert.equal(delta.data.content, "terminal-after-maintenance");
      const ended = await reader.waitFor((event) => event.event === "end", "terminal stream completion");
      assert.equal(ended.data.done, true);
      passes.push("non-terminal agent_end does not close the active turn");
    }
    {
      const { reader } = await openStream(parent.id, "FOLLOW_UP_CONTRACT prompt", "follow-up");
      await reader.waitFor((event) => event.event === "start", "follow-up stream start");
      const initial = await reader.waitFor((event) => event.event === "delta" && event.data.content === "initial-follow-up-turn", "initial follow-up delta");
      assert.equal(initial.data.content, "initial-follow-up-turn");
      const promptFrame = await waitForFakeFrame(home, (item) => item.frame.type === "prompt" && String(item.frame.message || "").includes("FOLLOW_UP_CONTRACT"));
      const queued = await action(parent.id, { action: "follow_up", message: "Continue through native queue." });
      assert.equal(queued.status, 200, `follow-up action failed: ${JSON.stringify(queued.payload)}`);
      assert.equal(queued.payload.status, "follow_up_sent");
      const followUpFrame = await waitForFakeFrame(home, (item) => item.contextId === promptFrame.contextId && item.frame.type === "follow_up");
      assert.equal(followUpFrame.frame.message, "Continue through native queue.");
      const followUpDelta = await reader.waitFor((event) => event.event === "delta" && event.data.content === "native-follow-up-turn", "native follow-up delta");
      assert.equal(followUpDelta.data.content, "native-follow-up-turn");
      const ended = await reader.waitFor((event) => event.event === "end", "follow-up stream completion");
      assert.equal(ended.data.done, true);
      passes.push("active follow-up stays on one native stream until terminal settle");
    }
    {
      const { reader } = await openStream(parent.id, "AUTO_TITLE_CONTRACT BROWSER_DEFAULT_CONTRACT", "browser-default");
      await reader.waitFor((event) => event.event === "start", "browser default stream start");
      const outbound = await waitForFakeFrame(home, (item) => item.frame.type === "prompt" && String(item.frame.message || "").includes("BROWSER_DEFAULT_CONTRACT"));
      assert.doesNotMatch(outbound.frame.message, /^\/skill:ego-browser/, "browser must stay off when browserMode is omitted");
      await reader.waitFor((event) => event.event === "end", "browser default stream completion");
      passes.push("browser skill is opt-in when browserMode is omitted");
    }
    {
      const { reader } = await openStream(parent.id, "AUTO_TITLE_CONTRACT BROWSER_OPT_IN_CONTRACT", "browser-opt-in", [], "smoke-model", "quota", "ego-browser");
      await reader.waitFor((event) => event.event === "start", "browser opt-in stream start");
      const outbound = await waitForFakeFrame(home, (item) => item.frame.type === "prompt" && String(item.frame.message || "").includes("BROWSER_OPT_IN_CONTRACT"));
      assert.match(outbound.frame.message, /^\/skill:ego-browser\n\n/, "browser skill must run only when explicitly enabled");
      await reader.waitFor((event) => event.event === "end", "browser opt-in stream completion");
      passes.push("browser skill dispatches only after explicit opt-in");
    }
    {
      const { reader } = await openStream(parent.id, "tạo ảnh LONG_IMAGE_TIMEOUT_CONTRACT", "long-image", [], "smoke-image-model");
      const started = await reader.waitFor((event) => event.event === "start", "long image stream start");
      assert.equal(started.data.longRunning, true);
      assert.equal(started.data.activityTimeoutSeconds, 6);
      const media = await reader.waitFor((event) => event.event === "media", "long image media", 12000);
      assert.equal(media.data.attachments[0].name, "long-result.png");
      await reader.waitFor((event) => event.event === "end", "long image stream completion", 12000);
      passes.push("image generation receives the long-running watchdog");
    }
    {
      const { reader } = await openStream(parent.id, "đọc toàn bộ file code dự án LONG_AUDIT_TIMEOUT_CONTRACT", "long-audit");
      const started = await reader.waitFor((event) => event.event === "start", "long audit stream start");
      assert.equal(started.data.longRunning, true);
      assert.equal(started.data.activityTimeoutSeconds, 6);
      const tool = await reader.waitFor((event) => event.event === "body" && event.data.block?.kind === "tool", "long audit activity", 12000);
      assert.equal(tool.data.block.toolName, "read");
      const delta = await reader.waitFor((event) => event.event === "delta" && event.data.content === "long-audit-reply", "long audit reply", 12000);
      assert.equal(delta.data.content, "long-audit-reply");
      await reader.waitFor((event) => event.event === "end", "long audit stream completion", 12000);
      passes.push("active full-code audit refreshes its long-running watchdog");
    }
    {
      const inputImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
      const inputText = "attachment-contract-text";
      const { reader } = await openStream(parent.id, "tạo ảnh MEDIA_CONTRACT prompt", "media", [
        { name: "tiny.png", type: "image/png", size: 68, data: inputImage },
        { name: "notes.txt", type: "text/plain", size: inputText.length, text: inputText },
      ], "smoke-image-model", "quota", "ego-browser");
      await reader.waitFor((event) => event.event === "start", "media stream start");
      const outbound = await waitForFakeFrame(home, (item) => item.frame.type === "prompt" && String(item.frame.message || "").includes("MEDIA_CONTRACT"));
      assert.deepEqual(outbound.frame.images, [inputImage]);
      assert.doesNotMatch(outbound.frame.message, /^\/skill:ego-browser/, "image blocks must bypass the skill wrapper so ACP delivers them to OMP");
      const delta = await reader.waitFor((event) => event.event === "delta" && event.data.content === "media-reply", "media text delta");
      assert.equal(delta.data.content, "media-reply");
      const media = await reader.waitFor((event) => event.event === "media", "assistant media event");
      assert.equal(media.data.attachments[0].type, "image/png");
      assert.equal(media.data.attachments[0].data, inputImage);
      const ended = await reader.waitFor((event) => event.event === "end", "media stream completion");
      assert.equal(ended.data.attachments[0].name, "result.png");
      const messages = await api("GET", `/api/v1/sessions/${encodeURIComponent(parent.id)}/messages`);
      assert.equal(messages.status, 200);
      const userMessage = messages.payload.find((item) => item.role === "user" && item.content === "tạo ảnh MEDIA_CONTRACT prompt");
      const assistantMessage = messages.payload.find((item) => item.role === "assistant" && item.content === "media-reply");
      assert.equal(userMessage.attachments.length, 2);
      assert.equal(userMessage.attachments.find((item) => item.name === "tiny.png").data, inputImage);
      assert.equal(userMessage.attachments.find((item) => item.name === "notes.txt").text, inputText);
      assert.equal(assistantMessage.attachments[0].name, "result.png");
      passes.push("image-generation model returns assistant media and persists the generated image");
    }
    {
      const outputImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
      const { reader } = await openStream(parent.id, "tạo ảnh IMAGEGEN_BLOB_CONTRACT", "imagegen-blob", [], "smoke-image-model");
      await reader.waitFor((event) => event.event === "start", "imagegen blob stream start");
      const media = await reader.waitFor((event) => event.event === "media", "imagegen blob media");
      assert.equal(media.data.attachments[0].data, outputImage, "only a checksum-verified OMP image blob may reach chat");
      const ended = await reader.waitFor((event) => event.event === "end", "imagegen blob stream completion");
      assert.equal(ended.data.attachments[0].name, "generated.png");
      const messages = await api("GET", `/api/v1/sessions/${encodeURIComponent(parent.id)}/messages`);
      assert.ok(messages.payload.some((item) => item.role === "assistant" && item.content === "imagegen-reply" && item.attachments?.[0]?.data === outputImage));
      passes.push("image generation tool blob is checksum-verified, streamed, and persisted");
    }
    {
      const { reader } = await openStream(parent.id, "tạo ảnh IMAGEGEN_MISSING_MEDIA_CONTRACT", "imagegen-missing", [], "smoke-image-model");
      await reader.waitFor((event) => event.event === "start", "imagegen missing-media stream start");
      await assert.rejects(reader.waitFor((event) => event.event === "end", "imagegen missing-media error"), /UPSTREAM_IMAGE_MISSING|không trả ảnh đầu ra/);
      const messages = await api("GET", `/api/v1/sessions/${encodeURIComponent(parent.id)}/messages`);
      assert.ok(!messages.payload.some((item) => item.role === "assistant" && item.content === "ảnh mới đã xong"), "text-only image claims must not persist as successful output");
      passes.push("text-only image claims fail instead of completing successfully");
    }
    {
      const { reader } = await openStream(parent.id, "LOCAL_COMMAND_CONTRACT prompt", "local-command");
      await reader.waitFor((event) => event.event === "start", "local command stream start");
      const output = await reader.waitFor((event) => event.event === "command_output", "local command output");
      assert.equal(output.data.text, "local-command-output");
      const result = await reader.waitFor((event) => event.event === "prompt_result", "local command result");
      assert.equal(result.data.agentInvoked, false);
      const ended = await reader.waitFor((event) => event.event === "end", "local command stream completion");
      assert.equal(ended.data.localOnly, true);
      passes.push("local native command output and prompt result reach SSE");
    }
    {
      const { reader } = await openStream(parent.id, "INPUT_APPROVAL_CONTRACT prompt", "input-approval");
      await reader.waitFor((event) => event.event === "start", "input approval stream start");
      const requested = await reader.waitFor((event) => event.event === "approval", "input approval request");
      assert.equal(requested.data.method, "input");
      assert.equal(requested.data.placeholder, "feature/...");
      const resolved = await api("POST", `/api/v1/sessions/${encodeURIComponent(parent.id)}/approval`, { id: requested.data.id, value: "feature/rpc-host" });
      assert.equal(resolved.status, 200, `input approval response failed: ${JSON.stringify(resolved.payload)}`);
      assert.equal(resolved.payload.value, "feature/rpc-host");
      const forwarded = await waitForFakeFrame(home, (item) => item.frame.type === "extension_ui_response" && item.frame.id === requested.data.id);
      assert.deepEqual(forwarded.frame, { type: "extension_ui_response", id: requested.data.id, value: "feature/rpc-host" });
      const delta = await reader.waitFor((event) => event.event === "delta" && event.data.content === "input:feature/rpc-host", "input approval result");
      assert.equal(delta.data.content, "input:feature/rpc-host");
      const ended = await reader.waitFor((event) => event.event === "end", "input approval stream completion");
      assert.equal(ended.data.done, true);
      passes.push("native input approval round-trips value without decision coercion");
    }
    {
      const { reader } = await openStream(parent.id, "SELECT_APPROVAL_CONTRACT prompt", "select-approval");
      await reader.waitFor((event) => event.event === "start", "select approval stream start");
      const requested = await reader.waitFor((event) => event.event === "approval", "select approval request");
      assert.equal(requested.data.method, "select");
      assert.deepEqual(requested.data.options, ["feature/main", "feature/release"]);
      const resolved = await api("POST", `/api/v1/sessions/${encodeURIComponent(parent.id)}/approval`, { id: requested.data.id, value: "feature/release" });
      assert.equal(resolved.status, 200, `select approval response failed: ${JSON.stringify(resolved.payload)}`);
      assert.equal(resolved.payload.value, "feature/release");
      const forwarded = await waitForFakeFrame(home, (item) => item.frame.type === "extension_ui_response" && item.frame.id === requested.data.id);
      assert.deepEqual(forwarded.frame, { type: "extension_ui_response", id: requested.data.id, value: "feature/release" });
      const delta = await reader.waitFor((event) => event.event === "delta" && event.data.content === "input:feature/release", "select approval result");
      assert.equal(delta.data.content, "input:feature/release");
      const ended = await reader.waitFor((event) => event.event === "end", "select approval stream completion");
      assert.equal(ended.data.done, true);
      passes.push("native select approval preserves option values");
    }
    {
      const { reader } = await openStream(parent.id, "SELECT_APPROVAL_CONTRACT prompt", "select-approval-expiry");
      await reader.waitFor((event) => event.event === "start", "select approval expiry stream start");
      const requested = await reader.waitFor((event) => event.event === "approval", "select approval expiry request");
      assert.equal(requested.data.method, "select");
      assert.deepEqual(requested.data.options, ["feature/main", "feature/release"]);
      assert.equal(requested.data.timeoutMs, TEST_APPROVAL_TIMEOUT_MS);
      const forwarded = await waitForFakeFrame(home, (item) => item.frame.type === "extension_ui_response" && item.frame.id === requested.data.id);
      assert.deepEqual(forwarded.frame, { type: "extension_ui_response", id: requested.data.id, cancelled: true });
      assert.notEqual(forwarded.frame.value, "feature/main");
      assert.notEqual(forwarded.frame.value, "feature/release");
      const delta = await reader.waitFor((event) => event.event === "delta" && event.data.content === "approval:denied", "select approval expiry result");
      assert.equal(delta.data.content, "approval:denied");
      const ended = await reader.waitFor((event) => event.event === "end", "select approval expiry stream completion");
      assert.equal(ended.data.done, true);
      const expiredResolution = await api("POST", `/api/v1/sessions/${encodeURIComponent(parent.id)}/approval`, { id: requested.data.id, value: "feature/release" });
      assert.equal(expiredResolution.status, 404, `expired approval should not be resolvable: ${JSON.stringify(expiredResolution.payload)}`);
      assert.equal(expiredResolution.payload.error?.code, "NOT_FOUND");
      passes.push("unresponded native select approval expires as cancelled and becomes unresolvable");
    }
    {
      const nativeState = await api("GET", `/api/v1/sessions/${encodeURIComponent(parent.id)}/state`);
      assert.equal(nativeState.status, 200, `native state failed: ${JSON.stringify(nativeState.payload)}`);
      assert.equal(nativeState.payload.sessionId, parent.id);
      assert.equal(nativeState.payload.status, "ready");
      assert.equal(typeof nativeState.payload.protocolVersion, "number");
      assert.equal(nativeState.payload.settingsSource, "omp");
      assert.equal(nativeState.payload.messageCount >= 0, true);
      passes.push("native session state remains available without overriding HON PI settings");
    }


    const idleSteer = await action(parent.id, { action: "steer", message: "must be rejected while idle" });
    assert.equal(idleSteer.status, 409);
    assert.equal(idleSteer.payload.error?.code, "CONFLICT");

    const requestId = `active-turn-${randomUUID()}`;
    const streamController = new AbortController();
    let streamReader;
    let streamFinished = false;
    try {
      const response = await fetch(`${baseUrl}/api/v1/chat/stream`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ sessionId: parent.id, requestId, prompt: "ACTIVE_TURN_CONTRACT prompt", model: "smoke-model", tools: ["read"] }),
        signal: streamController.signal,
      });
      if (response.status !== 200) throw new Error(`chat stream failed (${response.status}): ${await response.text()}`);
      streamReader = createSseReader(response);
      const started = await streamReader.waitFor((event) => event.event === "start", "stream start");
      assert.equal(started.data.requestId, requestId);
      const turnStarted = await streamReader.waitFor((event) => event.event === "lifecycle" && event.data.type === "turn_start", "active turn start");
      assert.equal(turnStarted.data.sessionId, parent.id);
      const promptFrame = await waitForFakeFrame(home, (item) => item.frame.type === "prompt" && item.frame.message.includes("ACTIVE_TURN_CONTRACT"));
      const activeMemoryPromptCount = (await readFakeFrames(home)).filter((item) => item.contextId === promptFrame.contextId && item.frame.type === "prompt" && item.frame.message === "/memory stats").length;
      const activeMemory = await memoryAction(parent.id, { action: "stats", expectedBackend: "local" });
      assert.equal(activeMemory.status, 409);
      assert.equal(activeMemory.payload.error?.code, "CONFLICT");
      assert.equal((await readFakeFrames(home)).filter((item) => item.contextId === promptFrame.contextId && item.frame.type === "prompt" && item.frame.message === "/memory stats").length, activeMemoryPromptCount);
      passes.push("Memory action is rejected without dispatch during an active chat turn");

      const activeSteer = await action(parent.id, { action: "steer", message: "Continue with the constrained response." });
      assert.equal(activeSteer.status, 200, `active steer failed: ${JSON.stringify(activeSteer.payload)}`);
      assert.equal(activeSteer.payload.status, "steer_sent");
      const steerFrame = await waitForFakeFrame(home, (item) => item.contextId === promptFrame.contextId && item.frame.type === "steer");
      assert.equal(steerFrame.frame.message, "Continue with the constrained response.");

      const activeReconnect = await action(parent.id, { action: "reconnect" });
      assert.equal(activeReconnect.status, 409);
      assert.equal(activeReconnect.payload.error?.code, "CONFLICT");

      const aborted = await api("POST", "/api/v1/chat/abort", { requestId, sessionId: parent.id });
      assert.equal(aborted.status, 202);
      assert.equal(aborted.payload.success, true);
      assert.equal(aborted.payload.status, "abort_requested");
      assert.equal(aborted.payload.requestId, requestId);
      assert.equal(aborted.payload.sessionId, parent.id);
      const abortFrame = await waitForFakeFrame(home, (item) => item.contextId === promptFrame.contextId && item.frame.type === "abort");
      assert.equal(abortFrame.frame.id, `abort-${requestId}`);

      const ended = await streamReader.waitFor((event) => event.event === "end", "aborted stream completion");
      assert.equal(ended.data.done, true);
      streamFinished = true;
    } finally {
      if (!streamFinished) {
        streamController.abort();
        await streamReader?.cancel().catch(() => {});
      }
    }
    const ephemeral = await api("POST", "/api/v1/sessions", { title: "Ephemeral abort recovery", tools: ["read"] });
    assert.equal(ephemeral.status, 201);
    const ephemeralRequestId = `ephemeral-abort-${randomUUID()}`;
    const ephemeralController = new AbortController();
    const ephemeralResponse = await fetch(`${baseUrl}/api/v1/chat/stream`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ sessionId: ephemeral.payload.id, requestId: ephemeralRequestId, prompt: "EPHEMERAL_ABORT_CONTRACT", model: "smoke-model", tools: ["read"] }),
      signal: ephemeralController.signal,
    });
    assert.equal(ephemeralResponse.status, 200);
    const ephemeralReader = createSseReader(ephemeralResponse);
    await ephemeralReader.waitFor((event) => event.event === "start", "ephemeral stream start");
    await ephemeralReader.waitFor((event) => event.event === "lifecycle" && event.data.type === "turn_start", "ephemeral turn start");
    const ephemeralAborted = await api("POST", "/api/v1/chat/abort", { requestId: ephemeralRequestId, sessionId: ephemeral.payload.id });
    assert.equal(ephemeralAborted.status, 202);
    ephemeralController.abort();
    await ephemeralReader.cancel().catch(() => {});
    let recovered = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const listed = await listSessions();
      const visible = listed.some((item) => item.id === ephemeral.payload.id);
      const messages = await api("GET", `/api/v1/sessions/${encodeURIComponent(ephemeral.payload.id)}/messages`);
      const hasPrompt = messages.status === 200 && messages.payload.some((item) => item.content === "EPHEMERAL_ABORT_CONTRACT");
      if (visible && hasPrompt) { recovered = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(recovered, true, "aborted ephemeral session must remain listed with its prompt");
    const ephemeralReconnect = await action(ephemeral.payload.id, { action: "reconnect" });
    assert.equal(ephemeralReconnect.status, 200, `ephemeral reconnect failed: ${JSON.stringify(ephemeralReconnect.payload)}`);
    assert.equal(ephemeralReconnect.payload.status, "ready");
    passes.push("aborted ephemeral session remains listed and reconnectable");

    const reconnectAfterAbort = await action(parent.id, { action: "reconnect" });
    assert.equal(reconnectAfterAbort.status, 200, `reconnect after abort failed: ${JSON.stringify(reconnectAfterAbort.payload)}`);
    assert.equal(reconnectAfterAbort.payload.status, "ready");
    passes.push("active-turn steer, reconnect guard, and abort transitions");
    const rename = await action(parent.id, { action: "rename", title: "Renamed contract parent" });
    assert.equal(rename.status, 200);
    assert.equal(rename.payload.session.title, "Renamed contract parent");
    await assertListedField(parent.id, "title", "Renamed contract parent");
    passes.push("rename persists visible title");

    for (const [on, off, field] of [["pin", "unpin", "isPinned"], ["unread", "read", "isUnread"]]) {
      const enabled = await action(parent.id, { action: on });
      assert.equal(enabled.status, 200, `${on} should succeed`);
      assert.equal(enabled.payload.session[field], true);
      await assertListedField(parent.id, field, true);
      const disabled = await action(parent.id, { action: off });
      assert.equal(disabled.status, 200, `${off} should succeed`);
      assert.equal(disabled.payload.session[field], false);
      await assertListedField(parent.id, field, false);
    }
    passes.push("pin/unpin and unread/read expose updated state");

    const invalidFolder = await api("POST", "/api/v1/folders", { name: "../unsafe-folder", cwd: otherRoot });
    assert.equal(invalidFolder.status, 400);
    assert.equal(invalidFolder.payload.error?.code, "BAD_REQUEST");
    const noFolderPath = await api("POST", "/api/v1/folders", { name: "Missing workspace" });
    assert.equal(noFolderPath.status, 400, "new project folders must name a real workspace directory");
    const workspaceListing = await api("GET", `/api/v1/workspaces?path=${encodeURIComponent(workspaceRoot)}`);
    assert.equal(workspaceListing.status, 200, `workspace browsing failed: ${JSON.stringify(workspaceListing.payload)}`);
    assert.deepEqual(workspaceListing.payload.directories.map((item) => item.name), ["other-project", "src"]);
    const blockedWorkspace = await api("GET", `/api/v1/workspaces?path=${encodeURIComponent(secretsDir)}`);
    assert.equal(blockedWorkspace.payload.error?.code, "FORBIDDEN", "sensitive directories must not be selectable");

    const metadataPath = homePath(home, "usage-dashboard", "chat-metadata.json");
    const seededMetadata = JSON.parse(await readFile(metadataPath, "utf8"));
    seededMetadata.folders["folder-legacy"] = { id: "folder-legacy", name: "Legacy project", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await writeFile(metadataPath, `${JSON.stringify(seededMetadata, null, 2)}\n`, { mode: 0o600 });
    const oldFolders = await api("GET", "/api/v1/folders");
    assert.ok(oldFolders.payload.some((folder) => folder.id === "folder-legacy"), "legacy project groups remain visible");
    const legacyProjectChat = await api("POST", "/api/v1/sessions", { title: "Legacy project needs a path", folderId: "folder-legacy" });
    assert.equal(legacyProjectChat.status, 409, "legacy virtual folders must be configured before starting new project chats");
    const configuredLegacy = await api("PATCH", "/api/v1/folders/folder-legacy", { cwd: otherRoot });
    assert.equal(configuredLegacy.status, 200, `legacy folder path update failed: ${JSON.stringify(configuredLegacy.payload)}`);
    assert.equal(configuredLegacy.payload.cwd, otherRoot);

    const createdFolder = await api("POST", "/api/v1/folders", { name: "Contract folder", cwd: otherRoot });
    assert.equal(createdFolder.status, 201, `folder creation failed: ${JSON.stringify(createdFolder.payload)}`);
    assert.match(createdFolder.payload.id, /^folder-[0-9a-f-]{36}$/);
    assert.equal(createdFolder.payload.name, "Contract folder");
    assert.equal(createdFolder.payload.cwd, otherRoot);
    const listedFolders = await api("GET", "/api/v1/folders");
    assert.equal(listedFolders.status, 200);
    assert.ok(listedFolders.payload.some((folder) => folder.id === createdFolder.payload.id && folder.name === "Contract folder" && folder.cwd === otherRoot));

    const projectSession = await api("POST", "/api/v1/sessions", { title: "Project-owned chat", folderId: createdFolder.payload.id, cwd: workspaceRoot });
    assert.equal(projectSession.status, 201, `project session creation failed: ${JSON.stringify(projectSession.payload)}`);
    assert.equal(projectSession.payload.folderId, createdFolder.payload.id);
    assert.equal(projectSession.payload.folderName, "Contract folder");
    assert.equal(projectSession.payload.cwd, otherRoot, "project CWD must override any conflicting per-chat workspace");
    const folderWithProject = await api("GET", "/api/v1/folders");
    const projectFolderView = folderWithProject.payload.find((folder) => folder.id === createdFolder.payload.id);
    assert.equal(projectFolderView?.sessionCount, 1, "folder count must include its project chat even when the main session list is paginated");
    assert.equal(projectFolderView?.sessions?.[0]?.id, projectSession.payload.id, "folder response must include its assigned chat preview");
    let chatMetadata = JSON.parse(await readFile(metadataPath, "utf8"));
    assert.equal(chatMetadata.sessions[projectSession.payload.id].cwd, otherRoot, "new project chats must persist the project CWD before the first message");
    assert.equal(chatMetadata.sessions[projectSession.payload.id].folderId, createdFolder.payload.id);

    const generalWorkspace = join(home, "Documents", "OMP General Chat");
    const generalSession = await api("POST", "/api/v1/sessions", { title: "Unclassified General default" });
    assert.equal(generalSession.status, 201, `default general session creation failed: ${JSON.stringify(generalSession.payload)}`);
    assert.equal(generalSession.payload.cwd, await realpath(generalWorkspace));
    assert.equal(generalSession.payload.folderId, undefined);
    assert.equal(generalSession.payload.folderName, undefined);
    assert.equal((await stat(generalWorkspace)).mode & 0o077, 0, "new General workspace must not be accessible to group/other users");
    chatMetadata = JSON.parse(await readFile(metadataPath, "utf8"));
    assert.equal(chatMetadata.sessions[generalSession.payload.id].cwd, generalSession.payload.cwd);
    assert.equal(chatMetadata.sessions[generalSession.payload.id].folderId, undefined, "General is a workspace, not a project folder");
    const listedGeneral = (await listSessions()).find((item) => item.id === generalSession.payload.id);
    assert.equal(listedGeneral?.cwd, generalSession.payload.cwd, "session list must expose its actual workspace");
    assert.equal(listedGeneral?.folderId, undefined);

    const unassignedSession = await api("POST", "/api/v1/sessions", { title: "Unassigned folder contract", cwd: otherRoot });
    assert.equal(unassignedSession.status, 201, `unassigned session creation failed: ${JSON.stringify(unassignedSession.payload)}`);
    assert.equal(unassignedSession.payload.cwd, otherRoot);
    assert.equal(unassignedSession.payload.folderId, undefined);
    assert.equal(unassignedSession.payload.folderName, undefined);
    chatMetadata = JSON.parse(await readFile(metadataPath, "utf8"));
    assert.equal(chatMetadata.sessions[unassignedSession.payload.id].cwd, otherRoot);
    assert.equal(chatMetadata.sessions[unassignedSession.payload.id].folderId, undefined, "matching a project CWD must not assign a chat implicitly");
    const listedUnassigned = (await listSessions()).find((item) => item.id === unassignedSession.payload.id);
    assert.ok(listedUnassigned, "new unassigned session must remain visible after reload/list");
    assert.equal(listedUnassigned.cwd, otherRoot);
    assert.equal(listedUnassigned.folderId, undefined);
    assert.equal(listedUnassigned.folderName, undefined);
    passes.push("General workspace is the secure default, per-chat CWD persists, and project folders override workspace without assigning generic chats");

    const assignedFolder = await action(parent.id, { action: "assign_folder", folderId: createdFolder.payload.id });
    assert.equal(assignedFolder.status, 200, `folder assignment failed: ${JSON.stringify(assignedFolder.payload)}`);
    assert.deepEqual(
      { folderId: assignedFolder.payload.session.folderId, folderName: assignedFolder.payload.session.folderName },
      { folderId: createdFolder.payload.id, folderName: "Contract folder" },
    );
    chatMetadata = JSON.parse(await readFile(metadataPath, "utf8"));
    assert.equal(chatMetadata.sessions[parent.id].cwd, workspaceRoot, "assigning an existing chat must not change its current working directory");
    await assertListedField(parent.id, "folderId", createdFolder.payload.id);
    await assertListedField(parent.id, "folderName", "Contract folder");

    const unassignedFolder = await action(parent.id, { action: "unassign_folder" });
    assert.equal(unassignedFolder.status, 200, `folder unassignment failed: ${JSON.stringify(unassignedFolder.payload)}`);
    assert.equal(unassignedFolder.payload.session.folderId, undefined);
    assert.equal(unassignedFolder.payload.session.folderName, undefined);
    await assertListedField(parent.id, "folderId", undefined);
    await assertListedField(parent.id, "folderName", undefined);

    const reassignedFolder = await action(parent.id, { action: "assign_folder", folderId: createdFolder.payload.id });
    assert.equal(reassignedFolder.status, 200);
    const reloadedSession = (await listSessions()).find((item) => item.id === parent.id);
    assert.deepEqual(
      { folderId: reloadedSession?.folderId, folderName: reloadedSession?.folderName },
      { folderId: createdFolder.payload.id, folderName: "Contract folder" },
    );
    const reloadedFolders = await api("GET", "/api/v1/folders");
    assert.ok(reloadedFolders.payload.some((folder) => folder.id === createdFolder.payload.id && folder.cwd === otherRoot));
    passes.push("folder metadata survives reload, legacy workspace assignment, and session reassignment without changing existing CWD");

    const fork = await action(parent.id, { action: "fork" });
    assert.equal(fork.status, 200, `fork failed: ${JSON.stringify(fork.payload)}`);
    assert.equal(fork.payload.status, "ready");
    assert.ok(fork.payload.forkSession?.id);
    assert.ok((await listSessions()).some((item) => item.id === fork.payload.forkSession.id), "ready fork must appear in the OMP-backed session list");
    passes.push("fork waits for a listed child session");

    const reconnect = await action(parent.id, { action: "reconnect" });
    assert.equal(reconnect.status, 200, `reconnect failed: ${JSON.stringify(reconnect.payload)}`);
    assert.equal(reconnect.payload.status, "ready");
    assert.equal(reconnect.payload.context?.status, "ready");
    passes.push("reconnect returns a ready context");

    const tools = await action(parent.id, { action: "tools", tools: ["read", "grep"] });
    assert.equal(tools.status, 200, `tools update failed: ${JSON.stringify(tools.payload)}`);
    assert.deepEqual(tools.payload.session?.tools, ["read", "grep"]);
    await assertListedField(parent.id, "tools", ["read", "grep"]);
    passes.push("tools update persists the selected allowlist");

    const localShare = await action(parent.id, { action: "share", shareMode: "local" });
    assert.equal(localShare.status, 200);
    assert.equal(localShare.payload.status, "ready");
    assert.equal(localShare.payload.shareMode, "local");
    assert.match(localShare.payload.shareUrl, new RegExp(`^http://127\\.0\\.0\\.1:${port}/chat\\?session=${parent.id}$`));
    passes.push("local share returns a loopback URL for its session");

    const encryptedShare = await action(parent.id, { action: "share", shareMode: "encrypted" });
    assert.equal(encryptedShare.status, 200, `encrypted adapter rejected controlled HTTPS output: ${JSON.stringify(encryptedShare.payload)}`);
    assert.equal(encryptedShare.payload.status, "ready");
    assert.match(encryptedShare.payload.shareUrl, /^https:\/\/share\.example\.test\//);
    passes.push("encrypted share accepts only controlled HTTPS output");

    const collab = await action(parent.id, { action: "share", shareMode: "collab-read" });
    assert.equal(collab.status, 409);
    assert.equal(collab.payload.error?.code, "CONFLICT");
    passes.push("unavailable Collab mode is rejected");

    const legacySessionId = randomUUID();
    const legacyPath = await seedOmpSession(home, legacySessionId, legacyRoot, "Legacy CWD fixture");
    const legacyModelsBeforePin = await api("GET", `/api/v1/quota/models?sessionId=${encodeURIComponent(legacySessionId)}`);
    assert.equal(legacyModelsBeforePin.status, 409);
    assert.equal(legacyModelsBeforePin.payload.error?.code, "ACCOUNT_SELECTION_REQUIRED", "existing OMP sessions without dashboard metadata must not inherit a later default");
    const legacyPin = await api("POST", "/api/v1/quota/switch", { accountId: googleAccount.id, sessionId: legacySessionId });
    assert.equal(legacyPin.status, 200, `legacy session Gemini pin failed: ${JSON.stringify(legacyPin.payload)}`);
    const legacyRequestId = `legacy-cwd-${randomUUID()}`;
    const legacyResponse = await fetch(`${baseUrl}/api/v1/chat/stream`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ sessionId: legacySessionId, requestId: legacyRequestId, prompt: "LEGACY_CWD_CONTRACT", model: "smoke-model", tools: ["read"] }),
    });
    if (legacyResponse.status !== 200) {
      throw new Error(`legacy CWD stream failed (${legacyResponse.status}): ${await legacyResponse.text()}`);
    }
    const legacyReader = createSseReader(legacyResponse);
    const legacyStarted = await legacyReader.waitFor((event) => event.event === "start", "legacy CWD stream start");
    assert.equal(legacyStarted.data.sessionId, legacySessionId);
    const legacyDelta = await legacyReader.waitFor((event) => event.event === "delta" && event.data.content === "working", "legacy CWD response");
    assert.equal(legacyDelta.data.content, "working");
    const legacyEnded = await legacyReader.waitFor((event) => event.event === "end", "legacy CWD stream completion");
    const migratedSession = JSON.parse((await readFile(legacyPath, "utf8")).split("\n")[0]);
    assert.equal(migratedSession.cwd, workspaceRoot);
    assert.equal(legacyEnded.data.done, true);
    passes.push("legacy session CWD migrates to the allowed workspace");

    const archived = await action(parent.id, { action: "archive" });
    assert.equal(archived.status, 200, `archive failed: ${JSON.stringify(archived.payload)}`);
    assert.equal(archived.payload.metadata?.archived, true);
    assert.ok(archived.payload.moved?.destination);
    await assert.rejects(readFile(archived.payload.moved.source));
    await readFile(archived.payload.moved.destination);
    assert.ok(!(await listSessions()).some((item) => item.id === parent.id));
    passes.push("archive moves the fixture and hides it from the list");

    const doomed = await createFixture("Contract delete fixture");
    const deleted = await action(doomed.id, { action: "delete" });
    assert.equal(deleted.status, 200, `delete failed: ${JSON.stringify(deleted.payload)}`);
    assert.equal(deleted.payload.metadata?.deleted, true);
    assert.ok(deleted.payload.moved?.destination);
    await assert.rejects(readFile(doomed.path));
    await readFile(deleted.payload.moved.destination);
    assert.ok(!(await listSessions()).some((item) => item.id === doomed.id));
    passes.push("delete moves only the fixture to isolated trash");

    const validMetadata = await readFile(metadataPath, "utf8");
    const corruptMetadata = "{\"folders\":";
    await writeFile(metadataPath, corruptMetadata, { mode: 0o600 });
    const rejectedMetadataMutation = await api("POST", "/api/v1/folders", { name: "Must not replace corrupt metadata", cwd: workspaceRoot });
    assert.equal(rejectedMetadataMutation.status, 500, `unreadable metadata must fail closed: ${JSON.stringify(rejectedMetadataMutation.payload)}`);
    assert.equal(await readFile(metadataPath, "utf8"), corruptMetadata, "failed metadata reads must not overwrite the original bytes");
    await writeFile(metadataPath, validMetadata, { mode: 0o600 });
    passes.push("corrupt chat metadata fails closed without replacing its bytes");

    await rm(fakeBin, { force: true });
    const acpFailure = await api("GET", "/api/v1/sessions?limit=10");
    assert.equal(acpFailure.status, 502, `ACP spawn failure should return an upstream error: ${JSON.stringify(acpFailure.payload)}`);
    assert.equal(acpFailure.payload.error?.code, "UPSTREAM_UNAVAILABLE");
    assert.equal(JSON.stringify(acpFailure.payload).includes(fakeBin), false, "ACP spawn errors must not expose executable paths");
    const healthAfterAcpFailure = await fetch(`${baseUrl}/healthz`);
    assert.equal(healthAfterAcpFailure.status, 200, "dashboard must remain alive after ACP cannot spawn");
    passes.push("ACP spawn failure returns safely while the dashboard remains healthy");
    console.log(`session action contract: ${passes.length} scenarios passed on isolated port ${port}`);
    for (const item of passes) console.log(`PASS ${item}`);
  } catch (error) {
    throw error;
  } finally {
    await stopChild(server);
    await rm(home, { recursive: true, force: true });
  }
}

async function main() {
  if (process.argv[2] === FAKE_OMP_FLAG || process.env.OMP_DASHBOARD_FAKE_OMP === "1") {
    await fakeOmp(process.argv[2] === FAKE_OMP_FLAG ? process.argv.slice(3) : process.argv.slice(2));
    return;
  }
  await runContract();
}

main().catch((error) => {
  console.error(`session action contract failed: ${error.stack || error}`);
  process.exitCode = 1;
});
