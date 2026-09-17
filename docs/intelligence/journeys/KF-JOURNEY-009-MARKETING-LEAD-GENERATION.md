# KF-JOURNEY-009 - Marketing / Lead Generation

Checkpoint: `J9-POA-2026-09-16-01`  
Activated: 2026-09-16  
Status: **PROVISIONALLY TARGET-ALIGNED - NAMED PUBLICATION / RECOGNITION / ATTRIBUTION CORE ONLY**  
Intelligence input: `20e7501f562a1456190d26ddc3abd1aaae9a2601`  
Implementation forensic baseline: `8f173bfe79f1418159cf4099ea18b0d60d203ec2`.

Primary kernels K7/K8/K9/K10; secondary K1/K3/K4/K5/K6/K11/K12. Existing customer-to-revenue constellation J9/J3/J5/J10/J21/J7. Adjacent J13/J14/J16/J17/J18/J23/J24/J8 and governance J2/J15.

Production source/schema/settings/workflows/assertions remain read-only. No application/provider/DB/boot/concurrency/migration test ran. The programme map remains frozen at J24-PA by the user; its generator/check and outputs are unchanged. Scheduled cycles remain halted. Design alignment does not establish implementation conformance.

## 1. Purpose and selected scope

J9 carries campaign intent into authorized content delivery, audience observation, identity/qualification, economic conversion recognition, model attribution and learning without letting one layer fabricate evidence for another.

```text
plan != draft != queued intent != provider outcome != recipient evidence
!= identified lead != qualified lead != conversion != attribution != cash
```

The [Publication, Occurrence and Attribution Contract Review](../investigations/J9-PUBLICATION-OCCURRENCE-AND-ATTRIBUTION-CONTRACT-REVIEW.md) is the current target and acceptance home. PC01-PC08 govern publication; AC01-AC08 govern observations, recognition and report generations. They are document-local responsibilities over existing mechanisms, not new canonical concepts or mandated new tables.

The accepted scope covers the named social/manual/scheduler/content-command/communications paths, growth adapters and model-result generation, not the complete marketing/public/provider estate. All actual provider capabilities, consent integrations, legacy migrations and runtime correctness remain subject to MD1-MD5.

## 2. Preserved investigation chain

| Evidence home | Responsibility |
|---|---|
| [M001](../investigations/J9-MARKETING-LEAD-GENERATION-MICROTRACE-001.md) | Nineteen named source files: false publication event reaching gamification, lead capture, live/backfill disagreement, time-window/value-stage/currency and result freshness. Twelve X designs. |
| [M002](../investigations/J9-MARKETING-LEAD-GENERATION-MICROTRACE-002.md) | Seventeen primary files: conditional PayPal duplicate recognition, actual source schema/IDs, per-target receipt loss and status-only content commands. Eight Y designs. |
| [Contract review](../investigations/J9-PUBLICATION-OCCURRENCE-AND-ATTRIBUTION-CONTRACT-REVIEW.md) | Eleven named files: existing queue and declared models, post-success catch, suppression timing, sender/variant/campaign relationships, guarded query dispatch, PC/AC target, migration and backward review. Six Z designs. |

M001 and M002 are unchanged. The prior dossier and its historical overlays remain in Git at the input commit. This live dossier consolidates navigation and accepted scope rather than repeating superseded next actions. No source witness is discarded because the related contract is reused rather than assigned a new finding ID.

## 3. Material source facts and qualifications

Manual SocialService publishing correctly refuses no-account/no-explicit-target requests. A different path emits post.published on normally returned all-failed or unmatched results. Gamification and automation activity trust that event; automation's inspected handler logs activity, not arbitrary playbook execution. Scheduler claim and detailed channel results are real, but manual/scheduled target and consequence semantics differ.

M002's PayPal path can record invoice-paid and payment-received as two valued growth observations for one capture. Optional connector availability, same resolved payer/invoice contact, successful consumer writes and recomputation are required. Capture100/invoice100 can yield numeric growth200 and RETENTION; this does not create a second provider charge. Main Stripe and storefront have distinct emission/contact paths. Do not generalize the example to all payments.

