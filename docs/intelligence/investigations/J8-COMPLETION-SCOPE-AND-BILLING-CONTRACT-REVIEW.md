# J8 - Completion Scope and Billing Contract Review

Checkpoint: `J8-CSB-2026-09-16-01`  
Date: 2026-09-16  
Intelligence input: `54342851973907ce3fd2f0a00928b0cca79288ad`  
Implementation forensic baseline: `8f173bfe79f1418159cf4099ea18b0d60d203ec2`  
Disposition: **REVIEW COMPLETED; NAMED COMPLETION / SCOPE / TIME-BILLING CORE PROVISIONALLY TARGET-ALIGNED**  
Implementation conformance, deployed constraints and runtime proof: **NOT ESTABLISHED**.

This is the bounded target and acceptance home following [M001](J8-PROJECT-WORK-DELIVERY-MICROTRACE-001.md) and [M002](J8-PROJECT-WORK-DELIVERY-MICROTRACE-002.md). Neither microtrace is rewritten. The review closes their named source-schema and contract decisions; it does not certify every work-management, public-portal, finance or retention path. Production source, schemas, assertions, hosting settings and workflows remain unchanged. No application, provider, database, boot, concurrency or migration test was executed. The programme map remains frozen at J24-PA and its generator/check was not run. Scheduled cycles remain halted.

## 1. Scope and decisions completed

| Review item | Disposition | Exact boundary |
|---|---|---|
| Evidence and TaskAssignment constraints | SOURCE QUESTION CLOSED | Full model blocks are now read at schema lines 10369-10414 within the fetched 10345-10418 range. Declared keys/fields are distinguished from uninspected deployed migrations/triggers. |
| Scoped assignment replacement | SOURCE / TARGET DECISION CLOSED | The lifetime tuple uniqueness plus the existing create-after-unassign method has a concrete A -> B -> A failure sequence. The selected target separates active ownership from historical episodes. |
| Portal / change-order acceptance | NAMED SURFACES CLASSIFIED | Inspected portal service/controller/client manage access, not a delivery-acceptance decision. Change-order PATCH accepts approval assertions and mutable terms; it does not bind an authenticated decision to a frozen scope. This is not a claim that no other public surface exists. |
| Milestone / invoice / obligation meaning | BOUNDARY SPECIFIED | Milestone date/reference editing is not invoice creation, payment or exact obligation settlement. A source-to-settlement adapter must consume the exact accepted scope/occurrence; no currently working bridge is invented. |
| Canonical comparison | BOUNDED COMPARISON COMPLETED | Existing admission, authority, correction and recovery laws are reused. The numerical source-time loss is independently stable and allocated as F228/C178. No new recommendation or concept ID. |
| Completion and billing contract | DESIGN SELECTED | Sections 4-7 define authority, scope, write sets, allocation conservation, retry, correction and compatibility over existing owners. |
| Backward re-audit | BOUNDED TARGET ALIGNMENT | Existing J11/J12/J7/J18/J23/J2/J15/J24 ownership is retained. Implementation and broader coverage debts remain separate. |

The named core consists of M001/M002's W8-01-W8-10 writers, their evidence/assignment interfaces, current change-order and portal-access boundaries, project milestones, and the from-time invoice allocation path. Retainers, the complete public portal, every alternate executor, deployed data and all legacy migration constraints are not included in a universal conformance claim.

## 2. New source evidence and corrections

### 2.1 Evidence is a polymorphic reference, not an accepted completion decision

The complete Evidence model has a Business foreign key, polymorphic linkedType/linkedId strings, submission fields, optional checksum and verifiedBy/verifiedAt, and ordinary indexes. It has no declared target foreign key, policy/scope revision, accepted-decision link or deletedAt in that model. submittedBy/verifiedBy are strings, not declared principal relations. [S1]

This closes M002's extraction gap. It does not prove all deployed database controls absent. Existing HTTP guards, ambient tenant scoping and EvidenceService checks remain the positive boundaries already traced. The stronger missing guarantee is target and decision lineage: the same-tenant attachment must be eligible for the exact completion claim. An optional checksum being present is not proof it was verified, and a verification timestamp is not itself the required consumer decision.

Retention must preserve a reconstructable decision even when a file is withdrawn or disposed of under J19 policy. This does not require retaining sensitive content forever. Retain permitted decision metadata and disposition lineage; make revoked/withdrawn support visible without fabricating proof or silently undoing unrelated financial facts.

### 2.2 Assignment history currently conflicts with reassignment

The TaskAssignment schema declares:

