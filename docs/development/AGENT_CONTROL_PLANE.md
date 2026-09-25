# KEYFLOWOS Agent Control Plane

Status: CANONICAL CONTROL SYSTEM DESIGN

## Goal

Make ChatGPT the programme command center and human-facing interface while Claude Code performs bounded implementation work under repository-enforced gates.

The repository is the durable message bus and evidence store.

## Control topology

```text
Human
  |
  v
ChatGPT programme command center
  |
  | DIRECTIVE / REVIEW
  v
GitHub Agent Control Room (#80)
  |
  v
Claude Code local worker
  |
  | commits + PR + packet status artifact + RETURN
  v
GitHub repository gates
  |
  | validated evidence available
  v
ChatGPT integration review
  |
  | ACCEPT / CORRECT / BLOCK
  v
GitHub Control Room + PR
  |
  v
Claude correction loop or merge/checkpoint
```

## Non-negotiable principle

Claude cannot advance a packet merely because local tests pass.

Advancement requires:
1. a durable implementation branch;
2. a machine-readable packet return artifact committed to that branch;
3. an updated PR;
4. a RETURN message in control-room issue #80;
5. repository gate validation;
6. ChatGPT integration review against the packet, wave dependencies, architecture, proof obligations, and programme acceptance contract.

## Packet control artifacts

Every Claude-owned implementation branch must maintain:

```text
.agent-control/
  active-packet.yaml
  claude-return.yaml
```

`active-packet.yaml` is issued from the accepted ChatGPT DIRECTIVE.
`claude-return.yaml` is written/updated by Claude.

Claude must not edit directive-owned fields to widen scope.

## Ownership boundary

ChatGPT owns:
- packet selection;
- source-main release;
- dependency release;
- allowed/prohibited scope;
- invariants;
- proof obligations;
- stop conditions;
- merge authority;
- acceptance/rejection.

Claude owns:
- local characterization;
- bounded code edits;
- migrations within released scope;
- local test/debug loops;
- discovered evidence;
- RETURN production.

GitHub owns:
- structural enforcement;
- artifact validation;
- CI;
- branch/PR checks;
- audit history.

Human owns:
- ultimate supervision;
- production authorization;
- exceptions to programme policy.

## Claude event rule

Claude must publish a durable control event when any of these occurs:
- ACK before first mutation;
- packet state transition;
- material architectural discovery;
- newly discovered writer/consumer;
- scope pressure;
- momentum alarm;
- contradiction;
- local proof completion;
- PR opened/updated;
- RETURN ready.

Low-level edits do not need one comment each; they must be represented in the next durable state/RETURN artifact.

## ChatGPT review rule

ChatGPT reviews:
- packet return artifact;
- PR diff;
- current main drift;
- CI results;
- scope ledger;
- proof/failure matrix;
- new consumers/writers;
- wave dependencies;
- previously admitted packet invariants that the diff may touch.

ChatGPT then posts one control decision:
- ACCEPT_FOR_ADMISSION
- CORRECTION_REQUIRED
- BLOCKED_CONTRADICTION
- RECHARACTERIZE
- READY_TO_MERGE
- CLOSE_CHECKPOINTED

## No direct merge by Claude

Default merge authority is false.
Claude may not mark a packet complete, merge, or release the next packet unless the current DIRECTIVE explicitly grants that right.

## Automation layers

### Layer 1 — Claude local automation
Claude reads the latest directive, works, updates return artifact, pushes branch, updates PR, posts control-room RETURN.

### Layer 2 — GitHub structural gate
GitHub Actions validate:
- active packet metadata exists;
- source main and implementation branch are declared;
- scope ledger fields exist;
- return artifact is parseable;
- tests/failed/skipped sections exist;
- scope-changed and production-touched are explicit;
- no RETURN claims completion while failed/skipped proof is unexplained;
- ChatGPT admission marker exists before merge-ready state.

### Layer 3 — ChatGPT review
ChatGPT reads the durable artifacts and PR/CI, evaluates whole-programme integration, and writes REVIEW.

### Layer 4 — programme checkpoint
Only after merge + post-merge verification does ChatGPT update the wave board and durable handoff.

## Wake-up model

Repository and Claude automation can be event-driven immediately.

This exact ChatGPT conversation cannot currently be guaranteed to receive an instantaneous GitHub webhook on every repository event. Therefore:
- GitHub remains authoritative even while ChatGPT is not actively running;
- ChatGPT must consume all unseen control messages before issuing a new directive;
- a recurring ChatGPT condition-watch may poll issue #80 for actionable Claude events;
- the human may also wake ChatGPT immediately by messaging here;
- if a future connected GitHub webhook can invoke the command center directly, it replaces polling without changing the protocol.

No work is lost or silently admitted while ChatGPT is offline because the repo gates prevent advancement without ChatGPT admission.

## Required merge protection concept

A packet PR is merge-eligible only when:
- ordinary CI is green;
- agent-control structural gate is green;
- packet-specific proof is green;
- branch hygiene is green;
- ChatGPT review status in `.agent-control/claude-return.yaml` or accepted control artifact is `READY_TO_MERGE`;
- no unresolved contradiction or unexplained defer/drop remains.

