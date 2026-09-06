# J17 Approved → Execution Microscopic Trace — 2026-09-06

Status: EVIDENCE PACKET — NO NEW CANONICAL F/C ID ALLOCATED

Journey: `KF-JOURNEY-017 — Command Center → Priority → Action`

Implementation evidence head inspected: `main@9bff44f8f9a5195e06af3669ccb1a8f4c47ccd76`

Code-bearing forensic baseline: `d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Production implementation: READ-ONLY.

## Question

When the Command Center presents an approved KEY proposal as executable, does the actual approved → execute path revalidate current authority/governance state before a material effect, and does execution require fresh human confirmation rather than inheriting an old approval as sufficient intent?

Target law:

```text
APPROVED
!= CURRENT CLEARANCE
!= FRESH EXECUTION CONFIRMATION
!= MATERIAL EFFECT
```

## Evidence trace

### 1. Command Center wording

The J17 dossier records that approved proposals are projected with wording equivalent to:

```text
Execute approved: <title>
Approved and ready to execute
```

This is a projection/navigation affordance and is not itself an execution claim.

### 2. Proposal service execution seam

Inspected:

- `apps/server/src/modules/key-autonomy/key-action-proposal.service.ts`

Observed positive seam:

```text
proposal status APPROVED
→ evaluateExecution(...)
→ evaluateGenomeExecution(...)
→ module executor
→ execution record
```

The service therefore does not blindly execute solely because `status = APPROVED`.

It re-evaluates current autonomy policy and current Genome execution policy at execution time. If those evaluations require confirmation and their confirmation flags are false, the service returns without executing the material effect.

This is a strong target-preserving seam and should not be flattened into a claim that approved proposals bypass all current governance.

### 3. Controller → orchestrator path

Inspected:

- `apps/server/src/modules/key-autonomy/key-action-proposal.controller.ts`
- `apps/server/src/modules/key-cortex/key-cortex-approval-orchestrator.service.ts`

Observed path:

```text
POST :proposalId/execute
→ controller invokes orchestrator.executeApproved(...)
→ orchestrator invokes proposalService.execute(...)
```

The controller does not propagate fresh confirmation semantics from its execute DTO into this path.

The orchestrator currently calls `proposalService.execute(...)` with:

```text
confirm: true
confirmGenomeRisk: true
```

hard-coded.

It also defaults the execution actor to `key_ai` if no user id is present.

## Current interpretation

The evidence supports a more precise statement than either extreme:

```text
APPROVED DOES NOT BY ITSELF BYPASS CURRENT POLICY RE-EVALUATION
```

but the inspected shared orchestrator path appears to pre-satisfy the proposal service's confirmation gates rather than proving that fresh, user-bound confirmation was obtained for this particular execution attempt.

Therefore the remaining question is not simply "is policy revalidated?" — it is:

```text
WHAT PROVES FRESH EXECUTION INTENT / CONFIRMATION
AND WHO IS THE ACTOR THAT SUPPLIED IT?
```

## Candidate pressure — do not allocate an ID yet

Potential semantic pressure:

```text
CURRENT POLICY RE-EVALUATION
+ HARD-CODED CONFIRMATION TRUE
!= PROVEN FRESH HUMAN CONFIRMATION
```

Do not promote this to a new finding or contradiction until canonical duplicate/reuse analysis is complete across J15/K3 approval/governance findings and registers `04A`, `04B`, `08*`, `09*`, `10*`.

This may be:

- an existing approval/governance finding expressed through J17;
- a refinement of an existing authority/confirmation root;
- a new J17 presentation/governance edge only if prior taxonomy does not already cover it.

## Adversarial checks required next

1. Trace the frontend execute affordance and request body to determine whether a user confirmation is obtained but discarded before the controller/orchestrator path.
2. Trace guards/auth around the execute controller and prove whether an authenticated `userId` is mandatory in all reachable execution paths.
3. Trace `evaluateExecution()` and `evaluateGenomeExecution()` inputs and outputs for freshness, source state, current risk, reversibility and action fingerprint binding.
4. Trace module executors for any additional pre-effect guard, idempotency or stale-state check.
5. Search J15/K3 findings/contradictions for an existing canonical root before any new ID allocation.
6. Trace whether approval itself is bound to the same immutable action fingerprint/payload that is later executed.
7. Trace whether proposal mutation after approval can change effect semantics without invalidating approval.

## Evidence / inference / proposal separation

### Evidence

- proposal execution service re-evaluates autonomy and Genome execution policy;
- proposal service has explicit confirmation gates;
- shared approval orchestrator supplies both confirmation flags as `true`;
- controller does not visibly propagate fresh confirmation flags into the orchestrator call.

### Inference

The inspected path may preserve current policy evaluation while weakening proof that confirmation is fresh, user-bound and action-bound at the moment of execution.

### Proposal

None yet. Continue microscopic tracing and taxonomy reconciliation first.

## Relationship to J17 source-health finding

This trace does not supersede `F179 / C129`. That existing J17 finding/contradiction concerns Command Center projection completeness and the collapse of failed source reads into valid-looking empty state. The current trace is a separate candidate pressure at the projection → governed-action boundary.

## Next handoff

Use this packet as the input to an independent Kimi Code repository trace and, optionally, a Claude Code adversarial review. Both reviewers must attempt to falsify the interpretation above before the canonical synthesizer promotes or reuses any F/C identifier.
