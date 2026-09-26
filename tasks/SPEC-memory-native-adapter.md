# Spec: OMP-native Memory adapter

## Objective

Expose OMP’s real Memory state and management operations in the dashboard without creating a second memory store. OMP remains the source of truth for backend, scope, persistence, retention, and lifecycle. The dashboard must not imply that Memory is active when OMP reports it as off or unsupported.

Evidence at specification time:

- Installed OMP CLI reports `omp/18.3.0`; `omp config get memory.backend` returned `off`.
- Dashboard capability contract currently marks `memory` unavailable; no Memory route or UI adapter exists.
- OMP documents native backends (`off`, `local`, `hindsight`, `mnemopi`, `sharpshooter`) and `/memory` operations. Local mode processes persisted sessions with model roles; Hindsight is remote and `/memory clear` does not delete its server-side bank.
- Existing ADR-08 prohibits a dashboard-owned persistence substitute and requires verified OMP adapter semantics, privacy/retention review, and lifecycle tests.

Official references:

- https://github.com/can1357/oh-my-pi/blob/main/docs/memory.md
- https://github.com/can1357/oh-my-pi/blob/main/docs/mnemosyne-memory-backend.md

The installed-version RPC contract was verified read-only during planning; see “Verified transport” below. The implementation must use that native path, not an undocumented CLI workaround.

## Approved requirements

1. The Memory panel is scoped to the selected OMP session and its working directory, matching project-scoped Memory behavior. OMP’s configured scope remains authoritative; the dashboard does not reinterpret it.
2. OMP configuration remains outside the dashboard. Do not change `memory.backend`, backend settings, environment variables, endpoints, or credentials. The current `off` state remains off.
3. The dashboard invokes only documented OMP-native Memory operations; it does not create a local database, copy Memory into dashboard metadata, or treat chat history as Memory by itself.
4. Read-only operations are `view`, `stats`, `diagnose`, and `queue`, when supported by the active backend. Mutating operations are explicit `sync`, `enqueue`, `rebuild`, `clear`, and `reset` only when OMP confirms support. Processing operations require a warning; all mutations require explicit confirmation and the active backend, with the known deletion boundary named for `clear`/`reset`.
5. `clear` for Hindsight must be described exactly: local session state/recall cache only; it is not server-bank deletion. No UI may claim remote deletion.
6. Memory content is shown only to the authenticated local dashboard user, rendered as untrusted text, and never copied into server logs or dashboard persistence.

## Tech Stack

- Node.js ESM backend (`server.mjs`, `console-bridge.mjs`), vanilla JavaScript frontend (`honpi-chat-dashboard-live.js`), OMP CLI/RPC as the only Memory provider.
- No new dependency and no dashboard-owned database.
- Existing integration tests use Node’s built-in `assert`, a fake OMP process, temporary HOME, and an isolated local HTTP server.

## Commands

Run from the source workspace:

```sh
rtk node --check server.mjs
rtk node --check console-bridge.mjs
rtk node test-session-actions.mjs
rtk sh test-runtime-security.sh
```

Live verification is limited to health/capability/status reads while the configured backend is `off`. Do not enable a backend, invoke model-backed consolidation, clear Memory, or deploy/restart the live service without explicit operator approval.

## Project Structure

- `server.mjs` — authenticated Memory API, capability projection, validation, and safe error mapping.
- `console-bridge.mjs` — verified OMP command transport; no arbitrary command passthrough.
- `honpi-chat-dashboard-live.js` — Memory panel, backend status, per-operation state, warnings, and confirmation UI.
- `test-session-actions.mjs` — isolated fake-OMP contract and lifecycle coverage; no production session data.
- `📚-OMP-DASHBOARD-TECHNICAL-REPORTS-IMPORTANT-🔒/02-API-AND-CAPABILITY-CONTRACT-IMPORTANT-🔒.md`, `06-ADR-CAPABILITY-DECISIONS-IMPORTANT-🔒.md`, `00-INDEX-IMPORTANT-🔒.md`, and `tasks/feature-matrix.md` — keep source capability, live deployment status, and superseding ADR-12 consistent.

## API/UI Contract

- `GET /api/v1/sessions/:id/memory` returns a sanitized snapshot: adapter status, active backend (`off`, a documented backend ID, or `unknown`), OMP-reported scope if available, and supported operation IDs. It never returns config values, tokens, endpoint credentials, or raw OMP diagnostics.
- `POST /api/v1/sessions/:id/memory/action` accepts only a fixed allowlist of native operations. The server rejects unknown sessions without creating an OMP context, then validates session ownership, operation support, confirmation requirements, and active-turn conflicts before forwarding to OMP.
- A command is successful only after a matching OMP response confirms success. HTTP acceptance/dispatch alone is not success. Unknown operations fail with `400`; unknown sessions and stale session/backend bindings fail with `404`/`409`; active chat/Memory conflicts fail with `409`; OMP failure or timeout remains a visible error.
- With `memory.backend=off`, the panel shows “off” and disables operations; it does not offer a one-click activation path.
- Unsupported backend/version/transport combinations remain `partial` or `unavailable`. No prompt text or generic CLI output is used as a fake Memory result.

