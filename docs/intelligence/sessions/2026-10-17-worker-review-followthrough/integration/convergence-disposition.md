# October 17 evidence and continuity integration disposition

**Recommendation: extend existing PR #173's pointer, then review its revised head for integration into main.** The minimum incremental change is one existing PR-owned file: `docs/intelligence/CANONICAL-SOURCE.md`. PR #173 already changes `CLAUDE.md` to route startup there. Do not create another START-HERE owner or import the inherited intelligence tree to make the new evidence discoverable.

This read-only recommendation is complete; integration remains pending. No branch, authority, workflow, PR, or remote file was changed.

## Evidence and existing owners

| Concern | Existing owner and exact revision | Disposition |
|---|---|---|
| Startup from main to intelligence | [PR #173](https://github.com/SaCH-PRO/KEYFLOWOS/pull/173), `842aa4acfd110c9595bb7229c4788dcb6394d771` | Draft, unmerged. Current-main base `98ee0202`; one commit, five changed files. The unchanged 25/50 divergence checker passes. |
| START-HERE/CURRENT/HANDOFF/ROLLOVER repair | [PR #157](https://github.com/SaCH-PRO/KEYFLOWOS/pull/157), `5d64ecdb46b1a9e8b22a9db5c33e318f99f9c120` | Existing continuity scope. Its [last human-authored PR comment](https://github.com/SaCH-PRO/KEYFLOWOS/pull/157#issuecomment-6025536547) records a freeze pending branch-governance reconciliation; no explicit lifting was found in inspected comments. |
| Branch roles/base-aware comparison | [PR #107](https://github.com/SaCH-PRO/KEYFLOWOS/pull/107), `367fe7433b4e685c5e4c03c1e4c48b17e897663a` | Still draft and conflicted. The recorded intended route is a fresh current-main extraction through this existing concern, not wholesale integration of its stale branch. |
| Open-PR convergence | [PR #150](https://github.com/SaCH-PRO/KEYFLOWOS/pull/150), `f630f13f38dfc54c5d09dd132ded23938bd55477` | Existing disposition board; its source explicitly identifies #157 continuity and #107 branch-role reuse. No competing board is needed. |
| October 17 roadmap and proof | [PR #180](https://github.com/SaCH-PRO/KEYFLOWOS/pull/180), measured at `e8905778afb58ddb52bc9b5e857bc6daae0657ae` | Existing evidence owner. Preserve records and exact source hashes; pointer integration is independent of its inherited branch integration. |

“Owner” here means the established PR/concern lineage, not a claim that a particular worker is currently assigned or running.

## Exact divergence and policy

Main's [branch policy](https://github.com/SaCH-PRO/KEYFLOWOS/blob/98ee0202499ba87fa4ee13d58a2a9075016225bd/docs/branch-hygiene-policy.md) retains main as integration branch, one scope per PR, and 25-commit/50-file defaults. Its push workflow compares with main. No matching override exists for these intelligence branches.

- **PR #180 latest measured head:** [run39065514689](https://github.com/SaCH-PRO/KEYFLOWOS/actions/runs/39065514689), job117492255056, actually reports **143 commits unique to main / 707 unique to e8905778 / 736 files**. The earlier 143/706/728 run belongs to the preceding head.
- **PR #180's own delta:** GitHub's exact foundation-to-head comparison is **3 ahead / 0 behind / 73 added documentation files**. Foundation `f406d15c12d56e3758b517161f8e7c2ddc30424a` already has 704 commits unique to it and 143 unique to main. Base-aware comparison alone cannot admit this 73-file change under 50.
- **PR #157 against current foundation:** the unchanged local checker reports **30 commits unique to #157 / 1 unique to foundation / 13 endpoint-diff files**, failing the commit threshold. Its PR delta against the older fork snapshot has 12 files; do not confuse that with the current-foundation comparison. Resolving #107 alone would not remove #157's own commit debt.
- **PR #173 at842aa4ac against main98ee:** the unchanged local checker reports **1 ahead / 0 behind / 5 files**, with no exceeded threshold.

The proposed pointer solves discoverability. It does not mark #180 or #157 integrated or green.

## Prepared full pointer and minimum paths

The complete candidate is `prepared/CANONICAL-SOURCE.md`, derived from the original file retained at `original/CANONICAL-SOURCE.md`.

Original provenance:

- Commit: `842aa4acfd110c9595bb7229c4788dcb6394d771`.
- Root tree: `930764ec7e1d05201c9263003cd4b66b224f809f`.
- File blob: `5f3b072e0c21d90f5130ac9b079755e59d70e34c`.
- Repository path: `docs/intelligence/CANONICAL-SOURCE.md`.

Before publishing, root must replace:

- `__PR180_FULL_SHA__`: the forthcoming verified full 40-hex PR #180 head that contains all linked records.
- `__FOLLOWTHROUGH_SESSION_PATH__`: the repository-relative path **to the current followthrough session README.md**, including `docs/intelligence/sessions/...`; no leading slash.

The candidate adds pinned routes to that followthrough, the accepted roadmap, and the P0/H1 records. It points START-HERE at the existing #157 revision with explicit stale-state qualifications. It retains implementation/#80/live-fold precedence, no draft activation or merge grant, #157's freeze/#107 dependency, and both branches' measured debt. The old H1 snapshot's lack of an ACK remains a dated fact; later evidence is routed through the new followthrough instead of rewriting history.

**Minimum incremental path:** `docs/intelligence/CANONICAL-SOURCE.md` only. **Existing #173 PR scope remains five paths:** that pointer, `CLAUDE.md`, `.agent-control/README.md`, the DAG header comment, and the TIME-001 preparation document. This is an additive commit on the existing owner branch, not a new PR or reassignment. The prepared file is not yet published.

## Safe sequence

1. Complete and verify the forthcoming PR #180 evidence head; resolve both placeholders and verify every pinned destination.
2. Revalidate PR #173's live head against842aa4ac, then publish one ordinary additive commit updating only its pointer. Retain draft status and all execution-authority boundaries.
3. Independently review the revised #173 head, including the existing instruction-file change and five-file scope; run applicable exact-head checks and the unchanged divergence check.
4. Integrate in a controlled admission window. A main update changes the base beneath open implementation PRs, so do not silently carry their old-base admission evidence across it.
5. Read back the merged pointer and destinations from main. Record that retrieval/continuity routing is integrated while #157/#180's broader integration debt remains open under existing owners.

If main must later hold the complete new evidence, the finite alternative is **owner-approved path extraction**, preserving exact blobs and provenance, not retargeting #180: P0 session46 files first; after it merges, roadmap/H1 tranche27 files from that new main. Their exact paths and blob IDs are in the manifest. H1's `control/replay-publication.mjs:7` imports the P0 replay runner, so the 27-file tranche depends on the46-file one. No such extraction, new PR, archive, or assignment is performed here.

## Verification boundary

Read live PR metadata and exact PR diffs, #157/#173 comments, policy/workflow/override source, source routing documents, the latest #180 divergence job, and local graph comparisons. The 73-file inventory is an exact GitHub PR-file list, not the compare API's truncated 300-file main comparison. Executed only the existing read-only divergence checker for #173/main and #157/current-foundation; no application or proof suite, install, branch mutation, policy edit or authority post was performed.

