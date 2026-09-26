import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createGeminiAccountPinController, geminiQuotaAccountId } from "./gemini-account-pin-extension.mjs";

function makeAccount(provider, credentialId, email, accountId, projectId = "") {
  return { provider, credentialId, email, accountId, projectId };
}

function fakeAuthStorage(accounts, { resolveAccount, resolveCredentialById, pinResult = true } = {}) {
  const calls = [];
  const exactCalls = [];
  const pinned = new Map();
  const storage = {
    keys: {
      async getWithCredential(provider, sessionId, options) {
        calls.push({ provider, sessionId, options });
        const candidates = accounts.filter((account) => account.provider === provider);
        const pinnedCredentialId = pinned.get(`${provider}\0${sessionId}`);
        const candidate = resolveAccount
          ? resolveAccount(candidates, options)
          : options?.accountIds?.length
            ? candidates.find((account) => options.accountIds.includes(account.accountId))
            : candidates.find((account) => account.credentialId === pinnedCredentialId) || candidates[0];
        return candidate
          ? { ok: true, credentialId: candidate.credentialId, apiKey: `synthetic-${candidate.credentialId}` }
          : { ok: false, error: "no matching synthetic credential" };
      },
    },
    async getOAuthAccessByCredentialId(provider, credentialId, options) {
      exactCalls.push({ provider, credentialId, options });
      const candidates = accounts.filter((account) => account.provider === provider);
      const candidate = resolveCredentialById
        ? resolveCredentialById(candidates, credentialId, options)
        : candidates.find((account) => account.credentialId === credentialId);
      return candidate
        ? {
            ok: true,
            credentialId: candidate.credentialId,
            accessToken: `synthetic-${candidate.credentialId}`,
            accountId: candidate.accountId,
            email: candidate.email,
            projectId: candidate.projectId,
          }
        : { ok: false, credentialId, error: "no matching synthetic credential" };
    },
    oauth: {
      accounts(provider) { return accounts.filter((account) => account.provider === provider); },
    },
    sessions: {
      pin(provider, sessionId, credentialId) {
        if (pinResult) pinned.set(`${provider}\0${sessionId}`, credentialId);
        return pinResult;
      },
    },
  };
  return { storage, calls, exactCalls, pinned };
}

const first = makeAccount("google-antigravity", 17, "one@example.test", "google-account-1", "project-one");
const second = makeAccount("google-antigravity", 29, "two@example.test", "google-account-2", "project-two");

test("Gemini session pin resolves its exact OAuth credential", async () => {
  const { storage, exactCalls, pinned } = fakeAuthStorage([first, second]);
  const controller = createGeminiAccountPinController(storage);
  const sessionId = "session-one";
  const targetId = geminiQuotaAccountId(first.provider, first);

  await controller.pinSession(sessionId, targetId);
  const result = await storage.keys.getWithCredential(first.provider, sessionId, { modelId: "gemini-test" });

  assert.equal(result.credentialId, first.credentialId);
  assert.equal(result.apiKey, `synthetic-${first.credentialId}`);
  assert.deepEqual(exactCalls[0], {
    provider: first.provider,
    credentialId: first.credentialId,
    options: { modelId: "gemini-test" },
  });
  assert.equal(pinned.get(`${first.provider}\0${sessionId}`), first.credentialId);
  assert.notEqual(targetId, geminiQuotaAccountId(second.provider, second));
});
test("Gemini session pin supports OAuth accounts without provider account IDs", async () => {
  const account = makeAccount("google-antigravity", 53, "no-id@example.test", undefined, "project-no-id");
  const { storage, exactCalls, pinned } = fakeAuthStorage([account]);
  const controller = createGeminiAccountPinController(storage);
  const sessionId = "session-without-provider-account-id";

  await controller.pinSession(sessionId, geminiQuotaAccountId(account.provider, account));
  const result = await storage.keys.getWithCredential(account.provider, sessionId, { modelId: "gemini-test" });

  assert.equal(result.credentialId, account.credentialId);
  assert.equal(result.apiKey, `synthetic-${account.credentialId}`);
  assert.equal(exactCalls[0].credentialId, account.credentialId);
  assert.equal(pinned.get(`${account.provider}\0${sessionId}`), account.credentialId);
});

test("Google alias resolves through the canonical pinned provider", async () => {
  const { storage, exactCalls } = fakeAuthStorage([first, second]);
  const controller = createGeminiAccountPinController(storage);
  await controller.pinSession("session-one", geminiQuotaAccountId(first.provider, first));

  const result = await storage.keys.getWithCredential("google", "session-one", { modelId: "gemini-test" });
  assert.equal(result.credentialId, first.credentialId);
  assert.equal(exactCalls[0].provider, first.provider);
});

test("an unpinned Gemini session fails before OAuth selection", async () => {
  const { storage, calls } = fakeAuthStorage([first, second]);
  const controller = createGeminiAccountPinController(storage);

  await assert.rejects(storage.keys.getWithCredential(first.provider, "unbound-session", {}), /manually pinned/i);
  assert.equal(calls.length, 0);
});

test("exact pin wins when OMP's soft session resolver falls back to a sibling", async () => {
  const { storage } = fakeAuthStorage([first, second], {
    resolveAccount: (candidates) => candidates.find((account) => account.credentialId === second.credentialId),
  });
  const controller = createGeminiAccountPinController(storage);
  await controller.pinSession("session-one", geminiQuotaAccountId(first.provider, first));

  const result = await storage.keys.getWithCredential(first.provider, "session-one", {});
  assert.equal(result.credentialId, first.credentialId);
});

test("an unavailable exact credential fails closed without using a sibling", async () => {
  const { storage, calls, exactCalls } = fakeAuthStorage([first, second], {
    resolveAccount: (candidates) => candidates.find((account) => account.credentialId === second.credentialId),
    resolveCredentialById: () => null,
  });
  const controller = createGeminiAccountPinController(storage);
  await controller.pinSession("session-one", geminiQuotaAccountId(first.provider, first));

  await assert.rejects(storage.keys.getWithCredential(first.provider, "session-one", {}), /exact pinned Gemini account/i);
  assert.equal(calls.length, 0);
  assert.equal(exactCalls.length, 1);
});

test("non-Gemini providers retain their ordinary resolver", async () => {
  const openai = makeAccount("openai-codex", 41, "chatgpt@example.test", "openai-account");
  const { storage, calls } = fakeAuthStorage([first, openai]);
  createGeminiAccountPinController(storage);
  const result = await storage.keys.getWithCredential("openai-codex", "session-one", { modelId: "gpt-test" });

  assert.equal(result.credentialId, openai.credentialId);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options, { modelId: "gpt-test" });
});

test("pinning rejects unknown identities and failed affinity writes", async () => {
  const { storage } = fakeAuthStorage([first], { pinResult: false });
  const controller = createGeminiAccountPinController(storage);
  const missing = `acc-${createHash("sha256").update("missing").digest("hex").slice(0, 12)}`;

  await assert.rejects(controller.pinSession("session-one", missing), /not available in OMP/i);
  await assert.rejects(controller.pinSession("session-one", geminiQuotaAccountId(first.provider, first)), /could not pin/i);
});
