# Development-Speed Trace 004B — Historical ContextBundle Prototype

Status: ACTIVE R&D / HISTORICAL COUNTERFACTUAL TEST
Authority: RESEARCH ONLY
Sample packet: KF-META-STATE-REDUCER-LIVE-001 / PR #120

## Question

If a deterministic, provenance-rich ContextBundle had existed before implementation, which later correction classes could have been surfaced earlier?

## Epistemic limitation

This is retrospective. It can show that a constraint/risk was already derivable, or that characterization could have exposed it earlier. It cannot prove that an agent would have avoided a defect.

Classifications:
- PRE_SURFACEABLE — existing contracts/history could place it in the initial bundle.
- EARLY_DERIVABLE — deterministic characterization could expose it before broad implementation.
- EMERGENT — depended on later review/new evidence.
- HUMAN_EXTERNAL — depended on operator/external state.

## 1. Baseline worker context

The Claude worker wakes a bounded non-interactive session and directs it to read broad operational/control documents, issue #80 history, resolve main, and process the named message. It carries packet/message/worktree identity but does not compile task-specific:
- architecture ownership;
- semantic hotspot history;
- likely historical failure classes;
- exact execution path;
- proof profile;
- stale-vs-current continuity warnings.

The baseline therefore optimizes for safe reconstruction rather than minimum sufficient context.

## 2. Historical packet semantic profile

A pre-edit bundle for KF-META-STATE-REDUCER-LIVE-001 should have classified the task as:

```yaml
change_classes:
  - STATE_MACHINE_CHANGE
  - AUTHORITY_MIGRATION
  - CONTROL_PLANE_CHANGE
  - RECOVERY_SEMANTICS
risk:
  - exact_head_admission
  - authority_integrity
  - derived_state_correctness
  - operator_control
```

Likely semantic surfaces:
- state/checkpoint reducer;
- control-envelope/event normalization;
- authority effects;
- admission/binding;
- programme-state projection;
- packet/return artifacts;
- negative controls;
- recovery/re-anchor.

This is substantially more informative than "JavaScript/YAML changes."

## 3. Candidate historical failure profile

From prior control-plane contracts plus deterministic characterization, an initial proof profile could reasonably have demanded:

### PRE_SURFACEABLE
- malformed authority must fail closed;
- packet/artifact/head identities require exact binding;
- derived state is not execution authority;
- stale anchors require explicit recovery semantics;
- negative controls must prove liveness rather than merely execute;
- exact-head admission evidence must not be inferred from older green runs;
- invalid control state must not render as valid operator state.

### EARLY_DERIVABLE
- wrong structural container types;
- non-string packet/branch identities;
- prototype-like mapping keys;
- colon-bearing identifiers / YAML key round-trip;
- repeated malformed fields;
- checkpoint shape permutations;
- code movement making line-oriented negative controls vacuous.

These are excellent candidates for characterization/fuzz/property-style tests before implementation.

### EMERGENT / REVIEW-DISCOVERED
Specific later contract refinements and exact correction wording that were not encoded or derivable at packet start should remain emergent. The experiment must not claim hindsight as prior knowledge.

## 4. Counterfactual ContextBundle

```yaml
context_bundle:
  task:
    packet: KF-META-STATE-REDUCER-LIVE-001
    change_classes:
      - STATE_MACHINE_CHANGE
      - AUTHORITY_MIGRATION
      - CONTROL_PLANE_CHANGE
      - RECOVERY_SEMANTICS

  invariants:
    - control authority must be explicit
    - malformed authority fails closed
    - derived programme state cannot outrank execution authority
    - artifact identity must bind to exact packet/head
    - recovery/reanchor must be explicit and reviewable

  execution_path:
    - control envelope
    - event normalization
    - authority effects
    - state fold
    - programme-state projection
    - admission/artifact verification
    - worker/operator surface

  historical_failure_classes:
    - SHAPE_TYPE
    - IDENTITY
    - PARSER_CODEC
    - RECOVERY
    - PROOF_VACUITY
    - ARTIFACT_HEAD_BINDING
    - OPERATOR_REPRESENTATION

  microproof:
    - characterize current fold on valid and malformed envelopes
    - enumerate checkpoint/container shapes
    - round-trip adversarial identifiers through YAML/control parsing

  semantic_proof:
    - malformed authority cases
    - stale anchor/recovery cases
    - exact binding cases
    - prototype-like identity cases
    - repeated-field cases
    - mutation-sensitive negative controls

  final_admission:
    - portable control-plane proof
    - platform-specific worker proof where required
    - exact-head workflows
    - artifact/PR binding
```

