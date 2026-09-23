# KEYFLOWOS Agent Autopilot

Status: CONTROL-PLANE AUTOMATION V1

## Goal

Remove the human operator from mechanical relay work while preserving the
existing execution-control standard, packet boundaries, adversarial proof
requirements and production safety constraints.

The automation optimizes for **maximum unattended throughput subject to
invariant preservation**, not maximum autonomy. It must know when it is allowed
to move, and it must fail closed on ambiguity.

## Architecture

```text
issue #80 (append-only event log)      .agent-control/programme-state.yaml
        |                                   (canonical LIVE state)
        v                                            ^
  AUTO-EVENTS  --normalize + idempotency key-->  AUTO-RECOVERY journal
        |                                            |
        v                                            v
  AUTO-ORCHESTRATOR  --reads state, never compares stores-->  next legal action
        |
        +--> AUTO-STATE-MACHINE   legal transitions, fail closed
        +--> AUTO-ADMISSION       exact-head evaluation (never grants admission)
        +--> AUTO-MOMENTUM        execution-standard thresholds
        +--> AUTO-CORRECTION-LOOP bounded repair, escalate on meaning
        +--> AUTO-AGENT-ADAPTERS  vendor-neutral roles, WAITING on missing auth
        +--> AUTO-DAG             static topology + dependency-safe selection
```

## Canonical state

One store is authoritative for live control state:
`.agent-control/programme-state.yaml`. Issue #80 is the append-only event and
audit log; the intelligence branch is the durable architecture/checkpoint
projection. See "Canonical state authority" in `AGENT_CONTROL_PLANE.md`.

The orchestrator detects projection drift and reports it. It never resolves
state by comparing stores, and it never lets a stale projection advance work.

## Spanning packets and the wave gate

The canonical board declares two packets that span waves:

- `PLAYBOOK-001` — `span: B -> D`
- `GROWTH-001` — `span: C -> D`

A single-node model places GROWTH-001 in wave C while it depends on wave-D
packets, which deadlocks any selector honouring `do_not_leapfrog_wave_gate`.
`KEYFLOWOS_PROGRAMME_DAG.yaml` therefore models one node per declared phase,
each with its own wave and dependency subset. The union of a packet's phase
dependencies equals the board's packet dependency list — no dependency is
invented, dropped or reordered.

`node scripts/agent-control/validate-dag.mjs` proves the graph loads, contains
no backward wave edge or cycle, and drains completely (37 phases across 35
packets).

## Exact-head automatic merge

Automatic merge is downstream of ChatGPT admission. It cannot create admission.

The evaluator requires all of:

- open, non-draft PR on an `impl/*` branch;
- `.agent-control/claude-return.yaml.review_status` is `READY_TO_MERGE` or
  `ACCEPT_FOR_ADMISSION`;
- both control artifacts' `source_main` equal the PR base SHA exactly;
- `source_head` is an ancestor of the head and every file after it is under
  `.agent-control/**`;
- `production_touched == false` in both artifacts;
- no unresolved contradiction; no unexplained failed or skipped proof;
- the latest runs of CI/CD Pipeline, Agent Control Gate, Branch divergence and
  DAST (HawkScan) are successful **at the exact PR head** — green runs at any
  other sha are reported as a stale head, not treated as satisfied;
- the squash merge is issued with the current head SHA, so a changed head fails
  rather than merging a different tree.

The Agent Control Gate independently proves the semantic-head/control-tail
contract. This package lives on `impl/*` and is therefore subject to it.

## Concurrency

All orchestration paths capable of advancing the same packet serialize on a
stable key: the PR number when the event names one, otherwise a single
programme-wide constant. A workflow run id is never the mutual-exclusion
identity — it is unique per run and would collide with nothing.

## Idempotency and recovery

Event identity derives from the underlying event, never from the observing run:

