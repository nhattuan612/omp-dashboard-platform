import http from "node:http";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConsoleBridge } from "./console-bridge.mjs";
import { createOmpToolCatalog } from "./omp-tool-catalog.mjs";

const ROOT = join(homedir(), ".omp/usage-dashboard");
const CA_BUNDLE = join(ROOT, "ca-bundle.pem");
const OMP_ENV = {
  ...process.env,
  ...(existsSync(CA_BUNDLE) ? { NODE_EXTRA_CA_CERTS: CA_BUNDLE } : {}),
  // LaunchAgent starts with a system-only PATH; OMP tools also need Homebrew binaries such as rtk.
  PATH: [
    join(homedir(), ".local/bin"),
    join(homedir(), ".bun/bin"),
    ...(process.platform === "darwin" ? ["/opt/homebrew/bin", "/usr/local/bin"] : []),
    process.env.PATH || "",
  ].filter(Boolean).join(delimiter),
};
const STATE_FILE = `${ROOT}/state.json`;
const SELECTED_ACCOUNT_FILE = `${ROOT}/selected-account.json`;
const PROTECT_CONFIG_FILE = `${ROOT}/protect-config.json`;
const OMP_ACCOUNT_CONTROL_FILE = `${ROOT}/omp-account-control.json`;
const ACCOUNT_COLORS_FILE = `${ROOT}/account-colors.json`;
const CHAT_METADATA_FILE = `${ROOT}/chat-metadata.json`;
const CHAT_MEDIA_ROOT = join(ROOT, "chat-media");
const OMP_BIN = join(homedir(), ".bun/bin/omp");
const AGENT_DB_FILE = join(homedir(), ".omp/agent/agent.db");
const OMP_SESSION_ROOT = join(homedir(), ".omp/agent/sessions");
const OMP_LOG_ROOT = join(homedir(), ".omp/logs");
const OMP_ARCHIVE_ROOT = join(homedir(), ".omp/agent/archive/console-sessions");
const OMP_TRASH_ROOT = join(homedir(), ".omp/agent/trash/console-sessions");
const OMP_AGENT_BLOB_ROOT = join(homedir(), ".omp/agent/blobs");
const GENERAL_CHAT_CWD = process.env.OMP_DASHBOARD_GENERAL_WORKSPACE || join(homedir(), "Documents", "OMP General Chat");
const DEFAULT_CHAT_CWD = process.env.OMP_DASHBOARD_WORKSPACE || process.cwd();
const PORT = Number(process.env.OMP_DASHBOARD_PORT || 4177);
const MAX_JSON_BODY_BYTES = 1_048_576;
const MAX_CHAT_PROMPT_CHARS = 900_000;
const MAX_CHAT_ATTACHMENTS = 4;
const MAX_CHAT_ATTACHMENT_TEXT_CHARS = 200_000;
const MAX_CHAT_ATTACHMENT_DATA_CHARS = 800_000;
const MAX_CHAT_MEDIA_MESSAGES = 200;
const MAX_CHAT_BODY_BLOCKS = 256;
const MAX_CHAT_BODY_TEXT_CHARS = 80_000;
const MAX_CHAT_BODY_VALUE_DEPTH = 4;
const testChatTurnTimeout = process.env.NODE_ENV === "test" ? Number(process.env.OMP_DASHBOARD_TEST_CHAT_TURN_TIMEOUT_MS) : NaN;
const CHAT_TURN_TIMEOUT_MS = Number.isSafeInteger(testChatTurnTimeout) && testChatTurnTimeout > 0 ? testChatTurnTimeout : 120_000;
const testLongChatTurnTimeout = process.env.NODE_ENV === "test" ? Number(process.env.OMP_DASHBOARD_TEST_LONG_CHAT_TURN_TIMEOUT_MS) : NaN;
const LONG_CHAT_TURN_TIMEOUT_MS = Number.isSafeInteger(testLongChatTurnTimeout) && testLongChatTurnTimeout > 0 ? testLongChatTurnTimeout : 300_000;
const LOCAL_PROMPT_RESULT_GRACE_MS = 1_000;
const chatTurnTimeoutMs = (prompt, browserMode) => longRunningChatTurn(prompt, browserMode) ? LONG_CHAT_TURN_TIMEOUT_MS : CHAT_TURN_TIMEOUT_MS;
const DASHBOARD_SESSION_COOKIE = "omp_dashboard_session";
const DASHBOARD_SESSION_TOKEN = randomBytes(32).toString("base64url");
const DASHBOARD_ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);
const DASHBOARD_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);
const rawChatRateLimit = process.env.OMP_CHAT_RATE_LIMIT;
const configuredChatRateLimit = rawChatRateLimit == null || rawChatRateLimit.trim() === "" ? 30 : Number(rawChatRateLimit);
const CHAT_RATE_LIMIT = Number.isSafeInteger(configuredChatRateLimit) && configuredChatRateLimit >= 0 ? configuredChatRateLimit : 30;
const DASHBOARD_MARK_ASSET = "honpi-dashboard-mark-8138753b.png";
const CSP_HEADER = "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self' __NONCE__; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; font-src 'self' data:; form-action 'self'";
const PUBLIC_ERROR_CODES = new Set([
  "BAD_REQUEST", "MODEL_NOT_FOUND", "MODEL_NOT_ALLOWED_BY_QUOTA", "IMAGE_GENERATION_MODEL_REQUIRED", "NOT_FOUND", "CONFLICT", "ACCOUNT_NOT_FOUND", "ACCOUNT_UNAVAILABLE", "ACCOUNT_SELECTION_REQUIRED",
  "RATE_LIMITED", "METHOD_NOT_ALLOWED", "UNAUTHORIZED", "FORBIDDEN", "FORBIDDEN_HOST", "FORBIDDEN_ORIGIN", "UPSTREAM_UNAVAILABLE",
]);
const pendingApprovalRequests = new Map();
const DEFAULT_APPROVAL_TIMEOUT_MS = 600_000;
const testApprovalTimeout = process.env.NODE_ENV === "test" && process.env.OMP_DASHBOARD_TEST_APPROVAL_TIMEOUT_MS
  ? Number(process.env.OMP_DASHBOARD_TEST_APPROVAL_TIMEOUT_MS)
  : NaN;
const APPROVAL_TIMEOUT_MS = Number.isSafeInteger(testApprovalTimeout) && testApprovalTimeout > 0
  ? testApprovalTimeout
  : DEFAULT_APPROVAL_TIMEOUT_MS;
const QUOTA_WARNING_THRESHOLD = 0.8;
const QUOTA_SUSPEND_THRESHOLD = 0.9;
const GENERATION_HEALTH_WINDOW_MS = 24 * 60 * 60 * 1000;
const BROKER_USAGE_CACHE_MS = 60_000;
const ACCOUNT_COLOR_PALETTE = ["#1a73e8", "#188038", "#b06000", "#d93025", "#7b1fa2", "#00838f", "#c2185b", "#5f6368"];
const LOGIN_PROVIDER = "google-antigravity";
const GEMINI_PROVIDER_KEYS = new Set(["google-gemini-cli", "google-antigravity"]);
const LOGIN_PROVIDER_LABEL = "Google Cloud OAuth · OMP";
let latest = { ok: false, error: "Đang tải dữ liệu…", updatedAt: null, accounts: [], authAccounts: [], accountsWithoutUsage: [], disabledCredentials: [], capacity: {}, preferredAccountEmail: null };
let refreshing = null;
let brokerUsageCache = null;
let loginProcess = null;
let login = { state: "idle", provider: null, url: null, message: null };
let historyCache = { loadedAt: 0, items: [] };
const statusClients = new Map();
let refreshTimer = null;
const requestRateBuckets = new Map();

function applySecurityHeaders(res) {
  const nonce = randomBytes(18).toString("base64");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  res.setHeader("content-security-policy", CSP_HEADER.replace("__NONCE__", `'nonce-${nonce}'`));
  res.setHeader("cache-control", "no-store");
  return nonce;
}

function readCookie(req, name) {
  const header = typeof req.headers.cookie === "string" ? req.headers.cookie : "";
  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) return item.slice(separator + 1).trim();
  }
  return "";
}

function tokenMatches(value) {
  const received = Buffer.from(String(value || ""));
  const expected = Buffer.from(DASHBOARD_SESSION_TOKEN);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function isAllowedHost(req) {
  const rawHost = typeof req.headers.host === "string" ? req.headers.host : "";
  try {
    const parsed = new URL(`http://${rawHost}`);
    return DASHBOARD_HOSTNAMES.has(parsed.hostname) && parsed.port === String(PORT);
  } catch {
    return false;
  }
}

function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  return origin == null || DASHBOARD_ORIGINS.has(String(origin));
}

function requiresApiAuth(pathname) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function requiresDashboardSession(pathname) {
  return requiresApiAuth(pathname) && !pathname.startsWith("/api/omp/v1/");
}

function authorizeApiRequest(req, pathname) {
  if (!requiresApiAuth(pathname)) return null;
  if (!isAllowedOrigin(req)) return { status: 403, code: "FORBIDDEN_ORIGIN", message: "Origin không được phép." };
  if (requiresDashboardSession(pathname) && !tokenMatches(readCookie(req, DASHBOARD_SESSION_COOKIE))) {
    return { status: 401, code: "UNAUTHORIZED", message: "Phiên dashboard không hợp lệ hoặc đã hết hạn." };
  }
  return null;
}

function enforceRateLimit(req, pathname) {
  if (!requiresApiAuth(pathname) || !["POST", "DELETE"].includes(req.method)) return null;
  const isLogin = pathname === "/api/login";
  const isChat = pathname === "/api/v1/chat/send" || pathname === "/api/v1/chat/stream";
  const limit = isLogin ? 5 : isChat ? CHAT_RATE_LIMIT : 120;
  if (limit <= 0) return null;
  const windowMs = 60_000;
  const key = `${req.socket.remoteAddress || "loopback"}:${pathname}`;
  const now = Date.now();
  const bucket = requestRateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= windowMs) {
    requestRateBuckets.set(key, { startedAt: now, count: 1 });
    return null;
  }
  bucket.count += 1;
  if (bucket.count > limit) return { status: 429, code: "RATE_LIMITED", message: "Quá nhiều thao tác trong thời gian ngắn." };
  return null;
}

function issueDashboardCookie(res) {
  res.setHeader("set-cookie", `${DASHBOARD_SESSION_COOKIE}=${DASHBOARD_SESSION_TOKEN}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`);
}

function publicErrorMessage(code, message, fallback = "Yêu cầu không thành công.") {
  const upstream = String(code).startsWith("UPSTREAM") || ["BRIDGE_ERROR", "CLIENT_CLOSED"].includes(code);
  if (upstream || code === "INTERNAL_SERVER_ERROR") {
    return code === "UPSTREAM_TIMEOUT" ? "OMP không phản hồi trong thời gian cho phép." : "Yêu cầu không thành công.";
  }
  return String(message || fallback).slice(0, 300);
}

function publicStreamErrorPayload(payload) {
  const code = String(payload?.code || "UPSTREAM_ERROR");
  return { code, message: publicErrorMessage(code, payload?.message) };
}

function safeErrorPayload(res, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.ok !== false) return payload;
  const existing = payload.error && typeof payload.error === "object" && !Array.isArray(payload.error) ? payload.error : {};
  const code = String(existing.code || payload.code || "REQUEST_FAILED");
  const message = PUBLIC_ERROR_CODES.has(code) ? publicErrorMessage(code, existing.message || payload.message) : "Yêu cầu không thành công.";
  return {
    ...payload,
    error: { ...existing, code, message, requestId: existing.requestId || res.requestId },
    message,
  };
}

function errorStatus(code) {
  if (["BAD_REQUEST", "UNSUPPORTED_ACTION", "MODEL_NOT_FOUND", "IMAGE_GENERATION_MODEL_REQUIRED"].includes(code)) return 400;
  if (["NOT_FOUND", "ACCOUNT_NOT_FOUND"].includes(code)) return 404;
  if (["CONFLICT", "ACCOUNT_UNAVAILABLE", "ACCOUNT_SELECTION_REQUIRED", "MODEL_NOT_ALLOWED_BY_QUOTA"].includes(code)) return 409;
  if (code === "RATE_LIMITED") return 429;
  if (code === "UPSTREAM_TIMEOUT") return 504;
  if (["UNAUTHORIZED"].includes(code)) return 401;
  if (["FORBIDDEN", "FORBIDDEN_HOST", "FORBIDDEN_ORIGIN"].includes(code)) return 403;
  if (String(code).startsWith("UPSTREAM")) return 502;
  return 500;
}

function errorResponse(res, error, fallback = "Yêu cầu không thành công.") {
  const code = error?.code || "INTERNAL_SERVER_ERROR";
  const message = publicErrorMessage(code, error?.message, fallback);
  return json(res, errorStatus(code), {
    ok: false,
    code,
    message,
    error: { code, message, ...(error?.field ? { field: error.field } : {}) },
    ...(error?.field ? { field: error.field } : {}),
  });
}

function runOmpUsage() {
  return new Promise((resolve, reject) => {
    const child = spawn(OMP_BIN, ["usage", "--json"], { env: OMP_ENV });
    const pid = child.pid;
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
        resolve({ raw: JSON.parse(out.slice(start)), pid });
      } catch {
        reject(new Error("OMP trả về dữ liệu không hợp lệ"));
      }
    });
  });
}

function brokerUsageRaw(value) {
  const credentials = Array.isArray(value?.credentials) ? value.credentials : [];
  return {
    generatedAt: Date.now(),
    reports: credentials.flatMap((item) => item?.ok === true && item.report ? [item.report] : []),
    accountsWithoutUsage: credentials.flatMap((item) => item?.report ? [] : [{
      provider: item?.provider,
      email: item?.email || item?.credential?.email,
      reason: item?.reason || item?.error || "OMP usage probe returned no data for this credential",
    }]),
    disabledCredentials: Array.isArray(value?.disabledCredentials) ? value.disabledCredentials : [],
    capacity: {},
  };
}

function runBrokerUsage() {
  const now = Date.now();
  if (brokerUsageCache && now - brokerUsageCache.loadedAt < BROKER_USAGE_CACHE_MS) return Promise.resolve(brokerUsageCache.result);
  return new Promise((resolve, reject) => {
    const child = spawn(OMP_BIN, ["auth-gateway", "check", "--json"], { env: OMP_ENV });
    const pid = child.pid;
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 30000);
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(err.trim() || `OMP auth-gateway exited with ${code}`));
      try {
        const start = out.indexOf("{");
        const result = { raw: brokerUsageRaw(JSON.parse(out.slice(start))), pid };
        brokerUsageCache = result.raw.reports.length ? { loadedAt: Date.now(), result } : null;
        resolve(result);
      } catch {
        reject(new Error("OMP auth-gateway trả về dữ liệu không hợp lệ"));
      }
    });
  });
}

async function runUsage() {
  try {
    const primary = await runOmpUsage();
    return Array.isArray(primary.raw?.reports) && primary.raw.reports.length ? primary : await runBrokerUsage().catch(() => primary);
  } catch (error) {
    return runBrokerUsage().catch(() => { throw error; });
  }
}

function runOmpShare(sessionPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(OMP_BIN, ["share", sessionPath], { env: OMP_ENV, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(Object.assign(new Error("OMP tạo share quá thời gian cho phép"), { code: "UPSTREAM_UNAVAILABLE" })); }, 30000);
    const append = (chunk) => { if (output.length < 20000) output += chunk.toString(); };
    child.stdout.on("data", append); child.stderr.on("data", append);
    child.on("error", () => { clearTimeout(timer); reject(Object.assign(new Error("Không thể chạy OMP share"), { code: "UPSTREAM_UNAVAILABLE" })); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const url = output.match(/https:\/\/[^\s"'<>]+/i)?.[0];
      const validUrl = url && /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s"'<>]*)?$/i.test(url);
      if (code !== 0 || !validUrl) return reject(Object.assign(new Error("OMP không tạo được URL share thực"), { code: "UPSTREAM_UNAVAILABLE" }));
      resolve(url);
    });
  });
}

function readOmpAuthorizedAt() {
  return new Promise((resolve) => {
    const child = spawn("/usr/bin/sqlite3", [AGENT_DB_FILE, "SELECT lower(substr(identity_key, 7)) || char(9) || coalesce(json_extract(data, '$.authorizedAt'), '') FROM auth_credentials WHERE credential_type = 'oauth' AND identity_key LIKE 'email:%' AND provider IN ('google-antigravity', 'google-gemini-cli');"], { stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); resolve(new Map()); }, 5000);
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.on("error", () => { clearTimeout(timer); resolve(new Map()); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return resolve(new Map());
      const updates = new Map();
      for (const line of output.trim().split("\n")) {
        const [email, authorizedAt] = line.split("\t");
        const timestamp = Number(authorizedAt);
        if (email && Number.isFinite(timestamp) && timestamp > 0) updates.set(email, timestamp);
      }
      resolve(updates);
    });
  });
}

function sqliteQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function deleteOAuthCredential(account) {
  const provider = String(account?.provider || "").trim();
  const email = String(account?.email || "").trim().toLowerCase();
  if (!provider || !email) throw Object.assign(new Error("Thiếu provider hoặc email tài khoản."), { code: "BAD_REQUEST" });
  const sql = `DELETE FROM auth_credentials WHERE provider = ${sqliteQuote(provider)} AND credential_type = 'oauth' AND lower(identity_key) = lower(${sqliteQuote(`email:${email}`)}); SELECT changes();`;
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/sqlite3", [AGENT_DB_FILE, sql], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let errorOutput = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { errorOutput += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(errorOutput.trim() || `Không thể xoá credential (${code})`));
      resolve(Number(output.trim().split(/\s+/).at(-1)) || 0);
    });
  });
}

function accountIdentity(value, fallbackProvider = "google-antigravity") {
  if (typeof value === "string") return { email: value, provider: fallbackProvider, reason: null };
  const item = value && typeof value === "object" ? value : {};
  return {
    email: item.email || item.account || item.metadata?.email || item.credential?.email || null,
    provider: item.provider || item.metadata?.provider || fallbackProvider,
    reason: item.reason || item.error || item.message || null,
  };
}

function authAccountKey(provider, email) {
  return `${String(provider || "google-antigravity").trim().toLowerCase()}\0${String(email || "").trim().toLowerCase()}`;
}

function classifyAuthIssue(reason, definitive = false) {
  const value = String(reason || "").toLowerCase();
  if (definitive || /invalid[_ -]?grant|invalid[_ -]?credential|unauthori[sz]ed|401\b|token[^\n]*(expired|revoked)|refresh[^\n]*(expired|revoked)|no api key|login required/.test(value)) {
    return { status: "reauth_required", reason: "OAuth token không hợp lệ hoặc đã hết hạn" };
  }
  if (/admin[_ -]?policy[_ -]?enforced|access[_ -]?denied|org[_ -]?internal|deleted[_ -]?client|permission[_ -]?denied|permission denied|cloudaicompanion|license|403\b/.test(value)) {
    return { status: "access_denied", reason: "Google từ chối quyền, policy, API hoặc license của tài khoản" };
  }
  if (/certificate|tls|unable to verify|econn|timeout|network|abort/.test(value)) {
    return { status: "ca_or_network_error", reason: "Không xác minh được CA hoặc kết nối mạng" };
  }
  return { status: "auth_unknown", reason: "OMP chưa xác định được trạng thái đăng nhập" };
}

async function readUsageAuthIssues(pid) {
  if (!pid) return new Map();
  let file;
  try {
    const names = await readdir(OMP_LOG_ROOT);
    file = names.find((name) => name.endsWith(`.${pid}.log`));
  } catch { return new Map(); }
  if (!file) return new Map();
  let lines;
  try { lines = (await readFile(join(OMP_LOG_ROOT, file), "utf8")).split("\n"); }
  catch { return new Map(); }
  const queued = new Map();
  const issues = new Map();
  const rank = { auth_unknown: 1, ca_or_network_error: 2, access_denied: 3, reauth_required: 4 };
  for (const line of lines) {
    if (!line) continue;
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    const provider = record.provider || "google-antigravity";
    if (record.message === "Usage fetch queued" && record.email) {
      const list = queued.get(provider) || [];
      list.push(record.email);
      queued.set(provider, list);
      continue;
    }
    if (!/OAuth preflight refresh failed|Usage fetch failed|credential refresh failed/.test(record.message || "")) continue;
    const indexedEmail = Number.isInteger(record.index) ? queued.get(provider)?.[record.index] : null;
    const email = record.email || record.account || indexedEmail;
    if (!email) continue;
    const issue = classifyAuthIssue(record.error || record.message, record.isDefinitiveFailure === true);
    const key = authAccountKey(provider, email);
    if (!issues.has(key) || (rank[issue.status] || 1) > (rank[issues.get(key).status] || 1)) issues.set(key, issue);
  }
  return issues;
}

function buildAuthAccounts(raw, accounts, issues) {
  const byIdentity = new Map();
  const put = (identity, fallbackStatus = null) => {
    if (!identity.email) return;
    const key = authAccountKey(identity.provider, identity.email);
    const issue = issues.get(key) || (identity.reason ? classifyAuthIssue(identity.reason) : null);
    const status = fallbackStatus || issue?.status || "authenticated";
    byIdentity.set(key, {
      email: identity.email,
      provider: identity.provider,
      authStatus: status,
      authReason: issue?.reason || null,
    });
  };
  for (const account of accounts) put(accountIdentity(account));
  for (const account of raw.accountsWithoutUsage || []) {
    const identity = accountIdentity(account);
    const issue = identity.email ? issues.get(authAccountKey(identity.provider, identity.email)) : null;
    put(identity, issue?.status || (identity.reason ? null : "auth_unknown"));
  }
  for (const account of raw.disabledCredentials || []) put(accountIdentity(account), "disabled");
  return [...byIdentity.values()];
}

function normalize(raw, authIssues = new Map()) {
  const accounts = (raw.reports ?? []).map((report) => ({
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
      remaining: limit.amount?.remaining ?? (limit.amount?.remainingFraction == null ? null : limit.amount.remainingFraction * 100),
      capacity: limit.amount?.limit ?? 100,
      status: limit.status || "unknown",
      shared: Boolean(limit.scope?.shared),
      sharedGroup: limit.scope?.sharedGroup || null,
    })),
  }));
  const authAccounts = buildAuthAccounts(raw, accounts, authIssues);
  const authByIdentity = new Map(authAccounts.map((account) => [
    authAccountKey(account.provider, account.email),
    { authStatus: account.authStatus, authReason: account.authReason },
  ]));
  return {
    generatedAt: raw.generatedAt ?? Date.now(),
    accounts: accounts.map((account) => ({ ...account, ...(authByIdentity.get(authAccountKey(account.provider, account.email)) || {}) })),
    authAccounts,
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

function normalizeAccountColor(value) {
  const color = String(value || "").trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(color) ? color : null;
}

async function readAccountColors() {
  try {
    const raw = JSON.parse(await readFile(ACCOUNT_COLORS_FILE, "utf8"));
    return Object.fromEntries(Object.entries(raw || {}).flatMap(([email, color]) => {
      const normalized = normalizeAccountColor(color);
      return normalized ? [[email.toLowerCase(), normalized]] : [];
    }));
  } catch { return {}; }
}

async function accountColorMap(extraEmails = []) {
  const stored = await readAccountColors();
  const baseEmails = [...new Set([
    ...(latest.accounts || []).map((account) => account.email),
    ...(latest.authAccounts || []).map((account) => account.email),
  ].filter(Boolean).map((email) => String(email).toLowerCase()))].sort();
  const extra = [...new Set(extraEmails.filter(Boolean).map((email) => String(email).toLowerCase()))].filter((email) => !baseEmails.includes(email)).sort();
  const emails = [...baseEmails, ...extra];
  return Object.fromEntries(emails.map((email, index) => [email, stored[email] || ACCOUNT_COLOR_PALETTE[index % ACCOUNT_COLOR_PALETTE.length]]));
}

function chatAttachmentType(value, fallback = "text/plain") {
  const type = String(value || "").trim().toLowerCase().slice(0, 120);
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(type) ? type : fallback;
}

function chatAttachmentName(value) {
  const name = String(value || "attachment").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 180);
  return name || "attachment";
}

function ompBlobImageSource(value) {
  const match = typeof value === "string" && value.match(/^blob:sha256:([a-f0-9]{64})$/i);
  if (!match) return "";
  const hash = match[1].toLowerCase();
  for (const path of [join(OMP_AGENT_BLOB_ROOT, hash), ...["png", "jpg", "jpeg", "gif", "webp"].map((extension) => join(OMP_AGENT_BLOB_ROOT, `${hash}.${extension}`))]) {
    try {
      const info = statSync(path);
      if (!info.isFile() || info.size > Math.floor(MAX_CHAT_ATTACHMENT_DATA_CHARS * 3 / 4)) continue;
      const bytes = readFileSync(path);
      if (createHash("sha256").update(bytes).digest("hex") !== hash) continue;
      const type = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png"
        : bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? "image/jpeg"
          : bytes.subarray(0, 6).toString("ascii").match(/^GIF8[79]a$/) ? "image/gif"
            : bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP" ? "image/webp"
              : "";
      if (type) return `data:${type};base64,${bytes.toString("base64")}`;
    } catch {}
  }
  return "";
}

function chatImageSource(value, type = "image/png", options = {}) {
  const source = typeof value === "string" ? value.trim() : "";
  if (!source) return "";
  if (options.allowOmpBlob) {
    const blob = ompBlobImageSource(source);
    if (blob) return blob;
  }
  const dataUrl = source.match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (dataUrl) {
    const encoded = dataUrl[2].replace(/\s+/g, "");
    if (encoded && encoded.length <= MAX_CHAT_ATTACHMENT_DATA_CHARS && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return `data:${dataUrl[1].toLowerCase()};base64,${encoded}`;
    return "";
  }
  try {
    const url = new URL(source);
    return url.protocol === "https:" ? url.href.slice(0, MAX_CHAT_ATTACHMENT_DATA_CHARS) : "";
  } catch {}
  if (!/^image\//.test(type)) return "";
  const encoded = source.replace(/\s+/g, "");
  if (encoded.length < 16 || encoded.length > MAX_CHAT_ATTACHMENT_DATA_CHARS || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return "";
  return `data:${type};base64,${encoded}`;
}

function normalizeChatAttachment(item, options = {}) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const imageUrl = item.image_url ?? item.imageUrl;
  const inlineData = item.inlineData ?? item.inline_data;
  const source = item.source && typeof item.source === "object" ? item.source : {};
  const rawData = item.data
    ?? (typeof imageUrl === "string" ? imageUrl : imageUrl?.url)
    ?? inlineData?.data
    ?? source.data
    ?? item.url
    ?? "";
  const inferredType = typeof rawData === "string" ? rawData.match(/^data:(image\/[a-z0-9.+-]+);base64,/i)?.[1] : "";
  const type = chatAttachmentType(
    item.type || item.mimeType || item.mime_type || inlineData?.mimeType || inlineData?.mime_type || source.media_type || inferredType,
    /^image/i.test(String(options.kindHint || "")) ? "image/png" : "text/plain",
  );
  const textValue = typeof item.text === "string"
    ? item.text
    : typeof item.content === "string" && !/^image\//.test(type) ? item.content : "";
  const textContent = textValue ? textValue.slice(0, MAX_CHAT_ATTACHMENT_TEXT_CHARS) : "";
  const data = /^image\//.test(type) ? chatImageSource(rawData, type, options) : "";
  if (!textContent && !data) return null;
  const sizeValue = Number(item.size);
  const attachment = {
    name: chatAttachmentName(item.name || item.filename || item.path || (data ? "image" : "attachment")),
    type,
    size: Number.isFinite(sizeValue) && sizeValue >= 0 ? Math.min(sizeValue, 10 * 1024 * 1024) : Math.max(textContent.length, data.length),
  };
  if (textContent) attachment.text = textContent;
  if (data) attachment.data = data;
  if (typeof item.path === "string" && item.path.trim()) attachment.path = item.path.replace(/^@/, "").slice(0, 400);
  if (typeof item.source === "string" && item.source.trim()) attachment.source = item.source.slice(0, 40);
  if (item.truncated === true) attachment.truncated = true;
  return attachment;
}

function attachmentKey(item) {
  return createHash("sha256").update(`${item?.name || ""}\0${item?.type || ""}\0${item?.data || item?.text || ""}`).digest("hex");
}

function mergeChatAttachmentsWithOptions(options, ...values) {
  const merged = [];
  const seen = new Set();
  for (const value of values) {
    for (const item of Array.isArray(value) ? value : []) {
      const attachment = normalizeChatAttachment(item, options);
      if (!attachment) continue;
      const key = attachmentKey(attachment);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(attachment);
      if (merged.length >= MAX_CHAT_ATTACHMENTS) return merged;
    }
  }
  return merged;
}

function mergeChatAttachments(...values) {
  return mergeChatAttachmentsWithOptions({}, ...values);
}

function mergeOmpChatAttachments(...values) {
  return mergeChatAttachmentsWithOptions({ allowOmpBlob: true }, ...values);
}

function chatMessageAttachments(message, options = {}) {
  const candidates = [
    ...(Array.isArray(message?.attachments) ? message.attachments : []),
    ...(Array.isArray(message?.images) ? message.images.map((data) => ({ type: "image/png", data })) : []),
  ];
  const blocks = Array.isArray(message?.content) ? message.content : [];
  for (const block of blocks) {
    if (!block || typeof block !== "object" || block.type === "text") continue;
    const kindHint = String(block.type || "");
    const inlineData = block.inlineData ?? block.inline_data;
    const imageUrl = block.image_url ?? block.imageUrl;
    const source = block.source && typeof block.source === "object" ? block.source : {};
    const data = block.data
      ?? (typeof imageUrl === "string" ? imageUrl : imageUrl?.url)
      ?? inlineData?.data
      ?? source.data
      ?? block.url
      ?? "";
    if (data || /image|file/i.test(kindHint)) {
      candidates.push({
        ...block,
        data,
        type: block.type?.includes("/") ? block.type : block.mimeType || block.mime_type || inlineData?.mimeType || inlineData?.mime_type || source.media_type || (/image/i.test(kindHint) ? "image/png" : block.type),
      });
    }
  }
  return options.allowOmpBlob ? mergeOmpChatAttachments(candidates) : mergeChatAttachments(candidates);
}

function messageText(message) {
  return Array.isArray(message?.content)
    ? message.content.filter((block) => block?.type === "text" || (typeof block?.text === "string" && !/image|file/i.test(String(block?.type || "")))).map((block) => typeof block?.text === "string" ? block.text : typeof block?.content === "string" ? block.content : "").join("\n").trim()
    : typeof message?.content === "string" ? message.content.trim() : "";
}

function normalizeChatAttachments(value, options = {}) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw Object.assign(new Error("attachments phải là mảng"), { code: "BAD_REQUEST", field: "attachments" });
  if (value.length > MAX_CHAT_ATTACHMENTS) throw Object.assign(new Error(`Chỉ được đính kèm tối đa ${MAX_CHAT_ATTACHMENTS} tệp`), { code: "BAD_REQUEST", field: "attachments" });
  const normalized = value.map((item) => normalizeChatAttachment(item)).filter(Boolean);
  if (options.rejectInvalid && normalized.length !== value.length) throw Object.assign(new Error("Tệp đính kèm không hợp lệ hoặc không được hỗ trợ"), { code: "BAD_REQUEST", field: "attachments" });
  return normalized;
}

function generationOutcome(message) {
  if (message?.role !== "assistant") return null;
  const error = String(message.errorMessage || "");
  const stopReason = String(message.stopReason || "").toLowerCase();
  const wasUserAbort = stopReason === "aborted" || /\b(?:aborted|cancel(?:led|ed)|interrupted by user|request was aborted)\b/i.test(error);
  if (wasUserAbort) return null;
  if (Number(message.errorStatus) === 401 || /401\b|unauthenticated|invalid[_ -]?grant|token[^\n]*(expired|revoked)|access[_ -]?token/i.test(error)) return { status: "auth_error", reason: "Google trả lỗi xác thực OAuth (401/UNAUTHENTICATED); cần đăng nhập lại" };
  if (Number(message.errorStatus) === 403 || /403\b|permission[_ -]?denied|permission denied|admin[_ -]?policy[_ -]?enforced|license|cloudaicompanion|access[_ -]?denied/i.test(error)) return { status: "access_error", reason: "Google từ chối quyền, policy, API hoặc license (403/PERMISSION_DENIED)" };
  if (Number(message.errorStatus) === 429 || /429|resource[_ ]exhausted|quota|rate limit/i.test(error)) return { status: "quota_blocked", reason: "Google trả HTTP 429/RESOURCE_EXHAUSTED: hết quota hoặc rate limit" };
  if (Number(message.errorStatus) >= 500 || /service unavailable|internal server|timeout|temporar(?:y|ily)|network|certificate|unable to verify|tls|self[- ]signed|malformed[_ ]function[_ ]call|invalid[_ ]function[_ ]call/i.test(error)) return { status: "transient_error", reason: "Google/service hoặc mạng lỗi tạm thời; cần thử lại" };
  if (message.stopReason === "error" || error) return { status: "error", reason: "Lần chat gần nhất lỗi khi sinh nội dung" };
  if (messageText(message)) return { status: "live", reason: "Đã nhận phản hồi model gần nhất" };
  return null;
}

function priorCredentialPin(pins, timestamp, order) {
  return pins.reduce((nearest, pin) => {
    if (pin.timestamp > timestamp || (pin.timestamp === timestamp && pin.order >= order)) return nearest;
    if (!nearest || pin.timestamp > nearest.timestamp || (pin.timestamp === nearest.timestamp && pin.order > nearest.order)) return pin;
    return nearest;
  }, null);
}

async function readGenerationHealth(accounts, now = Date.now()) {
  const accountByPin = new Map(accounts.map((account) => [credentialPinHash(account), quotaAccountId(account)]));
  const health = new Map();
  const cutoff = now - GENERATION_HEALTH_WINDOW_MS;
  for (const file of await sessionFiles()) {
    let fileStat;
    try { fileStat = await stat(file); } catch { continue; }
    if (fileStat.mtimeMs < cutoff) continue;
    let lines;
    try { lines = (await readFile(file, "utf8")).split("\n"); } catch { continue; }
    const records = [];
    for (const [order, line] of lines.entries()) {
      if (!line) continue;
      try {
        const record = JSON.parse(line);
        const timestamp = Date.parse(record.timestamp || record.message?.completedAt || record.message?.timestamp || "");
        records.push({ record, timestamp: Number.isFinite(timestamp) ? timestamp : fileStat.mtimeMs, order });
      } catch { /* ignore malformed session records */ }
    }
    const pins = records.filter(({ record }) => record.type === "credential_pin" && typeof record.hash === "string");
    for (const { record, timestamp: checkedAt, order } of records) {
      const message = record.message;
      const outcome = generationOutcome(message);
      if (!outcome) continue;
      const nearestPin = priorCredentialPin(pins, checkedAt, order);
      const accountId = accountByPin.get(nearestPin?.record.hash);
      const account = accounts.find((item) => quotaAccountId(item) === accountId);
      const provider = String(message?.provider || "").toLowerCase();
      const model = String(message?.model || "").toLowerCase();
      const isGeminiHealth = provider === String(account?.provider || "").toLowerCase()
        && !/claude|gpt|openai|anthropic/.test(model);
      if (!accountId || !isGeminiHealth || checkedAt < cutoff) continue;
      const previous = health.get(accountId);
      if (!previous || checkedAt >= previous.checkedAt) health.set(accountId, {
        ...outcome,
        checkedAt,
        model: message.model || null,
      });
    }
  }
  return health;
}

async function sessionFiles(directory = OMP_SESSION_ROOT) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const files = await Promise.all(entries.map((entry) => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? sessionFiles(file) : entry.name.endsWith(".jsonl") ? [file] : [];
  }));
  return files.flat();
}

