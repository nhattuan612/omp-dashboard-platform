import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = 4188;
const server = spawn(process.execPath, ["server.mjs"], {
  cwd: root,
  env: { ...process.env, OMP_DASHBOARD_PORT: String(port) },
  stdio: ["ignore", "ignore", "pipe"],
});

async function request(path, options) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { return await fetch(`http://127.0.0.1:${port}${path}`, options); }
    catch (error) { if (attempt === 29) throw error; await wait(100); }
  }
  throw new Error("unreachable");
}

async function json(path, options = {}) {
  const response = await request(path, { headers: { "content-type": "application/json" }, ...options });
  const body = await response.json();
  assert.equal(response.ok, true, `${path}: ${JSON.stringify(body)}`);
  return body;
}

async function readChunk(reader, timeoutMs = 5000) {
  const result = await Promise.race([
    reader.read(),
    wait(timeoutMs).then(() => { throw new Error("SSE timeout"); }),
  ]);
  return result.done ? "" : new TextDecoder().decode(result.value);
}

try {
  const capabilities = await json("/api/omp/v1/capabilities");
  assert.equal(capabilities.contractVersion, "1");
  assert.equal(capabilities.transport.stream, "sse");
  assert.equal(capabilities.features.includes("browser-control"), true);

  const largeRequest = await request("/api/omp/v1/sessions", {
    method: "POST",
    body: JSON.stringify({ sessionId: "x".repeat(12000), cwd: root }),
  });
  assert.equal(largeRequest.status, 400);
  assert.notEqual((await largeRequest.json()).message, "Request quá lớn");

  const created = await json("/api/omp/v1/sessions", {
    method: "POST",
    body: JSON.stringify({ sessionId: "harness-smoke", cwd: root }),
  });
  assert.equal(created.sessionId, "harness-smoke");
  assert.equal(created.contractVersion, "1");

  const idempotent = await json("/api/omp/v1/sessions", {
    method: "POST",
    body: JSON.stringify({ sessionId: "harness-smoke", cwd: root }),
  });
  assert.equal(idempotent.context.id, created.context.id);

  const events = await request(`/api/omp/v1/sessions/${created.sessionId}/events`);
  assert.equal(events.ok, true);
  const reader = events.body.getReader();
  let buffer = "";
  for (let attempt = 0; attempt < 12 && !buffer.includes("event: omp"); attempt += 1) buffer += await readChunk(reader);
  assert.match(buffer, /event: (bridge_status|omp)/);

  const state = await json(`/api/omp/v1/sessions/${created.sessionId}/command`, {
    method: "POST",
    body: JSON.stringify({ command: { type: "get_state" } }),
  });
  assert.equal(state.command, "get_state");

  const rejected = await request(`/api/omp/v1/sessions/${created.sessionId}/command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command: { type: "read_omp_token_file" } }),
  });
  assert.equal(rejected.status, 400);

  const closed = await json(`/api/omp/v1/sessions/${created.sessionId}`, { method: "DELETE" });
  assert.equal(closed.closed, true);
  await reader.cancel();
  console.log("omp gateway smoke: ok");
} finally {
  server.kill("SIGTERM");
}
