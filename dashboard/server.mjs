import http from "node:http";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ConsoleBridge } from "./console-bridge.mjs";

const ROOT = join(homedir(), ".omp/usage-dashboard");
const CA_BUNDLE = join(ROOT, "ca-bundle.pem");
const OMP_ENV = existsSync(CA_BUNDLE) ? { ...process.env, NODE_EXTRA_CA_CERTS: CA_BUNDLE } : process.env;
const STATE_FILE = `${ROOT}/state.json`;
const SELECTED_ACCOUNT_FILE = `${ROOT}/selected-account.json`;
const OMP_BIN = join(homedir(), ".bun/bin/omp");
const OMP_SESSION_ROOT = join(homedir(), ".omp/agent/sessions");
const PORT = Number(process.env.OMP_DASHBOARD_PORT || 4177);
const THRESHOLD = 0.9;
let latest = { ok: false, error: "Đang tải dữ liệu…", updatedAt: null, accounts: [], accountsWithoutUsage: [], disabledCredentials: [], capacity: {}, preferredAccountEmail: null };
let refreshing = null;
let loginProcess = null;
let login = { state: "idle", url: null, message: null };
let historyCache = { loadedAt: 0, items: [] };

function runUsage() {
  return new Promise((resolve, reject) => {
    const child = spawn(OMP_BIN, ["usage", "--json"], { env: OMP_ENV });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 30000);
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(err.trim() || `omp exited with ${code}`));
      try {
        const start = out.indexOf("{");
        resolve(JSON.parse(out.slice(start)));
      } catch {
        reject(new Error("OMP trả về dữ liệu không hợp lệ"));
      }
    });
  });
}

function normalize(raw) {
  return {
    generatedAt: raw.generatedAt ?? Date.now(),
    accounts: (raw.reports ?? []).map((report) => ({
      provider: report.provider,
      email: report.metadata?.email || "Không xác định",
      endpoint: report.metadata?.endpoint || null,
      projectId: report.metadata?.projectId || null,
      limits: (report.limits ?? []).map((limit) => ({
        id: limit.id,
        label: limit.label,
        window: limit.window?.label || limit.window?.id || "Quota",
        durationMs: limit.window?.durationMs ?? null,
        resetsAt: limit.window?.resetsAt ?? null,
        used: limit.amount?.used ?? 0,
        usedFraction: limit.amount?.usedFraction ?? 0,
        remaining: limit.amount?.remaining ?? 0,
        status: limit.status || "unknown",
        shared: Boolean(limit.scope?.shared),
        sharedGroup: limit.scope?.sharedGroup || null,
      })),
    })),
    accountsWithoutUsage: raw.accountsWithoutUsage ?? [],
    disabledCredentials: raw.disabledCredentials ?? [],
    capacity: raw.capacity ?? {},
  };
}

function credentialPinHash(account) {
  return createHash("sha256")
    .update([account.provider, "", account.email || "", "", account.projectId || ""].join("\0"))
    .digest("hex");
}

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

async function sessionFiles(directory = OMP_SESSION_ROOT) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return []; }
  const files = await Promise.all(entries.map((entry) => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? sessionFiles(file) : entry.name.endsWith(".jsonl") ? [file] : [];
  }));
  return files.flat();
}

async function readTokenHistory() {
  if (Date.now() - historyCache.loadedAt < 30000) return historyCache.items;
  const accountByPin = new Map((latest.accounts || []).map((account) => [credentialPinHash(account), account.email]));
  const items = [];
  for (const file of await sessionFiles()) {
    let lines;
    try { lines = (await readFile(file, "utf8")).split("\n"); } catch { continue; }
    let sessionId = null;
    let lastPinHash = null;
    const sessionItems = [];
    for (const line of lines) {
      if (!line) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      if (record.type === "session") sessionId = record.id || null;
      if (record.type === "credential_pin") {
        lastPinHash = record.hash || lastPinHash;
        continue;
      }
      const message = record.message;
      const usage = message?.role === "assistant" ? message.usage : null;
      if (!usage || !message.provider || !message.model) continue;
      sessionItems.push({
        id: `${file}:${record.id || record.timestamp}`,
        timestamp: record.timestamp || message.completedAt || message.timestamp,
        sessionId,
        email: null,
        provider: message.provider,
        model: message.model,
        input: number(usage.input),
        output: number(usage.output),
        cacheRead: number(usage.cacheRead),
        cacheWrite: number(usage.cacheWrite),
        reasoning: number(usage.reasoningTokens),
        total: number(usage.totalTokens) || number(usage.input) + number(usage.output) + number(usage.cacheRead) + number(usage.cacheWrite),
      });
    }
    for (const item of sessionItems) item.email = accountByPin.get(lastPinHash) || null;
    items.push(...sessionItems);
  }
  historyCache = { loadedAt: Date.now(), items: items.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))) };
  return historyCache.items;
}