async function readTokenHistory() {
  if (Date.now() - historyCache.loadedAt < 30000) return historyCache.items;
  const accountByPin = new Map((latest.accounts || []).map((account) => [
    credentialPinHash(account),
    { id: quotaAccountId(account), email: account.email, provider: account.provider },
  ]));
  const items = [];
  for (const file of await sessionFiles()) {
    let fileStat;
    try { fileStat = await stat(file); } catch { continue; }
    let lines;
    try { lines = (await readFile(file, "utf8")).split("\n"); } catch { continue; }
    const records = [];
    for (const [order, line] of lines.entries()) {
      if (!line) continue;
      try {
        const record = JSON.parse(line);
        const timestamp = Date.parse(record.timestamp || record.message?.completedAt || record.message?.timestamp || "");
        records.push({ record, timestamp: Number.isFinite(timestamp) ? timestamp : fileStat.mtimeMs, order });
      } catch { continue; }
    }
    const sessionId = records.find(({ record }) => record.type === "session")?.record.id || null;
    const pins = records.filter(({ record }) => record.type === "credential_pin" && typeof record.hash === "string");
    for (const { record, timestamp, order } of records) {
      const message = record.message;
      const usage = message?.role === "assistant" ? message.usage : null;
      if (!usage || !message.provider || !message.model) continue;
      const nearestPin = priorCredentialPin(pins, timestamp, order);
      const pinnedAccount = accountByPin.get(nearestPin?.record.hash);
      items.push({
        id: `${file}:${record.id || record.timestamp}`,
        timestamp: record.timestamp || message.completedAt || message.timestamp,
        sessionId,
        accountId: pinnedAccount?.id || null,
        email: pinnedAccount?.email || null,
        provider: message.provider,
        model: message.model,
        input: number(usage.input),
        output: number(usage.output),
        cacheRead: number(usage.cacheRead),
        cacheWrite: number(usage.cacheWrite),
        reasoning: number(usage.reasoningTokens),
        total: number(usage.totalTokens) || number(usage.input) + number(usage.output) + number(usage.cacheRead) + number(usage.cacheWrite),
        latencyMs: Number.isFinite(Number(message.duration)) && Number(message.duration) > 0
          ? Number(message.duration)
          : Number.isFinite(Date.parse(message.completedAt)) && Number.isFinite(timestamp)
            ? Math.max(0, Date.parse(message.completedAt) - timestamp)
            : null,
        ttftMs: Number.isFinite(Number(message.ttft)) && Number(message.ttft) > 0 ? Number(message.ttft) : null,
      });
    }
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

function normalizeOmpAccountControl(value) {
  const source = value && typeof value === "object" ? value : {};
  const accountId = typeof source.accountId === "string" ? source.accountId.trim() : "";
  const provider = typeof source.provider === "string" ? source.provider.trim().toLowerCase() : "";
  return {
    enabled: source.enabled === true && /^acc-[a-f0-9]{12}$/.test(accountId) && provider === LOGIN_PROVIDER,
    accountId,
    provider,
    email: typeof source.email === "string" ? source.email.trim().toLowerCase() : "",
  };
}

async function readOmpAccountControl() {
  try { return normalizeOmpAccountControl(JSON.parse(await readFile(OMP_ACCOUNT_CONTROL_FILE, "utf8"))); }
  catch { return normalizeOmpAccountControl(null); }
}

async function saveOmpAccountControl(value) {
  const control = normalizeOmpAccountControl(value);
  const temporaryFile = `${OMP_ACCOUNT_CONTROL_FILE}.${randomUUID()}.tmp`;
  try {
    await mkdir(ROOT, { recursive: true, mode: 0o700 });
    await writeFile(temporaryFile, `${JSON.stringify(control, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporaryFile, OMP_ACCOUNT_CONTROL_FILE);
    return control;
  } catch {
    await rm(temporaryFile, { force: true }).catch(() => {});
    throw Object.assign(new Error("Không thể lưu KHỐNG CHẾ OMP."), { code: "INTERNAL_SERVER_ERROR" });
  }
}

function normalizeProtectConfig(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    enabled: source.enabled !== false,
    mode: source.mode === "manual" ? "manual" : "auto",
    accountIds: [...new Set(Array.isArray(source.accountIds) ? source.accountIds.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim()).slice(0, 100) : [])],
    rotation: { enabled: source.rotation?.enabled === true },
  };
}

async function readProtectConfig() {
  if (protectConfigCache) return protectConfigCache;
  try { protectConfigCache = normalizeProtectConfig(JSON.parse(await readFile(PROTECT_CONFIG_FILE, "utf8"))); }
  catch { protectConfigCache = normalizeProtectConfig(null); }
  return protectConfigCache;
}

async function saveProtectConfig(value) {
  protectConfigCache = normalizeProtectConfig(value);
  await writeFile(PROTECT_CONFIG_FILE, `${JSON.stringify(protectConfigCache, null, 2)}\n`, { mode: 0o600 });
  return protectConfigCache;
}

async function findSessionPath(sessionId) {
  if (typeof sessionId !== "string" || !sessionId) throw new Error("sessionId là bắt buộc");
  const files = await sessionFiles();
  const named = files.find((file) => file.endsWith(`_${sessionId}.jsonl`) || file.endsWith(`/${sessionId}.jsonl`));
  if (named) return named;
  for (const file of files) {
    let content;
    try { content = await readFile(file, "utf8"); } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
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
async function resolveShareSessionPath(sessionId, current, persisted, record) {
  if (current?.path) return current.path;
  if (persisted?.path) return persisted.path;
  try {
    return await findSessionPath(sessionId);
  } catch (error) {
    if (!record) throw Object.assign(error, { code: "NOT_FOUND" });
    const summary = consoleBridge.get(record.contextId).summary();
    const catalog = await consoleBridge.listSessions(summary.cwd);
    const recentSince = (Number(record.updatedAt) || Number(record.createdAt) || Date.now()) - 120_000;
    const candidates = (catalog.sessions || [])
      .filter((item) => item?.sessionId)
      .filter((item) => {
        const updatedAt = Date.parse(item.updatedAt || "");
        return !Number.isFinite(updatedAt) || updatedAt >= recentSince;
      })
      .sort((a, b) => Number(b?._meta?.messageCount > 0) - Number(a?._meta?.messageCount > 0) || String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    for (const candidate of candidates) {
      const path = await findSessionPath(candidate.sessionId).catch(() => null);
      if (path) return path;
    }
    throw Object.assign(error, { code: "NOT_FOUND" });
  }
}
async function moveSessionRecord(sessionId, destinationRoot) {
  const source = await persistedChatSessionPath(sessionId);
  const root = resolve(OMP_SESSION_ROOT);
  const sourcePath = resolve(source);
  const relativePath = relative(root, sourcePath);
  if (!relativePath || relativePath.startsWith("..") || relativePath.includes("\0")) {
    throw new Error("Đường dẫn session không hợp lệ");
  }
  const destination = join(destinationRoot, relativePath);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await rename(source, destination);
  const sourceArtifacts = source.endsWith(".jsonl") ? source.slice(0, -6) : null;
  const destinationArtifacts = destination.endsWith(".jsonl") ? destination.slice(0, -6) : null;
  if (sourceArtifacts && destinationArtifacts) {
    try { await rename(sourceArtifacts, destinationArtifacts); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return { source, destination };
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
      const over = limit.usedFraction >= QUOTA_SUSPEND_THRESHOLD;
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
  refreshing = runUsage().then(async ({ raw, pid }) => {
    const snapshot = normalize(raw, await readUsageAuthIssues(pid));
    const generationHealth = await readGenerationHealth(snapshot.accounts);
    snapshot.accounts = snapshot.accounts.map((account) => ({
      ...account,
      generationStatus: generationHealth.get(quotaAccountId(account))?.status || "unknown",
      generationReason: generationHealth.get(quotaAccountId(account))?.reason || "Chưa có lần kiểm tra sinh nội dung trong 24 giờ",
      generationCheckedAt: generationHealth.get(quotaAccountId(account))?.checkedAt || null,
      generationModel: generationHealth.get(quotaAccountId(account))?.model || null,
    }));
    const generationByEmail = new Map(snapshot.accounts.map((account) => [account.email.toLowerCase(), account]));
    snapshot.authAccounts = snapshot.authAccounts.map((account) => ({
      ...account,
      generationStatus: generationByEmail.get(account.email.toLowerCase())?.generationStatus || "unknown",
      generationReason: generationByEmail.get(account.email.toLowerCase())?.generationReason || "Chưa có lần kiểm tra sinh nội dung trong 24 giờ",
      generationCheckedAt: generationByEmail.get(account.email.toLowerCase())?.generationCheckedAt || null,
      generationModel: generationByEmail.get(account.email.toLowerCase())?.generationModel || null,
    }));
    const selected = await selectedAccount();
    snapshot.preferredAccountEmail = selected?.email || null;
    await checkThresholds(snapshot);
    latest = { ok: true, error: null, updatedAt: Date.now(), ...snapshot };
    await evaluateQuotaRotation().catch(() => {});
    broadcastStatus();
    return latest;
  }).catch((error) => {
    latest = { ...latest, ok: false, error: error.message, updatedAt: Date.now() };
    broadcastStatus();
    return latest;
  }).finally(() => { refreshing = null; });
  return refreshing;
}

function scheduleRefresh(delayMs = 750) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refresh().catch(() => {});
  }, delayMs);
}

function statusPayload() {
  const dataAgeMs = latest.updatedAt ? Math.max(0, Date.now() - latest.updatedAt) : null;
  return {
    ...latest,
    safety: consoleBridge.safety(),
    refreshing: Boolean(refreshing),
    dataAgeMs,
    stale: dataAgeMs == null || dataAgeMs > 90_000,
  };
}

function writeStatusEvent(res) {
  res.write(`event: status\ndata: ${JSON.stringify(safeErrorPayload(res, statusPayload()))}\n\n`);
}

function broadcastStatus() {
  for (const [res, heartbeat] of statusClients) {
    try { writeStatusEvent(res); }
    catch { clearInterval(heartbeat); statusClients.delete(res); }
  }
}

function subscribeStatus(res) {
  writeStatusEvent(res);
  const heartbeat = setInterval(() => {
    try { res.write(`: heartbeat ${Date.now()}\n\n`); }
    catch { clearInterval(heartbeat); statusClients.delete(res); }
  }, 15_000);
  statusClients.set(res, heartbeat);
  return () => {
    clearInterval(heartbeat);
    statusClients.delete(res);
  };
}

async function readJsonBody(req) {
  const decoder = new TextDecoder();
  let body = "";
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BODY_BYTES) throw new Error("Request vượt quá 1 MiB");
    body += decoder.decode(chunk, { stream: true });
  }
  body += decoder.decode();
  return JSON.parse(body || "{}");
}

async function selectAccount(req) {
  const body = await readJsonBody(req);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const provider = typeof body.provider === "string" ? body.provider.trim().toLowerCase() : "";
  const requestedId = typeof body.accountId === "string" ? body.accountId.trim() : "";
  await ensureQuotaLatest();
  const matchingEmail = latest.accounts.filter((item) => item.email?.toLowerCase() === email);
  const account = requestedId
    ? latest.accounts.find((item) => quotaAccountId(item) === requestedId)
    : provider
      ? matchingEmail.find((item) => item.provider?.toLowerCase() === provider)
      : matchingEmail.length === 1 ? matchingEmail[0] : null;
  if (!account) {
    const ambiguous = !requestedId && !provider && matchingEmail.length > 1;
    throw Object.assign(new Error(ambiguous ? "Cần accountId khi nhiều account dùng chung email." : "Account không tồn tại trong OMP"), {
      code: ambiguous ? "BAD_REQUEST" : "ACCOUNT_NOT_FOUND",
      field: ambiguous ? "accountId" : "email",
    });
  }
  const availability = quotaAccountAvailability(account);
  if (!availability.canUse) throw Object.assign(new Error(availability.reason), { code: "ACCOUNT_UNAVAILABLE", field: "email" });
  const selected = selectedQuotaAccount(latest.accounts, await selectedAccount(), latest.preferredAccountEmail);
  const wasPreferred = Boolean(selected && quotaAccountId(selected) === quotaAccountId(account));
  await writeFile(SELECTED_ACCOUNT_FILE, `${JSON.stringify({ accountId: quotaAccountId(account), email: account.email, provider: account.provider, selectedAt: Date.now() }, null, 2)}\n`, { mode: 0o600 });
  historyCache = { loadedAt: 0, items: [] };
  latest.preferredAccountEmail = account.email;
  broadcastStatus();
  return {
    ok: true,
    accountId: quotaAccountId(account),
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
  const nowDate = new Date();
  const startOfMonth = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1);
  const startOfYear = new Date(nowDate.getFullYear(), 0, 1);
  const since = (start) => tokenSummary(items.filter((item) => new Date(item.timestamp).getTime() >= start));
  const periods = {
    hour: since(Date.now() - 60 * 60 * 1000),
    day: since(Date.now() - 24 * 60 * 60 * 1000),
    month: since(startOfMonth.getTime()),
    year: since(startOfYear.getTime()),
    total: tokenSummary(items),
  };
  const colors = await accountColorMap(items.map((item) => item.email));
  return {
    ok: true,
    generatedAt: Date.now(),
    totalRecords: items.length,
    summary: periods.day,
    periods,
    accountColors: colors,
    items: items.slice(0, Math.min(200, Math.max(1, limit))).map((item) => ({ ...item, color: item.email ? colors[item.email.toLowerCase()] || null : null })),
  };
}

function loginTargetEmail(value) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!email) return null;
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(email)) throw Object.assign(new Error("Email OAuth không hợp lệ."), { code: "BAD_REQUEST", field: "email" });
  return email;
}

function loginErrorMessage(value, fallback) {
  const message = String(value || "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/^(?:https?:\/\/|at\s)/i.test(line)).at(-1)?.replace(/https?:\/\/\S+/gi, "").replace(/\$bunfs\S*/g, "").trim();
  return message?.slice(0, 300) || fallback;
}

function startLogin(targetEmail = null) {
  if (loginProcess) throw Object.assign(new Error("Đang có một phiên đăng nhập OAuth khác"), { code: "CONFLICT" });
  const loginAccountEmail = targetEmail || latest.preferredAccountEmail || null;
  login = { state: "starting", provider: LOGIN_PROVIDER, accountEmail: loginAccountEmail, url: null, message: `Đang tạo phiên ${LOGIN_PROVIDER_LABEL}…` };
  const child = spawn(OMP_BIN, ["auth-broker", "login", LOGIN_PROVIDER], { env: OMP_ENV });
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
        login = { state: "waiting", provider: LOGIN_PROVIDER, accountEmail: loginAccountEmail, url, message: `Đã mở Google cho ${LOGIN_PROVIDER_LABEL}; hoàn tất đăng nhập trong trình duyệt.` };
        spawn("/usr/bin/open", [url], { stdio: "ignore" });
      }
    }
  };
  child.stdout.on("data", read);
  child.stderr.on("data", read);
  child.on("error", (error) => {
    login = { state: "error", provider: LOGIN_PROVIDER, accountEmail: loginAccountEmail, url: null, message: loginErrorMessage(error.message, "Không thể khởi chạy OAuth.") };
    loginProcess = null;
  });
  child.on("close", (code) => {
    loginProcess = null;
    if (code !== 0) {
      login = { state: "error", provider: LOGIN_PROVIDER, accountEmail: loginAccountEmail, url: null, message: loginErrorMessage(output, `OMP login exited with ${code}`) };
      return;
    }
    void refresh().then(async (snapshot) => {
      const expectedEmail = String(loginAccountEmail || "").trim().toLowerCase();
      const accounts = Array.isArray(snapshot.accounts) ? snapshot.accounts : [];
      const account = accounts.find((item) => item.provider === LOGIN_PROVIDER && (!expectedEmail || item.email?.toLowerCase() === expectedEmail));
      if (!snapshot.ok || !account) {
        const message = !snapshot.ok
          ? "OAuth hoàn tất nhưng OMP không đọc được quota. Hãy thử đồng bộ lại."
          : expectedEmail && accounts.some((item) => item.provider === LOGIN_PROVIDER)
            ? "OAuth hoàn tất nhưng OMP không nhận đúng account đã chọn."
            : "OAuth hoàn tất nhưng OMP chưa nhận account quota; dashboard không đánh dấu Google từ chối quyền.";
        login = { state: "error", provider: LOGIN_PROVIDER, accountEmail: loginAccountEmail, url: null, message };
      } else {
        login = { state: "complete", provider: LOGIN_PROVIDER, accountEmail: account.email, url: null, message: `${LOGIN_PROVIDER_LABEL} đã đăng nhập; quota đang được cập nhật.` };
      }
      await syncSafetyPolicy();
      broadcastStatus();
    }).catch((error) => {
      login = { state: "error", provider: LOGIN_PROVIDER, accountEmail: loginAccountEmail, url: null, message: error.message };
      broadcastStatus();
    });
  });
}

const consoleBridge = new ConsoleBridge({ env: OMP_ENV, onGenerationFinished: () => scheduleRefresh(), onSafetyChanged: () => broadcastStatus() });
const ompToolCatalog = createOmpToolCatalog({ ompBin: OMP_BIN, env: OMP_ENV });

async function syncSafetyPolicy() {
  const config = await readProtectConfig();
  const metadata = await readChatMetadata();
  const selected = eligibleGeminiQuotaAccounts().find((account) => quotaAccountId(account) === metadata.geminiDefaultAccountId) || null;
  const selectedId = selected ? quotaAccountId(selected) : null;
  const activeAccountProtected = Boolean(selected) && (config.mode === "auto" || config.accountIds.includes(selectedId));
  consoleBridge.updateSafetyPolicy({ enabled: config.enabled, mode: config.mode, activeAccountProtected });
  return { config, selectedId, activeAccountProtected };
}

void syncSafetyPolicy().catch(() => {});
const SOURCE_ROOT = fileURLToPath(new URL("./", import.meta.url));
const OMP_GATEWAY_VERSION = "1";
const gatewaySessions = new Map();
const chatSessionMeta = new Map();
const chatMessageCache = new Map();
const activeChatRequests = new Map();
const activeMemoryOperations = new Set();
const sessionPersistenceRequests = new Map();
const chatTurnQueues = new Map();
const MAX_PENDING_CHAT_TURNS = 32;
const gatewaySessionCreations = new Map();
const gatewaySessionEnsures = new Map();
let chatDispatchGate = Promise.resolve();

function chatTurnQueue(contextId) {
  let queue = chatTurnQueues.get(contextId);
  if (!queue) {
    queue = { active: null, pending: [], pumping: false, paused: false, pauseReason: null };
    chatTurnQueues.set(contextId, queue);
  }
  return queue;
}

function pendingChatTurns(queue) {
  return (queue?.pending || []).filter((entry) => !entry.cancelled);
}

function queueWaitingMessage({ phase, queueAhead, retryAfterSeconds }) {
  if (phase === "paused") return "Hàng chờ tạm dừng sau lỗi hoặc lượt bị dừng.";
  if (phase === "safety_cooldown") return `Safety Guard cooldown · còn ${retryAfterSeconds || 0}s`;
  if (phase === "safety_gap") return `Đang chờ Safety Guard · còn ${retryAfterSeconds || 0}s`;
  return queueAhead > 0 ? `Đang chờ lượt trước · còn ${queueAhead} order phía trước` : "Đang xử lý";
}

function chatTurnQueueSnapshot(queue) {
  const pending = pendingChatTurns(queue);
  return {
    paused: Boolean(queue?.paused),
    pauseReason: queue?.pauseReason || null,
    queuedTurns: pending.length,
  };
}

function notifyChatTurnQueue(queue) {
  const pending = pendingChatTurns(queue);
  const queuedTurns = pending.length;
  pending.forEach((entry, index) => {
    const phase = queue.paused ? "paused" : "fifo";
    const queueAhead = (queue.active ? 1 : 0) + index;
    const snapshot = {
      phase,
      queueAhead,
      queuedTurns,
      retryAfterSeconds: 0,
      reason: queue.paused ? queue.pauseReason || "previous_turn_failed" : "fifo",
    };
    entry.onQueueState?.({ ...snapshot, message: queueWaitingMessage(snapshot) });
  });
}

function pauseChatTurnQueue(contextId, reason) {
  const queue = chatTurnQueues.get(contextId);
  if (!queue || !pendingChatTurns(queue).length) return chatTurnQueueSnapshot(queue);
  queue.paused = true;
  queue.pauseReason = reason || "previous_turn_failed";
  notifyChatTurnQueue(queue);
  return chatTurnQueueSnapshot(queue);
}

function resumeChatTurnQueue(contextId) {
  const queue = chatTurnQueues.get(contextId);
  if (!queue) return { paused: false, pauseReason: null, queuedTurns: 0 };
  queue.paused = false;
  queue.pauseReason = null;
  notifyChatTurnQueue(queue);
  const snapshot = chatTurnQueueSnapshot(queue);
  pumpChatTurnQueue(contextId);
  return snapshot;
}

function releaseChatTurnQueue(contextId, queue) {
  if (queue.active || queue.pending.length) return;
  if (chatTurnQueues.get(contextId) === queue) chatTurnQueues.delete(contextId);
}

function pumpChatTurnQueue(contextId) {
  const queue = chatTurnQueues.get(contextId);
  if (!queue || queue.pumping || queue.active || queue.paused) return;
  queue.pumping = true;
  const run = async () => {
    try {
      while (!queue.paused && !queue.active && queue.pending.length) {
        const entry = queue.pending.shift();
        if (!entry || entry.cancelled) {
          entry?.resolve?.();
          continue;
        }
        queue.active = entry;
        entry.started = true;
        const activeSnapshot = { phase: "fifo", queueAhead: 0, queuedTurns: pendingChatTurns(queue).length, retryAfterSeconds: 0, reason: "dispatch" };
        entry.onQueueState?.({ ...activeSnapshot, message: queueWaitingMessage(activeSnapshot) });
        notifyChatTurnQueue(queue);
        try {
          await entry.run();
          entry.resolve?.();
        } catch (error) {
          entry.reject?.(error);
        } finally {
          if (queue.active === entry) queue.active = null;
          notifyChatTurnQueue(queue);
        }
      }
    } finally {
      queue.pumping = false;
      releaseChatTurnQueue(contextId, queue);
      if (chatTurnQueues.get(contextId) === queue && !queue.paused && !queue.active && queue.pending.length) queueMicrotask(() => pumpChatTurnQueue(contextId));
    }
  };
  void run();
}

function enqueueChatTurn(contextId, entry) {
  const queue = chatTurnQueue(contextId);
  entry.started = false;
  entry.cancelled = false;
  entry.promise = new Promise((resolve, reject) => {
    entry.resolve = resolve;
    entry.reject = reject;
  });
  entry.cancel = () => {
    if (entry.cancelled) return;
    entry.cancelled = true;
    if (queue.active === entry) {
      entry.release?.();
      return;
    }
    const index = queue.pending.indexOf(entry);
    if (index >= 0) queue.pending.splice(index, 1);
    entry.resolve?.();
    notifyChatTurnQueue(queue);
    releaseChatTurnQueue(contextId, queue);
    if (!queue.active) pumpChatTurnQueue(contextId);
  };
  if (queue.pending.length >= MAX_PENDING_CHAT_TURNS) {
    entry.onQueueFailure?.(Object.assign(new Error("Hàng đợi chat đã đầy; vui lòng thử lại sau."), { code: "RATE_LIMITED" }));
    return entry.promise;
  }
  queue.pending.push(entry);
  notifyChatTurnQueue(queue);
  pumpChatTurnQueue(contextId);
  return entry.promise;
}
function failQueuedChatTurns(contextId, error) {
  const queue = chatTurnQueues.get(contextId);
  if (!queue) return;
  for (const entry of [...queue.pending]) {
    entry.onQueueFailure?.(error);
    entry.cancel?.();
  }
}

function chatTurnOwner(contextId, requestId) {
  return chatTurnQueues.get(contextId)?.active?.requestId === requestId;
}

function contextHasChatWork(contextId) {
  const queue = chatTurnQueues.get(contextId);
  if (queue?.active || queue?.pending.length) return true;
  return Boolean(consoleBridge.get(contextId).summary().safety?.activeTurn);
}

function withChatDispatchGate(task) {
  const previous = chatDispatchGate;
  let release;
  chatDispatchGate = new Promise((resolve) => { release = resolve; });
  return previous.then(task).finally(release);
}
let chatMetadataWrite = Promise.resolve();
let chatMediaWrite = Promise.resolve();
let availableModelsCache = { loadedAt: 0, items: [] };
let protectConfigCache = null;
let quotaRotationWrite = Promise.resolve();
let quotaRotationState = { lastCheckedAt: null, lastRotation: null, reason: "Chưa đánh giá xoay account" };
const GATEWAY_COMMANDS = new Set([
  "abort", "abort_retry", "bash", "branch", "compact", "export_html", "get_available_commands",
  "get_available_models", "get_login_providers", "get_messages", "get_messages_page", "get_session_stats", "get_state",
  "get_subagent_messages", "get_subagents", "handoff", "login", "new_session", "set_auto_compaction", "set_auto_retry",
  "set_fast_mode", "set_follow_up_mode", "set_interrupt_mode", "set_model", "set_session_name", "set_steering_mode",
  "set_subagent_subscription", "set_thinking_level", "set_todos", "switch_session", "extension_ui_response",
]);
const ACP_GATEWAY_COMMANDS = new Set([
  "abort", "get_available_commands", "get_available_models", "get_state",
  "set_model", "set_thinking_level", "switch_session", "extension_ui_response",
]);
const BLOCKED_BROWSER_COMMANDS = new Set(["bash", "login"]);
const OMP_THINKING_LEVELS = new Set(["max", "high", "medium", "low", "none"]);

const OMP_CAPABILITY_VERSION = "2026-09-29";
const OMP_MEMORY_BACKENDS = new Set(["off", "local", "hindsight", "mnemopi", "sharpshooter"]);
const OMP_MEMORY_ACTIONS = ["view", "stats", "diagnose", "queue", "sync", "clear", "reset", "enqueue", "rebuild"];
const OMP_MEMORY_MUTATING_ACTIONS = new Set(["sync", "clear", "reset", "enqueue", "rebuild"]);
const OMP_MEMORY_CONFIRM_ACTIONS = new Set(["sync", "clear", "reset", "enqueue", "rebuild"]);
const HEADLESS_APPROVAL_RANK = { read: 0, write: 1, exec: 2 };
const HEADLESS_APPROVAL_LIMIT = { "always-ask": "read", write: "write", yolo: "exec" };
function runOmpMemoryBackend(cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(OMP_BIN, ["config", "get", "memory.backend"], { env: OMP_ENV, cwd, stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(reject, Object.assign(new Error("OMP Memory config không khả dụng"), { code: "UPSTREAM_UNAVAILABLE" }));
    }, 10000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.length > 128) {
        child.kill("SIGTERM");
        finish(reject, Object.assign(new Error("OMP Memory config không hợp lệ"), { code: "UPSTREAM_UNAVAILABLE" }));
      }
    });
    child.on("error", () => finish(reject, Object.assign(new Error("OMP Memory config không khả dụng"), { code: "UPSTREAM_UNAVAILABLE" })));
    child.on("close", (code) => {
      if (code !== 0) return finish(reject, Object.assign(new Error("OMP Memory config không khả dụng"), { code: "UPSTREAM_UNAVAILABLE" }));
      const backend = output.trim();
      finish(resolve, OMP_MEMORY_BACKENDS.has(backend) ? backend : "unknown");
    });
  });
}

async function readOmpToolCatalog() {
  return (await ompToolCatalog.read()).tools;
}

async function selectedOmpTools(value) {
  return ompToolCatalog.selected(value);
}
const OMP_BROWSER_MODES = [
  { id: "ego-browser", label: "Ego Browser · Skill", status: "supported", default: false, note: "Chỉ bật khi Síp chọn; OMP nạp /skill:ego-browser cho các order cần web." },
  { id: "omp-browser-relay", label: "OMP Browser Relay", status: "unavailable", default: false, note: "Browser relay chưa được hỗ trợ." },
  { id: "chrome-electron", label: "Chrome/Electron hiện có", status: "unavailable", default: false, note: "Chrome/Electron automation chưa được hỗ trợ." },
];
const OMP_BROWSER_MODE_IDS = new Set(["none", ...OMP_BROWSER_MODES.map((item) => item.id)]);
const OMP_APPROVAL_MODES = [
  { id: "always-ask", label: "Luôn hỏi", status: "partial", default: true, note: "Chat thường chỉ bật tool đọc; Ego Browser skill có thể yêu cầu phê duyệt khi chạy thao tác browser." },
  { id: "write", label: "Chỉ hỏi thao tác nguy hiểm", status: "partial", default: false, note: "Chat thường giới hạn tool theo mức write; Ego Browser skill vẫn đi qua approval boundary." },
  { id: "yolo", label: "Toàn quyền", status: "supported", default: false, warning: "Chỉ bật khi Síp chủ động chọn" },
];
const OMP_SHARE_MODES = [
  { id: "encrypted", label: "OMP encrypted share", status: "partial", note: "Adapter URL đang hoàn thiện" },
  { id: "collab-read", label: "Collab read-only", status: "unavailable", note: "Chưa có host collab adapter." },
  { id: "collab-write", label: "Collab read-write", status: "unavailable", note: "Chưa có host collab adapter." },
  { id: "local", label: "Local loopback URL", status: "supported", note: "URL session cục bộ" },
];

function approvalMode(value) {
  const mode = typeof value === "string" && value.trim() ? value.trim() : "always-ask";
  if (!["always-ask", "write", "yolo"].includes(mode)) throw Object.assign(new Error("approvalMode không hợp lệ"), { code: "BAD_REQUEST", field: "approvalMode" });
  return mode;
}

async function headlessTools(approval, tools) {
  if (approval === "yolo") return tools;
  const limit = HEADLESS_APPROVAL_RANK[HEADLESS_APPROVAL_LIMIT[approval]];
  const policies = new Map((await ompToolCatalog.policies(tools)).map((tool) => [tool.id, tool]));
  const allowed = tools.filter((id) => {
    const tool = policies.get(id);
    return tool && HEADLESS_APPROVAL_RANK[tool.approval] <= limit && (approval !== "always-ask" || tool.alwaysAsk);
  });
  if (!allowed.length) throw Object.assign(new Error("Chế độ phê duyệt hiện tại chỉ hỗ trợ công cụ đọc trong dashboard headless."), { code: "CONFLICT" });
  return allowed;
}

function gatewaySessionId(value, options = {}) {
  const allowMissing = options.allowMissing === true;
  const id = typeof value === "string" ? value.trim() : "";
  if (!id) {
    if (allowMissing) return randomUUID();
    throw Object.assign(new Error("sessionId là bắt buộc"), { code: "BAD_REQUEST", field: "sessionId" });
  }
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(id)) {
    throw Object.assign(new Error("sessionId không hợp lệ"), { code: "BAD_REQUEST", field: "sessionId" });
  }
  return id;
}

function chatFolderName(value) {
  const name = typeof value === "string" ? value.normalize("NFC").trim() : "";
  if (!name || name.length > 120 || /[\p{Cc}\p{Cf}/\\<>"'`]/u.test(name)) {
    throw Object.assign(new Error("Tên folder phải có 1-120 ký tự an toàn"), { code: "BAD_REQUEST", field: "name" });
  }
  return name;
}

function chatFolderId(value) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) {
    throw Object.assign(new Error("folderId không hợp lệ"), { code: "BAD_REQUEST", field: "folderId" });
  }
  return id;
}

function chatFolderKey(value) {
  return String(value).normalize("NFC").toLocaleLowerCase();
}

function hasSessionFolderMetadata(value) {
  return Boolean(value && typeof value === "object" && (Object.prototype.hasOwnProperty.call(value, "folderId") || Object.prototype.hasOwnProperty.call(value, "folderName")));
}

function chatFolderView(folder) {
  return { id: folder.id, name: folder.name, ...(typeof folder.cwd === "string" && folder.cwd ? { cwd: folder.cwd } : {}) };
}

function sessionFolderFields(metadata, source, fallbackName = "") {
  if (!hasSessionFolderMetadata(source)) return fallbackName ? { folderName: fallbackName } : {};
  const folderId = typeof source.folderId === "string" && source.folderId.trim() ? source.folderId.trim() : "";
  const storedFolder = folderId && Object.prototype.hasOwnProperty.call(metadata.folders, folderId) ? metadata.folders[folderId] : null;
  const folderName = typeof storedFolder?.name === "string" && storedFolder.name.trim()
    ? storedFolder.name.trim()
    : typeof source.folderName === "string" ? source.folderName.trim() : "";
  return {
    ...(folderId ? { folderId } : {}),
    ...(folderName ? { folderName } : {}),
  };
}
function decodeSessionSegment(value, field) {
  try { return decodeURIComponent(String(value || "")); }
  catch { throw Object.assign(new Error(`${field} không hợp lệ`), { code: "BAD_REQUEST", field }); }
}

