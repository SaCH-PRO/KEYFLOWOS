# J8 - Completion Evidence, Assignment, Calendar and Time Billing: Microtrace 002

Checkpoint: `J8-M002-2026-09-16-01`  
Date: 2026-09-16  
Intelligence input: `13c1e7e5c43fdef7101e66fb1322288ec0f06c4b`  
Implementation forensic baseline: `8f173bfe79f1418159cf4099ea18b0d60d203ec2`  
Result: **NAMED EVIDENCE / ASSIGNMENT / CALENDAR / TIME-BILLING TRACE COMPLETED; OBLIGATION BRIDGE AND FINAL SCOPE REMAIN OPEN**  
Journey status: **J8 ACTIVE / NOT CONVERGED**.

This continues [Microtrace 001](J8-PROJECT-WORK-DELIVERY-MICROTRACE-001.md), abbreviated M001. It does not restart project discovery or replace earlier findings. Production code, database/schema, workflows, settings, tests and the programme map are unchanged. The map generator/check was not run. Scheduled cycles remain halted. No application, provider, DB, boot, concurrency or migration test was executed.

S references below are pinned implementation reads. R references are existing repository architecture. Y01-Y08 and the CAND labels are local investigation identifiers, not canonical F/C/REC allocations or runnable tests.

## 1. Questions answered and boundaries retained

| Question | Result | Limit |
|---|---|---|
| Are evidence and assignment APIs entirely unguarded or unscoped? | **No.** Business guards, mounted tenant context and scoped assignment checks are real positive mechanisms. | They do not prove target-reference validity, current completion/reviewer authority or the behavior of direct writers that bypass the assignment service. |
| What makes an attachment qualify as completion evidence? | The inspected completion helper only establishes row presence. Verification stamping is separate and is not a target/revision/policy-specific acceptance decision. | Consumer-specific rules remain to design; not every task requires a heavyweight review. |
| Are there additional completion writers? | **Yes.** Calendar source writeback changes project/task completion directly, then separately changes the calendar row. | Query-layer mutation permission exists. This is not an unauthenticated calendar write claim. |
| Can the calendar repair missed notifications? | **Partly.** Named backfill methods upsert eligible dated projects/tasks. | They are not a demonstrated full, paginated, deletion-aware reconciliation of every stale row. No schedule or runtime repair was proved. |
| Does time billing conserve every selected entry? | A concrete grouping counterexample loses an earlier entry at a repeated alternate rate while the selected IDs can all be marked billed. | Static algorithm result; no actual invoice/customer incident was reproduced. |
| Does billed-row count make invoice creation atomic? | **No.** The count is checked after invoice creation and marking. It detects some mismatches but does not roll back the already-created invoice or conserve line value. | Preserve the useful refusal and mismatch checks; actual concurrency/transaction behavior is unexecuted. |
| Does project completion already settle the exact contract/delivery obligation? | A reusable work-obligation event/listener contract exists, with exact and party-wide settlement modes. | A proven source-to-settlement bridge for the required project/milestone/accepted scope is not established in these reads. Do not invent it or claim it absent everywhere. |

The named service/control boundaries have advanced. Full Evidence/TaskAssignment DDL, portal acceptance, milestone settlement and all alternate writers are **not** claimed closed. Those are a finite next review, not a reason to repeat the completed code scan.

## 2. Evidence identity and tenant admission

### 2.1 Guard and context chain

The evidence controller has AuthGuard, BusinessGuard and RateLimitGuard. Its business-scoped submission takes submittedBy from the request principal. ID-only get/verify/delete routes are still under the class guards; BusinessGuard requires a business coordinate in params/body/query for ordinary users and checks owner/member access. Its SUPER_ADMIN path is a distinct privilege case. An ID-only URL is not, by itself, evidence the request bypasses business access. [S01-S03]

TenantInterceptor obtains business coordinates from params/body/query and enters the request tenant context. The main entrypoint registers the database context provider, and AppModule registers the interceptor globally. This establishes the declared normal HTTP context chain, not a successful boot or a proof every background/direct service call has context. [S04-S06]

