---
applyTo: ".agent-control/**,scripts/agent-control/**,.github/workflows/agent-control-*.yml,docs/development/AGENT_CONTROL*.md,docs/development/EXECUTION_CONTROL_STANDARD.md"
---

For KEYFLOWOS control-plane changes, review especially for:
- exact-head correctness: decisions and evidence must refer to the PR head actually under review;
- idempotency: replaying the same event must not create duplicate semantic effects;
- concurrency: all mutating paths must preserve the intended global serialization guarantees;
- fail-closed behavior on ambiguity, missing auth, stale state, malformed control data, or unresolved contradictions;
- bounded retry and recovery behavior; repeated failures must not create infinite agent loops;
- cursor/lock/worktree isolation and cleanup safety for local workers;
- authority boundaries: builders must not self-admit, and non-authoritative messages must not become actionable;
- control-tail integrity: semantic work and control-only metadata must not be confused;
- proof quality: negative controls should fail for the intended reason, not vacuously.

Do not suggest bypassing a hold, weakening a gate, touching production, sending real provider traffic, or changing architecture authority without an explicit recorded directive.
