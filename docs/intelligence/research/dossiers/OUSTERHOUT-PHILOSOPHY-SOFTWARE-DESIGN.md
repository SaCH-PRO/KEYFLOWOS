# Research Dossier — A Philosophy of Software Design

Source: John Ousterhout, A Philosophy of Software Design
Status: EXTRACTING / TARGETED APPLICATION
Authority: RESEARCH ONLY

## Source-supported focus used in this pass

Ousterhout's official book page identifies complexity reduction as the central concern and highlights deep/general-purpose modules. The second edition adds "Decide What Matters" and expands "General-Purpose Modules are Deeper"; Ousterhout also explicitly notes disagreements with Clean Code over issues such as method length and comments.

## KEYFLOWOS translation

### Deep module principle
A useful module should hide substantial necessary mechanism behind a small coherent interface.

For KEYFLOWOS, depth is not merely LOC/interface ratio. A deep semantic module must preserve visibility of:
- authority;
- side effects;
- failure modes;
- external uncertainty;
- recovery requirements;
- evidence.

Candidate law:
HIDE MECHANISM, NOT TRUTH.

### Decide what matters
Context assembly should prioritize semantic importance, not file size or recency alone.

Potential ranking dimensions:
- authority relevance;
- runtime reachability;
- risk;
- current packet scope;
- unresolved contradiction;
- historical failure density;
- change proximity.

### General-purpose vs special-purpose
Do not create one mega-context runtime. Prefer a small general contract for context selection with task-specific projections.

## Current repo implications

The repository currently asks agents to read multiple broad documents before substantial work. This is safe but cognitively expensive.

The desired improvement is not deleting canonical documents. It is compiling a deep, simple task-facing interface over them.

Candidate interface:
`compile-context <packet|task> -> ContextBundle`

Internally it may read many sources, but callers receive a bounded, provenance-rich semantic projection.

No production change is authorized by this dossier.
