# KEYFLOWOS Integrated Execution & Recovery Programme

**Status: PROPOSED — INACTIVE — NOT AUTHORIZED FOR AUTO-RELEASE**  
**Baseline:** main `98ee0202499ba87fa4ee13d58a2a9075016225bd`; 47 open PRs at inspection, 2026-10-16.  
**Authority:** https://github.com/SaCH-PRO/KEYFLOWOS/issues/80  
**Purpose:** Integrate eight recovery/delivery workstreams with existing packet ownership, proof requirements, and governance without creating a competing control plane.

## 1. Precedence and safe boundaries

- Actual code, current PR heads and CI prove what exists. The newest **valid** typed ChatGPT authority on issue #80 determines what can occur. `node scripts/agent-control/status.mjs --verify` folds this authority over the reviewed programme checkpoint.
- `docs/development/KEYFLOWOS_PROGRAMME_DAG.yaml` projects the canonical 35-packet execution board held on `docs/keyflow-intelligence-foundation`. **This document does not edit that DAG, introduce executable nodes, confer packet credit, or release work.**
- Follow `AGENTS.md`, `CLAUDE.md`, `docs/development/EXECUTION_CONTROL_STANDARD.md` and `docs/development/AGENT_CONTROL_PLANE.md`. Map before modifying; maintain complete scope ledgers; stop on contradictions; prove failures and effects, not only green CI.
- `architecture/os/OS.md` records scheduled OS cycles as HALTED. This programme does not restart them. No production mutation, real provider traffic, deployment, merge or installed-worker change is authorized by this document.
- Claude Code implements bounded approved changes; ChatGPT reviews Claude-authored work and Claude reviews ChatGPT-authored work under the operator-directed cross-review rule in section 7. Existing deterministic GitHub controls validate; the human operator authorizes critical merges and production. PR #176's reviewer architecture remains a proposal, and this routing rule does not modify its unmerged code or the existing executable gates. Kimi Code is excluded from development/review, but remains separate from customer-selectable product providers.
- Historic handoffs, PR plans and outdated production reports are not live truth. Re-resolve main, issue #80 and current artifacts before any task.

## 2. Eight work packages: ownership, links and exit proof

Tracking IDs IRP-01 to IRP-08 are **document identifiers only**, never approved packet IDs or scheduler inputs.