function liveGatewayRecord(sessionId) {
  const record = gatewaySessions.get(sessionId);
  if (!record) return null;
  try {
    consoleBridge.publicSummary(record.contextId);
    return record;
  } catch {
    gatewaySessions.delete(sessionId);
    return null;
  }
}

function gatewayRecord(sessionId) {
  const record = liveGatewayRecord(sessionId);
  if (!record) throw new Error("Gateway session không tồn tại");
  return record;
}

async function recycleGatewaySession(record) {
  if (!record || gatewaySessions.get(record.sessionId) !== record) return;
  if (pendingChatTurns(chatTurnQueues.get(record.contextId)).length) return;
  gatewaySessions.delete(record.sessionId);
  failQueuedChatTurns(record.contextId, Object.assign(new Error("OMP context đã được khởi động lại; order đang chờ cần gửi lại."), { code: "UPSTREAM_ERROR" }));
  await rememberGatewaySession(record).catch(() => {});
  await consoleBridge.stop(record.contextId).catch(() => {});
}

function gatewayPayload(record) {
  const context = consoleBridge.publicSummary(record.contextId);
  return {
    ok: true,
    contractVersion: OMP_GATEWAY_VERSION,
    sessionId: record.sessionId,
    context,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

async function gatewayLaunchConfig(body = {}) {
  const selectedApprovalMode = approvalMode(body.approvalMode);
  const selectedBrowserMode = body.browserMode == null ? null : browserMode(body.browserMode);
  const useSkillBrowser = selectedBrowserMode === "ego-browser";
  const selectedTools = useSkillBrowser ? null : await headlessTools(selectedApprovalMode, await selectedOmpTools(body.tools));
  return {
    approvalMode: selectedApprovalMode,
    browserMode: selectedBrowserMode,
    tools: selectedTools,
    workerTools: selectedTools ?? [],
  };
}

async function createGatewaySession(body) {
  const sessionId = gatewaySessionId(body.sessionId, { allowMissing: true });
  const existing = liveGatewayRecord(sessionId);
  if (existing) return gatewayPayload(existing);
  const pending = gatewaySessionCreations.get(sessionId);
  if (pending) return gatewayPayload(await pending);
  const creation = (async () => {
    const current = liveGatewayRecord(sessionId);
    if (current) return current;
    const launch = await gatewayLaunchConfig(body);
    const protocol = process.env.NODE_ENV === "test" && process.env.OMP_DASHBOARD_TEST_CHAT_PROTOCOL === "rpc" ? "rpc" : "acp";
    const context = await consoleBridge.start({
      protocol,
      cwd: body.cwd,
      approvalMode: launch.approvalMode,
      tools: launch.workerTools,
      ompSessionId: body.ompSessionId,
    });
    const record = {
      sessionId,
      protocol,
      contextId: context.id,
      ompSessionId: context.sessionId || null,
      cwd: context.cwd,
      approvalMode: launch.approvalMode,
      tools: launch.tools,
      browserMode: launch.browserMode,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    gatewaySessions.set(sessionId, record);
    return record;
  })();
  gatewaySessionCreations.set(sessionId, creation);
  try {
    return gatewayPayload(await creation);
  } finally {
    if (gatewaySessionCreations.get(sessionId) === creation) gatewaySessionCreations.delete(sessionId);
  }
}

async function prewarmGateway(body = {}) {
  const launch = await gatewayLaunchConfig(body);
  const cwd = typeof body.cwd === "string" && body.cwd.trim() ? body.cwd.trim() : GENERAL_CHAT_CWD;
  if (cwd === GENERAL_CHAT_CWD) await mkdir(cwd, { recursive: true, mode: 0o700 });
  return consoleBridge.prewarm({ cwd, approvalMode: launch.approvalMode, tools: launch.workerTools });
}

function normalizedChatMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Metadata chat không hợp lệ");
  for (const key of ["folders", "sessions"]) {
    if (Object.hasOwn(value, key) && (!value[key] || typeof value[key] !== "object" || Array.isArray(value[key]))) {
      throw new Error("Metadata chat không hợp lệ");
    }
  }
  return {
    ...value,
    folders: value.folders || {},
    sessions: value.sessions || {},
  };
}

async function readChatMetadata() {
  let content;
  try { content = await readFile(CHAT_METADATA_FILE, "utf8"); }
  catch (error) {
    if (error.code === "ENOENT") return normalizedChatMetadata({});
    throw Object.assign(new Error("Không đọc được metadata chat."), { code: "INTERNAL_SERVER_ERROR" });
  }
  try { return normalizedChatMetadata(JSON.parse(content)); }
  catch { throw Object.assign(new Error("Metadata chat không hợp lệ."), { code: "INTERNAL_SERVER_ERROR" }); }
}

async function writeChatMetadata(data) {
  const temporaryFile = `${CHAT_METADATA_FILE}.${randomUUID()}.tmp`;
  try {
    await mkdir(ROOT, { recursive: true, mode: 0o700 });
    await writeFile(temporaryFile, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporaryFile, CHAT_METADATA_FILE);
  } catch {
    await rm(temporaryFile, { force: true }).catch(() => {});
    throw Object.assign(new Error("Không thể lưu metadata chat."), { code: "INTERNAL_SERVER_ERROR" });
  }
}

async function updateChatMetadata(sessionId, patch, options = {}) {
  const touchUpdatedAt = options.touchUpdatedAt !== false;
  const operation = chatMetadataWrite.then(async () => {
    const data = await readChatMetadata();
    const current = data.sessions[sessionId] && typeof data.sessions[sessionId] === "object" ? data.sessions[sessionId] : {};
    const next = { ...current, ...patch };
    if (touchUpdatedAt || !current.updatedAt) next.updatedAt = new Date().toISOString();
    data.sessions[sessionId] = next;
    await writeChatMetadata(data);
    return next;
  });
  chatMetadataWrite = operation.catch(() => {});
  return operation;
}

async function listChatFolders() {
  const metadata = await readChatMetadata();
  const sessionsByFolder = new Map();
  Object.entries(metadata.sessions).forEach(([id, session]) => {
    const folderId = typeof session?.folderId === "string" ? session.folderId : "";
    if (!folderId || session?.deleted || session?.archived || !Object.hasOwn(metadata.folders, folderId)) return;
    const sessions = sessionsByFolder.get(folderId) || [];
    sessions.push(chatSessionView({ id, ...session }));
    sessionsByFolder.set(folderId, sessions);
  });
  return Object.values(metadata.folders)
    .filter((folder) => folder && typeof folder.id === "string" && typeof folder.name === "string")
    .map((folder) => {
      const sessions = (sessionsByFolder.get(folder.id) || []).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return { ...chatFolderView(folder), sessionCount: sessions.length, sessions };
    });
}

async function createChatFolder(name, cwd) {
  const folderName = chatFolderName(name);
  const workspaceCwd = await consoleBridge.validateWorkspaceDirectory(cwd);
  const operation = chatMetadataWrite.then(async () => {
    const data = await readChatMetadata();
    const duplicate = Object.values(data.folders).find((folder) => typeof folder?.name === "string" && chatFolderKey(folder.name) === chatFolderKey(folderName));
    if (duplicate) throw Object.assign(new Error("Folder đã tồn tại"), { code: "CONFLICT", field: "name" });
    const id = `folder-${randomUUID()}`;
    const now = new Date().toISOString();
    const folder = { id, name: folderName, cwd: workspaceCwd, createdAt: now, updatedAt: now };
    data.folders[id] = folder;
    await writeChatMetadata(data);
    return chatFolderView(folder);
  });
  chatMetadataWrite = operation.catch(() => {});
  return operation;
}
async function updateChatFolderWorkspace(folderId, cwd) {
  const id = chatFolderId(folderId);
  const workspaceCwd = await consoleBridge.validateWorkspaceDirectory(cwd);
  const operation = chatMetadataWrite.then(async () => {
    const data = await readChatMetadata();
    const folder = data.folders[id];
    if (!folder || typeof folder.name !== "string") throw Object.assign(new Error("Folder không tồn tại"), { code: "NOT_FOUND", field: "folderId" });
    folder.cwd = workspaceCwd;
    folder.updatedAt = new Date().toISOString();
    await writeChatMetadata(data);
    return chatFolderView(folder);
  });
  chatMetadataWrite = operation.catch(() => {});
  return operation;
}
async function rememberGatewaySession(record, timeoutMs = 1500) {
  if (!record) return null;
  const current = chatSessionMeta.get(record.sessionId);
  if (current?.path && withinRoot(OMP_SESSION_ROOT, current.path)) return current.path;
  const pending = sessionPersistenceRequests.get(record.sessionId);
  if (pending) return pending;
  const operation = (async () => {
    let state;
    try { state = await queryGatewayResponse(record, { type: "get_state" }, timeoutMs); }
    catch { return null; }
    const ompSessionId = typeof state?.sessionId === "string" ? state.sessionId : record.ompSessionId;
    const sessionFile = typeof state?.sessionFile === "string" && withinRoot(OMP_SESSION_ROOT, state.sessionFile)
      ? state.sessionFile
      : ompSessionId ? await findSessionPath(ompSessionId).catch(() => null) : null;
    if (!sessionFile) return null;
    const messageCount = Number(state?.messageCount);
    const patch = {
      path: sessionFile,
      cwd: record.cwd,
      ...(ompSessionId ? { ompSessionId } : {}),
      ...(Number.isFinite(messageCount) ? { messageCount } : {}),
    };
    const stored = await updateChatMetadata(record.sessionId, patch, { touchUpdatedAt: false });
    chatSessionMeta.set(record.sessionId, {
      ...(chatSessionMeta.get(record.sessionId) || {}),
      ...stored,
      id: record.sessionId,
      path: sessionFile,
      cwd: record.cwd,
    });
    return sessionFile;
  })();
  sessionPersistenceRequests.set(record.sessionId, operation);
  try { return await operation; }
  finally { if (sessionPersistenceRequests.get(record.sessionId) === operation) sessionPersistenceRequests.delete(record.sessionId); }
}

function chatRequestId(value) {
  if (value == null || value === "") return randomUUID();
  const id = String(value).trim();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(id)) {
    throw Object.assign(new Error("requestId không hợp lệ"), { code: "BAD_REQUEST", field: "requestId" });
  }
  return id;
}

function chatPrompt(value) {
  const prompt = typeof value === "string" ? value.trim() : "";
  if (!prompt) throw Object.assign(new Error("prompt là bắt buộc"), { code: "BAD_REQUEST", field: "prompt" });
  if (prompt.length > MAX_CHAT_PROMPT_CHARS) throw Object.assign(new Error("prompt vượt quá giới hạn 900000 ký tự"), { code: "BAD_REQUEST", field: "prompt" });
  return prompt;
}
function looksLikeImageGenerationPrompt(value) {
  const prompt = String(value || "").trim();
  if (!prompt) return false;
  const action = /(?:tạo|vẽ|sinh|generate|create|draw|make|redesign|transform|biến đổi)/i;
  const image = /(?:ảnh|hình|image|picture|photo|png|jpe?g|svg|illustration|logo|poster)/i;
  return action.test(prompt) && image.test(prompt);
}
function isFullCodeAuditPrompt(value) {
  const prompt = String(value || "").trim();
  return /(?:đọc|read|audit|review|kiểm tra|phân tích|analy[sz]e|inspect)/i.test(prompt)
    && /(?:toàn bộ|tất cả|entire|all)(?:\s|$|[.,:;!?])/i.test(prompt)
    && /(?:file|tệp|code|mã nguồn|dự án|project|repo(?:sitory)?)/i.test(prompt);
}
function longRunningChatTurn(prompt, browserMode) {
  return browserMode === "ego-browser" || looksLikeImageGenerationPrompt(prompt) || isFullCodeAuditPrompt(prompt);
}

function isImageGenerationModel(value) {
  return /(?:^|[-_])(?:image|imagen)(?:$|[-_])/i.test(String(value || ""));
}

function imageGenerationCapability(models) {
  const nativeModels = models.filter((model) => model.imageGeneration).map((model) => model.id);
  if (nativeModels.length) return { status: "supported", models: nativeModels, source: "model" };
  return { status: "unavailable", models: [], reason: "OMP chưa có model tạo ảnh native có thể trả ảnh về chat." };
}

function imageGenerationModelForPrompt(prompt, model, models) {
  if (!looksLikeImageGenerationPrompt(prompt) || model.imageGeneration) return model;
  const candidate = models.find((item) => item.imageGeneration && item.provider === model.provider);
  if (candidate) return candidate;
  throw Object.assign(new Error(`Model "${model.id}" không tạo ảnh đầu ra và provider hiện tại chưa có model tạo ảnh native.`), { code: "IMAGE_GENERATION_MODEL_REQUIRED", field: "model" });
}

function imageOutputInstruction(prompt) {
  if (!looksLikeImageGenerationPrompt(prompt)) return "";
  return "\n\n[Dashboard media contract: use the selected native image model. Return the generated image as an attachment. Do not say the image is complete unless an image attachment is returned.]";
}

function normalizeModels(data) {
  const list = Array.isArray(data) ? data : Array.isArray(data?.models) ? data.models : Array.isArray(data?.availableModels) ? data.availableModels : [];
  return list.map((item) => {
    const id = item.id || item.modelId;
    const name = item.name || item.displayName || id;
    const provider = item.provider || "OMP";
    const explicitImageGeneration = item.imageGeneration ?? item.capabilities?.imageGeneration ?? item.capabilities?.image_generation;
    const output = item.output ?? item.outputs ?? item.capabilities?.output ?? item.capabilities?.outputs;
    return {
      id,
      name,
      provider,
      contextWindow: Number(item.contextWindow || item.contextLength || 0),
      isDefault: provider === LOGIN_PROVIDER && (Boolean(item.isDefault || item.default) || id === "gemini-3.8-flash"),
      imageGeneration: explicitImageGeneration === true || (Array.isArray(output) && output.includes("image")) || (explicitImageGeneration == null && isImageGenerationModel(`${id} ${name}`)),
      ...(item.description ? { description: item.description } : {}),
    };
  }).filter((item) => item.id);
}


function chatModel(value) {
  const requested = typeof value === "string" && value.trim() ? value.trim() : "gemini-3.8-flash";
  const model = requested === "neural-flash-3.8" ? "gemini-3.8-flash" : requested;
  if (model.length > 160 || !/^[A-Za-z0-9._:/-]+$/.test(model)) throw Object.assign(new Error("model không hợp lệ"), { code: "BAD_REQUEST", field: "model" });
  return model;
}
function chatModelSource(value) {
  const source = value == null ? "quota" : value;
  if (source !== "quota" && source !== "omp") throw Object.assign(new Error("modelSource phải là quota hoặc omp"), { code: "BAD_REQUEST", field: "modelSource" });
  return source;
}

function chatModelProvider(value) {
  if (value == null) return null;
  if (typeof value !== "string" || !value.trim() || value.length > 160) throw Object.assign(new Error("modelProvider không hợp lệ"), { code: "BAD_REQUEST", field: "modelProvider" });
  return value.trim();
}


function chatThinking(value) {
  const thinking = typeof value === "string" ? value.trim().slice(0, 32) : "";
  if (thinking && !OMP_THINKING_LEVELS.has(thinking)) throw Object.assign(new Error("thinking không hợp lệ"), { code: "BAD_REQUEST", field: "thinking" });
  return thinking;
}

function browserMode(value) {
  const mode = typeof value === "string" && value.trim() ? value.trim() : "none";
  if (!OMP_BROWSER_MODE_IDS.has(mode)) throw Object.assign(new Error("browserMode không hợp lệ"), { code: "BAD_REQUEST", field: "browserMode" });
  const definition = OMP_BROWSER_MODES.find((item) => item.id === mode);
  if (definition?.status === "unavailable") throw Object.assign(new Error(`Browser mode chưa khả dụng: ${mode}`), { code: "CONFLICT", field: "browserMode" });
  return mode;
}

function browserPrompt(prompt, mode, hasImages = false) {
  // OMP expands /skill prompts into a custom message, which cannot carry ACP image blocks.
  if (hasImages || mode !== "ego-browser" || /^\/skill:ego-browser(?:\s|$)/i.test(prompt)) return prompt;
  return `/skill:ego-browser\n\n${prompt}`;
}

async function validateChatModel(model, requestedProvider = null) {
  const provider = chatModelProvider(requestedProvider);
  const models = await availableModels();
  const selected = models.find((item) => item.id === model && (!provider || item.provider === provider));
  if (!selected) throw Object.assign(new Error(`Model không tồn tại trong OMP: ${model}`), { code: "MODEL_NOT_FOUND", field: "model" });
  return { model: selected, models };
}

function normalizeChatModel(model, models, modelSource) {
  if (modelSource !== "omp" || String(model.provider || "").toLowerCase() !== "google" || !isGeminiModel(model)) return model;
  return models.find((item) => item.id === model.id && item.provider === LOGIN_PROVIDER)
    || models.find((item) => item.id === model.id.replace(/-preview$/i, "") && item.provider === LOGIN_PROVIDER)
    || model;
}

async function resolveChatModel(modelId, modelSource, modelProvider, sessionId, prompt = "") {
  const { model: catalogModel, models } = await validateChatModel(modelId, modelProvider);
  const model = normalizeChatModel(catalogModel, models, modelSource);
  const requestedModel = modelSource === "quota"
    ? await assertQuotaModelAllowed(modelId, models, modelProvider, sessionId)
    : await assertGoogleQuotaModelAllowed(model, models, modelProvider, sessionId);
  return { requestedModel, model: imageGenerationModelForPrompt(prompt, requestedModel, models) };
}

async function assertQuotaModelAllowed(modelId, models = null, requestedProvider = null, sessionId = null) {
  const catalog = models || await availableModels();
  const model = catalog.find((item) => item.id === modelId && (!requestedProvider || item.provider === requestedProvider));
  if (!model) throw Object.assign(new Error(`Model không tồn tại trong OMP: ${modelId}`), { code: "MODEL_NOT_FOUND", field: "model" });
  const { account, availability } = await selectedGeminiAccountState(sessionId);
  if (!availability.canUse) throw Object.assign(new Error(availability.reason), { code: "ACCOUNT_UNAVAILABLE", field: "accountId" });
  const selected = quotaProviderModels(account.provider, catalog).find((item) => item.id === modelId && (!requestedProvider || item.provider === requestedProvider));
  if (!selected) {
    throw Object.assign(new Error(`Model "${modelId}" không thuộc danh mục Google Antigravity của account đang chọn.`), { code: "MODEL_NOT_ALLOWED_BY_QUOTA", field: "model" });
  }
  return selected;
}

async function assertGoogleQuotaModelAllowed(model, models, requestedProvider, sessionId = null) {
  if (!isQuotaGoogleChatModel(model)) return model;
  const { account, availability } = await selectedGeminiAccountState(sessionId);
  if (!availability.canUse) throw Object.assign(new Error(availability.reason), { code: "ACCOUNT_UNAVAILABLE", field: "accountId" });
  const selected = quotaProviderModels(account.provider, models)
    .find((item) => item.id === model.id && item.provider === model.provider);
  if (!selected) {
    throw Object.assign(new Error(`Model "${model.id}" không thuộc danh mục Google Antigravity của account đang chọn.`), { code: "MODEL_NOT_ALLOWED_BY_QUOTA", field: "model" });
  }
  return selected;
}

function applyChatModel(record, model) {
  consoleBridge.send(record.contextId, { id: `model-${Date.now()}`, type: "set_model", provider: model.provider, modelId: model.id });
  return model.id;
}

function observeChatRequest(requestId, sessionId, startedAt, status, error, timings) {
  const record = { requestId, sessionId, status, durationMs: Math.max(0, Date.now() - startedAt) };
  if (error) record.errorCode = error.code || "INTERNAL_SERVER_ERROR";
  if (timings) Object.assign(record, timings);
  console.info(`[chat-request] ${JSON.stringify(record)}`);
}

function shortAge(timestamp, now = Date.now()) {
  const age = Math.max(0, now - new Date(timestamp).getTime());
  const minutes = Math.floor(age / 60000);
  if (minutes < 60) return `${minutes}p`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}g${minutes % 60 ? ` ${minutes % 60}p` : ""}`;
  const days = Math.floor(hours / 24);
  return `${days}n${hours % 24 ? ` ${hours % 24}g` : ""}`;
}

function chatMessageText(message) {
  return messageText(message) || (typeof message?.text === "string" ? message.text.trim() : "");
}

function chatBodyValue(value, depth = 0) {
  if (value == null) return value;
  if (depth >= MAX_CHAT_BODY_VALUE_DEPTH) return "[…]";
  if (typeof value === "string") return value.slice(0, MAX_CHAT_BODY_TEXT_CHARS);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 64).map((item) => chatBodyValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 64).map(([key, item]) => [key.slice(0, 120), chatBodyValue(item, depth + 1)]));
  }
  return String(value).slice(0, MAX_CHAT_BODY_TEXT_CHARS);
}

function chatBodyText(value, depth = 0) {
  if (value == null || depth > MAX_CHAT_BODY_VALUE_DEPTH) return "";
  if (typeof value === "string") return value.slice(0, MAX_CHAT_BODY_TEXT_CHARS);
  if (Array.isArray(value)) {
    return value.map((item) => chatBodyText(item, depth + 1)).filter(Boolean).join("\n").slice(0, MAX_CHAT_BODY_TEXT_CHARS);
  }
  if (typeof value !== "object") return "";
  for (const key of ["text", "thinking", "description", "message", "content", "output", "result", "partialResult", "errorMessage"]) {
    if (value[key] == null) continue;
    const text = chatBodyText(value[key], depth + 1);
    if (text) return text;
  }
  return "";
}

function chatBodyTimestamp(value) {
  const parsed = typeof value === "number" ? value : Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function chatTodoItems(value) {
  const source = Array.isArray(value)
    ? value
    : Array.isArray(value?.todos)
      ? value.todos
      : Array.isArray(value?.phases)
        ? value.phases.flatMap((phase) => (Array.isArray(phase?.tasks) ? phase.tasks.map((task) => ({ ...task, phase: phase.name })) : []))
        : [];
  return source
    .filter((item) => item && typeof item === "object" && typeof item.content === "string" && item.content.trim())
    .slice(0, 128)
    .map((item) => ({
      content: item.content.trim().slice(0, 500),
      status: ["pending", "in_progress", "completed", "abandoned", "blocked"].includes(item.status) ? item.status : "pending",
      ...(typeof item.phase === "string" && item.phase.trim() ? { phase: item.phase.trim().slice(0, 160) } : {}),
      ...(typeof item.blocker === "string" && item.blocker.trim() ? { blocker: item.blocker.trim().slice(0, 500) } : {}),
    }));
}

function chatBodyBlock(kind, id, title, fields = {}) {
  const block = {
    id: String(id || `${kind}-${Date.now()}`).slice(0, 240),
    kind,
    title: String(title || kind).slice(0, 160),
    createdAt: chatBodyTimestamp(fields.createdAt),
  };
  for (const key of ["status", "text", "toolCallId", "toolName", "intent", "command", "level", "source", "phase", "attempt", "maxAttempts"]) {
    if (fields[key] !== undefined && fields[key] !== null && fields[key] !== "") block[key] = typeof fields[key] === "string" ? fields[key].slice(0, MAX_CHAT_BODY_TEXT_CHARS) : fields[key];
  }
  if (fields.items?.length) block.items = fields.items;
  if (fields.args !== undefined) block.args = chatBodyValue(fields.args);
  if (fields.result !== undefined) block.result = chatBodyValue(fields.result);
  if (fields.goal !== undefined) block.goal = chatBodyValue(fields.goal);
  if (fields.appendText) block.appendText = true;
  return block;
}

function chatBodyBlocksFromMessage(message, idPrefix = "message") {
  if (!message || typeof message !== "object") return [];
  const createdAt = message.completedAt || message.timestamp;
  if (message.role === "assistant") {
    return (Array.isArray(message.content) ? message.content : [])
      .flatMap((block, index) => {
        if (block?.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim()) {
          return [chatBodyBlock("thinking", `${idPrefix}:thinking:${index}`, "Suy luận", { status: "done", text: block.thinking, createdAt })];
        }
        if (block?.type === "toolCall" && block.id && block.name) {
          return [chatBodyBlock("tool", `tool:${block.id}`, `Tool · ${block.name}`, {
            status: "done",
            toolCallId: block.id,
            toolName: block.name,
            intent: block.intent,
            args: block.arguments,
            createdAt,
          })];
        }
        return [];
      });
  }
  if (message.role !== "toolResult") return [];
  const toolCallId = String(message.toolCallId || `result-${createdAt || Date.now()}`);
  const text = chatBodyText(message.content) || chatBodyText(message.details);
  const blocks = [chatBodyBlock("tool_result", `tool-result:${toolCallId}`, `Kết quả · ${message.toolName || "tool"}`, {
    status: message.isError ? "error" : "done",
    toolCallId,
    toolName: message.toolName,
    text,
    result: message.details,
    createdAt,
  })];
  const items = chatTodoItems(message.details);
  if (items.length) blocks.push(chatBodyBlock("todo", `todo:${toolCallId}`, "Todo", { status: "done", items, createdAt }));
  return blocks;
}

function chatBodyBlocksFromFrame(frame, requestId, sequence) {
  if (!frame || typeof frame !== "object") return [];
  const createdAt = frame.timestamp || frame.message?.completedAt || frame.message?.timestamp;
  const update = frame.assistantMessageEvent;
  if (frame.type === "message_update" && update?.type?.startsWith("thinking_")) {
    const id = `${requestId}:thinking:${Number.isFinite(Number(update.contentIndex)) ? update.contentIndex : 0}`;
    const fields = { status: update.type === "thinking_end" ? "done" : "running", text: update.type === "thinking_delta" ? update.delta : update.content, createdAt };
    if (update.type === "thinking_delta") fields.appendText = true;
    return [chatBodyBlock("thinking", id, "Suy luận", fields)];
  }
  if (frame.type === "message_update" && update?.type === "toolcall_end" && update.toolCall) {
    const call = update.toolCall;
    return [chatBodyBlock("tool", `tool:${call.id}`, `Tool · ${call.name || "tool"}`, { status: "done", toolCallId: call.id, toolName: call.name, args: call.arguments, intent: call.intent, createdAt })];
  }
  if (frame.type === "message_update" && update?.type === "toolcall_delta") {
    const contentIndex = Number.isFinite(Number(update.contentIndex)) ? Number(update.contentIndex) : -1;
    const partialContent = contentIndex >= 0 && Array.isArray(update.partial?.content) ? update.partial.content[contentIndex] : null;
    const toolCallId = String(update.toolCallId || partialContent?.id || "").trim();
    if (!toolCallId) return [];
    return [chatBodyBlock("tool", `tool:${toolCallId}`, `Tool · ${partialContent?.name || "tool"}`, {
      status: "running",
      toolCallId,
      toolName: partialContent?.name,
      args: partialContent?.arguments,
      text: update.delta,
      createdAt,
      appendText: true,
    })];
  }
  if (frame.type === "tool_execution_start" || frame.type === "tool_execution_update" || frame.type === "tool_stream_update" || frame.type === "tool_execution_end") {
    const title = `Tool · ${frame.toolName || "tool"}`;
    const status = frame.type === "tool_execution_end" ? (frame.isError ? "error" : "done") : "running";
    const text = frame.type === "tool_execution_start" ? frame.intent : frame.type === "tool_execution_update" ? chatBodyText(frame.partialResult) : chatBodyText(frame.result ?? frame.update);
    return [chatBodyBlock("tool", `tool:${frame.toolCallId || `${requestId}:${sequence}`}`, title, {
      status,
      toolCallId: frame.toolCallId,
      toolName: frame.toolName,
      intent: frame.intent,
      args: frame.args,
      text,
      result: frame.result ?? frame.partialResult ?? frame.update,
      createdAt,
    })];
  }
  if (frame.type === "message_end") return chatBodyBlocksFromMessage(frame.message, requestId);
  if (frame.type === "todo_reminder") {
    const items = chatTodoItems(frame.todos);
    return items.length ? [chatBodyBlock("todo", `${requestId}:todo:${sequence}`, "Todo", { status: "running", items, attempt: frame.attempt, maxAttempts: frame.maxAttempts, createdAt })] : [];
  }
  if (frame.type === "todo_auto_clear") return [chatBodyBlock("todo", `${requestId}:todo:${sequence}`, "Todo", { status: "done", text: "OMP đã hoàn tất danh sách todo.", createdAt })];
  if (frame.type === "goal_updated") return [chatBodyBlock("goal", `${requestId}:goal:${sequence}`, "Mục tiêu", { status: frame.goal ? "running" : "done", goal: frame.goal, text: chatBodyText(frame.goal) || "OMP đã cập nhật mục tiêu.", createdAt })];
  if (frame.type === "notice") return [chatBodyBlock("notice", `${requestId}:notice:${sequence}`, "Thông báo OMP", { status: frame.level || "info", level: frame.level, source: frame.source, text: frame.message, createdAt })];
  if (frame.type === "command_output") {
    const output = frameCommandOutput(frame);
    return [chatBodyBlock("command", `${requestId}:command:${sequence}`, "Command output", { status: "done", command: output.command, text: output.text, createdAt })];
  }
  if (frame.type === "extension_ui_request") return [chatBodyBlock("approval", `${requestId}:approval:${frame.id || sequence}`, frame.title || "OMP cần xác nhận", { status: "running", text: frame.message, source: frame.method, createdAt })];
  if (frame.type === "auto_compaction_start") return [chatBodyBlock("compaction", `${requestId}:compaction:${sequence}`, "OMP đang compact context", { status: "running", text: `${frame.reason || "auto"} · ${frame.action || ""}`.trim(), createdAt })];
  if (frame.type === "auto_compaction_end") return [chatBodyBlock("compaction", `${requestId}:compaction:${sequence}`, "OMP compact context", { status: frame.aborted || frame.errorMessage ? "error" : "done", text: frame.errorMessage || (frame.skipped ? "OMP bỏ qua compact context." : "OMP đã compact context."), createdAt })];
  if (frame.type === "auto_retry_start") return [chatBodyBlock("retry", `${requestId}:retry:${sequence}`, "OMP retry", { status: "running", attempt: frame.attempt, maxAttempts: frame.maxAttempts, text: frame.errorMessage, createdAt })];
  if (frame.type === "auto_retry_end") return [chatBodyBlock("retry", `${requestId}:retry:${sequence}`, "OMP retry", { status: frame.success ? "done" : "error", attempt: frame.attempt, text: frame.finalError || (frame.success ? "Retry thành công." : "Retry thất bại."), createdAt })];
  if (["agent_start", "turn_start", "turn_end", "agent_end"].includes(frame.type)) {
    const terminal = frame.type === "agent_end" ? frame.isTerminal !== false : undefined;
    return [chatBodyBlock("status", `${requestId}:status:${frame.type}:${sequence}`, "Trạng thái OMP", { status: terminal === false ? "running" : "done", text: frame.type === "agent_end" ? (terminal === false ? "OMP tiếp tục xử lý." : "OMP đã kết thúc lượt.") : frame.type.replaceAll("_", " "), createdAt })];
  }
  return [];
}

function mergeChatBodyBlock(list, block) {
  if (!block) return null;
  const index = list.findIndex((item) => item.id === block.id);
  if (index < 0) {
    const next = [...list, block].slice(-MAX_CHAT_BODY_BLOCKS);
    list.splice(0, list.length, ...next);
    return block;
  }
  const previous = list[index];
  const merged = {
    ...previous,
    ...block,
    ...(block.appendText ? { text: `${previous.text || ""}${block.text || ""}`.slice(0, MAX_CHAT_BODY_TEXT_CHARS) } : {}),
  };
  delete merged.appendText;
  list[index] = merged;
  return merged;
}

function mergeChatBodyBlocks(...values) {
  const merged = [];
  for (const value of values) {
    for (const block of Array.isArray(value) ? value : []) mergeChatBodyBlock(merged, block);
  }
  return merged;
}

function chatBodyBlocksFromRecord(sessionId, record) {
  if (!record || typeof record !== "object") return [];
  if (record.type === "message") return chatBodyBlocksFromMessage(record.message, record.id || `${sessionId}-${record.timestamp || Date.now()}`);
  if (record.type === "custom_message") {
    const content = chatBodyText(record.content);
    if (!content || record.display === false) return [];
    return [chatBodyBlock("notice", `${record.id || `${sessionId}-${record.timestamp || Date.now()}`}:custom`, record.customType || "OMP message", { status: "info", text: content, createdAt: record.timestamp })];
  }
  return [];
}

function chatFrameFailure(frame) {
  const message = frame?.message && typeof frame.message === "object" ? frame.message : {};
  const error = frame?.error && typeof frame.error === "object" ? frame.error : {};
  const errorMessage = String(message.errorMessage || error.message || frame?.errorMessage || "").trim();
  const errorStatus = Number(message.errorStatus ?? error.status ?? frame?.errorStatus);
  const stopReason = message.stopReason || frame?.stopReason;
  if (stopReason !== "error" && !errorMessage && !Number.isFinite(errorStatus)) return null;
  const rateLimited = errorStatus === 429 || /429|resource[_ ]exhausted|quota|rate limit/i.test(errorMessage);
  const verificationRequired = errorStatus === 403 || /account verification required/i.test(errorMessage);
  return {
    code: verificationRequired ? "ACCOUNT_VERIFICATION_REQUIRED" : rateLimited ? "RATE_LIMITED" : "UPSTREAM_ERROR",
    message: verificationRequired ? "Tài khoản Google đang chọn cần xác minh lại trước khi tạo ảnh." : rateLimited ? "Model đang hết quota hoặc bị giới hạn tạm thời; hãy chọn model khác hoặc thử lại sau." : "Yêu cầu không thành công.",
  };
}

function chatCustomUserContent(record) {
  if (record?.type !== "custom_message" || record?.attribution !== "user" || typeof record?.content !== "string") return "";
  let content = record.content.trim();
  const marker = content.match(/(?:^|\n)User:\s*([\s\S]*)$/);
  if (marker) content = marker[1].trim();
  const attachmentMarker = content.indexOf("\n\n[Attached file:");
  return (attachmentMarker >= 0 ? content.slice(0, attachmentMarker) : content).trim();
}

function chatMessageFromRecord(sessionId, record) {
  const customContent = chatCustomUserContent(record);
  const message = customContent
    ? { role: "user", content: customContent }
    : record.message || {};
  if (!["user", "assistant", "system"].includes(message.role)) return null;
  const content = chatMessageText(message);
  const attachments = chatMessageAttachments(message);
  const body = chatBodyBlocksFromMessage(message, record.id || `${sessionId}-${record.timestamp || Date.now()}`);
  if (!content && !attachments.length && !body.length) return null;
  const createdAt = record.timestamp || message.completedAt || message.timestamp || new Date().toISOString();
  return {
    id: record.id || `${sessionId}-${createdAt}`,
    sessionId,
    role: message.role,
    content,
    ...(body.length ? { body } : {}),
    ...(attachments.length ? { attachments } : {}),
    timeAgo: shortAge(createdAt),
    ...(message.model ? { model: message.model } : {}),
    ...(message.duration ? { duration: `${Math.max(0, Number(message.duration) || 0)}s` } : {}),
    createdAt: new Date(createdAt).toISOString(),
  };
}


function chatSessionTitle(content) {
  const lines = String(content || "").split(/\r?\n/).map((line) => line.replace(/^\s*#+\s*/, "").trim()).filter(Boolean);
  const title = (lines.find((line) => !/^instructions?\b/i.test(line)) || lines[0] || "").replace(/\s+/g, " ").trim();
  return title.length > 72 ? `${title.slice(0, 69).trim()}…` : title;
}


async function persistedChatSessionPath(sessionId) {
  const cached = chatSessionMeta.get(sessionId);
  const metadata = cached?.path ? cached : (await readChatMetadata()).sessions[sessionId];
  if (metadata?.path && withinRoot(OMP_SESSION_ROOT, metadata.path)) {
    try { await stat(metadata.path); return metadata.path; } catch {}
  }
  try { return await findSessionPath(sessionId); }
  catch { throw new Error("Không tìm thấy session OMP"); }
}

function chatMediaFile(sessionId) {
  const key = createHash("sha256").update(String(sessionId || "")).digest("hex").slice(0, 32);
  return join(CHAT_MEDIA_ROOT, `${key}.json`);
}

function chatMessageSignature(message) {
  return createHash("sha256").update(`${message?.role || ""}\0${chatMessageText(message)}`).digest("hex");
}

async function readChatMediaEntries(sessionId) {
  await chatMediaWrite.catch(() => {});
  try {
    const parsed = JSON.parse(await readFile(chatMediaFile(sessionId), "utf8"));
    return Array.isArray(parsed?.entries) ? parsed.entries.slice(-MAX_CHAT_MEDIA_MESSAGES) : [];
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return [];
    throw error;
  }
}

function applyChatMediaEntries(messages, entries) {
  const used = new Set();
  for (const message of messages) {
    const exact = entries.findIndex((entry, index) => !used.has(index) && entry?.messageId === message.id);
    let matchIndex = exact;
    if (matchIndex < 0) {
      const messageTime = new Date(message.createdAt || 0).getTime();
      matchIndex = entries.reduce((best, entry, index) => {
        if (used.has(index) || entry?.role !== message.role || entry?.signature !== chatMessageSignature(message)) return best;
        const distance = Math.abs(new Date(entry.createdAt || 0).getTime() - messageTime);
        return distance <= 30000 && (!best || distance < best.distance) ? { index, distance } : best;
      }, null)?.index ?? -1;
    }
    if (matchIndex < 0) continue;
    const entry = entries[matchIndex];
    used.add(matchIndex);
    const attachments = mergeChatAttachments(message.attachments, entry.attachments);
    if (attachments.length) message.attachments = attachments;
  }
  return messages;
}

function persistChatMessageMedia(sessionId, message) {
  const attachments = normalizeChatAttachments(message?.attachments);
  if (!attachments.length) return;
  const entry = {
    messageId: String(message.id || ""),
    role: message.role,
    signature: chatMessageSignature(message),
    createdAt: message.createdAt || new Date().toISOString(),
    attachments,
  };
  chatMediaWrite = chatMediaWrite.catch(() => {}).then(async () => {
    await mkdir(CHAT_MEDIA_ROOT, { recursive: true, mode: 0o700 });
    let entries = [];
    try {
      const parsed = JSON.parse(await readFile(chatMediaFile(sessionId), "utf8"));
      entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    entries = [...entries.filter((item) => item?.messageId !== entry.messageId), entry].slice(-MAX_CHAT_MEDIA_MESSAGES);
    const file = chatMediaFile(sessionId);
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, entries }), { mode: 0o600 });
    await rename(temporary, file);
  }).catch(() => {});
}

function mergePersistedAssistantMessage(previous, next) {
  const body = mergeChatBodyBlocks(previous.body, next.body);
  const attachments = mergeChatAttachments(previous.attachments, next.attachments);
  const content = [previous.content, next.content].filter((value) => String(value || "").trim()).join("\n\n");
  return {
    ...previous,
    ...next,
    id: previous.id,
    content,
    ...(body.length ? { body } : {}),
    ...(attachments.length ? { attachments } : {}),
    timeAgo: shortAge(previous.createdAt || next.createdAt),
    createdAt: previous.createdAt || next.createdAt,
  };
}

async function readPersistedChatSession(sessionId) {
  const file = await persistedChatSessionPath(sessionId);
  const lines = (await readFile(file, "utf8")).split("\n").filter(Boolean);
  const records = [];
  let pendingBody = [];
  let session = null;
  let title = "";
  let nativeModel = null;
  let nativeThinkingLevel = null;
  const attachBody = (body, toolCallId = "") => {
    if (!body.length) return true;
    const target = [...records].reverse().find((item) => item.role === "assistant"
      && (!toolCallId || item.body?.some((block) => block.toolCallId === toolCallId)));
    if (!target) return false;
    target.body = mergeChatBodyBlocks(target.body, body);
    return true;
  };
  for (const line of lines) {
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    if (record.type === "session") session = record;
    if (record.type === "title" && typeof record.title === "string" && record.title.trim()) title = record.title.trim();
    if (record.type === "model_change" && typeof record.model === "string") nativeModel = record.model;
    if (record.type === "thinking_level_change" && typeof record.thinkingLevel === "string") nativeThinkingLevel = record.thinkingLevel;
    if (record.type !== "message" && record.type !== "custom_message") continue;
    const rawMessage = record.message || {};
    const body = chatBodyBlocksFromRecord(sessionId, record);
    if (rawMessage.role === "toolResult") {
      const toolCallId = String(rawMessage.toolCallId || "");
      if (!attachBody(body, toolCallId)) pendingBody = mergeChatBodyBlocks(pendingBody, body);
      continue;
    }
    const message = chatMessageFromRecord(sessionId, record);
    if (message) {
      if (message.role === "assistant" && pendingBody.length) {
        message.body = mergeChatBodyBlocks(pendingBody, message.body);
        pendingBody = [];
      }
      const previous = records.at(-1);
      if (message.role === "assistant" && previous?.role === "assistant") {
        records[records.length - 1] = mergePersistedAssistantMessage(previous, message);
      } else {
        records.push(message);
      }
    } else if (body && !attachBody(body)) {
      pendingBody = mergeChatBodyBlocks(pendingBody, body);
    }
  }
  applyChatMediaEntries(records, await readChatMediaEntries(sessionId));
  const metadata = await readChatMetadata();
  const stored = metadata.sessions[sessionId] || {};
  const cached = chatSessionMeta.get(sessionId) || {};
  const source = { ...stored, ...cached };
  const owners = Object.entries(metadata.sessions).filter(([, value]) => value?.path === file).map(([id]) => id);
  const headerMatches = session?.id === sessionId || (source.ompSessionId && session?.id === source.ompSessionId);
  const trustedAlias = owners.length === 1 && owners[0] === sessionId;
  const trustedCachedPath = owners.length === 0 && cached.path === file;
  const sourceMismatch = () => Object.assign(new Error("Không tìm thấy session OMP"), { code: "NOT_FOUND", sourceMismatch: true });
  if (!session || (!headerMatches && !trustedAlias && !trustedCachedPath)) throw sourceMismatch();
  if (source.cwd && session.cwd) {
    const expectedCwd = await realpath(source.cwd).catch(() => null);
    const transcriptCwd = await realpath(session.cwd).catch(() => null);
    if (expectedCwd && transcriptCwd && expectedCwd !== transcriptCwd) throw sourceMismatch();
  }
  const createdAt = session?.timestamp || records[0]?.createdAt || new Date().toISOString();
  const updatedAt = records.at(-1)?.createdAt || session?.timestamp || createdAt;
  return {
    id: sessionId,
    ompSessionId: session.id,
    path: file,
    cwd: session?.cwd || process.cwd(),
    title: title || chatSessionTitle(records.find((item) => item.role === "user")?.content) || "Phiên làm việc mới",
    createdAt,
    updatedAt,
    messages: records,
    nativeState: {
      settingsSource: "omp",
      status: "offline",
      protocolVersion: null,
      activeTurn: false,
      queuedTurns: 0,
      model: nativeModel,
      thinkingLevel: nativeThinkingLevel,
      messageCount: records.length,
    },
  };
}
async function migratePersistedChatCwd(persisted, cwd) {
  if (!persisted?.path || !persisted.cwd || persisted.cwd === cwd) return persisted;
  if (!withinRoot(OMP_SESSION_ROOT, persisted.path)) throw new Error("Đường dẫn session không hợp lệ");
  const text = await readFile(persisted.path, "utf8");
  const lines = text.split("\n");
  const index = lines.findIndex((line) => {
    if (!line) return false;
    try { return JSON.parse(line).type === "session"; } catch { return false; }
  });
  if (index < 0) throw new Error("Session OMP thiếu metadata session");
  const session = JSON.parse(lines[index]);
  lines[index] = JSON.stringify({ ...session, cwd });
  await writeFile(persisted.path, lines.join("\n"), { mode: 0o600 });
  return { ...persisted, cwd };
}

function chatSessionView(session) {
  const updatedAt = session.updatedAt || session.createdAt || new Date().toISOString();
  const folderId = typeof session.folderId === "string" && session.folderId ? session.folderId : "";
  const folderName = typeof session.folderName === "string" && session.folderName ? session.folderName : "";
  return {
    id: session.id,
    ...(typeof session.cwd === "string" && session.cwd ? { cwd: session.cwd } : {}),
    title: session.title || "Phiên làm việc mới",
    ...(Number.isFinite(Number(session.messageCount)) ? { messageCount: Number(session.messageCount), hasMessages: Number(session.messageCount) > 0 } : {}),
    isPinned: Boolean(session.isPinned),
    isUnread: Boolean(session.isUnread),
    ...(Array.isArray(session.tools) ? { tools: session.tools } : {}),
    ...(folderId ? { folderId } : {}),
    ...(folderName ? { folderName } : {}),
    updatedAgo: shortAge(updatedAt),
    createdAt: new Date(session.createdAt || updatedAt).toISOString(),
    updatedAt: new Date(updatedAt).toISOString(),
  };
}

function chatSessionFolderFields(metadata, stored, cached) {
  if (hasSessionFolderMetadata(stored)) return sessionFolderFields(metadata, stored);
  if (hasSessionFolderMetadata(cached)) return sessionFolderFields(metadata, cached);
  return {};
}

async function listChatSessions() {
  const result = await Promise.race([
    consoleBridge.listSessions(),
    new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("OMP session catalog không phản hồi trong 8 giây"), { code: "UPSTREAM_TIMEOUT" })), 8000)),
  ]);
  const metadata = await readChatMetadata();
  const aliasesByPath = new Map(Object.entries(metadata.sessions)
    .filter(([, value]) => value?.path && withinRoot(OMP_SESSION_ROOT, value.path))
    .map(([id, value]) => [value.path, id]));
  const aliasesByOmpSessionId = new Map(Object.entries(metadata.sessions)
    .filter(([, value]) => typeof value?.ompSessionId === "string" && value.ompSessionId)
    .map(([id, value]) => [value.ompSessionId, id]));
  const summaryTargets = (result.sessions || []).filter((item) => Number(item._meta?.messageCount) > 0).slice(0, 20);
  const summaries = new Map((await Promise.all(summaryTargets.map(async (item) => {
    const persisted = await readPersistedChatSession(item.sessionId).catch(() => null);
    if (!persisted) return null;
    const current = chatSessionMeta.get(item.sessionId) || {};
    chatSessionMeta.set(item.sessionId, { ...current, path: persisted.path, title: current.title || persisted.title, messageCount: persisted.messages.length, createdAt: current.createdAt || persisted.createdAt, updatedAt: current.updatedAt || persisted.updatedAt });
    return [item.sessionId, persisted];
  }))).filter(Boolean));
  const sessions = [];
  const represented = new Set();
  for (const item of result.sessions || []) {
    if (String(item.sessionId || "").startsWith("models-")) continue;
    const persisted = summaries.get(item.sessionId);
    const displayId = aliasesByPath.get(persisted?.path) || aliasesByOmpSessionId.get(item.sessionId) || item.sessionId;
    const cached = chatSessionMeta.get(displayId) || chatSessionMeta.get(item.sessionId);
    const stored = metadata.sessions[displayId] || metadata.sessions[item.sessionId] || {};
    const updatedAt = item.updatedAt || cached?.updatedAt || new Date().toISOString();
    const counts = [item._meta?.messageCount, stored.messageCount, cached?.messageCount, persisted?.messages?.length]
      .map(Number).filter(Number.isFinite);
    const messageCount = counts.length ? Math.max(...counts) : undefined;
    if (stored.deleted || stored.archived) continue;
    sessions.push(chatSessionView({
      id: displayId,
      ...stored,
      ...chatSessionFolderFields(metadata, stored, cached),
      title: stored.title || cached?.title || persisted?.title || item.title || "Phiên làm việc mới",
      messageCount,
      createdAt: cached?.createdAt || stored.createdAt || persisted?.createdAt || updatedAt,
      updatedAt: cached?.updatedAt || stored.updatedAt || persisted?.updatedAt || updatedAt,
    }));
    represented.add(displayId);
  }
  for (const id of [...gatewaySessions.keys()]) {
    const record = liveGatewayRecord(id);
    if (!record) continue;
    if (represented.has(record.sessionId)) continue;
    const cached = chatSessionMeta.get(record.sessionId);
    const stored = metadata.sessions[record.sessionId] || {};
    const meta = {
      ...cached,
      ...stored,
      ...chatSessionFolderFields(metadata, stored, cached),
      id: record.sessionId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
    if (meta.deleted || meta.archived) continue;
    sessions.push(chatSessionView(meta));
    represented.add(record.sessionId);
  }
  for (const [id, stored] of Object.entries(metadata.sessions)) {
    if (represented.has(id) || stored.deleted || stored.archived) continue;
    const cached = chatSessionMeta.get(id);
    const cacheCount = chatMessageCache.get(id)?.length || 0;
    const live = liveGatewayRecord(id);
    const messageCount = Math.max(Number(stored.messageCount) || 0, Number(cached?.messageCount) || 0, cacheCount);
    if (!messageCount || (!live && !stored.path && !cached?.path && !stored.ompSessionId && !cacheCount)) continue;
    sessions.push(chatSessionView({
      id,
      ...cached,
      ...stored,
      ...chatSessionFolderFields(metadata, stored, cached),
      messageCount,
      createdAt: cached?.createdAt || stored.createdAt || Date.now(),
      updatedAt: cached?.updatedAt || stored.updatedAt || Date.now(),
    }));
    represented.add(id);
  }
  return sessions.sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function waitGatewayReady(record, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const context = consoleBridge.get(record.contextId).summary();
    if (context.status === "ready") return context;
    if (context.status === "error" || context.status === "closed") throw new Error(context.lastError || "OMP context không sẵn sàng");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw Object.assign(new Error("OMP context khởi động quá thời gian cho phép"), { code: "UPSTREAM_UNAVAILABLE" });
}

async function ensureChatSession(sessionId, body = {}, { requireExisting = false } = {}) {
  const id = gatewaySessionId(sessionId);
  const pending = gatewaySessionEnsures.get(id);
  if (pending) return pending;
  const operation = ensureChatSessionUnlocked(id, body, { requireExisting });
  gatewaySessionEnsures.set(id, operation);
  try {
    return await operation;
  } finally {
    if (gatewaySessionEnsures.get(id) === operation) gatewaySessionEnsures.delete(id);
  }
}

async function ensureChatSessionUnlocked(sessionId, body = {}, { requireExisting = false } = {}) {
  const id = gatewaySessionId(sessionId);
  const metadata = await readChatMetadata();
  const stored = metadata.sessions[id] || {};
  if (stored.deleted || stored.archived) throw Object.assign(new Error("Session đã được lưu trữ hoặc xoá"), { code: "NOT_FOUND" });
  let record = liveGatewayRecord(id);
  let persisted = null;
  if (!record) {
    try { persisted = await readPersistedChatSession(id); } catch (error) {
      if (error.message !== "Không tìm thấy session OMP") throw error;
    }
  }
  if (requireExisting && !record && !persisted && !Object.hasOwn(metadata.sessions, id)) {
    throw Object.assign(new Error("Session không tồn tại"), { code: "NOT_FOUND" });
  }
  const hasBrowserMode = typeof body.browserMode === "string";
  const selectedBrowserMode = hasBrowserMode ? browserMode(body.browserMode) : null;
  const useSkillBrowser = selectedBrowserMode === "ego-browser";
  const requestedApprovalMode = body.approvalMode ? approvalMode(body.approvalMode) : null;
  const selectedApprovalMode = requestedApprovalMode || record?.approvalMode || approvalMode(stored.approvalMode);
  const requestedTools = hasBrowserMode && useSkillBrowser
    ? null
    : body.tools == null
      ? (hasBrowserMode && record?.tools == null ? await headlessTools(selectedApprovalMode, await selectedOmpTools(stored.tools)) : null)
      : await headlessTools(selectedApprovalMode, await selectedOmpTools(body.tools));
  const browserContextChanged = Boolean(record && hasBrowserMode && ((useSkillBrowser && record.tools !== null) || (!useSkillBrowser && record.tools === null)));
  if (record && ((requestedApprovalMode && record.approvalMode !== requestedApprovalMode) || (requestedTools && JSON.stringify(record.tools || []) !== JSON.stringify(requestedTools)) || browserContextChanged) && !contextHasChatWork(record.contextId)) {
    await consoleBridge.stop(record.contextId);
    gatewaySessions.delete(id);
    record = null;
  }
  let effectiveCwd = persisted?.cwd || stored.cwd || body.cwd || DEFAULT_CHAT_CWD;
  let migratedLegacyCwd = false;
  if (!record) {
    const gatewayOptions = () => ({
      sessionId: id,
      cwd: effectiveCwd,
      approvalMode: selectedApprovalMode,
      ...(hasBrowserMode ? { browserMode: selectedBrowserMode } : {}),
      tools: requestedTools ?? stored.tools,
      ...((persisted?.ompSessionId || stored.ompSessionId) ? { ompSessionId: persisted?.ompSessionId || stored.ompSessionId } : {}),
    });
    try {
      await createGatewaySession(gatewayOptions());
    } catch (error) {
      const canMigrateLegacyCwd = Boolean(
        persisted?.cwd && (error?.field === "cwd" || error?.code === "FORBIDDEN")
      );
      if (!canMigrateLegacyCwd || effectiveCwd === DEFAULT_CHAT_CWD) throw error;
      effectiveCwd = DEFAULT_CHAT_CWD;
      migratedLegacyCwd = true;
      persisted = await migratePersistedChatCwd(persisted, effectiveCwd);
      await createGatewaySession(gatewayOptions());
    }
    record = liveGatewayRecord(id);
    if (persisted?.path && record.ompSessionId !== persisted.ompSessionId && !migratedLegacyCwd && !stored.cwdMigrated) {
      await queryGatewayResponse(record, { type: "switch_session", sessionPath: persisted.path });
    }
    const savedGeminiAccount = stored.geminiAccountId
      ? geminiQuotaAccounts().find((account) => quotaAccountId(account) === stored.geminiAccountId)
      : null;
    if (savedGeminiAccount) await pinGeminiSession(record, id, savedGeminiAccount);
  } else await waitGatewayReady(record);
  if (record && typeof stored.geminiAccountId === "string" && stored.geminiAccountId.trim()) {
    record.geminiAccountId = stored.geminiAccountId.trim();
  }
  if (migratedLegacyCwd) await updateChatMetadata(id, { cwd: effectiveCwd, cwdMigrated: true }, { touchUpdatedAt: false });
  const previous = chatSessionMeta.get(id) || {};
  chatSessionMeta.set(id, { ...previous, ...stored, id, path: persisted?.path || previous.path, cwdMigrated: migratedLegacyCwd || Boolean(stored.cwdMigrated), cwd: migratedLegacyCwd ? effectiveCwd : persisted?.cwd || stored.cwd || previous.cwd || body.cwd || DEFAULT_CHAT_CWD, title: previous.title || stored.title || persisted?.title || body.title || "Phiên làm việc mới", createdAt: previous.createdAt || stored.createdAt || persisted?.createdAt || record.createdAt, updatedAt: record.updatedAt });
  return record;
}

function subscribeGatewayFrames(record, onFrame) {
  const clientId = consoleBridge.createClient();
  let buffer = "";
  const sink = {
    write(chunk) {
      buffer += String(chunk || "");
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const event = block.match(/^event: ([^\n]+)/m)?.[1] || "message";
        const data = block.match(/^data: ([\s\S]*)$/m)?.[1];
        if (!data) continue;
        try { onFrame(event, JSON.parse(data)); } catch { /* ignore malformed bridge frame */ }
      }
      return true;
    },
  };
  consoleBridge.subscribe(record.contextId, clientId, sink, { replay: false });
  return () => consoleBridge.removeClient(clientId);
}

function appendChatMessage(sessionId, message) {
  const content = chatMessageText(message) || (typeof message?.content === "string" ? message.content.trim() : "");
  const attachments = normalizeChatAttachments(message?.attachments);
  const body = mergeChatBodyBlocks(message?.body);
  if (!content && !attachments.length && !body.length) return;
  const createdAt = message.createdAt || new Date().toISOString();
  const normalized = { ...message, sessionId, content, createdAt, timeAgo: shortAge(createdAt), ...(body.length ? { body } : {}), ...(attachments.length ? { attachments } : {}) };
  const list = chatMessageCache.get(sessionId) || [];
  list.push(normalized);
  const cached = list.slice(-200);
  chatMessageCache.set(sessionId, cached);
  void persistChatMessageMedia(sessionId, normalized);
  const meta = chatSessionMeta.get(sessionId) || { id: sessionId };
  const isFirstUserPrompt = message.role === "user" && !(Number(meta.messageCount) || cached.length > 1);
  const autoTitle = isFirstUserPrompt && content && (!meta.title || meta.title === "Phiên làm việc mới") ? chatSessionTitle(content) : "";
  const messageCount = Math.max(Number(meta.messageCount) || 0, cached.length);
  chatSessionMeta.set(sessionId, { ...meta, ...(autoTitle ? { title: autoTitle } : {}), updatedAt: createdAt, messageCount });
  void updateChatMetadata(sessionId, { ...(autoTitle ? { title: autoTitle } : {}), messageCount, updatedAt: createdAt }, { touchUpdatedAt: false }).catch(() => {});
}

async function chatMessages(sessionId) {
  const cached = chatMessageCache.get(sessionId) || [];
  try {
    const persisted = await readPersistedChatSession(sessionId);
    // Prefer the OMP transcript when the runtime cache contains the same turn with a new id.
    // ponytail: bounded O(n²) scan; sessions are capped at 200 cached messages.
    const merged = [...persisted.messages];
    for (const message of cached) {
      const duplicateIndex = merged.findIndex((item) => item.role === message.role
        && String(item.content || "").trim() === String(message.content || "").trim()
        && Math.abs(new Date(item.createdAt || 0).getTime() - new Date(message.createdAt || 0).getTime()) <= 5000);
      if (duplicateIndex < 0) merged.push(message);
      else {
        const attachments = mergeChatAttachments(merged[duplicateIndex].attachments, message.attachments);
        if (attachments.length) merged[duplicateIndex].attachments = attachments;
        const body = mergeChatBodyBlocks(merged[duplicateIndex].body, message.body);
        if (body.length) merged[duplicateIndex].body = body;
      }
    }
    return merged.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  } catch (error) {
    if (error.sourceMismatch) throw error;
    if (error.message !== "Không tìm thấy session OMP") throw error;
    return cached;
  }
}
async function chatSessionNativeState(sessionId) {
  const id = gatewaySessionId(sessionId);
  const record = liveGatewayRecord(id);
  let persisted = null;
  try { persisted = await readPersistedChatSession(id); }
  catch (error) {
    if (error.sourceMismatch) throw error;
  }
  if (!record) {
    if (!persisted) throw Object.assign(new Error("Không tìm thấy session OMP"), { code: "NOT_FOUND" });
    return { sessionId: id, ...persisted.nativeState };
  }
  const summary = consoleBridge.publicSummary(record.contextId);
  const queue = chatTurnQueues.get(record.contextId);
  const activeRequest = queue?.active?.requestId ? activeChatRequests.get(queue.active.requestId) : null;
  const messageCounts = [persisted?.messages?.length, chatMessageCache.get(id)?.length]
    .map(Number).filter(Number.isFinite);
  const protocolVersion = Number(summary.protocolVersion);
  const native = persisted?.nativeState || {};
  return {
    sessionId: id,
    nativeSessionId: native.nativeSessionId || null,
    settingsSource: "omp",
    status: summary.status,
    protocolVersion: Number.isFinite(protocolVersion) ? protocolVersion : 1,
    activeTurn: Boolean(summary.safety?.activeTurn),
    queuedTurns: Math.max(0, Number(activeRequest?.pendingTurns) || 0) + (queue?.pending.length || 0),
    queuePaused: Boolean(queue?.paused),
    queuePauseReason: queue?.pauseReason || null,
    model: native.model || null,
    thinkingLevel: native.thinkingLevel || null,
    messageCount: messageCounts.length ? Math.max(...messageCounts) : 0,
  };
}

function frameMessage(frame) {
  return frame?.message && ["user", "assistant", "system"].includes(frame.message.role) ? frame.message : null;
}

function frameAssistantText(frame) {
  const update = frame?.assistantMessageEvent;
  if (frame?.type === "message_update" && update?.type === "text_delta") return String(update.delta || "");
  if (frame?.type === "message_update" && update?.type === "text_end") return chatMessageText(update.content || update.partial);
  if ((frame?.type === "message_end" || frame?.type === "agent_end") && frame.message?.role === "assistant") return chatMessageText(frame.message);
  return "";
}
function frameAssistantMessage(frame) {
  if (frame?.message?.role === "assistant") return frame.message;
  if (Array.isArray(frame?.messages)) return frame.messages.find((message) => message?.role === "assistant") || null;
  return null;
}

function frameCommandOutput(frame) {
  const candidates = [
    frame?.text,
    frame?.output,
    frame?.content,
    frame?.data?.text,
    frame?.data?.output,
    frame?.data?.content,
  ];
  const text = candidates.find((value) => typeof value === "string");
  return {
    command: typeof frame?.command === "string" ? frame.command.slice(0, 160) : null,
    text: String(text || "").slice(0, 200000),
  };
}

function isImageGenerationTool(value) {
  return /(?:^|[\s:_-])(?:image[\s_-]?gen|generate[\s_-]?image(?:[\s_-]?asset)?|create[\s_-]?image|imagen)(?:$|[\s:_-])/i.test(String(value || ""));
}

function frameAssistantAttachments(frame) {
  if (frame?.type === "tool_execution_end" && isImageGenerationTool(frame.toolName)) return mergeOmpChatAttachments(frame.attachments);
  if ((frame?.type === "message_end" || frame?.type === "agent_end") && frame.message?.role === "assistant") return chatMessageAttachments(frame.message, { allowOmpBlob: true });
  const update = frame?.assistantMessageEvent;
  if (frame?.type !== "message_update" || !update || update.type === "text_delta" || update.type === "text_end") return [];
  return chatMessageAttachments({ content: [update] }, { allowOmpBlob: true });
}


async function collectChatTurn(record, sessionId, prompt, model, requestId, options = {}) {
  const attachments = options.attachments;
  const thinking = options.thinking;
  const selectedBrowserMode = options.browserMode;
  const modelProvider = typeof options.modelProvider === "string" ? options.modelProvider : null;
  const expectsGeneratedImage = looksLikeImageGenerationPrompt(prompt);
  const startedAt = Date.now();
  if (activeMemoryOperations.has(record.contextId)) throw Object.assign(new Error("Đang xử lý lệnh Memory trong session này."), { code: "CONFLICT" });
  record.updatedAt = startedAt;
  const active = { requestId, sessionId, contextId: record.contextId, startedAt, dispatched: false, promptDispatched: false };
  activeChatRequests.set(requestId, active);
  let userMessagePersisted = false;
  const persistUserMessage = () => {
    if (userMessagePersisted) return;
    userMessagePersisted = true;
    appendChatMessage(sessionId, { id: `msg-${startedAt}`, role: "user", content: prompt, attachments, createdAt: new Date(startedAt).toISOString() });
  };
  let reply = "";
  let assistantMessage = null;
  let assistantAttachments = [];
  const bodyBlocks = [];
  let bodySequence = 0;
  let promptDispatched = false;
  let timeout = null;
  let finished = false;
  let unsubscribe = () => {};
  let queueEntry = null;
  let failTurn;
  let resetTurnTimeout = () => {};
  const done = new Promise((resolve, reject) => {
    const finish = (fn, value) => {
      if (finished) return;
      finished = true;
      if (timeout) clearTimeout(timeout);
      timeout = null;
      if (unsubscribe) unsubscribe();
      activeChatRequests.delete(requestId);
      if (queueEntry?.started && (fn === reject || value?.aborted)) pauseChatTurnQueue(record.contextId, value?.aborted ? "previous_turn_aborted" : "previous_turn_failed");
      if (queueEntry?.started) queueEntry.release?.();
      else queueEntry?.cancel?.();
      if (promptDispatched && ["UPSTREAM_TIMEOUT", "UPSTREAM_ERROR"].includes(value?.code)) void recycleGatewaySession(record);
      fn(value);
    };
    failTurn = (error) => finish(reject, error);
    resetTurnTimeout = () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => finish(reject, Object.assign(new Error("OMP không trả lời trong thời gian cho phép"), { code: "UPSTREAM_TIMEOUT" })), chatTurnTimeoutMs(prompt, selectedBrowserMode));
    };
    active.abort = () => {
      if (active.promptDispatched) return;
      finish(resolve, { id: null, content: reply, model, createdAt: new Date().toISOString(), aborted: true });
    };
    unsubscribe = subscribeGatewayFrames(record, (event, frame) => {
      if (event === "bridge_error") {
        if (active.dispatched && chatTurnOwner(record.contextId, requestId)) finish(reject, Object.assign(new Error(frame.message || "OMP bridge error"), { code: "UPSTREAM_ERROR" }));
        return;
      }
      if (event !== "omp" || !active.dispatched || !chatTurnOwner(record.contextId, requestId)) return;
      resetTurnTimeout();
      for (const block of chatBodyBlocksFromFrame(frame, requestId, bodySequence++)) mergeChatBodyBlock(bodyBlocks, block);
      const failure = chatFrameFailure(frame);
      if (failure) return finish(reject, Object.assign(new Error(failure.message), { code: failure.code }));
      const text = frameAssistantText(frame);
      assistantAttachments = mergeChatAttachments(assistantAttachments, frameAssistantAttachments(frame));
      if (frame.type === "message_update" && frame.assistantMessageEvent?.type === "text_delta") reply += text;
      if (frame.type === "message_end" && frame.message?.role === "assistant") { assistantMessage = frame.message; reply = chatMessageText(frame.message) || reply; }
      if (frame.type === "agent_end" && frame.isTerminal !== false) {
        if (active.abortRequested) {
          finish(resolve, { id: null, content: reply, model, createdAt: new Date().toISOString(), aborted: true });
          return;
        }
        assistantMessage = assistantMessage || frameAssistantMessage(frame);
        if (!reply && !assistantMessage && !assistantAttachments.length) return finish(reject, Object.assign(new Error("OMP kết thúc lượt nhưng không trả nội dung"), { code: "UPSTREAM_ERROR" }));
        if (expectsGeneratedImage && !assistantAttachments.length) return finish(reject, Object.assign(new Error("OMP không trả ảnh đầu ra; lượt này chưa được tính là đã tạo ảnh."), { code: "UPSTREAM_IMAGE_MISSING" }));
        for (const block of chatBodyBlocksFromMessage(assistantMessage, requestId)) mergeChatBodyBlock(bodyBlocks, block);
        const message = { id: `msg-${Date.now()}`, role: "assistant", content: reply || chatMessageText(assistantMessage), model: assistantMessage?.model || model || "neural-flash-3.8", createdAt: new Date().toISOString(), ...(bodyBlocks.length ? { body: bodyBlocks } : {}), ...(assistantAttachments.length ? { attachments: assistantAttachments } : {}), ...(assistantMessage?.usage?.total ? { totalTokens: assistantMessage.usage.total } : {}) };
        appendChatMessage(sessionId, message);
        finish(resolve, message);
      }
    });
  });
  queueEntry = {
    requestId,
    onQueueState(snapshot) {
      active.queueState = snapshot;
    },
    onQueueFailure(error) {
      if (!finished) failTurn(error);
    },
    async run() {
      persistUserMessage();
      try {
        while (!finished) {
          const safety = consoleBridge.safety();
          const blockedUntil = Number(safety.blockedUntil || 0);
          const nextRequestAt = Number(safety.nextRequestAt || 0);
          const waitMs = safety.blocked ? Math.max(1000, blockedUntil - Date.now()) : Math.max(0, nextRequestAt - Date.now());
          if (safety.blocked || waitMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, Math.min(1000, Math.max(250, waitMs))));
            continue;
          }
          let dispatched = false;
          await withChatDispatchGate(async () => {
            const currentSafety = consoleBridge.safety();
            const currentBlockedUntil = Number(currentSafety.blockedUntil || 0);
            const currentNextRequestAt = Number(currentSafety.nextRequestAt || 0);
            const currentWaitMs = currentSafety.blocked ? Math.max(1000, currentBlockedUntil - Date.now()) : Math.max(0, currentNextRequestAt - Date.now());
            if (finished || currentSafety.blocked || currentWaitMs > 0) return;
            const images = attachments.filter((item) => item.data && /^image\//.test(item.type)).map((item) => item.data);
            const attachmentContext = attachments.filter((item) => item.text).map((item) => `\n\n[Attached file: ${item.name}]\n${item.text}`).join("");
            const outboundMessage = `${browserPrompt(prompt, selectedBrowserMode, images.length > 0)}${attachmentContext}${imageOutputInstruction(prompt)}`;
            consoleBridge.send(record.contextId, { id: `model-${startedAt}`, type: "set_model", ...(modelProvider ? { provider: modelProvider } : {}), modelId: model });
            if (thinking) consoleBridge.send(record.contextId, { id: `thinking-${startedAt}`, type: "set_thinking_level", level: thinking });
            consoleBridge.send(record.contextId, { id: `prompt-${startedAt}`, type: "prompt", message: outboundMessage, ...(images.length ? { images } : {}) });
            promptDispatched = true;
            active.dispatched = true;
            active.promptDispatched = true;
            dispatched = true;
            resetTurnTimeout();
          });
          if (dispatched || finished) break;
        }
      } catch (error) {
        if (!finished) finish(reject, error);
        return;
      }
      await new Promise((resolve) => {
        queueEntry.release = resolve;
        if (finished) resolve();
      });
    },
  };
  active.queueEntry = queueEntry;
  await enqueueChatTurn(record.contextId, queueEntry);
  const message = await done;
  const duration = `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
  observeChatRequest(requestId, sessionId, startedAt, message.aborted ? "aborted" : "completed");
  return {
    sessionId,
    messageId: message.id,
    reply: message.content,
    model: message.model,
    totalTokens: message.totalTokens || 0,
    duration,
    createdAt: message.createdAt,
    ...(message.aborted ? { aborted: true } : {}),
    ...(message.body?.length ? { body: message.body } : {}),
    ...(message.attachments?.length ? { attachments: message.attachments } : {}),
  };
}


