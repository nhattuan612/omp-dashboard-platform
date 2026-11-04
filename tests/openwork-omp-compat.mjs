import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const base = process.env.OMP_OPENAI_BASE_URL || "http://127.0.0.1:4177/api/omp/v1/openai";
const workspace = process.env.OPENWORK_WORKSPACE || "/Users/trannhattuan/OpenWork Chat";
const apiKey = process.env.OMP_GATEWAY_API_KEY || (await readFile(join(homedir(), ".omp/usage-dashboard/omp-gateway-api-key"), "utf8")).trim();
const authorization = { Authorization: `Bearer ${apiKey}` };
const modelsResponse = await fetch(`${base}/models`, { headers: authorization });
assert.equal(modelsResponse.status, 200);
const listedModels = (await modelsResponse.json()).data;
assert.ok(listedModels.some(({ id }) => id === "omp-default"));
assert.ok(listedModels.filter(({ id }) => id !== "omp-default").every(({ owned_by }) => owned_by === "google-antigravity"), "OpenWork model catalog must be limited to Quota providers");

const sessionId = `openwork-smoke-${randomUUID()}`;
const createdSession = await fetch("http://127.0.0.1:4177/api/omp/v1/sessions", {
  method: "POST",
  headers: { ...authorization, "content-type": "application/json" },
  body: JSON.stringify({ sessionId, cwd: workspace, approvalMode: "write" }),
});
assert.equal(createdSession.status, 201);
assert.equal((await createdSession.json()).sessionId, sessionId);
const closedSession = await fetch(`http://127.0.0.1:4177/api/omp/v1/sessions/${sessionId}`, { method: "DELETE", headers: authorization });
assert.equal(closedSession.status, 200);

const completionUrl = `${base}/chat/completions`;
const rejectedImage = await fetch(completionUrl, {
  method: "POST",
  headers: { ...authorization, "content-type": "application/json" },
  body: JSON.stringify({ model: "omp-default", messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://example.com/image.png" } }] }] }),
});
assert.equal(rejectedImage.status, 400);
assert.equal((await rejectedImage.json()).error.code, "BAD_REQUEST");

const allowedWorkspace = await fetch(completionUrl, {
  method: "POST",
  headers: { ...authorization, "content-type": "application/json", "X-OMP-CWD": workspace, "X-OMP-APPROVAL-MODE": "invalid" },
  body: JSON.stringify({ model: "omp-default", messages: [{ role: "user", content: "smoke check" }] }),
});
assert.equal(allowedWorkspace.status, 400);
assert.match((await allowedWorkspace.json()).error.message, /approvalMode/);

const deniedWorkspace = await fetch(completionUrl, {
  method: "POST",
  headers: { ...authorization, "content-type": "application/json", "X-OMP-CWD": "/", "X-OMP-APPROVAL-MODE": "always-ask" },
  body: JSON.stringify({ model: "omp-default", messages: [{ role: "user", content: "smoke check" }] }),
});
assert.equal(deniedWorkspace.status, 403);
assert.equal((await deniedWorkspace.json()).error.code, "FORBIDDEN");

const deniedOrigin = await fetch(`${base}/models`, { headers: { ...authorization, Origin: "app://open-work" } });
assert.equal(deniedOrigin.status, 403);
console.log("OpenWork ↔ OMP compatibility smoke passed; no model prompt was sent.");