| ID / priority | Work / existing owner and PRs | Blocking dependency for execution | Concrete evidence required for completion |
|---|---|---|---|
| **IRP-01 P0** | Merge authority F9; `scripts/agent-control/lib/admission.mjs` and auto-merge; design PR [#176](https://github.com/SaCH-PRO/KEYFLOWOS/pull/176) | Explicit reviewed bounded control repair; no preliminary admission permitted to trigger merge | `ACCEPT_FOR_ADMISSION` alone always fails merge eligibility; exact-head independently reviewed grant, negative controls, CI, post-merge proof |
| **IRP-02 P0** | KEY security; active `KF-EXEC-AUTH-FAIL-CLOSED-001`, [#155](https://github.com/SaCH-PRO/KEYFLOWOS/pull/155); Cortex and shipped Flow execution owners | Current #80 active packet authority; IRP-01 before reliance on automated critical merge | Independent exact-semantic-head review; reachable route→permission→writer graph for Cortex **and** Flow; denial, exception, tenant and retry proofs |
| **IRP-03 P1** | Windows Claude worker; [#169](https://github.com/SaCH-PRO/KEYFLOWOS/pull/169) then stacked [#175](https://github.com/SaCH-PRO/KEYFLOWOS/pull/175); related #170–172 | Independently admit #169, then reconcile/review #175; separate installed-worker upgrade authorization | Short worktree path, lock/cursor/attempt recovery, failure bounds, 20 benign exercises and no duplicate dispatch/lost work |
| **IRP-04 P1** | Continuity and startup; [#173](https://github.com/SaCH-PRO/KEYFLOWOS/pull/173) on main, [#157](https://github.com/SaCH-PRO/KEYFLOWOS/pull/157) on intelligence branch | Current authority/branch provenance verified; no direct edit of reviewed checkpoint | Cold-start agents resolve same main, issue authority, active packet, dependencies, holds and next legal action; stale handoffs clearly historical |
| **IRP-05 P1** | PR convergence; [#150](https://github.com/SaCH-PRO/KEYFLOWOS/pull/150), [#168](https://github.com/SaCH-PRO/KEYFLOWOS/pull/168), [#170](https://github.com/SaCH-PRO/KEYFLOWOS/pull/170) | Read-only inventory may start now; actual PR dispositions and branch changes need scoped authority | All 47 baseline PRs / refreshed total inventoried, one justified disposition each, dependency and overlap graph, preserved unique obligations |
| **IRP-06 P2** | KEY intelligence-to-effect; shipped Flow, canonical capability/action owners; existing #147 and drafts #139, #158, #160–163, #112, #127, #148, #134 | IRP-02 safety proven, applicable existing packet/wave authority; research not self-promoted | One live UI→context/memory→reasoning→capability→permission→effect→evidence→governed learning flow; tenant/retry/denial tests |
| **IRP-07 P2** | Lead-to-revenue journey; canonical `KF-EXEC-TIME-001`, `COMMERCIAL-001`, `BOOKING-001`, `FINANCE-001`, `INTEGRATED-001` owners | Existing wave dependencies, effect governance and approved isolated tests | Synthetic lead→contact→booking→invoice→simulated payment→ledger→follow-up, concurrent/duplicate/failed cases, no cross-tenant or double financial effects |
| **IRP-08 P3** | Readiness; `KF-EXEC-MIGRATE-001`, `INTEGRATED-001`, `OPS-001`, `RELEASE-001`; historical production/readiness docs | Read-only inventory now; isolated staging actions separately approved; deployment requires explicit human release | Current schema/migration/infrastructure evidence, staging restore/rollback rehearsal, security and accounting proof, PASS/FAIL/UNKNOWN dossier |

## 3. Proposed dependencies (non-executable)

```text
IRP-01 merge-safety proof ──┬─> IRP-02 critical review/admission
                           └─> safe automation of critical merge procedures
IRP-03 #169 ─> #175 ─> approved installed-worker upgrade
IRP-04 continuity ─────────> reliable agent pickup (not a new authority)
IRP-05 PR inventory ───────> explicit dispositions (not mass merging)
IRP-02 governed effects ───> IRP-06 KEY vertical proof
IRP-02 + relevant canonical wave/packet dependencies ─> IRP-07 revenue journey
IRP-06 + IRP-07 + migration/ops/release proofs ────────> IRP-08 release assessment
```

Read-only characterization of IRP-01/02/03/04/05/08 may proceed concurrently. These arrows are **planning constraints, not newly created executable DAG edges**. Existing packet dependencies and newer valid #80 decisions take precedence.

### Requirements before representing any dependency in existing control mechanisms

1. Refresh exact main, issue #80 typed authority, active packet, PR heads and the existing canonical intelligence board.
2. For each item decide whether it belongs to an **already released packet**, separately authorized meta repair, or **new proposed packet**. Never dispatch an IRP-* reference as a packet ID.
3. Supply a bounded scope charter: exact source main, existing semantic owner, files and forbidden effects, packet obligations, dependency/hold list, invariants, failure matrix, tests and stop conditions.
4. If existing DAG topology genuinely must change, independently review proposed revisions to the canonical intelligence board and projected `KEYFLOWOS_PROGRAMME_DAG.yaml`. Run its dependency/wave validation and negative controls. **Do not modify topology or the `.agent-control/programme-state.yaml` checkpoint merely because this document is accepted.**
5. Obtain valid issue #80 control authority with exact packet/scope/effect before any agent task release. Use the existing worker and selector, not a new dispatcher.
6. Require Claude's RETURN, exact-head deterministic proof, independent review, explicit operator approval where critical, merge verification and updated handoff before claiming checkpoint completion.
7. A missing proof, conflicting authority, changed semantic head or unauthorized side effect causes a hold/contradiction, never inferred success.

## 4. Detailed bounded playbooks

### IRP-01 — F9 merge authority
Characterize the envelope, admission evaluator, status fields, GitHub draft transition and auto-merge runner. Specify the invariant: `ACCEPT_FOR_ADMISSION` is not `READY_TO_MERGE`, and a builder-controlled artifact cannot confer merge authority. Implement the smallest authorized fix. Negative controls include missing/false grant, wrong sender, forged or edited evidence, stale head/base, race across validation and merge, and absent independent review. Run failure-before/passing-after tests, complete deterministic CI, obtain independent security review and individually scoped human merge authorization; recheck after merge.

### IRP-02 — KEY security
Review #155's **current semantic head** and any unresolved #80 contradiction. Trace the shipped `use-key-stream.ts` → Flow controller → `FlowOrchestratorService` → actual effect boundary separately from `KeyCortexQueryPipelineService` and API Cortex routes. Enumerate all reachable write entrances, tenant and actor context, approvals, autonomy verdicts, retries and effect claims. Test thrown authorization oracle, invalid verdict, partial batches, tool prompt injection, cross-tenant and duplicates. Do not silently widen #155 to repair a distinct Flow defect: make separately owned corrective packets.

### IRP-03 — Worker
Read-only inspect PID/owner/lock, pinned checkout, install contract, cursors, ledger and worktrees. Independently review #169's Windows MAX_PATH shortening and pre-wake retry accounting, then #175's per-machine ownership/network bounds **after** #169 integration. Exercise crash, stale lock, concurrent checkout, failed worktree creation and interrupted network. Never overwrite dirty/unpushed worktrees. Upgrade from admitted main via controlled operator runbook; prove at least 20 benign wakes with no duplicate/lost directive.

### IRP-04 — Continuity
Compare #173 and #157 to live source authority. Main's code and valid #80 control events outrank handoff status; historical snapshots retain provenance. Define deterministic bootstrap: read AGENTS/standards; `status.mjs --verify`; current issue #80; packet/dag; canonical intelligence journey/kernel; exact PR evidence. Test stale hashes, missing paths, contradictory state, wrong branch and three independent cold starts. Stop rather than choose stale authority.

### IRP-05 — PR convergence
Inventory every open PR with pagination; freeze heads/base, draft/CI/reviews, changed paths, owner and requirements. Construct overlap/stack and dependency graph, paying attention to #169→#175 and Living Atlas stack. Give each PR one justified disposition: integrate, correct, split, preserve research, supersede, obsolete, or blocked. Record what each decision preserves. No blind closure, no mass merge, no old review inherited after semantic changes.

### IRP-06 — KEY integration
Characterize a real low-risk capability in the shipped chat (candidate `helpdesk_create_ticket`, verify current reachability). Trace tenant identity → evidence-bearing context/memory → planning → canonical capability → authorization → idempotent domain effect → actual persisted outcome → auditable evidence → governed learning. Demonstrate allowed, denied, approval-held, duplicate, uncertain effect and cross-tenant cases. No additional competing tool registry or autonomous self-promotion of memory/skills.

### IRP-07 — Revenue journey
Characterize existing CRM, temporal booking, invoice, settlement, ledger and follow-up owners. In two synthetic isolated tenants run lead → contact → booking → invoice → simulated payment → verified posting → pending follow-up. Test tax/discount/currency, double bookings, duplicate callbacks, partial/failed payment, replay and compensation. No live charge, customer message or provider traffic. Require UI-to-DB lineage and no unexplained financial difference.

### IRP-08 — Production validation
Read-only verify deployed revision, service topology, database migration lineage, secrets *presence*, queue/connector health, auth/tenant boundaries, backup and observability. The August production table counts are historic, not current. Only with separate authorization use a sanitized disposable staging clone to rehearse non-destructive migrations, restore, provider-failure tests and rollback. Publish explicit PASS/FAIL/UNKNOWN with blockers and evidence; production release remains a separately authorized exact-artifact decision.

## 5. Initial eight-operation evidence cycle

- [ ] Re-resolve current main, #80 valid authority/reducer, active packet, PR heads and workflow proof.
- [ ] Characterize F9 and propose safe containment without weakening checks.
- [ ] Independently review the exact-head F9 affected code and negative-control obligations.
- [ ] Independently characterize #155, shipped Flow and Cortex routes.
- [ ] Build complete paginated 47-PR baseline inventory, stacks, ownership and duplication map.
- [ ] Review #169→#175 and local-worker install/upgrade constraints without modifying worker.
- [ ] Reconcile #173/#157's handoffs and stale claims with valid #80 authority.
- [ ] Produce durable exact-source evidence checkpoint and the **next legal** narrowly scoped proposed action.

**Nothing on this checklist is marked complete by saving this file.**

## 6. Proof, progress and completion

Every admitted bounded implementation uses the existing obligations ledger (`Declared / Resolved / Remaining / Deferred / Dropped / Superseded`), exact main/semantic/PR SHA, current authority comment, allowed scope, architecture invariants, regression and negative controls, independent review, CI with skipped checks disclosed, human merge grant where required, merge SHA, post-merge verification, and updated canonical handoff.

Keep two evidence-based scoreboards: **autonomous development system** (authority, worker, continuity, PRs) and **actual KEYFLOWOS product** (KEY security, full loop, revenue, readiness). Avoid fabricated percentages. PR opened != code deployed; CI success != domain behavior; research proposal != implemented capability. Mark any unproven criterion UNKNOWN.

**Proposed first implementation action, not yet released:** a surgical F9 fail-closed merge-authority patch, separately authorized under the *existing* control plane. In parallel continue read-only KEY security, PR, worker, memory, and infrastructure characterization. The currently authorized #155 packet is not replaced or automatically released anew.

**This document's completion means only that an inactive, reviewable programme plan exists on a documentation PR.** It changes no runtime, worker, control authority, active DAG, pipeline or deployment.

## 7. Standing independent-review routing — operator direction, 2026-10-17

The operator requested that independent reviews be sent between ChatGPT and Claude whenever needed. Use the existing GitHub control room (#80), PR discussions and worker transport; do not require the operator to copy routine review requests between chats when that transport is available.

| Author of the change under review | Review destination |
|---|---|
| Claude Code | ChatGPT, in a separate review context |
| ChatGPT | Claude Code, in a separate review context |
| Both contributed substantive changes | Identify contributions explicitly; neither may independently approve a portion they authored. Obtain a genuinely uninvolved reviewer/context for each affected scope, or leave independent review BLOCKED. |

**Review package:** Supply the exact repository, PR, base SHA, semantic/head SHA, complete scoped diff, governing packet and constraints, acceptance criteria, relevant surrounding files, test/CI evidence (including skips), and unresolved findings. The reviewer re-fetches the sources and records their own result rather than merely endorsing the author's explanation.

**Handoff loop:** Author requests review -> other model acknowledges -> reads the exact sources -> returns PASS, CHANGES_REQUIRED or BLOCKED/NOT_RUN with file/line evidence and unassessed areas -> author corrects within authorized scope -> other model re-reviews the new semantic head. Changes requiring wider scope return to the existing authority process. Do not iterate indefinitely: repeated failure without progress triggers the execution standard's momentum/contradiction rule.

**Independence and provenance:** Record authoring model, actual reviewer model/version when known, interface/session reference, reviewed SHA and whether the reviewer contributed to the change. A second run by the same authoring model, a fabricated reviewer label, or GitHub account identity alone does not establish cross-model independent review. Read-only reviewer feedback is distinct from authoring a correction. A reviewer that implements a substantive correction cannot independently approve its own changed scope.

**Delivery truth:** Track REQUESTED, ACKNOWLEDGED, RETURNED and ADMISSION_DECIDED separately. A posted request is not proof the other model has received or completed it. Missing worker/reviewer availability remains a visible blocker. Claude's RETURN is evidence for ChatGPT to consume on its next active review turn; this document does not create a continuously running ChatGPT service or a new scheduler.

**Authority boundary:** Cross-review routes evidence, not merge permission. A PASS never authorizes merge, deployment, programme activation or production effects. Existing executable review gates are unchanged; a review they cannot represent must be retained as evidence and reported as an admission gap, not relabelled to fit. Critical merge/release decisions remain with the human operator. The programme itself remains inactive.

**First application:** PR #177 was authored by ChatGPT and is to be sent to Claude for an exact-head, read-only review. Claude should report findings on the PR and return the result through #80, without editing this proposal, creating implementation changes or advancing its merge state.
