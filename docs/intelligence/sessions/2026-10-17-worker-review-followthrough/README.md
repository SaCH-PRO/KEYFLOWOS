# Worker review and F9 follow-through — 17 October 2026

**Status: YELLOW / FRICTION. F9 acknowledged and active; #169 and #175 require corrections; #155 has a prepared narrow admission candidate with final Windows proof still pending.** This is review evidence and a continuation record. It grants no admission, merge, worker upgrade, production effect or application completion credit.

The accepted [capability roadmap](../../handoff/ACCEPTED-CAPABILITY-ROADMAP-2026-10-17.md), phases 0–14, existing 35-packet waves and P0–P3 priorities remain in force. This session follows the [H1 review and initial dispatch](../2026-10-17-h1-review-and-continuation/README.md). Its work does not activate draft PR177 or replace the programme DAG.

## Work done

### F9 acknowledgement and historical CLI proof

[Claude ACK6240199516](https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6240199516) matches directive6240051686, main `98ee0202499ba87fa4ee13d58a2a9075016225bd`, packet `KF-META-MERGE-AUTHORITY-001` and branch `impl/kf-meta-merge-authority-001`. The worker reports an isolated worktree, 492/492 baseline tests and reproduction of 12 unsafe matrix accepts plus the original gate result. Those are worker-reported results. The ACK is not an implementation return or independent PASS.

Root reviewed the writer/consumer map and scoped plan. Its shared grant predicate, target binding, two complete snapshots, independent semantic evidence, acyclic external artifact grant and gate without workflow self-dependency align with the released F9 contract. The necessary read-only `issues: read` workflow permission is within the existing gate-consumer correction. [Receipt6240437264](https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6240437264) records that interpretation and preserves the assignment. The receipt is PROGRESS, not a new DIRECTIVE or REVIEW.

The ACK truthfully reported that the packaged CLI runner did not run on Windows: a bare drive-letter path was passed to `--import`. Root added [a separate portable runner](proof/run-f9-cli-probe-portable.mjs), using the file URL and retaining only the runtime environment needed to locate Git. The original frozen runner, fixture, source manifest and source remain unchanged.

Root ran both versions on Node20.18.1/Linux against the pinned main. Both produced the same 14 mocked GETs, two PR snapshots and one mocked PUT, without reading #80. Global fetch was fully replaced; no request was forwarded and no remote merge occurred. This demonstrates the historical unsafe path, not a successful repair. [Results and request traces](proof/f9-cli-results.json) retain the exact evidence. The separate [runner peer review](proof/f9-runner-peer-review.md) verified the unchanged 12 source hashes and result equivalence. It is a ChatGPT peer check, not independent cross-model admission. **Windows execution remains NOT_RUN.** F9's own actual-CLI before/after and regression proof remain owed.

### Independent reviews of worker reliability

Root completed and fetched back two exact-head GitHub reviews:

| PR and head | Review | New substantive finding | Proof boundary |
| --- | --- | --- | --- |
| #169, `7aa3c1910075a02287b0815867026a500187594f` | [5559896104 — CHANGES_REQUIRED](https://github.com/SaCH-PRO/KEYFLOWOS/pull/169#pullrequestreview-5559896104) | P2: an eight-digit hash tag plus shared prefix can identify two distinct directives as the same retained worktree. Repository registration does not establish full directive ownership. | The collision was calculated locally; the routing consequence was traced through exact source. No local Windows worker tick. |
| #175, `09d00c3e03af1d31b2e4df93aaa4cf062718f4ec` | [5559896456 — CHANGES_REQUIRED](https://github.com/SaCH-PRO/KEYFLOWOS/pull/175#pullrequestreview-5559896456) | P2: mutex acquisition failure or timeout still enters stale-lock read/delete/create, permitting two starters to claim ownership. | Concrete source interleaving; no local Windows contention reproduction or installed-worker failure claimed. |

Both are GitHub COMMENT events carrying the substantive verdict, because the connected account owns the PR. They are independent ChatGPT reviews of Claude's implementation, not #80 execution authority. The [full review](reviews/pr169-pr175-review.md), [source/proof manifest](reviews/source-proof-manifest.json), [deterministic collision](reviews/collision-fixture.json) and [fetched publication records](reviews/posted-worker-reviews.json) retain details.

Actual hosted logs were inspected: #169 Windows 510 passed / 0 failed / 1 skipped with 188/188 live negative controls; #175 Windows 526 / 0 / 1 with 204/204 live controls. Each Ubuntu run was 477 / 0 / 1. The authenticated-gh cursor test is the named skip. Current-head Copilot reviews are NOT_RUN because of quota. These original green runs do not exercise the newly identified failure paths.