Native form and identified social events can contain source IDs and times which growth mapping discards. Contact-aggregate uniqueness does not supply occurrence dedupe. Live typed booking/cancellation and rebuilt generic booking have different conversion meaning. Quote values, invoice-state totals, receipts, native currencies and model allocation are not interchangeable financial bases.

Attribution selects first-conversion cohorts but consumes lifetime value and all touches; explicit cohort-lifetime reporting is possible, but not equivalent to event-period reporting. Upsert-only generation leaves vanished buckets; readers can mix periods/freshness. Backfill deletes/recreates selected touchpoints without preserving all observation semantics. These are source-derived examples, not executed customer incidents.

## 4. Newly resolved outbound and command boundaries

The communications engine already has destination-specific deliveries, events, status claims, retry scheduling and parent aggregation. Queue requests return queued work rather than asserting completed delivery. Strengthen these instead of installing a second sender.

The queue's try/catch covers the remote publish plus local success/history/parent writes. A provider success followed by local bookkeeping failure can be marked RetryPending/Failed. Known external outcome must survive that error, with only missing local consequences repaired. Retry allowance and successful catch writes are conditional; no duplicate email was reproduced.

Audience filtering uses doNotContact/marketingOptIn predicates during expansion. The inspected queue/Gmail path does not recheck a later Contact suppression before sending to the saved address. This establishes a named current-permission gap, not a legal-consent conclusion or exhaustive every-provider audit. Sender fallback based on token presence must also consume current purpose/authority, not infer permission from missing credentials.

OutboundContentService stores destination-specific variant metadata, but queue selection uses platform matching. Mutable variantId is not an immutable rendition. Typed OutboundContent.campaignId refers to OutboundCampaign, while queue bookkeeping stores an EmailCampaign ID in contentMeta.campaignId. MarketingCampaignPlan is another intent namespace. Same field spelling cannot substitute for a valid cross-record association.

The Cortex controller has AuthGuard/BusinessGuard. The execute route enters real autonomy/approval/error-denial controls. The query route, however, passes a string action to the same mutable dispatcher without an operation-class allowlist and without the executor. ContentAdapter supports mutating publish/send methods on that dispatcher. This is an authenticated source path, not a public exploit claim or actual HTTP test. Read-only enforcement must precede attaching real sends to a currently status-only command.

## 5. Selected publication contract

PC01 freezes the intent, rendition and exact target/audience manifest with explicit exclusions. PC02 resolves current actor, operation class, provider grant and recipient eligibility. PC03 claims one logical effect independently of fresh request/attempt IDs. PC04 records durable attempt and provider-stage evidence. PC05 preserves known outcome while repairing local consequences. PC06 derives parent state and consumer effects from the required manifest. PC07 admits later provider/recipient observations without pretending send acceptance proves delivery. PC08 handles revisions, cancellation, uncertainty-aware retry and safe withdrawal.

All named entrypoints participate: manual social, scheduled social, communications, ContentAdapter, and purported queries. A partial cutover is not full conformance. Queue-time permission cannot authorize a send after current revocation. A local stop cannot promise retroactive cancellation of a remote request already admitted; such uncertainty remains a recovery obligation.

Existing DeliveryEvent/OutboundDelivery are reusable evidence/claim seams, but their present fields and state CAS are not the entire target. Exact DDL and transaction composition must be characterized. Intermediate media/container references and successful child outcomes cannot remain only in memory until the last channel finishes.

## 6. Selected recognition and generation contract

AC01 preserves source observations, identities and time provenance. AC02 correlates economics without collapsing genuine installments or distinct submissions. AC03 applies a versioned conversion and value-stage policy consistently to live and replay. AC04 identifies a complete report basis: per-conversion or explicit cohort, both time boundaries/cutoff, model, currency/valuation and lookback. AC05 builds a complete staged generation. AC06 validates and atomically activates it. AC07 corrects/rebuilds with source lineage. AC08 supplies honest reader freshness and safe model comparison/withdrawal.

