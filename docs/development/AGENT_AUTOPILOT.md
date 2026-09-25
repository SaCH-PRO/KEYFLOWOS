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
issue #80 (append-only;            repository / PR / CI         .agent-control/programme-state.yaml
 newest valid ChatGPT message       (implementation truth)       (DERIVED projection, may be stale)
 = execution authority)                     |                              |
        |                                   |                              |
        +-----------------> AUTO-RECONCILE <-------------------------------+
        |                  consistent? else REPORT_DRIFT (fail closed)
        v                                   |
  AUTO-EVENTS  --normalize + idempotency key-->  AUTO-RECOVERY journal
        |                                   |
        v                                   v
  AUTO-ORCHESTRATOR  --rule table only behind a consistent reconciliation-->  next legal action
        |
        +--> AUTO-STATE-MACHINE   legal transitions, fail closed
        +--> AUTO-ADMISSION       exact-head evaluation (never grants admission)
        +--> AUTO-MOMENTUM        execution-standard thresholds
        +--> AUTO-CORRECTION-LOOP bounded repair, escalate on meaning
        +--> AUTO-AGENT-ADAPTERS  vendor-neutral roles, WAITING on missing auth
        +--> AUTO-DAG             static topology + dependency-safe selection
```

## Control-state precedence

Repository/PR/CI evidence is implementation truth. The newest valid ChatGPT
DIRECTIVE, REVIEW, HOLD or RESUME on issue #80 is execution authority.
`.agent-control/programme-state.yaml` is a derived projection that may be
stale. See "Control-state precedence" in `AGENT_CONTROL_PLANE.md`.

`lib/reconcile.mjs` compares the projection, anchored by `authority_basis`,
with #80 and the repository. `lib/truth.mjs` gathers both through `gh`, or
from a recorded `--truth-file` snapshot. `decide()` consults the projection
only when every check passes. Otherwise it returns `REPORT_DRIFT` with every
finding, and nothing advances.

The reconciliation never picks a winner or repairs the projection. It does
not classify holds or releases from message ids or prose either: any newer
authority message makes the projection stale until someone re-derives it in a
reviewed commit.

The CI observer passes no token to the decide step
(`.github/workflows/agent-control-autopilot.yml`), so it cannot read #80 there.
The published `derived_action` is then `REPORT_DRIFT` (AUTHORITY_UNVERIFIABLE)
until that step gets a token. That is fail-closed by design; enabling it is a
workflow change outside CG-DIRECTIVE-META-STATE-RECONCILE-001's scope.

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

Observation and mutation are separated deliberately.

**Observation** uses a workflow-level group keyed per PR/event
(`keyflow-autopilot-observe-*`), so read-only handling for different PRs runs in
parallel.

**Mutation** — merge, checkpoint, state advancement — serializes on ONE constant
job-level group, `keyflow-agent-control-mutation`, declared by every mutating
job and matching `MUTATION_LOCK` in `lib/events.mjs`.

The lock is a global constant on purpose. Any event-derived key re-partitions
the mutating paths, which is the defect itself: the scheduled reconcile
iterates every open `impl/*` PR, so on a per-PR key it would sit in the
`programme` group while an event-driven job for one of those PRs sat in group
`<N>` — different groups, no exclusion, both merging. Exact-head guards stop a
wrong tree being merged; they do not serialize two orchestrators.

The cost is that programme advancement is globally serialized. That is the
intended trade: the programme advances one packet at a time by design, so there
is nothing to gain from parallel mutation and a correctness invariant to lose.

`tests/events.spec.mjs` proves this by parsing the workflow file itself and
asserting every mutating job declares the same constant group — not by
exercising a helper, which is how the earlier partition passed review locally.

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

Hardening (CG-REVIEW-META-AUTO-WORKER-001/-002, worker contract 2):

- **Authority.** A comment wakes the worker only if it is a `DIRECTIVE` or
  `REVIEW` with `sender: chatgpt` exactly, and its GitHub author is in the
  allowlist (default `SaCH-PRO`). The repository is public, so `sender:` alone
  proves nothing. Claude's own messages come from the same account and are
  excluded by their sender. This is an owner-account boundary, not proof that
  a message came from ChatGPT (`select-directive.ps1`).
- **Completion.** A run counts as processed only when the session ends with
  `KEYFLOW-WORKER-DONE: <message_id>`. Exit status alone proves nothing
  (`evaluate-run.ps1`).
- **Bounded retry.** Two consecutive failures with the same verdict mark the
  directive `HELD_RETRYABLE`. It is not processed, Claude is not invoked for it
  again, and one MOMENTUM escalation is posted. A newer directive supersedes
  it, or the operator releases it with `-ReleaseHold`. A 5-attempt backstop
  catches a blocker whose wording keeps changing.
- **Isolation.** Every wake runs in its own git worktree outside the checkout,
  keyed by message id. The worktree is detached at
  `origin/<implementation_branch>`, the directive's `source_main`, or
  `origin/main`, in that order of preference. It is reused on retry, and
  removed only when it is clean and fully pushed.
- **Install contract.** The worker wakes Claude only under an install record
  for its own contract version, and never while paused (`-Pause`).

See `AGENT_AUTOPILOT_OPERATIONS.md` for installation, status, disabling and
recovery.

## Files

- `docs/development/AGENT_AUTOPILOT_POLICY.yaml` — machine-readable safety policy.
- `docs/development/AGENT_AUTOPILOT_OPERATIONS.md` — operator runbook.
- `docs/development/KEYFLOWOS_PROGRAMME_DAG.yaml` — executable dependency graph.
- `.agent-control/programme-state.yaml` — derived programme projection (anchored by `authority_basis`).
- `scripts/agent-control/lib/` — yaml, dag, state, state-machine, events,
  admission, momentum, correction, adapters, orchestrator, reconcile, truth.
- `scripts/agent-control/orchestrate.mjs` — next-legal-action entry point (reconciles first).
- `scripts/agent-control/status.mjs` — machine/human programme status (`--verify` reconciles).
- `scripts/agent-control/auto-merge-admitted.mjs` — exact-head admission evaluator.
- `scripts/agent-control/normalize-event.mjs` — event classifier.
- `scripts/agent-control/validate-dag.mjs` — DAG executability proof.
- `scripts/agent-control/proof-mutation.mjs` + `negative-controls.yaml` — negative controls.
- `scripts/agent-control/claude-worker.ps1` (+ install/uninstall) — local worker.
- `scripts/agent-control/select-directive.ps1` — the worker's command-authority rule.
- `scripts/agent-control/evaluate-run.ps1` — the worker's run verdict.
- `scripts/agent-control/tests/*.spec.mjs` — portable proofs.
- `scripts/agent-control/tests/windows/*.spec.mjs` — Windows worker/install proofs (fail off Windows).
- `.github/workflows/agent-control-autopilot.yml` — event/wake/merge automation.
- `.github/workflows/agent-control-worker-proof.yml` — required Ubuntu + Windows proof.

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


## Successor programme activation boundary

A second machine-readable DAG now exists at
`docs/development/KEYFLOWOS_PLATFORM_DAG.yaml`. It is intentionally marked
`INACTIVE_SUCCESSOR`. The current orchestrator must not infer activation from file
presence. A future admitted packet (`KF-PLAT-AUTO-001`) may add multi-programme selection,
but only an explicit valid ChatGPT authority message on issue #80 may activate the
successor programme. Existing holds remain authoritative until explicitly released.

GitHub Copilot review is part of the successor admission model: substantive findings must
be exact-head dispositioned before Claude RETURN/ChatGPT admission. Copilot does not gain
architecture or merge authority.
