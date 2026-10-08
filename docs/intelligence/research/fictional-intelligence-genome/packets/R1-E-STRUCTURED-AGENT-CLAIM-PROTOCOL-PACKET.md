# R1-E — Structured Agent Claim / Disagreement Protocol

Status: READY_FOR_DESIGN_INTEGRATION
Programme: KIGP-001
Target owner: PR #149 parallel-worker programme

## Objective
Make parallel agents exchange structured epistemic objects rather than prose-only conclusions while preserving packet ownership and serialized admission.

## Claim envelope
Each claim should carry:
- claimId
- packetId
- workerId
- finding
- evidence items with kind/ref and optional independence group
- confidence
- assumptions
- dependencies
- contradictions
- suggested action
- affected paths
- producedAt

Evidence kinds may include repository evidence, tests, runtime evidence, external evidence and inference.

## Disagreement protocol
1. normalize claims;
2. identify the exact conflicting proposition or assumption;
3. compare evidence quality and independence;
4. seek discriminating evidence when cheap and safe;
5. preserve unresolved alternatives when not resolvable;
6. admission authority decides canonical state.

## Laws
- agent count does not equal evidence strength;
- repeated copies of one source are not independent corroboration;
- builder, reviewer and admission authority are distinct roles;
- scratch state does not automatically become durable memory;
- unresolved minority hypotheses remain visible;
- no worker may self-promote its claim into canonical state.

## Integration with PR #149
Extend packet/return artifacts with optional structured claims. Preserve existing worktree, file-claim and semantic-conflict controls. Admission remains serialized.

## Proof
- conflicting assumptions are surfaced;
- correlated evidence is not double-counted;
- unresolved disagreement survives;
- malformed claims cannot mutate canonical state;
- admission records evidence lineage.