async function queryGatewayResponse(record, command, timeoutMs = 10000, send = (frame) => consoleBridge.send(record.contextId, frame)) {
  await waitGatewayReady(record);
  return new Promise((resolve, reject) => {
    let unsubscribe;
    let timer;
    let settled = false;
    let promptResponseData;
    let promptResponseSeen = false;
    let promptResult = null;
    const commandId = `${command.type}-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe?.();
      callback(value);
    };
    timer = setTimeout(() => finish(
      reject,
      Object.assign(new Error("OMP không trả về dữ liệu theo yêu cầu"), { code: "UPSTREAM_UNAVAILABLE" }),
    ), timeoutMs);
    unsubscribe = subscribeGatewayFrames(record, (event, frame) => {
      if (event !== "omp") return;
      if (command.type === "prompt" && ["agent_start", "turn_start"].includes(frame.type)) {
        return finish(resolve, { ...(promptResponseData || {}), agentInvoked: true });
      }
      if (command.type === "prompt" && frame.type === "prompt_result" && frame.id === commandId) {
        promptResult = frame;
        if (promptResponseSeen) {
          return finish(resolve, { ...(promptResponseData || {}), agentInvoked: frame.agentInvoked });
        }
        return;
      }
      if (frame.type !== "response" || frame.command !== command.type) return;
      if (frame.id != null && frame.id !== commandId) return;
      if (!frame.success) {
        const message = typeof frame.error === "string" ? frame.error : frame.error?.message;
        return finish(reject, Object.assign(new Error(message || `OMP từ chối ${command.type}`), { code: "UPSTREAM_ERROR" }));
      }
      if (command.type === "prompt" && frame.data?.agentInvoked == null) {
        promptResponseData = frame.data;
        promptResponseSeen = true;
        if (promptResult) {
          return finish(resolve, { ...(promptResponseData || {}), agentInvoked: promptResult.agentInvoked });
        }
        return;
      }
      finish(resolve, frame.data);
    });
    try { send({ id: commandId, ...command }); }
    catch (error) { finish(reject, error); }
  });
}

function geminiPinFailureCode(error) {
  switch (String(error?.message || "")) {
    case "OMP AuthStorage is unavailable":
      return "GEMINI_PIN_AUTH_STORAGE_UNAVAILABLE";
    case "OMP AuthStorage does not support strict Gemini account pinning":
      return "GEMINI_PIN_AUTH_STORAGE_UNSUPPORTED";
    case "Selected Gemini account is not available in OMP for this session":
      return "GEMINI_PIN_ACCOUNT_NOT_AVAILABLE";
    case "Selected Gemini account has no usable OAuth credential in OMP":
      return "GEMINI_PIN_CREDENTIAL_NOT_AVAILABLE";
    case "OMP could not pin the selected Gemini credential":
      return "GEMINI_PIN_AFFINITY_REJECTED";
    default:
      return "GEMINI_PIN_EXTENSION_REJECTED";
  }
}

async function pinGeminiSession(record, sessionId, account) {
  const id = gatewaySessionId(sessionId);
  if (record.sessionId !== id) throw Object.assign(new Error("OMP session ID không khớp chat đang ghim"), { code: "CONFLICT" });
  const accountId = quotaAccountId(account);
  if (record.geminiAccountId === accountId) return account;
  if (contextHasChatWork(record.contextId)) throw Object.assign(new Error("Không thể ghim account Gemini khi session đang có lượt chạy"), { code: "CONFLICT" });
  let available;
  try { available = await queryGatewayResponse(record, { type: "get_available_commands" }); }
  catch { throw Object.assign(new Error("Không xác minh được lệnh ghim account Gemini cục bộ của OMP."), { code: "UPSTREAM_UNAVAILABLE" }); }
  if (!(available?.commands || []).some((item) => item?.name === "dashboard-gemini-pin")) {
    throw Object.assign(new Error("OMP chưa nạp extension ghim account Gemini"), { code: "UPSTREAM_UNAVAILABLE" });
  }
  let result;
  try {
    result = await queryGatewayResponse(
      record,
      { type: "prompt", message: `/dashboard-gemini-pin ${accountId}` },
      10000,
      (frame) => consoleBridge.sendLocalCommand(record.contextId, frame),
    );
  } catch (error) {
    const code = error.code && error.code !== "UPSTREAM_ERROR" ? error.code : geminiPinFailureCode(error);
    throw Object.assign(new Error("OMP rejected the Gemini account pin command."), { code });
  }
  if (result?.agentInvoked === true) {
    try { consoleBridge.send(record.contextId, { id: `abort-gemini-pin-${randomUUID()}`, type: "abort" }); } catch {}
    throw Object.assign(new Error("OMP pin command did not complete locally."), { code: "GEMINI_PIN_NOT_LOCAL" });
  }
  if (result?.agentInvoked !== false) throw Object.assign(new Error("OMP pin command locality was not confirmed."), { code: "GEMINI_PIN_LOCALITY_UNCONFIRMED" });
  const current = await readGeminiSelection(id);
  if (current.scope !== "session" || current.accountId !== accountId || current.provider !== account.provider) {
    await updateChatMetadata(id, {
      geminiAccountId: accountId,
      geminiProvider: account.provider,
      geminiAccountSelectedAt: Date.now(),
    }, { touchUpdatedAt: false });
  }
  record.geminiAccountId = accountId;
  return account;
}

async function nativeMemoryCommand(record) {
  let data;
  try { data = await queryGatewayResponse(record, { type: "get_available_commands" }); }
  catch { throw Object.assign(new Error("Không đọc được danh sách lệnh native của OMP."), { code: "UPSTREAM_UNAVAILABLE" }); }
  const commands = Array.isArray(data?.commands) ? data.commands : [];
  return commands.find((command) => command?.name === "memory" && command.source === "builtin") || null;
}

function memoryActionWarnings(backend) {
  const warnings = { processing: "OMP có thể xử lý nội dung phiên và gọi model/provider đã cấu hình." };
  if (backend === "hindsight") warnings.clear = "Chỉ xóa session state và recall cache cục bộ; không xóa dữ liệu trên Hindsight server.";
  else if (backend === "mnemopi") warnings.clear = "OMP xóa các SQLite database thuộc scope đang hoạt động cùng WAL/SHM.";
  else if (backend === "local") warnings.clear = "OMP xóa memory data/artifacts thuộc backend local.";
  return warnings;
}

function memoryBusy(record) {
  return activeMemoryOperations.has(record.contextId) || contextHasChatWork(record.contextId);
}

async function sessionMemoryStatus(sessionId) {
  const record = await ensureChatSession(sessionId, {}, { requireExisting: true });
  const backend = await runOmpMemoryBackend(record.cwd);
  const busy = memoryBusy(record);
  if (backend === "off") return { ok: true, sessionId, status: "off", backend, scope: null, operations: [], warnings: {}, busy };
  if (backend === "unknown") return { ok: true, sessionId, status: "unavailable", backend, scope: null, operations: [], warnings: {}, busy };
  const command = await nativeMemoryCommand(record);
  if (!command) return { ok: true, sessionId, status: "unavailable", backend, scope: null, operations: [], warnings: {}, busy };
  const registered = Array.isArray(command.subcommands)
    ? new Set(command.subcommands.map((item) => typeof item === "string" ? item : item?.name).filter((name) => typeof name === "string"))
    : null;
  const operations = OMP_MEMORY_ACTIONS.filter((action) => (!registered?.size || registered.has(action)) && !(backend === "sharpshooter" && ["clear", "reset"].includes(action)));
  return { ok: true, sessionId, status: operations.length ? "supported" : "unavailable", backend, scope: null, operations, warnings: memoryActionWarnings(backend), busy };
}

async function waitForMemoryRequestSlot(record) {
  while (true) {
    const safety = consoleBridge.get(record.contextId).summary().safety || {};
    if (safety.blocked) throw Object.assign(new Error("OMP Safety Guard đang cooldown."), { code: "RATE_LIMITED" });
    if (safety.activeTurn) throw Object.assign(new Error("Session đang có lượt chat."), { code: "CONFLICT" });
    const waitMs = Math.max(0, Number(safety.nextRequestAt || 0) - Date.now());
    if (!waitMs) return;
    await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 1000)));
  }
}
function queryOmpMemoryCommand(record, action) {
  const commandId = `memory-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const timeoutMs = OMP_MEMORY_CONFIRM_ACTIONS.has(action) ? 120000 : 30000;
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    let outputSeen = false;
    let output = "";
    let truncated = false;
    let localResponse = false;
    const finish = (fn, value) => {
      clearTimeout(timer);
      unsubscribe();
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, Object.assign(new Error("OMP không hoàn tất lệnh Memory."), { code: "UPSTREAM_TIMEOUT" })), timeoutMs);
    unsubscribe = subscribeGatewayFrames(record, (event, frame) => {
      if (event !== "omp") return;
      if (frame.type === "command_output") {
        if (outputSeen) return finish(reject, Object.assign(new Error("OMP trả nhiều kết quả cho một lệnh Memory."), { code: "UPSTREAM_ERROR" }));
        outputSeen = true;
        const raw = [frame.text, frame.output, frame.message, frame.data?.output, frame.data?.content].find((value) => typeof value === "string") || "";
        output = frameCommandOutput(frame).text;
        truncated = raw.length > output.length;
        if (localResponse) finish(resolve, { text: output, truncated });
        return;
      }
      if (frame.type !== "response" || frame.command !== "prompt" || frame.id !== commandId) return;
      if (!frame.success) return finish(reject, Object.assign(new Error("OMP từ chối lệnh Memory."), { code: "UPSTREAM_ERROR" }));
      if (frame.data?.agentInvoked !== false) {
        if (frame.data?.agentInvoked === true) {
          try { consoleBridge.send(record.contextId, { id: `abort-${commandId}`, type: "abort" }); } catch {}
        }
        return finish(reject, Object.assign(new Error("OMP không xác nhận lệnh Memory local-only."), { code: "UPSTREAM_ERROR" }));
      }
      localResponse = true;
      if (outputSeen) finish(resolve, { text: output, truncated });
    });
    try { consoleBridge.send(record.contextId, { id: commandId, type: "prompt", message: `/memory ${action}` }); }
    catch (error) {
      const code = ["CONFLICT", "RATE_LIMITED"].includes(error?.code) ? error.code : "UPSTREAM_UNAVAILABLE";
      finish(reject, Object.assign(new Error("Không thể gửi lệnh Memory đến OMP."), { code }));
    }
  });
}