```text
UNIQUE(taskType, taskId, assignableType, assignableId)
```

The key does not include unassignedAt or an episode identity. The row has no declared task/assignee foreign keys or businessId. The scoped service nevertheless validates supported task and assignee eligibility; preserve that protection. [S1/S2]

The assign method returns an existing ACTIVE identical assignment. Otherwise it marks current assignments unassigned, then creates a new row in a separate operation. Combining those facts gives this conditional source sequence:

```text
assign A -> row A exists
replace A with B -> row A retained with unassignedAt; row B active
request A again -> no ACTIVE A found
 -> mark B unassigned
 -> create same lifetime tuple for A
 -> declared unique key rejects that insert
```

With the declared constraint applied, and no outside transaction changing the observed sequence, B's unassignment can remain after the failed insert. This is not a reproduced incident, nor an assertion no migration has altered the deployed key. A unique historical tuple is neither exactly-once reassignment nor a single-active-assignee constraint: different assignees have different keys.

Selected correction: one policy-defined active assignment slot/set is transitioned atomically, and each assignment episode remains reconstructable. Existing TaskAssignment may remain a current association projection, provided immutable episode/decision evidence is preserved through existing BusinessEvent/authority machinery. Do not simply delete the old row or overwrite its only history to permit A again. Single-assignee versus multiple named roles must be explicit policy, not an accidental consequence of a uniqueness constraint.

### 2.3 Change-order approval is currently editable input

ChangeOrderController's validated update DTO accepts status, approvedBy and approvedAt. The controller converts the supplied date and forwards it with the business scope; it does not pass a separately resolved approval actor. ChangeOrderService checks the change order belongs to the requested business and, when invoiceId is supplied, checks that invoice belongs to the business. These are existing strengths. [S3/S4]

The same update allows originalScope, newScope, additionalAmount and additionalHours to change while previously stored approval fields remain unless explicitly supplied. No approved-content fingerprint, expected revision, current decision validation or approval invalidation appears in this method. Thus an APPROVED row can describe later-edited terms without a new approval decision in the inspected path. The model stores no approved revision reference. [S1/S3/S4]

This is an authenticated, tenant-scoped API, not a public unauthenticated approval endpoint. The defect boundary is that client-supplied approval identity/status/date and a mutable scope are not independently established acceptance. Manually recorded external approval can remain a supported assertion, but must identify that provenance and pass the applicable evidence/authority policy before becoming authoritative approval.

### 2.4 Portal access is not delivery acceptance

The inspected portal service issues or rotates random tokens, checks enabled/expiry on lookup, revokes access and stores visibility settings. Its controller exposes access administration plus token validation; the inspected web page and client administer those links. None of these inspected methods performs a project/deliverable acceptance decision. [S5-S8]

The web page creates a /portal/{token} URL. A literal apps/web/src/app/portal/[token]/page.tsx lookup did not resolve, but route groups/other implementations were not exhaustively inventoried; this is NOT proof that all portal URLs are broken or that no customer surface exists.

Selected boundary: an existing portal access grant may supply restricted identity/context, but visibility of projects is not permission to approve every project or price change. An acceptance action needs an explicitly authorized purpose, exact contact/subject/scope revision, current grant/delegation status and replay identity. Record a bearer-grant holder honestly as that kind of actor unless stronger identity was actually established. Do not fabricate a named authenticated human from a display contact or body field. Reuse PortalService and K1/K2/K3 rather than invent a second login/authority engine. Full J21 public-experience conformance remains a later coverage obligation.

### 2.5 Milestone and deliverable fields are weaker than settlement

ProjectMilestone has a Project relation, amount, completedAt and scalar invoiceId; the inspected block has no invoice foreign key or acceptance-decision identity. ProjectsService.updateMilestone validates milestone/project/business ownership, then directly writes the supplied date/reference. Unlike ChangeOrderService's supplied-invoice path, it performs no invoice ownership lookup in this method. [S1/S9]

ProjectDeliverable has real persistence, tenant/project ownership checks and a status vocabulary that includes ACCEPTED. Its update method stamps completedAt for any non-PENDING supplied status. It does not capture the accepting principal, accepted scope/file revision or decision reference. Changing a URL while omitting status can preserve the existing accepted-looking state. [S1/S9]

Do not infer a successful invoice or fulfilled contract from these fields. A valid linked invoice must also represent the correct party, commercial scope, currency and billing purpose, not merely exist in the same business. A manually linked invoice can remain supported, but requires that relationship decision rather than a scalar assignment masquerading as proof.

## 3. Canonical comparison and allocation

