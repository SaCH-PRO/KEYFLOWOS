# KeyFlowOS Intelligence — START HERE

This directory is the durable source of truth for the architectural and product intelligence developed across ChatGPT, Claude Code, Kimi Code, repository analysis, source documents, and human review.

## Prime directive

Conversations are working memory. This repository is durable memory.

No materially important conclusion about KeyFlowOS is considered preserved until it has been written into the appropriate canonical file in this directory.

## Required load order for a new agent/session

Before continuing KeyFlowOS analysis, read in this order:

1. `01-MASTER-CONTEXT.md`
2. `02-SYSTEM-MODEL.md`
3. `03-ANALYSIS-MAP.md`
4. `04-CONCEPT-REGISTRY.md`
5. `05-DECISION-REGISTER.md`
6. `06-OPEN-QUESTIONS.md`
7. `07-CURRENT-STATE.md`
8. `handoff/CURRENT-HANDOFF.md`
9. The active journey/domain/investigation referenced by CURRENT-STATE.

Do not continue substantive work until these have been loaded or a missing-file condition has been explicitly reported.

## Knowledge classification

Every material statement should be classified when ambiguity matters:

- **FACT** — directly supported by repository/source/runtime evidence.
- **ACCEPTED DECISION** — explicitly adopted architectural/product/methodological decision.
- **WORKING HYPOTHESIS** — plausible interpretation not yet accepted as canonical.
- **OPEN QUESTION** — unresolved issue requiring validation or decision.
- **DEPRECATED** — previously considered or implemented idea that has been superseded.
- **IMPLEMENTATION REALITY** — what the current code does, whether or not it is the intended architecture.

Never silently promote a hypothesis into a decision.
Never silently treat historical documentation as current implementation truth.
Never silently treat current implementation as the final intended architecture.

## Evidence discipline

Preserve the distinction:

`evidence -> interpretation -> decision`

Repository evidence, source-document evidence, runtime evidence, and inferred interpretation should remain distinguishable.

## Persistence rule

If an insight materially changes our understanding of KeyFlowOS, update at least one of:

- `01-MASTER-CONTEXT.md`
- `02-SYSTEM-MODEL.md`
- `03-ANALYSIS-MAP.md`
- `04-CONCEPT-REGISTRY.md`
- `05-DECISION-REGISTER.md`
- `06-OPEN-QUESTIONS.md`
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
- What has been explicitly decided?
- What remains unresolved?
- What analysis is active?
- What exact work was completed last?
- What should happen next?
- Which conclusions are implementation facts versus intended architecture?

If any of those cannot be answered, context integrity is not yet sufficient and work should pause for recovery rather than inventing continuity.
