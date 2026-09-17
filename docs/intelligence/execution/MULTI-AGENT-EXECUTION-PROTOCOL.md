# KEYFLOWOS Multi-Agent Execution Protocol

## ChatGPT — Architecture / Evidence Command Center
Owns packet semantics, dependency release, evidence admission and minimal architecture reopen decisions.

## Claude Code — Primary Implementer
For an authorized packet:
1. load AGENTS, continuity, packet and owners;
2. revalidate current main;
3. return no-edit characterization;
4. implement bounded scope only;
5. run applicable proof;
6. return exact diff/migrations/commands/results/new consumers;
7. stop on target contradiction.

## Kimi Code — Adversarial Reviewer
Independently challenge missed writers/readers, concurrency/idempotency/tenant/authority assumptions, migration ambiguity, rollback and proof vacuity.

## Required return envelope

```yaml
packet_id:
source_head:
source_drift:
characterization:
changed_files:
schema_migrations:
tests:
  commands:
  discovered:
  passed:
  failed:
  skipped:
negative_controls:
provider_or_external_runs:
cleanup:
new_consumers_or_writers:
deviations_from_packet:
rollback_floor:
open_questions:
evidence_refs:
```

No agent may silently add a kernel, duplicate authority/billing/workflow/recovery engine, weaken a gate, or expand scope.

Parallel implementation is allowed only when authoritative writers/migrations do not overlap.