The shared database client includes Evidence, Project, ProjectTask and TimeEntry among the scoped business models. Its applicable query extensions add/override the scalar business predicate when context is active; context absence does not manufacture a tenant. Actual per-model create/upsert hooks exist. Do not repeat the older comment claiming those writes are universally unhooked. TaskAssignment lacks a direct businessId and is not automatically protected by that scalar model list. [S07]

**Narrowing M001:** lack of an explicit businessId argument in one helper does not establish a normal HTTP cross-tenant disclosure when the mounted ambient context is active. Conversely, a correctly scoped Evidence row does not prove that its polymorphic linkedId belongs to the same tenant or is the intended current task.

### 2.2 Reference, verification and acceptance are different

| Path | Exact method-level behavior | Remaining qualification |
|---|---|---|
| EvidenceService.submit | Persists supplied linkedType/linkedId and evidence data under the supplied business/submittedBy; emits evidence events separately. | No target existence/ownership/scope-revision check is shown in this method. Scalar tenant scoping is not a foreign-target validator. |
| getForObject | Reads by polymorphic type/ID, adding business only when supplied; ambient scoping may also apply. | A returned list is not evidence policy acceptance. |
| checkTaskEvidence | Reads whether the named task requires evidence, then defines hasEvidence from the number of returned rows. | Does not consume verification, admitted values, scope revision, evidence withdrawal or a consumer-specific decision. Missing/unsupported subjects must not be confused with valid completion eligibility. |
| verify | Reads an evidence ID and records verifiedBy/verifiedAt from its caller. | No exact target/policy/revision-specific review decision is formed here. The class guard is business access, not a demonstrated specialized reviewer capability. |
| delete | Calls the evidence delete path and emits its event. | No dependent task/acceptance invalidation is established in this method. Evidence is not in the inspected client's soft-delete model set; global retention mechanisms and actual DB constraints were not exhaustively audited. |
| M001 general updateTask | A nonempty evidenceIds array avoids missing-evidence rejection in that method. | It neither validates each ID nor links it to an accepted completion decision there. |

[S01/S02/S07 and inherited M001 S02/S10]

The proposed rule is not "every task needs verifiedAt." It is: the exact task/obligation declares its evidence policy, and completion consumes evidence admitted for that subject and scope under that policy. A note may legitimately be enough for low-risk internal work. Where independent acceptance is required, an attachment or checkbox must not counterfeit it.

Existing KF-REC-056 already owns consumer-specific EvidenceAdmissionDecision and exact document/revision references; KF-REC-049 owns generic provenance. J8 should consume those boundaries rather than create a second evidence repository. [R01]

## 3. Assignment and relationship integrity

### 3.1 Existing checks are load-bearing on their guarded path

The assignment controller supplies businessId and the real requesting user to TaskAssignmentService.assign. With businessId, the service resolves supported ProjectTask/ContactTask ownership, requires User membership or StaffMember business membership, and limits KEY assignment to its expected identity. Its scoped listing filters assignments through owned task pairs; workload logic deduplicates and reports truncation. Preserve those checks and honest scope reports. [S08/S09]

The assignment service is therefore not generally equivalent to an unvalidated raw assignment insert. M001's ProjectsService direct assignment path is different: it creates assignment history inside its task transaction and writes assignedBy='system'. Its transaction is valuable, but it does not invoke the same eligibility service. Current actor provenance and eligible-assignee rules must be carried into that direct path as well. This is a consistency gap between named owners, not a claim all assignments lack protection.

### 3.2 Remaining method-level gaps

The assignment service's businessId is optional for internal callers. The scoped task resolver supports a narrower set than the generic task-type vocabulary; unsupported scoped types fail closed rather than proving arbitrary access. Contractor/KeyflowStaff names are accepted by the inspected validation logic without a corresponding eligibility lookup there. Their actual backing rules remain a named integration requirement, not assumed universally absent. [S08]

