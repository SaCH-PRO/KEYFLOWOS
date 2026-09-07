# KeyFlowOS Canonical ID Allocation Ledger

Status: CANONICAL — OVERRIDES LEGACY COLLIDING ALLOCATIONS
Last updated: 2026-09-06

Purpose: provide one unambiguous allocator for Finding (`F###`), Contradiction (`C###`) and Recommendation (`KF-REC-###`) identities.

## Governing rule

If any historical supplement still says `CANONICAL` for a colliding ID, **this ledger wins**. Historical evidence remains valuable; the old numeric heading is not a canonical allocation.

Never delete or reuse an allocated identity. Historical collisions resolve as REMAP or ALIAS/SUPERSEDED.

## Preserved mature lineage

```text
F145–F160 temporal/external/recovery lineage
F161–F166 initial J16/K4 epistemic-integrity findings
F167–F174 recovered historical collision-band findings
F175–F178 J16/K4 knowledge-consumption/learning/correction findings
F179–F184 J17 Command Center / operator-control findings
F185–F196 J7 Financial Truth findings
F197–F205 J3/J4 commercial-to-cash findings
F206–F211 J10 Commerce/Fulfilment active microscopic findings
```

```text
C096–C110 temporal/external/recovery lineage
C111–C116 initial J16/K4 contradictions
C117–C124 recovered historical collision-band contradictions
C125–C128 J16/K4 knowledge-consumption/learning/correction contradictions
C129–C134 J17 Command Center / operator-control contradictions
C135–C146 J7 Financial Truth contradictions
C147–C155 J3/J4 commercial-to-cash contradictions
C156–C161 J10 Commerce/Fulfilment active contradictions
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

- F206 / C156 — one successful storefront checkout has two mounted paid-invoice creation owners whose dedupe identities do not compose — `08AK` / `09AK`.
- F207 / C157 — operational order `CONFIRMED` emits `store_order.paid` while separate payment state can remain PENDING/UNPAID — `08AL` / `09AL`.
- F208 / C158 — native paid checkout decrements tracked stock while post-payment fulfilment routing applies a second reservation effect to the same sold units — `08AM` / `09AM`.
- F209 / C159 — aggregate `store_order.fulfillment_routed` is emitted even when required per-item FulfillmentRoute state is FAILED — `08AM` / `09AM`.
- F210 / C160 — Shopify product sync looks up by synthetic variant-id-as-SKU but persists real SKU when supplied, so repeat sync cannot resolve the prior Product — `08AN` / `09AN`.
- F211 / C161 — fulfilment routing uses any existing route as an idempotency guard, so a partial route set after failure causes retry to skip missing required item routes — `08AO` / `09AO`.

J10 currently reuses KF-REC-053 commercial lineage/state semantics, KF-REC-052 financial truth, KF-REC-048 recovery semantics, and K9 external-identity boundaries; no new recommendation allocated yet.

## Current ranges

```text
Findings:        F001–F211
Contradictions:  C001–C161
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