Read scope: 04/04A/04B; J7's F185-F187 definitions; 08Z and 08AA-08AE covering F188-F196; 08AH commercial lineage; 08AT/F217; 08AV/F219; 10K/REC052; K10 dossier. M001/M002 retain their documented REC047/048/055/056 and J10 comparisons. Older internal baselines/headings are historical provenance, not this tranche's source baseline. [R1-R6]

| Candidate | Comparison | Disposition |
|---|---|---|
| CAND-BILLING-ALLOCATION | F185/F194 concern derived financial projections; F186 concerns currency aggregation; F188/F190 concern missing accounting/ingress consequences; F189 concerns a source discriminator; F191-F193 concern correction/period/ledger ownership; F195/F196 concern credit withdrawal/state algebra. F200 concerns composing deposit and final receivables. None establishes loss of selected same-currency source minutes while marking all entries billed. | **RELATED DISTINCT: allocate F228/C178.** The violation occurs while constructing commercial invoice lines, even if all provider/ledger/replay mechanisms subsequently succeed. |
| Invoice created before billed claim completes | REC048's same-effect and consequence-completeness law already covers partial local success; F190 is specifically ingress receipt consumption, not this callback. | **REUSE recovery/claim semantics.** Preserve the time-billing manifestation; do not reclassify it as F190's exact proven source or allocate a second retry engine. |
| CAND-COMPLETION-BOUNDARY | F217 is a specific false contract-renewal discharge; F219 is document assertion becoming payment evidence. KF-CONCEPT-027/030 and existing governance/admission contracts already distinguish exact approved action, actor lineage and consumer-specific evidence. | **Resolve as a composite J8 contract obligation, not one catch-all new finding.** Retain each source witness in M001/M002/section 2. Reuse shared laws without claiming F217/F219 proved every task path. |
| Assignment lifetime tuple versus episode | Current schema/service gives a new specific witness of identity and state-transition mismatch. It is not the numerical billing root. | **RETAIN named source witness; no additional canonical ID in this bounded review.** Its correction is included in WC02 and migration, not discarded because no number was assigned. |
| Approval assertion or accepted URL survives changed scope | ActionFingerprint, PrincipalLineage and REC055/056 revision/admission ownership already require exact content binding. | **SPECIALIZE the existing contract**, explicitly retaining ChangeOrder/ProjectDeliverable witnesses. No second approval or document engine. |

F228 owns only source-time-to-invoice allocation loss. Its canonical definition is [08BD](../08BD-FINDING-REGISTER-TIME-BILLING-ALLOCATION-SUPPLEMENT.md); C178 is [09BD](../09BD-CONTRADICTION-REGISTER-TIME-BILLING-ALLOCATION-SUPPLEMENT.md). This is a bounded semantic comparison, not a claim every historical file was exhaustively audited. 04B advances to F228/C178; **next free F229/C179/KF-REC-058**. Recommendation and concept ranges are unchanged. Old investigation statements that F228 was unallocated remain true of their historical checkpoints, not current allocation.

## 4. Selected minimal contract: ownership and coordinates

This section specifies TARGET DESIGN, not implemented data structures. WC/WB identifiers are local transition labels, not new canonical concepts or required database tables.

| Coordinate | Authoritative responsibility | Existing owners to strengthen |
|---|---|---|
| Delivery scope revision | Which source obligation, deliverables/tasks, dependencies and required/optional policy were accepted | Project/ProjectPlan/ChangeOrder, consuming J11 commercial commitments and K7 WorkDefinition semantics |
| Assignment episode / active slot revision | Who currently owns which work role, under whose eligible assignment decision | TaskAssignmentService and existing project writers, K2 authority and K8 BusinessEvent evidence |
| Evidence admission | Why specific referenced evidence qualifies for this subject/revision/claim | Existing EvidenceService plus REC056 admission and generic REC049 provenance |
| Completion/acceptance decision | Exact actor/delegation, target revision, policy and result; completion need not equal customer acceptance | Project domain transition owner under K6, with K2/K3/J15 current authority |
| Consequence receipt | Which required child/projection/obligation consequences belong to the same semantic transition | Existing event/claim infrastructure, K7/K8/K11 and REC048 |
| Billing occurrence and source allocation | Selected entry identities/revisions, pricing/rounding basis, exclusive allocation and canonical invoice identity | TimeEntryService plus Commerce/InvoiceWorkflow; K10 owns financial policy, K11 claim/recovery |
| Operator and calendar views | Derivative status with causal source/receipt and completeness | Calendar projection/backfill and existing work-obligation/CommandItem consumers |

