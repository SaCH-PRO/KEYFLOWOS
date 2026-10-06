# Research Dossier — The Design of Everyday Things

Source: Don Norman, *The Design of Everyday Things*, Revised and Expanded Edition  
Status: TARGETED TRANSLATION PASS 1  
Authority: RESEARCH_ONLY

## Source basis

Norman's revised edition emphasizes:
- affordances versus signifiers;
- conceptual models and the system image;
- mapping and feedback;
- discoverability and constraints;
- the gulfs of execution and evaluation;
- error classification and error-resilient design;
- resilience engineering and the paradox of automation.

## KEYFLOWOS translation

### 1. KEY needs a coherent system image

Users should not have to infer the difference between:
- what KEY observed;
- what KEY inferred;
- what KEY recommends;
- what KEY proposes to execute;
- what requires confirmation/approval;
- what was actually executed;
- what outcome was verified.

Current backend semantics are richer than many UI projections. The research target is a projection over canonical action/evidence state, not a new truth model.

### 2. Signifiers are critical for AI action

An available capability is analogous to an affordance. The user-visible indication of what KEY can do, what it is about to do, and what state an action is in is the signifier.

For AI-native interfaces:
- visible "can act" must not imply "is authorized";
- visible "submitted" must not imply "executed";
- visible "executed" must not imply "externally verified";
- confirmation and approval are distinct signifiers.

### 3. Close both gulfs

Gulf of execution:
Can the user express the intended business outcome without navigating the internal tool maze?

Gulf of evaluation:
Can the user tell whether KEY understood, proposed, executed and verified the intended outcome?

KEY's conversational interface can reduce the execution gulf while accidentally widening the evaluation gulf if it responds fluently without truthful effect state.

### 4. Design for errors, do not blame operators

For consequential actions:
- make dangerous actions hard to trigger accidentally;
- preserve undo/compensation/reconciliation state where possible;
- make irreversible effects explicit;
- make pending/unknown outcomes visible;
- prevent stale confirmations from binding to changed action payloads.

This aligns directly with action fingerprints, server-issued action IDs, fail-closed authority and exact effect evidence.

### 5. Automation needs resilience

When automation is uncertain or partially degraded, the system image must show that degradation rather than preserve the appearance of effortless success.

## GenAI cross-reference

- Layer 7: output structures should support truthful user-facing semantics.
- Layer 8: capability discovery must expose effect/authority requirements.
- Layer 9: traces/evals should test whether the user-visible projection matches actual state.
- Layer 10: error-resilient interaction and visible degraded states are safety controls.

## Candidate contract

ActionUnderstandingProjection:
- observation/inference summary;
- proposed action/capability;
- material effect;
- authority requirement;
- current disposition;
- approval/confirmation evidence;
- execution state;
- external outcome certainty;
- reversibility/compensation state;
- reasons and timestamps.

Projection only; canonical source records remain owners.

## Proof obligations

- no "done" projection before execution evidence;
- no "verified" projection before outcome evidence;
- stale confirmation cannot apply to mutated action arguments;
- pending/unknown outcome remains visible;
- denied action has a discoverable reason;
- missing optional explanation cannot change disposition;
- UI copy is generated from state, not model optimism.

## Disposition

ADOPT:
- system-image clarity;
- signifiers;
- feedback;
- constraints;
- error-resilient design.

Do not create:
- a second action state machine;
- UI-owned authority;
- model-authored completion truth.

No production change is authorized by this dossier.
