import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const MAP_PATH = fileURLToPath(new URL("./omp-tool-map.json", import.meta.url));
const CACHE_MS = 300_000;
const APPROVALS = new Set(["read", "write", "exec"]);

function configValue(settings, key) {
  return settings?.[key]?.value === true;
}

function configEnabled(rule, settings) {
  if (rule?.mode === "always") return true;
  if (rule?.mode === "enabled") return configValue(settings, rule.key);
  if (rule?.mode === "any") return Array.isArray(rule.keys) && rule.keys.some((key) => configValue(settings, key));
  return false;
}

function mapError(message) {
  return Object.assign(new Error(`OMP tool map không hợp lệ: ${message}`), { code: "UPSTREAM_UNAVAILABLE" });
}

function validateMap(map) {
  if (!map || typeof map !== "object" || !Number.isInteger(map.schemaVersion) || typeof map.mapVersion !== "string") throw mapError("thiếu version");
  if (!Array.isArray(map.groups) || !Array.isArray(map.tools)) throw mapError("thiếu groups hoặc tools");
  const groups = new Set(map.groups.map((item) => item?.id));
  const ids = new Set();
  for (const tool of map.tools) {
    if (!tool || !/^[a-z][a-z0-9_]*$/.test(tool.id || "") || ids.has(tool.id)) throw mapError("tool ID trùng hoặc không hợp lệ");
    if (!groups.has(tool.chat?.group) || !APPROVALS.has(tool.chat?.approval) || tool.chat?.selection !== "cli" || tool.omp?.kind !== "builtin" || typeof tool.omp?.cliId !== "string") throw mapError(`tool ${tool.id}`);
    ids.add(tool.id);
  }
  return map;
}

function runConfig(ompBin, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(ompBin, ["config", "list", "--json"], { env, stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    let settled = false;
    const finish = (fn, value) => { if (!settled) { settled = true; clearTimeout(timer); fn(value); } };
    const timer = setTimeout(() => { child.kill("SIGTERM"); finish(reject, new Error("OMP config timeout")); }, 10_000);
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.on("error", (error) => finish(reject, error));
    child.on("close", (code) => {
      if (code !== 0) return finish(reject, new Error("OMP config không khả dụng"));
      try { finish(resolve, JSON.parse(output)); } catch { finish(reject, new Error("OMP config trả JSON không hợp lệ")); }
    });
  });
}

export function createOmpToolCatalog({ ompBin, env = process.env, cacheMs = CACHE_MS } = {}) {
  let mapPromise;
  let cache = { loadedAt: 0, value: null };

  const loadMap = async () => {
    mapPromise ??= readFile(MAP_PATH, "utf8").then((value) => validateMap(JSON.parse(value)));
    return mapPromise;
  };

  const read = async ({ force = false } = {}) => {
    if (!force && cache.value && Date.now() - cache.loadedAt < cacheMs) return cache.value;
    const map = await loadMap();
    let settings = null;
    let configError = null;
    try { settings = await runConfig(ompBin, env); } catch (error) { configError = error; }
    const tools = map.tools.map((definition) => {
      const lifecycle = definition.lifecycle || "unverified";
      const enabled = settings && configEnabled(definition.omp.config, settings);
      const status = lifecycle === "blocked" ? "blocked" : lifecycle !== "active" ? "unavailable" : configError ? "probe_error" : enabled ? "supported" : "unavailable";
      const reason = lifecycle === "blocked" || lifecycle !== "active"
        ? definition.reason || "OMP chưa xác minh tool này."
        : configError
          ? "Không đọc được cấu hình OMP; tool được khoá an toàn."
          : enabled
            ? "Đã map và cấu hình OMP đang bật."
            : "Tool đang tắt trong cấu hình OMP.";
      return {
        id: definition.id,
        label: definition.chat.label,
        description: definition.chat.description,
        icon: definition.chat.icon,
        group: definition.chat.group,
        source: definition.omp.kind,
        selection: definition.chat.selection,
        approval: definition.chat.approval,
        alwaysAsk: definition.chat.alwaysAsk === true,
        status,
        reason,
        canToggle: status === "supported"
      };
    });
    const counts = Object.fromEntries(["supported", "unavailable", "blocked", "probe_error"].map((status) => [status, tools.filter((tool) => tool.status === status).length]));
    const value = {
      tools,
      observedToolIds: tools.filter((tool) => tool.status === "supported").map((tool) => tool.id),
      catalog: { mapVersion: map.mapVersion, schemaVersion: map.schemaVersion, source: "checked-in", stale: Boolean(configError), counts }
    };
    cache = { loadedAt: Date.now(), value };
    return value;
  };

  const selected = async (value) => {
    const catalog = await read();
    const supported = new Set(catalog.tools.filter((tool) => tool.canToggle).map((tool) => tool.id));
    if (value == null) return [...supported];
    const requested = [...new Set((Array.isArray(value) ? value : String(value).split(",")).map((item) => String(item || "").trim()).filter(Boolean))];
    if (requested.length > 32) throw Object.assign(new Error("Danh sách công cụ vượt quá 32 mục"), { code: "BAD_REQUEST", field: "tools" });
    const invalid = requested.filter((id) => !supported.has(id));
    if (invalid.length) throw Object.assign(new Error(`Công cụ OMP chưa khả dụng: ${invalid.join(", ")}`), { code: "BAD_REQUEST", field: "tools" });
    return requested;
  };

  const policies = async (ids) => {
    const catalog = await read();
    const byId = new Map(catalog.tools.map((tool) => [tool.id, tool]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  };

  return { read, selected, policies };
}
