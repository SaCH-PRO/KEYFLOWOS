# KeyFlowOS Canonical ID Allocation Ledger

Status: CANONICAL — OVERRIDES LEGACY COLLIDING ALLOCATIONS
Last updated: 2026-09-07

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
F206–F214 J10 Commerce/Fulfilment
F215–F218 J11 Contract/Obligation/Renewal
F219–F221 J12 Document/Evidence Lifecycle
```

```text
C096–C110 temporal/external/recovery lineage
C111–C128 J16/K4 contradictions
C129–C134 J17 contradictions
C135–C146 J7 contradictions
C147–C155 J3/J4 contradictions
C156–C164 J10 contradictions
C165–C168 J11 contradictions
C169–C171 J12 Document/Evidence Lifecycle
```

Current recommendation range is through `KF-REC-055`.

## Mature recommendation anchors

```text
KF-REC-047 Temporal Work Projection
KF-REC-048 certainty-aware Recovery Contract
KF-REC-049 provenance/revision-aware Business Knowledge Contract
KF-REC-050 load-bearing WorkDefinition control contract
KF-REC-051 Operator Attention & Priority Contract
KF-REC-052 Financial Truth & Valuation Contract
KF-REC-053 Commercial Relationship & Obligation Contract
KF-REC-054 Commerce & Fulfilment Contract
KF-REC-055 Contract Integrity & Renewal Contract
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
- F214 / C164 — DROPSHIP/PREORDER can persist an effectful PurchaseOrder/PreOrder before its FulfillmentRoute, so route-based retry can duplicate the same semantic strategy obligation — `08AR` / `09AR`.

## J10 target allocation

- `KF-REC-054 — Commerce & Fulfilment Contract` — `10M`.
- Pressure test: `investigations/J10-COMMERCE-FULFILMENT-STANDARDS-FRONTIER-PRESSURE-TEST.md`.
- Backward re-audit: `investigations/J10-J7-J3-J4-J18-J23-K9-J17-COMMERCE-FULFILMENT-BACKWARD-REAUDIT.md`.

## J11 Contract / Obligation / Renewal allocations

- F215 / C165 — `ContractVersion` is neither a complete mutation ledger nor a reconstructable historical Contract revision; principal manual/KEY PATCH is unversioned — `08AS` / `09AS`.
- F216 / C166 — probabilistic contract-document extraction can promote inferred renewal/value/party state into authoritative Contract truth without a confidence/verification/governance promotion gate — `08AS` / `09AS`.
- F217 / C167 — ordinary Contract edits can falsely discharge renewal obligations because supplied lifecycle status is treated as renewal-decision evidence; `ACTIVE` is also simultaneously eligible to raise renewal work — `08AT` / `09AT`.
- F218 / C168 — persisted/product-facing Contract retention semantics do not constrain hard deletion, which cascades Contract-owned evidence/history — `08AU` / `09AU`.

## J11 target allocation

- `KF-REC-055 — Contract Integrity & Renewal Contract` — `10N`.
- Pressure test: `investigations/J11-CONTRACT-OBLIGATION-RENEWAL-STANDARDS-FRONTIER-PRESSURE-TEST.md`.
- Backward re-audit: `investigations/J11-J12-J23-J18-J17-J7-J3-J4-K4-K6-K7-K8-K11-CONTRACT-INTEGRITY-BACKWARD-REAUDIT.md`.

KF-REC-055 owns only ContractRevision lineage, contract-specific assertion promotion, RenewalDecision binding and contract RetentionDeletionDecision; it delegates generic provenance, temporal, recovery, operator-attention, financial and commercial-obligation semantics to mature shared contracts.

## J12 Document / Evidence Lifecycle allocations

- F219 / C169 — transient document extraction or raw-text fallback can be admitted directly as successful payment evidence, including explicitly low-confidence fallback output, without an observed consumer-specific evidence-admission / verification decision before `Payment SUCCESSFUL`, Invoice state mutation and downstream financial consequences — `08AV` / `09AV`.
- F220 / C170 — Google Drive connector recognizes a materially newer source revision by `driveFileId + modifiedTime`, but canonical ingestion deduplicates only by `businessId + sourceType + externalId(=driveFileId)`, so the legitimate new revision is suppressed as the prior occurrence and its ingestion plan is not rebuilt — `08AW` / `09AW`.
- F221 / C171 — mounted `DocumentInstance` hard delete can destroy `DocumentVersion` approval/history and `ReviewTask` evidence while setting surviving `DocumentChangeLog.instanceId` to null, without an observed document-disposition decision — `08AX` / `09AX`.

J12 anti-duplication decisions:

```text
manual inline edit approved through stale stored version → F161 / KF-REC-049 specialization
Device ACCEPTED/REJECTED intake reprocessed in-place     → F161 / KF-REC-049 specialization; no new root
AI tweak section mutations before version evidence       → F164 specialization; no new root
Drive import replacing sections without new version      → F161 + F164 pressure; no new root
direct AI upload controller                              → extraction-only response; no new root
contract extraction promotion                            → F216/C166 + KF-REC-055 manifestation
payment evidence admission                               → F219/C169 J12/K8 root
same payment evidence replay / fresh payment identity    → KF-REC-048 specialization; no new root
Drive mutable intake revision overwrite                  → KF-REC-049 pressure
Drive R2 suppressed as duplicate R1                      → F220/C170; reuses J14/KF-REC-035 occurrence direction
DocumentInstance hard-delete proof destruction           → F221/C171; J19 retention/privacy pressure
```

### J12 ownership boundaries

```text
F219 → document/evidence admission boundary; delegates generic epistemics to KF-REC-049 and financial claim strength to KF-REC-052
F220 → external-object vs source-revision ingestion-occurrence distinction; reuses KF-REC-035/KF-REC-049/KF-REC-048
F221 → destructive disposition of versioned/reviewed document evidence; delegates generic retention/privacy policy to J19 and revision semantics to KF-REC-049
```

### F221 anti-duplication boundary

```text
F218/C168:
Contract-specific retained state exists
→ hard delete ignores Contract retention semantics

F221/C171:
versioned/reviewed/approved DocumentInstance evidence exists
→ generic mounted hard delete destroys or detaches its proof lineage
```

F221 is also distinct from F178/C128, which concerns correction/withdrawal leaving derived descendants active rather than physical destruction/severance of the source evidence history.

## Current ranges

```text
Findings:         F001–F221
Contradictions:   C001–C171
Recommendations: KF-REC-001–KF-REC-055
```

Next free IDs:

```text
F222 / C172 / KF-REC-056
```

## Agent pre-allocation gate

```text
LOAD 04A + 04B
→ CHECK CURRENT ranges
→ SEARCH semantic equivalents
→ classify SAME / SPECIALIZATION / RELATED DISTINCT / ALIAS / HISTORICAL / GENUINELY NEW
→ REUSE / REFINE / CROSS-REFERENCE
→ only then allocate next unused ID
→ one canonical home definition
→ update 04B + CURRENT + HANDOFF + ROLLOVER
```

No production implementation is authorized by this ledger.