## 5. What this could plausibly have prevented

The bundle would not magically eliminate corrections. Its plausible value is shifting failure discovery left.

High-confidence opportunities:
- treating identity and structural shape as first-class adversarial dimensions before implementation;
- testing malformed/repeated/parser inputs before review finds them;
- explicitly testing recovery/re-anchor rather than adding it after happy-path fold work;
- demanding mutation-sensitive controls at the beginning;
- preventing "green at a related head" from being treated as exact-head proof.

Moderate-confidence opportunities:
- reducing rediscovery of authority/derived-state distinctions;
- reducing reviewer cycles around operator rendering and malformed state;
- making state/parser/admission coupling visible before file-local edits.

Not justified:
- claiming all PR #120 corrections would disappear;
- claiming fewer commits necessarily means higher quality;
- replacing broad final review/CI with the bundle.

## 6. Book-to-code result

### Hermans
The likely failure was not simply KNOWLEDGE_ABSENT. Much of the needed information existed but was distributed across control contracts/history. That points to RETRIEVAL_FAILURE + REPRESENTATION_FAILURE, with possible CONTEXT_OVERLOAD from broad source reading.

### Pragmatic Programmer
A tracer/characterization pass across envelope -> normalize -> fold -> projection -> admission could have exposed structural and recovery assumptions earlier.

### Ousterhout
The task-facing interface should hide retrieval mechanics while exposing semantic truth: authority, invariants, conflicts, stale sources, failure history.

### Tornhill
Correction history becomes task-specific risk evidence.

### Beck/TDD
High-risk invariants benefit from tests that are shown to fail under restored defects, not merely tests written first.

## 7. Concrete reusable asset emerging

A deterministic compiler can now be decomposed without inventing a mega-system:

```
resolve-snapshot
  -> classify-change
  -> map-semantic-surfaces
  -> retrieve-hotspot-profile
  -> select-proof-profile
  -> emit ContextBundle
```

Existing scanners/maps/control artifacts should be reused. The compiler is a projection layer, not a new authority store.

## 8. Required anti-fake-green metadata

Every bundle should state:
- source revision;
- authority class;
- freshness;
- whether a statement is canonical, derived, historical or research-only;
- unresolved contradictions;
- missing expected sources;
- generation version.

If a required authority source cannot be resolved, bundle health must be DEGRADED or INVALID, never silently green.

## 9. Prototype verdict

VERDICT: PROMISING, NOT YET PROVEN.

The historical sample supports the hypothesis that deterministic context assembly could have moved several classes of PR #120 failure earlier in the cycle.

It does not yet establish net speed gain.

## 10. Next proof step

Before production implementation:
1. prototype the same bundle method on a different domain (TENANT or EXTFX);
2. compare whether the taxonomy/proof selection generalizes;
3. estimate context volume versus broad baseline;
4. define machine-readable ContextBundle schema;
5. only then consider a deterministic compile-context script.

This keeps the R&D progression:
BOOK -> PRINCIPLE -> REPO EVIDENCE -> HISTORICAL EXPERIMENT -> CANDIDATE TOOL -> CROSS-DOMAIN REPLICATION -> ARCHITECTURE PROMOTION.
