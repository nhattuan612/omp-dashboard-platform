import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { geminiQuotaAccountId } from "./gemini-account-pin-extension.mjs";

const originalHome = process.env.HOME;
const home = await mkdtemp(join(tmpdir(), "omp-account-control-"));
process.env.HOME = home;
const stateDir = join(home, ".omp", "usage-dashboard");
const preferencePath = join(stateDir, "selected-account.json");
const controlPath = join(stateDir, "omp-account-control.json");
const extensionPath = join(process.cwd(), "omp/agent/extensions/omp-account-preference.js");
const { default: registerAccountControl } = await import(`${pathToFileURL(extensionPath).href}?test=${Date.now()}`);

const globalAccount = { provider: "google-antigravity", credentialId: 17, email: "global@example.test", projectId: "global-project" };
const dashboardAccount = { provider: "google-antigravity", credentialId: 29, email: "dashboard@example.test", projectId: "dashboard-project" };

function makeAuthStorage(pinResult = true, targetActive = false) {
  const pinned = new Map();
  const accounts = [globalAccount, { ...dashboardAccount, active: targetActive }];
  return {
    pinned,
    listOAuthAccounts(provider) { return accounts.filter((account) => account.provider === provider); },
    pinSessionOAuthAccount(provider, sessionId, credentialId) {
      pinned.set(`${provider}\0${sessionId}`, credentialId);
      return pinResult;
    },
  };
}

test("OMP account control ignores legacy preference when off and pins only the configured quota account", async (t) => {
  t.after(async () => {
    process.env.HOME = originalHome;
    await rm(home, { recursive: true, force: true });
  });
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await writeFile(preferencePath, `${JSON.stringify({ email: globalAccount.email })}\n`, { mode: 0o600 });
  const authStorage = makeAuthStorage();
  const handlers = new Map();
  const context = { modelRegistry: { authStorage }, sessionManager: { getSessionId: () => "synthetic-session" } };
  registerAccountControl({ on(event, handler) { handlers.set(event, handler); }, logger: { info() {} } });

  await handlers.get("session_start")({}, context);
  assert.equal(authStorage.pinned.get("google-antigravity\0synthetic-session"), undefined, "off must preserve OMP's original account behavior");

  await writeFile(controlPath, `${JSON.stringify({ enabled: true, accountId: geminiQuotaAccountId(dashboardAccount.provider, dashboardAccount), provider: dashboardAccount.provider })}\n`, { mode: 0o600 });
  await handlers.get("before_agent_start")({}, context);
  assert.equal(authStorage.pinned.get("google-antigravity\0synthetic-session"), dashboardAccount.credentialId);

  await writeFile(controlPath, `${JSON.stringify({ enabled: true, accountId: "acc-000000000000", provider: dashboardAccount.provider })}\n`, { mode: 0o600 });
  await assert.rejects(() => handlers.get("before_agent_start")({}, context), /KHỐNG CHẾ OMP/);

  await writeFile(controlPath, `${JSON.stringify({ enabled: true, accountId: geminiQuotaAccountId(dashboardAccount.provider, dashboardAccount), provider: dashboardAccount.provider })}\n`, { mode: 0o600 });
  const strictContext = { modelRegistry: { authStorage: makeAuthStorage(false, true) }, sessionManager: { getSessionId: () => "strict-session" } };
  await assert.rejects(() => handlers.get("session_start")({}, strictContext), /KHỐNG CHẾ OMP/);
});
