# .agent-control

This directory contains machine-readable control-plane artifacts for active implementation packets.

For `impl/*` pull requests:

- `active-packet.yaml` is directive-owned. It records the packet released by ChatGPT, source main, branch, state, health, allowed scope and proof obligations.
- `claude-return.yaml` is implementer-owned until review. Claude records source head, characterization, changes, proof results, discoveries and open questions.
- ChatGPT sets the final `review_status` after integration review.

These files are not substitutes for the canonical packet or PR. They are compact admission artifacts that allow repository gates to reject silent scope drift and unreviewed merge readiness.

Do not place secrets, provider credentials, production data or large logs here.


## source_head

`source_head` is the final semantic implementation commit, not necessarily the branch tip. Commits after it are permitted only for `.agent-control/**` metadata. Any later code/schema/migration/test change invalidates the return and requires a new semantic head plus refreshed proof evidence.

## programme-state.yaml

`programme-state.yaml` is the **canonical live programme control state** — the
single machine-readable authority for which packet is active, its state and
health, the resolved source main, holds, unresolved contradictions, the event
journal and the next legal action.

It is advanced from valid events through the state machine, not hand-edited
while the orchestrator is running. Issue #80 is the append-only event log; the
intelligence branch is the durable checkpoint projection. Neither is live state.

See "Canonical state authority" in `docs/development/AGENT_CONTROL_PLANE.md`.

`.worker/` holds local worker runtime state (lock, log, processed-directive
cursor) and is git-ignored.
