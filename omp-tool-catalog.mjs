import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MAP_PATH = fileURLToPath(new URL("./omp-tool-map.json", import.meta.url));
const CACHE_MS = 300_000;
const AUDIT_TIMEOUT_MS = 10_000;
const APPROVALS = new Set(["read", "write", "exec"]);

function configValue(settings, key) { return settings?.[key]?.value === true; }
function configEnabled(rule, settings) {
  if (rule?.mode === "always") return true;
  if (rule?.mode === "enabled") return configValue(settings, rule.key);
  return rule?.mode === "any" && Array.isArray(rule.keys) && rule.keys.some((key) => configValue(settings, key));
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function digest(value) { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex").slice(0, 16); }
function normalizeVersion(value) { return String(value || "").trim().replace(/^omp\//i, ""); }
function mapError(message) { return Object.assign(new Error(`OMP tool map không hợp lệ: ${message}`), { code: "UPSTREAM_UNAVAILABLE" }); }

function validateMap(map) {
  if (!map || typeof map !== "object" || !Number.isInteger(map.schemaVersion) || typeof map.mapVersion !== "string") throw mapError("thiếu version");
  if (!Array.isArray(map.groups) || !Array.isArray(map.tools) || !Array.isArray(map.modes)) throw mapError("thiếu groups, tools hoặc modes");
  const groups = new Set(map.groups.map((item) => item?.id).filter(Boolean)); const ids = new Set();
  if (typeof map.verification?.ompVersion !== "string") throw mapError("thiếu OMP version xác minh");
  for (const tool of map.tools) {
    if (!tool || !/^[a-z][a-z0-9_]*$/.test(tool.id || "") || ids.has(tool.id)) throw mapError("tool ID trùng hoặc không hợp lệ");
    if (!groups.has(tool.chat?.group) || !APPROVALS.has(tool.chat?.approval) || tool.chat?.selection !== "cli" || tool.omp?.kind !== "builtin" || typeof tool.omp?.cliId !== "string") throw mapError(`tool ${tool.id}`);
    ids.add(tool.id);
  }
  for (const mode of map.modes) {
    if (!mode || !/^[a-z][a-z0-9-]*$/.test(mode.id || "") || mode.omp?.kind !== "cli-flag" || !/^--[a-z][a-z-]*$/.test(mode.omp?.flag || "") || mode.chat?.surface !== "modes" || typeof mode.chat?.label !== "string") throw mapError(`mode ${mode?.id || "không rõ"}`);
  }
  return map;
}

function runText(ompBin, args, env, limit = 4096) {
  return new Promise((resolve, reject) => {
    const child = spawn(ompBin, args, { env, stdio: ["ignore", "pipe", "ignore"] }); let output = ""; let settled = false;
    const finish = (fn, value) => { if (!settled) { settled = true; clearTimeout(timer); fn(value); } };
    const timer = setTimeout(() => { child.kill("SIGTERM"); finish(reject, new Error("OMP audit timeout")); }, AUDIT_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => { if (output.length < limit) output += chunk; });
    child.on("error", (error) => finish(reject, error));
    child.on("close", (code) => code === 0 ? finish(resolve, output.trim()) : finish(reject, new Error("OMP audit không khả dụng")));
  });
}

function runConfig(ompBin, env) {
  return runText(ompBin, ["config", "list", "--json"], env, 1_000_000).then((output) => {
    try { return JSON.parse(output); } catch { throw new Error("OMP config trả JSON không hợp lệ"); }
  });
}

function runRpcState(ompBin, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(ompBin, ["--no-session", "--mode", "rpc", "--approval-mode", "yolo"], { env, stdio: ["pipe", "pipe", "ignore"] });
    let buffer = ""; let settled = false;
    const finish = (fn, value) => { if (!settled) { settled = true; clearTimeout(timer); child.kill("SIGTERM"); fn(value); } };
    const timer = setTimeout(() => finish(reject, new Error("OMP RPC audit timeout")), AUDIT_TIMEOUT_MS);
    const send = (frame) => child.stdin.write(`${JSON.stringify(frame)}\n`);
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); let frame;
        try { frame = JSON.parse(line); } catch { continue; }
        if (frame.type === "ready") send({ id: "omp-tool-audit", type: "get_state" });
        if (frame.type === "response" && frame.id === "omp-tool-audit") {
          if (frame.success === false) return finish(reject, new Error("OMP từ chối RPC audit"));
          return finish(resolve, frame.data?.dumpTools || frame.data?.tools || []);
        }
      }
    });
    child.on("error", (error) => finish(reject, error));
    child.on("close", (code) => { if (!settled) finish(reject, new Error(`OMP RPC audit dừng (${code ?? "signal"})`)); });
  });
}