Assignment replacement unassigns current rows and creates the new row in separate operations. The same-assignment check provides a useful replay shortcut but not, on its own, atomic ownership under concurrent replacement or a crash. The complete TaskAssignment DDL/uniqueness policy was not reliably extracted in this tranche, so no claim is made that the database has no relevant constraint. The established issue is **no local transactional replacement/expected-state guarantee in the inspected service method**. [S08]

TimeEntry's owned-reference checks verify the project belongs to the business and the task's project belongs to the business. They do not require a supplied task.projectId to equal a separately supplied projectId. Two valid same-business objects can therefore form an inconsistent work allocation unless the relationship is additionally checked elsewhere. Tenant isolation and relationship consistency are different invariants. [S13]

A single logical assignment/completion policy should be consumed by direct project writers, dedicated assignment APIs, calendar writeback and work-plan execution. That is a candidate integration boundary, not authorization to replace the current services.

## 4. Calendar writeback: additional authoritative writers

The calendar query service performs visibility and `permissions.assertCanMutate` checks before source writeback. Those controls are retained. After them, the projection service performs direct source updates and the query service separately updates the calendar event. [S10/S11]

| Source writeback | Shown source mutation | Why it matters |
|---|---|---|
| project_task status | Sets isCompleted based on whether calendar status is COMPLETED. | Does not synchronize ProjectTask.status, evaluate evidenceRequired, consume ProjectPlanEvent completion policy or emit the standard task transition in this path. |
| project status COMPLETED | Directly sets Project.status COMPLETED. | Does not establish accepted required work/delivery scope. |
| project status other than COMPLETED | No corresponding project status mutation in this branch. | Reopening the calendar projection can leave the Project still COMPLETED. |
| source update with no matching row | updateMany result count is not treated as a required success predicate in the shown path. | The later calendar-row update is not proof the authoritative source was changed. |
| project cancellation | Source cancellation path returns without changing Project; calendar event can be hidden/deleted separately. | Define whether this is hiding a view or cancelling the business commitment; do not present them as equivalent. |
| project_task cancellation | Changes task completion/deletion fields directly. | Task cancellation, evidence retention and required-scope removal need the same authoritative contract as other writers. |

Read-only source types remain explicitly rejected. Query-layer permission prevents labeling this whole path public or policy-free; the missing rule is consistent **domain** completion after permission has been granted.

This adds the document-local writer role **W8-10 Calendar source writeback** to M001's W8-01-W8-09. It must join the completion-writer cutover inventory. Patching ProjectsService alone leaves this alternate source mutation path.

### 4.1 Backfill is a positive but bounded repair path

CalendarBackfillService.backfillProjects/backfillProjectTasks selects nondeleted, dated source rows, maps Project.status or task.isCompleted into calendar status, and upserts them. A silently changed eligible task can therefore be repaired by an invocation that includes it. This narrows the earlier notification-gap interpretation: missed emission does not prove permanent drift. [S12]

Limits in the inspected composition:

- These methods do not page through all eligible source rows. The common client's findMany safety cap is 1,000; a larger business cannot be assumed exhaustively rebuilt by one such selection. This is a code-composition boundary, not a measured affected tenant.
- They upsert selected dated/nondeleted rows. Missing, deleted or newly undated source objects are not thereby removed from the projection. A separate prune helper exists in the projection service, but invocation as part of these named backfills is not shown.
- Upsert can restore a previously soft-deleted calendar row. A hide/cancel operation needs explicit semantics so reconstruction does not accidentally reverse a legitimate user decision or mistake a view preference for domain cancellation.
- Eventual repair cadence, all caller paths and actual outcomes were not executed or exhaustively traced.

[S07/S10/S12]

A safe target makes the calendar derivative: requests to complete/cancel source work go through the domain owner, and projection reconstruction follows durable source transition identity. It does not turn the calendar into a second project lifecycle authority or assume more event emissions alone solve consistency.

## 5. Time-to-invoice: exact source allocation must survive

### 5.1 Actual guarded chain and useful safeguards