async function sessionMemoryAction(sessionId, req) {
  const body = await jsonBody(req);
  if (!body || Array.isArray(body) || typeof body !== "object") throw Object.assign(new Error("Payload phải là object JSON."), { code: "BAD_REQUEST" });
  const action = body.action;
  if (!OMP_MEMORY_ACTIONS.includes(action)) throw Object.assign(new Error("Thao tác Memory không được hỗ trợ."), { code: "BAD_REQUEST" });
  if (OMP_MEMORY_CONFIRM_ACTIONS.has(action) && body.confirmed !== true) throw Object.assign(new Error("Thao tác này cần xác nhận rõ ràng."), { code: "BAD_REQUEST" });
  if (OMP_MEMORY_MUTATING_ACTIONS.has(action) && typeof body.expectedBackend !== "string") throw Object.assign(new Error("Cần gửi backend đang hiển thị để xác nhận phạm vi."), { code: "BAD_REQUEST" });
  const record = await ensureChatSession(sessionId, {}, { requireExisting: true });
  if (memoryBusy(record)) throw Object.assign(new Error("Session đang có lượt chat hoặc Memory khác."), { code: "CONFLICT" });
  activeMemoryOperations.add(record.contextId);
  try {
    const backend = await runOmpMemoryBackend(record.cwd);
    if (backend === "off" || backend === "unknown") throw Object.assign(new Error("Memory backend chưa được bật hoặc không nhận diện."), { code: "CONFLICT" });
    if (body.expectedBackend != null && body.expectedBackend !== backend) throw Object.assign(new Error("Backend Memory đã đổi; tải lại trạng thái trước khi thao tác."), { code: "CONFLICT" });
    const command = await nativeMemoryCommand(record);
    if (!command) throw Object.assign(new Error("OMP không công bố lệnh Memory native."), { code: "CONFLICT" });
    if (Array.isArray(command.subcommands) && !command.subcommands.some((item) => (typeof item === "string" ? item : item?.name) === action)) {
      throw Object.assign(new Error("OMP không công bố thao tác Memory này."), { code: "CONFLICT" });
    }
    if (backend === "sharpshooter" && ["clear", "reset"].includes(action)) throw Object.assign(new Error("Chưa xác minh phạm vi xóa của backend Sharpshooter."), { code: "CONFLICT" });
    if ([...activeChatRequests.values()].some((request) => request.contextId === record.contextId) || consoleBridge.get(record.contextId).summary().safety?.activeTurn) {
      throw Object.assign(new Error("Session đang có lượt chat."), { code: "CONFLICT" });
    }
    await waitForMemoryRequestSlot(record);
    const result = await queryOmpMemoryCommand(record, action);
    const warnings = memoryActionWarnings(backend);
    return {
      ok: true, sessionId, action, backend, scope: null, text: result.text, truncated: result.truncated,
      ...(OMP_MEMORY_CONFIRM_ACTIONS.has(action) ? { warning: ["clear", "reset"].includes(action) ? warnings.clear : warnings.processing } : {}),
    };
  } finally {
    activeMemoryOperations.delete(record.contextId);
  }
}

function approvalRequestKey(sessionId, id) {
  return JSON.stringify([sessionId, id]);
}

function approvalRequest(sessionId, contextId, frame) {
  if (frame.method === "cancel" && typeof frame.targetId === "string") {
    pendingApprovalRequests.delete(approvalRequestKey(sessionId, frame.targetId));
    return null;
  }
  if (!["confirm", "select", "input", "editor"].includes(frame.method) || typeof frame.id !== "string" || frame.id.length > 120) return null;
  const key = approvalRequestKey(sessionId, frame.id);
  const options = Array.isArray(frame.options) ? frame.options.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 16) : [];
  if (frame.method === "select" && options.length < 2) return null;
  const approveValue = options.find((value) => /^(?:approve|allow|yes|ok|continue)$/i.test(value)) || options[0];
  const denyValue = options.find((value) => /^(?:deny|reject|no|cancel)$/i.test(value)) || options[1];
  const expiresAt = Date.now() + APPROVAL_TIMEOUT_MS;
  const defaultValue = typeof frame.defaultValue === "string" ? frame.defaultValue.slice(0, 10000) : "";
  const approval = {
    id: frame.id,
    sessionId,
    contextId,
    method: frame.method,
    expiresAt,
    timeoutMs: APPROVAL_TIMEOUT_MS,
    ...(options.length ? { options, approveValue, denyValue } : {}),
    ...(frame.placeholder ? { placeholder: String(frame.placeholder).slice(0, 300) } : {}),
    ...(defaultValue ? { defaultValue } : {}),
    title: String(frame.title || "OMP cần xác nhận").slice(0, 300),
    message: String(frame.message || (["input", "editor"].includes(frame.method) ? "OMP cần bạn nhập dữ liệu để tiếp tục." : "Cho phép OMP tiếp tục?")).slice(0, 4000),
  };
  pendingApprovalRequests.set(key, approval);
  setTimeout(() => {
    if (pendingApprovalRequests.get(key) !== approval) return;
    pendingApprovalRequests.delete(key);
    try {
      const response = ["input", "editor"].includes(approval.method)
        ? { value: approval.defaultValue || "" }
        : { cancelled: true };
      consoleBridge.send(approval.contextId, { type: "extension_ui_response", id: approval.id, ...response });
    } catch {}
  }, APPROVAL_TIMEOUT_MS).unref();
  return approval;
}

async function resolveApproval(sessionId, body) {
  const id = typeof body?.id === "string" ? body.id : "";
  const key = approvalRequestKey(sessionId, id);
  const approval = pendingApprovalRequests.get(key);
  if (!approval || approval.sessionId !== sessionId) throw Object.assign(new Error("Yêu cầu quyền không còn hiệu lực"), { code: "NOT_FOUND" });
  if (["input", "editor"].includes(approval.method)) {
    const cancelled = body?.cancelled === true;
    if (!cancelled && (typeof body?.value !== "string" || body.value.length > (approval.method === "editor" ? 200000 : 10000))) {
      throw Object.assign(new Error("Giá trị nhập không hợp lệ"), { code: "BAD_REQUEST", field: "value" });
    }
    pendingApprovalRequests.delete(key);
    const response = cancelled ? { cancelled: true } : { value: body.value };
    consoleBridge.send(approval.contextId, { type: "extension_ui_response", id, ...response });
    return { success: true, sessionId, id, ...(cancelled ? { cancelled: true } : { value: body.value }) };
  }
  if (approval.method === "select") {
    const cancelled = body?.cancelled === true;
    const value = typeof body?.value === "string" ? body.value : "";
    if (!cancelled && (!value || !approval.options.includes(value))) {
      throw Object.assign(new Error("Giá trị lựa chọn không hợp lệ"), { code: "BAD_REQUEST", field: "value" });
    }
    pendingApprovalRequests.delete(key);
    const response = cancelled ? { cancelled: true } : { value };
    consoleBridge.send(approval.contextId, { type: "extension_ui_response", id, ...response });
    return { success: true, sessionId, id, ...(cancelled ? { cancelled: true } : { value }) };
  }
  const decision = body?.decision;
  if (decision !== "approve" && decision !== "deny") throw Object.assign(new Error("Quyết định quyền không hợp lệ"), { code: "BAD_REQUEST", field: "decision" });
  pendingApprovalRequests.delete(key);
  const response = approval.method === "select"
    ? { value: decision === "approve" ? approval.approveValue : approval.denyValue }
    : (decision === "approve" ? { confirmed: true } : { cancelled: true });
  consoleBridge.send(approval.contextId, { type: "extension_ui_response", id, ...response });
  return { success: true, sessionId, id, decision };
}

function agentHubSnapshot(data) {
  const subagents = Array.isArray(data?.subagents) ? data.subagents : [];
  return subagents.map((agent) => ({
    id: String(agent?.id || "").slice(0, 200), index: Number(agent?.index || 0), agent: String(agent?.agent || "Agent").slice(0, 200),
    status: String(agent?.status || "unknown").slice(0, 80), agentSource: String(agent?.agentSource || "").slice(0, 80),
    ...(agent?.description ? { description: String(agent.description).slice(0, 1000) } : {}), ...(agent?.task ? { task: String(agent.task).slice(0, 2000) } : {}),
  })).filter((agent) => agent.id);
}

async function availableModels() {
  if (Date.now() - availableModelsCache.loadedAt < 300000 && availableModelsCache.items.length) return availableModelsCache.items;
  let record = [...gatewaySessions.keys()].map(liveGatewayRecord).find(Boolean);
  let temporary = false;
  if (!record) {
    const id = `models-${randomUUID()}`;
    await createGatewaySession({ sessionId: id });
    record = liveGatewayRecord(id);
    temporary = true;
  }
  try {
    const models = normalizeModels(await queryGatewayResponse(record, { type: "get_available_models" }));
    if (!models.length) throw Object.assign(new Error("OMP không công bố model khả dụng"), { code: "UPSTREAM_UNAVAILABLE" });
    availableModelsCache = { loadedAt: Date.now(), items: models };
    return models;
  } finally {
    if (temporary) { await consoleBridge.stop(record.contextId).catch(() => {}); gatewaySessions.delete(record.sessionId); }
  }
}

function chatError(res, error) {
  const code = error.code || "INTERNAL_SERVER_ERROR";
  return errorResponse(res, { ...error, code, message: String(error.message || "Chat backend error").slice(0, 300) }, "Chat backend error");
}

async function abortChatRequest(req, providedBody = null) {
  const body = providedBody || await jsonBody(req);
  if (!body || typeof body.requestId !== "string" || !body.requestId.trim()) throw Object.assign(new Error("requestId là bắt buộc"), { code: "BAD_REQUEST", field: "requestId" });
  const requestId = chatRequestId(body.requestId);
  const active = activeChatRequests.get(requestId);
  if (!active || (body.sessionId && body.sessionId !== active.sessionId)) throw Object.assign(new Error("Không tìm thấy request chat đang chạy"), { code: "NOT_FOUND" });
  const queue = chatTurnQueues.get(active.contextId);
  const ownsContextTurn = queue?.active?.requestId === requestId;
  if (!active.promptDispatched) {
    active.abort?.();
    active.queueEntry?.cancel?.();
    return { success: true, requestId, sessionId: active.sessionId, status: "abort_requested" };
  }
  if (!ownsContextTurn) throw Object.assign(new Error("Request chat không còn giữ lượt OMP"), { code: "CONFLICT" });
  active.abortRequested = true;
  consoleBridge.send(active.contextId, { id: `abort-${requestId}`, type: "abort" });
  return { success: true, requestId, sessionId: active.sessionId, status: "abort_requested" };
}

async function waitForNewOmpSession(cwd, existingIds, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await consoleBridge.listSessions(cwd).catch(() => ({ sessions: [] }));
    const candidate = (result.sessions || []).find((item) => item?.sessionId && !existingIds.has(item.sessionId));
    if (candidate) return candidate;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw Object.assign(new Error("OMP không tạo được session fork trong thời gian cho phép"), { code: "UPSTREAM_TIMEOUT" });
}

