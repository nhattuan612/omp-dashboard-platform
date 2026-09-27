#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const args = new Set(process.argv.slice(2));
if ([...args].some((arg) => !["--apply", "--verify"].includes(arg))) throw new Error("Dùng: node recover-project-folder-sessions.mjs [--apply] [--verify]");
if (args.has("--apply") && args.has("--verify")) throw new Error("Chỉ dùng một trong --apply hoặc --verify.");

const dashboardRoot = process.env.OMP_USAGE_DASHBOARD_DIR || join(homedir(), ".omp", "usage-dashboard");
const metadataFile = join(dashboardRoot, "chat-metadata.json");
const sessionRoot = process.env.OMP_SESSION_ROOT || join(homedir(), ".omp", "agent", "sessions");

function inside(root, candidate) {
  const difference = relative(root, candidate);
  return difference === "" || (!difference.startsWith("..") && !isAbsolute(difference));
}

function titleFrom(content) {
  const lines = String(content || "").split(/\r?\n/).map((line) => line.replace(/^\s*#+\s*/, "").trim()).filter(Boolean);
  const title = (lines.find((line) => !/^instructions?\b/i.test(line)) || lines[0] || "").replace(/\s+/g, " ").trim();
  return title.length > 72 ? `${title.slice(0, 69).trim()}…` : title;
}

function textFrom(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(textFrom).filter(Boolean).join("\n");
  if (!value || typeof value !== "object") return "";
  return [value.text, value.content, value.value].map(textFrom).find(Boolean) || "";
}

function customUserContent(record) {
  if (record?.type !== "custom_message" || record?.attribution !== "user" || typeof record.content !== "string") return "";
  const matched = record.content.match(/(?:^|\n)User:\s*([\s\S]*)$/);
  return (matched ? matched[1] : record.content).split("\n\n[Attached file:")[0].trim();
}

function validDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : "";
}

async function transcript(file) {
  const fileStat = await stat(file);
  const result = { file, session: null, title: "", firstUser: "", messageCount: 0, createdAt: "", updatedAt: "" };
  for (const line of (await readFile(file, "utf8")).split("\n")) {
    if (!line) continue;
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    if (record.type === "session" && typeof record.id === "string" && typeof record.cwd === "string") {
      result.session = record;
      result.createdAt = validDate(record.timestamp) || result.createdAt;
    }
    if (record.type === "title" && typeof record.title === "string" && record.title.trim()) result.title = record.title.trim();
    const custom = customUserContent(record);
    const message = custom ? { role: "user", content: custom } : record.message;
    if (!message || !["user", "assistant"].includes(message.role)) continue;
    const content = textFrom(message);
    if (!content) continue;
    result.messageCount += 1;
    if (!result.firstUser && message.role === "user") result.firstUser = content;
    result.updatedAt = validDate(record.timestamp) || validDate(message.completedAt) || validDate(message.timestamp) || result.updatedAt;
  }
  if (!result.session) return null;
  result.title = result.title || titleFrom(result.firstUser) || "Phiên làm việc mới";
  result.createdAt = result.createdAt || new Date(fileStat.birthtimeMs || fileStat.mtimeMs).toISOString();
  result.updatedAt = result.updatedAt || new Date(fileStat.mtimeMs).toISOString();
  return result;
}

async function sessionFiles(directory = sessionRoot) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
  const nested = await Promise.all(entries.map((entry) => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? sessionFiles(file) : entry.name.endsWith(".jsonl") ? [file] : [];
  }));
  return nested.flat();
}

async function atomicWrite(file, data) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, file);
}

