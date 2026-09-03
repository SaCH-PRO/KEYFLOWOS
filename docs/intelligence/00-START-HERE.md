# KeyFlowOS Intelligence — START HERE

This directory is the durable source of truth for the architectural and product intelligence developed across ChatGPT, Claude Code, Kimi Code, repository analysis, source documents, and human review.

## Prime directive

Conversations are working memory. This repository is durable memory.

No materially important conclusion about KeyFlowOS is considered preserved until it has been written into the appropriate canonical file in this directory.

## Governing analysis rule

**MAP BEFORE MODIFYING.**

The active architecture-analysis process is forensic and evidence-first. Production behavior must not be changed merely because a local problem appears obvious; first identify the relevant journey, state transitions, authority, capability, data/evidence effects, dependencies, contradictions, compatibility surfaces and proof requirements.

## Required load order for a new agent/session

Before continuing KeyFlowOS analysis, read in this order:

1. `01-MASTER-CONTEXT.md`
2. `02-SYSTEM-MODEL.md`
3. `03-ANALYSIS-MAP.md`
4. `04-CONCEPT-REGISTRY.md`
5. `05-DECISION-REGISTER.md`
6. `06-OPEN-QUESTIONS.md`
7. `07-CURRENT-STATE.md`
8. `08-FINDING-REGISTER.md`
9. `09-CONTRADICTION-REGISTER.md`
10. `10-RECOMMENDATION-REGISTER.md`
11. `handoff/CURRENT-HANDOFF.md`
12. The active journey/domain/investigation referenced by `CURRENT-STATE`.

For continuity-sensitive work, also read the most recent relevant session journal. The exhausted-thread recovery source is:

`docs/intelligence/sessions/2026-09-03-exhausted-thread-recovery.md`

Do not continue substantive work until the required context has been loaded or a missing-file condition has been explicitly reported.

## Knowledge classification

Every material statement should be classified when ambiguity matters:

- **FACT / IMPLEMENTATION FACT** — directly supported by repository/source/runtime evidence.
- **ACCEPTED DECISION** — explicitly adopted architectural/product/methodological decision.
- **WORKING HYPOTHESIS / WORKING DIRECTION** — plausible interpretation or target direction not yet accepted as canonical implementation architecture.
- **OPEN QUESTION** — unresolved issue requiring validation or decision.
- **DEPRECATED / SUPERSEDED** — previously considered/implemented idea that has been replaced or materially refined.
- **IMPLEMENTATION REALITY** — what the current code does, whether or not it is intentional, ideal, documented, legacy, duplicated or incomplete.
- **RECOVERY UNCERTAIN** — historical continuity information that could not be reconstructed with sufficient confidence.

Never silently promote a hypothesis into a decision.
Never silently treat historical documentation as current implementation truth.
Never silently treat current implementation as the final intended architecture.
Never invent historical identifiers or continuity to fill a gap.

## Evidence discipline

Preserve the chain:

```text
evidence
  -> interpretation
  -> architectural implication / recommendation
  -> accepted decision
```

Do not collapse these layers.

Evidence classes should remain distinguishable where relevant:

- implementation source
- runtime reproduction
- test source
- personally executed test result
- generated architecture/state artifact
- maintained architecture document
- historical/stale document
- product/source vision
- analyst inference
- recovered prior-thread context

A test file existing is not equivalent to the test currently passing. A generated report claiming green is not equivalent to personally reproducing runtime behavior.

## Journey-first microscopic model

The primary microscopic unit is the end-to-end journey dossier, not the isolated module.

The canonical programme currently runs through `KF-JOURNEY-025` and is listed in `03-ANALYSIS-MAP.md`.

Journey analysis is recursive/bidirectional: findings in later journeys may force earlier journeys to be re-analysed.

Current active mesh:

```text
KF-JOURNEY-001 — Business Birth
        ↕
KF-JOURNEY-025 — Human Authority Lifecycle
        ↕
KF-JOURNEY-002 — KEY Request → Governed Action
```

Do not fully open J15 until the admission conditions in current state/handoff are met.

## Finding, contradiction and recommendation discipline

### Findings

`08-FINDING-REGISTER.md` tracks material evidence/interpretation discoveries. Findings can be provisional, verified, re-analysed, narrowed, strengthened, superseded or refuted.

### Contradictions

`09-CONTRADICTION-REGISTER.md` tracks places where two apparently valid implementation/architectural models cannot both remain canonical without reconciliation.

A contradiction is not automatically a bug; it is an architectural reconciliation obligation.

### Recommendations

`10-RECOMMENDATION-REGISTER.md` contains provisional architectural recommendations. **These are not implementation tickets.** A recommendation must be revalidated and explicitly promoted through decision/execution planning before code changes.

## Legacy / reachability discipline

Do not classify something as dead merely because the UI does not navigate to it.

Distinguish at least:

- mounted
- reachable
- called by current code
- UI-linked
- externally callable
- orphaned
- legacy
- compatibility-only

Legacy residue must be consumer-proven before deletion.

## Existing-seam rule

Prefer strengthening an existing coherent seam before inventing a parallel `v2` system.

Recovered seams explicitly requiring evaluation include:

- `CapabilityContractService`
- `ActionDispatcherService`
- Membership
- AuthorityGrant

Do not assume they are sufficient; prove or disprove their suitability first.

## Persistence rule

If an insight materially changes our understanding of KeyFlowOS, update at least one relevant canonical artifact:

- `01-MASTER-CONTEXT.md`
- `02-SYSTEM-MODEL.md`
- `03-ANALYSIS-MAP.md`
- `04-CONCEPT-REGISTRY.md`
- `05-DECISION-REGISTER.md`
- `06-OPEN-QUESTIONS.md`
- `08-FINDING-REGISTER.md`
- `09-CONTRADICTION-REGISTER.md`
- `10-RECOMMENDATION-REGISTER.md`
- the active `journeys/`, `domains/`, or `investigations/` file

before the analytical cycle is considered complete.

Then update:

- `07-CURRENT-STATE.md`
- `handoff/CURRENT-HANDOFF.md`
- `handoff/CURRENT-STATE.yaml`
- a dated session journal under `sessions/`

## Continuation protocol

A fresh agent should be able to answer, after loading this directory:

- What is KeyFlowOS?
- What do we currently believe about its architecture?
- What journey mesh is active?
- What has been explicitly decided?
- What findings are historical/recovered versus currently revalidated?
- What contradictions remain unresolved?
- Which recommendations are provisional?
- What exact work was completed last?
- What should happen next?
- What must not be changed yet?

If any of those cannot be answered, context integrity is not sufficient and work should pause for recovery rather than inventing continuity.