The commerce from-time route uses authentication/business/module/plan-limit controls and the revenue write scope, then calls TimeEntryService.invoiceUnbilledTime with CommerceService.createInvoice as a callback. The time-entry controller also has guarded create/update/bill operations. These are not unauthenticated money endpoints. [S13-S15]

invoiceUnbilledTime selects billable, unbilled entries with non-null duration, ordered by startTime, optionally within a project. It refuses an empty selection and missing hourly rates. It builds invoice line items, awaits invoice creation, marks all selected entry IDs billed, and checks the affected count. Preserve these safeguards. They correctly reject some silent-zero states. [S13]

### 5.2 Deterministic alternate-rate overwrite

The grouping loop looks up only the base label. When another rate is found, it writes a suffixed key but does not later look up/accumulate that suffixed group's existing minutes:

```text
existing = byLine.get(label)
if existing rate equals current rate:
    accumulate into the base group
else if existing:
    set label + "(@ current rate)" to the current entry
else:
    create base group
```

With the same label and this start-time order:

| Entry | Minutes | Hourly rate | Source value before tax/discount |
|---|---:|---:|---:|
| A | 60 | 100 | 100 |
| B | 30 | 200 | 100 |
| C | 45 | 200 | 150 |
| Total | **135** | | **350** |

A creates the base group. B creates the rate-200 group. C sees the rate-100 base again and **overwrites** the rate-200 group with its own 45 minutes. The resulting lines are 60 minutes at 100 and 45 minutes at 200: **105 represented minutes / 250 source-line value**, not 135 / 350.

All three entry IDs still feed markAsBilled. If their marking succeeds, `marked.count === ids.length` passes and the returned totalMinutes remains 135 because it is computed from the original entries. Thus count completeness, reported minutes and represented invoice value can disagree while the method returns normally. [S13]

This is a **static algorithm counterexample**, not an application test or a claim a real customer was underbilled. The chosen durations are exact in hundredths of an hour, so this example does not depend on disputed rounding behavior, tax or discounts. The source comment promising near-cent rounding is not used as proof of a general monetary bound.

The existing source tests include one entry at each of two rates, not repeated entries at the alternate rate. They therefore do not exercise this overwrite shape. They also preserve useful same-rate aggregation, empty/missing-rate rejection and billed-count mismatch behavior. No test was edited or run. [S16]

### 5.3 A later count check is not an atomic billing claim

Invoice creation precedes the billed update. Two concurrent calls can both read the same unbilled entries and create invoices before either claims those entries. The later caller can then throw on a count mismatch **after** its invoice exists. The source explicitly acknowledges two-step atomicity limits; this trace preserves that honesty instead of describing the check as no protection. [S13]

No real concurrency incident was reproduced. The conditional sequence requires both callbacks to succeed. It establishes why the returned error is a partial outcome requiring reconciliation, not evidence that no invoice was created or permission to blindly retry.

Other named consistency pressures:

- Updating/deleting a time entry checks billed state before the later write; the write does not consume the earlier entry revision/billed predicate. An intervening billing operation needs an explicit mutation-time rule.
- Marking selected IDs billed proves neither their minutes/rates stayed unchanged after selection nor that invoice lines represent the same revision.
- The direct markAsBilled path verifies the invoice/business and filters billable/unbilled IDs; it does not itself prove each source entry's value allocation is present in that invoice.
- The selected findMany is bounded by the common client cap. Billing a bounded selected set can be legitimate, but a response must not silently imply all business time was processed.
- Grouping by display label can merge different same-title tasks/projects. A readable invoice may intentionally aggregate them, but it still needs underlying entry-to-line allocation provenance.

[S07/S13/S15]

Candidate invariant: for each accepted billing occurrence, every selected immutable entry revision has an explicit allocation into the priced invoice lines, and no other billing occurrence can claim the same eligible allocation without an explicit correction/rebill policy. Source minutes/rates, invoice taxes/discounts, financial postings and payments remain distinct layers. J7's ledger/posting owner is not replaced by a new task finance engine. [R02]

## 6. Work-obligation settlement: reuse the existing owner