One logical transition owner does not mean one giant service, one universal task table or synchronous calls across every module. Preserve separate domain owners. Where an immediate local user result must be atomic, compose their existing repositories under an explicitly shared transaction/claim boundary; later consequences consume durable event intent. An in-process emit after a write is not by itself a durable receipt. Current methods that only accept the global Prisma client need an explicit transaction-context interface before that guarantee can be claimed.

### Required scope without rigidity

Let S be the accepted delivery-scope revision and R(S) its required obligations. Completion of S requires each required member to have the applicable satisfied, accepted, waived or cancelled disposition, with authority/evidence for that disposition. The selected policy defines which outcomes count; deleted rows and an empty current query are not implicit satisfaction. An intentionally empty or cancelled scope requires an explicit disposition, not an accidental all([]) pass.

Adding optional work may leave accepted obligations unchanged. Adding/removing material required work or changing commercial terms creates a reviewed scope revision. Previously valid completion remains historical truth about the earlier revision; it does not silently certify newly added work. Unchanged child results can carry forward only under a declared compatibility/adoption decision. A removed requirement is waived/cancelled/superseded, not pretended completed.

## 5. Completion and acceptance transitions

| Transition | Required decision / compare at commit | Permitted write set and outcome |
|---|---|---|
| WC01 Propose/adopt/change scope | Current actor authority; exact prior scope revision; material change approval where applicable | New immutable accepted revision/decision reference and explicit required set. Supersede current selector; preserve previous scope, evidence and commercial terms. |
| WC02 Assign/reassign | Same tenant and subject-parent relation; eligible assignee/role; expected active-slot revision; real initiator | Atomic retire/current-assignment transition plus new episode receipt. A -> B -> A creates a distinct episode without deleting history or abandoning B before a failed replacement. |
| WC03 Submit/admit evidence | Trusted target identity and tenant; exact evidence revision and applicable consumer policy | Store/reference evidence and separate acceptance/rejection decision. Simple notes allowed by explicit low-risk policy; verification stamps alone do not select policy. |
| WC04 Complete task/work event | Current authority, expected task/plan/scope coordinates, dependencies and applicable evidence decision | Authoritative completion with synchronized compatibility fields and one semantic receipt. UI/status/reorder/calendar/OUT_APP paths consume the same rule. |
| WC05 Accept delivered scope | Current accepting authority or bounded external grant; exact scope/artifact revision; prescribed review | Accepted decision attributable to its actual principal class. A request body approvedBy/date is not authentication. Delivery and acceptance remain separate when policy requires them. |
| WC06 Reopen/cancel/withdraw | Exact current revision and explicit purpose/authority; identify prior descendants | New disposition/occurrence and reconciliation obligations. Preserve previous true completion and financial effects; no automatic refund/rebill or resurrection. |
| WC07 Complete project/milestone | Required-set evaluation for accepted S, applicable acceptance policy, exact expected aggregate revision | Complete only the declared scope. An unrelated edit cannot emit another completion occurrence. Milestone completion is not invoice settlement. |
| WC08 Settle/project consequences | Receipt and exact source obligation occurrence match; idempotent consumer claim | Update applicable calendar/plan/attention consequences; repair missing children for the same occurrence, not reissue confirmed work. |

All material local writers must participate in the same expected-state ordering as scope change, revoke, reassignment and cancellation. A pre-read followed by unconditional update is insufficient; merely placing a read in a transaction without enforceable conflict/claim discipline is not the selected guarantee. Retries preserve operation and consequence identity and re-evaluate current permission where required.

Portal access can support an acceptance purpose only when the grant explicitly authorizes it and is still valid at the material commit. A revoke or scope change after page load invalidates stale acceptance. A revoked grant cannot be restored by updating a projection. No portal redesign or new authentication provider is prescribed here.

### Exact work-obligation bridge

Reuse the existing business/sourceModule/sourceType/sourceId/actionType event contract, but bind the producer's source coordinate to the intended obligation occurrence and scope. A stable Project ID alone must not ambiguously stand for every successive delivery revision. Select an explicit occurrence reference through the existing contract or a versioned compatibility adapter; do not silently reinterpret existing rows or generate a fresh random identity on retry.

The receipt supplies the matching source decision. Exact settlement may discharge only that occurrence. Party-wide settlement is a separately authorized broader operation with an enumerated/evidenced consequence scope; it is not a fallback when a project reference is missing. CommandItem and CalendarEvent remain projections, not the authority that invents delivery acceptance.

## 6. Billing allocation contract