function tokenSummary(items) {
  return items.reduce((summary, item) => {
    summary.requests += 1;
    summary.input += item.input;
    summary.output += item.output;
    summary.cacheRead += item.cacheRead;
    summary.cacheWrite += item.cacheWrite;
    summary.reasoning += item.reasoning;
    summary.total += item.total;
    return summary;
  }, { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 });
}

async function selectedAccount() {
  try { return JSON.parse(await readFile(SELECTED_ACCOUNT_FILE, "utf8")); }
  catch { return null; }
}

async function findSessionPath(sessionId) {
  if (typeof sessionId !== "string" || !sessionId) throw new Error("sessionId là bắt buộc");
  for (const file of await sessionFiles()) {
    let content;
    try { content = await readFile(file, "utf8"); } catch { continue; }
    for (const line of content.split("\n").slice(0, 6)) {
      if (!line) continue;
      try {
        const record = JSON.parse(line);
        if (record.type === "session" && record.id === sessionId) return file;
      } catch { break; }
    }
  }
  throw new Error("Không tìm thấy session OMP");
}

async function readState() {
  try { return JSON.parse(await readFile(STATE_FILE, "utf8")); }
  catch { return { alerted: {} }; }
}

async function saveState(state) {
  await writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function notify(title, message) {
  const script = `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`;
  spawn("/usr/bin/osascript", ["-e", script], { stdio: "ignore" });
}

async function checkThresholds(snapshot) {
  const state = await readState();
  for (const account of snapshot.accounts) {
    for (const limit of account.limits) {
      const key = `${account.provider}|${account.email}|${limit.id}`;
      const over = limit.usedFraction >= THRESHOLD;
      if (over && !state.alerted[key]) {
        notify("OMP quota", `${account.email}: ${limit.window} đã dùng ${limit.used.toFixed(1)}%`);
        state.alerted[key] = true;
      } else if (!over) {
        delete state.alerted[key];
      }
    }
  }
  await saveState(state);
}

async function refresh() {
  if (refreshing) return refreshing;
  refreshing = runUsage().then(async (raw) => {
    const snapshot = normalize(raw);
    const selected = await selectedAccount();
    snapshot.preferredAccountEmail = selected?.email || null;
    await checkThresholds(snapshot);
    latest = { ok: true, error: null, updatedAt: Date.now(), ...snapshot };
    return latest;
  }).catch((error) => {
    latest = { ...latest, ok: false, error: error.message, updatedAt: Date.now() };
    return latest;
  }).finally(() => { refreshing = null; });
  return refreshing;
}

async function readJsonBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10000) throw new Error("Request quá lớn");
  }
  return JSON.parse(body || "{}");
}

async function selectAccount(req) {
  const body = await readJsonBody(req);
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const account = latest.accounts.find((item) => item.email.toLowerCase() === email.toLowerCase());
  if (!account) throw new Error("Account không tồn tại trong OMP");
  const wasPreferred = latest.preferredAccountEmail?.toLowerCase() === account.email.toLowerCase();
  await writeFile(SELECTED_ACCOUNT_FILE, `${JSON.stringify({ email: account.email, provider: account.provider, selectedAt: Date.now() }, null, 2)}\n`, { mode: 0o600 });
  latest.preferredAccountEmail = account.email;
  return {
    ok: true,
    email: account.email,
    active: wasPreferred,
    message: wasPreferred
      ? `${account.email} đang là account ưu tiên của OMP.`
      : `Đã đặt ${account.email} làm account ưu tiên cho các session OMP kế tiếp.`
  };
}

