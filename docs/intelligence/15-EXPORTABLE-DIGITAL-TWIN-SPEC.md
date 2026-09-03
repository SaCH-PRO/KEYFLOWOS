# KeyFlowOS Exportable Digital Twin Specification

Status: CANONICAL WORKING EXPORT CONTRACT

Purpose: ensure the complete KeyFlowOS analysis programme can be exported, reloaded, validated and compiled into an implementation execution map without relying on any one chat session, model context window or human recollection.

## Prime requirement

> The analysis must compile.

The end product of the 25-journey / 12-kernel programme is not a collection of prose documents. It is a portable architecture package whose entities, relationships, evidence, maturity, decisions and implementation implications can be reconstructed by another tool or agent.

## Required top-level export domains

```text
PROJECT
JOURNEYS[25]
KERNELS[12]
CONSTELLATIONS
CONCEPTS
INVARIANTS
FINDINGS
CONTRADICTIONS
OPEN_QUESTIONS
DECISIONS
RECOMMENDATIONS
STANDARDS_RESEARCH
INNOVATIONS
TARGET_STATE
MIGRATIONS
PROOF_REQUIREMENTS
EXECUTION_PACKETS
IMPLEMENTATION_EVIDENCE
RE_AUDIT_STATE
```

Each entity must have a stable identifier and explicit provenance.

## Stable identity

Do not depend on file names or prose headings as the only identity mechanism.

Examples:

```text
KF-JOURNEY-015
KF-KERNEL-003
KF-CONCEPT-040
F068
C035
KF-REC-018
KF-EXEC-AUTH-003
```

Existing IDs are preserved. Future namespace refinement must use explicit migration rather than silent renumbering.

## Common entity envelope

Machine-readable records should converge toward a common envelope:

```yaml
id: stable-id
type: journey|kernel|finding|contradiction|decision|recommendation|invariant|research|innovation|execution-packet
status: ...
title: ...
summary: ...
source_paths: []
implementation_baseline: ...
evidence:
  - kind: implementation|test-source|runtime|generated-state|maintained-doc|historical-doc|product-source|external-standard|open-source-reference|inference
    ref: ...
    claim: ...
interpretation: ...
affects:
  journeys: []
  kernels: []
depends_on: []
contradicts: []
supersedes: []
superseded_by: []
created_at: ...
updated_at: ...
```

Not every field is mandatory for every type, but provenance and relationships must not be lost.

## Journey export record

Each journey should eventually expose a machine-readable AC record containing at minimum:

```yaml
id: KF-JOURNEY-###
name: ...
maturity: L0-L10|NEEDS_REVISIT
entry_surfaces: []
actors: []
state_machine: []
frontend_paths: []
api_paths: []
backend_chains: []
data_mutations: []
capabilities: []
authority_dependencies: []
knowledge_dependencies: []
events: []
external_integrations: []
invariants: []
findings: []
contradictions: []
open_questions: []
proof_requirements: []
kernels: []
recommendations: []
target_state_refs: []
```

## Kernel export record

Each kernel should eventually expose its Y machine-readable record:

```yaml
id: KF-KERNEL-###
name: ...
maturity: L0-L10|NEEDS_REVISIT
truth_ownership: []
inputs: []
outputs: []
contracts: []
state_semantics: []
invariants: []
journey_impact: []
implementation_seams: []
legacy_surfaces: []
findings: []
contradictions: []
open_questions: []
research_refs: []
target_state_refs: []
migration_refs: []
proof_requirements: []
```

## Relationship graph

The export must preserve graph edges, not just lists.

Required edge classes include:

```text
JOURNEY -> USES_KERNEL
JOURNEY -> PRODUCES_FINDING
FINDING -> AFFECTS_JOURNEY
FINDING -> AFFECTS_KERNEL
FINDING -> SUPPORTS_RECOMMENDATION
CONTRADICTION -> CONFLICTS_WITH
RECOMMENDATION -> MODIFIES_KERNEL
RECOMMENDATION -> IMPACTS_JOURNEY
DECISION -> ACCEPTS_OR_REJECTS_RECOMMENDATION
TARGET_STATE -> SATISFIES_INVARIANT
EXECUTION_PACKET -> IMPLEMENTS_DECISION
EXECUTION_PACKET -> TOUCHES_COMPONENT
PROOF -> VALIDATES_INVARIANT
IMPLEMENTATION_COMMIT -> SATISFIES_EXECUTION_PACKET
NEW_EVIDENCE -> INVALIDATES_PRIOR_STATE
```

This graph is the core of exportability and later Architecture Atlas functionality.

## Current reality versus target reality

The export must keep two models separate:

```text
CURRENT_REALITY
  = current implementation evidence at a specific baseline

TARGET_KEYFLOWOS
  = accepted/provisional target architecture
```

Never overwrite current reality with target design.
Never present target design as implemented behavior.

Every target object should have an implementation status.