### WB01 - Select immutable source basis

Build a bounded selection manifest: tenant, customer/commercial purpose, currency, source TimeEntry IDs and observed revisions, task/project relationship, duration unit, hourly rate, tax/discount policy, selection window and completeness/cursor information. Snapshot the values that pricing actually consumes. Reading all unbilled rows through a capped query does not imply all business time was selected.

The initial target supports whole-entry billing consistent with the current Boolean model. Partial-entry billing requires a separately explicit quantity/allocation policy, not accidental splitting. A changed entry revision must not bypass a previous charge for the same logical work. Correction/rebill authorization is distinct from claiming an unbilled revision.

### WB02 - Conserve allocation before creating the invoice

Group by typed pricing coordinates, not a display-label suffix. Same-label entries with the same selected rate/currency/pricing basis accumulate into the same group; different rates remain distinct. Human-readable aggregation is permitted, but each source entry retains its destination line/allocation relationship.

For each selected whole entry e, let m(e) be its approved duration in minutes and r(e) its hourly rate. Before taxes/discounts and under the declared precision policy:

```text
source gross basis = sum(m(e) * r(e) / 60)
represented gross basis = sum(source allocations into invoice lines)
```

The latter must conserve the former with only explicitly recorded rounding adjustments. Do not round hours prematurely without accounting for its monetary effect. Use the existing K10 precision/Decimal policy at the financial boundary rather than claiming a field-type change alone solves allocation. Taxes, discounts, FX, credits and payments are separate explicitly reconciled dimensions.

F228's 60@100 + 30@200 + 45@200 example must retain all 135 minutes and 350 pre-tax units. Passing an ID count or reporting minutes from the original selection cannot substitute for checking those allocations.

### WB03 - Claim once and compose with canonical invoice creation

Two requests with different operation IDs can still compete for the same source entries. Therefore dedupe only by request ID is insufficient: each selected logical allocation needs exclusive ownership under the current source revision and eligibility.

Selected local-database target: one shared transaction/claim boundary reserves the eligible entry set, creates the canonical invoice/line/allocation records, records the billing receipt and finalizes the billed linkage. Use existing Commerce/InvoiceWorkflow and pass the actual transaction context through their repositories. A wrapper transaction around a callback that uses its own global client does not meet this contract. Any newly discovered provider/network effect stays outside a retried database transaction under J18's effect protocol.

If existing interfaces cannot yet support that atomic local composition, do not advertise atomic billing. A separately durable reservation may be staged, but it requires fencing, stable invoice-effect identity, explicit recovery and prevention of concurrent reuse. A timeout or unknown callback outcome holds the allocation for reconciliation; it is not permission to create another invoice. This transitional alternative is not automatically approved for deployment.

### WB04 - Finalize, correct and withdraw truthfully

Normal success returns the invoice and exact finalized allocation receipt. A mismatch after invoice creation is a known/uncertain partial outcome with the created invoice reference when known. It is not a clean no-op failure. A billed-entry count is only one check among identity, revision, units, amount and relationship conservation.

After issued/posted financial consequences, corrections use J7's existing credit/void/reversal/adjustment policy and preserve the original source allocations. Do not reset billed=false, delete an issued invoice, or overwrite historic rates to simulate rollback. A failed pre-effect reservation may be released only when absence of the effect and ownership are established. Financial reconciliation and posting locks remain visible rather than being bypassed by a time-tracking fix.

## 7. Source-to-target cutover and reversible testing

| Existing seam | Required target role | Compatibility / withdrawal constraint |
|---|---|---|
| W8-01 general task update | WC03/WC04; validated evidence and exact Boolean/status mapping | Retain task-assignment transaction; do not leave evidenceIds as an unchecked bypass. |
| W8-02 status; W8-03 reorder | WC04 or a non-completing presentation-only move | Existing checkbox/board requests remain usable; batch partial results must be explicit. |
| W8-04 OUT_APP; W8-09 IN_APP | WC04 with exact plan/scope/claim | Honest unavailable IN_APP stays unavailable until real execution exists. |
| W8-05 project; W8-06 revenue | WC07 or a distinct financial readiness observation | Payment is not delivery acceptance; stale revenue events cannot reopen completed/archived work. |
| W8-07 deliverable; W8-08 milestone | WC05/WC07 plus correctly scoped invoice relationship | Bare URL/status/date/link is not acceptance or settlement. Preserve tenant/project validation. |
| W8-10 calendar source writeback | Delegate source requests to WC04/WC06; project derivative result | Hiding a view is distinct from cancelling source work; backfill cannot silently undo either. |
| ChangeOrderController/Service | WC01/WC05 with current actor and frozen terms | Existing body approval metadata is a legacy assertion until independently admitted. |
| PortalAccess/controller/client | Bounded access/context for a separately authorized acceptance purpose | Existing projects visibility is not blanket approval authority; no customer acceptance is presumed implemented. |
| TaskAssignmentService/direct writers | WC02, one expected-state replacement contract | Preserve episodes and parent/assignee checks; don't solve reassignment by deleting history. |
| TimeEntryService / Commerce callback | WB01-WB04 | Preserve existing refusals, one invoice owner and correction history; no unsafe fallback to the known faulty allocator. |

