# KF-JOURNEY-003 — Lead → Customer → Cash

Status: **PROVISIONALLY CONVERGED / TARGET-ALIGNED ANALYTICAL TRANCHE**
Last updated: 2026-09-06
Implementation evidence: `main@4e9f60c65bdb78fbdadcb08731c5dab95b3645c7`
Canonical intelligence branch: `docs/keyflow-intelligence-foundation`
Production implementation remains **UNAUTHORIZED / READ-ONLY**.

## A. Definition

J3 models how KeyFlowOS turns a person or organization from an observed lead into a commercially meaningful customer relationship and then into coherent customer-value and cash evidence.

It asks:

> When KeyFlow says someone is a lead, prospect, client/customer, high-value customer, or has a certain lifetime value, which evidence and policy make that statement true, and how is the same economic sale prevented from being counted multiple times across Deal, Booking, Invoice and Payment stages?

Primary kernels:

```text
K6  State Transition
K8  Evidence & Outcome
K4  Business Knowledge
K10 Financial Truth
K7  Temporal / Event / Workflow where automated consequences are involved
K11 Recovery where required descendants are missing
```

Primary adjacent journeys:

```text
J4  Booking → Service → Payment
J7  Financial Truth
J10 Commerce / Fulfilment
J16 Business Genome Evolution
J17 Command Center → Priority → Action
J18 Failure → Recovery
J23 Temporal Flow / Long-Running Workflow
```

---

## B. Product intent

Target product behavior:

```text
lead/contact evidence
→ opportunity / commercial interaction
→ quote / booking / order / accepted commitment
→ invoice / payment / correction evidence
→ governed customer-lifecycle assessment
→ canonical relationship-state projection
→ stage-explicit commercial value projection
→ downstream CRM / People / AI / operator consumers
```

A user should be able to ask:

- Is this person actually a current customer/client, and why?
- Which evidence caused the lifecycle transition?
- Is this relationship healthy, dormant or at-risk without changing its lifecycle identity?
- Is this value pipeline, committed, invoiced, collected or net realized?
- Does lifetime value count one economic sale once?
- Did a refund/correction change current value without deleting historical evidence?
- Which external provider label was mapped into the canonical lifecycle algebra?

and receive an answer with explicit provenance rather than whichever local status vocabulary a module happens to use.

---

## C. Current-state commercial chain

The reconstructed live chain spans multiple independently meaningful states:

```text
Contact
  status String, CRM-facing algebra LEAD | PROSPECT | CLIENT | LOST
  relationshipHealth separate
  lifecycle/pipeline annotations also exist

Deal / pipeline evidence
  → Deal WON may establish strong commercial evidence

Quote / commerce evidence
  → Quote ACCEPTED
  → Quote converted to Invoice

Invoice / Payment evidence
  → Invoice PAID
  → provider/payment/accounting descendants under J7/K10

Store / integration evidence
  → StoreOrder PAID/completed
  → Shopify customer/order imports

Derived customer intelligence
  → ContactInsight lifetimeValue
  → People Flow / KeyCortex / OS customer projections
```

The current system does not expose one load-bearing lifecycle convergence policy across that chain.

---

## D. Current state algebra — observed conflict

### D1. CRM-facing lifecycle vocabulary

```text
LEAD | PROSPECT | CLIENT | LOST
```

`CrmService.createContact()` defaults to `LEAD`.

### D2. Shopify writer vocabulary

Live Shopify synchronization can persist:

```text
LEAD | CUSTOMER
```

including updates to existing Contact rows.

### D3. People Flow interpretation

Relationship-health/segmentation logic has been observed interpreting `Contact.status` using values including:

```text
LEAD | PROSPECT | CUSTOMER | DORMANT | AT_RISK
```

while `relationshipHealth` separately owns relationship-condition semantics.

### D4. KeyCortex predicates

KeyCortex CRM context uses local predicates including lowercase/non-canonical:

```text
lead | customer
```

### D5. Consequence

```text
one persisted Contact.status String
→ multiple incompatible lifecycle / health dialects
→ no universal canonical interpretation for downstream consumers
```

The target must not repair this by expanding one catch-all enum.

---

## E. Customer relationship state — target ownership

J3 adopts the KF-REC-053 separation:

```text
CustomerLifecycleState
!= RelationshipHealthState
!= DealState / DealStage
!= tags / segments / annotations
```

### CustomerLifecycleState

Owns broad commercial relationship semantics under a versioned transition policy.

Required properties:

- qualifying and disqualifying/correction evidence;
- business/effective time;
- system-known time where material;
- policy version;
- transition provenance;
- manual-override policy;
- external-provider mapping provenance.

