# Research Dossier — Engineering Practice: Practice of Programming × Clean Code × Refactoring × TDD

Sources:
- Brian Kernighan and Rob Pike, *The Practice of Programming*
- Robert C. Martin, *Clean Code*
- Martin Fowler, *Refactoring*
- Kent Beck, *Test-Driven Development: By Example*

Status: TARGETED TRANSLATION PASS 1  
Authority: RESEARCH_ONLY

## Source basis

The Practice of Programming explicitly spans style, algorithms/data structures, design/implementation, interfaces, debugging, testing, performance, portability and notation.

Clean Code emphasizes readability, naming, functions, comments, formatting, error handling and unit tests, but its prescriptions are treated here as heuristics rather than universal laws.

Fowler defines refactoring as behavior-preserving restructuring through small transformations.

TDD emphasizes short red/green/refactor feedback cycles.

## KEYFLOWOS convergence

### 1. Separate behavior-preserving refactor from semantic migration

This distinction is mandatory.

Behavior-preserving refactor:
- external semantics remain unchanged;
- characterization equivalence can carry much of the proof.

Semantic migration:
- authority/state/effect meaning changes;
- requires explicit target contract and stronger proof.

Do not label a semantic/authority/data migration "refactoring" to obtain weaker proof requirements.

### 2. Small steps reduce debugging radius

For large agent-generated changes:
- small semantic commits;
- focused fastest-falsification tests;
- then broader proof;
- exact-head final admission.

Small commits are useful only if each has coherent semantics. Arbitrary LOC splitting creates ceremony without reducing uncertainty.

### 3. Readability is semantic, not cosmetic

Naming and structure should expose:
- owner;
- authority;
- effect;
- state;
- failure;
- evidence.

A short function with misleading semantics is worse than a longer function with explicit invariants.

### 4. Tests must match the claim

Use:
- unit tests for deterministic pure/local behavior;
- characterization tests for existing behavior;
- integration/real-database tests for persistence/transactions/tenancy;
- provider simulators for external-effect ambiguity;
- end-to-end tests for user journeys;
- mutation/negative controls for critical invariants.

Do not count an unrelated green suite as proof.

### 5. Debugging starts with observability and reproducibility

Every failure should try to preserve:
- exact head;
- exact inputs;
- correlation/effect identity;
- relevant state revision;
- failed assertion or provider ambiguity.

"Could not reproduce" is an epistemic state, not a reason to silently close a defect.

### 6. Clean Code versus Ousterhout

Preserve the useful tension.

Clean Code often favors very small functions and self-explanatory code.

Ousterhout argues that over-decomposition can create shallow modules and that comments can preserve important interface/design information not obvious from code.

KEYFLOWOS convergence:

> Optimize for semantic clarity and information hiding, not method-length ideology.

A boundary module may legitimately be long if it concentrates a complex invariant coherently and exposes a small truthful interface. A short wrapper chain may be worse if callers must understand every layer.

### 7. Portability matters for the Development Organism

Proof and control tooling should avoid unnecessary machine-specific assumptions.

When platform-specific proof is required, distinguish:
- portable semantic proof;
- platform/OS-specific worker proof.

This mirrors existing agent-control strategy.

## GenAI cross-reference

- Layer 3: agent-generated refactors need bounded semantic ownership.
- Layer 7: contracts/notation should be executable and legible.
- Layer 8: tool interfaces need truthful failure/effect semantics.
- Layer 9: proof selection and mutation sensitivity.
- Layer 10: defensive failure handling and fail-closed protected invariants.

## Candidate proof-planner contribution

Change classes can choose proof profiles:
- CONTROL/AUTHORITY;
- TENANT/DATA;
- EXTERNAL EFFECT;
- PURE/LOCAL;
- SCHEMA/MIGRATION;
- UI/INTERACTION;
- MODEL/SEMANTIC EVAL.

This extends the existing research Proof Profiles instead of creating a second eval framework.

## Proof obligations for future implementation

- proof profile selected from declared change class;
- uncovered class remains visible, not mapped to generic green;
- behavior-preserving refactor has characterization equivalence;
- semantic migration has target-contract tests;
- critical invariant has a mutation/negative control;
- full proof cannot pass when required proof is skipped;
- exact-head binding is preserved.

## Disposition

ADOPT:
- short feedback loops;
- claim-matched testing;
- explicit interfaces;
- disciplined refactoring;
- readable names/structures.

CONTEXT-DEPENDENT:
- tiny functions;
- comment minimization;
- DRY beyond duplicated knowledge.

No production change is authorized by this dossier.