The #169 correction must bind retained shortened trees to the complete directive ID or digest and prove the supplied collision while preserving same-ID retry after longest-path changes. #175 must refuse unsafe acquisition when the mutex is unavailable and prove failure/timeout behavior while preserving normal concurrent start and stale-owner recovery. The latter remains stacked on #169. Integration, merge, controlled worker upgrade and post-upgrade verification are still separate obligations.

### Source requirements and continuation routing

The three supplied source documents were compared with the accepted programme and existing contracts. [Coverage evidence](reviews/continuity-coverage.md) found no missing capability phase or parallel product/research track. Recursive macro/micro tracing, backward re-audit, simplification and evidence-based correction remain continuing methods, including after phase 0.

Two obligations were made explicit:

1. Historical START-HERE/CURRENT/rollover records do not yet lead reliably to the October17 plan. A dated navigation addition preserves their historical contents. Broader continuity ownership remains with #157 and #173; no state/DAG/forensic rewrite is performed.
2. V3 paragraph32 requires tangible value within the first 60 seconds of onboarding. Outcome-first onboarding survives in the Experience contract, but this numeric measure has no located current disposition. Existing J1 / `KF-EXEC-EXPERIENCE-001` ownership must retain, revise or disposition it with a defined first outcome and timing boundary. This records a traceability obligation; it does not silently add a release gate or mandate the old provider sequence.

## Current snapshot

The post-receipt snapshot contains **1,445 comments**, ending at6240437264 on 17 October at20:22:42 UTC. It combines the earlier complete 1,436-comment observation with an overlapping updated-since REST tail; the new total matches the issue count. The [source/snapshot manifest](control/source-and-snapshot-manifest.json), [repository truth](control/repository-truth.json) and [unchanged-module replay](control/authority-replay-result.json) preserve this observation.

All 31 effects after checkpoint generation87 apply. The result is **118/118, CONSISTENT**, with no active holds, no merge authority and F9 still selected. The ACK is present. An empty selector cursor establishes assignment eligibility only; no installed cursor, worker process or continuous liveness is observed. The old checkpoint's descriptive ACTION-hold text remains historical and is not a current hold.

| Track | Current evidence | Remaining gate |
| --- | --- | --- |
| Main / application | Main `98ee0202`; application `KF-EXEC-AUTH-FAIL-CLOSED-001`, FIXING_PROOF_FAILURES / YELLOW; five checkpoints | Bounded application admission, integration and later packet/journey/kernel proof |
| F9 / P0 control safety | ACK and scoped plan received; remote branch absent in the latest inspected ref read | Implementation, full proof, pushed draft PR and RETURN, independent exact-head review |
| #155 / P0 parsed-command repair | Semantic `fe791816`; artifact `b30acfa7`; narrow semantic PASS; CI/CD successful | Final Windows worker proof, explicit proof-limit disposition, separate admission record and resulting new-head checks |
| #169 → #175 / P1 worker reliability | Both independently reviewed; one P2 correction each | Revised-head proof/review, integration in dependency order, controlled upgrade |
| #179 / H1 visibility | Seven CHANGES_REQUIRED groups from prior session | Corrections remain queued with H1 owner; no competing assignment |
| Continuity / PR convergence | Current evidence retained in draft #180; existing #173 route can point to it | Scoped pointer integration; inherited #157/#180 divergence and freeze obligations remain open |
| Actual product | K12, EXTFX, TENANT, AUTH and first ACTION slice checkpointed | Thirty packets uncheckpointed; no whole-product percentage inferred |

### #155 proof closeout and security disposition

The completed CI/CD run at `b30acfa7` executed **4,428 server tests in451 files, 210 web tests in22 files, and16 K12 evaluator self-tests**. K12 reports SATISFIED_AT_DECLARED_SCOPE; its checkout tree matches the artifact tree. Builds, typechecks and lint ratchets passed. The Windows worker proof is still running in the saved closeout; the prior equivalent job took approximately35 minutes, so elapsed time alone is not a failure. No new total is inferred before the actual log completes.

The [closeout preparation](control/pr155-closeout.md) and [evidence/disposition bundle](control/pr155-closeout-evidence.json) retain the actual identities, control-only lineage, review failover, check results and conditional candidate. Root's disposition is to preserve the following inherited gaps, without making unrelated scanner/dependency cleanup a new blanket prerequisite to this narrow parsed-command change:

- Dependency audit property **FAILED**: the successful Security Scan job contains audit exit1 and260 reported advisories—12 critical,107 high,118 moderate,23 low. These are scanner counts, not verified exploitable-path counts.
- Intended TruffleHog coverage **NOT_RUN**: base `main` could not be resolved; zero chunks and zero bytes were scanned. Separate GitGuardian success is not execution of TruffleHog.
- Dynamic security **NOT_RUN**: HawkScan's absent-key guard skipped the actual scan.
- The hosted authenticated-gh cursor test remains a named **skip**, not executed proof.