async function historyPayload(limit = 50) {
  if (!latest.ok) await refresh();
  const items = await readTokenHistory();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const today = items.filter((item) => new Date(item.timestamp).getTime() >= startOfToday.getTime());
  return {
    ok: true,
    generatedAt: Date.now(),
    totalRecords: items.length,
    summary: tokenSummary(today),
    items: items.slice(0, Math.min(200, Math.max(1, limit))),
  };
}

function startLogin() {
  if (loginProcess) return;
  login = { state: "starting", url: null, message: "Đang tạo phiên đăng nhập Google…" };
  const child = spawn(OMP_BIN, ["auth-broker", "login", "google-antigravity"], { env: OMP_ENV });
  loginProcess = child;
  let output = "";
  let opened = false;
  const read = (chunk) => {
    output += chunk.toString();
    if (!opened) {
      const match = output.match(/https:\/\/[^\s]+/);
      if (match) {
        const url = match[0].replace(/[)>,]+$/, "");
        opened = true;
        login = { state: "waiting", url, message: "Đã mở Google; hoàn tất đăng nhập trong trình duyệt." };
        spawn("/usr/bin/open", [url], { stdio: "ignore" });
      }
    }
  };
  child.stdout.on("data", read);
  child.stderr.on("data", read);
  child.on("error", (error) => {
    login = { state: "error", url: null, message: error.message };
    loginProcess = null;
  });
  child.on("close", (code) => {
    login = code === 0
      ? { state: "complete", url: null, message: "Đăng nhập xong; quota đã được cập nhật." }
      : { state: "error", url: null, message: output.trim().split("\n").at(-1) || `OMP login exited with ${code}` };
    loginProcess = null;
    refresh();
  });
}

const consoleBridge = new ConsoleBridge();
const SOURCE_ROOT = fileURLToPath(new URL("./", import.meta.url));

async function readDashboardAsset(name) {
  try { return await readFile(join(SOURCE_ROOT, name), "utf8"); }
  catch (error) {
    if (ROOT === SOURCE_ROOT) throw error;
    return readFile(join(ROOT, name), "utf8");
  }
}

async function jsonBody(req) {
  try { return await readJsonBody(req); }
  catch (error) { throw new Error(`JSON không hợp lệ: ${error.message}`); }
}

function json(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(payload));
}

async function designHtml() {
  const template = await readDashboardAsset("quota-dashboard.html");
  return template.replace("</body>", '<script src="/dashboard-live.js"></script></body>');
}

