# J3/J4 → J17/J18/J23 Backward Re-audit — Commercial Relationship & Obligation Contract

Status: BACKWARD RE-AUDIT COMPLETE FOR CURRENT TRANCHE
Last updated: 2026-09-06
Production implementation: NOT AUTHORIZED

Scope:
- J3/J4 F197–F205 / C147–C155
- KF-REC-053 Commercial Relationship & Obligation Contract
- J17 / KF-REC-051
- J18 / KF-REC-048
- J23 / KF-REC-047 and WorkOccurrence semantics
- J16 / KF-REC-049
- J7 / KF-REC-052

Verdict:

```text
NO EARLIER TARGET IS REFUTED
SEVERAL EARLIER TARGETS REQUIRE STRONGER INPUT CONTRACTS
NO NEW UNIVERSAL RUNTIME IS JUSTIFIED
```

---

# 1. J17 Operator Attention backward re-audit

## Prior target survives

J17 remains a derived attention/control surface. It must not own customer lifecycle, commercial obligation or financial truth.

Prior law survives:

```text
IMPORTANT != ACTIONABLE != AUTHORIZED != OWED != RECOVERABLE != EXECUTED != RESOLVED
```

## New pressure from J3/J4

F199 creates a class of work that does not exist as a descendant row:

```text
Booking COMPLETED
+ policy says invoice required
+ invoice creation failed
+ no Invoice row
```

An attention system that only scans existing problematic rows cannot surface this.

Target refinement:

```text
source state
+ ExpectedConsequence evaluation
→ AttentionAdmission
```

J17 must therefore accept **absence-derived attention candidates** from authoritative source/policy evaluation.

F201 adds:

```text
Booking CANCELLED/NO_SHOW
+ financial descendants exist
+ no disposition completed
→ unresolved commercial obligation attention candidate
```

F205 adds a projection-quality requirement:

```text
customer lifecycle contradiction / unmapped external status
→ source contradiction/completeness signal
→ may affect priority and explanation
```

Do not make J17 resolve these contradictions itself.

### Existing roots reused

- F179/C129 source degradation/completeness.
- F184/C134 priority semantic compression.
- KF-REC-051 source-health/provenance and multidimensional priority.

No new J17 finding is required.

---

# 2. J18 Failure → Recovery backward re-audit

## Prior recovery contract survives

KF-REC-048 still owns:
- retry certainty;
- reconcile-before-retry;
- reversal/compensation identity;
- recovery authority;
- original vs recovery outcome.

## New input identity

Commercial repair requires a source semantic identity stronger than an arbitrary retry command:

```text
CommercialObligationId
+ ExpectedConsequence semantic kind
→ stable EffectId / repair identity
→ WorkOccurrence / AttemptId
```

This prevents a missing invoice repair from generating unlimited invoices across retries/plans.

## Compensation refinement

Current KeyCortex compensation can cancel a booking by calling `updateBookingStatus(..., CANCELLED)`.

Under F201:

```text
booking status cancellation returned successfully
!= commercial/financial inverse effect confirmed
```

This is an instance of mature F152:

```text
compensation handler return
!= inverse effect confirmed
```

Target consequence:
- booking cancellation may be only one step of compensation;
- financial disposition must be explicit;
- RecoveryOutcomeEvidence must distinguish operational cancellation from full commercial/financial compensation.

No duplicate recovery finding is required.

---

# 3. J23 Temporal / Long-running Work backward re-audit

## Prior WorkOccurrence semantics survive

```text
CommercialObligationId != WorkOccurrenceId != EffectId != AttemptId
```

A commercial obligation can generate multiple temporal work occurrences:
- issue invoice;
- chase overdue balance;
- refund/credit after cancellation;
- manual review disposition;
- repair missing descendant.

## New occurrence source

Expected commercial consequences become a legitimate source of durable work:

```text
ExpectedConsequence becomes due/failed
→ WorkOccurrence
→ current source/policy revalidation
→ governance if required
→ effect/recovery
```

A missing descendant should not be represented by fabricating an Invoice solely to get temporal visibility.

KF-REC-047 Temporal Work Projection can materialize:
- missing required invoice;
- unresolved cancellation disposition;
- overdue disposition/manual review;
- stale/unmapped lifecycle contradiction where operationally important.

Projection remains non-authoritative.

---

# 4. J16 / K4 Business Knowledge backward re-audit

F205 materially strengthens why consumer-specific EpistemicEligibility exists.

A raw stored fact such as:

```text
Contact.status = CUSTOMER
```

cannot automatically become a canonical business fact if:
- source is Shopify adapter dialect;
- CRM canonical algebra expects CLIENT;
- People Flow may interpret different semantics;
- historical migration origin is unknown.

Target:

```text
raw source value
→ adapter mapping / conflict state
→ lifecycle evidence
→ canonical current relationship assertion
→ EpistemicEligibility for consumer
```

Learning must not infer “customer churn” from `DORMANT` if that value leaked from relationship-health semantics into a lifecycle field.

KF-REC-049 survives and is strengthened; no new K4 recommendation required.

---

# 5. J7 / K10 Financial Truth backward re-audit

KF-REC-053 must remain upstream/adjacent, not replace KF-REC-052.

Boundary:

```text
KF-REC-053 decides / derives:
- commercial obligation
- deposit allocation intent
- cancellation/no-show disposition
- expected financial descendants

KF-REC-052 proves / owns:
- Payment / provider money reality
- invoice financial balance semantics
- accounting consequence
- reconciliation
- valuation
- financial correction completion
```

F200 does not authorize commercial code to directly manipulate ledger values.

F201 does not authorize booking cancellation code to directly refund money without K3/K10/K11 controls.

J7 target remains unchanged except for a stronger upstream source contract.

---

# 6. Cross-target causal graph

```text
Commercial Evidence
    ↓
KF-REC-053 CustomerLifecycle / CommercialObligationLineage
    ├──────────────→ KF-REC-049 eligible Business Knowledge
    │
    ├─ Expected Financial Consequence
    │        ↓
    │   KF-REC-052 Financial Truth
    │
    ├─ Missing / Due / Failed Consequence
    │        ↓
    │   KF-REC-047 Temporal Work Projection
    │        ↓
    │   KF-REC-051 Operator Attention
    │
    └─ Repair / Reconcile / Reverse required
             ↓
        KF-REC-048 Recovery
             ↓
        current K3 governance / Clearance
```

Feedback:

```text
Outcome / refund / cancellation / correction evidence
→ commercial obligation closure
→ lifecycle/relationship re-evaluation where policy says relevant
→ projections recompute
→ knowledge/learning eligibility re-evaluated
```

---

# 7. Local proof obligations — PF-J34-COM-001..028

1. A canonical customer-lifecycle read returns one interpretation for CRM, People Flow and KeyCortex for the same Contact.
2. Shopify `CUSTOMER` maps explicitly or becomes unresolved; it cannot silently persist as canonical lifecycle state.
3. RelationshipHealth `DORMANT/AT_RISK` cannot be consumed as lifecycle status without an explicit mapping contract.
4. Deal WON is retained as evidence and cannot silently overwrite lifecycle state outside policy.
5. Lifecycle transition records policy/version/evidence provenance.
6. Correcting source evidence recomputes current lifecycle without deleting history.
7. One service obligation with deposit D and price P exposes remaining obligation P-D when policy says deposit is advance consideration.
8. An explicit retained-fee policy can produce a different lawful disposition without falsifying the service price.
9. Booking COMPLETED with required invoice missing creates a detectable ExpectedConsequence failure even with zero Invoice rows.
10. Repair of the missing invoice is idempotent on commercial obligation/effect identity.
11. Crash after invoice creation but before Booking.invoiceId linking reconciles the existing invoice before creating another.
12. Cancellation with no financial descendants can close without fabricating refund work.
13. Cancellation with a paid deposit selects an explicit policy disposition.
14. NO_SHOW can choose a different policy disposition from cancellation when configured.
15. Operational `Booking.status=CANCELLED` alone cannot become confirmed full compensation evidence.
16. Refund/credit/retain/fee descendants delegate financial correctness to KF-REC-052.
17. Revenue projection labeled EXPECTED cannot be returned as NET_REALIZED without explicit transformation.
18. BOOKING + INVOICE rows for one obligation do not double-count a stage-specific metric.
19. Refund/credit reduces NET_REALIZED under canonical financial semantics without erasing original expected/committed history.
20. Multi-currency commercial value delegates valuation to KF-REC-052.
21. Incompatible event→action mapping fails validation before effect execution.
22. Event schema version and action schema version are traceable from occurrence to execution evidence.
23. Plan/message retry cannot duplicate the commercial effect when a new plan ID is created for the same obligation.
24. J17 can surface a missing required descendant without owning or fabricating it.
25. J17 displays source completeness/contradiction when customer state cannot be canonically mapped.
26. J18 recovery preserves original commercial/financial outcome and separate recovery outcome.
27. J23 can schedule/resume consequence repair without collapsing CommercialObligationId into WorkOccurrenceId.
28. K4/Genome learning excludes unresolved lifecycle dialects and retracts/recomputes descendants after correction.

---

# 8. Deterministic fault-injection points — FI-J34-COM-01..12

1. After Booking COMPLETED commit, before required invoice creation.
2. After Invoice creation, before Booking.invoiceId link.
3. After deposit Payment success, before commercial allocation/booking projection update.
4. During cancellation after Booking status write, before disposition selection.
5. After disposition selection, before refund/credit effect claim.
6. After provider refund possible success, before local financial descendants converge.
7. During RevenueAttribution BOOKING record before later INVOICE attribution.
8. On external customer sync with unknown lifecycle alias.
9. Between event receipt and event→action schema validation.
10. After AiPlan creation but before semantic commercial EffectId binding.
11. During missing-consequence repair after an existing descendant is discovered.
12. During lifecycle correction after downstream K4/attention projections consumed the prior interpretation.

No runtime fault injection has been executed.

---

# 9. Re-audit verdict

```text
J17: survives; must admit absence-derived/contradiction-aware candidates
J18: survives; commercial identity/disposition strengthens compensation proof
J23: survives; expected consequences become a source of durable work
J16/K4: survives; F205 strengthens EpistemicEligibility requirement
J7/K10: survives; receives stronger upstream commercial obligation/disposition contract
```

KF-REC-053 is therefore compatible with the existing pooled architecture and adds a missing semantic layer rather than duplicating it.

No production implementation is authorized by this re-audit.
