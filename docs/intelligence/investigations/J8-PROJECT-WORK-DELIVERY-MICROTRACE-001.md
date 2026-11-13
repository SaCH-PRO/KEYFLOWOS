# J8 - Project / Work Delivery Microtrace 001

Checkpoint: `J8-M001-2026-09-16-01`  
Date: 2026-09-16  
Intelligence input: `7df89af749e34e081ea3ce31977f586f7aa4376d`  
Implementation forensic baseline: `8f173bfe79f1418159cf4099ea18b0d60d203ec2`  
Result: **FIRST CREATION-TO-COMPLETION TRACE COMPLETED AT NAMED SOURCE SCOPE; J8 ACTIVE / NOT CONVERGED**.

Production source, schema, workflow, settings, test assertions and the programme map are unchanged. No application, provider, database, concurrency, boot or migration test ran. The scheduled-cycle halt remains in force. M001 is source forensics and candidate interpretation, not a production fix or execution packet.

## 1. Question, scope and evidence classes

Question: when an invoice, template or plan creates project work, what authorizes its completion, which evidence supports it, and do the other business surfaces receive the same outcome?

This trace follows the named Projects controller/service, paid-invoice template consumer, project-revenue progression, project-plan materialization/manual completion, EvidenceService and the project-detail checkbox through its client wrapper to the status endpoint. It joins the calendar listener and two existing source tests. It does not inventory every project/task writer, fully trace contract-to-work creation, adjudicate all assignment permissions, inspect tenant data, or run the application.

S01-S16 identify implementation sources in section 10. R01-R05 identify existing architectural contracts. P1 is the supplied product blueprint. X01-X12 below are document-local designed cases, not canonical finding IDs or executable test bindings.

## 2. Product intent versus actual represented state

P1's Phase X intends `invoice.paid -> product-linked ProjectTemplate -> project with tasks`, with ProjectsService reached through a listener. Its proposed Project/ProjectTask models and isolated/integration test outcomes are design material, not evidence the current application executed them successfully. The baseline does contain the payment-to-template-to-project behavior, but its actual writer is AutomationExecutorService, not the example FlowListener calling a project service [S04/S05]. We must not report this feature absent merely because the example's function name is absent.

The inspected current schema separates [S12]:

| Record / field | Actual represented meaning | What it does not establish by itself |
|---|---|---|
| Project.status | String, default ACTIVE; comments name ACTIVE/IN_PROGRESS/COMPLETED/ARCHIVED | All tasks satisfied, delivered scope accepted, or money settled |
| ProjectTask.isCompleted | Boolean default false | Its separate ProjectTaskStatus field, evidence eligibility or customer acceptance |
| ProjectTask.status | TODO/IN_PROGRESS/REVIEW/DONE/BLOCKED enum | An invariant automatically coupling it to isCompleted |
| ProjectTask.evidenceRequired | Boolean default false | Evidence has been checked by every completion writer |
| ProjectPlan.status / projectId | Plan stage and a unique optional pointer to a Project | An immutable approved revision or exactly-once materialization of the logical plan |
| ProjectPlanEvent | Context, manualEvidenceRequired, dependsOn, requiredRoles, linked task/milestone IDs, own status/completedAt | Dependencies, current authority or manual proof are enforced by every completion method |
| ProjectTemplate | Mutable name/taskTitles and unique optional productId | A source-revision reference retained on each resulting project |
| Project.contactId / invoiceId / bookingId | Optional scalar IDs in this Project block | A declared relation or tenant-equality constraint for those three references |
| TimeEntry | Billable/billed, user/business/project/task/invoice references | Delivery acceptance or the complete financial lifecycle |

ProjectTask has separate Project and Business foreign keys, not a compound same-business Project relation in the inspected block. Project has no invoice/template occurrence uniqueness constraint in that block. ProjectPlan.projectId being unique prevents two plan rows sharing that one pointer; it does not stop the same plan row being relinked from Project A to a newly created Project B. Historical SQL triggers, deployed schema drift and uninspected extensions are not globally ruled out by this schema read.

