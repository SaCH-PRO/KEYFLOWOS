# Research Dossier — The Programmer's Brain

Source: Felienne Hermans, The Programmer's Brain (2021)
Status: EXTRACTING / TARGETED APPLICATION
Authority: RESEARCH ONLY

## Source-supported focus used in this pass

Manning describes the book as applying cognitive science to code comprehension, learning, naming, and onboarding. Its material on complex-code reading distinguishes confusion caused by lack of information, lack of knowledge, and lack of processing capacity; it uses working-memory overload, dependency marking, state tables and dependency graphs as practical supports.

## KEYFLOWOS translation

### Principle 1 — not all "agent confusion" is the same failure
Research hypothesis:
- KNOWLEDGE_ABSENT — needed information is not in durable knowledge.
- RETRIEVAL_FAILURE — the information exists but was not surfaced.
- CONTEXT_OVERLOAD — too much relevant/irrelevant material is active at once.
- REPRESENTATION_FAILURE — the information exists but in an unhelpful form.
- REASONING_FAILURE — sufficient context/representation was present but the conclusion was still wrong.

Do not route all five to "give the agent more context."

### Principle 2 — external representations can offload working memory
Human techniques such as state tables and dependency graphs suggest an agent analogue:
- architecture graph;
- state-transition table;
- authority table;
- failure-mode table;
- dependency slice;
- proof profile.

This supports deterministic context assembly rather than dumping large documents into every task.

### Principle 3 — shared mental models reduce onboarding cost
For multi-agent KEYFLOWOS work, the analogue is a shared canonical vocabulary and task context compiled from repository evidence.

The repository already has architecture maps, execution paths, packet artifacts and canonical control semantics. The research question is how to select the smallest sufficient subset.

## Current repo implications

1. AGENTS.md is valuable but very large and mixes launch/runtime gotchas, UI history, operating rules, execution control and architecture policy.
2. active-packet.yaml can become extremely large because it preserves authority lineage and proof history.
3. multiple continuity surfaces are not equally fresh.
4. CODEBASE_MAP contains highly valuable "what is real" distinctions but reading it wholesale for every task is unnecessary.
5. Architecture graphs and packet metadata already provide raw material for an externalized working-memory aid.

## Candidate architecture contribution

A context compiler should produce task-specific projections instead of one universal context blob.

Candidate sections:
- current task and authority;
- freshness/precedence snapshot;
- semantic owner;
- affected journey/kernel;
- live execution path;
- relevant invariants;
- historical failure profile;
- exact files/interfaces;
- proof profile;
- unresolved contradictions;
- explicit excluded context.

## Anti-overload law

MORE CONTEXT != MORE UNDERSTANDING.

Context should maximize decision-relevant information per token while preserving authority, uncertainty and missing-information signals.

No production change is authorized by this dossier.