## Research / standards export

For high-impact decisions, preserve external research in a normalized form:

```yaml
research_id: KF-RESEARCH-...
question: ...
source_type: standard|primary-doc|open-source|engineering-doc|academic|practitioner
source: ...
observed_property: ...
transferability: adopt|adapt|reject|unknown
reason: ...
affected_kernels: []
affected_journeys: []
```

Research exists to support architectural properties, not to create decorative bibliography.

## Innovation export

Innovation candidates must remain distinguishable from required production controls.

```yaml
innovation_id: KF-INNOV-...
problem: ...
value: ...
enablers: []
standard_floor_dependencies: []
affected_journeys: []
affected_kernels: []
new_risks: []
verdict: REJECT|DEFER|RESEARCH|PROTOTYPE|TARGET-CANDIDATE|ACCEPTED-DIRECTION
```

## Execution-map compiler

Once enough target architecture has reached execution readiness, the digital twin should compile into a dependency-aware execution graph.

Conceptual flow:

```text
accepted decisions
+ target invariants
+ current implementation delta
+ migration constraints
+ dependency graph
+ proof requirements
        ↓
EXECUTION COMPILER
        ↓
KF-EXEC-* packets
        ↓
dependency-aware implementation programme
```

Each execution packet must be bounded and traceable.

Minimum packet shape:

```yaml
id: KF-EXEC-...
objective: ...
implements_decisions: []
satisfies_invariants: []
affected_journeys: []
affected_kernels: []
current_evidence: []
target_behavior: ...
likely_components: []
prohibited_shortcuts: []
migration_requirements: []
characterization_tests: []
acceptance_tests: []
adversarial_tests: []
rollback: ...
observability: ...
depends_on_packets: []
blocks_packets: []
status: PLANNED|READY|IMPLEMENTING|REVIEW|PROVEN|INGRAINED
```

## Seamless coding-agent translation

The export must allow Claude Code, Kimi, Gemini or a future KeyFlowOS agent to receive only the subset needed for a bounded task while retaining global constraints.

An implementation agent should receive:

```text
GLOBAL NON-NEGOTIABLE INVARIANTS
+ RELEVANT KERNEL STATE
+ RELEVANT JOURNEY STATE
+ EXACT EXECUTION PACKET
+ CURRENT IMPLEMENTATION BASELINE
+ PROHIBITED SHORTCUTS
+ TEST / PROOF CONTRACT
```

It should not need the full conversation history.

## Re-ingestion contract

Implementation output must be ingestible back into the twin.

Required return evidence:

```yaml
packet_id: ...
implementation_commit: ...
files_changed: []
behavior_changed: []
migrations: []
tests_added: []
tests_executed: []
test_results: []
known_failures: []
architecture_deviations: []
new_findings: []
new_unknowns: []
```

The architecture command center then independently verifies the diff and updates journey/kernel maturity.

## Export quality gates

Before calling the final twin exportable, verify:

1. all 25 journeys have machine-readable records;
2. all 12 kernels have machine-readable records;
3. cross-journey/kernel edges are resolvable;
4. no finding/recommendation exists only in unstructured chat memory;
5. current and target states are separated;
6. evidence provenance is attached to material claims;
7. contradictions have explicit status;
8. decisions are distinguishable from recommendations;
9. implementation-sensitive facts have baseline commits;
10. target changes map to proof requirements;
11. execution packets can be dependency ordered;
12. an independent agent can load the export and recover the current programme without chat history.

## Preferred export forms

The canonical human-readable source remains repository Markdown.

Machine-readable export should favor simple durable formats:

```text
YAML / JSON records
+ deterministic IDs
+ explicit graph edges
+ repository-relative source references
```

Do not make the architecture dependent on a proprietary database or agent runtime.

A richer graph database or Architecture Atlas can be generated from the portable source later.

## Final intended pipeline

```text
FORENSIC REPOSITORY ANALYSIS
        ↓
25 JOURNEYS + 12 KERNELS
        ↓
CROSS-REFERENCE / RESEARCH / RE-ANALYZE
        ↓
INVARIANTS + FINDINGS + CONTRADICTIONS
        ↓
VALUE ENGINEERING + INNOVATION
        ↓
TARGET KEYFLOWOS DIGITAL TWIN
        ↓
EXPORTABLE MACHINE-READABLE PACKAGE
        ↓
EXECUTION GRAPH
        ↓
KF-EXEC PACKETS
        ↓
CLAUDE CODE IMPLEMENTATION
        ↓
KIMI / GEMINI ADVERSARIAL REVIEW
        ↓
INDEPENDENT ARCHITECTURE VALIDATION
        ↓
PROOF
        ↓
RE-INGEST INTO DIGITAL TWIN
        ↓
WHOLE-SYSTEM RE-AUDIT
```

This pipeline is the primary protection against chat limits, agent drift and loss of architectural reasoning.
