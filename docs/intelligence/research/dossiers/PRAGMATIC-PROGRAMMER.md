# Research Dossier — The Pragmatic Programmer

Source: David Thomas and Andrew Hunt, The Pragmatic Programmer (20th Anniversary Edition used for current source structure)
Status: EXTRACTING / TARGETED APPLICATION
Authority: RESEARCH ONLY

## Source-supported focus used in this pass

The official Pragmatic Bookshelf contents include DRY, Orthogonality, Reversibility, Tracer Bullets, Domain Languages, Design by Contract, "Dead Programs Tell No Lies", Assertive Programming, "Don't Outrun Your Headlights", Decoupling, Refactoring, Testing, Property-Based Testing, Naming, teamwork and project practices.

## KEYFLOWOS translation

### Tracer bullets
Use a thin end-to-end reachable slice to prove an execution path before expanding implementation.

KEYFLOWOS version:
entry -> authorization -> canonical mutation -> persistence -> event/effect -> reconciliation -> user/operator projection.

### Orthogonality
Treat as bounded semantic coupling, not absolute independence.

Measure:
- change fanout;
- temporal coupling;
- semantic-owner count;
- shared-state count;
- coordinated-writer count;
- regression blast radius.

### DRY
Do not mechanically eliminate repeated text. Distinguish duplicated knowledge/authority from intentional repetition for isolation, tests or explicitness.

Candidate law:
DRY SEMANTICS BEFORE DRY SYNTAX.

### Design by Contract / assertive programming
Make preconditions, invariants, postconditions and impossible states explicit at semantic boundaries.

This aligns with packet proof obligations and fail-closed control-plane contracts.

### Don't outrun your headlights
Directly supports bounded implementation and short falsification loops: do not build far beyond evidence.

### Automation and tooling
Repeated manual cognition should become deterministic tooling when the semantics are stable.

## Current repo implications

- deterministic inventory/dependency scanners already embody the book's tooling philosophy;
- mutation-based negative controls strengthen assertive contracts;
- the state-reducer correction history shows where tracer/proof profiles can prevent speculative iteration;
- task context reconstruction is a repeated manual cost and therefore a candidate for automation.

## Candidate architecture contribution

The Context Compiler should be a deterministic tool over canonical sources, not an LLM-generated summary with unclear provenance.

It should also expose what it did not include and why, preserving reversibility/debuggability.

No production change is authorized by this dossier.
