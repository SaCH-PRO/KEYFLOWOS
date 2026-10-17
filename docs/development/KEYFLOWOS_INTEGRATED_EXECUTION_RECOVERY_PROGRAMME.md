# KEYFLOWOS Integrated Execution & Recovery Programme

**Status: PROPOSED — INACTIVE — NOT AUTHORIZED FOR AUTO-RELEASE**  
**Original planning baseline:** main `98ee0202499ba87fa4ee13d58a2a9075016225bd`; 47 open PRs at the original 2026-10-16 inspection, before PR #177 itself. These are historical snapshot values, not live counters.  
**Correction basis:** Claude review `CC-REVIEW-IRP177-001`, findings [6229516997](https://github.com/SaCH-PRO/KEYFLOWOS/pull/177#issuecomment-6229516997), and RETURN [6229520428](https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6229520428), against `8ecb71582bb916c9d915493de050d7925c372634`. Author corrections dated 2026-10-17 require a new independent review. No PASS is claimed.  
**Authority:** https://github.com/SaCH-PRO/KEYFLOWOS/issues/80  
**Purpose:** Integrate eight recovery/delivery workstreams with existing packet ownership, proof requirements, and governance without creating a competing control plane.

## 1. Precedence and safe boundaries

- Actual code, current PR heads and CI prove what exists. The newest **valid** typed ChatGPT authority on issue #80 determines what can occur. `node scripts/agent-control/status.mjs --verify` folds this authority over the reviewed programme checkpoint. Reading the checkpoint alone is not a fresh live-state verification.
- `docs/development/KEYFLOWOS_PROGRAMME_DAG.yaml` projects the canonical 35-packet execution board held on `docs/keyflow-intelligence-foundation`. **This document does not edit that DAG, introduce executable nodes, confer packet credit, or release work.**
- Follow `AGENTS.md`, `CLAUDE.md`, `docs/development/EXECUTION_CONTROL_STANDARD.md` and `docs/development/AGENT_CONTROL_PLANE.md`. Map before modifying; maintain complete scope ledgers; stop on contradictions; prove failures and effects, not only green CI.
- `architecture/os/OS.md` records scheduled OS cycles as HALTED. This programme does not restart them. **No production access, including read-only probes or queries**, production mutation, real provider traffic, deployment, merge or installed-worker change is authorized by this document. Repository-only evidence inspection is distinct from production access. Any later production read requires explicit operator permission naming the actor, environment, endpoints/data, purpose and scope; absent that, report NOT_ASSESSED.
- Claude Code implements bounded approved changes; ChatGPT reviews Claude-authored work and Claude reviews ChatGPT-authored work under the operator-directed cross-review rule in section 7. This routing does not amend the executable Copilot-primary/ChatGPT-fallback contract. Existing deterministic GitHub controls validate; the human operator authorizes critical merges and production. PR #176's reviewer architecture remains a proposal; section 7 records the current gate gaps rather than hiding them.
- The desired Kimi Code exclusion is recorded as a 2026-10-12 operator decision in **draft** [PR #176, sections 7–8 at c1fbf041](https://github.com/SaCH-PRO/KEYFLOWOS/blob/c1fbf041ae79fa28c479b49848c2381a10a3094a/docs/development/MULTI_AI_REVIEW_ARCHITECTURE.md#8-decisions). At the pinned main, `AGENTS.md` and the execution standard still mention Kimi Code. This is a documented policy/documentation discrepancy, not a claim that removal has been implemented or that a new #80 exclusion authority was verified here. Do not add a Kimi development/review assignment from this proposal; reconcile the existing records through their owner. Customer-selectable product model support is a separate concern.
- Historic handoffs, PR plans and outdated production reports are not live truth. Re-resolve main, issue #80 and current artifacts before any task.

### Interim F9 containment — no implied merge permission

Until the F9 correction is independently reviewed, merged and post-merge verified, **an `impl/*` PR carrying `ACCEPT_FOR_ADMISSION` must remain draft unless the human operator explicitly authorizes its exact-target merge and the merge-triggering draft transition under the existing gates**. Neither preliminary admission, a passing semantic review, a green draft check nor an artifact's `merge_authority` flag grants that exception. The current path does not independently enforce the flag, so a ready-for-review transition may trigger an automatic merge after its checks pass. No such transition or exception is authorized here. Re-check the exact head/base and post-transition checks when an explicitly authorized integration is eventually performed; do not weaken or bypass a gate.

This is an interim operating constraint, **not a new blanket dependency on PR #155's review or admission**. PR #155 remains governed by its existing authority. Its review, admission and an individually human-authorized integration need not await F9 solely because of this plan; reliance on preliminary admission as automatic merge permission is what must stop.

### ACTION-001 hold — selected integration candidate is not released

The reviewed checkpoint at pinned main records `holds.KF-EXEC-ACTION-001.active: true`, with preserved `helpdesk_create_ticket` characterization. See [.agent-control/programme-state.yaml:182–215](https://github.com/SaCH-PRO/KEYFLOWOS/blob/98ee0202499ba87fa4ee13d58a2a9075016225bd/.agent-control/programme-state.yaml#L182-L215). The hold's recorded resume condition is a valid ChatGPT `RESUME` on #80 with `packet_id: KF-EXEC-ACTION-001` and `control_effect: HOLD_CLEAR`; any subsequent implementation also needs its own bounded scope authority.

Before IRP-06 execution, re-derive effective live holds from the existing reducer. **Unless a valid clearing of this hold is established, treat it as in force:** no new ACTION-001 implementation or capability-effect exercise under this proposal, even in an isolated environment. PR #147's historical merge, a new observer task, this document, or an IRP label cannot clear the hold. Repository-only source inspection is not a release. If current evidence and the checkpoint appear inconsistent, report the discrepancy rather than selecting a convenient interpretation or changing the checkpoint.

## 2. Eight work packages: ownership, links and exit proof

Tracking IDs IRP-01 to IRP-08 are **document identifiers only**, never approved packet IDs or scheduler inputs.

| ID / priority | Work / existing owner and PRs | Blocking dependency for execution | Concrete evidence required for completion |
|---|---|---|---|
| **IRP-01 P0** | Merge authority F9; `scripts/agent-control/lib/admission.mjs` and auto-merge; design PR [#176](https://github.com/SaCH-PRO/KEYFLOWOS/pull/176) | Explicit reviewed bounded control repair; interim draft rule in section 1 applies until post-merge verification | `ACCEPT_FOR_ADMISSION` alone always fails merge eligibility; exact-head independently reviewed grant, negative controls, CI, post-merge proof |
| **IRP-02 P0** | KEY security; active-packet reference `KF-EXEC-AUTH-FAIL-CLOSED-001`, [#155](https://github.com/SaCH-PRO/KEYFLOWOS/pull/155); Cortex and shipped Flow execution owners | Re-resolve current #80 packet authority. IRP-01 is required before treating automated eligibility as separately enforced merge authority, not as a new blocker on review/admission or individually human-authorized integration | Independent exact-semantic-head review; reachable route→permission→writer graph for Cortex **and** Flow; isolated denial, exception, tenant and retry proofs |
| **IRP-03 P1** | Windows Claude worker; [#169](https://github.com/SaCH-PRO/KEYFLOWOS/pull/169) then stacked [#175](https://github.com/SaCH-PRO/KEYFLOWOS/pull/175); related #170–172 | Independently admit #169, then reconcile/review #175; separate installed-worker upgrade authorization | Every fault-class property in section 4 passes with logs and negative controls; at least 20 benign exercises supplement, never replace, no-duplicate/no-loss/recovery proof |
| **IRP-04 P1** | Continuity and startup; [#173](https://github.com/SaCH-PRO/KEYFLOWOS/pull/173) on main, [#157](https://github.com/SaCH-PRO/KEYFLOWOS/pull/157) on intelligence branch | Current authority/branch provenance verified; no direct edit of reviewed checkpoint | Cold starts recover identical authoritative coordinates and reject each stale/missing/conflicting-input class in section 4; historical handoffs never outrank current truth |
| **IRP-05 P1** | PR convergence; [#150](https://github.com/SaCH-PRO/KEYFLOWOS/pull/150), [#168](https://github.com/SaCH-PRO/KEYFLOWOS/pull/168), [#170](https://github.com/SaCH-PRO/KEYFLOWOS/pull/170) | Repository-only inventory may be characterized; PR dispositions and branch changes need scoped authority | All 47 original baseline PRs plus subsequent additions accounted for against a refreshed inventory; one justified disposition each, dependency/overlap graph and preserved unique obligations |
| **IRP-06 P2** | KEY intelligence-to-effect; shipped Flow, canonical capability/action owners; existing #147 and drafts #139, #158, #160–163, #112, #127, #148, #134 | IRP-02 safety, applicable packet/wave authority and explicitly verified ACTION-001 hold clearance before using its candidate; research not self-promoted | One wired UI→context/memory→reasoning→capability→permission→effect→evidence→governed learning flow **in an explicitly authorized isolated environment**; tenant/retry/denial tests, no production access |
| **IRP-07 P2** | Lead-to-revenue journey; canonical `KF-EXEC-TIME-001`, `KF-EXEC-COMMERCIAL-001`, `KF-EXEC-BOOKING-001`, `KF-EXEC-FINANCE-001`, `KF-EXEC-INTEGRATED-001` owners | Existing wave dependencies and holds, effect governance and approved isolated tests | Synthetic lead→contact→booking→invoice→simulated payment→ledger→follow-up, concurrent/duplicate/failed cases, no cross-tenant or double financial effects |
| **IRP-08 P3** | Readiness; `KF-EXEC-MIGRATE-001`, `KF-EXEC-INTEGRATED-001`, `KF-EXEC-OPS-001`, `KF-EXEC-RELEASE-001`; historical production/readiness docs | Repository-only review first; production reads require a named actor and explicit scoped operator authorization; clone/staging actions and actual deployment separately approved | Dated repository evidence plus separately authorized current schema/infrastructure observations and isolated restore/rollback proof; PASS/FAIL/NOT_ASSESSED dossier with actual coverage stated |

## 3. Proposed dependencies (non-executable)

```text
IRP-01 merge-safety proof ───> safe reliance on the corrected automatic merge path
Existing #155 authority ────> IRP-02 review/admission; exact human merge grant still required
IRP-03 #169 ─> #175 ─> approved installed-worker upgrade
IRP-04 continuity ──────────> reliable agent pickup (not a new authority)
IRP-05 PR inventory ────────> explicit dispositions (not mass merging)
ACTION-001 HOLD_CLEAR + bounded scope + IRP-02 safety ─> IRP-06 isolated capability proof
Relevant canonical wave/packet/hold permissions ──────> IRP-07 isolated revenue journey
IRP-06 + IRP-07 + migration/ops/release evidence ──────> IRP-08 readiness decision
Explicit scoped production-read grant ───────────────> IRP-08 production observations
```

There is **no IRP-01 → PR #155 review/admission edge**. The interim F9 rule governs merge-triggering transitions without adding a new blocker to the already authorized packet. An individually human-authorized integration still needs all applicable existing checks; this plan does not grant it.

Repository-only source/evidence characterization of IRP-01/02/03/04/05/08 may proceed concurrently within the current assignment. This means reading permitted repository artifacts and GitHub records, not probing production, reading live databases/queues/secrets, or changing a worker. These arrows are **planning constraints, not newly created executable DAG edges**. Existing dependencies, holds and newer valid #80 decisions take precedence.

### Requirements before representing any dependency in existing control mechanisms

1. Refresh exact main, issue #80 typed authority, active packet, effective holds, PR heads and the existing canonical intelligence board.
2. For each item decide whether it belongs to an **already released packet**, separately authorized meta repair, or **new proposed packet**. Never dispatch an IRP-* reference as a packet ID.
3. Supply a bounded scope charter: exact source main, existing semantic owner, files and forbidden effects, packet obligations, dependency/hold list, invariants, failure matrix, tests and stop conditions. Production reads require a separate named-actor grant; an ACTION-001 candidate requires its verified `HOLD_CLEAR` and bounded work permission.
4. If existing DAG topology genuinely must change, independently review proposed revisions to the canonical intelligence board and projected `KEYFLOWOS_PROGRAMME_DAG.yaml`. Run its dependency/wave validation and negative controls. **Do not modify topology or the `.agent-control/programme-state.yaml` checkpoint merely because this document is accepted.**
5. Obtain valid issue #80 control authority with exact packet/scope/effect before any agent task release. Use the existing worker and selector, not a new dispatcher. Do not issue a newer competing assignment that strands a task already claimed by the latest-message selector.
6. Require the actual author's RETURN, exact-head deterministic proof, an honestly attributed independent review, explicit operator approval where critical, merge verification and updated handoff before claiming checkpoint completion. The representability gap in section 7 must be resolved through the existing governance process, not reviewer relabelling.
7. A missing proof, conflicting authority, changed semantic head, uncleared hold or unauthorized side effect causes a hold/contradiction, never inferred success.

## 4. Detailed bounded playbooks

### IRP-01 — F9 merge authority

Characterize the envelope, admission evaluator, status fields, GitHub draft transition and auto-merge runner. Apply the interim draft rule in section 1 while the defect remains. Specify the invariant: `ACCEPT_FOR_ADMISSION` is not `READY_TO_MERGE`, and a builder-controlled artifact cannot confer merge authority. Implement only the smallest authorized fix. Negative controls include missing/false grant, wrong sender, forged or edited evidence, stale head/base, race across validation and merge, and absent independent review. Run failure-before/passing-after tests, complete deterministic CI, obtain independent security review and individually scoped human merge authorization; recheck after merge. Do not represent the shared GitHub identity as cryptographic proof of the human or model behind a grant.

### IRP-02 — KEY security

Review #155's **current semantic head** and any unresolved #80 contradiction without imposing an unreleased F9 dependency on that review. Trace the shipped `use-key-stream.ts` → Flow controller → `FlowOrchestratorService` → actual effect boundary separately from `KeyCortexQueryPipelineService` and API Cortex routes. Enumerate all reachable write entrances, tenant and actor context, approvals, autonomy verdicts, retries and effect claims. Within explicitly permitted isolated testing, test thrown authorization oracle, invalid verdict, partial batches, tool prompt injection, cross-tenant and duplicates. Do not silently widen #155 to repair a distinct Flow defect: make separately owned corrective packets. No production requests or implicit ACTION-001 resume are authorized.

### IRP-03 — Worker

Characterize worker ownership, pinned checkout, install contract, cursors, ledger and worktrees from permitted repository evidence; actual local-state inspection or upgrade follows its scoped operator permission. Independently review #169's Windows MAX_PATH shortening and pre-wake retry accounting, then #175's per-machine ownership/network bounds **after** #169 integration. Never overwrite dirty/unpushed worktrees. Upgrade from admitted main via the separately authorized operator runbook.

| Fault class | Required observed property |
|---|---|
| Duplicate delivery / replay | A completed directive is not dispatched again; matching evidence and cursor refer to the original request. |
| Crash / interruption | Partial results and worktree are preserved; no false completed cursor; restart resumes or reports a recoverable stop without concurrent duplicate work. |
| Stale lock / PID reuse | Ownership is verified before reclamation; a live unrelated process is not killed and no two owners drive the same repo/control issue. |
| Concurrent checkouts | Same repository/control-issue ownership collides safely even across paths; at most one worker owns the directive. |
| Worktree path/create failure | Failure is counted before any wake, cursor remains uncompleted, bounded retries terminate in a visible hold/escalation. |
| Network interruption / quota | Failure is distinguished from an empty queue; no silent success, no false completed cursor, bounded backoff and preserved retry evidence. |
| Unreadable state / incompatible installation | Report UNKNOWN/BLOCKED with cause; do not reset a cursor, erase attempts or infer that nothing is pending. |

Each class needs a deterministic case, recorded expected/actual result and a negative control where applicable. At least 20 benign exercises are additional smoke coverage, **not a substitute for any fault-class property**.

### IRP-04 — Continuity

Compare #173 and #157 to current source authority. Main's code and valid #80 control events outrank handoff status; historical snapshots retain provenance. Define deterministic bootstrap: read AGENTS/standards; `status.mjs --verify`; current issue #80; packet/holds/DAG; canonical intelligence journey/kernel; exact PR evidence.

| Cold-start input class | Required observed property |
|---|---|
| Valid complete snapshot | Recover identical main, semantic/PR head, authority generation, active packet, effective holds and next legal action from the same evidence. |
| Stale handoff/hash or wrong branch | Flag the mismatch and re-resolve source evidence; never treat an old admission or completion as current. |
| Missing required path / unavailable source | Report the missing evidence and stop affected action rather than reconstruct permission from conversation. |
| Conflicting or edited authority | Fail closed, preserve contradictory evidence and request the existing owner decision; no guessed resolution. |
| Uncleared hold / changed head | Preserve the hold and invalidate prior review applicability as appropriate; no extra implementation credit or release. |

Three separate cold-start sessions supplement these tests. Matching a run count does not establish the properties, and any failed class prevents completion.

### IRP-05 — PR convergence

Inventory every open PR with pagination; freeze heads/base, draft/CI/reviews, changed paths, owner and requirements. Construct overlap/stack and dependency graph, paying attention to #169→#175 and Living Atlas stack. Give each PR one justified disposition: integrate, correct, split, preserve research, supersede, obsolete, or blocked. Record what each decision preserves. No blind closure, no mass merge, no old review inherited after semantic changes. A recorded disposition is not itself permission to mutate a branch or close a PR.

### IRP-06 — KEY integration

Repository-only characterize an existing shipped-chat capability (candidate `helpdesk_create_ticket`) and its real reachability. **This candidate belongs to the held ACTION-001 scope described in section 1.** First re-derive that hold; obtain the required `RESUME` / `HOLD_CLEAR` and bounded implementation/testing permission if it remains active. Do not choose this capability merely because #147 merged or it is called low risk.

After all those gates, exercise the wired path only in an explicitly authorized isolated environment: tenant identity → evidence-bearing context/memory → planning → canonical capability → authorization → idempotent domain effect → actual persisted test outcome → auditable evidence → governed learning. Demonstrate allowed, denied, approval-held, duplicate, uncertain effect and cross-tenant cases. No production access, competing tool registry or autonomous self-promotion of memory/skills. A synthetic fixture proves its declared test scope, not production operation.

### IRP-07 — Revenue journey

Repository-only characterize existing CRM, temporal booking, invoice, settlement, ledger and follow-up owners. After relevant wave/hold and isolated-environment permissions, use two synthetic tenants for lead → contact → booking → invoice → simulated payment → verified posting → pending follow-up. Test tax/discount/currency, double bookings, duplicate callbacks, partial/failed payment, replay and compensation. No live charge, customer message or provider traffic. Require UI-to-test-database lineage and no unexplained financial difference. Do not infer permission to exercise a held ACTION-001 boundary from this scenario.

### IRP-08 — Production validation

**Stage A — repository-only, no production access:** inspect versioned deployment files, migrations, Prisma schema, runbooks, historical observations and existing permitted GitHub artifacts. Identify evidence gaps and draft the exact production-read questions. Historical August table counts and configuration files do not establish current deployed state.

**Stage B — separately authorized production reads:** only after explicit operator permission names the actor, environment, endpoints/data, scope and restrictions, inspect the authorized deployed revision, topology, migration lineage, credential *presence* rather than values, queue/connector health, backups and observability. A GET request, health probe or live database query is still production access. If permission or evidence is absent, leave the field NOT_ASSESSED. Reading a public production URL is not automatically exempt.

**Stage C — separately authorized isolated rehearsal:** use a disposable test environment or sanitized clone only when its data extraction, sanitization and access are authorized. Rehearse non-destructive migration, restore, provider-failure and rollback using synthetic effects and disabled business schedulers. Publish PASS/FAIL/NOT_ASSESSED with evidence and blockers. None of these stages grants production deployment, migration or provider-effect authority; release remains a separately authorized exact-artifact decision.

## 5. Initial eight-operation evidence cycle

- [ ] Re-resolve current main, #80 valid authority/reducer, active packet and holds, PR heads and workflow proof.
- [ ] Characterize F9 and state interim draft containment without weakening checks or inferring a merge exception.
- [ ] Independently review the exact-head F9 affected code and negative-control obligations.
- [ ] Independently characterize #155, shipped Flow and Cortex routes without adding an F9 review/admission prerequisite.
- [ ] Build complete paginated inventory accounting for the 47 original PRs and newer additions, stacks, ownership and duplication.
- [ ] Review #169→#175 and local-worker install/upgrade constraints without modifying the worker; distinguish source analysis from any separately permitted local observation.
- [ ] Reconcile #173/#157's handoffs, active holds and stale claims with valid #80 authority.
- [ ] Produce a durable exact-source evidence checkpoint and the **next legal** narrowly scoped proposed action, distinguishing repository-only work from separately authorized environment access.

**Nothing on this checklist is marked complete by saving or correcting this file.**

## 6. Proof, progress and completion

Every admitted bounded implementation uses the existing obligations ledger (`Declared / Resolved / Remaining / Deferred / Dropped / Superseded`), exact main/semantic/PR SHA, current authority comment and effective holds, allowed scope, architecture invariants, regression and negative controls, independent review, CI with skipped checks disclosed, human merge grant where required, merge SHA, post-merge verification, and updated canonical handoff.

Keep two evidence-based scoreboards: **autonomous development system** (authority, worker, continuity, PRs) and **actual KEYFLOWOS product** (KEY security, full loop, revenue, readiness). Avoid fabricated percentages. PR opened != code deployed; CI success != domain behavior; research proposal != implemented capability. Mark an unproven criterion UNKNOWN or NOT_ASSESSED, distinguishing unavailable evidence from failed proof.

**Proposed first implementation action, not released by this plan:** a surgical F9 fail-closed merge-authority patch, separately authorized under the *existing* control plane. Repository-only KEY security, PR, worker, memory and infrastructure characterization may run in parallel within actual assignments. The already authorized #155 packet is neither replaced, released anew nor made to wait for F9 review/admission. The ACTION-001 hold and all production-access restrictions remain binding.

**This document's completion means only that an inactive, reviewable programme plan exists on a documentation PR.** Author correction is not independent acceptance. It changes no runtime, worker, control authority, active DAG, pipeline or deployment. The existing integration may trigger a hosted preview for a docs push; that is not authorized production validation, and no credentials or feature enablement should be added to it.

## 7. Standing independent-review routing — operator direction, 2026-10-17

The operator requested that independent reviews be sent between ChatGPT and Claude whenever needed. The request and its bounded first handoff are recorded in [CG-DIR-IRP177-REVIEW-001](https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6229439023). Use the existing GitHub control room (#80), PR discussions and worker transport; do not require the operator to copy routine review requests between chats when that transport is available. This is an operational routing instruction, not a patch to executable review eligibility.

| Author of the change under review | Review destination |
|---|---|
| Claude Code | ChatGPT, in a separate review context; apply the unchanged machine-contract limitations below. |
| ChatGPT | Claude Code, in a separate review context; record the result as attested independent review evidence, not as an accepted machine provider. |
| Both contributed substantive changes | Identify contributions explicitly; neither may independently approve a portion they authored. Obtain a genuinely uninvolved reviewer/context for the affected scope, or leave independent review BLOCKED. A new label or another run of an involved author is not independence. |

**Review package:** Supply the exact repository, PR, base SHA, semantic/head SHA, complete scoped diff, governing packet and constraints, acceptance criteria, relevant surrounding files, test/CI evidence (including skips), and unresolved findings. The reviewer re-fetches sources and records their own result rather than merely endorsing the author's explanation.

**Handoff loop:** Author requests review -> other model acknowledges -> reads the exact sources -> returns PASS, CHANGES_REQUIRED or BLOCKED/NOT_RUN with file/line evidence and unassessed areas -> author corrects within authorized scope -> other model re-reviews the new semantic head. Changes requiring wider scope return to the existing authority process. Repeated failure without progress triggers the execution standard's momentum/contradiction rule. A re-review waiting behind an active worker task is explicitly deferred; do not overwrite the latest actionable directive simply to queue another request.

### Shared-account provenance is an attestation, not verified model identity

The request, commits, ACK and review can all be posted through `SaCH-PRO`. GitHub metadata establishes **which account/app posted and when**, not which model actually ran. The `sender`, model/version and authorship fields are self-declared. Until stronger independently authenticated provenance exists, cross-model independence is an **attestation with supporting evidence**, not cryptographically verified separation.

Record the actual authoring model claim, reviewer model/version when available, interface and session/worktree reference, exact reviewed SHA, whether the reviewer contributed to the change, and immutable request/ACK/RETURN/findings links. Where separately accessible and authorized, retain matching worker process/session/version logs or exported review evidence; mark absent material unavailable, never invent it. These records corroborate the chain but do not turn a shared account into independent model authentication. A second run by the same authoring model, a fabricated reviewer label, or GitHub identity alone is insufficient. Read-only feedback is not authorship of a correction; a reviewer who implements a substantive correction cannot independently approve that changed scope.

For the first review, the supporting chain is request [6229439023](https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6229439023), ACK [6229470452](https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6229470452), findings [6229516997](https://github.com/SaCH-PRO/KEYFLOWOS/pull/177#issuecomment-6229516997), RETURN [6229520428](https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6229520428) and ChatGPT receipt [6229558462](https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6229558462). The reviewer self-reported `claude-opus-5-5` / Claude Code, no authorship contribution and worktree `worker-worktrees/CG-DIR-IRP177-REVIEW-001`; no session URL was supplied. Preserve these as claims tied to the reviewed head, not verified facts about every later review.

### Existing machine review contract and three unresolved gaps

At pinned main `98ee0202`, [semantic-review.mjs](https://github.com/SaCH-PRO/KEYFLOWOS/blob/98ee0202499ba87fa4ee13d58a2a9075016225bd/scripts/agent-control/lib/semantic-review.mjs) and `AGENT_CONTROL_PLANE.md` still make Copilot the preferred reviewer and ChatGPT the only approved fallback. **When relying on ChatGPT as that fallback**, the cited live Copilot evidence must establish NOT_RUN with the supported machine reason at matching admitted semantics; quota failure is never PASS. The executable code also accepts a valid primary PASS (`primaryPassed`); in that case primary evidence already satisfies the obligation. This routing rule does not invent primary unavailability or waive any head, finding or provenance condition.

1. **Unsupported reciprocal provider:** `REVIEW_PROVIDERS` contains only `copilot` and `chatgpt`. An actual `claude` entry is rejected as `provider_not_approved`; a ChatGPT review of honestly recorded ChatGPT-authored work is rejected as `self_review`. The Copilot quota responses on the original #177 heads do not create a valid Claude provider. Do not claim that this reciprocal review can currently satisfy that machine gate, or relabel Claude as ChatGPT/Copilot.
2. **Docs-branch coverage gap:** `evaluateAdmission` excludes a `docs/*` PR as `not_impl_branch` after its earlier open/draft checks, and `agent-control-gate.yml` applies artifact/review steps only to `impl/*`. PR #177 therefore has no machine semantic-review admission coverage through those steps. Green docs CI is not review approval. Do not rename a branch merely to evade or pretend to satisfy the contract.
3. **Writer-declared authorship:** `record.implementer` is supplied by the record writer. The current self-review comparison checks that value, not independently established authorship. A false `implementer: claude` on ChatGPT-authored work could misrepresent self-review as independent. Preserve actual authorship and supporting evidence; do not change that field to get green.

These gaps remain **OPEN / NOT FIXED BY THIS DOCUMENT**. Resolving executable eligibility or a legitimate docs integration procedure needs its own scoped, independently reviewed governance change through the existing owners. No author may count their own review, bypass required review or convert missing machine coverage into permission. PR #177 stays draft pending genuine non-author re-review and a separately authorized, honestly represented integration decision; author corrections alone cannot close these runtime gaps.

**Delivery truth:** Track REQUESTED, ACKNOWLEDGED, RETURNED, RETURN_CONSUMED and ADMISSION_DECIDED separately. A posted request is not proof the other model received or completed it, and a read of a feed is not an explicit receipt. CHANGES_REQUIRED can still be a successful communication round trip. Missing worker/reviewer availability remains visible. Claude's RETURN is evidence for ChatGPT to consume on its next active review turn; this document creates no continuously running ChatGPT service, scheduler or new dispatch queue.

**Authority boundary:** Cross-review routes evidence, not merge permission. A PASS never authorizes merge, deployment, programme activation or production access/effects. Existing executable gates are unchanged. Critical merge/release decisions remain with the human operator. The programme itself remains inactive.

**First application and current review position:** PR #177 was authored by ChatGPT. Claude reviewed `8ecb71582bb916c9d915493de050d7925c372634` read-only and returned CHANGES_REQUIRED with six medium findings and three low findings. The following author corrections require re-review of their new exact head. No prior verdict is relabelled, no finding is independently closed by the author, and no concurrent monitor assignment is superseded to force a new review wake.

## 8. Author correction ledger — pending independent re-review

This ledger responds to `CC-REVIEW-IRP177-001`; it is not a fresh reviewer PASS. The previous verdict remains historical evidence for its exact head. No product/runtime test, live reducer run or production inspection is claimed by this document correction.

| Finding | Author response in this revision | Remaining review or implementation obligation |
|---|---|---|
| F1 medium — accidental F9 dependency | Sections 1–3 remove the unconditional F9 → #155 review/admission edge and specify the exact-human-authorized integration exception. | Non-author checks consistency of table, diagram and interim rule; existing packet authority unchanged. |
| F2 medium — implied production reads | Sections 1–5 split repository-only review from separately authorized production reads and isolated rehearsals, with actor/environment/scope requirements. | No production authority or observation is claimed; non-author checks every IRP-08 reference. |
| F3 medium — ACTION-001 hold omitted | Sections 1–4 name the checkpoint hold, exact `RESUME` / `HOLD_CLEAR` rule and isolated-only pilot after real scope permission. | Re-derive live holds before action; document cannot clear them. |
| F4 medium — no interim F9 containment | Section 1 supplies the draft restriction and individually human-authorized exact-target exception; IRP-01 references it. | F9 code remains unfixed; no transition or merge performed. |
| F5 medium — unsupported independence claim | Section 7 states shared-account attestation, self-declared model identity, corroborating evidence and missing stronger provenance. | Non-author checks disclosure; cryptographic identity separation remains unimplemented. |
| F6 medium — gate cannot represent reciprocal review | Section 7 names unsupported Claude provider, docs-branch non-coverage and writer-controlled implementer identity. | All three runtime/governance gaps remain OPEN; no relabelling or self-review; separate admitted solution needed. |
| F7 low — Copilot-primary blurred | Section 7 separates desired cross-review routing from actual primary/fallback behavior, including `primaryPassed` versus relying on NOT_RUN-backed fallback. | Non-author rechecks code/prose against pinned main; no provider eligibility changes. |
| F8 low — counts substituted for properties | Section 4 adds per-fault worker and per-input cold-start criteria; 20 benign runs / three starts are supplemental only. | Actual failure-property tests still required when those workstreams are authorized. |
| F9 low — Kimi exclusion provenance | Section 1 cites draft #176's recorded operator decision and acknowledges the unchanged main documents; no unseen #80 decision is invented. | Canonical policy/document reconciliation remains with its existing owner. |

All eight workstream labels, implementation owners and non-executable status remain. This correction changes only this documentation proposal; the handoff-monitor task, its scope issue #178, active #155, held ACTION-001, canonical DAG, workflows, gates, worker installation and production are not modified.
