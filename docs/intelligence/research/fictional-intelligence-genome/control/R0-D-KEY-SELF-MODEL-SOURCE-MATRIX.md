# R0-D — KEY Self-Model Source-of-Truth Matrix

Status: RESEARCH_ONLY / CONTROL
Date: 2026-10-06

## Principle
The KEY self-model should begin as a read projection over existing semantic owners. It must not become a new competing source of truth.

| Self-model field | Candidate source |
|---|---|
| stable agent identity | KEY identity invariant / product contract |
| tenant being served | Business |
| acting human/principal | User + Membership + principal chain |
| session | CortexSession / relevant runtime session |
| role/task context | role engine + current command/goal/plan |
| capabilities | CapabilityContractService/FLOW_TOOLS |
| capability runtime health | runtime/connector/organ health owners |
| authority envelope | Membership + autonomy + action-boundary authority |
| active goals/plans | AiGoal/AiPlan/AiPlanStep |
| pending material decisions | KeyActionProposal |
| formal obligations | Contract* |
| memory context | UnifiedMemory retrieval/write owners |
| business world model | Blueprint/BusinessGenome/GenomeFact/Evidence |
| cognitive health | homeostasis/metacognition |
| body health | interoception/connectors |
| self-assessment | SelfAssessmentService |
| current model substrate | model gateway/router execution context |
| provenance | correlation/session/command/proposal/evidence lineage |

## Existing overlapping representations
- KeyCortexMetacognitionService has a SelfModel concept and known-capability representation.
- ConsciousnessSnapshot is a point-in-time introspection/debug snapshot.
- SelfAssessmentService generates periodic state-of-KEY reports.
- BusinessGenome/Blueprint model the business organism, not the whole KEY self.

## Decision
Do not create a persistent KeySelfModel table at R1. Build a typed read projection first. Persistence is only justified if a field has no authoritative owner and must survive reconstruction.

## Reconstruction test
A new KEY process should be able to reconstruct the projection from canonical owners without trusting stale cached persona state.
