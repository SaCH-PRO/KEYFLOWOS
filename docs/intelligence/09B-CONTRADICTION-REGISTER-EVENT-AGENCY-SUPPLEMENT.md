# KeyFlowOS Contradiction Register — Event Agency Supplement

Status: CANONICAL CONTINUATION OF `09-CONTRADICTION-REGISTER.md` + `09A-CONTRADICTION-REGISTER-CURRENT-SUPPLEMENT.md`

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Canonical sequence continues after C060.

---

## C061 — visible Reflex opt-in vs always-evaluated JourneyTemplates

**Status:** VERIFIED ACTIVE CONTRADICTION

The Key Autonomy Reflex UI presents persisted AgentTrigger rows as the events KEY responds to without being asked, and DefaultTriggersService deliberately seeds them disabled so autonomy is opt-in.

However `AgentTriggerService.handleEvent()` invokes `JourneyOrchestratorService.handleEvent()` before returning when there are no enabled AgentTrigger rows. Matching hard-coded JourneyTemplates therefore remain event-reactive independently of the visible Reflex switches.

Target resolution: all event-triggered business agency must consume one coherent standing-event-authority model. Observation/projection consumers may remain independent, but user-visible autonomy controls must truthfully correspond to the agency they govern.

Affected kernels: K3, K7.
Affected journeys: J6, J15, J25.

---

## C062 — configured trigger risk ceiling vs generated plan risk

**Status:** VERIFIED ACTIVE CONTRADICTION

AgentTrigger stores `maxRiskTier` and passes it to Planner as part of ParsedIntent, implying an upper bound on the trigger's autonomous plan. Planner does not constrain generation by that value and computes the actual plan maximum only after child generation.

AgentTrigger decides whether to auto-approve from the configured trigger ceiling rather than the resulting plan ceiling.

PlanExecutor later re-evaluates exact child tools, narrowing the severity but not repairing parent approval semantics.

Target resolution: standing trigger/delegation bounds must validate the complete generated child set before parent clearance/approval can be granted.

Affected kernels: K3, K5, K7.
Affected journeys: J2, J6, J15, J23.

---

## C063 — deterministic JourneyTemplate vs AI-invented plan steps

**Status:** VERIFIED ACTIVE CONTRADICTION

JourneyOrchestrator appears to execute a deterministic JourneyTemplate, but its implementation first calls Planner, which creates LLM-generated AiPlanSteps, and then appends deterministic template steps to the same plan.

The runtime artifact is therefore neither a deterministic template compilation nor a pure AI-generated plan.

Target resolution: choose an explicit planning mode. Deterministic templates compile their declared child actions; AI-generated plans validate the complete generated set. A hybrid must be deliberately modeled and governed, not accidental concatenation.

Affected kernels: K3, K5, K7, K8.
Affected journeys: J6, J15, J23.

---

## C064 — canonical event contract vs flat JourneyTemplate/default-trigger input assumptions

**Status:** VERIFIED ACTIVE CONTRADICTION

Canonical typed events such as `contact.created`, `booking.completed`, `invoice.overdue` and `invoice.paid` carry domain objects under `contact`, `booking`, or `invoice`. JourneyTemplates and some default AgentTrigger conditions instead assume flat fields or a nested `payload.*` path that does not match the received canonical event object.

Target resolution: canonical event schemas are versioned contracts; agency consumers normalize explicitly from those contracts into their own typed input rather than guessing payload shape.

Affected kernels: K5, K7, K8, K9.
Affected journeys: J3, J4, J6, J7, J14, J18.

---

## C065 — declared temporal delay vs immediate executable step

**Status:** VERIFIED ACTIVE CONTRADICTION

JourneyTemplate steps declare delays such as three-day follow-up and seven-day review request, while `delayMinutes` has no observed production consumer and is not compiled into `AiPlanStep.scheduledAt`.

Target resolution: timing declarations become durable executable temporal semantics through K7 ScheduleOccurrence/step scheduling, with policy/authority revalidation at the delayed action boundary.

Affected kernels: K7, K11.
Affected journeys: J4, J6, J23.

---

## C066 — declared business role vs unenforced execution principal

**Status:** VERIFIED ACTIVE CONTRADICTION

JourneyTemplate declares per-step roles such as finance, sales, support and operations, but the role is persisted as metadata and is not carried through PlanExecutor/PlanStepJob into governance as an authority constraint.

Target resolution: role/position requirements must resolve through K2/K3 Effective Authority and principal lineage. A string label cannot confer authority.

Affected kernels: K2, K3, K5.
Affected journeys: J6, J15, J25.

---

## C067 — JourneyInstance running state vs independently completed AiPlan

**Status:** VERIFIED SEARCH-SCOPED CONTRADICTION

JourneyOrchestrator creates `JourneyInstance(status='running')` and defines a status-update method, while current repository search found no external completion/failure reconciliation from AiPlan/PlanExecutor back to JourneyInstance.

No runtime test was executed, so this remains search-scoped rather than runtime-proven.

Target resolution: workflow projections derive/reconcile from the actual execution lifecycle and cannot become an independent stale truth source.

Affected kernels: K6, K7, K8, K11.
Affected journeys: J6, J18, J23.

---

## C068 — one event occurrence vs two independent proactive plans

**Status:** VERIFIED ACTIVE CONTRADICTION

Hard-coded JourneyTemplates and persisted default AgentTriggers overlap on events including booking completion, contact creation, quote acceptance, invoice overdue, invoice payment, no-show and stale quote.

AgentTriggerService first invokes JourneyOrchestrator and, when a matching persisted trigger is enabled, separately creates another Planner plan. One event occurrence can therefore become two plans with distinct plan/step/idempotency identities.

Target resolution: event occurrence + standing policy compiles into one normalized business-action intent graph, or multiple consumers must explicitly prove that their effects are intentionally distinct and non-overlapping.

Affected kernels: K3, K5, K7, K8, K9, K11.
Affected journeys: J3, J4, J6, J7, J14, J18, J23.

---

# Pool law

C061-C068 collectively strengthen the event-agency target:

```text
Canonical EventOccurrence
→ explicit Observation/Projection consumers
→ StandingEventPolicy for business agency
→ durable ConsumerClaim where required
→ one normalized ActionIntent / bounded Plan
→ validate exact child set, role, timing and risk bounds
→ child ActionEnvelopes
→ governance
→ ExecutionClaims
→ effects
→ OutcomeEvidence
```

Event fan-out remains valid for projections, analytics and independent read models. The target is not "one listener"; it is **one coherent owner per business consequence** plus explicit idempotency where multiple consumers are legitimate.

No production implementation is authorized by this supplement.
