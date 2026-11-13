# Research Dossier — Structure and Interpretation of Computer Programs

Source: Harold Abelson, Gerald Jay Sussman, Julie Sussman, *Structure and Interpretation of Computer Programs*  
Status: TARGETED TRANSLATION PASS 1  
Authority: RESEARCH_ONLY

## Source basis

MIT Press describes SICP as building mental models of computation and emphasizes multiple ways of dealing with time: objects with state, concurrency, functional programming, lazy evaluation and nondeterministic programming. MIT OCW's course structure also explicitly includes data abstraction, higher-order procedures, mutation, graphs/search, environments, interpretation, a metacircular evaluator, lazy evaluation and asynchronous computing.

## KEYFLOWOS translation

### 1. Build semantic languages, not ad-hoc prompt conventions

SICP's evaluator/interpreter perspective suggests that important KEY semantics should be executable contracts with explicit syntax/meaning rather than informal prompt prose.

Direct correspondence:
- Layer 7 CognitiveFunction / OutputContract;
- Layer 8 capability contracts;
- Flow/ProcedureSpec;
- agent-control packet parsers.

A model may propose a sentence or tool call, but a deterministic interpreter should decide what that representation means at the effect boundary.

### 2. Separate state from the procedure that interprets state

Do not let one mutable object become simultaneously:
- observation;
- belief;
- authority;
- procedure;
- effect;
- proof.

This reinforces the KEY separation among domain state, evidence, control state, execution state and outcome.

### 3. Time model is an architectural decision

SICP's contrasting models of time reinforce that KEYFLOWOS must explicitly choose semantics for:
- immutable revisions;
- mutable current projections;
- streams/events;
- concurrent state;
- delayed/lazy computation;
- replay.

Do not represent temporal business truth as a timeless blob.

### 4. Higher-order composition supports capability/procedure construction

The useful analogy is not "everything becomes a function." It is that small operations with explicit contracts can be composed into larger procedures without duplicating runtime ownership.

For KEY:
- Flow remains the durable execution substrate;
- ProcedureSpec can compose capability references;
- FLOW_TOOLS remains the capability source of truth.

### 5. Metacognition needs an interpreter boundary

KEY may reason about plans, procedures, prompts and policies, but self-reference must not mean self-authority.

A proposed procedure/model/prompt revision is data until an external admission/promotion process interprets and activates it.

## GenAI cross-reference

- Layer 3: absorb interpreter/graph mechanisms without a second orchestration runtime.
- Layer 7: make task/output semantics explicit and executable.
- Layer 8: tool proposals require deterministic capability interpretation.
- Layer 9: evaluator outputs remain evidence, not execution semantics.
- Layer 10: no model-generated representation grants authority by itself.

## Candidate proof obligations

- malformed semantic contract is rejected before effect;
- plan/procedure representation cannot execute without capability resolution;
- replay under an immutable revision is deterministic where declared;
- mutable "current" projections identify their source revisions;
- procedure self-modification produces a candidate revision, not active authority.

## Disposition

ADOPT mechanisms:
- explicit interpreters/contracts;
- abstraction barriers;
- state/time separation;
- compositional procedure semantics.

REJECT:
- a new interpreter runtime beside Flow solely to mimic SICP;
- self-modifying activation without governance.

No production change is authorized by this dossier.
