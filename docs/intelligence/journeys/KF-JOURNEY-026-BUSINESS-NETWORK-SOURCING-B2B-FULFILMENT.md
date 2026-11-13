# KF-JOURNEY-026 — Business Network → Sourcing → B2B Fulfilment

Checkpoint: `KFN-2026-09-17-01`  
Status: **NEW CANONICAL JOURNEY — PRODUCT TARGET DEFINED / IMPLEMENTATION UNPROVEN**  
Implementation forensic baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`.

## Purpose

J26 owns the end-to-end cross-business pathway from business need/opportunity through network discovery, trust/matching, sourcing, counterparty selection, procurement/commerce, fulfilment/logistics evidence and reputation/relationship learning.

```text
Need / Opportunity
→ SourcingPathway
→ Network search / map / community
→ candidate entity set
→ Index + query-specific fit evidence
→ RFQ / collaboration / referral
→ quote / proposal comparison
→ governed selection
→ order / PO / contract
→ fulfilment / logistics
→ invoice/payment
→ acceptance / outcome evidence
→ relationship + Index evidence update
```

## Why a new journey is justified

The previous 25 journeys cover public customer interaction, commerce, procurement-adjacent financial truth, connectors, knowledge and recovery, but do not explicitly own **cross-tenant business-network discovery and multi-counterparty sourcing/fulfilment as one causal journey**.

Existing source already contains partial community, directory, reputation, business matching, supplier and procurement systems. J26 converges those latent fragments.

No new kernel is required.

## Primary kernels

- K4 Business Knowledge
- K5 Capability Fabric
- K6 State Transition
- K7 Temporal/Event/Workflow
- K8 Evidence & Outcome
- K9 Integration/External Reality
- K10 Financial Truth
- K11 Recovery/Reliability

Secondary:
- K1 identity/claimed entity binding
- K2/K3 authority/governance
- K12 proof/change control

## Adjacent journeys

- J3 Lead/Customer/Cash
- J7 Financial Truth
- J9 Marketing/Lead Generation
- J10 Commerce/Fulfilment
- J11 Contract/Obligation
- J13 Connector Lifecycle
- J14 External Event Ingress
- J16 Business Genome
- J17 Command Center
- J18 Failure/Recovery
- J20 Entitlement
- J21 Public Customer Experience
- J23 Temporal Work
- J25 Human Authority

## Public/network context classes

### Claimed entity
Business/org has verified control of its KeyFlow identity/Space.

### Verified external entity
External source identity is evidenced, but entity may not be a KeyFlow tenant.

### Unclaimed directory entity
Visible discoverable entity with clear provenance and limited confidence.

### Relationship-bound counterparty
Entity has a direct evidenced quote/order/referral/collaboration/supplier relationship with a KeyFlow business.

These classes must not be collapsed.

## J26 invariants

1. directory presence != verification;
2. verification != high reputation;
3. reputation != query-specific fit;
4. ranking evidence is explainable;
5. paid promotion cannot silently alter trust score;
6. need interpretation remains editable before binding spend/contract;
7. one sourcing need has durable identity;
8. RFQ/provider matching retry does not duplicate binding commitments;
9. selected provider/business identity is exact and tenant-safe;
10. quote comparison preserves units/currency/scope;
11. PO/order/contract is a governed commitment;
12. fulfilment state is not inferred from invoice state;
13. delivery/acceptance evidence remains distinct;
14. external logistics uncertainty remains explicit;
15. one bad event is not permanent unbounded reputation truth;
16. Index evidence is provenance/freshness bound;
17. unclaimed entities can dispute/correct public facts where policy allows;
18. sensitive/protected traits are not ranking inputs;
19. new/low-history entities have an exploration path;
20. user can understand why KEY recommended an entity/path;
21. KEY may propose sourcing and negotiate bounded options but cannot exceed spend/contract authority;
22. multi-provider dependency failure triggers recovery/replanning rather than silently replacing material counterparties;
23. Network relationship learning cannot self-grant authority;
24. community engagement does not equal commercial trust.

## Existing seams to preserve/reconcile

- CommunityService
- ReputationService
- NetworkAnalyticsService
- BusinessMatchingService
- DirectoryController/search
- SupplierService / SupplierConnection
- ProcurementService / ProcurementRequest / PurchaseOrder
- existing marketplace/community/profile UI

These are implementation candidates, not proof of converged runtime.

## Proof families

J26-N01 entity claim cannot cross tenant.  
J26-N02 unclaimed entity clearly displays provenance/confidence.  
J26-N03 paid promotion does not change organic Index score.  
J26-N04 stale evidence decays/marks freshness.  
J26-N05 disputed review/fact follows correction policy.  
J26-N06 query-specific match explanation cites actual evidence.  
J26-N07 no-history entity can surface under exploration policy.  
J26-N08 RFQ replay does not duplicate commercial commitment.  
J26-N09 quote comparison normalizes scope/currency or declares incomparable.  
J26-N10 provider selection above authority threshold requires control evidence.  
J26-N11 PO/order binds exact selected counterparty.  
J26-N12 fulfilment and invoice are independent states.  
J26-N13 logistics unknown does not become delivered.  
J26-N14 backup-provider substitution requires current policy/authority.  
J26-N15 multi-provider pathway preserves dependency ordering.  
J26-N16 completed outcome updates Index evidence once.  
J26-N17 malicious self-review/network gaming is rejected/discounted per evidence policy.  
J26-N18 map query cannot leak private addresses.  
J26-N19 entity profile links to correct KeyFlow Space.  
J26-N20 community need matching is advisory until governed procurement/action occurs.

Bindings: 0. Runtime status: NOT_EXECUTED.

## Disposition

J26 is accepted as the canonical network/sourcing journey.

The canonical journey set is now **26**, with 26 dedicated journey dossiers. This product expansion reopens whole-OS readiness only to incorporate the new J26 execution packet/dependencies—not the previously settled kernel architecture.