The shared WorkObligationRaised/Settled contract already defines a CommandItem semantic tuple:

```text
businessId + sourceModule + sourceType + sourceId + actionType
```

Settled supports an exact source tuple or a party-wide owedToId/actionType path. The listener validates required raised-event fields, upserts the obligation, and preserves an existing user disposition instead of blindly resurrecting it. Exact settlement filters the target identity and outstanding state; party-wide settlement deliberately matches a broader set. These are existing mechanisms, not missing architecture to rebuild. [S17/S18]

Do not connect one project checkbox to a party-wide discharge merely because both share a customer. The target completion receipt must identify which obligation occurrence/scope was satisfied. A CommandItem discharge is an attention/work projection result; it is not independently proof of customer acceptance, contract performance or payment settlement.

The inspected task/project/calendar methods do not establish that exact bridge. Searches surfaced event definitions, the obligation listener and other producers, but search absence is not proof that no adapter exists anywhere. Portal and change-order modules are present in AppModule; their existence likewise is not proof that J8 acceptance is already implemented. [S06/S17/S18]

**Explicit remaining gap:** authoritative delivery acceptance, milestone-to-invoice settlement and the complete source-task/contract-to-CommandItem route still need the named producer/consumer trace. M002 closes the event-contract/owner identification, not the entire commercial obligation chain. Required-versus-optional work, accepted scope revision and retrospective changes cannot be finalized until that boundary is inspected.

## 7. Bounded canonical comparison and model reinjection

The current 04B allocation ledger was read. No new canonical IDs are allocated. The actual KF-REC-056 boundary and J7 dossier were read, with M001's J10/J11/J18/J23 comparisons retained as inherited architecture evidence. Older dossier headings do not override current programme state or this forensic baseline.

| Candidate pressure | Existing canonical owner / boundary | Decision |
|---|---|---|
| Attachment presence or verified stamp used as qualifying completion evidence | KF-REC-056 explicitly requires consumer/target, exact evidence reference, admission policy and reviewer authority where required; delegates generic provenance to REC049. F219's registered proven manifestation is document extraction becoming payment evidence. | **Reuse admission semantics; retain J8 source manifestation separately.** Do not silently claim F219 already proves this task path or allocate a duplicate evidence engine. |
| Calendar as alternate completion writer | K6 source transitions; K7/REC047 derivative temporal work; M001 event consequence analysis. | **Refine the shared completion-writer boundary with W8-10.** Keep permissions and backfill positives; don't transfer lifecycle ownership to a projection. |
| Assignment replacement/direct writers | K2 current authority and existing TaskAssignmentService checks; K11 ownership/atomicity. | **Reuse current service checks, reconcile direct writers.** Exact schema constraints and contractor eligibility remain scoped debts. |
| Repeated alternate-rate grouping loss | J7/REC052 financial truth and existing commercial invoice owner; J10 descendant-completeness laws apply but do not prove this numerical overwrite. | **CAND-BILLING-ALLOCATION retained as an independent source-specific candidate.** It violates source-to-line conservation, not merely downstream event dedupe. Full historical financial-register comparison remains before F allocation. |
| Invoice exists but selected time not fully claimed | J18/REC048 preserves partial outcomes and same-effect recovery; J7 owns authoritative invoice/posting consequences. | **Reuse partial-outcome/claim semantics**, preserving the current count mismatch detection. A new engine or blind retry is not warranted. |
| Generic completion discharging obligations | 04B's F217/C167 is the Contract renewal-edit manifestation; existing work-event tuple/listener is a usable seam. | **Related, not automatically identical.** Explicit source occurrence/scope binding remains CAND-COMPLETION-BOUNDARY until the producer/acceptance trace and register comparison finish. |

[R01-R04; retained M001 references]

The bounded comparison is sufficient to avoid allocating by resemblance. It is not a claim every F185-F221 supplement was reread or all independent J8 candidates are already classified. F228/C178/KF-REC-058 remain available and unallocated.

### Candidate composition, not a new parallel platform

