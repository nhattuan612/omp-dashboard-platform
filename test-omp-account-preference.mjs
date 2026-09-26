import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createGeminiAccountPinController, geminiQuotaAccountId } from "./gemini-account-pin-extension.mjs";

const preferencePath = join(homedir(), ".omp/usage-dashboard/selected-account.json");
const preference = JSON.parse(await readFile(preferencePath, "utf8"));
const preferredEmail = String(preference.email || "").trim().toLowerCase();
if (!preferredEmail) throw new Error("OMP global account preference is unavailable for this test");

const extensionPath = join(homedir(), ".omp/agent/extensions/omp-account-preference.js");
const { default: registerAccountPreference } = await import(pathToFileURL(extensionPath).href);

const globalAccount = {
  provider: "google-antigravity",
  credentialId: 17,
  email: preferredEmail,
  accountId: "global-account",
  projectId: "global-project",
};
const dashboardAccount = {
  provider: "google-antigravity",
  credentialId: 29,
  email: "dashboard-selected@example.test",
  accountId: "dashboard-account",
  projectId: "dashboard-project",
};

function makeAuthStorage() {
  const pinned = new Map();
  const accounts = [globalAccount, dashboardAccount];
  return {
    pinned,
    keys: {
      async getWithCredential(provider, sessionId) {
        const credentialId = pinned.get(`${provider}\0${sessionId}`);
        const account = accounts.find((item) => item.provider === provider && item.credentialId === credentialId);
        return account
          ? { ok: true, credentialId: account.credentialId, apiKey: `synthetic-${account.credentialId}` }
          : { ok: false, error: "no synthetic session pin" };
      },
    },
    async getOAuthAccessByCredentialId(provider, credentialId) {
      const account = accounts.find((item) => item.provider === provider && item.credentialId === credentialId);
      return account
        ? { ok: true, credentialId, accessToken: `synthetic-${credentialId}` }
        : undefined;
    },
    oauth: {
      accounts(provider) { return accounts.filter((account) => account.provider === provider); },
    },
    sessions: {
      pin(provider, sessionId, credentialId) {
        pinned.set(`${provider}\0${sessionId}`, credentialId);
        return true;
      },
    },
  };
}

test("global preference does not overwrite a dashboard chat's explicit Gemini pin", async () => {
  const authStorage = makeAuthStorage();
  const handlers = new Map();
  const sessionId = "synthetic-dashboard-session";
  const context = {
    modelRegistry: { authStorage },
    sessionManager: { getSessionId: () => sessionId },
  };
  registerAccountPreference({
    on(event, handler) { handlers.set(event, handler); },
    logger: { info() {}, warn() {} },
  });

  await handlers.get("session_start")({}, context);
  assert.equal(authStorage.pinned.get(`google-antigravity\0${sessionId}`), globalAccount.credentialId);

  const controller = createGeminiAccountPinController(authStorage);
  await controller.pinSession(sessionId, geminiQuotaAccountId(dashboardAccount.provider, dashboardAccount));
  await handlers.get("before_agent_start")?.({}, context);

  const result = await authStorage.keys.getWithCredential("google-antigravity", sessionId, {});
  assert.equal(result.credentialId, dashboardAccount.credentialId);
});