The exact final enum is intentionally not frozen. Observed implementation words are evidence, not automatically the target algebra.

### RelationshipHealthState

Owns current relationship condition such as healthy/at-risk/dormant. A dormant historical/current client does not become a non-client merely because relationship health changed.

### DealState / DealStage

Owns opportunity-specific progression. One Contact can have several Deals. `Deal WON` is evidence available to lifecycle policy, not the Contact lifecycle itself.

### Tags / segments

Remain descriptive/analytical unless an explicit policy consumes them as evidence.

---

## F. Frontend / consumer surface pressure

Current downstream consumers include CRM, People Flow, KeyCortex, OS/high-value-customer surfaces and operator intelligence.

The defect is not merely one wrong label. Different consumers can answer materially different questions from the same Contact because they assume different status vocabularies or combine different commercial stages.

Target read surfaces should consume a canonical relationship-state adapter/projection with provenance, not raw provider aliases or local status guesses.

---

## G. API / write-door pressure

The current Contact status persistence is a Prisma `String`, so domain DTO restrictions do not protect all writers.

Target migration sequence from KF-REC-053:

```text
inventory live values/origins
→ establish canonical lifecycle read adapter
→ establish provider/import mappings
→ backfill deterministic aliases
→ preserve ambiguous history as unresolved evidence
→ cut consumers to canonical interpretation
→ enforce validated write doors only after parity proof
```

Direct integration writes must not silently redefine lifecycle semantics.

---

## H. Backend / event chain

Commercial events such as quote conversion, invoice payment and store-order payment can create strong customer evidence and timeline/history signals.

However current inspected event listeners do not provide one domain-owned transition law that says:

```text
commercial evidence E
+ lifecycle policy version V
→ CustomerLifecycleState transition S
```

An AI journey template can attempt a `CLIENT` update, but that is not equivalent to a canonical lifecycle state owner and is separately affected by F204 event/tool contract incompatibility in J4.

---

## I. Data mutation ledger — relevant semantic owners

| Domain/model | Current role | Target interpretation |
|---|---|---|
| Contact.status | Persisted free-form status string | Legacy/current evidence to migrate behind canonical lifecycle contract |
| Contact.relationshipHealth | Relationship-condition state | Orthogonal to lifecycle |
| Deal | Opportunity/pipeline state and value | Commercial evidence, not party lifecycle |
| Quote | Offer/acceptance evidence | Commercial-obligation evidence |
| Invoice | Receivable/document state | Financial descendant; governed by J7/K10 for financial truth |
| Payment | Money-movement evidence | J7/K10 financial truth input |
| StoreOrder | Commerce evidence | External/domain commercial evidence through adapter |
| ContactInsight | Derived customer intelligence | Stage-explicit, lineage-deduplicated projection |
| RevenueAttribution | Derived commercial attribution | Must declare CommercialValueStage and lineage |

---

## J. Tenant / identity

Every lifecycle/value projection remains business-scoped.

A Contact's commercial relationship is with a specific Business. Provider/import mappings, lineage, lifecycle policy versions and value projections must preserve `businessId`; external identities must not collapse cross-tenant customer state.

---

## K. Events / coordination

Event names are evidence carriers, not self-sufficient lifecycle transitions.

Required target chain:

```text
canonical DomainEventSchema
→ typed evidence adapter
→ lifecycle/obligation policy evaluation
→ declared transition or no-transition
→ provenance/evidence record
→ downstream projection invalidation/refresh
```

Event name equality does not establish schema compatibility. F204 demonstrates this directly in the adjacent post-booking path.

---

## L. KEY / AI

KEY/KeyCortex may reason over customer state only after the state/evidence is epistemically eligible under KF-REC-049.

Target rule:

```text
raw Contact.status alias
!= canonical customer fact
!= learning-eligible evidence
```

AI must not invent lifecycle transitions from local synonyms, nor treat a derived high-value/LTV projection as authoritative financial truth.

---

## M. Capability mapping

Candidate lifecycle-changing capabilities must bind to:

- exact Contact/business identity;
- intended canonical lifecycle transition;
- evidence references;
- policy version;
- authority/governance where manual override is material;
- correction/reversal behavior.

Automated event→action capabilities additionally require the KF-REC-053 `EventToActionContractAdapter` pressure: schema mapping must compose before activation/execution.

---

## N. Authority / governance

Commercial evidence can support a transition but does not itself grant mutation authority.

Manual override, integration import and AI-proposed lifecycle changes should have declared provenance and governance. KF-REC-053 owns lifecycle semantics; K3 owns execution authority; KF-REC-049 owns knowledge provenance/eligibility.

