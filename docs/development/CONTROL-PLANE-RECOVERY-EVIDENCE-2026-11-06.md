# KEYFLOWOS control-plane recovery: forensic evidence and pending proof

Date: 2026-11-06
Workstream: control-state recovery; ChatGPT-owned evidence only
Status: **FORENSIC FINDING CONFIRMED / CHECKPOINT CORRECTION NOT YET PROVED**
Health: **RED — autonomous advancement blocked; fail-closed behavior is correct**
Base: `main@b1948d2797e1bae3660a3d7173abb75397e05aad`
Owner: ChatGPT; no Claude or Kimi builder work is assumed
Production touched: **false**
Merge authority: **false**
Programme credit: **zero**

## 1. Why this record exists

The operator reported that Claude Code is maxed out. A previous bounded draft-only recovery request was posted to issue #80 as [CG-DIR-RECOVERY-20261106-001](https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6691596446). Because Claude cannot currently act, the directive was explicitly held with [CG-HOLD-CLAUDE-CAPACITY-20261106-001](https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6692411347). No response from the worker was observed before the hold. No other worker should write the same packet or branch.

This documentation-only branch is deliberately **outside `impl/*`**. It records a verified failure and the work remaining to build a provably correct checkpoint. It is **not** a recovery checkpoint, control authority, admitted implementation, or permission to resume automation.

## 2. Evidence and provenance

Read-only inspection used the live GitHub REST issue-comment listing with all **19 pages** (100 comments per page, 30 on the final page) and the connected repository file reader. The verified snapshot contained **1,830 comments**, of which **483** were authored by the allowlisted `SaCH-PRO` account; none of those returned an `updated_at` different from `created_at`. This establishes no observed edits in the fetched snapshot, not future immutability. There were **150 ChatGPT authority candidates** under a deterministic top-level field scan, including the existing checkpoint anchor at generation **87**; **63** followed that anchor. These counts are a static evidence scan, not a substituted execution of the canonical Node parser.

The reviewed checkpoint in [`.agent-control/programme-state.yaml`](../../.agent-control/programme-state.yaml) is anchored to:
- `CG-REVIEW-META-STATE-REDUCER-LIVE-RECOVERY-021`, comment `5993146604`
- `updated_at: 2026-10-05T11:30:00Z`
- `source_main: 110532883411007787f62de35e0a951aa1c16cfa`

The first **malformed** candidate newer than the anchor is:
- [`CG-REV-PRODUCT-CONTACTS-MERGE-READINESS-001`](https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6514446571), `6514446571` at 2026-10-30T03:45:26Z.
- [`CG-REV-PRODUCT-CONTACTS-ADMISSION-BLOCKER-002`](https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6514528789), `6514528789` at 2026-10-30T03:52:12Z.
- [`CG-REV-PRODUCT-CONTACTS-ADMISSION-HOLD-003`](https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6519793805), `6519793805` at 2026-10-30T09:46:53Z.

All three say `message_type: REVIEW`, `sender: chatgpt`, `packet_id: KF-PRODUCT-CONTACTS-PILOT-001`, `control_effect: NO_STATE_CHANGE`; all three **omit** four mandatory AUTHORITY-profile fields, `state`, `health`, `scope_changed` and `production_touched`. They are **not** valid authorization or valid typed effects. Their denial/hold intent must be preserved conservatively and separately from their invalid machine-readable format.

The [November 6 scheduled reconciliation](https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6684568951) reports `derived_action: REPORT_DRIFT` and `derived_reason: derived programme-state is not usable: AUTHORITY_MALFORMED; failing closed until it is re-derived from current authority and repository truth`. This result is correct under the documented fail-closed contract. Do not patch the parser to pretend these reviews were valid, edit historical comments, or silently skip them.

## 3. Relevant repository truth at inspection

