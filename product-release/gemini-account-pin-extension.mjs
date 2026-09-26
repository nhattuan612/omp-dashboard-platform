import { createHash } from "node:crypto";

const GEMINI_PROVIDERS = new Set(["google-gemini-cli", "google-antigravity"]);
const GUARDED_GOOGLE_PROVIDERS = new Set([...GEMINI_PROVIDERS, "google"]);
const controllers = new WeakMap();

export function geminiQuotaAccountId(provider, account) {
  const identity = [provider, "", account?.email || "", "", account?.projectId || ""].join("\0");
  return `acc-${createHash("sha256").update(identity).digest("hex").slice(0, 12)}`;
}

export function createGeminiAccountPinController(authStorage) {
  if (!authStorage || typeof authStorage !== "object") throw new Error("OMP AuthStorage is unavailable");
  const existing = controllers.get(authStorage);
  if (existing) return existing;
  const keys = authStorage.keys;
  const oauth = authStorage.oauth;
  const sessions = authStorage.sessions;
  const resolve = keys?.getWithCredential;
  const resolveExact = authStorage.getOAuthAccessByCredentialId;
  if (
    typeof resolve !== "function" ||
    typeof resolveExact !== "function" ||
    typeof oauth?.accounts !== "function" ||
    typeof sessions?.pin !== "function"
  ) {
    throw new Error("OMP AuthStorage does not support strict Gemini account pinning");
  }

  const pins = new Map();
  keys.getWithCredential = async function getWithCredential(provider, sessionId, options = {}) {
    if (!GUARDED_GOOGLE_PROVIDERS.has(String(provider || "").toLowerCase())) {
      return resolve.call(keys, provider, sessionId, options);
    }
    const pin = pins.get(String(sessionId || ""));
    if (!pin) throw new Error("This chat requires a manually pinned Gemini account");
    if (provider !== "google" && provider !== pin.provider) {
      throw new Error("This chat's Gemini account is pinned to a different Google provider");
    }
    const exact = await resolveExact.call(authStorage, pin.provider, pin.credentialId, options);
    if (
      exact?.ok !== true ||
      exact.credentialId !== pin.credentialId ||
      typeof exact.accessToken !== "string" ||
      !exact.accessToken
    ) {
      throw new Error("OMP did not resolve the exact pinned Gemini account");
    }
    return { ok: true, credentialId: exact.credentialId, apiKey: exact.accessToken };
  };

  const controller = {
    async pinSession(sessionId, accountId) {
      const session = String(sessionId || "").trim();
      const selectedId = String(accountId || "").trim();
      if (!session) throw new Error("OMP session ID is required to pin a Gemini account");
      if (!/^acc-[a-f0-9]{12}$/.test(selectedId)) throw new Error("Gemini account ID is invalid");
      const matches = [];
      for (const provider of GEMINI_PROVIDERS) {
        for (const account of oauth.accounts(provider, session) || []) {
          if (geminiQuotaAccountId(provider, account) === selectedId) matches.push({ provider, account });
        }
      }
      if (matches.length !== 1) throw new Error("Selected Gemini account is not available in OMP for this session");
      const { provider, account } = matches[0];
      if (account.credentialId == null) throw new Error("Selected Gemini account has no usable OAuth credential in OMP");
      if (sessions.pin(provider, session, account.credentialId) !== true) throw new Error("OMP could not pin the selected Gemini credential");
      pins.set(session, {
        provider,
        credentialId: account.credentialId,
      });
      return { provider, quotaAccountId: selectedId };
    },
  };
  controllers.set(authStorage, controller);
  return controller;
}

export default function registerGeminiAccountPin(pi) {
  const controllerFor = (context) => createGeminiAccountPinController(context?.modelRegistry?.authStorage);
  pi.on("session_start", (_event, context) => { controllerFor(context); });
  pi.registerCommand("dashboard-gemini-pin", {
    description: "Pin one manually selected Gemini OAuth account to this OMP chat session",
    handler: async (args, context) => {
      const accountId = String(args || "").trim();
      if (!/^acc-[a-f0-9]{12}$/.test(accountId)) throw new Error("Expected one Gemini quota account ID");
      const sessionId = context?.sessionManager?.getSessionId?.();
      await controllerFor(context).pinSession(sessionId, accountId);
    },
  });
}
