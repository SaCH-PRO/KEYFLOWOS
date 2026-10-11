# KEYFLOWOS Historical Intelligence Reconciliation Programme

Programme ID: KF-HIR-001
Status: ACTIVE
Purpose: prove that valuable work from KEYFLOWOS inception to present has a current disposition and is not stranded in old conversations, documents, branches, or superseded plans.

## Core question

For every material historical insight:

> What happened to this?

The answer must lead to:
CURRENT / ABSORBED / SUPERSEDED / IMPLEMENTED / DUPLICATE / REJECTED / DEFERRED / ORPHANED.

## Source classes

1. Original product specifications and project documents.
2. Git history, branches, PRs, issues and review comments.
3. Architecture-forensics artefacts: maps, microtraces, journeys, waves, kernels, constellations, macro/micro pools, dynamic/causal/feedback graphs.
4. Repository intelligence, Living System Atlas, ownership/dependency maps and continuity artefacts.
5. Development-control-plane work: workers, locks, admission, no-fake-green, review loops and PR contracts.
6. Memory / Context Genome / Business Genome research.
7. KEY/KIGP research and capability/self-model/authority work.
8. ChatGPT/Claude/Kimi project threads and exported transcripts.
9. Implementation PRs and runtime proof.

## Reconciliation loop

RECOVER
-> NORMALIZE
-> DEDUPLICATE
-> EXTRACT CANDIDATES
-> TRACE FORWARD LINEAGE
-> TRACE BACKWARD RATIONALE
-> COMPARE TO CURRENT REPO
-> DISPOSITION
-> FIND ORPHANS
-> FIND CONTRADICTIONS
-> PRESSURE TEST
-> UPDATE CANONICAL INTELLIGENCE
-> UPDATE IMPLEMENTATION DAG

## Canonical lineage object

Each material item should eventually carry:

```yaml
historical_lineage:
  artifact_id: string
  source_kind: chat|doc|issue|pr|commit|journey|kernel|constellation|research
  source_ref: string
  observed_at: string|null
  summary: string
  categories: []
  predecessors: []
  descendants: []
  disposition: CURRENT|ABSORBED|SUPERSEDED|IMPLEMENTED|DUPLICATE|REJECTED|DEFERRED|ORPHANED
  current_owner: string|null
  target_contract: string|null
  implementation_refs: []
  proof_refs: []
  supersession_reason: string|null
  confidence: low|medium|high
```

## Thread-scanning subsystem

Initial implementation:
`scripts/intelligence/project_thread_harvester.py`

The scanner is intentionally deterministic and evidence-preserving. LLM/agent review happens after extraction, not during raw ingestion.

Future stages:
- Stage 1: export/transcript ingestion (now)
- Stage 2: repository/PR/issue history ingestion
- Stage 3: semantic candidate clustering
- Stage 4: current-owner/repository matching
- Stage 5: lineage graph construction
- Stage 6: orphan queue and backward re-audit
- Stage 7: continuous incremental scans

## Non-negotiable rules

- Never let conversational context be the only holder of programme state.
- Never convert persuasive chat text directly into architecture authority.
- Never overwrite historical evidence when an item is superseded.
- Generated similarity is not semantic equivalence.
- A candidate is not implemented because similarly named code exists.
- Coverage must be measurable.
- Parse failures and inaccessible sources must remain visible.
- Historical work may be wrong; preserving it does not mean adopting it.