Migration order: characterize affected data and all named writers; introduce compatible scope/receipt/assignment/allocation references; make existing repositories consume them; cut over every writer in the declared protected scope; reconcile projections and legacy partial outcomes; only then retire compatibility fields/readers. Exact DDL, existing-record reuse, index/backfill cost and deployed-constraint checks remain implementation-readiness work, not a prescription to add one table per concept.

Legacy completion/approval records without reconstructable evidence stay explicitly legacy/unverified; do not certify them during backfill. Legacy billed entries with unclear line allocation require an exception/reconciliation queue; do not automatically re-invoice them. Missing source history cannot be repaired by inventing a scope revision.

During testing, optional variants may be added, disabled, replaced and removed under J24's trusted contract. The active scope, accepted evidence, assignment episodes, source allocations and same-effect identity survive the switch. A comparison-only candidate does not emit live business events or invoices. If no conforming reference exists, disable the affected new action rather than fall back to the unsafe baseline. A legitimate requirement revision can retire a test through reviewed supersession; removing required work or weakening an assertion to obtain green remains prohibited.

## 8. Analytical challenge coverage

COVERED means the selected target specifies the response; it is not a passing application result. All original X/Y cases remain in their original microtraces, unmodified and unexecuted.

| Cases retained individually | Contract coverage |
|---|---|
| X01, X02 | WC03/WC04: same applicable evidence admission across all completion writers; validate exact references. |
| X03, X04 | WC04/WC06/WC08: one authoritative transition, compatibility-field agreement and repairable projections. |
| X05, X06 | WC07 plus expected-state ordering: no completion on unrelated edits, no stale revenue overwrite. |
| X07, X08 | Scope/occurrence and required-child receipts: repeat materialization/template processing repairs the accepted source revision instead of new work. |
| X09, X10 | WC02/WC04: current actor/assignee eligibility and explicit partial plan/task completion. |
| X11, X12 | WC01/WC06 and cutover: removal is disposition, not erased requirement; preserve truthful unavailable execution. |
| Y01, Y02 | Evidence target/assignment episode and same-parent checks; retain normal tenant guards. |
| Y03, Y04 | W8-10 delegation, source result verification and explicit paginated/pruning/hide semantics. |
| Y05, Y06 | WB02/WB03/WB04: conservation plus one allocation owner and recoverable partial invoice creation. |
| Y07, Y08 | Exact source revision and exact settlement occurrence; changes do not create a second bill or party-wide discharge. |

Four new local designed cases, Z01-Z04, make the newly resolved schema/acceptance witnesses explicit:

- Z01: A -> B -> A and concurrent assignment replacement preserve one policy-valid active owner and all episodes; failed replacement does not abandon the prior owner.
- Z02: approved change-order scope/price or accepted deliverable content changes cannot reuse a stale approval; request-supplied actor/date remain assertions unless separately validated.
- Z03: portal revocation or scope supersession between viewing and accepting blocks stale acceptance; the actor's claimed identity is not stronger than its actual grant evidence.
- Z04: linking a milestone to an unrelated invoice, or replaying its completion, cannot create settlement or a second charge; tenant equality alone is insufficient relationship proof.

J8 now has 24 local designs (12 X, 8 Y, 4 Z), zero runner bindings and NOT_EXECUTED status. J13's separate 44-case manifest is untouched. No combined passing-test count is computed. Positive source tests from M001/M002 remain evidence of intended assertions, not new run results.

## 9. Backward re-audit and value engineering