The ProjectsService also has persisted deliverable and milestone methods [S02]. This is a positive correction to the historical React-only deliverables design. Their current status/date updates still need to be distinguished from qualifying acceptance; model or URL presence is not itself a customer acceptance decision.

## 3. Creation and ownership ledger

| Entry | Reads and writes | Evidence/event behavior | Bounded consequence |
|---|---|---|---|
| Manual createProject | Project.create with tenant and supplied links/status | project.created, then awaited timeline record | Event/timeline success is not atomically coupled with the row by this method; a later failure cannot be treated as proof no project exists [S01/S02]. |
| Manual createFromTemplate | Tenant-scoped template read; Project.create with nested tasks | project.created; no task-created events in this method | One ORM call groups this project's task creation, but there is no source-template revision/occurrence receipt in the shown write set [S02/S12]. |
| Paid-invoice automatic template creation | InvoiceItem product IDs; tenant-scoped templates; direct Project.create with nested tasks for each template | Log after each project; local catch logs and returns on error; no project.created or project_task.created emission in this block | Bypasses the common project creation event. Re-entering the handler can attempt the same descendants again; failed partial batches have no local per-template completion receipt [S04]. |
| approvePlan -> materializePlan | Controller first requests status approved; planner permits named status update; executor accepts approved **or draft**; creates project, updates plan pointer/status, then creates and links children concurrently | project_plan.materialized after all child promises resolve; timeline afterward | Sequence is not one transaction/claim. Failure can leave project/plan/partial children; repeated approve can reopen the materialization path [S01/S07/S08/S09]. |
| addTask | Reads max sort first; explicit transaction creates task and optional polymorphic assignment | project_task.created after transaction | Preserve task+assignment transaction. Parent-business and assignee eligibility are not established by the shown ID lookups alone [S02]. |

### Paid-invoice path, reconstructed

```text
invoice.paid
 -> AutomationExecutorService.onInvoicePaid
 -> activity log
 -> configured playbooks / flows
 -> optional CRM thank-you task
 -> read invoice line-item product IDs
 -> find product-linked templates for payload business
 -> direct project + nested task creation per matching template
 -> log; local template-block error is caught
```

This built-in template block follows executePlaybooks/executeFlows; the absence of an enabled playbook does not itself disable the built-in block. The retrieved line-item shape includes productId, not invoice-item ID or quantity. The current behavior is one project per returned template, not a demonstrated per-line/per-unit fulfillment policy. Whether that cardinality is the intended business policy remains open. Do not replace it with a blanket unique(invoiceId) constraint: one invoice can legitimately require multiple distinct project obligations.

The separate ProjectRevenueListener consumes the same event to find existing invoice-linked ACTIVE projects and advance them by configuration, defaulting to IN_PROGRESS [S06]. It does not create template projects. No causal ordering between creating a new project and selecting it for advancement is established by these separate methods. A deterministic creation/advancement pipeline needs explicit ownership; a later replay is not a suitable ordering guarantee.

The supplied blueprint calls for this integrated user result. It does not justify silently duplicating the event's economic effect or rewriting existing history when templates change. Those are target implications derived from the actual trace and existing recovery contracts, not additional promises copied into P1.

## 4. Completion writer inventory