---

## O. Business Graph / Knowledge alignment

The target relationship view is an evidence-linked projection over domain facts, not a replacement universal CRM table.

Working shape:

```text
party identity
+ commercial evidence
+ canonical lifecycle policy
+ relationship health
+ active opportunity/service/financial relationships
+ provenance
→ explainable RelationshipStateVector / customer operating view
```

This view may be derived/materialized, but its dimensions keep distinct owners.

---

## P. Canonical J3 invariants

1. CustomerLifecycleState has one canonical owner/algebra version.
2. RelationshipHealthState is not customer lifecycle.
3. Deal state/stage is not customer lifecycle.
4. Tags/segments do not silently become lifecycle truth.
5. External-provider labels require explicit adapter mappings.
6. Commercial evidence remains historically available after later corrections.
7. Lifecycle transitions preserve policy/evidence provenance.
8. Deal WON or Invoice PAID is evidence, not an unconditional hard-coded permanent-client rule.
9. Pipeline value, committed value, invoiced value, collected value and net realized value are non-equivalent stages.
10. One economic sale must not be added multiple times in a stage-specific customer-value metric.
11. Refunds/credits/corrections change current derived value without erasing history.
12. Currency/valuation follows KF-REC-052/J7 semantics.
13. Downstream AI/operator projections consume canonical interpretations rather than local aliases.
14. Knowledge/learning consumes only epistemically eligible evidence under KF-REC-049.

---

## Q. Failure matrix

| Failure | Current risk | Target behavior |
|---|---|---|
| Strong commercial evidence while Contact remains LEAD | F197 | policy-governed lifecycle assessment/convergence |
| Shopify writes CUSTOMER over canonical states | F205 | provider mapping + validated write door |
| People Flow reads health words as lifecycle | F205 | orthogonal health projection |
| KeyCortex queries lowercase/noncanonical statuses | F203 | canonical lifecycle adapter |
| Deal + paid invoice both added to LTV | F198 | lineage/stage dedupe |
| Booking + invoice attribution both summed | F202 adjacency | stage-explicit commercial value |
| Refund after prior revenue | J7/K10 adjacency | recompute current value from correction-aware financial truth |
| Event/action mapping malformed | F204 adjacency | compile/testable schema adapter |

---

## R. Idempotency / transactions / concurrency

Lifecycle convergence requires semantic transition identity rather than event-attempt identity.

Repeated evidence delivery must not duplicate the logical transition or corrupt provenance. Corrections must preserve prior evidence and derive the current state under declared policy rather than destructive rewriting.

Commercial value dedupe must use commercial lineage/stage, not merely row identity.

---

## S. Security / privacy

Lifecycle state and customer-value projections are tenant-scoped business data. Provider mappings and manual overrides must preserve actor/source provenance. J19 privacy/deletion rules remain applicable to source evidence and derived projections.

---

## T. Observability

A lifecycle/value explanation should be able to show:

```text
current lifecycle state
policy version
qualifying evidence
correction/disqualifying evidence
last evaluated time
relationship health separately
value stage
commercial lineage
valuation basis
completeness / exclusions
```

---

## U. Proof / test pressure

Future proof obligations include:

- provider aliases cannot persist as undeclared canonical lifecycle values;
- relationship health cannot leak into lifecycle state;
- Deal WON/Invoice PAID evidence causes only policy-authorized transition;
- correction/refund preserves historical evidence;
- CRM/People/KEY consumers agree on one canonical lifecycle interpretation;
- same sale cannot be double-counted across Deal/Booking/Invoice stages in a stage-specific metric;
- mixed currencies use KF-REC-052 valuation semantics;
- net-realized projections respond correctly to refunds/credits/reversals.

Runtime proof has not been executed in this analytical programme.

---

## V. Reachability

F197, F198, F203 and F205 are based on mounted/live domain or consumer paths, not merely stale documentation.

The post-booking automation path that appears to update `CLIENT` is live in orchestration but contract-malformed under F204; therefore it is not evidence that lifecycle convergence is currently reliable.

---

## W. Duplication / competing truths

Current competing semantic families:

```text
CRM Contact.status
Shopify CUSTOMER/LEAD writes
People Flow status/health assumptions
KeyCortex lowercase status predicates
Deal pipeline state
lifecycleStage / pipelineStage annotations
relationshipHealth
customer/store tags
ContactInsight lifetimeValue
RevenueAttribution stage-mixed rows
```

Target architecture converges their meaning through owned dimensions and adapters rather than deleting all domain-specific state.

---

