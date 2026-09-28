import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = 4187;
const server = spawn(process.execPath, ["dashboard/server.mjs"], {
  cwd: root,
  env: { ...process.env, OMP_DASHBOARD_PORT: String(port) },
  stdio: ["ignore", "ignore", "pipe"],
});

async function get(path, options) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { return await fetch(`http://127.0.0.1:${port}${path}`, options); }
    catch (error) { if (attempt === 29) throw error; await wait(100); }
  }
  throw new Error("unreachable");
}

async function json(path, options = {}) {
  const response = await get(path, { headers: { "content-type": "application/json" }, ...options });
  const body = await response.json();
  assert.equal(response.ok, true, `${path}: ${JSON.stringify(body)}`);
  return body;
}

try {
  assert.equal((await (await get("/healthz")).json()).ok, true);
  assert.match(await (await get("/console")).text(), /OMP Web Console/);
  const sessions = await json("/api/console/sessions");
  assert.equal(Array.isArray(sessions.sessions), true);
  const client = await json("/api/console/connect", { method: "POST", body: "{}" });
  assert.match(client.clientId, /^[0-9a-f-]{36}$/);
  const started = await json("/api/console/start", { method: "POST", body: JSON.stringify({ cwd: root }) });
  assert.equal(started.context.cwd, root);
  const contextId = started.context.id;
  await json("/api/console/command", { method: "POST", body: JSON.stringify({ contextId, command: { id: "smoke-state", type: "get_state" } }) });
  let context;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    context = (await json("/api/console/state")).contexts.find((item) => item.id === contextId);
    if (context?.status === "ready") break;
    await wait(100);
  }
  assert.equal(context?.status, "ready");
  const stopped = await json("/api/console/stop", { method: "POST", body: JSON.stringify({ contextId }) });
  assert.equal(stopped.context.status, "closed");
  console.log("console smoke: ok");
} finally {
  server.kill("SIGTERM");
}
