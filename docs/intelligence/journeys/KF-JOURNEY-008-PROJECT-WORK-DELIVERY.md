# KF-JOURNEY-008 - Project / Work Delivery

Checkpoint: `J8-CSB-2026-09-16-01`  
Activated: 2026-09-16  
Status: **PROVISIONALLY TARGET-ALIGNED - NAMED COMPLETION / SCOPE / TIME-BILLING CORE ONLY**  
Intelligence input: `54342851973907ce3fd2f0a00928b0cca79288ad`  
Implementation forensic baseline: `8f173bfe79f1418159cf4099ea18b0d60d203ec2`.

Primary kernels: K6 State Transition, K7 Temporal / Event / Workflow, K8 Evidence & Outcome, K11 Recovery & Reliability. K10 owns the source-billing financial invariant. Secondary: K1/K2/K3/K5/K12. Existing commitment-to-delivery constellation: J11 -> J8 -> J12 -> J23 -> J7; adjacent J2/J15/J17/J18/J24/J21.

Production source/schema/settings/workflows/assertions remain read-only. No application/provider/DB/boot/concurrency/migration tests ran. The programme map remains frozen at J24-PA by user instruction; scheduled cycles remain halted. Target alignment is not implementation conformance or execution authorization.

## 1. Definition and accepted boundary

J8 follows a business commitment into an authorized delivery scope, work plan, eligible assignment, execution, qualifying evidence, acceptance where required, financial consequences and recoverable completion/cancellation.

```text
work requested != assigned != checked off != delivered scope
!= qualifying evidence != customer acceptance != financial settlement
```

Not every lightweight task requires customer approval. Each obligation has an applicable policy, and every writer that claims its completion must consume that policy rather than gaining different authority from its UI or transport path.

The [Completion Scope and Billing Contract Review](../investigations/J8-COMPLETION-SCOPE-AND-BILLING-CONTRACT-REVIEW.md) is now the single target/acceptance home. It specifies WC01-WC08 for completion/scope and WB01-WB04 for source billing. Those are document-local design labels, not new canonical concepts, required tables or implemented services.

The reviewed core consists of the ten named completion-related writer roles from M001/M002; their evidence/assignment interfaces; current change-order and portal-access boundaries; project milestones; and the from-time invoice allocation path. The entire public portal, all work-management/retainer flows, deployed constraints and every worker remain outside a universal conformance claim.

## 2. Preserved evidence chain

| Artifact | Scope and result |
|---|---|
| [Microtrace 001](../investigations/J8-PROJECT-WORK-DELIVERY-MICROTRACE-001.md) | Sixteen named source files; creation, checkbox/status/reorder/plan completion, evidence presence, revenue progression and missed calendar notification. X01-X12 designed, not executed. |
| [Microtrace 002](../investigations/J8-PROJECT-WORK-DELIVERY-MICROTRACE-002.md) | Eighteen named source entries; actual tenant/evidence/assignment safeguards, calendar writeback and bounded repair, exact time-billing loss, existing work-obligation identity. Y01-Y08 designed, not executed. |
| [Contract review](../investigations/J8-COMPLETION-SCOPE-AND-BILLING-CONTRACT-REVIEW.md) | Nine named fresh implementation files; full relevant schema blocks, reassignment-history conflict, mutable approval and portal/milestone boundaries; canonical comparison, WC/WB contracts, migration, backward review and bounded acceptance. Z01-Z04 designed. |
| [F228](../08BD-FINDING-REGISTER-TIME-BILLING-ALLOCATION-SUPPLEMENT.md) / [C178](../09BD-CONTRADICTION-REGISTER-TIME-BILLING-ALLOCATION-SUPPLEMENT.md) | One canonical home for selected source-time value omitted from invoice lines while all source IDs can be marked billed. Verified static code/counterexample, not runtime-reproduced. |

M001/M002 remain unchanged. Older next-action and allocation statements inside them describe their checkpoints, not current state. Historical dossier overlays remain available in the prior committed dossier at `54342851973907ce3fd2f0a00928b0cca79288ad`; this file consolidates current navigation and accepted scope without deleting those source investigations.

## 3. Source findings that remain material

The ordinary project-detail checkbox reaches updateTaskStatus, not the general updateTask evidence gate. Reorder and OUT_APP completion are additional writers. General updateTask can treat a nonempty evidenceIds array as sufficient to avoid rejection without locally validating/linking each reference, and Boolean completion is not universally synchronized with task status or plan-event state.