```text
exact work/obligation scope + current actor/assignment authority
 -> completion request from UI, calendar, plan or automation
 -> policy-specific evidence admission
 -> expected-state/source-scope transition
 -> durable outcome and required consequence identities
 -> derived calendar / plan / attention settlement

separate billing decision over eligible source-entry revisions
 -> exact source-to-line allocation + one billing owner
 -> canonical invoice creation / known partial outcome
 -> billed linkage and recovery receipt
 -> J7 accounting/payment truth, not inferred from a task checkbox
```

Both paths use existing project, evidence, assignment, commerce, temporal and recovery owners. Neither makes customer approval universal. Neither assumes a fulfilled task must always be billable, a billed time entry proves delivery acceptance, or a paid invoice proves all work is complete.

This preserves the blueprint's integrated business-flow intent and controlled flexibility. During testing, optional behaviors and policies may change through reviewed revisions. Removing a required task or switching a pricing implementation must not retroactively erase its obligation/evidence or silently convert unallocated hours into billed work. [P1]

## 8. Migration obligations newly made concrete

1. **Completion writer inventory:** add calendar source writeback to M001's UI/status/reorder/plan/project paths. Reuse its visibility/mutation permission but route authoritative state changes through the same domain admission; no partial cutover advertised as complete.
2. **Evidence and assignment:** keep tenant context and scoped assignment checks. Validate polymorphic target lineage and actual initiator, carry the transaction client/current decision into direct writers, and distinguish evidence withdrawal from erasing proof history.
3. **Projection repair:** define hide versus domain cancel, page eligible sources and reconcile absent/deleted/undated rows under explicit policy. Preserve known source transitions and do not revive legitimately hidden/cancelled scope by accident.
4. **Billing allocation:** characterize existing invoices/marked entries before repair. Fix grouping without losing source-entry identity; use exact revisions and a durable billing occurrence/claim around the existing invoice owner. Reconcile invoices already created on a failed marking path rather than issuing a second one.
5. **Historical truth:** unknown prior evidence or missing invoice allocations remain explicit. Do not bulk-certify old tasks or retroactively change issued invoices without the financial owner's correction policy. Retain the safe rollback floor from J24.

These are migration design constraints. No data repair, transaction redesign, constraint, grouping patch, test assertion or source code has been implemented here.

## 9. Eight additional local proof designs - NOT_EXECUTED

| Case | Required isolated characterization / acceptance |
|---|---|
| Y01 | Ordinary guarded evidence paths preserve tenant context; nonexistent/wrong-target/withdrawn or wrong-revision references cannot stand in for applicable completion admission. Verification and simple-note policies remain distinct. |
| Y02 | Dedicated and direct assignment/time-reference writers enforce the same eligible tenant/parent/assignee relation and real actor provenance; interrupted replacement preserves explicit ownership. |
| Y03 | Calendar complete/reopen/cancel uses the source transition, keeps Boolean/status/plan state coherent, and does not report source success when update count is zero. |
| Y04 | Backfill repairs silent changes across a paginated source set and treats deleted/undated/hidden records explicitly without accidental resurrection. |
| Y05 | Same-label 60 minutes at 100, then 30 and 45 minutes at 200, conserves all 135 minutes and 350 pre-tax source value; all entry-to-line allocations remain reconstructable. |
| Y06 | Two billing requests and a crash after invoice creation do not produce an untracked duplicate; mismatched marking remains a truthful partial outcome, not no-invoice failure. |
| Y07 | A rate/duration edit, delete or direct bill during selection/invoice creation cannot change the claimed entry revision invisibly; counts alone cannot satisfy value conservation. |
| Y08 | Exact project/acceptance scope settles only the intended obligation; party-wide discharge is explicitly authorized for its larger scope, and CommandItem state is not mistaken for contract/payment proof. |

M001 X01-X12 remain unchanged. J8 now has **20 local designed cases across X/Y, zero bindings and no executed application results**. The separate J13 44-case manifest is unchanged. The existing invoice-unbilled source test was inspected, not run. The monetary table is a derivation of the shown algorithm, not a generated invoice.

