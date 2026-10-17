# Correction candidates, admission preparation and current authority

**YELLOW / FRICTION — bounded preparation completed; F9 remains in correction/proof. No packet admission, merge or application checkpoint is claimed.** This continues the [accepted capability roadmap](../../handoff/ACCEPTED-CAPABILITY-ROADMAP-2026-10-17.md) and the [previous F9 review/proof closeout](../2026-10-17-f9-review-and-proof-closeout/README.md). Capability phases 0–14, the application DAG, original ownership and the full completion contract are unchanged.

## Work done

### F9: a reviewed, executable correction candidate

The [three-file candidate](f9/correction.patch) addresses the two findings in [PR181 review 5560243413](https://github.com/SaCH-PRO/KEYFLOWOS/pull/181#pullrequestreview-5560243413), against artifact `ff49859e70cee65e31c09277b05aca4144ff77ea`:

- An existing target hold is cleared only by an effect-valid `RESUME / HOLD_CLEAR`. Envelope validity alone cannot release it. Missing, mismatched or unknown effects and invalid health/safety values leave the hold active.
- Large synthetic GitHub scenarios use a temporary file instead of one oversized environment value; child launch errors are surfaced. The inline fixture remains supported, and pagination, later-page revocation, valid grants and both merge snapshots remain exercised.

| Executed local comparison | Result |
| --- | --- |
| Original three focused suites | 77 tests: 76 passed, one pagination launch failure, zero skips |
| New CLI requirements and file transport against original runtime source | 17 tests: 12 passed, five substantive unsafe-merge failures, zero skips |
| Candidate three focused suites | **84/84 passed, zero skips** |

Each of the five new safety failures observes one synthetic merge PUT where zero is required. The candidate prevents those calls; valid release and unrelated-packet controls still succeed. An independent reviewer verified 39 source blobs and the recorded test identities, executed nine additional ordering/provenance controls, and proved the retained inline CLI path performs two snapshots and one synthetic SHA-pinned PUT.

See [F9 reproduction and limits](f9/README.md), [proof summary](f9/proof-summary.json) and [independent review](f9/independent-review.md). All calls are synthetic. This Node24/Linux result is not hosted Node20, Windows, the full mutation manifest or revised-PR proof. The candidate is assistance for the existing owner; it is not applied to the active implementation branch by this publication.

### Flow: the product policy defect now has a minimal correction and discriminating proof

The [two-file Flow patch](flow/flow-policy-candidate.patch) changes the existing resolver condition so a successful legacy read cannot erase uncertainty after the authoritative typed-policy read failed. It thereby activates the existing protected-update refusal. No interface, schema, module or runtime dependency is added.

| Actual-service and regression proof | Original main | Candidate | Unsafe guard restored |
| --- | --- | --- | --- |
| 13-case actual-service matrix | 10 pass / three safety failures | **13/13** | Same three failures |
| Expanded existing Vitest specification | 9 pass / three safety failures | **12/12** | Same three failures |

The original unmodified specification passed 5/5, demonstrating the missing selective-failure coverage. The failing protected-write case records one synthetic `AiMemory` upsert and one success audit after a typed-policy error. The candidate records zero of each and the expected refusal. This is not a demonstrated write to the typed policy table or production data.

Root independently read the correction, resolver/update path and harness, then replayed the actual-service matrix into a separate result directory and reproduced all three before/after/mutation outcomes. See [Flow proof and scope](flow/README.md), [compact results](flow/results/compact-proof.json) and [independent review](flow/independent-review.md).

The reviewed source is main `98ee0202499ba87fa4ee13d58a2a9075016225bd`. The existing P0/AUTH owner must adopt it against then-current source and obtain the required hosted and integrated proof. Flow role-envelope/real CRM actor propagation, caller mode overrides, request-wide authority, supervised cross-field policy and Cortex `BatchResult.results[].result` consumers remain separate obligations. None is silently closed by this narrow patch.

### #155: concrete admission record prepared and independently checked

The [unbound admission package](pr155/README.md) contains the two-control-file proposal, a draft later review, a local binding helper and exact-target validations. It preserves semantic `fe791816`, parent `b30acfa7`, base `98ee0202`, draft state, false merge flags, zero programme credit and the already-consumed RETURN `6112455909`. It does not request another worker RETURN.

The preparation passed **25/25 focused validator cases** and the unchanged **50/50 return-evidence/semantic-review tests**, all without skips. A second reviewer independently confirmed current target/lineage/review facts and passed nine additional binding, provenance and future-proof checks. The actual current semantic-only review fails the binding CLI before creating output. The positive binding control is explicitly synthetic and exists only in memory.

Completed b30acfa7 results remain historical; every new artifact gate remains PENDING. [Receipt 6240756683](https://github.com/SaCH-PRO/KEYFLOWOS/pull/155#issuecomment-6240756683) records Windows 515/516 with zero failures and one named skip, 193/193 LIVE controls; Ubuntu 491/492 with zero failures and one named skip; server 4428/4428; web 210/210; K12 self-test 16/16 at its declared scope.

The remaining gate to recording admission is a safe authority handoff and current evidence readback. No new bounded-code defect is asserted. A typed #80 REVIEW now would replace the active F9 selector even with recipient ChatGPT and NO_STATE_CHANGE, so the concrete record stays unbound. Ready/merge remain separate, and the pre-F9 evaluator's inability to enforce false merge flags independently is disclosed. The real PR remains draft.

### Authority: fresh full history replay completed

The [fresh authority observation](authority/README.md) collected all **1,461 comments** over 15 REST pages, matched before/after counts and found no intervening updated-since overlap. Unchanged current-main and published replay methods agree: **CONSISTENT, generation 118/118, 31 applied effects, zero findings**. Twenty-three current source files and two method files were Git-blob verified before and after execution.

This was a frozen connector-supplied equivalent of the truth/status calculation, not a literal live `status.mjs --verify` invocation. It does not probe worker liveness. Raw comment input remains separate and is required to reproduce that exact frozen fold; curated summaries alone cannot reconstruct it.

The [later bounded readback](readback/readback.json), observed through 22:16:49 UTC, sees three additional #80 records: AUTO_EVENT `6242013757`, MOMENTUM `6242027082` and AUTO_EVENT `6242044042`. None is new typed authority or a RETURN. The full replay is still correctly labelled 1,461, not silently relabelled 1,464.

## Current snapshot

| Area | Verified state at the dated observation | Remaining gate |
| --- | --- | --- |
| Main | `98ee0202499ba87fa4ee13d58a2a9075016225bd` | No main integration in this work |
| F9 / PR181 | Draft, open, unmerged; public artifact `ff49859e`; review CHANGES_REQUIRED; no RETURN | Revised published source, actual-head required proof and independent disposition |
| F9 worker momentum | [6242027082](https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6242027082) reports local `b0377a4c` for file transport/launch errors and a planned artifact-target repair | This local commit was not independently fetched; public head was still ff49859e; P1 HOLD release was not discussed |
| F9 Windows proof | **554 total: 553 passed, zero failed, one authenticated-gh cursor skip. 208/209 controls LIVE; one VACUOUS; job failed.** | Restore actual coverage for `NC-RETURN-ARTIFACT-PASS-PROSE`; retain the unchanged requirement |
| #155 | Draft, semantic PASS, current artifact b30acfa7 proof recorded; admission package reviewed locally | Safe handoff, real later review binding, control-only record, new-head checks, separate integration |
| Flow product safety | Main still contains the defect; reviewed candidate and discriminating local proof prepared | Existing-owner adoption and complete applicable proof/integration |
| Application projection | KF-EXEC-AUTH-FAIL-CLOSED-001 / FIXING_PROOF_FAILURES / YELLOW; zero active holds; merge authority false | Five checkpointed packets, one active, 29 waiting |
| Successor platform | File status INACTIVE_SUCCESSOR; evaluator HELD on the existing malformed historical PLAN | No activation or extra application credit; this is not a new application hold |

[Final Windows evidence](readback/windows-proof-summary.json) verifies the exact checkout, Node20.18.1 and all 209 manifest IDs appearing once. The failing control could not find its mutation target in the artifact. Ubuntu Worker Proof and Autopilot self-test at ff49859e each remain 528 passed, one failed and one skipped of 530. CI/CD passed. A green CI job is not equivalent to every required proof property passing.

The #155 dependency audit remains FAILED with 260 reported advisories, not a count of verified exploitable paths. Intended TruffleHog coverage and HawkScan remain NOT_RUN, and authenticated-gh cursor proof remains skipped. Existing #114/#115 remediation owns those gaps; no production-security pass or blanket new prerequisite for narrow admission is inferred.

## Plan forward and phases

### Immediate sequence

1. **Close F9 under its existing owner.** Reconcile the owner's revised source with the reviewed HOLD-release correction, file transport and non-vacuous artifact control. Inspect the actual new PR head, all required proof and a real RETURN; provide independent disposition without a competing worker assignment.
2. **Record #155 admission at the safe handoff.** Refresh main/head/base, lineage, reviews and workflow evidence. Bind the actual later immutable review into only the two control files, publish from the unchanged parent with a leased update, and inspect the resulting artifact's own checks. Preserve the consumed RETURN and draft boundary.
3. **Advance the retained P0 product corrections.** Adopt the Flow resolver correction through the existing owner, then address the separately scoped Flow authority/actor and Cortex result-consumer findings with their actual call-path proof.
4. **Close P1 engineering reliability and convergence.** Retain #169 full directive ownership before dependent #175 mutex-failure containment; #172's two health/base-prediction findings; H1/#179's seven groups; #173 independent current-head review/integration; #146 RETURN/Atlas/scanner obligations; and #177 independent re-review while inactive. Existing #180/#150 convergence, #157 freeze and #107 concern remain explicit.
5. **Prove integrated product value as foundations stabilize.** Continue the existing packet DAG and TIME-001 release process. P2 retains one verified KEY UI→context→reasoning→permission→effect→evidence→learning flow and the controlled lead→contact→booking→invoice→simulated payment→ledger→follow-up journey. Preserve the first-value-within-60-seconds J1/EXPERIENCE target for acceptance.
6. **Complete P3 operational qualification and final reassessment.** Revalidate earlier packets after later changes; complete the 26 journeys, 12 kernels, integrated, adversarial, migration, security, browser/voice and operational evidence, then final-main validation and durable handoff.

### Stable roadmap and two scoreboards

The capability phases remain **0 forensics; 1 control plane; 2 PR value/unlock; 3 Atlas; 4 Mission Control; 5 multi-agent development; 6 Action Boundary; 7 Context Genome/Memory; 8 cognitive core; 9 Connector Fabric; 10 core product; 11 Business Genome; 12 autonomous business operations; 13 hardening; 14 production-ready v1**. These are capability milestones, not a second execution DAG or new completion percentages.

| Application wave | Packets | Retained scope |
| --- | --- | --- |
| 0 | 2 | Proof and first external-effect slice |
| A | 3 | Tenant, authority and action foundations |
| B | 7 | Time, ingress, connector, durable execution, recovery, conversation and Playbook foundation |
| C | 7 | Commercial, booking, finance, delivery/billing, commerce, entitlement and Growth foundation |
| D | 10 | Knowledge, command, public, space, voice, privacy, network, UX, experience and final Playbook/Growth phases |
| E | 6 | Legacy retirement, migration, integrated proof, operability and release |

The DAG still has **35 packets / 37 phase nodes**. K12, EXTFX, TENANT, AUTH and the first ACTION helpdesk slice supply the five accepted checkpoints. Wave-A checkpoint count does not independently close TRUST-G1 or outstanding follow-ons. TIME-001 is a graph dependency candidate, not released by this preparation.

**Development-system scoreboard:** tested F9 candidate, current authority verification, reviewed admission preparation and retained reliability/integration queue. **Product scoreboard:** tested Flow candidate but no new merge/checkpoint; five accepted application checkpoints remain. Five of 35 is not product or effort completion percentage.

## Scope, evidence continuity and closure

**Declared:** continue the accepted plan with bounded F9 correction assistance, Flow safety preparation, #155 admission preparation, current authority evidence and durable handoff. **Resolved locally:** these candidates, focused/negative proof and independent reviews are complete. **Remaining:** owner adoption, new artifact proof, applicable authority/admission/integration, final-main verification and all retained programme obligations. **Deferred by sequence:** typed #155 admission waits for a safe F9 handoff; other owned packets retain their declared order. **Dropped:** none. **Superseded:** earlier pending-Windows status and claims that the newer local candidates are unavailable; the old missing archive itself was not recovered.

The three reattached historical DOCX sources were reread locally for intent alignment, without replacing the accepted roadmap or factual code/authority evidence. Their SHA-256 identities are `f160b354d2eb116e11cce7c1ff66a9121778e8411b56bc3ec5c1ff565bc74201` (KEYFLOW v3), `89a3d3ed7488fbd6df9cd58a7af9f72ef5510315333444cd4ce8353d5770278e` (continuity) and `12db15d528a2d910882eccba12f7851f0ed05bb5e48dd15e44e4e477de55fdf6` (reassessment). The new 13-case Flow proof, admission package and authority observation have fresh identities; they are not the lost seven-case bundle or rejected 77-file archive.

This text-only evidence tranche extends the existing draft PR180. Its parent already exceeds the branch file limit and fails divergence; publication is not integration approval or a repaired branch gate. No threshold, base branch, production system, worker process, scheduler, installed worker runtime, main checkpoint or programme map is changed. Isolated proof dependencies were installed only in the local Flow evidence directory, with package scripts disabled. The existing quiet two-hour continuation remains the sole continuation mechanism; no duplicate watcher is created.

**Completion remains the full contract in `EXECUTION_CONTROL_STANDARD.md` §16:** 35/35 packet dispositions/checkpoints plus 26/26 journey and 12/12 kernel reassessment; all applicable integrated, adversarial, operational and regression evidence; every implementation finding dispositioned; safe legacy retirement; final-main revalidation and durable handoff. This session advances the work and does not claim that contract is complete.
