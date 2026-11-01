import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.env.OMP_OPENAI_BASE_URL || "http://127.0.0.1:4177/api/omp/v1/openai";
const workspace = process.env.OPENWORK_WORKSPACE || "/Users/trannhattuan/OpenWork Chat";
const modelsResponse = await fetch(`${base}/models`);
assert.equal(modelsResponse.status, 200);
assert.deepEqual((await modelsResponse.json()).data.map(({ id }) => id), ["omp-default"]);

const sessionId = `openwork-smoke-${randomUUID()}`;
const createdSession = await fetch("http://127.0.0.1:4177/api/omp/v1/sessions", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ sessionId, cwd: workspace, approvalMode: "write" }),
});
assert.equal(createdSession.status, 201);
assert.equal((await createdSession.json()).sessionId, sessionId);
const closedSession = await fetch(`http://127.0.0.1:4177/api/omp/v1/sessions/${sessionId}`, { method: "DELETE" });
assert.equal(closedSession.status, 200);

const completionUrl = `${base}/chat/completions`;
const rejectedImage = await fetch(completionUrl, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: "omp-default", messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://example.com/image.png" } }] }] }),
});
assert.equal(rejectedImage.status, 400);
assert.equal((await rejectedImage.json()).error.code, "BAD_REQUEST");

const allowedWorkspace = await fetch(completionUrl, {
  method: "POST",
  headers: { "content-type": "application/json", "X-OMP-CWD": workspace, "X-OMP-APPROVAL-MODE": "invalid" },
  body: JSON.stringify({ model: "omp-default", messages: [{ role: "user", content: "smoke check" }] }),
});
assert.equal(allowedWorkspace.status, 400);
assert.match((await allowedWorkspace.json()).error.message, /approvalMode/);

const deniedWorkspace = await fetch(completionUrl, {
  method: "POST",
  headers: { "content-type": "application/json", "X-OMP-CWD": "/", "X-OMP-APPROVAL-MODE": "always-ask" },
  body: JSON.stringify({ model: "omp-default", messages: [{ role: "user", content: "smoke check" }] }),
});
assert.equal(deniedWorkspace.status, 403);
assert.equal((await deniedWorkspace.json()).error.code, "FORBIDDEN");

const deniedOrigin = await fetch(`${base}/models`, { headers: { Origin: "app://open-work" } });
assert.equal(deniedOrigin.status, 403);
console.log("OpenWork ↔ OMP compatibility smoke passed; no model prompt was sent.");
