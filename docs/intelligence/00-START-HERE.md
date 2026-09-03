# KeyFlowOS Intelligence — START HERE

This directory is the durable source of truth for the architectural and product intelligence developed across ChatGPT, Claude Code, Kimi/Gemini Code, repository analysis, source documents and human review.

## Prime directive

Conversations are working memory. This repository is durable memory.

No materially important conclusion about KeyFlowOS is considered preserved until written into the appropriate canonical intelligence artifact.

## Governing analysis rule

**MAP BEFORE MODIFYING.**

The architecture/research session is the command center. Production behavior must not be changed merely because a local problem appears obvious. First determine the affected journeys, kernels, state transitions, authority, capability, evidence, dependencies, contradictions, compatibility surfaces and proof requirements.

## Required load order for a new agent/session

Read in this order:

1. `AGENTS.md`
2. `docs/intelligence/AGENT-CONTINUITY.md`
3. `docs/intelligence/00-START-HERE.md`
4. `docs/intelligence/01-MASTER-CONTEXT.md`
5. `docs/intelligence/02-SYSTEM-MODEL.md`
6. `docs/intelligence/03-ANALYSIS-MAP.md`
7. `docs/intelligence/04-CONCEPT-REGISTRY.md`
8. `docs/intelligence/05-DECISION-REGISTER.md`
9. `docs/intelligence/06-OPEN-QUESTIONS.md`
10. `docs/intelligence/07-CURRENT-STATE.md`
11. `docs/intelligence/08-FINDING-REGISTER.md`
12. `docs/intelligence/09-CONTRADICTION-REGISTER.md`
13. `docs/intelligence/10-RECOMMENDATION-REGISTER.md`
14. `docs/intelligence/11-RECURSIVE-ASSURANCE-PROGRAMME.md`
15. `docs/intelligence/12-KERNEL-PROGRAMME.md`
16. `docs/intelligence/13-IMPLEMENTATION-HANDOFF-PROTOCOL.md`
17. `docs/intelligence/handoff/CURRENT-HANDOFF.md`
18. `docs/intelligence/handoff/CURRENT-STATE.yaml`
19. active journey/kernel/investigation files referenced by current state.

For continuity-sensitive work, also read the most recent relevant session journal.

Do not continue substantive work until required context is loaded or a missing-file condition is explicitly reported.

## Core operating model

KeyFlowOS analysis now runs as a **Journey Mesh + Kernel Mesh**.

```text
VERTICAL
= 25 end-to-end journey dossiers

HORIZONTAL
= 12 pooled architectural kernels

LOOPS
= constellations of journeys that repeatedly stress-test shared kernels

WHOLE OS
= recursive re-audit of the integrated architecture
```

Journeys are not independent checklists. Kernels are not abstract replacements for journey evidence.

See:

- `03-ANALYSIS-MAP.md`
- `11-RECURSIVE-ASSURANCE-PROGRAMME.md`
- `12-KERNEL-PROGRAMME.md`

## Active constellation

Current active analytical mesh:

```text
KF-JOURNEY-001 — Business Birth
        ↕
KF-JOURNEY-025 — Human Authority Lifecycle
        ↕
KF-JOURNEY-002 — KEY Request → Governed Action
        ↕
KF-JOURNEY-015 — Approval / Governance Lifecycle
```

J15 has already passed its original admission gate and is in active forensic analysis. Do **not** regress to earlier instructions saying J15 must remain unopened.

J15 may still reopen J1/J25/J2 if it exposes a foundational flaw.

Production implementation remains unauthorized.

## Canonical kernel programme

Current working kernels:

1. Tenant Genesis & Identity
2. Human Authority & Organization
3. KEY Authority & Governance
4. Business Knowledge
5. Capability Fabric
6. State Transition
7. Temporal / Event / Workflow
8. Evidence & Outcome
9. Integration & External Reality
10. Financial Truth
11. Recovery & Reliability
12. Engineering Control Plane

Shared semantic defects should normally be recorded once at kernel/system level and referenced by affected journeys rather than duplicated under every journey.

## Knowledge classification

Use these classes when ambiguity matters:

- **IMPLEMENTATION FACT / FACT** — directly supported by repository/source/runtime evidence.
- **TEST SOURCE** — test code exists; not proof that it was executed or passed.
- **GENERATED STATE** — generated architecture/audit state.
- **MAINTAINED ARCHITECTURE DOC** — maintained design/documentation evidence.
- **HISTORICAL / STALE DOC** — historical intent/context, not current implementation truth.
- **PRODUCT SOURCE** — founding/product intent source.
- **INFERENCE** — analyst reasoning from evidence.
- **WORKING HYPOTHESIS / WORKING DIRECTION** — not yet accepted architecture.
- **OPEN QUESTION** — unresolved.
- **ACCEPTED DECISION** — explicitly adopted.
- **DEPRECATED / SUPERSEDED** — replaced/refined.
- **RECOVERY UNCERTAIN** — reconstructed continuity with insufficient confidence.

Never silently promote hypothesis to decision.
Never silently treat historical documentation as current implementation truth.
Never silently treat current implementation as final intended architecture.
Never invent historical identifiers.

## Evidence discipline

Preserve:

```text
evidence
-> interpretation
-> architectural implication / recommendation
-> accepted decision
```

Distinguish:

```text
implementation exists
!= test source exists
!= test executed successfully
!= runtime behavior reproduced
!= concurrency invariant proven
!= system invariant proven
```

## Current reality vs target KeyFlowOS

Maintain both views at all times:

```text
CURRENT REALITY
= what the current repository/runtime actually does

TARGET KEYFLOWOS
= the architecture accepted after evidence, product intent, standards, contradictions, value engineering and cross-journey testing converge
```

Never allow target-state concepts to contaminate current-state claims.

## Finding lifecycle

Important findings should remain reopenable:

```text
PROVISIONAL
-> VERIFIED
-> RE-ANALYZED
   -> STRENGTHENED
   -> NARROWED
   -> UNCHANGED
   -> SUPERSEDED
   -> REFUTED
```

Truth outranks preservation of earlier conclusions.

## Existing-seam rule

Prefer strengthening coherent existing machinery before creating parallel `v2` systems.

Important existing seams requiring continued evaluation include:

- Membership
- CapabilityContractService
- ActionDispatcherService
- AuthorityGrant
- KeyCortexApprovalOrchestrator
- ApprovalRequest

Do not assume these are sufficient; prove or disprove suitability first.

## Legacy / reachability discipline

Do not classify code as dead merely because UI navigation does not expose it.

Distinguish:

- mounted
- reachable
- called
- UI-linked
- externally callable
- orphaned
- legacy
- compatibility-only

Legacy residue must be consumer-proven before deletion.

## Layered improvement rule

For each journey/kernel distinguish:

```text
L0 Correctness
L1 Mandatory production standard
L2 Strong KeyFlow architecture
L3 Advanced architecture
L4 KeyFlow-specific differentiation
```

Basic authorization, audit, idempotency and security are production standards, not innovation.

## Implementation control

Do not turn findings directly into coding tasks.

Before coding, relevant clusters should approach:

```text
mapped
-> cross-referenced
-> semantically reconciled
-> value-engineered
-> target-converged
-> migration understood
-> proof designed
-> execution-ready
```

Then use `13-IMPLEMENTATION-HANDOFF-PROTOCOL.md` to issue bounded `KF-EXEC-*` packets to Claude Code or another implementer.

Kimi/Gemini or another reviewer may independently adversarially review the same accepted invariant and resulting diff.

## Persistence rule

Material progress must update the relevant canonical artifacts and then continuity state:

- system/analysis/kernel/journey artifacts;
- concepts/decisions/questions;
- findings/contradictions/recommendations;
- current state;
- handoff;
- machine-readable state;
- session journal where appropriate.

Chats can expire. KeyFlowOS knowledge should not.

## Continuation protocol

A fresh agent should be able to answer:

- What is KeyFlowOS?
- What does current implementation actually do?
- What target architecture is working versus accepted?
- Which journeys and kernels are active?
- Which findings/contradictions are unresolved?
- Which recommendations are provisional?
- What changed most recently?
- What should happen next?
- What must not be implemented yet?

If those cannot be answered, context integrity is insufficient and recovery should occur before substantive work.