| Writer | Current checks and writes | Event / downstream distinction |
|---|---|---|
| W8-01 ProjectsService.updateTask | Reads tenant-scoped existing task. For false->true with evidenceRequired, calls checkTaskEvidence. A nonempty supplied evidenceIds array bypasses rejection when no stored evidence is found. IDs are removed from task data and passed in event payload; this method does not validate/link each ID. | Emits updated; may emit rescheduled; emits completed based on the previously read false flag. It does not automatically synchronize status to DONE [S02/S10]. |
| W8-02 updateTaskStatus | Tenant-scoped read, then status/isCompleted update by task ID. DONE sets true; another status can clear it. No evidence check in the method. | No task updated/completed/rescheduled event here [S02]. |
| W8-03 reorderTasks | Verifies selected tasks belong to the requested project/business. Updates each sequentially; DONE sets true, other statuses false. No evidence check or enclosing batch transaction. | No task events. Failure partway through can leave a partially applied reorder [S02]. |
| W8-04 completeOutAppEvent | Verifies event belongs to business through plan and executionContext is OUT_APP. Writes event completed/date, then linked task DONE/true, then timeline. | Optional evidence string is placed in timeline data. No manualEvidenceRequired, dependsOn, evidence-service or approval consumption check appears in this method; no standard task event [S07]. |
| W8-05 updateProject | Updates supplied fields, records timeline, emits updated; emits completed whenever resulting status is COMPLETED. | Unrelated later edits of an already-completed project can re-emit completed. No false->true/expected-state guard, required-child or deliverable acceptance check [S02]. |
| W8-06 ProjectRevenueListener.transition | Selection filters fromStatus and not-deleted, but the eventual update predicate is only id/businessId. | Emits status_advanced, not the project updated/completed events consumed by the inspected calendar listener [S06/S15]. |
| W8-07 updateDeliverable | Pre-reads exact deliverable/project/business. Status is accepted as supplied. completedAt becomes null for PENDING and a new date for every other supplied status. | This method does not record the accepting customer/reviewer, accepted scope/revision or an admission decision. Any such broader mechanism elsewhere remains untraced [S02]. |
| W8-08 updateMilestone | Pre-reads milestone through exact project/business; writes supplied completedAt/invoiceId and other named values. | A date/reference assignment is not shown to evaluate acceptance or invoice settlement [S02]. |
| W8-09 executeInAppEvent | Context/tool checks and tier handling; unwired tool returns unavailable/blocked and leaves task alone. | **Preserve this positive boundary.** Current code does not claim the tool executed or mark the task done merely because the stub ran [S07]. |

### The ordinary UI actually uses W8-02

```text
ProjectDetail.handleToggleTask
 -> nextStatus = DONE or TODO from !task.isCompleted
 -> client.updateProjectTaskStatus
 -> apiPatch /projects/businesses/{businessId}/tasks/{taskId}/status
 -> ProjectsController.updateTaskStatus
 -> ProjectsService.updateTaskStatus (W8-02)
```

S11 and S16 establish the UI/client edge; S01 establishes the guarded controller edge. AuthGuard/BusinessGuard remain present, so this is not an unauthenticated access claim. Root app boot, actual HTTP responses and global interceptor behavior were not executed in this tranche. The specific route-to-method source path is nevertheless real, not a proposed UI.

### Evidence meaning is weaker than acceptance

EvidenceService.checkTaskEvidence reads evidenceRequired and calls getForObject(taskType, taskId), then defines hasEvidence as `evidence.length > 0` [S10]. It does not inspect verifiedAt/verifiedBy, content, consumer-specific admissibility, accepted revision or a completion decision. It does not pass businessId explicitly in that call; the behavior of tenant context/extensions must be traced before asserting cross-tenant evidence access.

A cheap checklist note may be sufficient for a low-risk task. Not every task should require customer approval. The missing contract is a **declared per-obligation completion policy** consistently enforced by all relevant writers, not universal heavyweight review or universal verifiedAt requirements. Evidence attachment, task completion, delivered scope, customer acceptance and payment settlement can have different policies and must not be conflated.

## 5. Conditional execution sequences and consequence reach

These are static counterexamples with explicit success/precondition assumptions, not reproduced incidents.

### A. Required evidence is path-dependent

With an incomplete task whose evidenceRequired is true and no qualifying stored evidence, W8-01 without IDs rejects. The UI's W8-02 instead writes DONE/true without consulting that requirement. W8-03 and W8-04 are additional named completion paths. A patch to only updateTask would therefore leave the ordinary UI and other writers outside the rule [S01/S02/S07/S10/S11/S16].

Even W8-01's branch accepts a nonempty evidenceIds list without validating those referenced objects in that path. This proves a missing reference-validation step in the method, not a successful end-to-end exploit or a tenant-secret disclosure.

### B. Task, board and plan can disagree

W8-01 can change isCompleted without changing status. W8-02/W8-03 update both but not ProjectPlanEvent. W8-04 changes event and task in separate writes. If the event commit succeeds and task/timeline fails, partial state survives. Whether any other reconciliation mechanism repairs each divergence remains to trace; do not infer universal permanent inconsistency from the local write sets [S02/S07/S12].

