#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const root = await mkdtemp(join(projectRoot, ".acp-worker-test-"));
const home = join(root, "home");
const cwdA = join(root, "workspace-a");
const cwdB = join(root, "workspace-b");
const cwdC = join(root, "workspace-c");
const ompDir = join(home, ".bun", "bin");
const fakeSource = join(root, "fake-omp.mjs");
const fakeBin = join(ompDir, "omp");

const fakeOmp = `#!/usr/bin/env node
import { createInterface } from "node:readline";
let nextSession = 0;
const configOptions = [
  { id: "model", name: "Model", currentValue: "openai/gpt-5.1", options: [{ value: "openai/gpt-5.1", name: "GPT 5.1" }, { value: "google/gemini-3.1-flash-image", name: "Gemini Image" }] },
  { id: "thinking", name: "Thinking", currentValue: "high", options: [{ value: "off", name: "Off" }, { value: "high", name: "High" }] },
];
function send(frame) { process.stdout.write(JSON.stringify(frame) + "\\n"); }
function reply(id, result = {}) { send({ jsonrpc: "2.0", id, result }); }
function sendCommands(sessionId) { setTimeout(() => send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: "available_commands_update", availableCommands: [{ name: "memory", source: "builtin" }, { name: "dashboard-gemini-pin", source: "extension" }] } } }), 10); }
function createSession() { const sessionId = process.pid + "-session-" + (++nextSession); sendCommands(sessionId); return { sessionId, configOptions }; }
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  let frame;
  try { frame = JSON.parse(line); } catch { process.exitCode = 2; break; }
  if (frame.method === "initialize" && process.env.ACPX_FAIL_INITIALIZE === "1") {
    send({ jsonrpc: "2.0", id: frame.id, error: { code: -32000, message: "deliberate initialize failure" } });
    continue;
  } else if (frame.method === "initialize" || frame.method === "authenticate" || frame.method === "session/close" || frame.method === "session/set_config_option") {
    reply(frame.id, {});
  } else if (frame.method === "session/new" || frame.method === "session/fork") {
    reply(frame.id, createSession());
  } else if (frame.method === "session/load") {
    const sessionId = frame.params.sessionId;
    if (sessionId.startsWith("missing")) {
      send({ jsonrpc: "2.0", id: frame.id, error: { code: -32000, message: "missing session" } });
      continue;
    }
    reply(frame.id, { sessionId, configOptions });
    sendCommands(sessionId);
  } else if (frame.method === "session/prompt") {
    const text = (frame.params.prompt || []).map((part) => part.text || "").join("");
    if (text === "ERROR_429") {
      reply(frame.id, { stopReason: "error", errorStatus: 429, errorMessage: "image quota exhausted" });
      continue;
    }
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: frame.params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: frame.params.sessionId + ":" + text } } } });
    reply(frame.id, { stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } });
  } else if (frame.method === "session/cancel") {
    continue;
  } else {
    send({ jsonrpc: "2.0", id: frame.id, error: { code: -32601, message: "not implemented: " + frame.method } });
  }
}
`;