Project COMPLETED is emitted from the resulting status even after an unrelated edit. Revenue progression checks fromStatus at selection, not its later update. Plan approval can rewrite an already-materialized plan to approved, then create/relink another project and partial children. Paid-invoice project templates are implemented in AutomationExecutorService; current template reads and direct project creation do not establish a stable per-source consequence receipt. Do not call the feature absent because the historical blueprint names a different listener.

Calendar writeback is W8-10: its visibility/mutation permissions exist, but source completion can bypass the project evidence/required-scope rule. Source and projection writes are separate. Backfill can repair selected dated/nondeleted sources, narrowing the missed-event interpretation; it is not demonstrated complete, paginated, pruning-aware reconciliation.

Evidence HTTP guards and normal tenant context are registered. Dedicated assignment eligibility checks are real. Scalar Evidence.businessId scoping does not validate a polymorphic target or consumer-specific acceptance; direct assignment paths do not automatically inherit all dedicated-service checks. Do not turn these distinctions into an unsupported blanket cross-tenant or unauthenticated-access claim.

The full TaskAssignment model now establishes a lifetime unique key over taskType/taskId/assignableType/assignableId. Its create-after-unassign method can fail on A -> B -> A because A's old row remains, after B was marked unassigned. The selected target separates active ownership from reconstructable assignment episodes; deleting history is not the fix. Actual deployed constraints and runtime outcomes are not verified.

Change-order update accepts approval identity/date from its validated request body and can change scope/price while old approval metadata remains. Its project/business and supplied-invoice checks are useful. Those checks do not bind approval to authenticated actor authority and an immutable scope revision. A deliverable's ACCEPTED status likewise has no accepting-revision reference in the inspected model and can survive a URL edit.

Portal access administration supplies token/expiry/enabled/revocation and visibility mechanics, not delivery acceptance in the inspected methods. A literal public page lookup that returned 404 is not a full route inventory. Milestone completedAt and scalar invoiceId updates are not proof that the linked invoice represents the same accepted obligation, was created by that operation, or was settled.

## 4. Canonical F228 / C178 and financial ownership

M002's static counterexample remains exact:

```text
same label, chronological time entries:
60 minutes @ 100 + 30 minutes @ 200 + 45 minutes @ 200
source = 135 minutes / 350 pre-tax units

alternate-rate group overwritten by the last entry:
represented = 105 minutes / 250 pre-tax units

all three IDs may still be marked billed;
returned source minutes and billed count can appear complete.
```

This is now F228/C178 after comparison with actual J7 F185-F196, commercial F200 lineage, F217/F219 boundaries and existing authority/evidence/recovery contracts. It is independently distinct because it loses value during commercial line construction even when subsequent invoice/billed/ledger operations succeed. No real customer loss or executed invoice is asserted.

The create-invoice-before-mark partial-outcome problem remains governed by REC048/K11 and K10 correction semantics. Do not absorb all completion/assignment/approval issues into F228. Their concrete witnesses remain in the investigations and the WC contract without an omnibus new finding.

New ranges: F228/C178/KF-REC-057/KF-CONCEPT-042. Next free: **F229/C179/KF-REC-058**. No recommendation or concept was allocated. 04B remains allocation authority over historical statements in 04A and earlier handoffs.

## 5. Selected target and integration consequences

WC01-WC08 govern scope revision, assignment episodes, evidence admission, work completion, delivered-scope acceptance, reopen/cancel/withdraw, aggregate completion and exact downstream settlement/projection. Current actor/delegation, tenant, subject/parent, expected state, accepted scope and evidence policy are checked at material commit. All named writers participate; adding one endpoint check does not establish that contract.

Scope changes remain possible. Required work is satisfied, accepted, waived, cancelled or superseded under an explicit policy; deleting it from the current query cannot manufacture completion. Historical completion remains true of its own revision. Unchanged child outcomes can be adopted into a newer revision only under a declared compatibility decision. An intentionally empty scope requires an explicit disposition, not an accidental empty-set success.

WB01-WB04 govern bounded source selection, typed pricing/allocation, exclusive source ownership with canonical invoice creation, and truthful finalization/correction. Preserve each entry revision's units/value, allow readable line aggregation without losing underlying allocations, and represent rounding/tax/discount/currency separately. Request-ID dedupe alone cannot stop two different requests claiming the same time.

