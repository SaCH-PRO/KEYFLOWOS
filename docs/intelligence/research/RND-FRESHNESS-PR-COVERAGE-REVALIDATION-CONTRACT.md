# R&D Freshness, PR Coverage and Revalidation Contract

Status: ACTIVE R&D PROCESS CORRECTION / RESEARCH_ONLY UNTIL PROMOTED
Date: 2026-10-06
Observed main at correction: ac3a6384417093f198bcc7d672b0dbc295db137c
Historical forensic baseline: 8f173bfe79f1418159cf4099ea18b0d60d203ec2

## Problem

The R&D method correctly requires repository pressure testing, but earlier passes could cite a historical forensic baseline, canonical intelligence branch, generated maps, selected live-main searches and individual PRs without proving that every relevant merged PR and every current/open proposal had been included in the research input set.

That is insufficient for claims such as "whole-codebase pressure tested".

At this correction point, main is 117 commits ahead of the historical forensic baseline. The current main head is the merge of PR #147. Recent merged production/control changes include, among others, PRs #120, #104, #103, #100, #96, #92, #89, #87, #85, #84, #83, #81, #79, #76 and #74. Earlier product/KEY history remains relevant where its code survives current main.

Open PRs are proposals, not current production truth, but must be included when they materially intersect the research topic because they can reveal imminent architecture, collisions, supersession or duplicate ownership.

## Corrected source model

Every repo-pressure-tested R&D pass must pin a ResearchInputSet:

- main_sha: exact current main at pass start;
- merged_pr_cutoff: all PRs merged into the lineage reachable from that main;
- relevant_merged_prs: PRs whose surviving/current effects intersect the topic;
- relevant_open_prs: proposals intersecting the topic;
- active_authority: newest valid issue #80 authority relevant to implementation;
- generated_artifacts: revision and freshness of architecture maps/registries;
- intelligence_revision: exact research/intelligence branch SHA;
- historical_baseline: optional forensic comparison only;
- runtime_evidence_revision: when available;
- exclusions: explicit, with reason.

## Freshness laws

FR-1 Current main is implementation truth. A historical baseline may explain evolution but cannot stand in for current code.

FR-2 Merged PR history is evidence of intent and change, not a substitute for inspecting surviving code on current main.

FR-3 A current-main file may have been changed by many PRs. R&D must evaluate the current manifestation and use PR history to understand why it has that shape.

FR-4 Open PRs are proposal-space. They cannot be described as implemented, but relevant ones must be collision/duplication/trajectory checked.

FR-5 Generated architecture artifacts must carry or be checked against a revision. If stale, the pass must either regenerate through the admitted owner or mark conclusions that depend on them as DEGRADED.

FR-6 A research artifact is not "repo pressure tested" without an exact main SHA.

FR-7 A pass becomes STALE when main advances in a way that intersects its observed files/owners/invariants, or when a relevant PR merges/closes/supersedes the assumptions.

FR-8 Staleness does not automatically invalidate a general scientific law. It invalidates or downgrades repository-specific conclusions until revalidated.

FR-9 Research-to-production promotion requires a final delta revalidation against current main immediately before packet derivation.

FR-10 After merge, findings whose target topology/state changed must be backward re-audited.

## PR coverage protocol

For each research topic:

1. Resolve exact current main.
2. Enumerate merged PRs reachable/relevant to the current implementation.
3. Inspect current code first.
4. Trace relevant code/history back through merged PRs where intent/evolution matters.
5. Enumerate all open PRs and classify intersections:
   - SAME_OWNER
   - SAME_WRITE_SET
   - SAME_INVARIANT
   - SUPERSEDING
   - SUPERSEDED
   - PARALLEL_COMPATIBLE
   - RESEARCH_ONLY
   - UNRELATED.
6. Check issue #80 for current execution authority.
7. Check architecture maps/registries for revision drift.
8. Re-run repository pressure test.
9. Record delta from previous R&D conclusion:
   - CONFIRMED
   - STRENGTHENED
   - WEAKENED
   - CHANGED
   - INVALIDATED
   - NEW_GAP.
10. Only then derive production recommendations.

## Continuous invalidation trigger

R&D artifacts should carry a dependency footprint:
- files;
- modules;
- semantic owners;
- schemas/models;
- capabilities;
- invariants;
- relevant PRs.

When main changes, compare changed paths/owners against footprints.

If no intersection: artifact remains current subject to age/runtime evidence.
If intersection: mark REVALIDATION_REQUIRED and rerun the repo-specific portion.
If authority/security/payment/deletion/tenant/effect semantics change: mandatory revalidation even if path matching misses the semantic relationship.

## Correction to current speed + structure research

The scientific/cross-domain principles remain candidate laws.

The repository-specific claims from INFORMATION-VELOCITY and STRUCTURE-FUNCTION-STORAGE passes must now be considered:

REPO_PRESSURE_TESTED_AT_MAIN_ac3a638

with explicit proposal-space awareness of current open PRs, not universally future-proof.

Before implementation packet derivation:
- re-resolve main;
- include any PR merged after ac3a638;
- re-check all relevant open PRs;
- refresh stale generated maps or mark degraded;
- rerun microscopic traces.

## Required rerun scope

Rerun combined Speed + Determinization + Structure/Function/Storage against:

1. current main surviving code;
2. every merged PR whose surviving changes affect KEY cognition, Flow, authority/action boundary, memory/context, Business Genome, connectors, assurance, architecture/control plane, data/storage, tenant/effects;
3. every relevant open PR, especially current memory/context, Atlas, assurance, learning, procedural, native-capacity, control-plane and convergence stacks;
4. current architecture graph/dependency/ownership/event/capability projections with freshness stated;
5. issue #80 typed authority;
6. current Prisma schema/migrations and runtime execution paths.

## No-fake-green rule

Do not say:
- "all merged PRs were covered" merely because current main contains them;
- "whole codebase tested" from code search samples;
- "architecture map current" without revision proof;
- "implemented" for an open PR;
- "research invalid" merely because main advanced.

State exactly what was inspected and at which revision.