### C. Calendar effects differ by writer

CalendarProjectsListener subscribes to project created/updated/completed and task created/updated/completed/rescheduled, as well as deletion [S15]. It does not subscribe to project.status_advanced or project_plan.materialized in this file.

Thus W8-02/W8-03/W8-04 do not trigger this event-driven task refresh through their shown paths; automatic template creation does not trigger the usual project-created refresh; revenue advancement emits a different event. A dated item already on the calendar can miss this notification. A reconciliation job or later ordinary edit might repair it; mapper eligibility and all backfill/reconciliation paths are not yet audited. The target is consistent consequence ownership, not simply emit every event twice.

### D. A status filter before an await is not a transition guard

```text
revenue listener selects project P while ACTIVE
 -> another operation completes, archives or deletes P
 -> revenue transition updates P by id/businessId alone
 -> newer state can be overwritten with configured toStatus
```

The schema/read method and unit test confirm the update shape; the test uses mocks and contains no intervening transition [S06/S14]. This is conditional stale-writer reachability, not an observed race. A fresh read of configuration that falls back to enabled defaults on read failure is also not evidence that the user's last disable decision remained enforced.

### E. Repeated approval is not idempotent materialization

```text
materialized plan -> approve endpoint again
 -> planner.updatePlan writes approved (named allowlist, no transition predicate)
 -> materializePlan accepts approved
 -> creates another Project before relinking plan
 -> creates/relinks children again
```

ProjectPlan.projectId uniqueness does not reject replacement with a different newly created Project ID [S12]. A failure after plan status becomes materialized but before all children are linked leaves a partially materialized graph. The normal retry endpoint first re-approves rather than reconciling a stable required child set. Existing old projects/tasks are not automatically a safe rollback target. The absence of an encompassing transaction/claim is source-supported; final deployed outcomes require isolated testing [S01/S07/S08].

### F. Replayed payment and edited templates require durable work identity

The automatic template block reads **current** template taskTitles each time and directly creates work. It has no local claim on invoice/template occurrence or source revision; the inspected Project block has no such unique identity. An already-deduplicated payment upstream is a useful boundary but does not by itself establish idempotent downstream project repair or manual/internal event replay. A partial template loop followed by re-entry can repeat earlier children and use a changed template for later ones [S04/S12].

The consequence set should be derived from an explicitly accepted obligation/template revision and policy, with same-occurrence repair rather than generic rerun. Whether invoice item quantity creates one project or several must be specified, not guessed by this trace.

## 6. Authority, deletion and existing strengths

Controller actions are guarded by AuthGuard/BusinessGuard [S01]. Existing J13/J24 analysis establishes why broad business access is not automatically an exact business-action permission; this trace does not independently re-audit the entire authorization middleware. None of the inspected task/plan completion route signatures carries an actor into these service methods. addTask/updateTask assignment history writes assignedBy='system'. A user initiating a change and the system recording it must remain distinguishable; actual TaskAssignmentService and EvidenceController authority are next-source items, not declared globally absent.

The plan updater explicitly allowlists mutable fields and excludes body.businessId [S08]. Preserve that existing protection; do not repeat its historical tenant-relocation defect as though the current method still spreads the body. Other generic spread-based update paths deserve a separate bounded input/extension review rather than assuming this fix protects all methods.

Deliverable create/list and update/delete contain tenant/project ownership checks [S02]. Existing tests verify these method-level checks using mocks and assert presence of schema/client tenancy hooks [S13]. Keep the tests and the persisted deliverable path. The parent React component still declares an unused-looking local deliverables state in the inspected range, but that alone is **not** proof the tab is still nonpersistent; child-tab wiring was not fully read.

Project/task deletion explicitly sets deletedAt. Plan deletion uses separate child deleteMany then plan delete. Deliverable/milestone methods call delete. Actual deletion semantics, downstream evidence preservation and ORM interception for each model are not fully resolved here. Do not silently equate a delete call, archive state or project checkbox with cancellation of all descendant work or settled obligations.

## 7. Anti-duplication and shared ownership review

No F228/C178/KF-REC-058 is allocated. This first comparison identifies existing owners and candidate questions; it is not an exhaustive historical-register review.