const server = http.createServer(async (req, res) => {
  try {
  if (req.url === "/console" && req.method === "GET") {
    const page = await readDashboardAsset("console.html");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return res.end(page);
  }
  if (req.url === "/console-live.js" && req.method === "GET") {
    const script = await readDashboardAsset("console-live.js");
    res.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" });
    return res.end(script);
  }
  if (req.url === "/api/console/connect" && req.method === "POST") {
    return json(res, 200, { ok: true, clientId: consoleBridge.createClient() });
  }
  if (req.url === "/api/console/state" && req.method === "GET") {
    return json(res, 200, consoleBridge.state());
  }
  if ((req.url === "/api/console/sessions" || req.url?.startsWith("/api/console/sessions?")) && req.method === "GET") {
    try {
      const query = new URL(req.url, "http://127.0.0.1").searchParams;
      return json(res, 200, { ok: true, ...(await consoleBridge.listSessions(query.get("cwd") || undefined)) });
    } catch (error) { return json(res, 400, { ok: false, message: error.message }); }
  }
  if (req.url === "/api/console/start" && req.method === "POST") {
    try { return json(res, 200, { ok: true, context: await consoleBridge.start(await jsonBody(req)) }); }
    catch (error) { return json(res, 400, { ok: false, message: error.message }); }
  }
  if ((req.url === "/api/console/events" || req.url?.startsWith("/api/console/events?")) && req.method === "GET") {
    const query = new URL(req.url, "http://127.0.0.1").searchParams;
    const clientId = query.get("clientId");
    const contextId = query.get("contextId");
    try {
      if (!clientId || !contextId) throw new Error("clientId và contextId là bắt buộc");
      consoleBridge.get(contextId);
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
      res.write(": connected\n\n");
      consoleBridge.subscribe(contextId, clientId, res);
      req.on("close", () => consoleBridge.removeClient(clientId));
      return;
    } catch (error) { return json(res, 400, { ok: false, message: error.message }); }
  }
  if (req.url === "/api/console/command" && req.method === "POST") {
    try {
      const body = await jsonBody(req);
      consoleBridge.send(body.contextId, body.command);
      return json(res, 200, { ok: true });
    } catch (error) { return json(res, 400, { ok: false, message: error.message }); }
  }
  if (req.url === "/api/console/session" && req.method === "POST") {
    try {
      const body = await jsonBody(req);
      const action = typeof body.action === "string" ? body.action : "";
      const command = { id: `session-${Date.now()}` };
      if (action === "new") Object.assign(command, { type: "new_session" });
      else if (action === "switch") Object.assign(command, { type: "switch_session", sessionPath: await findSessionPath(body.sessionId) });
      else if (action === "fork") Object.assign(command, { type: "new_session", parentSession: await findSessionPath(body.sessionId) });
      else if (action === "branch") Object.assign(command, { type: "branch", entryId: String(body.entryId || "") });
      else if (action === "rename") Object.assign(command, { type: "set_session_name", name: String(body.name || "").trim().slice(0, 200) });
      else if (action === "compact") Object.assign(command, { type: "compact", customInstructions: String(body.instructions || "").slice(0, 4000) || undefined });
      else if (action === "export") Object.assign(command, { type: "export_html" });
      else if (action === "handoff") Object.assign(command, { type: "handoff", customInstructions: String(body.instructions || "").slice(0, 4000) || undefined });
      else if (action === "abort") Object.assign(command, { type: "abort" });
      else if (action === "retry") Object.assign(command, { type: "abort_retry" });
      else throw new Error("Session action không được hỗ trợ");
      if (command.type === "branch" && !command.entryId) throw new Error("entryId là bắt buộc");
      if (command.type === "set_session_name" && !command.name) throw new Error("name là bắt buộc");
      consoleBridge.send(body.contextId, command);
      return json(res, 200, { ok: true, command: command.type });
    } catch (error) { return json(res, 400, { ok: false, message: error.message }); }
  }
  if (req.url === "/api/console/stop" && req.method === "POST") {
    try {
      const body = await jsonBody(req);
      return json(res, 200, { ok: true, context: await consoleBridge.stop(body.contextId) });
    } catch (error) { return json(res, 400, { ok: false, message: error.message }); }
  }
  if (req.url === "/dashboard-live.js" && req.method === "GET") {
    const script = await readDashboardAsset("dashboard-live.js");
    res.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" });
    return res.end(script);
  }
  if (req.url === "/" && req.method === "GET") {
    const page = await designHtml();
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(page);
  }
  if (req.url === "/healthz" && req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }
  if (req.url === "/api/status" && req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(latest));
  }
  if (req.url?.startsWith("/api/history") && req.method === "GET") {
    const query = new URL(req.url, "http://127.0.0.1").searchParams;
    const result = await historyPayload(Number(query.get("limit")) || 50);
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(JSON.stringify(result));
  }
  if (req.url === "/api/refresh" && req.method === "POST") {
    await refresh();
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(latest));
  }
  if (req.url === "/api/login" && req.method === "POST") {
    startLogin();
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(login));
  }
  if (req.url === "/api/login-status" && req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(login));
  }
  if (req.url === "/api/select-account" && req.method === "POST") {
    try {
      const result = await selectAccount(req);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: false, message: error.message }));
    }
  }
  res.writeHead(404); res.end("Not found");
  } catch (error) {
    if (!res.headersSent) json(res, 500, { ok: false, message: error.message });
    else res.end();
  }
});

server.listen(PORT, "127.0.0.1", () => { refresh(); setInterval(refresh, 60000); });
process.on("SIGINT", async () => { await consoleBridge.close(); server.close(); process.exit(0); });
process.on("SIGTERM", async () => { await consoleBridge.close(); server.close(); process.exit(0); });
