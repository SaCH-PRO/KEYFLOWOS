# R1-D — KEY Self-Model Read Projection

Status: READY_FOR_IMPLEMENTATION_REVIEW
Programme: KIGP-001

## Objective
Extend the existing metacognitive SelfModel into a reconstructible operational read projection without creating a new persistence silo.

## Existing SelfModel
The current type already tracks capabilities, recommendation accuracy, action success rate, user approval rate, prediction accuracy, confidence calibration, knowledge gaps and data gaps.

## Candidate additive projection
- stable KEY identity/version
- actingFor: businessId + principal/user + active role(s)
- runtime context: session/correlation/command/plan/proposal IDs
- current authority/autonomy envelope
- active goal/plan summaries
- pending action-decision summaries
- canonical capability IDs plus runtime health
- cognitive/body/governance readiness
- connected surfaces where an authoritative source exists
- unresolved contradictions / unavailable dependencies
- current model/provider/router metadata as substrate
- generatedAt and source timestamps

## Rules
- projection only; authoritative writes remain in existing owners;
- business self-model and KEY self-model remain distinct;
- current provider/model is substrate metadata, not identity;
- role/persona is a hat, not a replacement identity;
- unavailable source state must be marked unknown/degraded rather than defaulted;
- no user-emotion inference becomes KEY identity.

## Implementation shape
Prefer an additive builder in or adjacent to metacognition, such as an operational self-model view composed from existing owners. Map all current SelfModel callers before widening a public contract.

## Tests
- reconstructs after process restart;
- changing provider does not change stable identity;
- changing role changes active context only;
- missing source yields unknown/degraded state;
- tenant isolation;
- no write side effects.