| New pressure | Existing comparison | Disposition |
|---|---|---|
| Payment-triggered work creation/replay and partial plan children | J10 F206/F211 describe duplicate economic descendants and incomplete required route sets; KF-REC-048 separates dedupe from consequence completeness [R01/R04] | Reuse those **architectural laws**. Do not relabel Project-specific evidence as if F206 already proved it. Exact project effect identity/quantity/revision remains J8 work. |
| Generic COMPLETED status used as fulfillment/acceptance | J11 F217/C167 separates lifecycle state from renewal decision/settlement evidence [R02] | Related causal pattern, not automatically the same defect. Preserve a local J8 completion-owner candidate pending fuller canonical comparison. |
| Evidence presence/nonempty IDs treated as sufficient | J12 KF-REC-056 separates references, qualifying evidence and consumer-specific admission; F219's proven manifestation is document extraction/payment [R03] | Reuse evidence-admission owner; do not invent a new evidence store or silently expand F219's proof scope. Task policy remains to settle. |
| Current status update versus temporal/calendar truth | KF-REC-047 makes temporal work derivative; KF-REC-048 preserves exact occurrence/child outcome [R04/R05] | Source owns transition; calendar and work queues consume truthful event/receipt lineage. A projection cannot authoritatively complete the task. |
| Approval, dependencies, materialization and manual completion | Existing J2/J15/K3 governance and J23/K7 ordering; named plan behavior [S01/S07/S08] | Existing governance/claim machinery must be reused. No automatic approval/executor retrofit in this analytical tranche. |
| User can add/remove/reorder tasks during testing or operation | J13 integration/withdrawal and J24 accepted policy/receipt contracts, retained from prior checkpoints | Preserve flexibility but identify scope revision and required-versus-optional children. Removing a required task must not silently manufacture completion or rewrite prior evidence. |

J10's dossier opening is an older target-synthesis/baseline snapshot; current machine state retains its later provisional alignment. J11/J12 historical next-free IDs do not override 04B/current F227/C177/REC057 ranges. No older document heading is used to regress the programme or change the forensic baseline.

### Candidate integration consequences, not accepted final implementation

Use a shared completion transition over the existing project/task/plan services and evidence/assignment owners. Its input must identify exact subject, tenant, actor/delegation, expected state/scope revision, completion policy and eligible evidence. Its output must preserve authoritative outcome and required downstream consequences. A Kanban move is a UI request to that transition, not a policy-free alternative writer.

Preserve configurable lightweight tasks. Where customer acceptance is required, model an explicit accepted scope/revision/actor decision rather than interpreting any non-PENDING deliverable status as acceptance. Financial eligibility/settlement remains owned by J7/K10, contract obligations by J11, evidence by J12/K8, and recovery by J18/K11. No new universal task, workflow, evidence or financial engine is selected.

Migration will need writer cutover together, compatibility characterization for status/isCompleted, provenance for preexisting completions and source-template/plan descendants, and reconciliation of missed calendar/obligation consequences. Unknown historical evidence stays unknown; neither bulk marking verified nor deleting old work is a valid backfill. These are design pressures, not permission to edit production.

## 8. Twelve designed cases - all NOT_EXECUTED

