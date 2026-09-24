# KEYFLOWOS Canon

Status: CANONICAL DOCUMENTATION LAYER — v0.1 foundation

This directory is the durable explanatory and replication canon for KEYFLOWOS.

Its purpose is different from `docs/intelligence/`:

- `docs/intelligence/` is the forensic/analytical programme: evidence recovery, journeys, kernels, findings, contradictions, execution packets, proof and handoff state.
- `docs/canon/` is the stable explanatory layer: what KEYFLOWOS is, why it exists, how the business system works, how the software works, what is implemented/proven/targeted, and how the architecture can be replicated elsewhere.

The canon must never overwrite or hide contradictory implementation evidence. It explains the system by referencing the repository, the intelligence programme, historical blueprints and external standards with explicit status.

## Core definition

> KEYFLOWOS is a governed, AI-native operating system for organizations. It represents a business as a continuously evolving network of people, customers, money, work, time, obligations, communications, evidence, knowledge, rules and external systems; connects those elements into end-to-end flows; and allows humans, software and AI to observe, decide, act, verify outcomes and learn within explicit authority, financial, security and governance boundaries.

The product goal is operational continuity rather than feature aggregation.

## Truth classes

Every material claim in the canon should be attributable to one or more truth classes:

- **[IMPLEMENTED]** — current repository/code behavior or structure evidenced at a named revision.
- **[PROVEN]** — admitted by the architecture-forensics programme at a declared proof scope.
- **[TARGET]** — accepted desired architecture not yet proven as current implementation.
- **[HISTORICAL]** — prior blueprint/strategy useful for intent or evolution, not current-state truth.
- **[EXTERNAL]** — law, standard, research or outside evidence; jurisdiction/version/date must be stated.
- **[INFERENCE]** — analyst synthesis supported by evidence but not itself a source fact.
- **[OPEN]** — unresolved contradiction, missing evidence or intentionally unsettled decision.
- **[DEPRECATED]** — historical/legacy concept or path retained for traceability but not canonical direction.

A statement may carry multiple classes, for example `[IMPLEMENTED][PROVEN]`.

## Source precedence

When sources disagree, the canon does not silently reconcile them. Use this precedence for current-state claims:

1. reproduced runtime/proof evidence at the declared revision;
2. current code, schema and migrations at the declared revision;
3. current `docs/intelligence/` accepted decisions, concepts, receipts and handoff state;
4. current system maps/audits generated from code;
5. current product/strategy specifications;
6. historical blueprints and pasted build instructions;
7. general assumptions.

For target-state claims, accepted intelligence decisions and canonical architecture outrank current implementation, but the implementation gap must remain visible.

## Initial volume map

1. `00-CANON-GOVERNANCE.md` — status language, source hierarchy, versioning and change control.
2. `01-CONSTITUTION-AND-EXECUTIVE-DOCTRINE.md` — mission, philosophy, principles, institutional and executable constitution.
3. `02-SYSTEM-THESIS-AND-REFERENCE-MODEL.md` — macro architecture, causal model and reusable kernel thesis.
4. `03-SOURCE-TRACEABILITY.md` — evidence map connecting canon statements to code/intelligence/history.
5. Future volumes:
   - business/commercial architecture;
   - finance/economic truth;
   - legal/compliance/risk/evidence;
   - growth/marketing/PR/reputation;
   - product/UX/journeys;
   - end-to-end code walkthrough;
   - KEY Mind/Soul/Evolution and AI governance;
   - connector/interoperability architecture;
   - security/reliability/data/observability standards;
   - actual-to-ideal gap register;
   - replication/reference-architecture manual.

## Relationship to current programme state

Canon work must not silently rebaseline or interfere with active implementation packets.

At the branch point for this foundation:

- canonical intelligence branch: `docs/keyflow-intelligence-foundation`
- intelligence head: `21665793cb224e41bfd6a9360f1ef6c9182688b9`
- declared forensic baseline remains: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
- current admitted implementation reference recorded by handoff: `main@83b5f98d886e7831bbd2a1aac24f5cbb68701f51`
- architecture programme: 26 journeys / 12 kernels / 35 execution packets
- K12, EXTFX, TENANT and AUTH are checkpointed at their declared proof scopes
- active frontier: `KF-EXEC-ACTION-001 — Capability -> Control -> Clearance Boundary`
- production release, production mutation and production provider effects remain unauthorized in the canonical handoff.

## Governing doctrine

The canon must make it possible for a new human or agent to reason from:

```text
WHY
  -> BUSINESS CONCEPT
  -> USER/JOURNEY EXPERIENCE
  -> DATA / STATE
  -> SERVICE OWNERSHIP
  -> EVENTS / COORDINATION
  -> AUTHORITY / GOVERNANCE
  -> EXECUTION
  -> EXTERNAL EFFECT
  -> EVIDENCE / OUTCOME
  -> LEARNING
  -> REPLICATION
```

If a document cannot distinguish what is true now from what should become true, it is not canonical enough.
