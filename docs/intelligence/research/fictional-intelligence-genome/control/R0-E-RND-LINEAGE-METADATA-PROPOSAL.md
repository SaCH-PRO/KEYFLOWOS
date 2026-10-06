# R0-E — R&D -> PR Lineage Metadata Proposal

Status: RESEARCH_ONLY / CONTROL
Date: 2026-10-06

## Goal
Make architecture-affecting implementation traceable both directions:
research -> convergence -> primitive -> contract -> PR -> runtime proof,
and PR -> reason -> primitive -> evidence/source.

## Minimal metadata
```yaml
rnd_lineage:
  programme: KIGP-001
  observations: []
  genes: []
  anti_genes: []
  convergence_decisions: []
  canonical_primitives: []
  target_contracts: []
  existing_owner: null
  duplicate_risk_checked: false
  authority_impact: none
  implementation_effect: null
  validation:
    negative_controls: []
    runtime_evidence: []
  supersedes: []
  open_contradictions: []
```

## Rules
1. Metadata is provenance, never implementation authority.
2. A fictional/source observation cannot directly authorize code.
3. `existing_owner` must be resolved before a new subsystem is admitted.
4. `duplicate_risk_checked` must be true for architecture-allocating changes.
5. authority/security changes require explicit negative controls.
6. a PR may cite multiple genes, but should converge them to the smallest canonical primitive set.
7. rejected/deferred genes remain visible.

## Proposed PR #152 pressure-test
Use this as optional structured metadata in the PR unlock/value contract. Do not make every ordinary bugfix carry full R&D metadata; require it for architecture-affecting work originating in the R&D corpus.
