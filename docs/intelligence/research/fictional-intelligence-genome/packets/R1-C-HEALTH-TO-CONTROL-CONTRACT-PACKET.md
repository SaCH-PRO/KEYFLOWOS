# R1-C — Health-to-Control Contract

Status: READY_FOR_IMPLEMENTATION_REVIEW
Programme: KIGP-001

## Objective
Define a pure decision contract that can only tighten existing execution requirements when relevant system health is degraded. No effects and no global safe-mode runtime in this packet.

## Inputs
- capability identity and risk tier
- authority/principal state
- autonomy settings
- governance health
- cognitive health
- body/organ health
- business readiness
- connector/effect-path health
- reversibility class

## Output classes
- preserve current requirement
- require confirmation
- require formal approval
- require admin approval
- block execution

Every result must carry reasons/evidence references.

## Semantics
- governance read failure is fail-closed;
- homeostatic degradation may increase caution/control but can never grant authority;
- business readiness controls domain eligibility;
- connector failure means the effect path is unavailable;
- unrelated subsystem degradation must not globally disable safe reads.

## First adoption
After pure-contract tests pass, apply to one capability already routed through the action boundary.

## Tests
- healthy state preserves behavior;
- degradation never increases autonomy;
- missing governance blocks material action;
- unavailable connector cannot report success;
- unrelated degradation does not block a safe read;
- recovery restores baseline only after valid health evidence exists.