| Event | Key |
|---|---|
| issue comment | `issue_comment:<comment id>:<action>` |
| workflow run | `workflow_run:<run id>:<attempt>` |
| merged PR | `pr_merged:<number>:<merge commit>` |
| schedule | `schedule:<UTC hour bucket>` |
| manual dispatch | `manual:<run id>` (deliberately not deduplicated) |

The journal in `programme-state.yaml` records each key once. A crashed and
retried workflow converges to one effect: no duplicate directive, merge,
checkpoint or transition.

## What remains intentionally non-automatic

The system stops and escalates rather than guessing when it meets:

- architectural or precedence contradictions;
- scope widening;
- missing canonical packet semantics;
- production deployment, data mutation or provider traffic;
- forensic rebaseline;
- programme-map refresh;
- gate or proof-obligation weakening;
- unresolved deferral or drop;
- strategic migration and schema-primitive choices;
- a repeated failure with no new root cause.

No agent may approve its own semantic work: the adversarial-review role
structurally excludes the builder's adapter id.

## Worker automation

`scripts/agent-control/claude-worker.ps1` watches issue #80 and wakes Claude
Code non-interactively for an unprocessed DIRECTIVE or REVIEW. Headless
invocation is proven on this environment (`claude -p --output-format json`,
Claude Code 2.1.247). The worker reuses the developer's existing authenticated
`gh` and Claude sessions and passes no credential.

It holds an exclusive PID lock so two workers can never drive one packet, and
records processed message ids in a durable cursor so a directive is never
processed twice. Missing or expired auth reports `WAITING_EXTERNAL_AGENT`.

See `AGENT_AUTOPILOT_OPERATIONS.md` for installation, status, disabling and
recovery.

## Files

- `docs/development/AGENT_AUTOPILOT_POLICY.yaml` — machine-readable safety policy.
- `docs/development/AGENT_AUTOPILOT_OPERATIONS.md` — operator runbook.
- `docs/development/KEYFLOWOS_PROGRAMME_DAG.yaml` — executable dependency graph.
- `.agent-control/programme-state.yaml` — canonical live control state.
- `scripts/agent-control/lib/` — yaml, dag, state, state-machine, events,
  admission, momentum, correction, adapters, orchestrator.
- `scripts/agent-control/orchestrate.mjs` — next-legal-action entry point.
- `scripts/agent-control/status.mjs` — machine/human programme status.
- `scripts/agent-control/auto-merge-admitted.mjs` — exact-head admission evaluator.
- `scripts/agent-control/normalize-event.mjs` — event classifier.
- `scripts/agent-control/validate-dag.mjs` — DAG executability proof.
- `scripts/agent-control/proof-mutation.mjs` + `negative-controls.yaml` — negative controls.
- `scripts/agent-control/claude-worker.ps1` (+ install/uninstall) — local worker.
- `scripts/agent-control/tests/*.spec.mjs` — proofs and negative controls.
- `.github/workflows/agent-control-autopilot.yml` — event/wake/merge automation.

## Provenance

V1 of the event normalizer, admission evaluator, DAG, workflow and policy
originated as a prototype on `chore/agent-control-autopilot-v1` (PR #86). Per
`CG-REVIEW-META-AUTO-001` that prototype is input only: its useful content was
adopted onto this gated `impl/*` branch and corrected. PR #86 is not merged.

Corrections applied to the adopted material: F1 concurrency identity, F2 wave
gate deadlock, F3 event idempotency, F4 gate scope, F5 error visibility.

## Rollout

1. Merge V1 through the ordinary admission contract.
2. Observe one packet through RETURN -> review -> READY_TO_MERGE -> auto-merge.
3. Enable the local worker (`install-claude-worker.ps1`).
4. Add a separately credentialed adversarial reviewer.
5. Add automatic next-packet branch launch after checkpoint.
6. Only after repeated evidence, consider reducing polling frequency or
   increasing automatic correction-loop depth.

Production release authorization remains separate throughout.