## 10. Closure and finite next action

**Completed at named scope:** tenant/evidence context chain; assignment eligibility versus direct-writer comparison; calendar writeback and bounded backfill; time-billing group/claim/entry-revision analysis; existing obligation event/listener owner; bounded comparison with REC056, J7 and the allocation ledger.

**Still open:** complete Evidence/TaskAssignment constraints and retention integration; acceptance/portal/change-order and milestone obligation producers; exact project-to-CommandItem bridge; final financial-register anti-duplication; accepted shared completion/billing contract and backward convergence review. J8 remains **NOT CONVERGED**.

Next: **J8_COMPLETION_SCOPE_AND_BILLING_CONTRACT_REVIEW**.

Produce `J8-COMPLETION-SCOPE-AND-BILLING-CONTRACT-REVIEW.md` in three ordered steps:

1. Resolve the retained named boundaries: exact Evidence/TaskAssignment schema/constraint shapes, scoped assignment replacement, project portal/change-order acceptance and milestone/time-to-invoice/obligation producer consumers. Trace only paths that determine the required scope/accepting actor/settled identity. A remaining unobserved deployment constraint must stay explicit, not be invented.
2. Complete actual canonical comparison for CAND-COMPLETION-BOUNDARY and CAND-BILLING-ALLOCATION, then specify the minimum authoritative completion/scope and source-entry billing allocation contract. Reuse current services/claims/evidence/financial correction owners, and preserve lightweight policies, configurable scope and honest unavailable states.
3. Backward re-audit J11/J12/J7/J18/J23/J2/J15/J24, classify analytical closure gates and decide declared-scope alignment or name the exact unresolved invariant. A candidate document is not execution authorization and tests remain unexecuted until an authorized isolated environment exists.

Do not repeat M001's creation/UI discovery or M002's guard/config scan. Do not update any programme-map artifact or run its generator/check. Preserve the scheduled-cycle halt and all existing J13/J24 acceptance limits, ED1-ED5 and CS1-CS5.

## 11. Source manifest and evidence exactness

All S sources use `8f173bfe79f1418159cf4099ea18b0d60d203ec2`. Scope is the named inspected methods/ranges, not a claim to have audited every line in the containing module.

| Ref | Source / scope | Blob SHA |
|---|---|---|
| S01 | apps/server/src/modules/evidence/evidence.controller.ts; declared routes/guards/principal propagation | 37dc42fef2611a638e804a7a6d92f8da2cf46225 |
| S02 | apps/server/src/modules/evidence/evidence.service.ts; submit/get/verify/delete/checkTaskEvidence | 50bad29fddec2e71c5b31a8050bf52b22d93461d |
| S03 | apps/server/src/core/auth/business.guard.ts; complete guard | 3d31a1104cac22a70ef29376672e0d0834f335a8 |
| S04 | apps/server/src/core/tenant/tenant.interceptor.ts; context construction/subscription | 5578b2c1bfe49e97876ebc83c3a972ec62a4a79a |
| S05 | apps/server/src/main.ts; first 240 lines, context-provider registration | 352002fa27f0663ada53e25a06d210d0c81a053f |
| S06 | apps/server/src/app.module.ts; declared module/interceptor/middleware registration, not successful boot | a8fd78a84ecffaf617b55dd0bbd2aa1c62730e93 |
| S07 | packages/db/src/client.ts; 1-310 and 325-625, scoped models/soft-delete/read cap/tenant write composition | 33f8dd53553ffda959466bc14121dc3870dc0d56 |
| S08 | apps/server/src/modules/task-assignments/task-assignment.service.ts; assign/eligibility, scoped listing/workload and transfer, including continuation 410-end | a83d6a56983cbc6092947b43a42c20a1531795ad |
| S09 | apps/server/src/modules/task-assignments/task-assignment.controller.ts; guarded routes/actor and business propagation | b59654ab596efab4b6b3b779bc5c5838415b2940 |
| S10 | apps/server/src/modules/calendar/calendar-projection.service.ts; source writeback, upsert, cancellation and prune helper | 1fea26272290d4fbe23a0783c80c554ff9dbff4a |
| S11 | apps/server/src/modules/calendar/calendar-query.service.ts; 320-570, patch/cancel permission and source/projection ordering | 94cec16ae5676bd72d4365ea4eed2110c1d81376 |
| S12 | apps/server/src/modules/calendar/backfill.ts; project/task eligibility, mapping and upsert; not all caller execution | ef6bd1812713d29266243ad1d079afd9e122ec03 |
| S13 | apps/server/src/modules/time-tracking/time-entry.service.ts; 1-275 and 305-end; full billing loop reread 340-465 | f9acbf100ad2181c703faad7a9450e7742096d9f |
| S14 | apps/server/src/modules/commerce/commerce.controller.ts; 390-470, guarded from-time invoice callback | 6ae7cb93082846f05004499bfa1da7acda355e9a |
| S15 | apps/server/src/modules/time-tracking/time-entry.controller.ts; guarded time/bill route contracts | a592bb0d6a081e5b56a744f6f49bb3fdbb2aeddb |
| S16 | apps/server/src/modules/time-tracking/invoice-unbilled-time.spec.ts; mock test source | 7a6f356c38918e943357204bee4803551c592202 |
| S17 | packages/shared/src/work-events.ts; raised/settled identity contracts | 1db17e4aa361d43cf134c529fd655d528d44dd97 |
| S18 | apps/server/src/modules/command/obligation.listener.ts; raised/upsert and exact/party settlement | 46a2a7676a07278a18b470a93d8762e033ff7ff4 |