| Case | Required isolated characterization / candidate acceptance |
|---|---|
| X01 | The same evidence-required task completed by general update, status endpoint, reorder and OUT_APP completion has consistent policy. Record current divergences before authorized correction. |
| X02 | Unknown, wrong-task, wrong-business, withdrawn or insufficient evidence IDs cannot stand in for an eligible admission decision; evidence policy can intentionally permit simple notes where appropriate. |
| X03 | Status and isCompleted cannot contradict their declared representation; re-open behavior is explicit and does not manufacture new delivery evidence. |
| X04 | Task/project changes through all named writers refresh applicable calendar/work projections once per semantic transition, including replay/rebuild. |
| X05 | Editing name/description on an already-completed project does not create a new completion occurrence; completing without required accepted scope is rejected. |
| X06 | Revenue selection followed by archive/delete/completion/revoke/config-disable cannot overwrite a newer authoritative decision; compare at mutation, not only selection. |
| X07 | Repeated/concurrent approve and crashes between project/plan/child writes converge on the same intended materialization and reconcile missing children. |
| X08 | Re-entry after the first automatic template succeeds and a later one fails does not duplicate confirmed work; template edits and item quantity use an explicit source policy. |
| X09 | Manual OUT_APP completion interrupted after event write preserves partial outcome and repairs the linked task/evidence without falsely completing dependencies. |
| X10 | Creating/reassigning work rejects foreign/missing/ineligible parent or assignee and retains the real initiating actor, assignment history and current authority. |
| X11 | Delete/archive/cancel and required-task removal preserve accepted scope/history, close only the correct obligation occurrence and expose unresolved time/billing consequences. |
| X12 | Unwired IN_APP automation stays blocked/unavailable without changing linked task completion or fabricating a successful execution record; persisted deliverable ownership checks remain effective. |

These are local J8 designs, not additions to the unchanged 44-case J13 integration manifest, not twelve runner bindings and not test results. Existing deliverable/revenue source tests were read, not run. The revenue test asserts the current id/businessId update shape and configurations; it does not simulate concurrent transitions. The deliverable tests check ownership and PENDING/DELIVERED timestamp behavior, not customer acceptance or full real-database isolation.

## 9. Exact next bounded action

**J8_COMPLETION_EVIDENCE_ASSIGNMENT_AND_OBLIGATION_TRACE**.

Produce `J8-PROJECT-WORK-DELIVERY-MICROTRACE-002.md` from these named gaps, not another generic project scan:

1. Trace EvidenceController, Evidence/TaskAssignment models and TaskAssignmentService plus the real parent/assignee authorization and tenant extensions consumed by S02/S10. Decide what makes a completion evidence reference eligible and which transition owns it. Trace any alternative completion writers only when they touch the same contract.
2. Follow `project_task.completed`, project/plan completion and contract/work-obligation consumers to their settlement/projection owners. Inspect the named calendar mapper/reconciliation and milestone/time-to-invoice paths where they determine whether delivery, acceptance or billing is actually complete. Preserve J11/J12/J18/J23 owners.
3. Compare the surviving independent J8 completion/lineage candidate against the actual canonical register homes before allocation; refine the smallest shared completion/scope/receipt model and list migration obligations. J8 remains NOT CONVERGED until this and later target/backward review establish its boundary.

Do not add another test framework or claim automatic template creation is absent. Do not replace the already-honest unwired executor with a fabricated success. Continue updating canonical intelligence and handoffs, but do not run the programme-map generator/check or modify its outputs until explicitly requested.

## 10. Reproducible source manifest

All S sources are from `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`. Whole-file fetch does not imply whole-file audit; the declared inspected symbols/ranges are the scope.

