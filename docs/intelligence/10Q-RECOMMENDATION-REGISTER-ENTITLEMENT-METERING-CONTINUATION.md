# KeyFlowOS Recommendation Register — Entitlement & Metering Continuation

Status: CANONICAL CONTINUATION AFTER KF-REC-057  
Primary journey: J20 Plan / Subscription / AI Cost  
Implementation baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`.

## KF-REC-058 — Establish a Subscription Entitlement, Metering & Cost Reconciliation Contract

**Status:** PROVISIONAL / STRONGLY SUPPORTED TARGET

Establish one semantic contract across existing subscription, entitlement, resource-limit, AI-usage, provider-cost and financial-settlement seams.

### A. Separate the commercial stages

```text
PlanDeclaration
!= AcceptedSubscriptionState
!= PaymentEvidence
!= EffectiveEntitlement
!= OperationAdmission
!= UsageEvidence
!= ProviderCostEvidence
!= CustomerChargeAssessment
!= Invoice/Payment/LedgerSettlement
```

### B. Entitlement period is first-class

Every metered allowance/overage must bind to a declared EntitlementPeriod or an explicit policy-defined calendar period. Do not silently mix `Subscription.currentPeriod*` with calendar-month resets.

### C. One customer billable basis

Customer allowance, credits remaining and overage consume the same frozen occurrence-time billable classification.

System/background AI remains visible in provider/platform cost but does not become customer overage merely because it shares a table.

### D. Exact operation admission

Declared plan limits become load-bearing only where the exact capability/resource admission boundary consumes them.

UI visibility is not enforcement.

Dormant limits require migration/grandfather policy before hard activation.

### E. Stable AI effect / metering correlation

A logical model effect and its attempts/fallbacks/modalities must correlate to:

- customer feature/capability;
- business/principal where relevant;
- usage classification;
- provider/model cost;
- trace/outcome;
- period identity.

Missing evidence is reconciled; a completed model effect is not replayed merely to reconstruct billing.

### F. Provider budget semantics

Distinguish:

```text
SOFT_ROUTING_BUDGET
HARD_ADMISSION_BUDGET
```

A hard budget needs concurrency-safe pre-effect reservation/fencing and a complete spend basis.

### G. Reuse current architecture

Prefer strengthening:

- PLANS / feature registry;
- Subscription / SubscriptionPayment;
- PlanLimitGuard / checkLimit;
- AiUsageService;
- ModelGateway;
- LLMProviderCost;
- K10 financial truth.

Do not introduce a second subscription engine, second AI gateway or second financial ledger.

### H. Governance

Billing authority, subscription activation/cancellation, hard budget changes and materially chargeable overrides consume K2/K3 effective authority rather than broad business membership alone.

### I. Correction / migration

Historical billable classification, payment evidence and prior charge assessment remain reconstructable after plan/rate/policy changes.

Corrections create new evidence/financial consequences; they do not rewrite settled history or replay model effects.

### J. Proof gates

Before implementation acceptance:

- billable/nonbillable allowance-overage parity;
- mid-period activation/renewal period tests;
- direct gateway/modality admission coverage;
- complete provider-cost budget population;
- hard-budget concurrency test;
- usage/cost partial-write reconciliation;
- subscription provider/manual evidence lifecycle;
- dormant-limit migration/grandfather behavior;
- historical rate/currency/version preservation;
- J22 voice/realtime stress test.

No production implementation is authorized by KF-REC-058.
