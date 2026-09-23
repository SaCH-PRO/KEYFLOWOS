# KEYFLOWOS Agent Autopilot

Status: CONTROL-PLANE AUTOMATION V1

## Goal

Remove the human operator from mechanical relay work while preserving the existing execution-control standard, packet boundaries, adversarial proof requirements and production safety constraints.

The automation optimizes for **maximum unattended throughput subject to invariant preservation**, not maximum autonomy.

## What V1 automates

1. GitHub normalizes important control events from issue #80, implementation PRs and the four required admission workflows.
2. Actionable RETURN / CONTRADICTION / MOMENTUM / CI / merge events are written back to issue #80 as durable AUTO_EVENT records.
3. A ChatGPT condition-watch reconciles the control room hourly and performs bounded programme-control actions when no architectural choice is required.
4. Once ChatGPT has set an implementation PR to READY_TO_MERGE, GitHub may merge it automatically only when the exact current head satisfies every admission contract.
5. Merge events are written back to issue #80 so post-merge verification/checkpoint can proceed without the human relaying state.

## Exact-head automatic merge

Automatic merge is intentionally downstream of ChatGPT admission. It cannot create admission.

The merge evaluator requires all of:

- open, non-draft PR;
- branch begins with `impl/`;
- `.agent-control/claude-return.yaml.review_status == READY_TO_MERGE`;
- active + return `source_main` exactly equal the PR base SHA;
- `production_touched == false`;
- latest exact-head runs of CI/CD Pipeline, Agent Control Gate, Branch divergence and DAST (HawkScan) are all completed successfully;
- squash merge uses the current PR head SHA, so a changed head fails rather than merging a different tree.

The existing Agent Control Gate independently proves the semantic-head/control-tail contract.

## What remains intentionally non-automatic

The system must stop and escalate rather than guess when it encounters:

- architectural or precedence contradictions;
- scope widening;
- missing canonical packet semantics;
- production deployment/data mutation/provider traffic;
- forensic rebaseline;
- programme-map refresh;
- gate/proof weakening;
- unresolved deferral/drop;
- strategic migration choices;
- a repeated failure with no new root cause.

## Worker automation

V1 deliberately does not assume a cloud GitHub runner can impersonate the user-authenticated Claude Code or Kimi Code sessions.

The next worker layer is a dedicated self-hosted runner (or equivalent secured worker) labelled for the model worker. It consumes an already-authorized DIRECTIVE from issue #80, invokes the local coding agent in non-interactive mode, and must still return through the same branch/PR/control-artifact contract.

Until that worker is connected, Claude execution itself can still be started manually, but command-center review, CI observation, admission, exact-head merge and checkpoint wake-up no longer require the human to poll them.

## Files

- `docs/development/AGENT_AUTOPILOT_POLICY.yaml` — machine-readable safety policy.
- `docs/development/KEYFLOWOS_PROGRAMME_DAG.yaml` — dependency graph.
- `scripts/agent-control/normalize-event.mjs` — event classifier.
- `scripts/agent-control/auto-merge-admitted.mjs` — exact-head merge evaluator.
- `.github/workflows/agent-control-autopilot.yml` — event/wake/merge automation.

## Rollout

1. Merge V1.
2. Observe at least one packet through RETURN -> review -> READY_TO_MERGE -> auto-merge.
3. Add the self-hosted Claude worker.
4. Add a separately credentialed adversarial reviewer worker.
5. Add automatic next-packet branch launch after checkpoint.
6. Only after repeated evidence, consider reducing polling frequency or increasing automatic correction-loop depth.

Production release authorization remains separate throughout.