async function sessionAction(sessionId, req, providedBody = null) {
  const body = providedBody || await jsonBody(req);
  if (!body || Array.isArray(body) || typeof body !== "object") throw Object.assign(new Error("Payload phải là object JSON."), { code: "BAD_REQUEST" });
  const action = String(body.action || "").trim().toLowerCase();
  if (!["rename", "pin", "unpin", "unread", "read", "mark_unread", "mark_read", "archive", "delete", "fork", "reconnect", "resume_queue", "steer", "follow_up", "share", "tools", "assign_folder", "unassign_folder"].includes(action)) throw Object.assign(new Error("action không được hỗ trợ"), { code: "BAD_REQUEST", field: "action" });
  const id = gatewaySessionId(sessionId);
  const metadata = await readChatMetadata();
  const current = metadata.sessions[id] || {};
  let record = liveGatewayRecord(id);
  const persisted = await readPersistedChatSession(id).catch(() => null);
  if (!record && !persisted) throw Object.assign(new Error("Không tìm thấy session OMP"), { code: "NOT_FOUND" });
  let patch = {};
  if (action === "assign_folder") {
    const folderId = chatFolderId(body.folderId);
    const folder = Object.prototype.hasOwnProperty.call(metadata.folders, folderId) ? metadata.folders[folderId] : null;
    if (!folder || typeof folder.name !== "string") throw Object.assign(new Error("Folder không tồn tại"), { code: "NOT_FOUND", field: "folderId" });
    patch = { folderId: folder.id, folderName: folder.name };
  } else if (action === "unassign_folder") {
    patch = { folderId: null, folderName: null };
  } else if (action === "tools") {
    const selectedChatModel = record?.selectedChatModel || null;
    const tools = await headlessTools(record?.approvalMode || approvalMode(current.approvalMode), await selectedOmpTools(body.tools));
    if (!record) {
      await ensureChatSession(id, { tools, approvalMode: current.approvalMode });
      record = liveGatewayRecord(id);
      if (record) record.selectedChatModel = selectedChatModel;
    } else {
      if (contextHasChatWork(record.contextId)) throw Object.assign(new Error("Không thể đổi công cụ khi session đang chạy hoặc đang chờ."), { code: "CONFLICT" });
      const summary = consoleBridge.get(record.contextId).summary();
      const sourcePath = current.path || (await readPersistedChatSession(id).catch(() => null))?.path;
      await consoleBridge.stop(record.contextId);
      gatewaySessions.delete(id);
      await createGatewaySession({ sessionId: id, cwd: summary.cwd, approvalMode: record.approvalMode, tools });
      const nextRecord = liveGatewayRecord(id);
      if (nextRecord) nextRecord.selectedChatModel = selectedChatModel;
      if (sourcePath) await queryGatewayResponse(nextRecord, { type: "switch_session", sessionPath: sourcePath });
      const selectedAccount = await readGeminiSelection(id);
      const selectedGemini = selectedAccount.scope === "session"
        ? geminiQuotaAccounts().find((account) => quotaAccountId(account) === selectedAccount.accountId && account.provider === selectedAccount.provider)
        : null;
      if (selectedGemini) await pinGeminiSession(nextRecord, id, selectedGemini);
    }
    patch = { tools };
  } else if (action === "reconnect") {
    if (record?.recyclingPromise) {
      await record.recyclingPromise;
      record = liveGatewayRecord(id);
    }
    const summary = record ? consoleBridge.get(record.contextId).summary() : null;
    if (record && contextHasChatWork(record.contextId)) throw Object.assign(new Error("Không thể reconnect khi session đang chạy hoặc đang chờ; hãy dừng lượt trước."), { code: "CONFLICT" });
    const savedApprovalMode = record?.approvalMode || current.approvalMode;
    const savedTools = Array.isArray(record?.tools) ? record.tools : current.tools;
    const cwd = summary?.cwd || persisted?.cwd;
    if (record) { await consoleBridge.stop(record.contextId); gatewaySessions.delete(id); }
    const nextRecord = await ensureChatSession(id, { cwd, approvalMode: savedApprovalMode, ...(Array.isArray(savedTools) ? { tools: savedTools } : {}) });
    const stored = await updateChatMetadata(id, { reconnectedAt: new Date().toISOString() }, { touchUpdatedAt: false });
    return { success: true, action, sessionId: id, status: "ready", metadata: stored, context: consoleBridge.publicSummary(nextRecord.contextId) };
  } else if (action === "resume_queue") {
    if (!record) throw Object.assign(new Error("Hàng chờ không còn hoạt động trong tab chat này."), { code: "CONFLICT" });
    const queue = chatTurnQueues.get(record.contextId);
    if (!queue?.paused) throw Object.assign(new Error("Hàng chờ không ở trạng thái tạm dừng."), { code: "CONFLICT" });
    const snapshot = resumeChatTurnQueue(record.contextId);
    return { success: true, action, sessionId: id, status: "ready", queuedTurns: snapshot.queuedTurns, paused: snapshot.paused, pauseReason: snapshot.pauseReason };
  } else if (action === "steer") {
    const message = chatPrompt(body.message);
    if (!record) throw Object.assign(new Error("Không có lượt đang chạy để hướng dẫn"), { code: "CONFLICT" });
    const summary = consoleBridge.get(record.contextId).summary();
    if (!summary.safety?.activeTurn) throw Object.assign(new Error("Không có lượt đang chạy để hướng dẫn"), { code: "CONFLICT" });
    consoleBridge.send(record.contextId, { id: `steer-${Date.now()}`, type: "steer", message });
    return { success: true, action, sessionId: id, status: "steer_sent" };
  } else if (action === "follow_up") {
    const message = chatPrompt(body.message);
    if (!record) throw Object.assign(new Error("Không có lượt đang chạy để xếp follow-up"), { code: "CONFLICT" });
    const queue = chatTurnQueues.get(record.contextId);
    const activeRequest = queue?.active?.requestId ? activeChatRequests.get(queue.active.requestId) : null;
    if (!activeRequest?.stream || !activeRequest.dispatched) throw Object.assign(new Error("Không có stream đang chạy để xếp follow-up"), { code: "CONFLICT" });
    const summary = consoleBridge.get(record.contextId).summary();
    if (!summary.safety?.activeTurn) throw Object.assign(new Error("OMP chưa ở trong lượt đang chạy để xếp follow-up"), { code: "CONFLICT" });
    const attachments = normalizeChatAttachments(body.attachments, { rejectInvalid: true });
    const attachmentContext = attachments.filter((item) => item.text).map((item) => `\n\n[Attached file: ${item.name}]\n${item.text}`).join("");
    const images = attachments.filter((item) => item.data && /^image\//.test(item.type)).map((item) => item.data);
    activeRequest.pendingTurns = Number(activeRequest.pendingTurns || 0) + 1;
    try {
      consoleBridge.send(record.contextId, { id: `follow-up-${Date.now()}`, type: "follow_up", message: `${message}${attachmentContext}`, ...(images.length ? { images } : {}) });
    } catch (error) {
      activeRequest.pendingTurns = Math.max(0, activeRequest.pendingTurns - 1);
      throw error;
    }
    appendChatMessage(id, { id: `msg-${Date.now()}`, role: "user", content: message, attachments, createdAt: new Date().toISOString() });
    record.updatedAt = Date.now();
    return { success: true, action, sessionId: id, requestId: activeRequest.requestId, status: "follow_up_sent", queuedTurns: activeRequest.pendingTurns };
  } else if (action === "rename") {
    const title = String(body.title ?? body.name ?? "").trim();
    if (!title || title.length > 200) throw Object.assign(new Error("title phải có 1-200 ký tự"), { code: "BAD_REQUEST", field: "title" });
    patch = { title };
    if (record && record.protocol !== "acp") consoleBridge.send(record.contextId, { id: `rename-${Date.now()}`, type: "set_session_name", name: title });
  } else if (action === "pin" || action === "unpin") {
    patch = { isPinned: action === "pin" ? true : action === "unpin" ? false : !current.isPinned };
  } else if (["unread", "read", "mark_unread", "mark_read"].includes(action)) {
    patch = { isUnread: action === "unread" || action === "mark_unread" };
  } else if (action === "archive" || action === "delete") {
    const destinationRoot = action === "archive" ? OMP_ARCHIVE_ROOT : OMP_TRASH_ROOT;
    let moved = null;
    try { moved = await moveSessionRecord(id, destinationRoot); }
    catch (error) {
      if (error.message !== "Không tìm thấy session OMP" || !record) throw Object.assign(error, { code: "NOT_FOUND" });
    }
    if (record) { await consoleBridge.stop(record.contextId); gatewaySessions.delete(id); }
    patch = action === "archive" ? { archived: true, archivedAt: new Date().toISOString() } : { deleted: true, deletedAt: new Date().toISOString() };
    const stored = await updateChatMetadata(id, patch);
    return { success: true, action, sessionId: id, metadata: stored, ...(moved ? { moved } : {}) };
  } else if (action === "fork") {
    let sourcePath = current.path;
    if (!sourcePath) { try { sourcePath = (await readPersistedChatSession(id)).path; } catch { sourcePath = null; } }
    if (!record && !sourcePath) throw Object.assign(new Error("Không tìm thấy session để fork"), { code: "NOT_FOUND" });
    const target = record || await ensureChatSession(id);
    const targetSummary = consoleBridge.get(target.contextId).summary();
    if (targetSummary.protocol === "acp") {
      if (contextHasChatWork(target.contextId)) throw Object.assign(new Error("Không thể fork khi lượt chat đang chạy"), { code: "CONFLICT" });
      const forked = await consoleBridge.fork(target.contextId);
      const childId = gatewaySessionId(forked.sessionId);
      const title = `${current.title || "Phiên làm việc mới"} · Fork`;
      const childPath = await findSessionPath(childId).catch(() => null);
      const cwd = targetSummary.cwd;
      const createdAt = new Date().toISOString();
      try {
        const stored = await updateChatMetadata(childId, {
          title,
          parentSessionId: id,
          path: childPath,
          cwd,
          ompSessionId: childId,
          approvalMode: target.approvalMode,
          tools: target.tools,
          createdAt,
        });
        const timestamp = Date.parse(stored.createdAt || createdAt);
        const childRecord = {
          sessionId: childId,
          protocol: "acp",
          contextId: forked.context.id,
          ompSessionId: childId,
          cwd,
          approvalMode: target.approvalMode,
          tools: target.tools,
          browserMode: target.browserMode,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        gatewaySessions.set(childId, childRecord);
        chatSessionMeta.set(childId, { ...stored, id: childId, path: childPath, cwd, title, createdAt: stored.createdAt || createdAt });
        return {
          success: true,
          action,
          sessionId: id,
          forkSession: chatSessionView({ id: childId, ...stored, cwd, title, createdAt: stored.createdAt || createdAt }),
          status: "ready",
        };
      } catch (error) {
        await consoleBridge.stop(forked.context.id).catch(() => {});
        throw error;
      }
    }
    const before = await consoleBridge.listSessions(targetSummary.cwd).catch(() => ({ sessions: [] }));
    const existingIds = new Set((before.sessions || []).map((item) => item.sessionId));
    consoleBridge.send(target.contextId, { id: `fork-${Date.now()}`, type: "new_session", ...(sourcePath ? { parentSession: sourcePath } : {}) });
    const child = await waitForNewOmpSession(targetSummary.cwd, existingIds);
    const childId = gatewaySessionId(child.sessionId);
    const title = `${current.title || "Phiên làm việc mới"} · Fork`;
    const childPath = await findSessionPath(childId).catch(() => null);
    const stored = await updateChatMetadata(childId, { title, parentSessionId: id, path: childPath, cwd: child.cwd || targetSummary.cwd, createdAt: new Date().toISOString() });
    if (sourcePath) consoleBridge.send(target.contextId, { id: `switch-back-${Date.now()}`, type: "switch_session", sessionPath: sourcePath });
    return { success: true, action, sessionId: id, forkSession: chatSessionView({ id: childId, title, createdAt: stored.createdAt, updatedAt: stored.updatedAt }), status: "ready" };
  } else if (action === "share") {
    const shareMode = typeof body.shareMode === "string" && body.shareMode.trim() ? body.shareMode.trim() : "encrypted";
    if (shareMode === "local") {
      const shareUrl = `http://127.0.0.1:${PORT}/chat?session=${encodeURIComponent(id)}`;
      const stored = await updateChatMetadata(id, { sharedAt: new Date().toISOString(), shareStatus: "ready", shareMode, shareUrl }, { touchUpdatedAt: false });
      return { success: true, action, sessionId: id, metadata: stored, status: "ready", shareMode, shareUrl };
    }
    if (shareMode !== "encrypted") throw Object.assign(new Error(`Share mode chưa khả dụng: ${shareMode}`), { code: "CONFLICT", field: "shareMode" });
    const sourcePath = await resolveShareSessionPath(id, current, persisted, record);
    const shareUrl = await runOmpShare(sourcePath);
    const stored = await updateChatMetadata(id, { path: sourcePath, sharedAt: new Date().toISOString(), shareStatus: "ready", shareMode, shareUrl }, { touchUpdatedAt: false });
    return { success: true, action, sessionId: id, metadata: stored, status: "ready", shareMode, shareUrl };
  }
  const stored = await updateChatMetadata(id, patch, { touchUpdatedAt: false });
  const session = chatSessionView({ id, ...persisted, ...stored, createdAt: persisted?.createdAt || stored.createdAt || Date.now(), updatedAt: stored.updatedAt || persisted?.updatedAt || Date.now() });
  return { success: true, action, sessionId: id, session, metadata: stored };
}

async function streamChatTurn(req, res, requestUrl, input = {}) {
  const requestedAt = Date.now();
  const value = (key) => input?.[key] ?? requestUrl.searchParams.get(key);
  const sessionId = value("sessionId") || randomUUID();
  const prompt = chatPrompt(value("prompt"));
  const modelSource = chatModelSource(value("modelSource"));
  const modelProvider = chatModelProvider(value("modelProvider"));
  const requestedModel = chatModel(value("model"));
  const requestId = chatRequestId(value("requestId"));
  const tools = value("tools");
  const thinking = chatThinking(value("thinking"));
  const selectedBrowserMode = browserMode(value("browserMode"));
  const selectedApprovalMode = approvalMode(value("approvalMode"));
  const modelValidationStartedAt = Date.now();
  const { requestedModel: model, model: selectedModel } = await resolveChatModel(requestedModel, modelSource, modelProvider, sessionId, prompt);
  const modelValidationMs = Date.now() - modelValidationStartedAt;
  const quotaCheckStartedAt = Date.now();
  const quotaCheckMs = Date.now() - quotaCheckStartedAt;
  const attachments = normalizeChatAttachments(input?.attachments, { rejectInvalid: true });
  if (activeChatRequests.has(requestId)) throw Object.assign(new Error("requestId đang được xử lý"), { code: "CONFLICT" });
  const sessionReadyStartedAt = Date.now();
  const record = await ensureChatSession(sessionId, { approvalMode: selectedApprovalMode, browserMode: selectedBrowserMode, ...(tools != null ? { tools } : {}) });
  record.selectedChatModel = selectedModel;
  if (isQuotaGoogleChatModel(selectedModel)) {
    const { account, availability } = await selectedGeminiAccountState(sessionId);
    if (!availability.canUse) throw Object.assign(new Error(availability.reason), { code: "ACCOUNT_UNAVAILABLE", field: "accountId" });
    await pinGeminiSession(record, sessionId, account);
  }
  const sessionReadyMs = Date.now() - sessionReadyStartedAt;
  const timings = { preflightMs: Date.now() - requestedAt, modelValidationMs, quotaCheckMs, sessionReadyMs, modelSelectionMs: 0 };
  res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-store", connection: "keep-alive" });
  const sendEvent = (event, payload) => { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`); };
  const startedAt = Date.now();
  record.updatedAt = startedAt;
  const streamRequest = { requestId, sessionId, contextId: record.contextId, startedAt, stream: true, pendingTurns: 0, dispatched: false };
  activeChatRequests.set(requestId, streamRequest);
  let userMessagePersisted = false;
  const persistUserMessage = () => {
    if (userMessagePersisted) return;
    userMessagePersisted = true;
    appendChatMessage(sessionId, { id: `msg-${startedAt}`, role: "user", content: prompt, attachments, createdAt: new Date(startedAt).toISOString() });
  };
  const activityTimeoutMs = chatTurnTimeoutMs(prompt, selectedBrowserMode);
  const longRunning = activityTimeoutMs > CHAT_TURN_TIMEOUT_MS;
  sendEvent("start", { requestId, sessionId, model: selectedModel.id, imageModelAutoSelected: selectedModel.id !== model.id || selectedModel.provider !== model.provider, activityTimeoutSeconds: Math.ceil(activityTimeoutMs / 1000), longRunning });
  const expectsGeneratedImage = looksLikeImageGenerationPrompt(prompt);
  let reply = "";
  let assistantMessage = null;
  let assistantAttachments = [];
  const bodyBlocks = [];
  let bodySequence = 0;
  let timeToFirstDeltaMs = null;
  let ended = false;
  let unsubscribe = () => {};
  let promptDispatched = false;
  let localOnlyTimer = null;
  let localPromptResultEmitted = false;
  let timeout = null;
  let clientDisconnected = false;
  let queueEntry = null;
  const finish = (event, payload) => {
    if (ended) return;
    clearTimeout(localOnlyTimer);
    localOnlyTimer = null;
    if (timeout) clearTimeout(timeout);
    timeout = null;
    ended = true;
    const errorPayload = event === "error" ? publicStreamErrorPayload(payload) : payload;
    if (event === "error" && errorPayload?.code === "UPSTREAM_TIMEOUT") {
      streamRequest.abortRequested = true;
      try { consoleBridge.send(record.contextId, { id: `abort-${requestId}`, type: "abort" }); } catch { /* context may already be closed */ }
    }
    sendEvent(event, { requestId, ...errorPayload });
    activeChatRequests.delete(requestId);
    if (queueEntry?.started && (event === "error" || errorPayload?.aborted)) pauseChatTurnQueue(record.contextId, errorPayload?.aborted ? "previous_turn_aborted" : "previous_turn_failed");
    observeChatRequest(requestId, sessionId, startedAt, event === "end" ? "completed" : event, event === "error" ? errorPayload : null, { ...timings, ...(timeToFirstDeltaMs == null ? {} : { timeToFirstDeltaMs }) });
    unsubscribe();
    if (!res.writableEnded) res.end();
    if (queueEntry?.started) queueEntry.release?.();
    else queueEntry?.cancel?.();
    if (!clientDisconnected && promptDispatched && event === "error" && ["UPSTREAM_TIMEOUT", "UPSTREAM_ERROR"].includes(errorPayload?.code)) void recycleGatewaySession(record);
  };
  const resetTurnTimeout = () => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => finish("error", { code: "UPSTREAM_TIMEOUT", message: "OMP không trả lời trong thời gian cho phép" }), activityTimeoutMs);
  };
  streamRequest.abort = () => finish("end", {
    sessionId,
    model: selectedModel.id,
    totalDuration: `${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
    totalTokens: 0,
    aborted: true,
    done: true,
  });
  const finishLocalOnly = () => {
    const messageId = bodyBlocks.length ? `msg-${Date.now()}` : null;
    if (messageId) appendChatMessage(sessionId, { id: messageId, role: "assistant", content: "", model: selectedModel.id, createdAt: new Date().toISOString(), body: bodyBlocks });
    finish("end", {
      sessionId,
      model: selectedModel.id,
      totalDuration: `${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
      totalTokens: 0,
      ...(messageId ? { messageId, body: bodyBlocks } : {}),
      localOnly: true,
      done: true,
    });
  };
  const waitForRequestSlot = async () => {
    let lastNotice = -1;
    while (!ended) {
      const bridgeState = consoleBridge.state();
      const contextState = bridgeState.contexts.find((item) => item.id === record.contextId);
      const safety = contextState?.safety || bridgeState.safety || {};
      const blockedUntil = Number(safety.blockedUntil || 0);
      const nextRequestAt = Number(safety.nextRequestAt || 0);
      const waitMs = safety.blocked ? Math.max(1000, blockedUntil - Date.now()) : Math.max(0, nextRequestAt - Date.now());
      if (!safety.blocked && waitMs <= 0) return;
      const seconds = Math.max(1, Math.ceil(waitMs / 1000));
      if (seconds !== lastNotice) {
        lastNotice = seconds;
        const phase = safety.blocked ? "safety_cooldown" : "safety_gap";
        const snapshot = { phase, queueAhead: 0, queuedTurns: pendingChatTurns(chatTurnQueues.get(record.contextId)).length, retryAfterSeconds: seconds, reason: safety.blocked ? "safety_guard_cooldown" : "safety_guard_gap" };
        sendEvent("waiting", { requestId, sessionId, ...snapshot, message: queueWaitingMessage(snapshot) });
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000, Math.max(250, waitMs))));
    }
    throw Object.assign(new Error("Client đã đóng kết nối"), { code: "CLIENT_CLOSED" });
  };
  unsubscribe = subscribeGatewayFrames(record, (event, frame) => {
    if (ended) return;
    if (event === "bridge_error") {
      if (streamRequest.dispatched && chatTurnOwner(record.contextId, requestId)) finish("error", { code: "UPSTREAM_ERROR", message: frame.message || "OMP bridge error" });
      return;
    }
    if (event !== "omp" || !streamRequest.dispatched || !chatTurnOwner(record.contextId, requestId)) return;
    resetTurnTimeout();
    const bodyFrames = chatBodyBlocksFromFrame(frame, requestId, bodySequence++);
    for (const block of bodyFrames) {
      const mergedBlock = mergeChatBodyBlock(bodyBlocks, block);
      if (mergedBlock) sendEvent("body", { requestId, sessionId, block: mergedBlock });
    }
    if (frame.type === "extension_ui_request") {
      const approval = approvalRequest(sessionId, record.contextId, frame);
      if (approval) sendEvent("approval", approval);
      return;
    }
    if (frame.type === "command_output") {
      const commandBlock = bodyFrames.find((block) => block.kind === "command");
      sendEvent("command_output", { requestId, sessionId, ...frameCommandOutput(frame), ...(commandBlock?.id ? { bodyBlockId: commandBlock.id } : {}) });
    }
    if (frame.type === "response" && frame.command === "prompt" && frame.success && frame.data?.agentInvoked === false) {
      localOnlyTimer = setTimeout(finishLocalOnly, LOCAL_PROMPT_RESULT_GRACE_MS);
      return;
    }
    if (frame.type === "prompt_result") {
      if (!localPromptResultEmitted) {
        localPromptResultEmitted = true;
        sendEvent("prompt_result", { requestId, sessionId, id: frame.id || null, agentInvoked: frame.agentInvoked === true });
      }
      if (frame.agentInvoked === false) return finishLocalOnly();
    }
    if (["agent_start", "turn_start", "turn_end", "tool_call", "tool_result", "approval_request", "permission_request", "status", "agent_end"].includes(frame.type)) {
      sendEvent("lifecycle", { requestId, sessionId, type: frame.type, isTerminal: frame.type === "agent_end" ? frame.isTerminal !== false : undefined, tool: frame.tool?.name || frame.toolName || null, status: frame.status || null });
    }
    const failure = chatFrameFailure(frame);
    if (failure) return finish("error", failure);
    const update = frame.assistantMessageEvent;
    const frameAttachments = frameAssistantAttachments(frame);
    if (frameAttachments.length) {
      assistantAttachments = mergeChatAttachments(assistantAttachments, frameAttachments);
      sendEvent("media", { requestId, sessionId, attachments: frameAttachments });
    }
    if (frame.type === "message_update" && update?.type === "text_delta") {
      const chunk = String(update.delta || "");
      reply += chunk;
      if (chunk && timeToFirstDeltaMs == null) timeToFirstDeltaMs = Date.now() - requestedAt;
      if (chunk) sendEvent("delta", { requestId, sessionId, content: chunk, delta: chunk, done: false });
    }
    if (frame.type === "message_end" && frame.message?.role === "assistant") {
      assistantMessage = frame.message;
      const full = chatMessageText(frame.message);
      if (full && !reply) { reply = full; sendEvent("delta", { requestId, sessionId, content: full, delta: full, done: false }); }
    }
    if (frame.type === "agent_end" && frame.isTerminal !== false) {
      if (streamRequest.abortRequested) {
        finish("end", {
          sessionId,
          model: selectedModel.id,
          totalDuration: `${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
          totalTokens: 0,
          aborted: true,
          done: true,
        });
        return;
      }
      assistantMessage = assistantMessage || frameAssistantMessage(frame);
      if (!reply && !assistantMessage && !assistantAttachments.length) return finish("error", { code: "UPSTREAM_ERROR", message: "OMP kết thúc lượt nhưng không trả nội dung" });
      if (expectsGeneratedImage && !assistantAttachments.length) return finish("error", { code: "UPSTREAM_IMAGE_MISSING", message: "OMP không trả ảnh đầu ra; lượt này chưa được tính là đã tạo ảnh." });
      for (const block of chatBodyBlocksFromMessage(assistantMessage, requestId)) mergeChatBodyBlock(bodyBlocks, block);
      reply = chatMessageText(assistantMessage) || reply;
      const createdAt = new Date().toISOString();
      const messageId = `msg-${Date.now()}`;
      appendChatMessage(sessionId, { id: messageId, role: "assistant", content: reply, model: assistantMessage?.model || selectedModel.id, createdAt, ...(bodyBlocks.length ? { body: bodyBlocks } : {}), ...(assistantAttachments.length ? { attachments: assistantAttachments } : {}), ...(assistantMessage?.usage?.total ? { totalTokens: assistantMessage.usage.total } : {}) });
      const totalTokens = assistantMessage?.usage?.total || 0;
      if (streamRequest.pendingTurns > 0) {
        streamRequest.pendingTurns -= 1;
        reply = "";
        assistantMessage = null;
        assistantAttachments = [];
        bodyBlocks.splice(0, bodyBlocks.length);
        bodySequence = 0;
        return;
      }
      finish("end", { sessionId, messageId, model: assistantMessage?.model || selectedModel.id, totalDuration: `${((Date.now() - startedAt) / 1000).toFixed(1)}s`, totalTokens, ...(bodyBlocks.length ? { body: bodyBlocks } : {}), ...(assistantAttachments.length ? { attachments: assistantAttachments } : {}), done: true });
      const rememberTimer = setTimeout(() => { void rememberGatewaySession(record).catch(() => {}); }, 10000);
      rememberTimer.unref?.();
    }
  });
  queueEntry = {
    requestId,
    onQueueState(snapshot) {
      streamRequest.queueState = snapshot;
      if (!ended) sendEvent("waiting", { requestId, sessionId, ...snapshot });
    },
    onQueueFailure(error) {
      if (!ended) finish("error", { code: error.code || "UPSTREAM_ERROR", message: error.message });
    },
    async run() {
      persistUserMessage();
      try {
        while (!ended) {
          await waitForRequestSlot();
          let dispatched = false;
          await withChatDispatchGate(async () => {
            const bridgeState = consoleBridge.state();
            const contextState = bridgeState.contexts.find((item) => item.id === record.contextId);
            const safety = contextState?.safety || bridgeState.safety || {};
            const blockedUntil = Number(safety.blockedUntil || 0);
            const nextRequestAt = Number(safety.nextRequestAt || 0);
            const waitMs = safety.blocked ? Math.max(1000, blockedUntil - Date.now()) : Math.max(0, nextRequestAt - Date.now());
            if (ended || safety.blocked || waitMs > 0) return;
            consoleBridge.send(record.contextId, { id: `model-${startedAt}`, type: "set_model", provider: selectedModel.provider, modelId: selectedModel.id });
            if (thinking) consoleBridge.send(record.contextId, { id: `thinking-${startedAt}`, type: "set_thinking_level", level: thinking });
            const images = attachments.filter((item) => item.data && /^image\//.test(item.type)).map((item) => item.data);
            const attachmentContext = attachments.filter((item) => item.text).map((item) => `\n\n[Attached file: ${item.name}]\n${item.text}`).join("");
            const outboundMessage = `${browserPrompt(prompt, selectedBrowserMode, images.length > 0)}${attachmentContext}${imageOutputInstruction(prompt)}`;
            consoleBridge.send(record.contextId, { id: `prompt-${startedAt}`, type: "prompt", message: outboundMessage, ...(images.length ? { images } : {}) });
            streamRequest.dispatched = true;
            streamRequest.promptDispatched = true;
            promptDispatched = true;
            dispatched = true;
            resetTurnTimeout();
          });
          if (dispatched || ended) break;
        }
      } catch (error) {
        if (!ended) finish("error", { code: error.code || "UPSTREAM_ERROR", message: error.message });
        return;
      }
      await new Promise((resolve) => {
        queueEntry.release = resolve;
        if (ended) resolve();
      });
    },
  };
  streamRequest.queueEntry = queueEntry;
  const handleClientDisconnect = () => {
    if (clientDisconnected) return;
    clientDisconnected = true;
    if (!queueEntry?.started || !promptDispatched) {
      finish("error", { code: "CLIENT_CLOSED", message: "Client đã đóng kết nối" });
      return;
    }
    streamRequest.abortRequested = true;
    try { consoleBridge.send(record.contextId, { id: `abort-${requestId}`, type: "abort" }); } catch { /* context may already be closed */ }
    const queue = chatTurnQueues.get(record.contextId);
    if (!queue?.pending.length) {
      finish("end", { sessionId, model: selectedModel.id, totalDuration: `${((Date.now() - startedAt) / 1000).toFixed(1)}s`, totalTokens: 0, aborted: true, done: true });
      void recycleGatewaySession(record);
    }
  };
  req.on("aborted", handleClientDisconnect);
  res.on("close", () => { if (!res.writableEnded) handleClientDisconnect(); });
  void enqueueChatTurn(record.contextId, queueEntry).catch((error) => {
    if (!ended) finish("error", { code: error.code || "UPSTREAM_ERROR", message: error.message });
  });
}

function withinRoot(root, value) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0") || !isAbsolute(value)) return false;
  const rel = relative(resolve(root), resolve(value));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function gatewayCommand(body, protocol = "rpc") {
  const command = body?.command && typeof body.command === "object" && !Array.isArray(body.command)
    ? { ...body.command }
    : body;
  if (protocol === "acp" && !ACP_GATEWAY_COMMANDS.has(command?.type)) {
    throw Object.assign(new Error(`OMP ACP command không được hỗ trợ: ${command?.type || "trống"}`), { code: "UNSUPPORTED_ACTION", field: "command.type" });
  }
  if (!GATEWAY_COMMANDS.has(command?.type)) throw Object.assign(new Error(`Gateway command không được hỗ trợ: ${command?.type || "trống"}`), { code: "BAD_REQUEST", field: "command.type" });
  if (BLOCKED_BROWSER_COMMANDS.has(command.type)) throw Object.assign(new Error("Command này không được gọi trực tiếp từ browser"), { code: "FORBIDDEN", field: "command.type" });
  if (command.id != null && (typeof command.id !== "string" || command.id.length > 120)) throw Object.assign(new Error("command.id không hợp lệ"), { code: "BAD_REQUEST", field: "command.id" });
  if (command.type === "set_thinking_level" && !OMP_THINKING_LEVELS.has(command.level)) throw Object.assign(new Error("thinking level không hợp lệ"), { code: "BAD_REQUEST", field: "command.level" });
  if (command.type === "set_model" && (typeof command.modelId !== "string" || command.modelId.length > 160 || (command.provider != null && typeof command.provider !== "string"))) throw Object.assign(new Error("model command không hợp lệ"), { code: "BAD_REQUEST", field: "command.modelId" });
  if (["set_fast_mode", "set_auto_compaction", "set_auto_retry"].includes(command.type) && typeof command.enabled !== "boolean") throw Object.assign(new Error("enabled phải là boolean"), { code: "BAD_REQUEST", field: "command.enabled" });
  if (command.type === "set_steering_mode" && !["all", "one-at-a-time"].includes(command.mode)) throw Object.assign(new Error("steering mode không hợp lệ"), { code: "BAD_REQUEST", field: "command.mode" });
  if (command.type === "set_follow_up_mode" && !["all", "one-at-a-time"].includes(command.mode)) throw Object.assign(new Error("follow-up mode không hợp lệ"), { code: "BAD_REQUEST", field: "command.mode" });
  if (command.type === "set_interrupt_mode" && !["immediate", "wait"].includes(command.mode)) throw Object.assign(new Error("interrupt mode không hợp lệ"), { code: "BAD_REQUEST", field: "command.mode" });
  if (["set_session_name"].includes(command.type) && (typeof command.name !== "string" || !command.name.trim() || command.name.length > 200)) throw Object.assign(new Error("session name không hợp lệ"), { code: "BAD_REQUEST", field: "command.name" });
  if (["compact", "handoff"].includes(command.type) && command.customInstructions != null && (typeof command.customInstructions !== "string" || command.customInstructions.length > 4000)) throw Object.assign(new Error("customInstructions vượt quá giới hạn"), { code: "BAD_REQUEST", field: "command.customInstructions" });
  if (command.type === "switch_session" && (!withinRoot(OMP_SESSION_ROOT, command.sessionPath) || command.sessionPath.length > 1000)) throw Object.assign(new Error("sessionPath không hợp lệ"), { code: "BAD_REQUEST", field: "command.sessionPath" });
  if (command.type === "new_session" && command.parentSession != null && (!withinRoot(OMP_SESSION_ROOT, command.parentSession) || command.parentSession.length > 1000)) throw Object.assign(new Error("parentSession không hợp lệ"), { code: "BAD_REQUEST", field: "command.parentSession" });
  if (command.type === "branch" && (typeof command.entryId !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(command.entryId))) throw Object.assign(new Error("entryId không hợp lệ"), { code: "BAD_REQUEST", field: "command.entryId" });
  if (command.type === "set_subagent_subscription" && !["off", "progress", "events"].includes(command.level)) throw Object.assign(new Error("subagent subscription không hợp lệ"), { code: "BAD_REQUEST", field: "command.level" });
  if (command.type === "set_todos" && (!Array.isArray(command.phases) || command.phases.length > 200 || JSON.stringify(command.phases).length > 262144)) throw Object.assign(new Error("phases không hợp lệ hoặc vượt giới hạn"), { code: "BAD_REQUEST", field: "command.phases" });
  if (command.type === "extension_ui_response" && (typeof command.id !== "string" || command.id.length > 120 || (command.cancelled != null && typeof command.cancelled !== "boolean") || (command.confirmed != null && typeof command.confirmed !== "boolean") || (command.value != null && (typeof command.value !== "string" || command.value.length > 10000)))) throw Object.assign(new Error("extension response không hợp lệ"), { code: "BAD_REQUEST", field: "command" });
  return command;
}

function gatewayPrompt(body) {
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) throw new Error("message là bắt buộc");
  if (message.length > 900000) throw new Error("message vượt quá giới hạn");
  const behavior = ["prompt", "steer", "follow_up"].includes(body.behavior) ? body.behavior : "prompt";
  const useEgoBrowser = body.useEgoBrowser === true;
  const outboundMessage = useEgoBrowser && !message.startsWith("/skill:ego-browser")
    ? `/skill:ego-browser ${message}`
    : message;
  return { type: behavior, message: outboundMessage, ...(Array.isArray(body.images) ? { images: body.images } : {}) };
}

async function readDashboardAsset(name, nonce = "") {
  const injectNonce = (asset) => nonce && name.endsWith(".html")
    ? asset.replace(/<script(?![^>]*\bnonce=)(?=\s|>)/gi, `<script nonce="${nonce}"`)
    : asset;
  try { return injectNonce(await readFile(join(SOURCE_ROOT, name), "utf8")); }
  catch (error) {
    if (ROOT === SOURCE_ROOT) throw error;
    return injectNonce(await readFile(join(ROOT, name), "utf8"));
  }
}

async function readDashboardBinary(name) {
  try { return await readFile(join(SOURCE_ROOT, name)); }
  catch (error) {
    if (ROOT === SOURCE_ROOT) throw error;
    return readFile(join(ROOT, name));
  }
}

async function jsonBody(req) {
  try { return await readJsonBody(req); }
  catch (error) { throw Object.assign(new Error(`JSON không hợp lệ: ${error.message}`), { code: "BAD_REQUEST" }); }
}

function json(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(safeErrorPayload(res, payload)));
}

const QUOTA_HISTORY_SCOPES = new Map([
  ["1h", 60 * 60 * 1000],
  ["24h", 24 * 60 * 60 * 1000],
  ["7d", 7 * 24 * 60 * 60 * 1000],
  ["30d", 30 * 24 * 60 * 60 * 1000],
]);

function quotaAccountId(account) {
  return `acc-${credentialPinHash(account).slice(0, 12)}`;
}

function isGeminiQuotaAccount(account) {
  return String(account?.provider || "").toLowerCase() === LOGIN_PROVIDER;
}

function geminiQuotaAccounts() {
  return (latest.accounts || []).filter(isGeminiQuotaAccount);
}

function quotaAccountEntitlement(account) {
  const limits = account.limits || [];
  const hasGoogle = limits.some(isGoogleQuotaLimit);
  const hasShared = limits.some((limit) => Boolean(limit.shared) || /claude.*gpt|gpt.*claude|shared/i.test(`${limit?.id || ""} ${limit?.label || ""}`));
  const hasClaude = limits.some((limit) => /claude|anthropic/i.test(`${limit?.id || ""} ${limit?.label || ""}`));
  const hasGpt = limits.some((limit) => /gpt|openai/i.test(`${limit?.id || ""} ${limit?.label || ""}`));
  const missing = [
    !hasGoogle ? "quota Google/Gemini" : null,
    !(hasShared || (hasClaude && hasGpt)) ? "quota Claude và GPT" : null,
  ].filter(Boolean);
  return {
    eligible: isGeminiQuotaAccount(account) && !missing.length,
    reason: missing.length
      ? `OMP chưa trả ${missing.join(", ")}; chưa đủ capability để dùng đầy đủ model Google, Claude và GPT`
      : "Đủ capability OMP cho Google, Claude và GPT",
  };
}

function eligibleGeminiQuotaAccounts() {
  return geminiQuotaAccounts().filter((account) => quotaAccountEntitlement(account).eligible);
}

function isGeminiModel(model) {
  return /\bgemini\b/i.test(`${model?.id || ""} ${model?.name || ""}`);
}

function isQuotaGoogleChatModel(model) {
  const provider = String(model?.provider || "").toLowerCase();
  return provider === LOGIN_PROVIDER
    || (GEMINI_PROVIDER_KEYS.has(provider) && isGeminiModel(model));
}

function quotaSessionId(value) {
  if (value == null || String(value).trim() === "") return null;
  return gatewaySessionId(String(value).trim());
}

async function readGeminiSelection(sessionId = null) {
  const metadata = await readChatMetadata();
  const hasStoredSession = Boolean(sessionId && Object.hasOwn(metadata.sessions, sessionId));
  const liveSession = sessionId ? liveGatewayRecord(sessionId) : null;
  let hasPersistedSession = false;
  if (sessionId && !hasStoredSession && !liveSession) {
    try {
      await findSessionPath(sessionId);
      hasPersistedSession = true;
    } catch (error) {
      if (error.message !== "Không tìm thấy session OMP") throw error;
    }
  }
  const hasExistingSession = hasStoredSession || Boolean(liveSession) || hasPersistedSession;
  const session = hasStoredSession ? metadata.sessions[sessionId] || {} : {};
  const sessionAccountId = typeof session.geminiAccountId === "string" ? session.geminiAccountId.trim() : "";
  const snapshotAccountId = typeof session.geminiDefaultAccountIdAtCreation === "string" ? session.geminiDefaultAccountIdAtCreation.trim() : "";
  const isSessionPinned = Boolean(sessionAccountId);
  const inheritCurrentDefault = !isSessionPinned && !hasExistingSession;
  const accountId = isSessionPinned
    ? sessionAccountId
    : snapshotAccountId || (inheritCurrentDefault && typeof metadata.geminiDefaultAccountId === "string" ? metadata.geminiDefaultAccountId.trim() : "");
  return {
    sessionId,
    accountId,
    provider: isSessionPinned
      ? session.geminiProvider || ""
      : snapshotAccountId
        ? session.geminiDefaultProviderAtCreation || ""
        : inheritCurrentDefault ? metadata.geminiDefaultProvider || "" : "",
    selectedAt: isSessionPinned
      ? session.geminiAccountSelectedAt || null
      : snapshotAccountId
        ? session.geminiDefaultSelectedAtAtCreation || null
        : inheritCurrentDefault ? metadata.geminiDefaultSelectedAt || null : null,
    scope: isSessionPinned ? "session" : accountId ? "default" : "none",
  };
}

async function selectedGeminiAccountState(sessionId = null) {
  await ensureQuotaLatest();
  const selection = await readGeminiSelection(sessionId);
  if (!selection.accountId) throw Object.assign(new Error("Chọn thủ công một tài khoản Gemini trước khi dùng model Gemini"), { code: "ACCOUNT_SELECTION_REQUIRED", field: "accountId" });
  const account = geminiQuotaAccounts().find((item) => quotaAccountId(item) === selection.accountId);
  if (!account) throw Object.assign(new Error("Tài khoản Gemini đã chọn không còn khả dụng; hãy chọn lại thủ công"), { code: "ACCOUNT_UNAVAILABLE", field: "accountId" });
  return { account, availability: quotaAccountAvailability(account), selection };
}

async function updateGeminiDefaultAccount(account) {
  const operation = chatMetadataWrite.then(async () => {
    const metadata = await readChatMetadata();
    metadata.geminiDefaultAccountId = quotaAccountId(account);
    metadata.geminiDefaultProvider = account.provider;
    metadata.geminiDefaultSelectedAt = Date.now();
    await writeChatMetadata(metadata);
    return metadata;
  });
  chatMetadataWrite = operation.catch(() => {});
  return operation;
}

async function clearGeminiDefaultAccount(accountId) {
  const operation = chatMetadataWrite.then(async () => {
    const metadata = await readChatMetadata();
    if (metadata.geminiDefaultAccountId !== accountId) return metadata;
    delete metadata.geminiDefaultAccountId;
    delete metadata.geminiDefaultProvider;
    delete metadata.geminiDefaultSelectedAt;
    await writeChatMetadata(metadata);
    return metadata;
  });
  chatMetadataWrite = operation.catch(() => {});
  return operation;
}

function selectedQuotaAccount(accounts, selected, preferredEmail) {
  const accountList = Array.isArray(accounts) ? accounts : [];
  const selectedId = String(selected?.accountId || "").trim();
  if (selectedId) {
    const match = accountList.find((account) => quotaAccountId(account) === selectedId);
    if (match) return match;
  }
  const email = String(selected?.email || preferredEmail || "").trim().toLowerCase();
  const provider = String(selected?.provider || "").trim().toLowerCase();
  const matches = email ? accountList.filter((account) => account.email?.toLowerCase() === email) : [];
  if (email && provider) {
    return matches.find((account) => account.provider?.toLowerCase() === provider) || null;
  }
  if (email) return matches.length === 1 ? matches[0] : null;
  if (selectedId || provider) return null;
  return accountList[0] || null;
}

function quotaRound(value) {
  return Number.isFinite(Number(value)) ? Math.round(Number(value) * 10) / 10 : 0;
}

function quotaDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0p";
  let minutes = Math.max(1, Math.ceil(ms / 60000));
  const days = Math.floor(minutes / 1440);
  minutes %= 1440;
  const hours = Math.floor(minutes / 60);
  minutes %= 60;
  return [days ? `${days}n` : "", hours ? `${hours}g` : "", minutes ? `${minutes}p` : ""].filter(Boolean).join(" ") || "1p";
}

function quotaFormatNumber(value) {
  const numberValue = Math.max(0, Math.round(Number(value) || 0));
  return numberValue.toLocaleString("en-US");
}