One economic capture is not counted again merely because the invoice becomes paid. Attribution shares plus an explicit unattributed residual conserve the admitted same-basis value. Quotes, cash, margin and FX remain separate financial policies. Model allocation is not causal proof that marketing produced the sale.

A complete zero-result generation replaces stale prior buckets. An interrupted or missing-source run stays incomplete. A slower older computation cannot overwrite a newer correction; reader projections do not silently combine incompatible generations. Raw source history is preserved according to J19 disposition, not destroyed to recompute a dashboard. A rollback cannot re-expose disallowed evidence merely because the old report looked better.

## 7. Canonical reuse and backward review

No new F/C/REC/concept ID is allocated. REC048 supplies effect/attempt/consequence recovery; REC049 supplies revision-bound analytics and eligibility; F178's derivative-invalidation law is specialized without claiming its original Genome source trace proved these growth methods. Existing F198 economic-lineage and J5/J14 occurrence contracts remain. Historical provider-recovery numeric collisions do not override 04B.

F228/C178 remains the J8 time-billing loss. Next free F229/C179/KF-REC-058. The publication, query, recipient and attribution witnesses remain concrete obligations in this review without an omnibus new finding or duplicate authority/analytics engine.

Backward review retains J3 relationship/qualification, J5/J14 occurrence ownership, J7/J8 financial source truth, J13 grants, J18 certainty-aware repair, J23 definition/occurrence/attempt, J2/J15 current authority, J16/J17 qualified derived knowledge, J24 independent proof and J19/J21 public/disposition interfaces. Full runtime/provider/public coverage is not imported by reference.

## 8. Integration, proof and remaining debts

P0 operation/environment admission precedes P1 compatible storage, P2 common publication ownership, P3 shadow recognition/generation, P4 reader/consequence cutover and P5 controlled activation/withdrawal. These are review slices, not promoted execution packets. No unsafe reference fallback when the old implementation violates the same invariant; disable affected new effects instead.

Optional models, channels and implementations can be added, compared, disabled and removed under reviewed policy. They must retain current permission, effect identity, source observation and economic history. A shadow model cannot send messages, create invoices or replay conversions as new facts. This applies the blueprint's controlled flexibility and seamless-flow objective; it does not certify its historical examples or this design as executed software.

J9 has **26 local designs**: 12 X, 8 Y and 6 Z. All are unbound/NOT_EXECUTED. J8's 24 and J13's 44-case inventory remain separate and unchanged. No application/harness/provider test ran.

| Debt | Required readiness work |
|---|---|
| MD1 | Existing-record reuse, namespace/DDL/index migration and legacy source/receipt reconstruction |
| MD2 | All named query/dispatch/adapter/reader cutover and later-discovered writer coverage |
| MD3 | Actual provider receipts/idempotency, current sender/recipient eligibility and public/deployment conformance |
| MD4 | Economic/refund/currency recognition and atomic generations, with historical reconciliation |
| MD5 | Authorized isolated runtime/concurrency/negative-control/migration proof after baseline comparison |

G9-01 through G9-08 pass only at their named context/source/design/review scopes. Wider conformance is deferred; runtime proof is not executed; implementation and release remain unauthorized. G9-11 grants only named-core provisional target alignment. J13 ED1-ED5, J8 WD1-WD5 and J24 CS1-CS5 remain intact.

## 9. Exact next programme action

**J20_PLAN_SUBSCRIPTION_AI_COST_ACTIVATION**. Planned, not created: `journeys/KF-JOURNEY-020-PLAN-SUBSCRIPTION-AI-COST.md`.

Trace actual subscription/plan/payment state into feature entitlement, AI allowance/admission, budget reservation, model attempts, usage recording, billable classification and cost reconciliation. Keep displayed plan, current permission, consumed resource and settled cost separate. Do not run model calls or subscription writes during the forensic trace.

No new journey was created by this review: 22/25 dossier coverage and twelve kernel dossiers remain, not app completion. J20/J21/J22 are still dossierless. Preserve the map freeze, owner halt, fixed implementation baseline and intelligence-only publication boundary.
