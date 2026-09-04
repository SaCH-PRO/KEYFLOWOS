# J23 — Workflow Definition Versioning / Waiting Occurrence Binding

Status: VERIFIED FORENSIC PASS / TARGET CONVERGENCE INPUT
Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`
Last evidence pass: 2026-09-03
Primary kernels: K7 Temporal/Event/Workflow, K6 State Transition
Secondary kernels: K3 Governance, K5 Capability, K8 Evidence, K11 Recovery
Primary journey: J23 Temporal Flow / Long-Running Workflow
Affected journeys: J6, J9, J15, J18.

> Read-only architecture/research artifact. No production implementation is authorized.

---

## 1. Question

When a workflow/action definition changes while an occurrence is waiting, which version governs the future effect?

```text
Definition V1
→ creates/schedules Occurrence O
→ definition changes to V2
→ O wakes later
```

Possible legitimate policies:

```text
SNAPSHOT_V1
  O executes exactly the definition/action it was created under

MIGRATE_TO_V2
  O is explicitly transformed to the new definition version

SUPERSEDE_AND_REDERIVE
  O terminates as superseded; a new occurrence/action is derived from V2

LATEST_AT_EXECUTION
  O intentionally uses current definition, but only where business semantics allow it

REQUIRE_RECONTROL
  material definition/action change invalidates prior control and requires fresh authorization
```

The policy must be explicit. Silent mutation is not a versioning strategy.

---

## 2. Current Reality — CrossModuleWorkflow Uses Implicit Old-Snapshot Semantics

Model:

```text
CrossModuleWorkflow
  businessId
  workflowKey
  enabled
  config
  lastRunAt
  runCount
```

No observed definition version is stored.

`updateWorkflow()` mutates `enabled/config` on the standing definition.

For quote follow-up, `handleQuoteSent()` reads the current definition config and creates future `ScheduledAgentJob` rows whose payload snapshots values such as:

```text
first/second follow-up timing
whether auto-email is enabled
contact identity data
```

Later `executeQuoteFollowUpJob()` operates from the stored job payload and does not call `isWorkflowEnabled()` or reload current config before effect.

Thus:

```text
Workflow config/enabled state changes
→ previously created occurrence still carries old derived semantics
→ no definition-version linkage explains whether that is intentional
```

A workflow can therefore be disabled/configured while old occurrences remain independently executable unless another source-state condition blocks them.

This is F146.

Important: whether disable SHOULD cancel all existing occurrences is product/domain policy. The defect is that the version/migration policy is implicit and uninspectable.

---

## 3. Current Reality — Scheduled EmailCampaign Uses Mutable-Latest Semantics

`EmailMarketingService.scheduleCampaign()` changes the campaign row to:

```text
status=SCHEDULED
scheduledAt=<future>
```

`updateCampaign()` can later update fields including:

```text
name
subject
body
segmentFilter
scheduledAt
```

No observed status restriction prevents these mutations while the campaign is already `SCHEDULED`.

At execution, `sendCampaign()` claims `DRAFT|SCHEDULED → SENDING` and then reads the current campaign row, current segment filter and current contacts.

Therefore the eventual effect is not bound to an immutable scheduled campaign version.

Possible chain:

```text
schedule campaign content/audience A
→ campaign remains SCHEDULED
→ mutate subject/body/segment to B
→ scheduler wakes
→ sendCampaign claims SENDING
→ sends B
```

This can be valid UX if edits intentionally redefine the scheduled campaign — but there is no persisted action/version boundary showing that the original occurrence was superseded or updated.

This is F147.

J15 overlap: where scheduled content/action was previously authorized, a material mutation must not inherit stale ControlEvidence/Clearance. Reuse ActionEnvelope fingerprint/invalidation laws rather than creating a second approval concept.

---

## 4. Cross-Fabric Contradiction

Current temporal fabrics encode opposite implicit policies:

```text
CrossModule ScheduledAgentJob
→ old derived payload survives definition mutation

EmailCampaign
→ waiting scheduled effect reads latest mutable campaign definition
```

Neither mechanism carries an explicit definition/action version contract.

Therefore the system cannot answer consistently:

> What exactly was scheduled, and what is allowed to change before execution?

This is C097.

---

## 5. Target Definition / Occurrence Contract

Distinguish:

```text
DefinitionId
DefinitionVersion
OccurrenceId
ActionFingerprint / ActionEnvelope version
CreatedFromDefinitionVersion
Migration/Supersession lineage
Current effective definition version
```

Not every domain requires a new physical version table. Existing immutable snapshots, audit revisions or fingerprints may implement this contract.

The semantic requirement is inspectability.

---

## 6. Target Mutation Algorithm

When a definition changes:

```text
Definition V1 → V2
→ identify waiting/unconsumed occurrences derived from V1
→ apply work-type migration policy
   ├─ KEEP_V1
   ├─ MIGRATE
   ├─ SUPERSEDE
   ├─ RE-DERIVE
   └─ REQUIRE_RECONTROL
→ persist lineage and reason
→ do not silently mutate exact authorized action
```

For recurring definitions, future occurrences can naturally use V2 while already-created occurrences follow the explicit policy.

---

## 7. Material Action Mutation

Definition change and action mutation are related but distinct.

Example:

```text
Campaign definition changes copy/segment
→ if no control was required, version/supersession still matters for audit and cancellation
→ if prior control existed, compare action fingerprint
→ material change invalidates stale ControlEvidence/Clearance
```

Reuse:

- KF-REC-023 ActionEnvelope + fingerprint;
- KF-REC-026 exact-action Clearance + invalidation;
- KF-REC-038 Durable WorkOccurrence semantic contract.

Do not create `WorkflowApprovalV2` or parallel governance machinery.

---

## 8. Target Recommendation

### KF-REC-046 — Version workflow definitions and explicitly bind/migrate waiting occurrences

Every long-lived work definition should expose enough identity/version lineage to answer:

```text
which definition/version created this occurrence?
was the definition changed later?
did the occurrence retain old semantics, migrate, or become superseded?
was its exact action materially changed?
does prior control remain valid?
```

Mutation policies should be defined per work type rather than globally.

---

## 9. Findings / Contradiction

- F146: CrossModuleWorkflow mutations/disable do not version or explicitly migrate/invalidate already-created ScheduledAgentJob occurrences.
- F147: scheduled EmailCampaign effects can materially change after scheduling because current mutable campaign state is read at send time without an explicit scheduled definition/action version boundary.
- C097: old-snapshot temporal semantics coexist with mutable-latest temporal semantics without an explicit version/migration contract.

---

## 10. Proof Requirements

- editing a scheduled definition produces an explicit, inspectable result for already-created occurrences;
- disabling a definition follows its declared pending-occurrence policy;
- an occurrence can report the definition/action version it was derived from;
- materially mutated authorized work cannot execute under stale Clearance;
- migrating waiting work preserves causal lineage and does not duplicate occurrence/effect identity;
- superseded occurrences remain historical evidence but cannot execute;
- recurrence uses the correct new version for future occurrences;
- deployment/software version changes do not silently reinterpret waiting work.

No tests were executed in this forensic pass.
