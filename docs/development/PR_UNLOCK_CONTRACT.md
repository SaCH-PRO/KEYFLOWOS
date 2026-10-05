# KEYFLOWOS PR Unlock Contract

Status: executable foundation for value-aware PR admission.

## Purpose

A pull request can be technically correct and still make KEYFLOWOS worse by adding duplicate machinery, dead abstractions, stale implementations, unnecessary persistence, or maintenance burden without enough product or development value.

The PR Unlock Contract makes the claimed value explicit and machine-checkable.

It is deliberately separate from ordinary CI:

```text
TECHNICALLY GREEN
  + SEMANTICALLY CORRECT
  + ARCHITECTURALLY COHERENT
  + NET-POSITIVE UNLOCK
  = ADMISSION CANDIDATE
```

## Unlock states

`DECLARED -> IMPLEMENTED -> PROVEN -> ADMITTED -> LIVE`

- **DECLARED**: expected effect is specified before or during implementation.
- **IMPLEMENTED**: the code/docs that should create the effect exist on the branch.
- **PROVEN**: evidence demonstrates the claimed effect at the reviewed scope.
- **ADMITTED**: the exact reviewed change passed repository admission.
- **LIVE**: merged change was post-merge verified and the claimed effect remains reachable.

These states prevent planning documents from being counted as delivered runtime capability.

## Classification

A contract may carry more than one classification:

- `PLANNING_ONLY`
- `ARCHITECTURE_ONLY`
- `GOVERNANCE_ONLY`
- `RUNTIME_CAPABILITY`
- `DEVELOPMENT_CAPABILITY`
- `RELIABILITY_CAPABILITY`
- `DEBT_REMOVAL`

## Effect scale

Each of four value surfaces is scored qualitatively, not numerically:

- `NONE`
- `FOUNDATION`
- `PARTIAL`
- `MATERIAL`
- `CANONICAL`

The surfaces are:
- product;
- KEY;
- development system;
- reliability/risk.

The scale is intentionally ordinal. It is not a fabricated percentage.

## KEY capability dimensions

When a PR changes KEY, list the affected dimensions in prose/evidence using the shared model:

- perception / ingestion;
- memory;
- reasoning;
- planning;
- action;
- outcome observation;
- learning;
- recovery / correction;
- governance / restraint;
- coordination.

Do not claim a KEY delta merely because a new service/class exists. The capability must be reachable and evidenced.

## Required accounting

Every contract records:
- what is newly possible;
- what becomes safer or more reliable;
- what downstream work becomes possible;
- what existing machinery is converged, replaced, or retired;
- what complexity is added;
- how the claimed unlock will be proven;
- whether net value is positive, neutral-but-required, or negative/do-not-merge.

## Net-value verdicts

- `POSITIVE`: demonstrated value exceeds maintained complexity.
- `NEUTRAL_REQUIRED`: little direct capability gain, but the work is required for compatibility, migration, compliance, or another explicit obligation.
- `NEGATIVE_DO_NOT_MERGE`: cost/duplication/risk exceeds the demonstrated value.

A positive verdict with no product, KEY, development, or reliability effect is invalid.

## Rollout

### Tranche U0 — this change
- durable contract and template;
- pure validator;
- unit/negative-control tests;
- execution-standard and agent guidance integration.

### Tranche U1 — shadow visibility
- index contracts;
- surface them in Mission Control;
- show missing/invalid contracts without pretending they are satisfied;
- map each contract to Atlas journey/kernel/code evidence.

### Tranche U2 — blocking admission
- require a valid contract for merge candidates;
- require `PROVEN` before admission;
- require the proof evidence to bind to the reviewed semantic head;
- prevent `PLANNING_ONLY` work from claiming runtime unlocks.

### Tranche U3 — post-merge confirmation
- move to `LIVE` only after post-merge verification;
- compare declared vs observed unlock;
- feed observed deltas into Context Genome / Atlas history.

The staged rollout avoids invalidating an already-running exact-head admission cycle while still making this standard mandatory for subsequent merge candidates.
