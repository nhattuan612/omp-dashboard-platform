# OMP Web Console — implementation plan

## Outcome

Extend the existing local OMP Dashboard Platform at `127.0.0.1:4177` into a
full OMP Web Console. The console must expose the capabilities that OMP
exposes, including advanced controls; it must not silently remove or hide
features. Quota/account management remains available as its existing area.

The console will not reimplement OMP's agent engine. It will use OMP's
official headless protocols:

- ACP (`omp --mode acp`) as the official persisted-session discovery sidecar.
- RPC (`omp --mode rpc`) for the complete command/event surface, including
  prompt streaming, model and thinking controls, queue modes, compaction,
  retry, bash, slash commands, extension UI requests, host tools/URI schemes,
  subagents, login, message paging, and raw protocol inspection.

The console shell and management UX will be designed in this repository. OMP
capability rendering will be data-driven from protocol responses, so newly
advertised slash commands and provider/model data are shown instead of being
hard-coded into a reduced menu.

## Non-goals and safety boundaries

- Do not modify OMP core or its installed package.
- Do not copy OAuth tokens, account databases, session contents, cookies, or
  collab URLs into the repository.
- Keep the web server loopback-only by default.
- Do not enable an API-key proxy or automatic multi-account quota rotation.
- Do not hide dangerous controls; expose them with clear labels, confirmation,
  and error states.
- Keep the current quota dashboard APIs and history behavior working.

## Architecture

1. `dashboard/server.mjs` remains the single local server and serves both the
   quota view and the console.
2. Add a small OMP protocol bridge in the same server layer. It owns one RPC
   child process per interactive console context and short-lived ACP child
   processes for persisted-session discovery; it validates frames, correlates
   requests, forwards events, and closes processes on disconnect/idle timeout.
3. Use one managed OMP protocol context per open console session. Do not share
   stdin/stdout between browser clients. Keep an explicit registry so a tab
   reconnects to the same session or receives a clean closed state.
4. Use Server-Sent Events or WebSocket only as a browser transport; keep the
   OMP protocol boundary separate from the browser message format.
5. Add `dashboard/console.html` and `dashboard/console-live.js` using the
   repository's existing dependency-free style unless an existing installed
   dependency is proven necessary. The UI has a dense admin layout with:
   - session/project navigator;
   - transcript with text, thinking, tool calls/results, errors, subagents,
     attachments, and raw event details;
   - composer with slash-command discovery and queue/interrupt behavior;
   - model/provider/thinking/mode selectors;
   - session actions: new, load, resume, switch, fork, branch, rename,
     export, handoff, compact, retry, abort, close;
   - settings/capabilities panels for every RPC/ACP option;
   - extension dialogs/widgets/status, host-tool and URI requests;
   - an always-available Advanced/Raw panel showing protocol frames and
     allowing validated commands, so no capability is hidden by the shell;
   - existing quota/account/history views as navigation items.
6. Add a protocol capability matrix and feature flags only for runtime
   availability. An unavailable capability is visibly marked with the reason;
   it is not silently omitted.

## Vertical slices

### Slice 1 — protocol bridge and console shell

Scope: add console route/static assets; implement lifecycle-safe ACP/RPC process
management; negotiate protocol; expose health, active contexts, and raw frames.

Acceptance:

- Opening `/console` shows connection state and no console process starts until
  the user creates or opens a session.
- New/reconnect/close does not leak child processes or leave orphaned readers.
- Malformed/oversized frames and OMP process failure become visible errors;
  secrets are redacted from server logs and raw diagnostics.
- Existing `/` quota dashboard and its API routes remain unchanged.

Likely files: `dashboard/server.mjs`, `dashboard/console.html`,
`dashboard/console-live.js`, `dashboard/console-bridge.mjs`, `README.md`.

Verification: local health smoke test, process cleanup test, browser check at
320/768/1024/1440 px, and a small Node assert-based protocol-frame test.

### Slice 2 — session/workspace management

Scope: wire ACP stored-session discovery and RPC session actions. Show
projects, session metadata, cwd, title, timestamps, and session actions.

Acceptance:

- User can create, list, load/resume, switch, fork, rename, branch, export,
  handoff, compact, abort, and close a session where OMP advertises support.
- A browser refresh reconnects to the selected session without creating a
  duplicate session.
- Empty, loading, stale, and process-error states are distinct and actionable.
- Session paths are validated server-side and never allow arbitrary command
  execution outside OMP's own protocol.

Likely files: bridge/server additions, console markup/controller, session
navigation components, tests.

Verification: create/load/fork/close lifecycle test using a fake OMP protocol
child, then a real local OMP smoke test without sending a model prompt.

### Checkpoint A — Síp reviews the session flow before full controls

Confirm the navigator, session lifecycle, and raw diagnostics are acceptable.
If the visual direction changes, apply the supplied HTML/design before Slice 3;
otherwise continue with the default dense admin UI.

### Slice 3 — full interactive agent surface

Scope: stream transcript events and make every RPC command and extension UI
request usable from the browser.

Acceptance:

- Prompt, steer, follow-up, abort, and abort-and-prompt work with visible
  streaming and queue state.
- Model list/selection, thinking level, fast mode, steering/follow-up/
  interrupt modes, auto-compaction, auto-retry, bash, slash commands, todos,
  subagents, message paging, token/context stats, and session export are
  visible and operable.
- Tool calls/results, errors, usage, compaction, retry, subagent lifecycle,
  and command output render without dropping unknown event fields; raw JSON is
  available for every event.
- All `extension_ui_request` variants (`select`, `confirm`, `input`, `editor`,
  `notify`, status/widget/title, URL, and cancellation) have browser handling.
- Login providers and login links are exposed through OMP, without copying
  OAuth codes or tokens into application state.

Likely files: protocol bridge, console controller/renderers, styles, tests.

Verification: deterministic fake event stream covering every event family,
then a real prompt with a local authenticated OMP model and an extension UI
request.

### Slice 4 — stability, observability, and handoff

Scope: harden reconnect/backpressure/cleanup, expose runtime diagnostics, and
document migration/startup.

Acceptance:

- Reconnect resumes state or clearly reports that a session was closed.
- Backpressure does not reorder correlated responses or freeze the UI.
- Idle cleanup and server shutdown close all child processes.
- Diagnostics show OMP version, protocol version, cwd, PID, session id, model,
  connection age, last event, and errors; token/credential values are masked.
- README documents startup, URL, architecture, supported protocol surfaces,
  limitations, and moving the platform to another machine.
- Automated checks pass and manual responsive/accessibility checks cover
  keyboard focus, labels, contrast, Vietnamese glyphs, and narrow screens.

Likely files: bridge, server, console UI, README, tests, launchd template if
startup behavior changes.

Verification: repeated reconnect/kill/restart test, `git diff --check`, Node
assert smoke tests, and manual browser verification.

## Resolved decisions

- Síp approved implementation with the default dense admin UI; no HTML reference was required.
- Console remains loopback-only at `127.0.0.1:4177`.
- OMP core and credentials remain outside the repository; the platform uses ACP/RPC through the installed CLI.
