# J12 — Correction / Supersession / Destructive Disposition Pre-Pooling Convergence Trace

Status: ACTIVE INVESTIGATION — PRE-POOLING GATE PASSED / NO F222 ALLOCATED
Last updated: 2026-09-07
Implementation evidence: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Production implementation: READ-ONLY / UNAUTHORIZED
Runtime proof: NOT EXECUTED

## Purpose

Determine whether correction, reprocessing, supersession and destructive disposition expose a fourth genuinely distinct J12 root after:

```text
F219/C169 — evidence admission
F220/C170 — source-revision occurrence identity
F221/C171 — destructive document disposition
```

The gate specifically tests whether stale downstream descendants after corrected/withdrawn evidence are already owned by F178/C128 or require F222/C172.

## 1. Consumer correction map

### Contracts

`document.extracted` has a material listener in Contracts. Unsafe promotion of uncertain extracted contract values is already canonical as F216/C166 + KF-REC-055.

If the source assertion is later corrected/withdrawn, the generic requirement that derived knowledge/domain state be invalidated or recomputed is already covered by the mature correction lineage pressure in F178/C128 and KF-REC-049. No distinct J12 root is established merely because the source was a document.

### Google Drive

A changed source revision is detected at connector intake but can be suppressed as the previous ingestion occurrence by externalId-only dedupe.

That failure is already F220/C170. The stale prior ingestion plan is a consequence of the occurrence-identity root, not an independent correction root.

### Device / VisualIntake

Reprocessing can replace accepted/rejected extraction content under one mutable intake coordinate and leave review provenance misbound.

That is an exact F161/KF-REC-049 specialization: verification belongs to an exact revision/value, not a mutable coordinate.

### Payment evidence

The initial document assertion can become successful payment evidence without explicit evidence admission: F219/C169.

Reapplying the same semantic evidence with a new manual payment identity is a KF-REC-048 specialization.

If the source evidence is later corrected or withdrawn, the requirement to identify and invalidate/reconcile descendants is generic correction lineage already pressured by F178/C128, while financial correction semantics remain delegated to KF-REC-052. No fourth J12 root is established from that combination alone.

### Expense receipt extraction

The extraction endpoint returns transient fields. The UI pre-fills editable form state and requires explicit user submit before `createExpense()`.

This is a positive human admission seam. The resulting Expense does not preserve rich extraction occurrence/confidence/admission provenance in the inspected create path, which remains KF-REC-049/KF-REC-052 pressure. No distinct F222 root is justified without additional downstream evidence.

### Direct AI document processing

The direct agent controller returns `DocumentExtractionResult` and performs no direct domain mutation at that controller boundary. Later consumers must enforce their own admission rules. No independent root.

### Generated DocumentInstance

- manual inline edit without a new version → F161/KF-REC-049;
- AI tweak mutating sections before version evidence → F164/KF-REC-049;
- Drive import replacing all sections without new version → F161 + F164 pressure;
- mounted hard delete destroying/detaching revision-review proof → F221/C171.

No additional correction root remains after those classifications.

## 2. F178/C128 exact reuse decision

F178/C128 already owns the generic semantic failure:

```text
source assertion/fact/evidence corrected or withdrawn
→ derived facts / recommendations / memories / projections / later reasoning remain semantically active
```

J12 can expose this through document-derived descendants, but source medium does not create a new semantic owner.

Verdict:

```text
DOCUMENT-SOURCED STALE DESCENDANTS AFTER CORRECTION/WITHDRAWAL
→ SPECIALIZATION / CROSS-LINK → F178/C128 + KF-REC-049
→ NO F222/C172 allocation
```

Where the correction fails earlier because a legitimately new source revision is never admitted as a new occurrence, F220/C170 remains the owner.

Where correction cannot be mapped to the exact reviewed assertion revision, F161 remains the owner.

Where downstream financial reversal/correction is required, KF-REC-052 owns the financial semantics.

## 3. Stable J12 root set after microscopic tracing

The irreducible J12 roots now appear to be:

```text
ROOT A — EVIDENCE ADMISSION
F219/C169
Question: when may a document assertion become qualifying evidence for a material consumer?

ROOT B — SOURCE REVISION / OCCURRENCE IDENTITY
F220/C170
Question: how does one stable external object produce distinct source/extraction/ingestion occurrences across revisions without replay duplication?

ROOT C — DESTRUCTIVE DISPOSITION
F221/C171
Question: when may versioned/reviewed document evidence be archived, superseded or physically destroyed, and what proof must survive?
```

Mature contracts supply the remaining shared semantics:

```text
revision / provenance / verification / correction → KF-REC-049 + F161/F164/F178
same-occurrence retry / effect identity           → KF-REC-048
ingress occurrence processing direction           → KF-REC-035
financial claim strength/correction                → KF-REC-052
contract-specific accepted revision/retention      → KF-REC-055
privacy/erasure policy pressure                    → J19
operator review/attention                          → KF-REC-051
```

## 4. Value-density verdict

A bounded J12 target may now be justified if it owns only the three irreducible boundaries above and composes mature contracts rather than duplicating them.

Do **not** create:

- universal EDMS;
- universal event store;
- second provenance/revision engine;
- second ingress runtime;
- second recovery/idempotency runtime;
- second financial truth system;
- global privacy/legal retention rules engine.

## 5. Pre-pooling verdict

```text
F219/C169 stable                         = YES
F220/C170 stable                         = YES
F221/C171 stable                         = YES
new correction/supersession root F222   = NO
F178/C128 reuse sufficient               = YES for stale-descendant semantics
F161/F164 reuse sufficient               = YES for reviewed revision + crash-consistent mutation semantics
ready for standards/frontier pressure    = YES
KF-REC-056 allocated                     = NO — pressure test first
runtime proof                            = NOT EXECUTED
production implementation                = NOT AUTHORIZED
```

## 6. Exact next action

Run a J12 standards/frontier pressure test against records/evidence provenance, revision/invalidation, external-source revision identity, review/approval binding and disposition/retention principles. Then decide whether one bounded J12 target contract survives as `KF-REC-056`.