## Safety

Production deployment, production mutation, real provider traffic, forensic rebaseline, and programme-map refresh remain independently controlled and cannot be granted implicitly by an agent-control state.


## Semantic head rule

`.agent-control/claude-return.yaml.source_head` identifies the last commit that changes packet semantics (application code, schema, migration, tests or other non-control files).

Control metadata may be committed after that semantic head. Therefore the final PR head may be newer than `source_head`.

The repository gate enforces:
- `source_head` exists;
- `source_head` is an ancestor of the current PR head;
- every file changed after `source_head` is under `.agent-control/**`;
- before a non-draft implementation PR can advance, both control artifacts' `source_main` values must equal the current PR base SHA.

If any non-control file changes after a RETURN is prepared, the implementer must advance `source_head`, refresh the return evidence, rerun required proof, and return to `PENDING_CHATGPT_REVIEW`.

## Layer 5 — unattended event orchestration

The repository has an event-driven automation layer defined by
`docs/development/AGENT_AUTOPILOT.md` and `docs/development/AGENT_AUTOPILOT_POLICY.yaml`.

It may automatically:
- normalize actionable issue #80 / PR / CI events into durable AUTO_EVENT records;
- derive and publish the next legal control action from the derived state once
  it reconciles with #80 authority and repository truth (see "Control-state
  precedence"), or publish REPORT_DRIFT when it does not;
- reconcile admitted implementation PRs;
- squash-merge an exact implementation head only after ChatGPT has already set
  `review_status: READY_TO_MERGE` and all required exact-head workflows are green;
- emit a durable AUTO_MERGE event for post-merge verification/checkpoint;
- wake a local builder agent for an unprocessed directive.

It may not create architectural admission, resolve contradictions, widen scope,
weaken proof, or authorize production effects. Those remain under the ownership
rules above.

The machine-readable programme dependency graph is
`docs/development/KEYFLOWOS_PROGRAMME_DAG.yaml`. Packet selection must satisfy
that DAG plus the wave-gate rules in the canonical intelligence board.

## Control-state precedence

Set by CG-DIRECTIVE-META-STATE-RECONCILE-001. It supersedes the earlier
"canonical live state" model (CG-REVIEW-META-AUTO-001), which let a
programme-state.yaml last written in PR #87 keep projecting PR #87
READY_TO_MERGE after #87 and #89 had merged.

| Store | Role | Establishes |
|---|---|---|
| repository, PR and CI evidence | **implementation truth** | what actually exists: merged or open PRs, branches, main, exact-head CI |
| newest valid ChatGPT `DIRECTIVE` / `REVIEW` / `HOLD` / `RESUME` on issue #80 | **execution authority** | what may happen now. #80 is append-only; its history is the authority record |
| `.agent-control/programme-state.yaml` | **derived machine projection** | a summary of the two above that may be stale; it may accelerate a decision, never override one |
| `docs/keyflow-intelligence-foundation` | durable intent and checkpoint history | packet topology, admitted evidence, durable checkpoints |
| `.agent-control/active-packet.yaml`, `.agent-control/claude-return.yaml` | per-packet PR admission artifacts | this packet's scope, proof and review status |

A valid authority message has `sender: chatgpt` exactly, a GitHub author in
the allowlist (`SaCH-PRO`, the same rule the local worker uses), and a
`message_type` of DIRECTIVE, REVIEW, HOLD or RESUME. Newest means latest
`created_at`, ties broken by comment id.

Rules:

- programme-state.yaml records `authority_basis {message_id, comment_id}`: the
  newest authority message it incorporates.
- Before any automated decision, `scripts/agent-control/lib/reconcile.mjs`
  compares the projection with #80 and the repository. The orchestrator
  (`decide()`) uses the projection only when that comparison is consistent.
- Disagreement fails closed as `REPORT_DRIFT` and names every finding: a newer
  authority message than the anchor, a PR whose real state contradicts the
  projected state, a branch mismatch, a `source_main` not on main, a missing
  anchor, or anything that could not be read.
- Hold and release meaning is never inferred. So far holds and resumes on #80
  have been typed DIRECTIVE and distinguished only by id and prose. Any newer
  authority message therefore makes the projection stale. A newer hold always
  beats an older derived "advance", and automation never applies a release.
- The projection is re-derived in a reviewed commit and re-anchored to the
  newest authority. It is never repaired by automation. There is no automated
  writer: `orchestrate.mjs --apply` only journals events. The projection is
  expected to be stale between re-derivations, and the orchestrator waits
  while it is.
- The intelligence board is a durable projection too. Its CURRENT
  handoff/status may be refreshed at a checkpoint or an explicit hold so
  humans are not misled. `status.mjs` reports board drift, and neither
  projection advances work. No broad programme-map refresh is authorized by
  this layer.
- The exact-head merge path (`auto-merge-admitted.mjs`) does not read
  programme-state. It gates on the PR's own control artifacts and live PR/CI
  state, so a stale projection cannot cause a merge, and a merged PR cannot be
  merged twice (`pr_not_open`).
