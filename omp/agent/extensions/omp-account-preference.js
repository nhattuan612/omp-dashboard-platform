import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CONTROL_FILE = join(homedir(), ".omp/usage-dashboard/omp-account-control.json");
const PROVIDER = "google-antigravity";

function quotaAccountId(provider, account) {
  const identity = [provider, "", account?.email || "", "", account?.projectId || ""].join("\0");
  return `acc-${createHash("sha256").update(identity).digest("hex").slice(0, 12)}`;
}

async function control() {
  try {
    const value = JSON.parse(await readFile(CONTROL_FILE, "utf8"));
    return value?.enabled === true && value.provider === PROVIDER && /^acc-[a-f0-9]{12}$/.test(value.accountId || "")
      ? value
      : null;
  } catch {
    return null;
  }
}

async function applyControl(ctx, logger) {
  const activeControl = await control();
  if (!activeControl) return;
  const sessionId = ctx?.sessionManager?.getSessionId?.();
  if (!sessionId) throw new Error("KHỐNG CHẾ OMP không tìm thấy session OMP để ghim account");

  const authStorage = ctx.modelRegistry?.authStorage;
  if (!authStorage || typeof authStorage.listOAuthAccounts !== "function" || typeof authStorage.pinSessionOAuthAccount !== "function") {
    throw new Error("KHỐNG CHẾ OMP không thể ghim OAuth account trên runtime này");
  }
  const account = authStorage
    .listOAuthAccounts(PROVIDER, sessionId)
    .filter((item) => quotaAccountId(PROVIDER, item) === activeControl.accountId);
  if (account.length !== 1 || account[0].credentialId == null) throw new Error("KHỐNG CHẾ OMP không tìm thấy đúng OAuth account đã chọn ở Quota");
  if (authStorage.pinSessionOAuthAccount(PROVIDER, sessionId, account[0].credentialId) !== true) throw new Error("KHỐNG CHẾ OMP không thể ghim OAuth account đã chọn");
  logger.info("OMP account locked by quota dashboard", { email: account[0].email });
}

export default function (pi) {
  pi.on("session_start", (_event, ctx) => applyControl(ctx, pi.logger));
  pi.on("before_agent_start", (_event, ctx) => applyControl(ctx, pi.logger));
}
