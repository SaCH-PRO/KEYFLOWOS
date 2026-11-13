# KeyFlowOS Finding Register — Command Spine Semantics Supplement

Status: CANONICAL CONTINUATION — J17 COMMAND CENTER / OPERATOR CONTROL
Implementation evidence: `main@9bff44f8f9a5195e06af3669ccb1a8f4c47ccd76`
Production implementation: READ-ONLY / NOT AUTHORIZED

---

## F180 — CommandItem approval/execution can terminalize the operator projection without resolving the governed source or performing the declared effect

**Status:** VERIFIED CODE-LEVEL / CROSS-KERNEL CONTROL-TRUTH FINDING

The persistent `CommandItem` model carries operationally strong fields including:

```text
requiresApproval
executableByKey
executionTool
executionPayload
status
completedAt
```

The `/app/command-center` UI renders visible `Approve` and `Execute` controls from those fields.

However the inspected mutation path is projection-only:

```text
CommandCardV2 Approve
→ POST /command/.../items/:id/approve
→ CommandService.approve()
→ CommandItem.status = EXECUTED
→ completedAt = now
```

and:

```text
CommandCardV2 Execute
→ POST /command/.../items/:id/execute
→ CommandService.execute()
→ CommandItem.status = EXECUTED
→ completedAt = now
→ optional client-supplied result stored into executionPayload
```

Neither method was observed to invoke:

- `executionTool`;
- the referenced source workflow/approval;
- `KeyActionProposalService`;
- `AutonomyOrchestrator` / current Clearance;
- a domain/provider executor;
- durable `EffectId` / attempt lineage;
- `OutcomeEvidence` proving that the business consequence occurred.

Repository search found the HTTP controller as the direct caller of `CommandService.execute()` and no command lifecycle listener that later performs the missing effect.

Current unit tests explicitly assert only that `approve()` and `execute()` set `status='EXECUTED'`.

### Concrete approval split

`CommandGeneratorService.seedFromPendingApprovals()` can create a CommandItem from a pending `AiApprovalItem`:

```text
sourceModule = governance
sourceType   = aiApproval
sourceId     = <approval id>
requiresApproval = true
```

Pressing the CommandItem `Approve` control terminalizes the CommandItem but does not resolve the underlying `AiApprovalItem` in the inspected path. The source approval may therefore remain pending while its command projection says `EXECUTED`.

### Downstream consequence

`HealthScoreService.calculateRiskHealth()` treats CommandItem statuses as risk inputs, including pending approvals and open high-risk commands. A projection-only transition to `EXECUTED` can therefore remove operational risk pressure even though the governed source or business effect remains unresolved.

### Canonical distinction

```text
OPERATOR DISPOSITION / PROJECTION STATUS
!= CONTROL DECISION
!= CURRENT CLEARANCE
!= EFFECT EXECUTION
!= OUTCOME EVIDENCE
```

and specifically:

```text
COMMANDITEM.status = EXECUTED
!= SOURCE APPROVAL RESOLVED
!= executionTool RAN
!= BUSINESS EFFECT OCCURRED
```

### Why this is distinct from existing roots

- F143 concerns a **real durable descendant handoff** being mislabeled as external effect completion.
- F180 concerns **no observed effect/handoff at all** while the operator projection terminalizes itself.
- F032 covers parallel governance regimes generally; F180 is the concrete false-terminal operator-control behavior.
- Approval != Clearance remains an existing semantic law; F180 additionally concerns projection truth vs source/effect truth.

Affected kernels: K3, K5, K6, K7, K8, K11.
Affected journeys: J2, J15, J17, J18, J23.

---

## Target pressure

Do not make CommandItem a second executor or authority source merely because it contains execution metadata.

A safe target may retain CommandItem as a durable operator-attention/work projection, but material actions should resolve through canonical source/control/effect paths:

```text
CommandItem operator intent
→ resolve authoritative source/current state
→ construct/recover exact ActionEnvelope / WorkOccurrence
→ current Clearance
→ ExecutionClaim / Effect / Attempt
→ actual domain/provider consequence
→ OutcomeEvidence
→ only then derive terminal CommandItem projection state
```

For purely presentational/user-disposition verbs, terminal projection state may be valid without a business effect, but it must use semantics such as `DISMISSED`, `ACKNOWLEDGED`, `SNOOZED`, or `COMPLETED_BY_USER_DISPOSITION` rather than claiming `EXECUTED`.

No production implementation is authorized by this finding.