Other reads were discovery/support, not an enlarged exhaustive audit: app-bootstrap.ts (de86d21c120876741b84a388b2307c7d8d741f94), calendar controller/service, module directory listings and schema retrieval. Complete relevant Evidence/TaskAssignment DDL was not successfully isolated from the large returned schema; do not use this tranche to assert all database constraints absent. Schema discovery ranges containing unrelated models are not evidence for J8. Search results use default-branch discovery; material implementation conclusions above use pinned file reads.

R01: `10O-RECOMMENDATION-REGISTER-DOCUMENT-EVIDENCE-REVISION-INTEGRITY-CONTINUATION.md`, first 160 lines, blob 96e2478fd4925cf58fc60153fbd872d5c5d0bf9b, and J12 dossier. R02: J7 Financial Truth dossier, first 135 lines, blob 82cd8b442cdff6e1b59a29f28999d74af1104a4e; its old internal baseline is retained provenance, not a new source baseline. R03: `04B-CANONICAL-ID-ALLOCATION-LEDGER.md`, first 150 lines, blob 24514b3e9559a229cb83d7d3c2a863af035a6952. R04: M001's explicitly read J10/J11/REC047/REC048 comparisons, inherited rather than falsely counted as fresh rereads.

P1: supplied KEYFLOW v3 / Master Execution Blueprint, Phase X payment/project intent and section 6 controlled-change/isolation/integration guidance. The current source controls, extra writers and billing findings here are repository evidence/analysis, not claims those defects or remedies were stated in P1. No external provider/framework-wide rule was needed to derive the local source counterexamples.

## 12. Context and publication boundary

Context integrity: **PASS FOR THE BOUNDED M002 CONTINUATION**, with missing schema/acceptance/settlement evidence explicitly retained. Input ref and parent tree were verified; baseline, current handoff, M001, canonical allocation and prior J13/J24 constraints were preserved. Prior live hosting/owner observations remain inherited, not freshly certified here. Current authority and user map pause remain distinct from the historical forensic snapshot.

Publish this analysis, a current overlay in the J8 dossier and matching CURRENT/ROLLOVER navigation in one intelligence-only checkpoint. Preserve M001, all prior J13/J24 evidence, the 44-case manifest, kernels, maps, tests and production source. No new dossier is added: coverage stays 21/25, not application completion. Persistence verification is a Git/document check, never an application test.