function descriptors(value) {
  return (Array.isArray(value) ? value : []).flatMap((tool) => {
    const id = String(tool?.name || tool?.id || "").trim();
    if (!/^[A-Za-z][A-Za-z0-9_:.-]*$/.test(id)) return [];
    return [{ id, source: id.startsWith("mcp__") ? "mcp" : "builtin", schemaDigest: digest(tool?.parameters || tool?.inputSchema || null) }];
  }).sort((left, right) => left.id.localeCompare(right.id));
}

async function readSnapshot(path) {
  try { const snapshot = JSON.parse(await readFile(path, "utf8")); return Array.isArray(snapshot?.tools) ? snapshot : null; } catch { return null; }
}
async function writeSnapshot(path, snapshot) {
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 }); await rename(temporary, path);
  } catch { /* Audit persistence must never make Chat unavailable. */ }
}

export function createOmpToolCatalog({ ompBin, env = process.env, cacheMs = CACHE_MS, auditDir = join(env.HOME || homedir(), ".omp", "usage-dashboard", "tool-audits") } = {}) {
  let mapPromise; let reading = null; let cache = { loadedAt: 0, value: null };
  const loadMap = async () => (mapPromise ??= readFile(MAP_PATH, "utf8").then((value) => validateMap(JSON.parse(value))));
  const audit = async (map, settings) => {
    const snapshotPath = join(auditDir, "latest.json"); const previous = await readSnapshot(snapshotPath);
    const [versionResult, toolsResult, helpResult] = await Promise.allSettled([runText(ompBin, ["--version"], env), runRpcState(ompBin, env), runText(ompBin, ["--help"], env, 64_000)]);
    const configDigest = digest(settings || {});
    if (versionResult.status !== "fulfilled" || toolsResult.status !== "fulfilled" || helpResult.status !== "fulfilled") {
      return { status: "error", stale: true, ompVersion: versionResult.status === "fulfilled" ? versionResult.value : null, configDigest, descriptors: [], drift: { added: [], removed: [], changed: [], versionChanged: false, configChanged: false } };
    }
    const current = descriptors(toolsResult.value); const previousById = new Map((previous?.tools || []).map((tool) => [tool.id, tool])); const currentById = new Map(current.map((tool) => [tool.id, tool])); const known = new Set(map.tools.map((tool) => tool.id));
    const added = current.filter((tool) => !previousById.has(tool.id) || !known.has(tool.id)).map((tool) => tool.id);
    const removed = [...previousById.keys()].filter((id) => !currentById.has(id));
    const changed = current.filter((tool) => previousById.has(tool.id) && previousById.get(tool.id).schemaDigest !== tool.schemaDigest).map((tool) => tool.id);
    const versionChanged = normalizeVersion(versionResult.value) !== normalizeVersion(map.verification.ompVersion);
    const configChanged = Boolean(previous && previous.configDigest !== configDigest);
    const record = { schemaVersion: 1, auditedAt: new Date().toISOString(), ompVersion: versionResult.value, configDigest, tools: current, flags: map.modes.filter((mode) => helpResult.value.includes(mode.omp.flag)).map((mode) => mode.omp.flag) };
    await writeSnapshot(snapshotPath, record);
    return { status: "ok", stale: versionChanged || changed.length > 0, ompVersion: versionResult.value, auditedAt: record.auditedAt, configDigest, descriptors: current, drift: { added, removed, changed, versionChanged, configChanged } };
  };
  const read = async ({ force = false } = {}) => {
    if (!force && cache.value && Date.now() - cache.loadedAt < cacheMs) return cache.value;
    if (reading) return reading;
    const operation = (async () => {
    const map = await loadMap(); let settings = null; let configError = null;
    try { settings = await runConfig(ompBin, env); } catch (error) { configError = error; }
    const checked = configError
      ? { status: "error", stale: true, ompVersion: null, configDigest: null, descriptors: [], drift: { added: [], removed: [], changed: [], versionChanged: false, configChanged: false } }
      : await audit(map, settings);
    const changed = new Set(checked.drift.changed); const descriptorById = new Map(checked.descriptors.map((tool) => [tool.id, tool]));
    const tools = map.tools.map((definition) => {
      const lifecycle = definition.lifecycle || "unverified"; const enabled = configEnabled(definition.omp.config, settings); const stale = checked.stale && (checked.drift.versionChanged || changed.has(definition.id));
      const status = lifecycle === "blocked" ? "blocked" : lifecycle !== "active" ? "unavailable" : configError || checked.status !== "ok" ? "probe_error" : stale ? "stale" : enabled ? "supported" : "unavailable";
      const reason = lifecycle === "blocked" || lifecycle !== "active" ? definition.reason || "OMP chưa xác minh tool này." : status === "probe_error" ? "Không kiểm tra được OMP; tool được khoá an toàn." : status === "stale" ? "OMP đã đổi version/schema; cần cập nhật map Chat." : status === "supported" ? "Đã map và cấu hình OMP đang bật." : "Tool đang tắt trong cấu hình OMP.";
      return { id: definition.id, label: definition.chat.label, description: definition.chat.description, icon: definition.chat.icon, group: definition.chat.group, source: definition.omp.kind, selection: definition.chat.selection, approval: definition.chat.approval, alwaysAsk: definition.chat.alwaysAsk === true, status, reason, canToggle: status === "supported", ...(descriptorById.has(definition.id) ? { schemaDigest: descriptorById.get(definition.id).schemaDigest } : {}) };
    });
    const mapped = new Set(map.tools.map((tool) => tool.id));
    for (const tool of checked.descriptors.filter((tool) => !mapped.has(tool.id))) tools.push({ id: tool.id, label: tool.id, description: "OMP vừa công bố tool chưa có map Chat.", icon: "⋯", group: tool.source === "mcp" ? "connections" : "history", source: tool.source, selection: "readonly", approval: "read", alwaysAsk: false, status: "unmapped", reason: "Chỉ hiển thị để đối chiếu; chưa được gửi vào --tools.", canToggle: false, schemaDigest: tool.schemaDigest });
    const counts = Object.fromEntries(["supported", "unavailable", "blocked", "probe_error", "stale", "unmapped"].map((status) => [status, tools.filter((tool) => tool.status === status).length]));
    const flags = new Set(checked.status === "ok" ? (await readSnapshot(join(auditDir, "latest.json")))?.flags || [] : []);
    const sessionModes = map.modes.map((mode) => ({ id: mode.id, label: mode.chat.label, description: mode.chat.description, status: mode.lifecycle === "active" && flags.has(mode.omp.flag) ? "supported" : "unavailable", reason: flags.has(mode.omp.flag) ? "Đã xác minh từ OMP --help." : "OMP không công bố cờ này trong runtime hiện tại." }));
    const value = { tools, sessionModes, observedToolIds: tools.filter((tool) => tool.status === "supported").map((tool) => tool.id), catalog: { mapVersion: map.mapVersion, schemaVersion: map.schemaVersion, source: "checked-in", stale: checked.stale, fingerprint: digest({ map: map.mapVersion, version: checked.ompVersion, config: checked.configDigest, tools: checked.descriptors }), groups: map.groups, counts, audit: { status: checked.status, ompVersion: checked.ompVersion, auditedAt: checked.auditedAt || null, configDigest: checked.configDigest, toolCount: checked.descriptors.length }, drift: checked.drift } };
    if (checked.status === "ok") cache = { loadedAt: Date.now(), value }; return value;
    })();
    reading = operation;
    try { return await operation; }
    finally { if (reading === operation) reading = null; }
  };
  const selected = async (value) => {
    const catalog = await read(); const supported = new Set(catalog.tools.filter((tool) => tool.canToggle).map((tool) => tool.id));
    if (value == null) return [...supported]; const requested = [...new Set((Array.isArray(value) ? value : String(value).split(",")).map((item) => String(item || "").trim()).filter(Boolean))];
    if (requested.length > 32) throw Object.assign(new Error("Danh sách công cụ vượt quá 32 mục"), { code: "BAD_REQUEST", field: "tools" });
    const invalid = requested.filter((id) => !supported.has(id)); if (invalid.length) throw Object.assign(new Error(`Công cụ OMP chưa khả dụng: ${invalid.join(", ")}`), { code: "BAD_REQUEST", field: "tools" });
    return requested;
  };
  const policies = async (ids) => { const catalog = await read(); const byId = new Map(catalog.tools.map((tool) => [tool.id, tool])); return ids.map((id) => byId.get(id)).filter(Boolean); };
  return { read, selected, policies };
}
