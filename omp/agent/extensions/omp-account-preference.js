import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const PREFERENCE_FILE = join(homedir(), ".omp/usage-dashboard/selected-account.json");
const PROVIDER = "google-antigravity";

async function preferredEmail() {
  try {
    const value = JSON.parse(await readFile(PREFERENCE_FILE, "utf8"));
    return typeof value.email === "string" ? value.email.trim().toLowerCase() : "";
  } catch {
    return "";
  }
}

async function applyPreference(ctx, logger) {
  const email = await preferredEmail();
  const sessionId = ctx.sessionManager.getSessionId();
  if (!email || !sessionId) return;

  const authStorage = ctx.modelRegistry?.authStorage;
  if (!authStorage) return;
  const account = authStorage
    .listOAuthAccounts(PROVIDER, sessionId)
    .find((item) => item.email?.toLowerCase() === email);
  if (!account || account.active) return;
  if (authStorage.pinSessionOAuthAccount(PROVIDER, sessionId, account.credentialId)) {
    logger.info("OMP account selected by quota dashboard", { email: account.email });
  }
}

export default function (pi) {
  pi.on("session_start", (_event, ctx) => applyPreference(ctx, pi.logger));
  pi.on("before_agent_start", (_event, ctx) => applyPreference(ctx, pi.logger));
}
