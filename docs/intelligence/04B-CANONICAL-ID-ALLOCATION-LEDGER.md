# KeyFlowOS Canonical ID Allocation Ledger

Status: CANONICAL — OVERRIDES LEGACY COLLIDING ALLOCATIONS
Last updated: 2026-09-06

Purpose: provide one unambiguous allocator for Finding (`F###`), Contradiction (`C###`) and Recommendation (`KF-REC-###`) identities.

## Governing rule

If any historical supplement still says `CANONICAL` for a colliding ID, **this ledger wins**. Historical evidence remains valuable; the old numeric heading is not a canonical allocation. Never delete or reuse an allocated identity.

## Preserved mature lineage

```text
F145–F160 temporal/external/recovery lineage
F161–F178 J16/K4 knowledge lineage
F179–F184 J17 operator-control lineage
F185–F196 J7 Financial Truth
F197–F205 J3/J4 commercial-to-cash
F206–F213 J10 Commerce/Fulfilment active microscopic findings
```

```text
C096–C110 temporal/external/recovery lineage
C111–C128 J16/K4 contradictions
C129–C134 J17 contradictions
C135–C146 J7 contradictions
C147–C155 J3/J4 contradictions
C156–C163 J10 active contradictions
```

Current recommendation range remains through `KF-REC-053`.

## Mature recommendation anchors

```text
KF-REC-047 Temporal Work Projection
KF-REC-048 certainty-aware Recovery Contract
KF-REC-049 provenance/revision-aware Business Knowledge Contract
KF-REC-050 load-bearing WorkDefinition control contract
KF-REC-051 Operator Attention & Priority Contract
KF-REC-052 Financial Truth & Valuation Contract
KF-REC-053 Commercial Relationship & Obligation Contract
```

## J10 Commerce / Fulfilment allocations

- F206 / C156 — duplicate paid-Invoice descendant ownership for one successful storefront checkout — `08AK` / `09AK`.
- F207 / C157 — operational order `CONFIRMED` emits `store_order.paid` while payment state can remain PENDING/UNPAID — `08AL` / `09AL`.
- F208 / C158 — checkout, routing, shipment and correction compete for one tracked-stock effect lineage — `08AM` / `09AM`.
- F209 / C159 — aggregate `store_order.fulfillment_routed` can mask required per-item route failure — `08AM` / `09AM`.
- F210 / C160 — Shopify Product repeat sync cannot reconcile prior import when lookup identity and persisted SKU identity differ — `08AN` / `09AN`.
- F211 / C161 — partial fulfilment route set can block retry because any existing route is treated as complete idempotency — `08AO` / `09AO`.
- F212 / C162 — Shopify order sync and customer sync disagree on Contact identity resolution, allowing duplicate Contacts after mutable email change — `08AP` / `09AP`.
- F213 / C163 — Shopify orders enter MarketplaceOrder without relational order-item descendants; provider line items exist only in metadata with no materialization listener — `08AQ` / `09AQ`.

J10 currently reuses KF-REC-053 commercial lineage/state semantics, KF-REC-052 financial truth, KF-REC-048 recovery semantics, and K9 external-identity boundaries. Recommendation pressure is under review; no new recommendation allocated yet.

## Current ranges

```text
Findings:        F001–F213
Contradictions:  C001–C163
Recommendations: KF-REC-001–KF-REC-053
```

## Agent pre-allocation gate

```text
LOAD 04A + 04B
→ CHECK CURRENT ranges
→ SEARCH semantic equivalents
→ REUSE / REFINE / CROSS-REFERENCE
→ only then allocate next unused ID
→ one canonical home definition
→ update 04B + CURRENT + ROLLOVER
```

No production implementation is authorized by this ledger.