const runner = `
import assert from "node:assert/strict";
import { ConsoleBridge } from ${JSON.stringify(pathToFileURL(join(projectRoot, "console-bridge.mjs")).href)};
const bridge = new ConsoleBridge({ env: process.env });
const cwdA = ${JSON.stringify(cwdA)};
const cwdB = ${JSON.stringify(cwdB)};
const cwdC = ${JSON.stringify(cwdC)};
const options = { approvalMode: "write", tools: ["read"] };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const passes = [];
try {
  const warmed = await bridge.prewarm({ cwd: cwdA, ...options });
  const first = await bridge.start({ protocol: "acp", cwd: cwdA, ...options });
  const second = await bridge.start({ protocol: "acp", cwd: cwdA, ...options });
  assert.equal(first.pid, warmed.pid, "prewarm must be reused by a chat session");
  assert.equal(first.pid, second.pid, "matching workspace and launch policy must share one worker");
  assert.notEqual(first.id, second.id, "chats keep independent dashboard contexts");
  assert.notEqual(first.sessionId, second.sessionId, "chats keep independent OMP ACP sessions");
  const clientA = bridge.createClient();
  const liveA = { chunks: [], write(chunk) { this.chunks.push(chunk); } };
  bridge.subscribe(first.id, clientA, liveA, { replay: false });
  await bridge.send(first.id, { id: "prompt-a", type: "prompt", message: "A_ONLY" });
  await wait(1050);
  await bridge.send(second.id, { id: "prompt-b", type: "prompt", message: "B_ONLY" });
  const firstFrames = bridge.get(first.id).frames;
  const secondFrames = bridge.get(second.id).frames;
  assert.ok(firstFrames.some((frame) => JSON.stringify(frame).includes("A_ONLY")));
  assert.ok(!firstFrames.some((frame) => JSON.stringify(frame).includes("B_ONLY")), "one chat must not receive another session's output");
  assert.ok(secondFrames.some((frame) => JSON.stringify(frame).includes("B_ONLY")));
  assert.ok(!secondFrames.some((frame) => JSON.stringify(frame).includes("A_ONLY")), "sibling output must remain isolated");
  await wait(1050);
  const errorFrameCount = bridge.get(second.id).frames.length;
  await bridge.send(second.id, { id: "prompt-error", type: "prompt", message: "ERROR_429" });
  const errorFrames = bridge.get(second.id).frames.slice(errorFrameCount);
  const terminalError = errorFrames.find((frame) => frame.type === "agent_end");
  assert.equal(terminalError?.message?.errorStatus, 429, "ACP terminal errors must preserve their upstream status");
  assert.equal(terminalError?.message?.errorMessage, "image quota exhausted", "ACP terminal errors must preserve their upstream message");
  passes.push("ACP terminal errors preserve upstream status and message");
  const frameCountBeforeReplay = firstFrames.length;
  const writesBeforeReplay = liveA.chunks.length;
  const clientB = bridge.createClient();
  const replayB = { chunks: [], write(chunk) { this.chunks.push(chunk); } };
  bridge.subscribe(first.id, clientB, replayB, { replay: true });
  assert.equal(firstFrames.length, frameCountBeforeReplay, "replay must not append cached frames to session history");
  assert.equal(liveA.chunks.length, writesBeforeReplay, "replay must not redeliver history to an existing client");
  assert.equal(replayB.chunks.filter((chunk) => chunk.startsWith("event: omp\\n")).length, frameCountBeforeReplay, "a new client receives each cached frame exactly once");
  bridge.removeClient(clientA);
  bridge.removeClient(clientB);
  passes.push("ACP history replay targets only the new client without mutating frame history");

  await wait(1050);
  const firstFrameCount = bridge.get(first.id).frames.length;
  await bridge.send(first.id, { id: "memory-local", type: "prompt", message: "/memory stats" });
  const memoryFrames = bridge.get(first.id).frames.slice(firstFrameCount);
  assert.ok(memoryFrames.some((frame) => frame.type === "command_output" && frame.command === "memory" && String(frame.text).includes("/memory stats")), "ACP local Memory output must preserve the command_output contract");
  assert.equal(memoryFrames.find((frame) => frame.type === "response" && frame.id === "memory-local")?.data?.agentInvoked, false, "local Memory commands must not be reported as model prompts");
  assert.ok(!memoryFrames.some((frame) => frame.type === "message_update"), "local Memory output must not leak into chat streaming");
  const forked = await bridge.fork(first.id);
  assert.notEqual(forked.sessionId, first.sessionId, "fork creates a distinct OMP session");
  assert.notEqual(forked.context.id, first.id, "fork creates a distinct dashboard context");
  assert.equal(forked.context.pid, first.pid, "fork remains in the shared workspace worker");
  await bridge.stop(first.id);
  assert.equal(bridge.get(second.id).summary().status, "ready", "closing one session must not stop its sibling");
  assert.equal(bridge.get(second.id).summary().pid, second.pid);
  await wait(1050);
  await bridge.send(second.id, { id: "prompt-after-close", type: "prompt", message: "B_AFTER_CLOSE" });
  assert.ok(bridge.get(second.id).frames.some((frame) => JSON.stringify(frame).includes("B_AFTER_CLOSE")), "sibling must still process prompts after another context closes");
  const otherWorkspace = await bridge.start({ protocol: "acp", cwd: cwdB, ...options });
  assert.notEqual(otherWorkspace.pid, second.pid, "different workspace must use a separate worker");
  const otherPolicy = await bridge.start({ protocol: "acp", cwd: cwdA, approvalMode: "yolo", tools: ["read"] });
  await assert.rejects(
    bridge.start({ protocol: "acp", cwd: cwdB, ...options, ompSessionId: "missing-shared" }),
    (error) => error.code === "UPSTREAM_ERROR",
  );
  assert.equal(bridge.get(otherWorkspace.id).summary().status, "ready", "failed sibling load must not kill a shared worker");
  const existingPids = bridge.state().acpWorkers.map((worker) => worker.pid).sort((a, b) => a - b);
  await assert.rejects(
    bridge.start({ protocol: "acp", cwd: cwdC, ...options, ompSessionId: "missing-orphan" }),
    (error) => error.code === "UPSTREAM_ERROR",
  );
  assert.deepEqual(bridge.state().acpWorkers.map((worker) => worker.pid).sort((a, b) => a - b), existingPids, "failed isolated startup must stop and remove its worker");
  assert.notEqual(otherPolicy.pid, second.pid, "different launch policy must use a separate worker");
  const pidsBeforeStartupFailure = bridge.state().acpWorkers.map((worker) => worker.pid).sort((a, b) => a - b);
  process.env.ACPX_FAIL_INITIALIZE = "1";
  try {
    await assert.rejects(bridge.prewarm({ cwd: cwdC, approvalMode: "always-ask", tools: ["edit"] }));
  } finally {
    delete process.env.ACPX_FAIL_INITIALIZE;
  }
  assert.deepEqual(bridge.state().acpWorkers.map((worker) => worker.pid).sort((a, b) => a - b), pidsBeforeStartupFailure, "failed ACP initialization must terminate and remove its worker");
  passes.push("ACP startup failure terminates and removes the worker");

  console.log("ACP pool: prewarm reuse, isolated sessions, fork, sibling lifetime, workspace and policy partitioning; " + passes.join("; ") + " passed");
} finally {
  await bridge.close();
}
`;

try {
  await mkdir(cwdA, { recursive: true });
  await mkdir(cwdB, { recursive: true });
  await mkdir(cwdC, { recursive: true });
  await mkdir(ompDir, { recursive: true, mode: 0o700 });
  await writeFile(fakeSource, fakeOmp, { mode: 0o700 });
  await writeFile(fakeBin, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeSource)} "$@"\n`, { mode: 0o700 });
  await chmod(fakeBin, 0o700);
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", runner], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOME: home,
      OMP_DASHBOARD_WORKSPACE: cwdA,
      OMP_DASHBOARD_GENERAL_WORKSPACE: cwdA,
      OMP_ALLOWED_WORKSPACES: [cwdA, cwdB, cwdC].join(delimiter),
      OMP_SAFETY_STATE_FILE: join(home, ".omp", "usage-dashboard", "safety-state.json"),
    },
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(result.status, 0, `isolated ACP integration failed\n${result.stdout}\n${result.stderr}`);
  process.stdout.write(result.stdout);
} finally {
  await rm(root, { recursive: true, force: true });
}