## X. Architecture alignment

J3 is now aligned to:

- `KF-REC-053 — Commercial Relationship & Obligation Contract` for customer lifecycle, commercial evidence, lineage and value stages;
- `KF-REC-052 — Financial Truth & Valuation Contract` for financial descendants and valuation;
- `KF-REC-049 — Business Knowledge Contract` for provenance/revision/epistemic eligibility;
- `KF-REC-047/048/051` for temporal projection, recovery and operator attention where applicable.

No new universal runtime is introduced.

---

## Y. Canonical contradictions

Primary J3 contradictions:

```text
C147 commercial customer evidence != converged Contact lifecycle state
C148 pipeline/WON value + realized invoice value != non-duplicative LTV
C152 BOOKING pipeline attribution + paid INVOICE attribution != additive realized revenue
C153 canonical CRM status vocabulary != KeyCortex lowercase/noncanonical predicates
C155 one persisted Contact.status != incompatible lifecycle/health dialects
```

---

## Z. Open questions

1. What exact final CustomerLifecycleState algebra best fits KeyFlow product semantics?
2. Which commercial evidence combinations are sufficient for each transition?
3. How should refunds, chargebacks, reversals and relationship termination affect current lifecycle state versus historical customer identity?
4. Which legacy Contact.status values exist in live data and what are their origins?
5. Which ambiguous historical values cannot be safely auto-mapped?
6. Which consumer should be cut over first after a canonical read adapter exists?
7. Which commercial lineage identity best deduplicates customer value across Deals, Bookings, Orders and Invoices without creating a universal commercial table?

---

## AA. Canonical findings

Primary:

```text
F197 commercial customer evidence can advance while Contact.status remains LEAD
F198 Contact LTV adds pipeline success and realized revenue as independent value
F203 KeyCortex queries a noncanonical lowercase customer-status vocabulary
F205 persisted Contact.status admits incompatible lifecycle and health dialects
```

Cross-journey supporting pressure:

```text
F202 RevenueAttribution conflates booking/pipeline and realized invoice stages
F204 live post-booking journey has incompatible event/tool contracts
```

---

## AB. Canonical journey graph

```text
external/domain signal
        ↓
Contact / Deal / Quote / Booking / Order evidence
        ↓
Commercial evidence adapter
        ↓
CustomerLifecycle policy + version
        ↓
CustomerLifecycleState + transition provenance
        ├── RelationshipHealthState (orthogonal)
        ├── DealState/Stage (orthogonal opportunity state)
        └── tags/segments (descriptive)
        ↓
CommercialObligationLineage / CommercialValueStage
        ↓
Invoice / Payment / Refund / Credit descendants
        ↓
KF-REC-052 Financial Truth
        ↓
stage-explicit customer value + CRM/People/KEY/operator projections
        ↓
KF-REC-049 epistemic eligibility for learning/knowledge consumption
```

---

## AC. Machine-readable record

```yaml
journey: KF-JOURNEY-003
name: Lead -> Customer -> Cash
status: PROVISIONALLY_CONVERGED_TARGET_ALIGNED
implementation_baseline: 4e9f60c65bdb78fbdadcb08731c5dab95b3645c7
production_implementation_authorized: false
primary_kernels: [K6, K8, K4, K10]
adjacent_journeys: [J4, J7, J10, J16, J17, J18, J23]
primary_findings: [F197, F198, F203, F205]
supporting_findings: [F202, F204]
primary_contradictions: [C147, C148, C153, C155]
supporting_contradictions: [C152, C154]
target_recommendations: [KF-REC-053, KF-REC-052, KF-REC-049]
canonical_laws:
  - CustomerLifecycleState != RelationshipHealthState
  - CustomerLifecycleState != DealState/DealStage
  - tags/segments != lifecycle truth
  - pipeline_value != invoiced_value != collected_value != net_realized_value
  - commercial_evidence != lifecycle_transition_until_policy_says_so
runtime_proof: NOT_EXECUTED
reopenable: true
```

## Current maturity

```text
MICROSCOPIC RECONSTRUCTION:      complete for current J3 tranche
CROSS-KERNEL RECONCILIATION:    complete for current tranche
TARGET SYNTHESIS:                complete via KF-REC-053
BACKWARD RE-AUDIT:               complete for current J17/J18/J23/J7/K4 impact set
PRODUCTION IMPLEMENTATION:       not authorized
RUNTIME / MIGRATION PROOF:       not executed
WHOLE-SYSTEM REAUDIT:            future
```

J3 remains reopenable when J10/J11, live-data inventory, implementation planning or runtime proof adds new evidence.
