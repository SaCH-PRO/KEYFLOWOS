# J17 Approved → Execution Microscopic Trace — 2026-09-06

Status: RECONCILED EVIDENCE PACKET — NO NEW CANONICAL F/C ID ALLOCATED

Journey: `KF-JOURNEY-017 — Command Center → Priority → Action`

Implementation evidence head inspected: `main@9bff44f8f9a5195e06af3669ccb1a8f4c47ccd76`

Code-bearing forensic baseline: `d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Production implementation: READ-ONLY.

## Question

When the Command Center presents an approved KEY proposal as executable, does the actual APPROVED → EXECUTE path revalidate current governance before a material effect, and does it prove fresh, user-bound confirmation rather than treating old approval state as sufficient execution intent?

Target law:

```text
APPROVED
!= CURRENT CLEARANCE
!= FRESH EXECUTION CONFIRMATION
!= MATERIAL EFFECT
```

## Final verdict

`PARTIALLY SUPPORTED — REUSE EXISTING J2/J15/K3 ROOTS; NO NEW J17 ID`

The inspected KeyActionProposal path has a materially positive seam: execution re-evaluates current autonomy policy and current Genome execution policy before invoking the material executor. Therefore `status = APPROVED` is not blindly treated as sufficient current authority.

However, the public controller/orchestrator path discards the execute DTO confirmation fields and the shared orchestrator invokes the proposal service with both confirmation booleans hard-coded `true`. This revalidates the existing canonical confirmation-evidence weakness rather than establishing a distinct J17 root.

Primary reuse:

- `F030` — approval confirmation booleans can be hard-coded instead of evidence-backed.

Adjacent reused roots:

- `F031` — proposal/execution actor provenance drift;
- `F041` / `F055` — proposal transition / execution-claim concurrency weakness;
- `F042` — SafetyShell process-local idempotency / weak compensation;
- `F067` — quick-confirm action binding weakness;
- `F068` — no canonical exact-action fingerprint binding;
- `F069` — KeyCortexApprovalOrchestrator is a useful convergence seam but not a complete governance boundary.

## Evidence trace

### 1. Command Center wording

The J17 projection maps approved proposals with wording equivalent to:

```text
Execute approved: <title>
Approved and ready to execute
```

This is a navigation/control affordance, not itself proof of Clearance or effect execution.

### 2. Proposal service execution seam — positive

Inspected:

- `apps/server/src/modules/key-autonomy/key-action-proposal.service.ts`

Observed shape:

```text
load proposal
→ require APPROVED
→ evaluate current autonomy execution policy
→ evaluate current Genome execution policy
→ require confirmation when those evaluators demand it
→ set EXECUTING
→ invoke KeyActionExecutorService
→ record EXECUTED or FAILED
```

Therefore:

```text
APPROVED
!= UNCONDITIONAL EXECUTION
```

Current policy is re-evaluated immediately before the executor path. This is a strong seam to preserve.

### 3. Execute DTO is present but discarded by controller

Inspected:

- `apps/server/src/modules/key-autonomy/dto/execute-key-action-proposal.dto.ts`
- `apps/server/src/modules/key-autonomy/key-action-proposal.controller.ts`

The DTO exposes:

```text
confirm?: boolean
confirmGenomeRisk?: boolean
```

but the execute controller accepts the body as `_body` and does not propagate either field to the orchestrator.

Observed path:

```text
POST :proposalId/execute
→ controller ignores execute confirmation body
→ orchestrator.executeApproved(...)
```

### 4. Orchestrator pre-satisfies confirmation gates

Inspected:

- `apps/server/src/modules/key-cortex/key-cortex-approval-orchestrator.service.ts`

Observed call:

```text
proposalService.execute(
  businessId,
  proposalId,
  userId ?? 'key_ai',
  true,
  true,
)
```

Therefore the service's confirmation checks are real, but this shared caller supplies both as already satisfied.

Canonical interpretation:

```text
CURRENT POLICY RE-EVALUATION
+ HARD-CODED CONFIRMATION TRUE
!= PROVEN FRESH CONFIRMATION EVIDENCE
```

This is a current concrete instance of `F030`, not a new J17 finding.

### 5. Public HTTP identity counterargument — partially successful

The execute method itself does not repeat the explicit `req.user.id` guard used by approve/reject, but the route is behind the common class guards and `BusinessGuard` requires `req.user.id`.

Therefore the reachable public HTTP route requires an authenticated human identity before the controller is entered.

Do not overstate this as an anonymous public execute route.

Separate issue: the orchestrator can be called from internal paths and defaults actor identity to `key_ai` when no user id is supplied; that belongs under existing principal-lineage pressure such as `F031`.

### 6. Frontend confirmation semantics

Inspected:

- `apps/web/src/lib/api/key-autonomy.ts`
- `apps/web/src/app/app/key-autonomy/components/proposal-card.tsx`

The web client sends `confirm` and `confirmGenomeRisk`.

For Genome risk, the UI is designed to first call execution without Genome confirmation, detect a server error containing a confirmation requirement, then expose a stronger confirmation step. But because the server orchestrator forces `confirmGenomeRisk = true`, that intended server-driven second-step gate cannot be reached through the inspected orchestrator path.

For high/critical proposal risk, the UI sends `confirm = true` from the execute action. The evidence examined does not show a separately durable confirmation artifact bound to the exact execution attempt.

### 7. Proposal payload mutability / exact-action binding

Repository search found application writes to `KeyActionProposal` concentrated in the proposal service; no ordinary API was found that edits the material proposal payload after approval.

This is a narrowing positive fact: the inspected path reloads and executes the same stored proposal rather than accepting an arbitrary replacement payload from the execute request.

However no universal canonical `ActionFingerprint` / capability version / portable `Clearance` artifact was observed binding approval and confirmation to exact material semantics. That remains covered by `F068` rather than becoming a new J17 root.

### 8. Execution claim / idempotency seam

The proposal service reads APPROVED and later writes EXECUTING without an observed atomic expected-state claim. This continues the `F055` pressure.

`KeyActionExecutorService` invokes `SafetyShellService` with proposal id as idempotency key before plugin/built-in execution. The inspected SafetyShell idempotency set is process-local rather than a distributed durable execution claim; this remains `F042` territory.

## Tests inspected

Tests were inspected, not executed in this repository session.

Observed source tests include:

- `key-action-proposal.service.spec.ts` — direct service confirmation gates and current Genome blocking behavior;
- `key-cortex-approval-orchestrator.service.spec.ts` — explicitly expects execution call with `true, true` and `key_ai` fallback behavior;
- `key-action-proposal.controller.spec.ts` — exercises the controller/orchestrator delegation but does not prove execute DTO confirmation propagation.

No runtime test result is claimed.

## Evidence / interpretation separation

### IMPLEMENTATION FACT

- direct proposal execution re-evaluates current autonomy and Genome execution policy;
- execute DTO contains two confirmation booleans;
- controller discards those body fields;
- orchestrator supplies both booleans as `true`;
- public route remains behind guards requiring authenticated user identity/business access;
- same stored proposal is reloaded for execution;
- no universal exact-action fingerprint / portable Clearance was observed on this path;
- EXECUTING acquisition is not observed as an atomic expected-state claim;
- SafetyShell idempotency is process-local in the inspected implementation.

### INTERPRETATION

The path preserves current policy evaluation but does not make fresh confirmation evidence load-bearing end-to-end. The dominant causal root is already captured by existing J2/J15/K3 findings, especially F030.

### CANONICAL ACTION

Reuse/cross-reference existing findings. Do not allocate F181/C131 or another J17 identifier for this confirmation trace.

## Relationship to J17 findings

This trace is distinct from:

- `F179 / C129` — degraded source completeness can look like healthy zero in Command Center projection;
- `F180 / C130` — persistent CommandItem can claim EXECUTED without source/effect truth.

The proposal execution path is actually a favorable contrast to F180 because it does invoke a real executor after current policy re-evaluation. Its remaining confirmation/binding/idempotency weaknesses are older canonical roots.

## Next handoff

Continue J17 at the priority/projection fabric boundary. Do not spend another tranche inventing a new confirmation finding here unless new implementation evidence demonstrates a genuinely distinct semantic root.
