# KF-JOURNEY-008 - Project / Work Delivery

Checkpoint: `J8-M001-2026-09-16-01`  
Activated: 2026-09-16  
Status: **ACTIVE / FIRST SOURCE TRACE COMPLETED / NOT CONVERGED**  
Intelligence input: `7df89af749e34e081ea3ce31977f586f7aa4376d`  
Implementation forensic baseline: `8f173bfe79f1418159cf4099ea18b0d60d203ec2`.

Primary kernels: K6 State Transition, K7 Temporal / Event / Workflow, K8 Evidence & Outcome, K11 Recovery & Reliability. Secondary: K1/K2/K3/K5/K10/K12. Existing commitment-to-delivery constellation: J11 -> J8 -> J12 -> J23 -> J7; adjacent J2/J15/J17/J18/J24.

Production source/schema/settings/workflows/assertions remain read-only. No application/provider/DB/boot/concurrency/migration tests ran. The programme map remains frozen at J24-PA by user instruction, and scheduled cycles remain halted. This dossier records analysis, not implementation authorization.

## A. Definition and product intent

J8 follows a business commitment into an authorized delivery scope, project/plan/tasks, assignment, execution, evidence, acceptance where required, financial consequences and recoverable completion/cancellation.

The supplied blueprint's Phase X intends paid-invoice product templates to create projects. That behavior exists in the inspected baseline, but the actual writer is AutomationExecutorService, not the example's FlowListener -> ProjectService call. A source/example mismatch must not become a false claim that the feature is absent.

The core distinction is:

```text
work requested != work assigned != task checkbox
!= delivered scope != qualifying evidence != customer acceptance
!= invoice/payment settlement != truthful completion of every required consequence
```

Not every lightweight internal task requires customer approval. The question is whether each obligation's declared policy is consistently enforced, rather than imposing a universal heavyweight review.

## B. Completed investigation and scope

[Microtrace 001](../investigations/J8-PROJECT-WORK-DELIVERY-MICROTRACE-001.md) is the detailed evidence home. Its S01-S16 manifest records sixteen named implementation files with full or explicitly partial scope. It includes two source tests, not two executed tests.

The traced boundary covers ProjectsController/ProjectsService, manual template creation, actual paid-invoice template creation, revenue progression, project-plan materialization/manual completion, EvidenceService, the ordinary project-detail checkbox/client wrapper, and the calendar listener. Full contract-to-work creation, assignment authorization, all alternative writers, actual event fanout/reconciliation, and time/milestone billing remain named next work.

## C. Real entry and mutation paths

| Entry | Actual path | Consequence |
|---|---|---|
| Manual project/template | Guarded controller -> ProjectsService -> Project with nested tasks for template path | Manual creation emits project.created; source revision/occurrence receipt is not in the shown write set. |
| Paid invoice | AutomationExecutorService.onInvoicePaid -> current product-linked templates -> direct Project.create | Does not emit normal project/task creation events in this block; no local per-template dedupe/repair receipt. |
| Plan approval | approve endpoint -> planner.updatePlan(approved) -> materializePlan | Creates project before plan pointer/status and child tasks/milestones; repeated approval can re-enter materialization. |
| Ordinary checkbox | ProjectDetail.handleToggleTask -> updateProjectTaskStatus -> guarded status route -> updateTaskStatus | DONE/Boolean update bypasses the general updateTask evidence check and task events. |
| General task update | updateTask -> optional existence check -> task/assignment transaction -> events | Nonempty submitted evidenceIds bypass rejection without local ID validation; Boolean is not synchronized to status. |
| OUT_APP completion | Context/tenant event lookup -> event completed -> linked task DONE -> timeline | Separate writes; no manualEvidenceRequired/dependency/evidence admission check in this method. |
| Revenue progression | Select ACTIVE project -> later update by id/business | Expected fromStatus is not repeated at mutation; a newer state can be overwritten. |

## D. State, authority and evidence

The schema has separate Project.status, ProjectTask.status/isCompleted/evidenceRequired, ProjectPlan.status/projectId and ProjectPlanEvent.status/completedAt/dependencies/manualEvidenceRequired. Field presence does not enforce a common transition contract. ProjectPlan.projectId uniqueness does not prevent a plan row being relinked to another new project.

Controller AuthGuard/BusinessGuard are present. This trace is not an unauthenticated-access claim. Route handlers do not carry an initiating actor into the inspected completion methods; assignment history writes assignedBy='system'. The full parent/assignee and evidence-route authority chains are next-source work, not globally declared absent.

EvidenceService.checkTaskEvidence treats any returned evidence row as hasEvidence; it does not itself inspect verification, revision or consumer-specific eligibility. General updateTask also accepts a nonempty evidenceIds list without validating each reference in that method. Cross-tenant consequences require the still-untraced context/extension/record checks and are not assumed.

## E. Completion and consequences

