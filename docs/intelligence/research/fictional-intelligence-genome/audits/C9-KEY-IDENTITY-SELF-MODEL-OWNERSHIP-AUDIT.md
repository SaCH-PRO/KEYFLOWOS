# C9 — KEY Identity / Self-Model Ownership Audit

Status: RESEARCH_ONLY
Programme: KIGP-001
Audit date: 2026-10-06

## Question
What currently constitutes KEY identity across models, sessions, roles, businesses, workers and surfaces, and is there one canonical self-model?

## Observed repository reality
- Human/business identity uses User, UserIdentity, Session, Business and Membership.
- CortexSession is business/user scoped; correlationId, sessionId, commandId and proposalId preserve execution lineage.
- Tests explicitly assert that KEY introduces itself as KEY and that a role is a hat, not a replacement identity.
- KeyCortexMetacognitionService is documented as confidence calibration and self-model; consciousness snapshots, SelfAssessmentService and KeyEvolutionLog hold related state.
- BusinessBlueprint + BusinessGenome describe the business organism/self-model, not sufficient evidence of a canonical KEY self-model.
- development worker identity/locks/cursors are separate from runtime KEY identity.

## Findings
### C9-F1 — KEY persona identity exists as a behavioral invariant
Disposition: ADOPT EXISTING INVARIANT.

### C9-F2 — no single canonical KEY self-model is proven
Relevant state is distributed across sessions, metacognition/consciousness, capability registries, authority, homeostasis, goals/plans, connectors and memory/evolution logs.
Disposition: TRUE SEMANTIC GAP, but not evidence for a new identity database.

### C9-F3 — BusinessGenome is the business/world identity model, not KEY identity
Disposition: TERMINOLOGY CONTRADICTION.
Reserve "business self-model" for Blueprint/Genome and "KEY self-model" for KEY's own capabilities/authority/health/tasks.

### C9-F4 — CortexSession is session identity, not persistent KEY identity
Disposition: SPECIALIZATION.

### C9-F5 — model/provider identity must remain below KEY identity
Disposition: ADOPT KIGP law.

## Candidate KEY self-model projection
A read model/projection, not a new source-of-truth store:
- stable KEY identity;
- business / acting-for principal;
- active user and role/task context;
- available capabilities + health;
- authority/autonomy envelope;
- goals/plans/commitments in scope;
- connected surfaces/connectors;
- cognitive/body/governance health;
- unresolved contradictions/limitations;
- current model/provider substrate;
- provenance timestamps.

Each field should project from an existing semantic owner.

## Recommended next steps
1. Build a source-of-truth matrix for each self-model field.
2. Audit metacognition self-model outputs and persistence.
3. Audit consciousness snapshots and SelfAssessmentService for overlap.
4. Treat a unified KEY self-model as a read projection unless a missing write-owner is proven.
5. Keep business self-model and KEY self-model terminology separate.