| Item | Verified condition |
| --- | --- |
| `main` | `b1948d2797e1bae3660a3d7173abb75397e05aad`, protected |
| PR [#120](https://github.com/SaCH-PRO/KEYFLOWOS/pull/120) | Post-merge CHECKPOINT effect declared in valid comment `5998474832`; confirm final merge lineage in recovery proof |
| PR [#147](https://github.com/SaCH-PRO/KEYFLOWOS/pull/147) | **merged**; ACTION-001 application checkpoint declared in valid `6010515405` |
| PR [#155](https://github.com/SaCH-PRO/KEYFLOWOS/pull/155) | **open/draft**, `KF-EXEC-AUTH-FAIL-CLOSED-001` and `impl/kf-exec-auth-fail-closed-001`; latest semantic head `c269ad93eab99a1c0bf7773d2426d7a3da459d01` |
| PR [#181](https://github.com/SaCH-PRO/KEYFLOWOS/pull/181) | **merged**, exact merged main `b1948d2797e1bae3660a3d7173abb75397e05aad`; meta work earns zero application credit |
| PR [#190](https://github.com/SaCH-PRO/KEYFLOWOS/pull/190) | **open/draft**, Contacts visibility fix, head `4b4cda3e8a4813654ab7c63626d28535868edb6f`; no admission or merge permission |
| Application checkpoint count | Last reviewed public appraisal: **5/35**; reconstruction must prove the fifth from valid ACTION-001 CHECKPOINT `6010515405`. This is not a measure of overall product completeness |
| Historical checkpoint | Its pre-October-6 ACTION hold and active PR #120 are superseded by later valid effects and repository merges; never copy as current truth |

The meaningful typed effects after the anchor, to be replayed through the **actual** `scripts/agent-control/lib/authority-effects.mjs`, include `CHECKPOINT` for PR #120, ACTION-001 `HOLD_CLEAR`, `PACKET_RELEASE`, `PACKET_ADMISSION` and `CHECKPOINT` for PR #147, `PACKET_RELEASE` for AUTH-FAIL-CLOSED, and `PACKET_CORRECTION` for PR #155. Historical aliases `BOUNDED_CORRECTION` and `AUTHORIZE_CONTROL_BINDING` are already supported by `CONTROL_EFFECT_ALIASES`; do not extend that vocabulary here. All valid later `NO_STATE_CHANGE` effects must still be replayed with ordering and provenance.

After the first malformed October 30 review, the fold must stop; it may not jump to the subsequent valid ChatGPT directive or the capacity HOLD. This document records the obstruction, **not** a claim that a new checkpoint has passed the reducer.

## 4. Root cause and non-causes

- **Cause:** three human-authored ChatGPT REVIEW envelopes do not meet the mandatory AUTHORITY profile. `control-envelope.mjs` treats top-level fields as envelope data even inside Markdown fences. `authority-effects.mjs` blocks on a malformed candidate; `reconcile.mjs` reports authority malformed newer than the checkpoint anchor.
- **Not the cure:** weakening the parser, treating malformed REVIEWs as `NO_STATE_CHANGE`, inferring a hold/release from prose, deleting or editing #80, hand-changing the old anchor without replay, declaring a merged PR unmerged, or resuming the Claude worker while its assignment is held.
- **Separate current problems:** worker ownership, independent review quota, open security-related PRs, and incomplete product testing. A state re-anchor alone does not prove those fixed.

## 5. Safe recovery proof obligations

The next draft PR proposing `.agent-control/programme-state.yaml` must be created **only after** the following are completed:

1. Run the canonical `collectAuthority` over the complete REST-shaped issue history, preserving edit evidence, timestamp order and malformed candidates; compare counts and exact problems to this independent field scan.
2. Reproduce the current `status.mjs --verify` / `reconcileWithTruth` failure and capture full `reduction.blocked` plus all `reconciliation.findings`. Distinguish independent `PR_ALREADY_MERGED` or `SOURCE_MAIN_NOT_ON_MAIN` findings from the first authority failure.
3. Replay every valid `control_effect` after generation 87 in chronological order using the canonical reducer until the first malformed candidate. Confirm final credited packets, active PR #155, and applicable holds in the pre-failure effective state.
4. Treat the October 30 reviews as **historical malformed evidence only**. Establish a new valid append-only recovery REVIEW, explicitly authorized to replace the reviewed checkpoint anchor after an independently assessed full-state derivation. A new `NO_STATE_CHANGE` directive, by itself, does not cure older malformed authority.
5. Preserve `programme.checkpointed` truth, `holds`, `unresolved_contradictions`, `safety`, `platform_programme`, and any in-flight packet. Do not guess what old narrative fields mean. Confirm data shape against `validateState()`.
6. Prove candidate behavior via the unchanged canonical parser, reducer, reconciler and repo truth at exact current main. Include positive replay, negative controls that reinsert each malformed review, stale-authority, duplicate HOLD and invalid-state cases; execute full control tests and proof-mutation locally or CI and record exceptions transparently.
7. Commit the candidate and required `impl/*` artifacts on an **isolated draft** branch; obtain independent semantic review, exact-head CI and explicit new #80 authority before any merge. Do not auto-merge, ready PRs, start TIME-001 or treat the draft as a healed loop.

## 6. Operator continuity and status

**Done:** full paginated issue comment inventory, unique identification of three malformed October 30 authority candidates, live repo/PR inspection, Claude capacity HOLD, this documentation-only evidence branch.

**Not done:** canonical Node replay using the full GitHub snapshot (the connected GitHub reader is not a local authenticated `gh` runtime); proof of a uniquely correct full-state re-anchor; candidate programme-state commit; run of actual control-plane tests and negative controls; independent approval; merge; healed scheduled automation.

**Next legal step:** request a bounded recovery review deciding the exact interpretation/contents of a new state anchor, followed by a dedicated **draft implementation** candidate with reproducible tests. The present document provides evidence for that work but grants none of its authority. Claude quota exhaustion and Kimi availability must not be reported as completed external review.

**Scope ledger**
- Declared: inspect authority and repository truth, record malformed evidence, preserve fail-closed behavior, establish a no-collision recovery path.
- Resolved: full REST inventory; root-cause identification; PR status cross-check; Claude HOLD; doc-only evidence.
- Remaining: canonical reducer replay, full state recovery proof, independent validation, draft patch, CI, authorization, merge, post-merge check.
- Deferred: parallel product implementation until safety gating/worker ownership are verified.
- Dropped: none.
- Production touched: false.