async function backupMetadata() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const directory = join(dashboardRoot, "backups", "project-folder-recovery", `${stamp}-${process.pid}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const destination = join(directory, "chat-metadata.json");
  await copyFile(metadataFile, destination);
  const digest = createHash("sha256").update(await readFile(destination)).digest("hex");
  await writeFile(join(directory, "MANIFEST.sha256"), `${digest}  chat-metadata.json\n`, { mode: 0o600 });
  return directory;
}

async function plan() {
  const metadata = JSON.parse(await readFile(metadataFile, "utf8"));
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || !metadata.folders || !metadata.sessions) throw new Error("Metadata chat không hợp lệ.");
  const folders = (await Promise.all(Object.values(metadata.folders).map(async (folder) => {
    if (!folder || typeof folder.id !== "string" || typeof folder.name !== "string" || typeof folder.cwd !== "string") return null;
    const cwd = await realpath(folder.cwd).catch(() => null);
    return cwd ? { ...folder, cwd } : null;
  }))).filter(Boolean).sort((a, b) => b.cwd.length - a.cwd.length);
  const byNativeId = new Map();
  const byPath = new Map();
  for (const [id, value] of Object.entries(metadata.sessions)) {
    if (!value || typeof value !== "object") continue;
    byNativeId.set(id, id);
    if (typeof value.ompSessionId === "string") byNativeId.set(value.ompSessionId, id);
    if (typeof value.path === "string") byPath.set(value.path, id);
  }
  const report = { scanned: 0, matched: 0, created: 0, updated: 0, unchanged: 0, skippedOtherFolder: 0, skippedDeletedOrArchived: 0, folders: {} };
  const next = structuredClone(metadata);
  for (const file of await sessionFiles()) {
    const item = await transcript(file).catch(() => null);
    if (!item) continue;
    report.scanned += 1;
    const transcriptCwd = await realpath(item.session.cwd).catch(() => null);
    const folder = transcriptCwd && folders.find((candidate) => inside(candidate.cwd, transcriptCwd));
    if (!folder) continue;
    report.matched += 1;
    const key = byNativeId.get(item.session.id) || byPath.get(file) || (next.sessions[item.session.id] ? `recovered-${item.session.id}` : item.session.id);
    const current = next.sessions[key] || {};
    if (current.deleted || current.archived) {
      report.skippedDeletedOrArchived += 1;
      continue;
    }
    if (current.folderId && current.folderId !== folder.id) {
      report.skippedOtherFolder += 1;
      continue;
    }
    const recovered = {
      ...current,
      path: file,
      ompSessionId: item.session.id,
      cwd: item.session.cwd,
      title: current.title && current.title !== "Phiên làm việc mới" ? current.title : item.title,
      messageCount: Math.max(Number(current.messageCount) || 0, item.messageCount),
      createdAt: current.createdAt || item.createdAt,
      updatedAt: current.updatedAt || item.updatedAt,
      folderId: folder.id,
      folderName: folder.name,
    };
    const changed = JSON.stringify(current) !== JSON.stringify(recovered);
    if (!current || !Object.keys(current).length) report.created += 1;
    else if (changed) report.updated += 1;
    else report.unchanged += 1;
    next.sessions[key] = recovered;
    byNativeId.set(item.session.id, key);
    byPath.set(file, key);
    report.folders[folder.name] = (report.folders[folder.name] || 0) + 1;
  }
  return { metadata, next, report };
}

const result = await plan();
if (args.has("--verify")) {
  const incomplete = result.report.created + result.report.updated + result.report.skippedOtherFolder;
  console.log(JSON.stringify({ mode: "verify", ...result.report, complete: incomplete === 0 }, null, 2));
  if (incomplete) process.exitCode = 1;
} else if (args.has("--apply")) {
  const backup = await backupMetadata();
  await atomicWrite(metadataFile, result.next);
  const verify = await plan();
  const incomplete = verify.report.created + verify.report.updated + verify.report.skippedOtherFolder;
  console.log(JSON.stringify({ mode: "apply", backup, ...result.report, verified: incomplete === 0 }, null, 2));
  if (incomplete) process.exitCode = 1;
} else {
  console.log(JSON.stringify({ mode: "dry-run", ...result.report, apply: "Chạy lại với --apply sau khi kiểm tra." }, null, 2));
}