Nine named writer/nonwriter roles W8-01-W8-09 are recorded in Microtrace 001. They distinguish general task update, status update, reorder, OUT_APP completion, project update, revenue transition, deliverable update, milestone update and honest unwired IN_APP behavior.

Project update emits project.completed whenever the resulting status is COMPLETED, even for a subsequent unrelated edit. It does not evaluate the required task/deliverable set. ProjectDetail can label this status Delivered. That is a user-visible projection of a status, not independent acceptance evidence.

The calendar listener consumes project created/updated/completed and task created/updated/completed/rescheduled events. Status/reorder/OUT_APP writes emit none of those task events; automatic template creation emits no normal creation event, and revenue emits status_advanced instead. The event-driven refresh gap is source-supported. Eventual reconciliation or later edits might repair it; permanent stale calendar behavior has not been reproduced or universally proved.

## F. Failure, replay and preservation

Microtrace 001 specifies conditional sequences for evidence bypass, task/status/plan disagreement, missed calendar notification, revenue selection racing archive/completion, repeated approval creating a second project, partial child materialization and payment/template replay.

The paid-invoice consumer reads current templates and only line-item product IDs, not stable item/quantity obligation identities. Re-entry can repeat already-created work or use edited templates. Upstream payment dedupe remains useful but is not proof of downstream consequence completeness. Do not impose blanket unique(invoiceId), because distinct template/line obligations may legitimately share an invoice.

Project/task soft-delete, plan deletion, milestone/deliverable delete and pending work are not presumed equivalent to domain cancellation. Global ORM interception, retention and billing consequences remain to trace before specifying destructive changes.

## G. Positive mechanisms that must survive

The task/assignment update has an explicit transaction. Reorder validates selected project/business membership. Deliverables are persisted with ownership checks, and existing mock/structural tests guard those checks. The plan updater allowlists fields rather than retaining its historical tenant-relocation defect.

IN_APP execution currently reports blocked/unavailable when no executor is wired and leaves linked task completion alone. Do not describe the older fake-success implementation as current, or replace honest unavailability with a fabricated successful action.

## H. Cross-journey comparison and candidate direction

| Existing owner | J8 consequence |
|---|---|
| J10/K6/K11 and KF-REC-048 | Reuse semantic descendant identity, required-child reconciliation and consequence-aware retry; project manifestations remain separately evidenced. |
| J11 / KF-REC-055 | Task/project status is not a contract decision or occurrence-specific obligation settlement. |
| J12 / KF-REC-056 / K8 | Evidence reference, qualifying evidence and admission decision stay distinct; do not create a second evidence engine. |
| J23 / KF-REC-047 / K7 | Calendar/temporal views derive from domain truth and cannot independently complete it. |
| J2/J15/K2/K3 | Completion and assignment consume current actor authority; existing governance owners must be reused. |
| J24/K12 | Optional variants and tests may evolve through reviewed scope changes, not by deleting required work or evidence to manufacture completion. |

Candidate direction: one logical completion/scope transition across current writers, with exact tenant/subject/actor, expected state/scope version, applicable evidence policy and durable consequence identity. This is not a selected physical schema, final recommendation or production patch.

No F228/C178/KF-REC-058 allocation. The bounded comparison distinguishes reused architectural laws from independently proved source defects; fuller canonical-register comparison remains before any new allocation.

## I. Proof and maturity

X01-X12 in Microtrace 001 cover consistent completion policy, evidence eligibility, status agreement, calendar consequences, repeat completion, stale revenue writers, materialization replay, template replay, partial OUT_APP completion, assignment, removal/cancellation and preservation of honest unavailable behavior.

All twelve are **DESIGNED / NOT_EXECUTED / UNBOUND**. They do not change the existing 44-case J13 manifest. No passing runtime evidence or new executor is claimed. J8 activation and the first trace are complete; J8 target convergence remains open.

The inherited twenty-dossier inventory plus this new J8 dossier is 21/25 coverage. It is not an app-completion percentage or a new maturity census. The paused programme map is intentionally not regenerated.

## J. Exact next action

**J8_COMPLETION_EVIDENCE_ASSIGNMENT_AND_OBLIGATION_TRACE**.

Planned: `investigations/J8-PROJECT-WORK-DELIVERY-MICROTRACE-002.md`.

Trace the named EvidenceController/model and TaskAssignmentService/model/tenant-context paths; then follow task/project/plan changes into contract/work-obligation settlement, calendar reconciliation and milestone/time-to-invoice consumers. Determine eligible evidence and current assignee/actor authority before refining the completion/scope/receipt contract. Perform bounded comparison against actual canonical homes before allocating an independent finding.

Do not repeat this creation/UI scan, assume payment-template creation is absent, reimplement the honest executor stub, or restart J13/J24. Preserve prior alignments, ED1-ED5 and CS1-CS5. Persist new evidence and canonical handoffs, excluding all map outputs and generation while the user pause remains active.