| Ref | Path / read scope | Blob SHA |
|---|---|---|
| S01 | apps/server/src/modules/projects/projects.controller.ts; full declared routes | b4657d0d1ac8ea47494dffd5bd66e77c5f4bbbb4 |
| S02 | apps/server/src/modules/projects/projects.service.ts; full via lines 1-300 and 285-end | 54ff02cb61a63df9c4b7e1b7c982bbdf9e68a276 |
| S03 | apps/server/src/modules/projects/projects.module.ts; full registrations | 4b85a254e1dd9ef33b0218356785c18fe456cb44 |
| S04 | apps/server/src/modules/flow/automation-executor.service.ts; executePlaybooks/executeFlows and complete onInvoicePaid; requested ranges 1-240, 380-680 and 645-805 | 0202c9dbdd0f0e3130e53d8897b6ceae69f9e601 |
| S05 | apps/server/src/modules/flow/flow.listener.ts; first 300 lines, particularly handleInvoicePaid | 6ab82452e5c3166b7197ef525fd0ef8948af0a91 |
| S06 | apps/server/src/modules/projects/project-revenue.listener.ts; full | 9492c060f674bc9e51c1be074178e08681d5df5c |
| S07 | apps/server/src/modules/projects/project-plan-executor.service.ts; full | f3f644dab0565a35c6f882a5367cf493252d4cc8 |
| S08 | apps/server/src/modules/projects/project-planner.service.ts; lines 330-end, especially updatePlan/reorder/delete | b0aa2af8d8bda09cbd34f1d79ed0b10ff89ed192 |
| S09 | apps/server/src/modules/projects/project-plan.listener.ts; full | 21bd10b2e8ab61ae07f96d40c1e23e636ff82878 |
| S10 | apps/server/src/modules/evidence/evidence.service.ts; full | 50bad29fddec2e71c5b31a8050bf52b22d93461d |
| S11 | apps/web/src/app/app/projects/components/project-detail.tsx; imports/state and handlers through first 300 lines; checkbox independently reread at 185-225 | 23f5553228bbc8181d833ec2d36a98a69520c92d |
| S12 | packages/db/prisma/schema.prisma; Project/ProjectTask/TimeEntry/ProjectTemplate/ProjectPlan/ProjectPlanEvent blocks and task enum; unrelated discovery ranges not treated as a schema audit | c5f263432b30838b0f9723640282bbdeb2f4cba3 |
| S13 | apps/server/src/modules/projects/project-deliverables.spec.ts; full source, mock/structural tests only | 9cd326da841261d9cea5ec0bf64b89e81ec1ae3b |
| S14 | apps/server/src/modules/projects/project-revenue.listener.spec.ts; full mock tests | a3703ac7437afc4518786fce7a6348615d100b54 |
| S15 | apps/server/src/modules/calendar/listeners/projects.listener.ts; full | ed6551507f3cc2ef0d5b64b8927be0eb4d64c2e6 |
| S16 | apps/web/src/lib/client.ts; named updateProjectTask/updateProjectTaskStatus wrappers plus imports; not entire large client audit | e67edbf31439123319ec6c0aec22ba28e8f120c0 |

The modules and listener decorators establish declared provider/route relationships, not a successful deployment/boot test. Default-branch searches were path discovery only; material code claims use pinned fetches. No template-manager, contract-to-project, task-assignment or historical test incident is claimed freshly traced merely because it appeared in a search result or a code comment.

R01: J10 dossier sections A-I, especially F206/F207/F209/F211. R02: J11 dossier sections A-F, F215-F218 and reuse rules. R03: J12 dossier, evidence/revision/disposition distinctions and KF-REC-056 boundaries. R04: 10G/KF-REC-048 through the child-resume introduction. R05: 10F/KF-REC-047 in full. All read from the current intelligence input; their older internal source baselines remain historical provenance, not this tranche's baseline.

P1: user-supplied KeyFlow OS Master Execution Blueprint / KEYFLOW v3, Project/ProjectTask/ProjectTemplate models, Phase X payment-to-project flow and Execution Addendum 6.1-6.3. This trace preserves its intent and marks actual source differences. It does not apply historical sample schema/library versions or its stated flawless outcomes to the current repository. No external research was needed to establish the local source divergences; provider/framework-wide behavior is not inferred beyond these reads.

## 11. Context integrity and persistence boundary

**PASS FOR THIS BOUNDED J8 ACTIVATION.** The live intelligence ref matched the input SHA; CURRENT/ROLLOVER/START/current-state were reread. AGENTS/AGENT-CONTINUITY, the J24 review/K12 and the owner halt are retained from the continuous canonical session. Current permission remains separate from the old code baseline. J8 is the next work in the existing J11/J8/J12/J23/J7 constellation, with K6/K7/K8/K11 primary and K1/K2/K3/K5/K10/K12 secondary responsibilities.

The input CURRENT-STATE.yaml was reconstructed locally from connector content and its Git blob verified exactly as `98babbb052b014cf68b3c147c916097293d18679` before modification. This check protects continuity metadata; it is not an application test. Prior J13/J24 alignments, ED1-ED5, CS1-CS5, canonical ranges, proof inventory and map-pause controls are preserved.

Creating the new J8 dossier increases the inherited twenty-dossier inventory by one; this is 21/25 dossier coverage, not project completion and not a new full maturity census. No dedicated new kernel or F/C/REC/CONCEPT ID is allocated. The frozen programme map remains intentionally older. No routine, production resource or application test was invoked.