| Owner | Disposition and boundary |
|---|---|
| J11 / REC055 | RETAIN: authoritative commercial/contract revision and decision remains upstream. J8 consumes an explicit work scope; generic change-order status cannot discharge renewal or all contract obligations. |
| J12 / REC056 / K8 | RETAIN: exact evidence revision and consumer admission. Add task/delivery consumer requirements, not a second provenance/document engine. |
| J7 / REC052 / K10 | REFINE with F228: financial truth must conserve source-to-invoice allocation before posting. Keep sanctioned posting, correction and reconciliation owners; their known defects are not assumed already repaired. |
| J18 / REC048 / K11 | RETAIN: same-occurrence repair, active claim/attempt distinctions and truthful partial outcomes across materialization, billing and projections. |
| J23 / REC047 / K7 | RETAIN: scope definition, delivery occurrence and attempt differ. Calendar remains derivative; retries cannot adopt edited definitions silently. |
| J2/J15 / K2/K3/K5/K6 | RETAIN: exact current actor/delegation and action binding. Completion, price approval, reassignment and financial correction have distinct proportional control requirements. |
| J24 / K12 | RETAIN: independent acceptance policy, isolated resources and safe withdrawal floor. App tests and administrative changes remain unauthorized here. |
| J21 future public experience | DEFER FULL JOURNEY COVERAGE: explicit portal grant/acceptance interface is now specified; actual public route/identity/readiness proof remains a named conformance debt. |

Options considered: adding checks only to the checkbox is insufficient because other writers remain; replacing all project/evidence/finance systems with one engine is not justified. Select a shared logical completion/scope and allocation contract over existing services, with enforced write-set/claim boundaries. This preserves composability and current useful code while exposing rather than hiding unsupported acceptance/repair paths.

This is a refinement of the blueprint's configurable flows and controlled-change/isolation-versus-integration intent [P1], not literal execution of its historical schema or a guarantee of flawless software. Product scope can evolve; authoritative history and the evidence used to judge it must remain truthful.

## 10. Closure gates and remaining debts

| Gate | Disposition | What was actually established |
|---|---|---|
| G8-01 context, baseline, permissions | PASS_BOUNDED | Current intelligence input, fixed code baseline, owner halt and map pause retained. |
| G8-02 relevant schema questions | PASS_SOURCE | Full declared Evidence/TaskAssignment and milestone/deliverable/portal/change-order blocks read; deployed constraints not inspected. |
| G8-03 acceptance/source boundaries | PASS_NAMED_SOURCE_CLASSIFICATION | Access administration, mutable approval/status and bare milestone links are identified as insufficient proof, not misrepresented as completed acceptance. |
| G8-04 canonical comparison | PASS_BOUNDED | F228/C178 has one home and a stated distinction; other shared laws reused with source witnesses retained. |
| G8-05 completion/scope/assignment contract | PASS_DESIGN | WC01-WC08 and actor/revision/required-set semantics specified. |
| G8-06 source billing allocation | PASS_DESIGN | WB01-WB04 conserve units/value, exclusive logical allocation, exact revision and partial outcome. |
| G8-07 integration and withdrawal | PASS_DESIGN | Named writer cutover, transaction-interface obligation and safe compatibility/history rules specified. |
| G8-08 backward review | PASS_BOUNDED_TARGET | Existing kernel/journey ownership survives with F228 financial-input refinement. |
| G8-09 deployed constraints/data and full consumer inventory | DEFER_IMPLEMENTATION_READINESS | No full migration/trigger/legacy-data or every-portal/worker audit. |
| G8-10 executable proof | NOT_EXECUTED | Twenty-four J8 designs; no installed harness/bindings or runtime outcomes. |
| G8-11 J8 convergence | PROVISIONALLY_TARGET_ALIGNED_NAMED_CORE_ONLY | Source/design loop closed at this scope; not whole work-management or production conformance. |
| G8-12 implementation authorization | UNAUTHORIZED | No app/schema/settings/workflow/assertion changes. |

Remaining J8 debts:

- WD1: final reuse/DDL/index/backfill and deployed constraint validation; preserve evidence/assignment history and repair partial plan graphs.
- WD2: implement and characterize the single completion contract across all named writers, plus any later-discovered portal/executor path before claiming wider coverage.
- WD3: actual grant/acceptance and milestone-to-invoice/exact-obligation adapter conformance; public journey J21 remains separately unanalysed as a whole.
- WD4: exact source-allocation, transaction-client propagation and financial correction/reconciliation against historical invoices.
- WD5: authorized isolated X/Y/Z runtime, concurrency, migration and negative-control proof on a deliberately revalidated implementation baseline.

These are explicit execution/coverage debts, not a request to recreate this design review. Reopen the precise invariant if an implementation, provider, later journey or test contradicts it. J13/J24 alignments, ED1-ED5 and CS1-CS5 are retained.

## 11. Exact next programme action

