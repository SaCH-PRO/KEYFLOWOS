# Living System Atlas Record Contract

Atlas ID: `KF-ATLAS-001`

This contract defines the minimum shape for atlas nodes and edges. It is intentionally small so it can be generated, reviewed and validated without becoming a second application schema.

## Node

```yaml
id: DOMAIN-COMMERCE
kind: domain
layer: L6
label: Commerce
evidence_class: observed
authority: current_code
semantic_owner: unresolved
confidence: high
evidence:
  - path: apps/server/src/modules/commerce
    ref: main
last_verified: 2026-10-05
status: active
notes: optional
```

Required node fields:

- `id`
- `kind`
- `layer`
- `label`
- `evidence_class`
- `authority`
- `confidence`

## Edge

```yaml
id: EDGE-J23-USES-TEMPORAL
source: JOURNEY-023
target: KERNEL-TEMPORAL
relation: uses
layer: L3
evidence_class: accepted
authority: canonical_intelligence
semantic_owner: KERNEL-TEMPORAL
confidence: high
evidence:
  - path: docs/intelligence/journeys/KF-JOURNEY-023-...
    ref: docs/keyflow-intelligence-foundation
last_verified: 2026-10-05
```

Required edge fields:

- `id`
- `source`
- `target`
- `relation`
- `layer`
- `evidence_class`
- `authority`
- `confidence`

## Evidence classes

- `observed` — current repository/runtime evidence.
- `accepted` — canonical durable architectural/programme decision.
- `intended` — desired target state, not implementation truth.
- `derived` — interpretation computed from other evidence.
- `historical` — superseded state kept for lineage.
- `unknown` — unresolved.

Unknown edges may exist for investigation, but consumers must not treat them as authoritative.

## Authority values

Initial vocabulary:

- `current_code`
- `generated_architecture`
- `canonical_intelligence`
- `control_plane`
- `target_architecture`
- `human_decision`

Authority describes where the claim comes from. It does **not** rank every source globally; precedence depends on the question being asked.

Examples:

- "What code runs now?" → current code/reachable execution wins.
- "What packet is active or held?" → control-plane state wins.
- "What architecture was accepted?" → canonical intelligence wins, then must be reconciled to current code before implementation claims are made.
- "What do we want to build?" → target architecture/intended records apply.

## Provenance

Evidence should identify a repository path and, when practical, a commit or branch.

A generated registry claim should record the generator provenance or last generation revision when available.

A human-reviewed semantic ownership claim must not be silently replaced by a later generated reference-count guess.

## Freshness

`last_verified` means the claim was checked, not merely copied.

A future validator should classify records as:

- fresh;
- stale;
- contradicted;
- unverified.

Stale records remain visible for lineage but should not silently drive modification.

## Relations

Initial relation vocabulary:

`contains`, `implements`, `depends_on`, `uses`, `enters`, `emits`, `consumes`, `reads`, `writes`, `owns`, `derives`, `projects`, `proves`, `invalidates`, `changes`, `governs`, `authorizes`, `blocks`, `recovers`, `reconciles`, `causes`, `observes`, `learns_from`, `supersedes`.

New relations should be added only when existing semantics cannot express the edge cleanly.

## Anti-fabrication rules

A validator for the atlas should eventually fail or warn when:

1. an edge references a missing node;
2. an `observed` execution edge has no implementation evidence;
3. an `accepted` edge has no durable decision evidence;
4. generated ownership is marked as reviewed semantic ownership without review evidence;
5. an `intended` node is presented as currently implemented;
6. a contradiction is overwritten instead of represented;
7. a stale source is used without a freshness marker;
8. an AI inference is marked as authoritative domain truth without evidence/governance;
9. a PR/change is linked to a journey/kernel without showing why;
10. a map claim survives after its cited file/path no longer exists.

## Cross-layer trace target

The end state is bidirectional traceability:

```
business outcome
<-> journey
<-> kernel
<-> capability/domain
<-> execution trace
<-> event/entity/provider
<-> package/module/file/symbol
<-> test/proof
<-> PR/packet/decision
<-> evidence/checkpoint
```

The atlas foundation defines this contract. Automated materialization and validation are the next tranche.