Existing remediation homes are draft [#114, KF-META-PROOF-INTEGRITY-001](https://github.com/SaCH-PRO/KEYFLOWOS/pull/114) and [#115, KF-META-NATIVE-DAST-001](https://github.com/SaCH-PRO/KEYFLOWOS/issues/115). Main deliberately treats these diagnostics as soft/dormant; production/security qualification still requires the missing properties. This is a scope disposition, not a waiver or a security PASS.

The admission candidate remains unposted and has no authority. Both actual artifact flags are false; the PR stays draft/PENDING_CHATGPT_REVIEW. A typed REVIEW, even with another recipient or NO_STATE_CHANGE, can displace F9 in the current selector. Preparation is complete as far as current evidence permits; publish any actual decision only at a safe handoff and then validate the real resulting artifact head. A future artifact SHA and its workflow results are not invented.

### Existing Flow and Cortex follow-ons

The [Flow correction-readiness record](reviews/flow-correction-readiness.md) reuses the completed P0 review against unchanged main and verifies its source hashes. No separate released Flow repair or Flow-fix RETURN was found. The existing repair homes are the autonomy policy resolver and its fail-closed tests, and the Flow ingress/server-derived authority/CRM actor path. The Cortex executor's nested `BatchResult.results[].result` contract is a separate consumer correction. All remain explicit in #155's outside-scope findings; #155's narrow semantic PASS does not close them.

The smallest characterized next policy correction is to retain a restricted/degraded result when the authoritative policy read fails, even if legacy policy is permissive, while preserving legitimate legacy behavior after confirmed primary absence. Its prepared proof includes the selective-failure case and protected read-modify-write behavior. The role-envelope/actor and executor-result changes require their own bounded proof. This record creates no release or competing worker. #146 is Mission Control/Atlas and #172 is worker observability; neither is assigned Flow security work.

## Plan forward

1. Continue F9 under CG-DIR-F9-001. On RETURN, re-resolve main, exact semantic/artifact heads, full grant/hold evidence and executed tests. Independently review actual collector, predicate, recheck and gate paths, including valid controls and all denial cases. Retain the non-atomic comment/merge race and shared-account attestation limit.
2. Finish #155's exact-artifact Windows closeout. At a safe worker handoff, record the narrow admission decision with retained security/skip limits; validate the real control-only artifact and new-head checks. Ready/merge remain distinct decisions.
3. At the next applicable P0 handoff, scope the existing policy-resolver correction from the prepared Flow record; retain the separate role/actor and Cortex-result obligations. Correct #169, then its dependent #175 under P1; retain the Windows-specific fault proofs and separately controlled installation. H1's seven corrections remain queued under the visibility owner.
4. Integrate the minimal continuity route through existing #173 ownership. Preserve #157's freeze/base-aware-gate dependency and the measured #180 divergence; no mass retarget, rebase or weakened threshold is implied.
5. Continue the accepted capability phases and wave dependencies, with integrated KEY and business journeys as foundations stabilize. Carry the onboarding target into the existing Experience scope. Operational/security gaps remain visible through final qualification.

**Scope ledger:** resolved here—F9 ACK receipt, historical runner portability correction with Linux proof, two worker reviews, source coverage check and concrete continuation route preparation. Remaining—implementation corrections, final checks/admission/integration, product acceptance and operational qualification. Deferred—local Windows reproductions because no Windows runtime is available; hosted logs are used only for what they actually executed. Dropped—nothing. Superseded—earlier “no F9 ACK yet” observations by this dated ACK, and the old #169 retry-name issue by its already present correction; neither supersession closes the new findings.

Full completion still requires the declared **35-packet, 26-journey and12-kernel** acceptance plus cross-system, adversarial, functional and operational proof, final-main verification and durable handoff. Development-system review progress is recorded separately from application completion. The existing quiet two-hour continuation remains the single continuation mechanism; no duplicate watcher was created.

## Reproduction and evidence boundary

The original authority replay wrapper in the preceding H1 session accepts this session's `--manifest`, `--repo-truth-file`, the separately retained full `--comments-file`, and a clean `--repo-root` at the pinned main. It verifies source Git blobs and normalized snapshot hashes before replay. No checkpoint or runtime source is changed.

The portable F9 runner accepts `--checkout` and a distinct `--out`. It intentionally reproduces one unsafe mocked merge at the historical source; it must not be described as a passing safety invariant on a later F9 implementation. All review records and check observations are tied to the exact revisions and dates stated here. This documentation is draft evidence until separately reviewed/integrated.
