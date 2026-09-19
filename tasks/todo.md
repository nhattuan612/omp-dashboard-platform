# OMP Web Console checklist

## Before implementation

- [ ] Síp approves `tasks/plan.md`.
- [ ] Confirm default UI vs supplied HTML reference.
- [ ] Confirm loopback-only access for first release.

## Slice 1 — protocol bridge and shell

- [x] Add `/console` route and navigation from the existing dashboard.
- [x] Add lifecycle-safe ACP/RPC process registry.
- [x] Add browser transport and reconnect state.
- [x] Add raw frame/health diagnostics.
- [x] Add protocol frame smoke test.

## Slice 2 — sessions

- [x] Add ACP project/session discovery and full stored-session list.
- [x] Add create/load/resume/switch/fork/branch/rename/export/handoff.
- [x] Add compact/abort/close actions.
- [x] Add reconnect without duplicate session.
- [x] Run checkpoint A review.

## Slice 3 — full OMP surface

- [x] Add prompt streaming, steer, follow-up, abort, and queue controls.
- [x] Add model/provider/thinking/fast-mode controls.
- [x] Add compaction/retry/bash/todo/subagent/message controls.
- [x] Add slash-command palette from OMP responses.
- [x] Add tool/event/raw renderers.
- [x] Add all extension UI request handlers.
- [x] Add OMP login provider flow.

## Slice 4 — stability and handoff

- [x] Add reconnect/child cleanup tests; backpressure remains bounded by the local SSE stream.
- [x] Add masked diagnostics and version/protocol metadata.
- [x] Verify responsive/accessibility states.
- [x] Update README and machine-migration instructions.
- [x] Run final smoke checks and inspect diff.