**J9_MARKETING_LEAD_GENERATION_ACTIVATION** in the existing customer-to-revenue constellation J9/J3/J5/J10/J21/J7.

Planned, not created here: `journeys/KF-JOURNEY-009-MARKETING-LEAD-GENERATION.md`.

Start with actual campaign/content publication -> audience response/lead capture -> Contact/conversation/source attribution -> commercial outcome paths. Distinguish generated content, scheduled/published delivery, observed engagement, qualified lead, attributed conversion and financial revenue. Preserve J5 occurrence ownership, J13 provider authority, J7 value-stage semantics, J8 source-obligation/allocation truth and J24 proof integrity. Do not restart J8's schema/config scan or claim this tranche has already analysed J9.

Map pause and scheduled-cycle halt continue. No application execution is authorized by changing the analytical frontier.

## 12. Reproducible sources and integrity limits

Fresh implementation reads, all at `8f173bfe79f1418159cf4099ea18b0d60d203ec2`:

| Ref | Source and inspected scope | Blob |
|---|---|---|
| S1 | packages/db/prisma/schema.prisma; complete relevant models via 10345-10418 and 10590-10750. Wider ranges were discovery only. | c5f263432b30838b0f9723640282bbdeb2f4cba3 |
| S2 | apps/server/src/modules/task-assignments/task-assignment.service.ts; 1-195, assign/unassign and scoped prerequisites. | a83d6a56983cbc6092947b43a42c20a1531795ad |
| S3 | apps/server/src/modules/change-orders/change-order.service.ts; full. | 9b48815ddaf4297232be1ab8ea9ef8b296ec8f18 |
| S4 | apps/server/src/modules/change-orders/change-order.controller.ts; full DTO/route/principal propagation. | 680ac8a3b9f500b69eca551aa102857326cf261a |
| S5 | apps/server/src/modules/portal/portal.service.ts; full. | d323f6824301308ee46eea494e225a14c1f74d45 |
| S6 | apps/server/src/modules/portal/portal.controller.ts; full. | 8c2d90d9594a092e111c10d915bc85eac366453f |
| S7 | apps/web/src/app/app/portal/page.tsx; full returned access-management page. | 4434aa818ff71b40d7ea2332bc953534a6ec0b04 |
| S8 | apps/web/src/lib/portal.ts; full. | 17265ec5f84f41d2a26d9980678535f24de781b9 |
| S9 | apps/server/src/modules/projects/projects.service.ts; 400-end, deliverable/milestone/template/plan-event methods. | 54ff02cb61a63df9c4b7e1b7c982bbdf9e68a276 |

Inherited pinned evidence: M001/M002 named writer, context, time-billing, work-event and listener manifests. F228 uses M002's exact TimeEntryService source (`f9acbf100ad2181c703faad7a9450e7742096d9f`) and test-source (`7a6f356c38918e943357204bee4803551c592202`) anchors; their code was not changed and their source tests were not run.

R1: 04-CONCEPT-REGISTRY, 04A and 04B at the intelligence input; allocation precedence remains 04B. R2: J7 dossier and K10 dossier; old internal evidence heads remain historical. R3: 08Z, 08AA, 08AB, 08AC, 08AD, 08AE and 10K, actual financial finding/recommendation wording. R4: 08AH commercial lineage and 08AT contract-renewal discharge. R5: 08AV evidence-promotion wording, with REC056 details retained from M002. R6: M001/M002's expressly read REC047/048/055/056/J10 relationships and J24 accepted review, inherited rather than counted as fresh whole-source audits.

P1: user-supplied KEYFLOW v3 / Master Execution Blueprint, configurable flows, Phase X and Execution Addendum 6.1-6.3. It supplies intent and controlled-change guidance. WC/WB contracts and source findings are this review's design/inference, not claims of already-proven blueprint implementation.

Context integrity: PASS FOR THIS BOUNDED CONTINUATION. Live intelligence ref and input commit tree were read; governing AGENTS/current handoff/state and canonical allocation were checked; the previous programme/rollover content remains available in the continuous session. Implementation facts stay pinned; current owner/user controls remain separate. No tenant values or current hosting settings were reread. Large-file retrieval/search limitations were resolved for the named schema blocks using native line ranges; unsuccessful route searches do not establish global absence.

Publish this review, F228/C178 homes, 04B allocation and matching current/dossier/handoff state in one intelligence-only checkpoint. No new journey or kernel is created here: coverage remains 21/25 and twelve kernel dossiers. Git/document publication verification is not application proof. Maps, their tooling and all original microtraces remain unchanged.