function quotaFormatCompact(value) {
  const numberValue = Math.max(0, Number(value) || 0);
  if (numberValue >= 1_000_000_000) return `${(numberValue / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (numberValue >= 1_000_000) return `${(numberValue / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (numberValue >= 1_000) return `${(numberValue / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(numberValue));
}

function quotaTimeAgo(timestamp, now = Date.now()) {
  const ageMs = Math.max(0, now - new Date(timestamp).getTime());
  if (ageMs < 60_000) return "<1p";
  return quotaDuration(ageMs);
}

function quotaTokenAge(timestamp, now = Date.now()) {
  const ageMs = Math.max(0, now - new Date(timestamp).getTime());
  if (ageMs < 60_000) return "chưa đến 1 phút";
  let minutes = Math.floor(ageMs / 60_000);
  const days = Math.floor(minutes / 1440);
  minutes %= 1440;
  const hours = Math.floor(minutes / 60);
  minutes %= 60;
  return [days ? `${days} ngày` : "", hours ? `${hours} giờ` : "", minutes ? `${minutes} phút` : ""].filter(Boolean).join(" ") || "1 phút";
}

function quotaLimit(account, predicate) {
  return [...(account.limits || [])]
    .filter(predicate)
    .sort((a, b) => Number(b.usedFraction || 0) - Number(a.usedFraction || 0))[0] || null;
}

function isGoogleQuotaLimit(limit) {
  return /gemini|google/i.test(`${limit?.id || ""} ${limit?.label || ""}`);
}

function isGeminiQuotaLimit(limit) {
  return isGoogleQuotaLimit(limit);
}

function isWeeklyLimit(limit) {
  return /weekly|week/i.test(`${limit?.id || ""} ${limit?.window || ""}`);
}

function isFiveHourLimit(limit) {
  return /5h|5 hour|five hour/i.test(`${limit?.id || ""} ${limit?.window || ""}`);
}

function isDailyLimit(limit) {
  return /daily|day|24h/i.test(`${limit?.id || ""} ${limit?.window || ""}`);
}

function isSharedLimit(limit) {
  return Boolean(limit?.shared) || /3p|claude|gpt|anthropic|openai/i.test(`${limit?.id || ""} ${limit?.label || ""}`);
}

function quotaWindowLimit(account, kind) {
  const limits = (account.limits || []).filter((limit) => {
    const gemini = isGeminiQuotaLimit(limit);
    const shared = isSharedLimit(limit);
    if (kind === "gemini5h") return gemini && isFiveHourLimit(limit);
    if (kind === "geminiWeek") return gemini && isWeeklyLimit(limit);
    if (kind === "geminiDaily") return gemini && isDailyLimit(limit);
    if (kind === "claude5h") return shared && isFiveHourLimit(limit);
    if (kind === "claudeWeek") return shared && isWeeklyLimit(limit);
    if (kind === "claudeDaily") return shared && isDailyLimit(limit);
    return false;
  });
  return limits.sort((a, b) => Number(b.usedFraction || 0) - Number(a.usedFraction || 0))[0] || null;
}


function quotaProviderLabel(provider) {
  if (provider === "google-gemini-cli") return "Google Gemini CLI · Cloud Code Assist OAuth";
  if (provider === "google-antigravity") return "Google Antigravity · Cloud Code Assist OAuth";
  return String(provider || "OMP");
}

function quotaAccountWindows(account) {
  return {
    fiveHour: quotaWindowLimit(account, "gemini5h"),
    weekly: quotaWindowLimit(account, "geminiWeek"),
    daily: quotaWindowLimit(account, "geminiDaily"),
  };
}

function quotaAccountStatus(account, quotas = quotaAccountWindows(account)) {
  const { fiveHour, weekly, daily } = quotas;
  const primary = fiveHour || daily || weekly;
  const primaryLabel = daily && !fiveHour ? "quota ngày" : fiveHour ? "quota 5 giờ" : "quota tuần";
  const entitlement = quotaAccountEntitlement(account);
  if (!entitlement.eligible) return { code: "entitlement_unverified", label: "Thiếu capability model", reason: entitlement.reason };
  if (account.authStatus && account.authStatus !== "authenticated") {
    const accessDenied = account.authStatus === "access_denied";
    return { code: accessDenied ? "access_error" : "auth_error", label: accessDenied ? "Google từ chối quyền" : "OAuth lỗi", reason: account.authReason || (accessDenied ? "Google từ chối quyền, policy, API hoặc license" : "OAuth cần đăng nhập lại") };
  }
  if (["auth_error", "access_error"].includes(account.generationStatus)) return { code: account.generationStatus, label: account.generationStatus === "access_error" ? "Google từ chối quyền" : "OAuth lỗi", reason: account.generationReason || "Google từ chối yêu cầu" };
  if (account.generationStatus === "error") {
    return { code: "chat_error", label: "Không thể chat", reason: account.generationReason || "Lần chat gần nhất không sinh được nội dung" };
  }
  if (!primary) return { code: "quota_unknown", label: "Thiếu quota Google", reason: "OMP chưa trả quota Google/Gemini có cửa sổ sử dụng" };
  if (account.generationStatus === "transient_error") return { code: "transient_error", label: "Lỗi tạm thời", reason: account.generationReason || "Google/service hoặc mạng lỗi tạm thời" };
  const primaryPct = Number(primary.usedFraction || 0) * 100;
  const weeklyPct = Number(weekly?.usedFraction || 0) * 100;
  const usedPct = Math.max(primaryPct, weeklyPct);
  const windowLabel = weeklyPct > primaryPct ? "quota tuần" : primaryLabel;
  if (usedPct >= 100) return { code: "exhausted", label: "Hết quota", reason: `${windowLabel} đã dùng hết` };
  if (usedPct >= QUOTA_SUSPEND_THRESHOLD * 100) return { code: "danger", label: "Tạm ngưng ≥90%", reason: `${windowLabel} đã dùng ${quotaRound(usedPct)}%; cần chọn account Gemini thủ công khác` };
  if (["blocked", "quota_blocked"].includes(account.generationStatus)) {
    return { code: "warning", label: "429 trước đó · quota live OK", reason: `${account.generationReason || "Google từng giới hạn quota/rate limit"} · quota live hiện ${quotaRound(usedPct)}%; không có Safety Guard cooldown` };
  }
  if (usedPct > QUOTA_WARNING_THRESHOLD * 100) return { code: "warning", label: "Cảnh báo >80%", reason: `${windowLabel} đã dùng ${quotaRound(usedPct)}%` };
  if (account.generationStatus === "unknown") return { code: "generation_unknown", label: "Chưa xác minh", reason: "Chưa có lượt sinh nội dung gần đây để xác minh trạng thái chat" };
  return { code: "normal", label: "Bình thường (OK)", reason: `${primaryLabel} đang ở ${quotaRound(primaryPct)}%${weekly ? ` · quota tuần ${quotaRound(weeklyPct)}%` : ""}` };
}

function quotaAccountAvailability(account, quotas = quotaAccountWindows(account)) {
  if (!isGeminiQuotaAccount(account)) return { canUse: false, status: "provider_unsupported", label: "Provider không được Quota hỗ trợ", reason: "Quota chỉ cho phép tài khoản Google Antigravity." };
  const entitlement = quotaAccountEntitlement(account);
  if (!entitlement.eligible) return { canUse: false, status: "entitlement_unverified", label: "Thiếu capability model", reason: entitlement.reason };
  const { fiveHour, weekly, daily } = quotas;
  const primary = fiveHour || daily || weekly;
  const primaryLabel = daily && !fiveHour ? "ngày" : fiveHour ? "5 giờ" : "tuần";
  const status = quotaAccountStatus(account, quotas);
  if (["auth_error", "access_error", "quota_blocked", "chat_error"].includes(status.code)) return { canUse: false, status: status.code, label: status.label, reason: status.reason };
  if (!primary) return { canUse: false, status: "quota_unknown", label: status.label, reason: status.reason };
  if (status.code === "transient_error") return { canUse: true, status: status.code, label: "Lỗi tạm thời · có thể thử lại", reason: `${status.reason} · có thể thử lại ngay` };
  const primaryPct = Number(primary.usedFraction || 0) * 100;
  const weeklyPct = Number(weekly?.usedFraction || 0) * 100;
  const usedPct = Math.max(primaryPct, weeklyPct);
  if (usedPct >= QUOTA_SUSPEND_THRESHOLD * 100) return { canUse: false, status: "quota_suspended", label: "Tạm ngưng · quota ≥90%", reason: `Google Protect tạm ngưng vì quota ${quotaRound(usedPct)}% (≥90%); có thể xoay account mặc định nếu bật xoay tự động` };
  if (usedPct > QUOTA_WARNING_THRESHOLD * 100) return { canUse: true, status: "quota_warning", label: "Cảnh báo >80%", reason: `Quota cao ${quotaRound(usedPct)}%; vẫn dùng được dưới 90%` };
  return { canUse: true, status: "available", label: "Có thể sử dụng", reason: `Quota ${primaryLabel} đang ở ${quotaRound(usedPct)}%` };
}

async function activeQuotaAccountState(sessionId = null) {
  return selectedGeminiAccountState(sessionId);
}

function quotaProviderModels(provider, models) {
  const key = String(provider || "").toLowerCase();
  if (key !== LOGIN_PROVIDER) return [];
  return models.filter((model) => String(model?.provider || "").toLowerCase() === key);
}

async function quotaModelsPayload(sessionId = null) {
  const { account, availability } = await selectedGeminiAccountState(sessionId);
  return {
    account: {
      id: quotaAccountId(account),
      providerKey: account.provider,
      provider: quotaProviderLabel(account.provider),
      canUse: availability.canUse,
      availabilityStatus: availability.status,
      availabilityLabel: availability.label,
      availabilityReason: availability.reason,
    },
    models: quotaProviderModels(account.provider, await availableModels()),
  };
}

async function assertActiveQuotaAvailable(sessionId = null) {
  const state = await selectedGeminiAccountState(sessionId);
  if (!state.availability.canUse) throw Object.assign(new Error(state.availability.reason), { code: "ACCOUNT_UNAVAILABLE", field: "accountId" });
  return state;
}

async function authorizeChatCommand(command, record = null, sessionId = null) {
  const modelSource = chatModelSource(command.modelSource);
  delete command.modelSource;
  const id = quotaSessionId(sessionId ?? record?.sessionId ?? null);
  let selectedModel = record?.selectedChatModel || null;
  if (command.type === "set_model") {
    const modelProvider = chatModelProvider(command.provider);
    ({ model: selectedModel } = await resolveChatModel(chatModel(command.modelId), modelSource, modelProvider, id));
    command.modelId = selectedModel.id;
    command.provider = selectedModel.provider;
    if (record) record.selectedChatModel = selectedModel;
  }
  if (modelSource === "quota" && isQuotaGuardedCommand(command.type) && !isQuotaGoogleChatModel(selectedModel)) {
    throw Object.assign(new Error("Nguồn Quota chỉ cho phép model thuộc Google Antigravity đang chọn"), { code: "MODEL_NOT_ALLOWED_BY_QUOTA", field: "model" });
  }
  if (isQuotaGoogleChatModel(selectedModel) && (command.type === "set_model" || isQuotaGuardedCommand(command.type))) {
    if (!record || !id) throw Object.assign(new Error("Cần chat dashboard có session để ghim account Google"), { code: "ACCOUNT_SELECTION_REQUIRED", field: "sessionId" });
    const { account, availability } = await selectedGeminiAccountState(id);
    if (!availability.canUse) throw Object.assign(new Error(availability.reason), { code: "ACCOUNT_UNAVAILABLE", field: "accountId" });
    if (command.type === "set_model" || command.type === "prompt") {
      if (contextHasChatWork(record.contextId)) throw Object.assign(new Error("Không thể ghim account Gemini khi session đang có lượt chạy"), { code: "CONFLICT" });
      await pinGeminiSession(record, id, account);
    } else {
      const pin = await readGeminiSelection(id);
      if (pin.scope !== "session" || pin.accountId !== quotaAccountId(account) || pin.provider !== account.provider) {
        throw Object.assign(new Error("Session Gemini chưa được ghim vào account đã chọn"), { code: "ACCOUNT_UNAVAILABLE", field: "accountId" });
      }
    }
  } else if (modelSource === "quota" && isQuotaGuardedCommand(command.type)) {
    throw Object.assign(new Error("Nguồn Quota chỉ cho phép model thuộc account đang chọn"), { code: "MODEL_NOT_ALLOWED_BY_QUOTA", field: "model" });
  }
  if (modelSource === "quota" && isQuotaGuardedCommand(command.type)) await assertActiveQuotaAvailable(id);
  return command;
}


function isQuotaGuardedCommand(type) {
  return ["prompt", "steer", "follow_up", "abort_retry"].includes(type);
}

function quotaError(res, status, code, message, field) {
  return json(res, status, { ok: false, error: { code, message, ...(field ? { field } : {}) } });
}

async function ensureQuotaLatest() {
  const ageMs = latest.updatedAt ? Date.now() - latest.updatedAt : Infinity;
  if (!latest.ok || ageMs > 90_000) await refresh();
  if (!latest.ok) throw new Error("Không lấy được dữ liệu quota OMP");
  return latest;
}

async function quotaAccountsPayload(sessionId = null) {
  await ensureQuotaLatest();
  const selection = await readGeminiSelection(sessionId);
  const selectedId = selection.accountId || null;
  const now = Date.now();
  const ompAuthorizedAt = await readOmpAuthorizedAt();
  const accounts = geminiQuotaAccounts().map((account) => {
    const quotas = quotaAccountWindows(account);
    const { fiveHour, weekly, daily } = quotas;
    const primary = fiveHour || daily || weekly;
    const primaryQuotaLabel = daily && !fiveHour ? "Ngày" : fiveHour ? "5g" : weekly ? "Tuần" : "--";
    const entitlement = quotaAccountEntitlement(account);
    const resetAt = (account.limits || []).map((limit) => Number(limit.resetsAt)).filter((value) => Number.isFinite(value) && value > now).sort((a, b) => a - b)[0] || null;
    const isActive = entitlement.eligible && quotaAccountId(account) === selectedId;
    const sessionDuration = isActive && Number.isFinite(Number(selection.selectedAt))
      ? quotaDuration(now - Number(selection.selectedAt))
      : "0p";
    const emailKey = String(account.email || "").toLowerCase();
    const tokenTimestamp = Number(ompAuthorizedAt.get(emailKey)) || null;
    const accountStatus = quotaAccountStatus(account, quotas);
    const availability = quotaAccountAvailability(account, quotas);
    return {
      id: quotaAccountId(account),
      email: account.email,
      providerKey: account.provider,
      provider: quotaProviderLabel(account.provider),
      projectId: account.projectId || null,
      endpoint: account.endpoint || null,
      hasGoogleQuota: (account.limits || []).some(isGoogleQuotaLimit),
      isGoogleProtect: (account.limits || []).some(isGoogleQuotaLimit),
      planEligible: entitlement.eligible,
      planReason: entitlement.reason,
      primaryQuotaLabel,
      primaryQuotaWindow: primary?.window || "--",
      usage5hPct: primary ? quotaRound(Number(primary.usedFraction || 0) * 100) : null,
      usageWeekPct: weekly ? quotaRound(Number(weekly.usedFraction || 0) * 100) : null,
      resetIn5h: primary?.resetsAt ? quotaDuration(Number(primary.resetsAt) - now) : "--",
      reset5hSec: primary?.resetsAt ? Math.max(0, Math.ceil((Number(primary.resetsAt) - now) / 1000)) : null,
      resetInWeek: weekly?.resetsAt ? quotaDuration(Number(weekly.resetsAt) - now) : null,
      tokenLoginTime: Number.isFinite(tokenTimestamp) ? new Date(tokenTimestamp).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "--",
      tokenLoginAgo: Number.isFinite(tokenTimestamp) ? quotaTokenAge(tokenTimestamp, now) : "--",
      sessionDuration,
      used5hCount: null,
      isActive,
      tokenLoginIso: Number.isFinite(tokenTimestamp) ? new Date(tokenTimestamp).toISOString() : null,
      resetSec: resetAt ? Math.max(0, (resetAt - now) / 1000) : null,
      resetIn: resetAt ? quotaDuration(resetAt - now) : "--",
      weekMetricNote: weekly ? "Hạn mức tuần" : daily ? "Quota ngày" : "Thiếu data",
      quotaLimits: [...(account.limits || []).reduce((map, limit) => {
        const key = `${limit.label || "Quota"}|${limit.window || "--"}|${Boolean(limit.shared)}`;
        const current = map.get(key);
        if (!current || Number(limit.usedFraction || 0) > Number(current.usedFraction || 0)) map.set(key, limit);
        return map;
      }, new Map()).values()].map((limit) => ({
        id: limit.id || `${limit.label || "quota"}:${limit.window || "window"}`,
        label: limit.label || "Quota",
        window: limit.window || "--",
        usedPct: quotaRound(Number(limit.usedFraction || 0) * 100),
        remainingPct: quotaRound(Math.max(0, 1 - Number(limit.usedFraction || 0)) * 100),
        resetIn: limit.resetsAt ? quotaDuration(Number(limit.resetsAt) - now) : "--",
        status: limit.status || "unknown",
        shared: Boolean(limit.shared),
      })),
      authStatus: account.authStatus || "auth_unknown",
      authReason: account.authReason || null,
      generationStatus: account.generationStatus || "unknown",
      generationReason: account.generationReason || null,
      generationCheckedAt: account.generationCheckedAt || null,
      generationModel: account.generationModel || null,
      statusCode: accountStatus.code,
      statusLabel: accountStatus.label,
      statusReason: accountStatus.reason,
      canUse: availability.canUse,
      availabilityStatus: availability.status,
      availabilityLabel: availability.label,
      availabilityReason: availability.reason,
    };
  });
  const priority = (account) => { const tokenAt = Date.parse(account.tokenLoginIso || ""); const stale = !Number.isFinite(tokenAt) || now - tokenAt > 7 * 86400000; return account.isActive ? 0 : !account.canUse || stale ? 4 : account.statusCode === "normal" ? 1 : account.canUse ? 2 : 3; };
  accounts.sort((a, b) => priority(a) - priority(b) || Number(b.isActive) - Number(a.isActive) || String(a.email).localeCompare(String(b.email)));
  return accounts;
}

function quotaStatusForPercent(value) {
  if (value >= QUOTA_SUSPEND_THRESHOLD * 100) return "danger";
  if (value > QUOTA_WARNING_THRESHOLD * 100) return "warn";
  return "ok";
}

function quotaWindowPayload(rawAccounts, kind, title, type, now) {
  const values = rawAccounts.map((account) => quotaWindowLimit(account, kind)).filter(Boolean);
  if (!values.length) return { title, type, usedPct: null, remainingPct: null, peak: "--", peakRemainingPct: null, resetIn: "--", status: "unknown" };
  const percentages = values.map((limit) => Number(limit.usedFraction || 0) * 100);
  const usedPct = quotaRound(percentages.reduce((sum, value) => sum + value, 0) / percentages.length);
  const peak = Math.max(...percentages);
  const resetAt = values.map((limit) => Number(limit.resetsAt)).filter((value) => Number.isFinite(value) && value > now).sort((a, b) => a - b)[0];
  return {
    title,
    type,
    usedPct,
    remainingPct: quotaRound(Math.max(0, 100 - usedPct)),
    peak: peak >= 100 ? "100% (Hết)" : `${quotaRound(peak)}%`,
    peakRemainingPct: quotaRound(Math.max(0, 100 - peak)),
    resetIn: resetAt ? quotaDuration(resetAt - now) : "--",
    status: quotaStatusForPercent(peak),
  };
}

async function quotaOverviewPayload() {
  await ensureQuotaLatest();
  const rawAccounts = eligibleGeminiQuotaAccounts();
  const accounts = await quotaAccountsPayload();
  const now = Date.now();
  const windows = {
    gemini5h: quotaWindowPayload(rawAccounts, "gemini5h", "Gemini 5g", "TRƯỢT", now),
    geminiWeek: quotaWindowPayload(rawAccounts, "geminiWeek", "Gemini Tuần", "TUẦN", now),
    claude5h: quotaWindowPayload(rawAccounts, "claude5h", "Claude/GPT 5g", "TRƯỢT", now),
    claudeWeek: quotaWindowPayload(rawAccounts, "claudeWeek", "Claude/GPT Tuần", "TUẦN", now),
  };
  const resetCandidates = rawAccounts.flatMap((account) => (account.limits || []).map((limit) => ({
    at: Number(limit.resetsAt),
    email: account.email,
    usedPct: quotaRound(Number(limit.usedFraction || 0) * 100),
    remainingPct: quotaRound(Math.max(0, 1 - Number(limit.usedFraction || 0)) * 100),
    window: limit.window || "Quota",
  }))).filter((item) => Number.isFinite(item.at) && item.at > now).sort((a, b) => a.at - b.at);
  const statusCounts = accounts.filter((account) => account.planEligible).reduce((counts, account) => {
    const key = account.statusCode === "exhausted"
      ? "exhausted"
      : ["danger", "auth_error", "access_error", "quota_blocked", "chat_error"].includes(account.statusCode)
        ? "danger"
      : ["warning", "quota_unknown", "generation_unknown"].includes(account.statusCode)
          ? "warn"
          : "ok";
    counts[key] += 1;
    return counts;
  }, { ok: 0, warn: 0, danger: 0, exhausted: 0 });
  const active = accounts.find((account) => account.isActive && account.planEligible) || null;
  return {
    totalAccounts: rawAccounts.length,
    activeAccountId: active?.id || "",
    earliestReset: resetCandidates[0] ? `${quotaDuration(resetCandidates[0].at - now)} (${resetCandidates[0].email})` : "--",
    earliestResetStatus: resetCandidates[0] ? quotaStatusForPercent(resetCandidates[0].usedPct) : "ok",
    earliestResetUsedPct: resetCandidates[0]?.usedPct ?? null,
    earliestResetRemainingPct: resetCandidates[0]?.remainingPct ?? null,
    statusCounts,
    windows,
  };
}

function ompControlForAccount(account) {
  return { enabled: true, accountId: quotaAccountId(account), provider: account.provider, email: account.email };
}

async function quotaOmpControlPayload() {
  await ensureQuotaLatest();
  const control = await readOmpAccountControl();
  const selection = await readGeminiSelection();
  const selected = geminiQuotaAccounts().find((account) => quotaAccountId(account) === selection.accountId) || null;
  const enforced = control.enabled ? geminiQuotaAccounts().find((account) => quotaAccountId(account) === control.accountId) || null : null;
  return {
    enabled: control.enabled,
    accountId: control.enabled ? control.accountId : null,
    email: control.enabled ? control.email : null,
    selectedAccountId: selected ? quotaAccountId(selected) : null,
    selectedEmail: selected?.email || null,
    status: !control.enabled ? "● Đã tắt KHỐNG CHẾ OMP" : enforced ? `● Đang khóa ${enforced.email}` : "● Account đã khóa không còn khả dụng",
  };
}

async function quotaOmpControl(req) {
  if (req.method === "GET") return quotaOmpControlPayload();
  const body = await jsonBody(req);
  if (!body || Array.isArray(body) || typeof body.enabled !== "boolean") throw Object.assign(new Error("enabled phải là boolean."), { code: "BAD_REQUEST", field: "enabled" });
  if (!body.enabled) {
    await saveOmpAccountControl({ enabled: false });
    return quotaOmpControlPayload();
  }
  const { account, availability } = await selectedGeminiAccountState();
  if (!availability.canUse) throw Object.assign(new Error(availability.reason), { code: "ACCOUNT_UNAVAILABLE", field: "accountId" });
  await saveOmpAccountControl(ompControlForAccount(account));
  return quotaOmpControlPayload();
}

async function syncOmpAccountControl(account) {
  if ((await readOmpAccountControl()).enabled) await saveOmpAccountControl(ompControlForAccount(account));
}

function quotaRotationCandidates(config, selectedId) {
  const pool = config.mode === "auto"
    ? eligibleGeminiQuotaAccounts()
    : eligibleGeminiQuotaAccounts().filter((account) => config.accountIds.includes(quotaAccountId(account)));
  return pool
    .filter((account) => quotaAccountId(account) !== selectedId && quotaAccountAvailability(account).canUse)
    .sort((left, right) => {
      const leftUsed = Math.max(...Object.values(quotaAccountWindows(left)).map((limit) => Number(limit?.usedFraction || 0)));
      const rightUsed = Math.max(...Object.values(quotaAccountWindows(right)).map((limit) => Number(limit?.usedFraction || 0)));
      return leftUsed - rightUsed || String(left.email).localeCompare(String(right.email));
    });
}

async function evaluateQuotaRotation() {
  const operation = quotaRotationWrite.then(async () => {
    const policy = await syncSafetyPolicy();
    const checkedAt = new Date().toISOString();
    const selected = policy.selectedId ? geminiQuotaAccounts().find((account) => quotaAccountId(account) === policy.selectedId) : null;
    if (!policy.config.rotation.enabled) return quotaRotationState = { ...quotaRotationState, lastCheckedAt: checkedAt, reason: "Tự động xoay đang tắt" };
    if (!selected || !policy.activeAccountProtected) return quotaRotationState = { ...quotaRotationState, lastCheckedAt: checkedAt, reason: "Account mặc định chưa nằm trong phạm vi Google Protect" };
    const availability = quotaAccountAvailability(selected);
    if (availability.status !== "quota_suspended") return quotaRotationState = { ...quotaRotationState, lastCheckedAt: checkedAt, reason: availability.canUse ? "Giữ account hiện tại: quota live còn dùng được" : `Không xoay tự động: ${availability.label}` };
    const safety = consoleBridge.safety();
    if (Number(safety.activeTurns || 0) > 0) return quotaRotationState = { ...quotaRotationState, lastCheckedAt: checkedAt, reason: "Đợi các turn đang chạy kết thúc trước khi xoay" };
    const next = quotaRotationCandidates(policy.config, policy.selectedId)[0];
    if (!next) return quotaRotationState = { ...quotaRotationState, lastCheckedAt: checkedAt, reason: "Không có account đủ quota trong phạm vi Google Protect" };
    await updateGeminiDefaultAccount(next);
    await syncOmpAccountControl(next);
    await syncSafetyPolicy();
    return quotaRotationState = {
      lastCheckedAt: checkedAt,
      lastRotation: { at: checkedAt, fromAccountId: quotaAccountId(selected), fromEmail: selected.email, toAccountId: quotaAccountId(next), toEmail: next.email, reason: availability.reason },
      reason: `Đã xoay vì ${availability.label}`,
    };
  });
  quotaRotationWrite = operation.catch((error) => { quotaRotationState = { ...quotaRotationState, lastCheckedAt: new Date().toISOString(), reason: `Không xoay: ${error.message}` }; });
  return operation;
}

async function quotaProtectPayload() {
  await ensureQuotaLatest();
  const policy = await syncSafetyPolicy();
  const safety = consoleBridge.safety();
  const googleAccounts = eligibleGeminiQuotaAccounts();
  const protectedAccounts = policy.config.mode === "auto"
    ? googleAccounts
    : googleAccounts.filter((account) => policy.config.accountIds.includes(quotaAccountId(account)));
  const activeRaw = googleAccounts.find((account) => quotaAccountId(account) === policy.selectedId) || null;
  const activeAvailability = activeRaw
    ? quotaAccountAvailability(activeRaw)
    : { canUse: false, label: "Không có account quota" };
  const now = Date.now();
  const cooldownSec = safety.blockedUntil ? Math.max(0, Math.ceil((Number(safety.blockedUntil) - now) / 1000)) : 0;
  const maxConcurrent = Number.isFinite(safety.maxConcurrentTurns) ? Number(safety.maxConcurrentTurns) : null;
  const concurrencyAllowed = maxConcurrent == null || Number(safety.activeTurns || 0) < maxConcurrent;
  const nextRequestAllowed = activeAvailability.canUse && (!policy.config.enabled || !policy.activeAccountProtected || (!safety.blocked && concurrencyAllowed && (!safety.nextRequestAt || Number(safety.nextRequestAt) <= now)));
  const rotationCandidates = quotaRotationCandidates(policy.config, policy.selectedId);
  const checkedAt = Date.parse(quotaRotationState.lastCheckedAt || "");
  return {
    enabled: policy.config.enabled,
    mode: policy.config.mode,
    activeAccountProtected: policy.activeAccountProtected,
    status: !activeAvailability.canUse ? `● ${activeAvailability.label}` : !policy.config.enabled ? "● Đã tắt bảo vệ" : !policy.activeAccountProtected ? "● Account hiện tại chưa áp dụng" : safety.blocked ? "● Đang cooldown 429" : "● Đang bảo vệ 429",
    appliedAccountsCount: protectedAccounts.length,
    appliedAccountIds: protectedAccounts.map(quotaAccountId),
    appliedAccounts: protectedAccounts.map((account) => account.email),
    selectedAccountId: policy.selectedId,
    configuredAccountIds: policy.config.accountIds,
    activeRequests: Number(safety.activeTurns || 0),
    maxConcurrent,
    cooldownSec,
    errors429Count: Number(safety.recent429Count || 0),
    nextRequestAllowed,
    activeAccountAvailability: activeAvailability,
    checkIntervalSec: 60,
    rotation: {
      enabled: policy.config.rotation.enabled,
      scope: policy.config.mode,
      trigger: "quota_live_suspended",
      historical429: "Giữ account; chỉ áp dụng cooldown, không xoay",
      activeTurn: "Đợi turn kết thúc; không đổi account giữa turn",
      candidateCount: rotationCandidates.length,
      candidateEmails: rotationCandidates.map((account) => account.email),
      lastCheckedAt: quotaRotationState.lastCheckedAt,
      nextEvaluationAt: Number.isFinite(checkedAt) ? new Date(checkedAt + 60_000).toISOString() : null,
      lastRotation: quotaRotationState.lastRotation,
      reason: quotaRotationState.reason,
      status: !policy.config.rotation.enabled ? "● Xoay tự động đang tắt" : quotaRotationState.reason,
    },
  };
}

async function quotaProtectConfig(req) {
  await ensureQuotaLatest();
  const current = await readProtectConfig();
  if (req.method === "GET") return quotaProtectPayload();
  const body = await jsonBody(req);
  if (!body || Array.isArray(body)) throw Object.assign(new Error("Payload phải là object JSON."), { code: "BAD_REQUEST" });
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") throw Object.assign(new Error("enabled phải là boolean."), { code: "BAD_REQUEST", field: "enabled" });
  if (body.mode !== undefined && body.mode !== "auto" && body.mode !== "manual") throw Object.assign(new Error("mode phải là auto hoặc manual."), { code: "BAD_REQUEST", field: "mode" });
  if (body.accountIds !== undefined && (!Array.isArray(body.accountIds) || body.accountIds.some((id) => typeof id !== "string"))) throw Object.assign(new Error("accountIds phải là mảng chuỗi."), { code: "BAD_REQUEST", field: "accountIds" });
  if (body.rotation !== undefined && (!body.rotation || typeof body.rotation !== "object" || Array.isArray(body.rotation) || (body.rotation.enabled !== undefined && typeof body.rotation.enabled !== "boolean"))) throw Object.assign(new Error("rotation.enabled phải là boolean."), { code: "BAD_REQUEST", field: "rotation" });
  const knownIds = new Set(eligibleGeminiQuotaAccounts().map(quotaAccountId));
  const accountIds = body.accountIds === undefined ? current.accountIds : [...new Set(body.accountIds.map((id) => id.trim()).filter((id) => knownIds.has(id)))];
  const rotation = body.rotation === undefined ? current.rotation : { enabled: body.rotation.enabled === undefined ? current.rotation.enabled : body.rotation.enabled };
  await saveProtectConfig({ enabled: body.enabled === undefined ? current.enabled : body.enabled, mode: body.mode === undefined ? current.mode : body.mode, accountIds, rotation });
  await evaluateQuotaRotation().catch(() => {});
  return quotaProtectPayload();
}

async function quotaHistoryPayload(scope) {
  await ensureQuotaLatest();
  const selectedScope = scope || "24h";
  if (selectedScope !== "all" && !QUOTA_HISTORY_SCOPES.has(selectedScope)) throw Object.assign(new Error("scope phải là 1h, 24h, 7d, 30d hoặc all"), { code: "BAD_REQUEST", field: "scope" });
  const allItems = await readTokenHistory();
  const now = Date.now();
  const since = selectedScope === "all" ? 0 : now - QUOTA_HISTORY_SCOPES.get(selectedScope);
  const importedAccounts = new Map(eligibleGeminiQuotaAccounts().map((account) => [quotaAccountId(account), account]));
  const findImportedAccount = (item) => importedAccounts.get(String(item.accountId || "")) || null;
  const items = allItems.filter((item) => {
    const account = findImportedAccount(item);
    const at = new Date(item.timestamp).getTime();
    if (!account || !Number.isFinite(at) || at < since) return false;
    const provider = String(item.provider || "").toLowerCase();
    return provider === String(account.provider || "").toLowerCase() || provider === "google";
  });
  const summary = tokenSummary(items);
  const mappedItems = items.slice(0, 200).map((item, index) => {
    const account = findImportedAccount(item);
    return {
      id: `call-${createHash("sha256").update(`${item.timestamp}|${item.accountId}|${item.model}|${index}`).digest("hex").slice(0, 12)}`,
      timestamp: item.timestamp,
      timeAgo: quotaTimeAgo(item.timestamp, now),
      email: item.email || "--",
      accountId: item.accountId || "unknown",
      model: item.model || "--",
      endpoint: account?.endpoint || "--",
      inputTokens: quotaFormatNumber(item.input),
      outputTokens: quotaFormatNumber(item.output),
      totalTokens: quotaFormatNumber(item.total),
      latencyMs: item.latencyMs,
      ttftMs: item.ttftMs,
      latency: Number.isFinite(Number(item.latencyMs)) ? `${Math.round(Number(item.latencyMs))} ms` : "--",
    };
  });
  const trendEnd = now;
  const validTimes = items.map((item) => new Date(item.timestamp).getTime()).filter(Number.isFinite);
  const trendStart = selectedScope === "all" ? Math.min(...validTimes, now - 12 * 60 * 60 * 1000) : since;
  const bucketMs = Math.max(1, (trendEnd - trendStart) / 12);
  const hourlyTrend = Array.from({ length: 12 }, (_, index) => {
    const bucketStart = trendStart + index * bucketMs;
    const bucketItems = items.filter((item) => {
      const at = new Date(item.timestamp).getTime();
      return at >= bucketStart && (index === 11 ? at <= trendEnd : at < bucketStart + bucketMs);
    });
    const input = bucketItems.reduce((sum, item) => sum + number(item.input), 0);
    const output = bucketItems.reduce((sum, item) => sum + number(item.output), 0);
    return { hour: new Date(bucketStart).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false }), input, output, total: input + output, isPeak: false };
  });
  const peak = Math.max(...hourlyTrend.map((item) => item.total), 0);
  hourlyTrend.forEach((item) => { item.isPeak = peak > 0 && item.total === peak; });
  return {
    scope: selectedScope,
    totalRequests: summary.requests,
    totalTokens: summary.total,
    totalTokensFormatted: quotaFormatCompact(summary.total),
    inputTokensFormatted: quotaFormatCompact(summary.input + summary.cacheRead + summary.cacheWrite),
    outputTokensFormatted: quotaFormatCompact(summary.output),
    hourlyTrend,
    items: mappedItems,
  };
}

async function deleteQuotaAccount(accountId) {
  await ensureQuotaLatest();
  const account = geminiQuotaAccounts().find((item) => quotaAccountId(item) === String(accountId || ""));
  if (!account) throw Object.assign(new Error("Không tìm thấy tài khoản Gemini với ID chỉ định."), { code: "ACCOUNT_NOT_FOUND" });
  if (geminiQuotaAccounts().length <= 1) throw Object.assign(new Error("Không thể xoá tài khoản Gemini cuối cùng."), { code: "CONFLICT" });
  const deletedRows = await deleteOAuthCredential(account);
  if (!deletedRows) throw Object.assign(new Error("Không tìm thấy OAuth credential để xoá."), { code: "ACCOUNT_NOT_FOUND" });
  await clearGeminiDefaultAccount(quotaAccountId(account));
  const protectConfig = await readProtectConfig();
  await saveProtectConfig({ ...protectConfig, accountIds: protectConfig.accountIds.filter((id) => id !== String(accountId)) });
  const ompControl = await readOmpAccountControl();
  if (ompControl.enabled && ompControl.accountId === quotaAccountId(account)) await saveOmpAccountControl({ enabled: false });
  historyCache = { loadedAt: 0, items: [] };
  await refresh();
  await syncSafetyPolicy();
  broadcastStatus();
  const selection = await readGeminiSelection();
  const active = geminiQuotaAccounts().find((item) => quotaAccountId(item) === selection.accountId);
  return { success: true, removedEmail: account.email, activeEmail: active?.email || null, accountsCount: geminiQuotaAccounts().length, message: `Đã xoá tài khoản Gemini ${account.email}.` };
}

async function quotaSwitchAccount(req) {
  const body = await jsonBody(req);
  if (!body || Array.isArray(body) || typeof body.accountId !== "string" || !body.accountId.trim()) {
    throw Object.assign(new Error("accountId là bắt buộc"), { code: "BAD_REQUEST", field: "accountId" });
  }
  if (body.sessionId != null && typeof body.sessionId !== "string") throw Object.assign(new Error("sessionId phải là chuỗi"), { code: "BAD_REQUEST", field: "sessionId" });
  await ensureQuotaLatest();
  const sessionId = quotaSessionId(body.sessionId);
  const account = geminiQuotaAccounts().find((item) => quotaAccountId(item) === body.accountId.trim());
  if (!account) throw Object.assign(new Error("Không tìm thấy tài khoản Gemini với ID chỉ định."), { code: "ACCOUNT_NOT_FOUND" });
  const availability = quotaAccountAvailability(account);
  if (!availability.canUse) throw Object.assign(new Error(availability.reason), { code: "ACCOUNT_UNAVAILABLE", field: "accountId" });
  const activatedAt = Date.now();
  if (sessionId) {
    const record = await ensureChatSession(sessionId, {}, { requireExisting: true });
    await pinGeminiSession(record, sessionId, account);
  } else {
    await updateGeminiDefaultAccount(account);
    await syncOmpAccountControl(account);
  }
  await syncSafetyPolicy();
  broadcastStatus();
  return {
    success: true,
    activeAccountId: quotaAccountId(account),
    activeEmail: account.email,
    scope: sessionId ? "session" : "default",
    sessionId,
    activatedAt: new Date(activatedAt).toISOString(),
    sessionDuration: "0p",
    message: sessionId ? `Đã ghim account Gemini ${account.email} cho chat này.` : `Đã đặt account Gemini mặc định cho chat mới: ${account.email}`,
  };
}

async function quotaSync(req) {
  const body = await jsonBody(req);
  if (!body || Array.isArray(body)) throw Object.assign(new Error("Payload phải là object JSON."), { code: "BAD_REQUEST" });
  const startedAt = Date.now();
  const snapshot = await refresh();
  if (!snapshot.ok) throw Object.assign(new Error("Không đồng bộ được dữ liệu quota OMP."), { code: "INTERNAL_SERVER_ERROR" });
  return {
    success: true,
    syncedAt: new Date(snapshot.updatedAt || Date.now()).toISOString(),
    accountsCount: geminiQuotaAccounts().length,
    latencyMs: Date.now() - startedAt,
    message: `Đã đồng bộ quota cho ${geminiQuotaAccounts().length} tài khoản Gemini.`,
  };
}

async function quotaQuickCheckPayload() {
  const [accounts, overview] = await Promise.all([quotaAccountsPayload(), quotaOverviewPayload()]);
  const activeAccount = accounts.find((account) => account.isActive) || null;
  return {
    activeAccount: activeAccount ? {
      id: activeAccount.id,
      email: activeAccount.email,
      provider: activeAccount.provider,
      sessionDuration: activeAccount.sessionDuration,
      tokenLoginAgo: activeAccount.tokenLoginAgo,
    } : null,
    earliestReset: overview.earliestReset,
    windows: overview.windows,
  };
}

const server = http.createServer(async (req, res) => {
  try {
  const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
  res.requestId = randomUUID();
  res.setHeader("x-request-id", res.requestId);
  res.cspNonce = applySecurityHeaders(res);
  if (!isAllowedHost(req)) return json(res, 403, { ok: false, error: { code: "FORBIDDEN_HOST", message: "Host không được phép." } });
  const authorizationError = authorizeApiRequest(req, requestUrl.pathname);
  if (authorizationError) return json(res, authorizationError.status, { ok: false, error: { code: authorizationError.code, message: authorizationError.message } });
  const rateLimitError = enforceRateLimit(req, requestUrl.pathname);
  if (rateLimitError) return json(res, rateLimitError.status, { ok: false, error: { code: rateLimitError.code, message: rateLimitError.message } });
  if (requestUrl.pathname.startsWith("/api/v1/quota/")) {
    const route = requestUrl.pathname;
    const accountDeleteMatch = route.match(/^\/api\/v1\/quota\/accounts\/([^/]+)$/);
    const quotaRoutes = new Set([
      "/api/v1/quota/accounts",
      "/api/v1/quota/overview",
      "/api/v1/quota/protect-status",
      "/api/v1/quota/protect-config",
      "/api/v1/quota/omp-control",
      "/api/v1/quota/history",
      "/api/v1/quota/quick-check",
      "/api/v1/quota/models",
      "/api/v1/quota/switch",
      "/api/v1/quota/sync",
    ]);
    try {
      if (accountDeleteMatch && req.method === "DELETE") return json(res, 200, await deleteQuotaAccount(decodeURIComponent(accountDeleteMatch[1])));
      if (!quotaRoutes.has(route)) return quotaError(res, 404, "NOT_FOUND", "Không tìm thấy tài nguyên theo yêu cầu.");
      if (route === "/api/v1/quota/accounts" && req.method === "GET") return json(res, 200, await quotaAccountsPayload(quotaSessionId(requestUrl.searchParams.get("sessionId"))));
      if (route === "/api/v1/quota/models" && req.method === "GET") return json(res, 200, await quotaModelsPayload(quotaSessionId(requestUrl.searchParams.get("sessionId"))));
      if (route === "/api/v1/quota/overview" && req.method === "GET") return json(res, 200, await quotaOverviewPayload());
      if (route === "/api/v1/quota/protect-status" && req.method === "GET") return json(res, 200, await quotaProtectPayload());
      if (route === "/api/v1/quota/protect-config" && (req.method === "GET" || req.method === "POST")) return json(res, 200, await quotaProtectConfig(req));
      if (route === "/api/v1/quota/omp-control" && (req.method === "GET" || req.method === "POST")) return json(res, 200, await quotaOmpControl(req));
      if (route === "/api/v1/quota/history" && req.method === "GET") return json(res, 200, await quotaHistoryPayload(requestUrl.searchParams.get("scope")));
      if (route === "/api/v1/quota/quick-check" && req.method === "GET") return json(res, 200, await quotaQuickCheckPayload());
      if (route === "/api/v1/quota/switch" && req.method === "POST") return json(res, 200, await quotaSwitchAccount(req));
      if (route === "/api/v1/quota/sync" && req.method === "POST") return json(res, 200, await quotaSync(req));
      return quotaError(res, 405, "METHOD_NOT_ALLOWED", "Phương thức HTTP không được hỗ trợ.");
    } catch (error) {
      const code = error.code || "INTERNAL_SERVER_ERROR";
      const status = code === "BAD_REQUEST" ? 400 : code === "ACCOUNT_NOT_FOUND" ? 404 : ["ACCOUNT_UNAVAILABLE", "ACCOUNT_SELECTION_REQUIRED", "CONFLICT", "MODEL_NOT_ALLOWED_BY_QUOTA"].includes(code) ? 409 : 500;
      return quotaError(res, status, code, ["BAD_REQUEST", "ACCOUNT_NOT_FOUND", "ACCOUNT_UNAVAILABLE", "ACCOUNT_SELECTION_REQUIRED", "MODEL_NOT_ALLOWED_BY_QUOTA"].includes(code) ? error.message : "Đã xảy ra lỗi khi đọc dữ liệu quota Gemini.", error.field);
    }
  }
  if (requestUrl.pathname === "/api/v1/workspaces") {
    if (req.method !== "GET") return json(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Phương thức HTTP không được hỗ trợ." } });
    try { return json(res, 200, await consoleBridge.listWorkspaceDirectories(requestUrl.searchParams.get("path"))); }
    catch (error) { return chatError(res, error); }
  }
  const folderWorkspaceMatch = requestUrl.pathname.match(/^\/api\/v1\/folders\/([^/]+)$/);
  if (folderWorkspaceMatch) {
    try {
      if (req.method !== "PATCH") return json(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Phương thức HTTP không được hỗ trợ." } });
      const body = await jsonBody(req);
      if (!body || Array.isArray(body) || typeof body !== "object") throw Object.assign(new Error("Payload phải là object JSON."), { code: "BAD_REQUEST" });
      return json(res, 200, await updateChatFolderWorkspace(decodeSessionSegment(folderWorkspaceMatch[1], "folderId"), body.cwd));
    } catch (error) { return chatError(res, error); }
  }
  if (requestUrl.pathname === "/api/v1/folders") {
    try {
      if (req.method === "GET") return json(res, 200, await listChatFolders());
      if (req.method === "POST") {
        const body = await jsonBody(req);
        if (!body || Array.isArray(body) || typeof body !== "object") throw Object.assign(new Error("Payload phải là object JSON."), { code: "BAD_REQUEST" });
        return json(res, 201, await createChatFolder(body.name, body.cwd));
      }
      return json(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Phương thức HTTP không được hỗ trợ." } });
    } catch (error) {
      return chatError(res, error);
    }
  }
  if (requestUrl.pathname === "/api/v1/sessions" || requestUrl.pathname.startsWith("/api/v1/sessions/")) {
    try {
      if (requestUrl.pathname === "/api/v1/sessions" && req.method === "GET") {
        const rawLimit = requestUrl.searchParams.get("limit");
        const rawCursor = requestUrl.searchParams.get("cursor") || "0";
        const limit = rawLimit == null ? 50 : Number(rawLimit);
        const cursor = Number(rawCursor);
        if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw Object.assign(new Error("limit phải là số nguyên từ 1 đến 200"), { code: "BAD_REQUEST", field: "limit" });
        if (!Number.isInteger(cursor) || cursor < 0) throw Object.assign(new Error("cursor phải là số nguyên không âm"), { code: "BAD_REQUEST", field: "cursor" });
        const all = await listChatSessions();
        const page = all.slice(cursor, cursor + limit);
        if (cursor + page.length < all.length) res.setHeader("x-next-cursor", String(cursor + page.length));
        res.setHeader("x-total-count", String(all.length));
        return json(res, 200, page);
      }
      if (requestUrl.pathname === "/api/v1/sessions" && req.method === "POST") {
        const body = await jsonBody(req);
        if (body == null) throw Object.assign(new Error("Payload phải là object JSON."), { code: "BAD_REQUEST" });
        if (Array.isArray(body) || typeof body !== "object") throw Object.assign(new Error("Payload phải là object JSON."), { code: "BAD_REQUEST" });
        if (body.title != null && (typeof body.title !== "string" || body.title.trim().length > 200)) throw Object.assign(new Error("title phải có tối đa 200 ký tự"), { code: "BAD_REQUEST", field: "title" });
        const sessionId = randomUUID();
        const metadataAtCreation = await readChatMetadata();
        const defaultAccountId = typeof metadataAtCreation.geminiDefaultAccountId === "string"
          ? metadataAtCreation.geminiDefaultAccountId.trim()
          : "";
        const geminiDefaultSnapshot = defaultAccountId ? {
          geminiDefaultAccountIdAtCreation: defaultAccountId,
          geminiDefaultProviderAtCreation: metadataAtCreation.geminiDefaultProvider || "",
          geminiDefaultSelectedAtAtCreation: metadataAtCreation.geminiDefaultSelectedAt || null,
        } : {};
        let projectFolder = null;
        let cwd = body.cwd;
        if (body.folderId != null) {
          const folderId = chatFolderId(body.folderId);
          projectFolder = metadataAtCreation.folders[folderId] || null;
          if (!projectFolder) throw Object.assign(new Error("Folder không tồn tại"), { code: "NOT_FOUND", field: "folderId" });
          if (typeof projectFolder.cwd !== "string" || !projectFolder.cwd) throw Object.assign(new Error("Folder dự án cần được gắn với thư mục workspace trước khi tạo chat"), { code: "CONFLICT", field: "folderId" });
          cwd = await consoleBridge.validateWorkspaceDirectory(projectFolder.cwd);
        } else if (cwd == null || cwd === "") {
          await mkdir(GENERAL_CHAT_CWD, { recursive: true, mode: 0o700 });
          cwd = GENERAL_CHAT_CWD;
        }
        const record = await ensureChatSession(sessionId, { cwd, title: body.title, ...(body.browserMode != null ? { browserMode: body.browserMode } : {}), ...(body.approvalMode != null ? { approvalMode: body.approvalMode } : {}), ...(body.tools != null ? { tools: body.tools } : {}) });
        const now = new Date(record.createdAt || Date.now()).toISOString();
        const title = String(body.title || "Phiên làm việc mới").trim() || "Phiên làm việc mới";
        const stored = await updateChatMetadata(sessionId, {
          title,
          createdAt: now,
          tools: record.tools,
          cwd: record.cwd,
          ...geminiDefaultSnapshot,
          ...(projectFolder ? { folderId: projectFolder.id, folderName: projectFolder.name } : {}),
        });
        return json(res, 201, chatSessionView({ id: sessionId, ...stored, title, createdAt: now, updatedAt: now }));
      }
      const parts = requestUrl.pathname.split("/").filter(Boolean);
      if (!parts[3]) throw Object.assign(new Error("sessionId là bắt buộc"), { code: "BAD_REQUEST", field: "sessionId" });
      const rawSessionId = decodeSessionSegment(parts[3], "sessionId");
      const sessionId = gatewaySessionId(rawSessionId);
      if (req.method === "POST" && parts[4] === "stream") {
        const body = await jsonBody(req);
        return await streamChatTurn(req, res, requestUrl, { ...(body && typeof body === "object" ? body : {}), sessionId });
      }
      if (req.method === "POST" && parts[4] === "abort") {
        const body = await jsonBody(req);
        return json(res, 202, await abortChatRequest(req, { ...(body && typeof body === "object" ? body : {}), sessionId }));
      }
      if (req.method === "POST" && parts[4] === "steer") {
        const body = await jsonBody(req);
        return json(res, 200, await sessionAction(sessionId, req, {
          ...(body && typeof body === "object" ? body : {}),
          action: "steer",
          message: body?.message || body?.prompt,
        }));
      }
      if (req.method === "GET" && parts[4] === "messages") {
        const messages = await chatMessages(sessionId);
        if (!messages.length && !liveGatewayRecord(sessionId)) {
          const persisted = await readPersistedChatSession(sessionId).catch(() => null);
          if (!persisted) throw Object.assign(new Error("Không tìm thấy session OMP"), { code: "NOT_FOUND" });
        }
        return json(res, 200, messages);
      }
      if (req.method === "GET" && parts[4] === "memory") return json(res, 200, await sessionMemoryStatus(sessionId));
      if (req.method === "POST" && parts[4] === "memory" && parts[5] === "action") return json(res, 200, await sessionMemoryAction(sessionId, req));
      if (req.method === "GET" && parts[4] === "state") return json(res, 200, await chatSessionNativeState(sessionId));
      if (req.method === "GET" && parts[4] === "files") {
        const record = await ensureChatSession(sessionId);
        return json(res, 200, { ok: true, ...(await consoleBridge.listWorkspaceFiles(record.contextId, requestUrl.searchParams.get("mention") || "@")) });
      }
      if (req.method === "POST" && parts[4] === "files" && parts[5] === "reference") {
        const body = await jsonBody(req);
        const record = await ensureChatSession(sessionId);
        return json(res, 200, { ok: true, attachment: await consoleBridge.readWorkspaceFile(record.contextId, body?.path) });
      }
      if (req.method === "GET" && parts[4] === "agents") {
        const record = await ensureChatSession(sessionId);
        return json(res, 200, { ok: true, sessionId, agents: agentHubSnapshot(await queryGatewayResponse(record, { type: "get_subagents" })) });
      }
      if (req.method === "POST" && parts[4] === "approval") return json(res, 200, await resolveApproval(sessionId, await jsonBody(req)));
      if (req.method === "POST" && (parts[4] === "action" || parts[4] === "actions")) return json(res, 200, await sessionAction(sessionId, req));
      return json(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Phương thức HTTP không được hỗ trợ." } });
    } catch (error) { return chatError(res, error); }
  }
  if (requestUrl.pathname === "/api/v1/chat/abort" && req.method === "POST") {
    try { return json(res, 202, await abortChatRequest(req)); }
    catch (error) { return chatError(res, error); }
  }
  if (requestUrl.pathname === "/api/v1/chat/send" && req.method === "POST") {
    try {
      const body = await jsonBody(req);
      if (!body || Array.isArray(body) || typeof body !== "object") throw Object.assign(new Error("Payload phải là object JSON."), { code: "BAD_REQUEST" });
      const prompt = chatPrompt(body.prompt);
      const modelSource = chatModelSource(body.modelSource);
      const modelProvider = chatModelProvider(body.modelProvider);
      const thinking = chatThinking(body.thinking);
      const selectedBrowserMode = browserMode(body.browserMode);
      const selectedApprovalMode = approvalMode(body.approvalMode);
      const attachments = normalizeChatAttachments(body.attachments, { rejectInvalid: true });
      const sessionId = typeof body.sessionId === "string" && body.sessionId.trim() ? gatewaySessionId(body.sessionId.trim()) : randomUUID();
      const requestId = chatRequestId(body.requestId);
      if (activeChatRequests.has(requestId)) throw Object.assign(new Error("requestId đang được xử lý"), { code: "CONFLICT" });
      const { model: selectedModel } = await resolveChatModel(chatModel(body.model), modelSource, modelProvider, sessionId, prompt);
      const record = await ensureChatSession(sessionId, { ...body, approvalMode: selectedApprovalMode, browserMode: selectedBrowserMode });
      record.selectedChatModel = selectedModel;
      if (isQuotaGoogleChatModel(selectedModel)) {
        const { account, availability } = await selectedGeminiAccountState(sessionId);
        if (!availability.canUse) throw Object.assign(new Error(availability.reason), { code: "ACCOUNT_UNAVAILABLE", field: "accountId" });
        await pinGeminiSession(record, sessionId, account);
      }
      const actualModel = selectedModel.id;
      const startedAt = Date.now();
      try {
        return json(res, 200, { requestId, ...(await collectChatTurn(record, sessionId, prompt, actualModel, requestId, {
          thinking,
          browserMode: selectedBrowserMode,
          modelProvider: selectedModel.provider,
          attachments,
        })) });
      }
      catch (error) { observeChatRequest(requestId, sessionId, startedAt, "error", error); throw error; }
    } catch (error) { return chatError(res, error); }
  }
  if (requestUrl.pathname === "/api/v1/chat/stream" && (req.method === "GET" || req.method === "POST")) {
    try { return await streamChatTurn(req, res, requestUrl, req.method === "POST" ? await jsonBody(req) : {}); }
    catch (error) { if (!res.headersSent) return chatError(res, error); res.end(); return; }
  }
  if (requestUrl.pathname === "/api/v1/models" && req.method === "GET") {
    try { return json(res, 200, await availableModels()); }
    catch (error) { return chatError(res, error); }
  }
  if ((requestUrl.pathname === "/api/v1/omp/prewarm" || requestUrl.pathname === "/api/omp/v1/prewarm") && req.method === "POST") {
    try {
      const body = await jsonBody(req);
      if (!body || Array.isArray(body) || typeof body !== "object") throw Object.assign(new Error("Payload phải là object JSON."), { code: "BAD_REQUEST" });
      return json(res, 202, { ok: true, worker: await prewarmGateway(body) });
    } catch (error) { return chatError(res, error); }
  }
  if (requestUrl.pathname === "/chat" && req.method === "GET") {
    const page = await readDashboardAsset("honpi-chat-dashboard-SKE.html", res.cspNonce);
    issueDashboardCookie(res);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(page);
  }
  if (requestUrl.pathname === "/quota" && req.method === "GET") {
    const page = await readDashboardAsset("honpi-quota-dashboard-SKE.html", res.cspNonce);
    issueDashboardCookie(res);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(page);
  }
  if (requestUrl.pathname === "/honpi-chat-dashboard-live.js" && req.method === "GET") {
    const script = await readDashboardAsset("honpi-chat-dashboard-live.js");
    res.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" });
    return res.end(script);
  }
  if (requestUrl.pathname === `/${DASHBOARD_MARK_ASSET}` && req.method === "GET") {
    const image = await readDashboardBinary(DASHBOARD_MARK_ASSET);
    res.writeHead(200, {
      "content-type": "image/png",
      "content-length": image.byteLength,
      "cache-control": "public, max-age=31536000, immutable",
    });
    return res.end(image);
  }
  if (requestUrl.pathname === "/honpi-chat-dashboard-legacy.js" && req.method === "GET") {
    const script = await readDashboardAsset("honpi-chat-dashboard-legacy.js");
    res.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" });
    return res.end(script);
  }
  if ((req.url === "/api/omp/v1/capabilities" || req.url === "/api/v1/omp/capabilities") && req.method === "GET") {
    try {
      const models = await availableModels();
      const imageGeneration = imageGenerationCapability(models);
      const imageGenerationModels = imageGeneration.models;
      const toolCatalog = await ompToolCatalog.read();
      const tools = toolCatalog.tools;
      return json(res, 200, {
        ok: true, capabilityVersion: OMP_CAPABILITY_VERSION, contractVersion: OMP_GATEWAY_VERSION,
        transport: { prompt: "http", stream: "sse", hostOnly: true },
        imageGenerationModels,
        features: ["sessions", "streaming", "commands", "abort", "slash-commands", "file-references", "media-attachments", "image-generation", "approval-roundtrip", "browser-control", "memory"],
        sessionActions: { abort: "supported", followUp: "supported", fork: "supported", reconnect: "supported", resumeQueue: "supported", steer: "unavailable" },
        featureStatus: { "session-actions": "supported", "file-reference": "supported", "media-attachments": "supported", "image-generation": imageGeneration.status, "stream-recovery": "partial", approval: "supported", "agent-hub": "unavailable", memory: "supported", share: "partial", "browser-control": "supported", media: "partial", "screen-capture": "unavailable" },
        browserControl: {
          status: "supported",
          provider: "omp-skill",
          invocation: "/skill:ego-browser",
          actions: ["chat-prompt"],
          taskSpace: "managed by Ego Browser skill",
          note: "Không có API action, URL, ref hoặc selector thủ công; OMP nhận order trong ô chat và skill tự điều khiển browser.",
        },
        media: {
          status: "partial",
          fileAttachments: "supported",
          imageAttachments: "supported",
          imageGeneration,
          screenCapture: { status: "unavailable", note: "Native screen capture chưa có adapter." },
          camera: "unavailable",
          microphone: "unavailable",
          audio: "unavailable",
          video: "unavailable",
          browserRelay: "unavailable",
        },
        screenCapture: {
          status: "unavailable",
          native: "unavailable",
          browserPageScreenshot: "unavailable",
          note: "Ego Browser host hiện không cung cấp Page.captureScreenshot ổn định; snapshot page p1 là đọc cây trợ năng, không phải native screen capture.",
        },
        models, tools, catalog: toolCatalog.catalog, observedToolIds: toolCatalog.observedToolIds, commands: [...ACP_GATEWAY_COMMANDS].filter((command) => !BLOCKED_BROWSER_COMMANDS.has(command)).sort(), browsers: OMP_BROWSER_MODES, approvalModes: OMP_APPROVAL_MODES, shareModes: OMP_SHARE_MODES,
        safety: consoleBridge.safety(),
        note: "Catalog lấy từ OMP runtime; capability unavailable không được báo thành công.",
      });
    } catch (error) { return chatError(res, error); }
  }
  if (requestUrl.pathname === "/api/v1/omp/capabilities/audit" && req.method === "POST") {
    try { return json(res, 200, { ok: true, catalog: await ompToolCatalog.read({ force: true }) }); }
    catch (error) { return chatError(res, error); }
  }
  if (req.url === "/api/omp/v1/sessions" && req.method === "POST") {
    try { return json(res, 201, await createGatewaySession(await jsonBody(req))); }
    catch (error) { return errorResponse(res, error); }
  }
  if (req.url?.startsWith("/api/omp/v1/sessions/")) {
    const parsed = new URL(req.url, "http://127.0.0.1");
    const parts = parsed.pathname.split("/").filter(Boolean);
    const sessionId = decodeURIComponent(parts[4] || "");
    const action = parts[5] || "";
    try {
      const record = gatewayRecord(sessionId);
      if (!action && req.method === "GET") return json(res, 200, gatewayPayload(record));
      if (action === "events" && req.method === "GET") {
        const clientId = consoleBridge.createClient();
        res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
        res.write(": connected\n\n");
        consoleBridge.subscribe(record.contextId, clientId, res, { replay: parsed.searchParams.get("replay") !== "0" });
        req.on("close", () => consoleBridge.removeClient(clientId));
        return;
      }
      if (action === "prompt" && req.method === "POST") {
        const body = await jsonBody(req);
        const requestedCommand = gatewayPrompt(body);
        if (requestedCommand.type === "prompt" && contextHasChatWork(record.contextId)) {
          throw Object.assign(new Error("Dùng /api/v1/chat/stream khi session đang có lượt Chat"), { code: "CONFLICT" });
        }
        const command = await authorizeChatCommand({ ...requestedCommand, modelSource: body?.modelSource }, record, sessionId);
        const queue = chatTurnQueues.get(record.contextId);
        const activeRequest = queue?.active ? activeChatRequests.get(queue.active.requestId) : null;
        if (queue && ["steer", "follow_up"].includes(command.type) && (!activeRequest?.promptDispatched || (command.type === "follow_up" && !activeRequest.stream))) {
          throw Object.assign(new Error(`${command.type} không thể ghi vào lượt Chat hiện tại`), { code: "CONFLICT" });
        }
        if (command.type === "follow_up" && activeRequest?.stream) activeRequest.pendingTurns += 1;
        record.updatedAt = Date.now();
        try {
          consoleBridge.send(record.contextId, { id: `gateway-${Date.now()}`, ...command });
        } catch (error) {
          if (command.type === "follow_up" && activeRequest?.stream) activeRequest.pendingTurns = Math.max(0, activeRequest.pendingTurns - 1);
          throw error;
        }
        return json(res, 202, { ok: true, sessionId, command: command.type, egoBrowser: command.message.startsWith("/skill:ego-browser") });
      }
      if (action === "command" && req.method === "POST") {
        const requestedCommand = gatewayCommand(await jsonBody(req), record.protocol);
        if (requestedCommand.type === "set_model" && contextHasChatWork(record.contextId)) {
          throw Object.assign(new Error("Không thể đổi model khi session đang có lượt Chat"), { code: "CONFLICT" });
        }
        const command = await authorizeChatCommand(requestedCommand, record, sessionId);
        record.updatedAt = Date.now();
        consoleBridge.send(record.contextId, { id: command.id || `gateway-${Date.now()}`, ...command });
        return json(res, 202, { ok: true, sessionId, command: command.type });
      }
      if (action === "abort" && req.method === "POST") {
        record.updatedAt = Date.now();
        consoleBridge.send(record.contextId, { id: `gateway-abort-${Date.now()}`, type: "abort" });
        return json(res, 202, { ok: true, sessionId, command: "abort" });
      }
      if (!action && req.method === "DELETE") {
        await consoleBridge.stop(record.contextId);
        gatewaySessions.delete(sessionId);
        return json(res, 200, { ok: true, sessionId, closed: true });
      }
      return errorResponse(res, Object.assign(new Error("Gateway route không tồn tại"), { code: "NOT_FOUND" }));
    } catch (error) { return errorResponse(res, error); }
  }
  if (req.url === "/api/console/connect" && req.method === "POST") {
    return json(res, 200, { ok: true, clientId: consoleBridge.createClient() });
  }
  if (req.url === "/api/console/state" && req.method === "GET") {
    return json(res, 200, consoleBridge.state());
  }
  if (req.url === "/api/safety" && req.method === "GET") {
    return json(res, 200, { ok: true, safety: consoleBridge.safety() });
  }
  if (req.url === "/api/status/events" && req.method === "GET") {
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-store", connection: "keep-alive" });
    res.write(": connected\n\n");
    const unsubscribe = subscribeStatus(res);
    req.on("close", unsubscribe);
    return;
  }
  if ((req.url === "/api/console/sessions" || req.url?.startsWith("/api/console/sessions?")) && req.method === "GET") {
    try {
      const query = new URL(req.url, "http://127.0.0.1").searchParams;
      return json(res, 200, { ok: true, ...(await consoleBridge.listSessions(query.get("cwd") || undefined)) });
    } catch (error) { return errorResponse(res, error); }
  }
  if ((req.url === "/api/console/files" || req.url?.startsWith("/api/console/files?")) && req.method === "GET") {
    try {
      const query = new URL(req.url, "http://127.0.0.1").searchParams;
      const contextId = query.get("contextId");
      if (!contextId) throw Object.assign(new Error("contextId là bắt buộc"), { code: "BAD_REQUEST", field: "contextId" });
      return json(res, 200, { ok: true, ...(await consoleBridge.listFiles(contextId, query.get("mention") || "@")) });
    } catch (error) { return errorResponse(res, error); }
  }
  if (req.url === "/api/console/start" && req.method === "POST") {
    try {
      const context = await consoleBridge.start(await jsonBody(req));
      return json(res, 200, { ok: true, context: consoleBridge.publicSummary(context.id) });
    }
    catch (error) { return errorResponse(res, error); }
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
      consoleBridge.subscribe(contextId, clientId, res, { replay: query.get("replay") !== "0" });
      req.on("close", () => consoleBridge.removeClient(clientId));
      return;
    } catch (error) { return errorResponse(res, error); }
  }
  if (req.url === "/api/console/command" && req.method === "POST") {
    try {
      const body = await jsonBody(req);
      if (!body || typeof body.contextId !== "string" || !body.contextId.trim()) throw Object.assign(new Error("contextId là bắt buộc"), { code: "BAD_REQUEST", field: "contextId" });
      const requestedCommand = gatewayCommand(body.command);
      const command = await authorizeChatCommand({ ...requestedCommand, modelSource: body.modelSource ?? "omp" });
      if (command.type === "set_model" && contextHasChatWork(body.contextId)) {
        throw Object.assign(new Error("Không thể đổi model khi session đang có lượt Chat"), { code: "CONFLICT" });
      }
      consoleBridge.send(body.contextId, command);
      return json(res, 200, { ok: true, command: command.type });
    } catch (error) { return errorResponse(res, error); }
  }
  if (req.url === "/api/console/session" && req.method === "POST") {
    try {
      const body = await jsonBody(req);
      const action = typeof body.action === "string" ? body.action : "";
      if (action === "archive" || action === "delete") {
        const destinationRoot = action === "archive" ? OMP_ARCHIVE_ROOT : OMP_TRASH_ROOT;
        const moved = await moveSessionRecord(body.sessionId, destinationRoot);
        return json(res, 200, { ok: true, action, moved });
      }
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
      if (isQuotaGuardedCommand(command.type)) await assertActiveQuotaAvailable();
      consoleBridge.send(body.contextId, command);
      return json(res, 200, { ok: true, command: command.type });
    } catch (error) { return errorResponse(res, error); }
  }
  if (req.url === "/api/console/stop" && req.method === "POST") {
    try {
      const body = await jsonBody(req);
      const context = await consoleBridge.stop(body.contextId);
      return json(res, 200, { ok: true, context: context.publicSummary });
    } catch (error) { return errorResponse(res, error); }
  }
  if (req.url === "/" && req.method === "GET") {
    res.writeHead(302, { location: "/quota", "cache-control": "no-store" });
    return res.end();
  }
  if (req.url === "/healthz" && req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }
  if (req.url === "/api/status" && req.method === "GET") {
    return json(res, 200, statusPayload());
  }
  if (req.url?.startsWith("/api/history") && req.method === "GET") {
    const query = new URL(req.url, "http://127.0.0.1").searchParams;
    const result = await historyPayload(Number(query.get("limit")) || 50);
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(JSON.stringify(result));
  }
  if (req.url === "/api/account-colors" && req.method === "GET") {
    if (!latest.ok) await refresh();
    return json(res, 200, { ok: true, colors: await accountColorMap() });
  }
  if (req.url === "/api/account-colors" && req.method === "PUT") {
    try {
      const body = await readJsonBody(req);
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const color = normalizeAccountColor(body.color);
      if (!email || !color) throw new Error("email và màu #RRGGBB là bắt buộc");
      if (!latest.ok) await refresh();
      const known = [...(latest.accounts || []), ...(latest.authAccounts || [])].some((account) => account.email?.toLowerCase() === email);
      if (!known) throw new Error("Account không tồn tại trong OMP");
      const colors = await readAccountColors();
      colors[email] = color;
      await writeFile(ACCOUNT_COLORS_FILE, `${JSON.stringify(colors, null, 2)}\n`, { mode: 0o600 });
      return json(res, 200, { ok: true, email, color, colors: await accountColorMap() });
    } catch (error) { return errorResponse(res, error); }
  }
  if (req.url === "/api/refresh" && req.method === "POST") {
    await refresh();
    return json(res, 200, statusPayload());
  }
  if (req.url === "/api/login" && req.method === "POST") {
    try {
      const body = await jsonBody(req);
      if (!body || Array.isArray(body) || typeof body !== "object") throw Object.assign(new Error("Payload phải là object JSON."), { code: "BAD_REQUEST" });
      startLogin(loginTargetEmail(body.email));
      return json(res, 202, { ok: true, ...login });
    } catch (error) {
      return errorResponse(res, error);
    }
  }
  if (req.url === "/api/login-status" && req.method === "GET") {
    return json(res, 200, { ok: true, ...login });
  }
  if (req.url === "/api/select-account" && req.method === "POST") {
    try {
      const result = await selectAccount(req);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(result));
    } catch (error) {
      return errorResponse(res, error);
    }
  }
  return json(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "Không tìm thấy tài nguyên theo yêu cầu." } });
  } catch (error) {
    if (!res.headersSent) json(res, 500, { ok: false, code: "INTERNAL_SERVER_ERROR", message: "Yêu cầu không thành công." });
    else res.end();
  }
});

server.on("error", (error) => {
  const message = error.code === "EADDRINUSE"
    ? `OMP Dashboard không khởi động: port ${PORT} đang được tiến trình khác sử dụng.`
    : `OMP Dashboard không khởi động: ${error.message}`;
  console.error(message);
  process.exitCode = 1;
});

server.listen(PORT, "127.0.0.1", () => { refresh(); setInterval(refresh, 60000); });
process.on("SIGINT", async () => { await consoleBridge.close(); server.close(); process.exit(0); });
process.on("SIGTERM", async () => { await consoleBridge.close(); server.close(); process.exit(0); });