Use the existing TimeEntry/Commerce/InvoiceWorkflow repositories under an actual shared transaction/claim boundary. Wrapping a callback that escapes through a global client is not atomic composition. A transitional reservation remains explicit and unproven until it has fencing, stable invoice identity and recovery. Unknown outcomes block blind re-invoicing. Issued financial history is corrected through the financial owner, not erased by resetting billed flags.

The work-obligation bridge consumes the exact accepted source occurrence and scope. The existing five-tuple and party-wide mode remain available, but one project/task must not accidentally discharge a broader customer set. Calendar and CommandItem remain derivative; neither invents acceptance or financial truth.

## 6. Positive seams and backward review

Preserve task/assignment transactions, scoped assignment eligibility, reorder project/business validation, persisted deliverable ownership checks, plan field allowlists, honest unavailable IN_APP execution, invoice empty/unrated/count-mismatch refusals, normal evidence guards/context, calendar permissions/backfill, portal expiry/revocation and change-order invoice ownership checks.

J11/REC055 continues to own authoritative commercial revision/renewal decisions. J12/REC056 owns evidence admission; generic provenance remains REC049. J7/REC052/K10 retains accounting, valuation and financial correction and now consumes F228's source-allocation requirement. J18/REC048 owns attempts, claims, partial outcome and consequence repair. J23/REC047 keeps calendar/temporal work derivative. J2/J15/K2/K3 owns current authority and exact action evidence. J24/K12 owns trustworthy testing, independent acceptance and safe withdrawal. Full J21 public-experience coverage remains open rather than silently imported into J8 acceptance.

Optional variants can be added, compared, disabled, replaced and removed under reviewed contracts. Preserve current revocation, accepted scope, assignment history, one effect owner and billing allocations across switches. Shadow evaluation does not create real invoices/events. Where no conforming reference exists, disable the affected new action rather than fall back to a known unsafe implementation. The blueprint supplies controlled-change intent, not proof these controls are implemented.

## 7. Acceptance, proof and remaining debts

The named source/design loop is provisionally aligned. G8-01 through G8-08 pass at their stated context/source/design/backward-review scopes. G8-09 deployed data/full coverage remains deferred, G8-10 runtime proof is unexecuted, G8-11 is mapped-core provisional alignment and G8-12 implementation is unauthorized. No percentage is computed from these mixed gates.

J8 proof inventory: **24 local designed cases** (12 X, 8 Y, 4 Z), zero bindings, NOT_EXECUTED. J13's separate 44-case manifest remains unchanged. No test assertion or harness was added or executed here.

| Debt | Required evidence / work before the corresponding execution claim |
|---|---|
| WD1 | Existing-record reuse, final DDL/index/backfill and deployed-constraint validation, with history and partial-plan preservation |
| WD2 | Implementation and characterization of all named completion writers and later-discovered consumers in the claimed protected scope |
| WD3 | Actual portal acceptance, milestone-invoice and exact work-obligation adapter conformance; public journey coverage |
| WD4 | Source allocation, shared transaction-context propagation and historical financial correction/reconciliation |
| WD5 | Authorized isolated runtime, concurrency, migration and negative-control proof on a deliberately revalidated implementation baseline |

These debts preserve the distinction between a coherent target and conforming software. Reopen only the precise invalidated invariant if later source/deployment/runtime evidence contradicts the target. J13/J24 bounded alignments, ED1-ED5 and CS1-CS5 remain intact.

## 8. Exact continuation

The next programme unit is **J9_MARKETING_LEAD_GENERATION_ACTIVATION**, not another J8 schema or guard scan. Planned, not created here: `journeys/KF-JOURNEY-009-MARKETING-LEAD-GENERATION.md`.

Start the existing J9/J3/J5/J10/J21/J7 constellation from actual campaign/content publication -> audience response/lead capture -> Contact/conversation/source attribution -> commercial outcomes. Separate generated content, scheduled/published delivery, engagement, qualified lead, attributed conversion and financial revenue. Consume J8's source-obligation/allocation truth rather than equating billed or attributed value with realized money.

Coverage remains 21/25 dossiers and twelve kernel dossiers; this review adds no journey. Presence is not maturity or app completion. Keep the map frozen, current controls intact, production read-only and the forensic baseline fixed. Persist new substantive work and matching continuity, excluding maps.
