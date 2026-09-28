import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { OmpGatewayClient, normalizeOmpEvent } from "../integrations/deepseek-harness-omp/client.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = 4189;
const server = spawn(process.execPath, ["dashboard/server.mjs"], {
  cwd: root,
  env: { ...process.env, OMP_DASHBOARD_PORT: String(port) },
  stdio: ["ignore", "ignore", "pipe"],
});

try {
  const client = new OmpGatewayClient({ baseUrl: `http://127.0.0.1:${port}` });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { await client.capabilities(); break; }
    catch (error) { if (attempt === 29) throw error; await wait(100); }
  }
  const capabilities = await client.capabilities();
  assert.equal(capabilities.contractVersion, "1");
  const session = await client.createSession({ sessionId: "client-smoke", cwd: root });
  assert.equal(session.sessionId, "client-smoke");

  const events = client.events(session.sessionId);
  const first = await events.next();
  assert.equal(first.done, false);
  assert.equal(["bridge_status", "omp"].includes(first.value.event), true);
  await client.command(session.sessionId, { type: "get_state" });

  const normalized = normalizeOmpEvent({ event: "omp", data: {
    type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "hello" },
  } });
  assert.deepEqual(normalized, { type: "text-delta", index: 0, text: "hello" });
  assert.equal((await client.close(session.sessionId)).closed, true);
  await events.return();
  console.log("omp client smoke: ok");
} finally {
  server.kill("SIGTERM");
}