## Code Style

Follow the existing Node ESM conventions: small route helpers, explicit allowlists, structured errors, and normalized responses. Example pattern already used by the gateway:

```js
if (!GATEWAY_COMMANDS.has(command?.type)) {
  throw Object.assign(new Error("Gateway command không được hỗ trợ"), {
    code: "BAD_REQUEST",
    field: "command.type",
  });
}
```

Keep backend validation authoritative; the UI only mirrors server-reported support and cannot unlock an unsupported operation.

## Testing Strategy

- Isolated fake-OMP contract cases cover `off`, local/Hindsight/MnemoPy/Sharpshooter/unknown backends, CWD isolation, valid stats output, Hindsight clear scope, Sharpshooter clear denial, confirmation/backend mismatch, unknown session, upstream error/timeout, active-turn conflict, no chat-history persistence, and no Memory output in server stderr.
- Exercise the actual dashboard Memory panel in a local isolated browser with fake OMP. Do not use a production session for destructive or model-backed actions.
- Run the exact commands above plus read-only `/healthz` and `/api/v1/omp/capabilities` checks. Source capability becomes `supported` only after the installed OMP transport and isolated lifecycle behavior are verified; it does not imply the live service is deployed or a backend is enabled.

## Boundaries

- **Always:** OMP owns data and lifecycle; preserve `off`; bind actions to the selected session/CWD; expose only verified backend operations; show accurate processing/deletion warnings; validate on the server; redact secrets and Memory content from logs; update capability/API/ADR/docs with code.
- **Ask first:** changing any OMP Memory configuration or credential; enabling a backend; remote-bank deletion; production Memory mutation/model call; deploying or restarting the live dashboard.
- **Never:** create a parallel dashboard Memory database; infer success from HTTP `202` or a prompt response; report Hindsight local clear as remote deletion; log or persist Memory content; silently enable remote processing; bypass OMP authorization or the session boundary.

## Success Criteria

1. The dashboard reports the exact active OMP backend and OMP-reported scope; unavailable scope remains `null`, never inferred. Backend state is truthfully `off`, `supported`, or `unavailable`.
2. Every enabled action maps to an installed-OMP-supported operation and reports the OMP result; unsupported/error/timeout paths never show success.
3. No dashboard database or config/credential mutation is introduced.
4. Processing actions and deletion actions have backend-specific warnings and explicit confirmation where specified.
5. Tests prove session isolation, operation/error behavior, privacy boundaries, and the `off` state; the isolated UI flow works without production Memory data.
6. Capability, API contract, ADR, feature matrix, and index agree on the verified runtime status.

## Verified transport

- OMP 18.3.0 RPC `get_available_commands` advertised the built-in `memory` command and native subcommands `view`, `stats`, `diagnose`, `queue`, `sync`, `clear`, `reset`, `enqueue`, `rebuild`, and `mm …`; the adapter exposes its fixed allowlist only, not the unverified `mm …` group.
- In a `--mode rpc --no-session` probe with `memory.backend=off`, `/memory stats` returned a successful prompt response with `data.agentInvoked=false` and one `command_output` event. No persistent session was created.
- A separate print-mode attempt returned an extension compatibility error and did not return Memory stats; do not use `omp -p` as a fallback. Continue only through the verified RPC local-command path and keep response content out of logs.

## Implementation status — 2026-09-24

- Source implementation is complete for the authenticated API, native capability projection, and session-scoped Memory panel. Unknown sessions return `404` without creating an OMP context; mutations are backend-bound and explicitly confirmed.
- Isolated fake-OMP browser proof: local backend/status rendered, `stats` displayed `fake-memory-stats`, Clear showed its warning and confirmation, and no clear frame was sent. Desktop and 390px mobile layouts had no horizontal overflow.
- `rtk node --check server.mjs`, `rtk node --check test-session-actions.mjs`, and `rtk sh test-runtime-security.sh` passed. `rtk node test-session-actions.mjs` passed all 59 isolated scenarios, including Memory backend/error/confirmation/CWD/unknown-session/active-turn boundaries.
- No live Memory action, config/backend change, deployment, or restart occurred; production OMP backend remains `off`.
