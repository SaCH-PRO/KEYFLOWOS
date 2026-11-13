# KEYFLOWOS — Intake-to-Outcome Traceability Checkpoint (2026-10-10)

**Owner:** existing PR #150 (open-PR convergence), with future consumers #152 (PR unlock), #163 (historical chat evidence), #165 (continuous intelligence), #148 (Context Genome), #129 (Mission Control).
**Status:** BOUNDED READ-ONLY OBSERVATION; not admission, merge or runtime proof.
**Main observed:** `7d2619c771cd008f21bae9c60ca348e3deaa07cd`.

## What is actually delivered in this PR tranche
- `scripts/intelligence/open_pr_inventory.mjs`: paginated GitHub API open-PR reader with explicit head/base SHAs and fail-closed malformed/duplicate validation. Does not edit or merge a PR.
- `scripts/intelligence/open_pr_inventory.spec.mjs`: tests for >30 PR coverage, duplicates, malformed identity, provenance and explicit unknown proof.
- `docs/development/PR-INVENTORY-OBSERVATION-2026-10-10.json`: time-bound snapshot returned by the connected GitHub interface: **39 open, 33 draft, 6 not draft**. 27 target main; 5 target the intelligence branch; 7 are other/stacked target branches. The snapshot is NOT proof of any merge readiness.

This inventory is **not** the full historical ingestion-to-runtime lineage system. It establishes one measurable missing-observation seam first. The prior #150 October 6 board is stale. Do not overwrite its historical findings; re-check before making dispositions.

## Why this improves the current approach
The current autopilot's hourly PR discovery was observed to use the first 30 PRs (see merged PR #166); this new reader uses `gh api --paginate --slurp`, not the same limited discovery. **It is read-only and not wired to the automerge workflow.** Automatically feeding all 39 into a mutating sweep would change the admission candidate set and is intentionally deferred for separate authority/proof.

## Next traceability contract — compose existing owners
The next stage should join stable links, **not** create another independent memory or approval database:

`source observation -> extracted claim or requirement -> decision/disposition -> canonical owner -> packet -> PR exact head -> merge SHA -> postmerge code reachability -> runtime/deployment proof -> observed business or developer outcome -> learning/contradiction`.

- Sources may be conversation exports, files, URLs, video/audio transcripts, open-code repositories, GitHub issue/PR evidence and permitted connected application events. Source reference is not authority.
- Each claim should have an immutable identity, source digest/revision, capture timestamp, declared epistemic status, provenance and supersession/contradiction links.
- Each *implementation obligation* requires an owner, current state, precise target, dependency, proof obligation, and closure disposition. A closed PR cannot silently close the claim.
- Represent unknown/unstudied, missing, blocked, failed and superseded separately from PROVEN; preserve historical evidence after rejection.
- Link into the existing #152 `DECLARED -> IMPLEMENTED -> PROVEN -> ADMITTED -> LIVE` unlock sequence; do not invent new admission semantics.
- Learning may propose a procedure or code change, but may not amend human authority, tests or canonical truth unreviewed.

## Specific live streams for first end-to-end audit
1. External GitHub mining: #164 -> #165 -> evidence in `mattpocock/skills` dossier -> future coded integration is **NOT PROVEN**.
2. Conversation history: #163 creates export harvester; full ChatGPT Project thread coverage is **NOT PROVEN**.
3. KEY knowledge ingestion: #134 is still an open draft; its quarantined text intake and URL registration are **NOT MAIN IMPLEMENTATION**.
4. Portable skills: #135 / #136 / #167 define research and skills contracts; production dynamic skills runtime **NOT PROVEN**.
5. Actual development effect: PR #166 was merged into main but post-deploy/worker behavior outside repository is **NOT VERIFIED BY THIS OBSERVATION**.

## Safe rollout
R0 (this tranche): enumerated, durable open-PR observation and a reproducible read-only script.
R1: independently verify the inventory script tests and pagination against actual `gh` JSON; record exact CI/head evidence.
R2: map all 39 to existing #150 dispositions and detect orphan/duplicated/stacked obligations. Review dependency/base divergence before advancing.
R3: connect #163 historical candidates + #165 source registry to #152 unlock evidence and #148 Context Genome semantics via **one read-only projection**; demand explicit NOT_FOUND / UNKNOWN results when linkage is absent.
R4: only after proof and authority, provide Mission Control visibility and bounded ingestion/automation. No automatic code merges or memory truth promotion.

## Constraints
No changes to OS.md or halted cycles, CI gates, runtime, production, deployments, worker scheduler, agent-control authority or provider traffic. No claim that every chat is ingested. No claim that 39 open PRs are merge-ready. Research and implementation remain distinct.
