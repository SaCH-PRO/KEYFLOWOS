# J9 - Occurrence, Attribution and Channel Consequences: Microtrace 002

Checkpoint: `J9-M002-2026-09-16-01`  
Date: 2026-09-16  
Intelligence input: `a7129baef03d2f94f027803a76483868f86fe930`  
Implementation forensic baseline: `8f173bfe79f1418159cf4099ea18b0d60d203ec2`  
Result: **NAMED PRODUCER / IDENTITY / RECEIPT TRACE COMPLETED; J9 ACTIVE / NOT CONVERGED**.

This continues [Microtrace 001](J9-MARKETING-LEAD-GENERATION-MICROTRACE-001.md), abbreviated M001, without replacing it. Production source, schemas, settings, workflows and assertions are unchanged. No application, provider, DB, boot, concurrency or migration tests were executed. The programme map remains frozen at J24-PA; its generator/check and all outputs were left untouched. Scheduled owner-halted cycles remain halted.

S references identify pinned implementation sources; R references identify actual canonical comparisons. J9-Y01-Y08 are local designed cases, not canonical finding allocations or executed tests. Examples below are conditional source traces, not observations of customer accounts, live receipts or deployed database behavior.

## 1. Bounded results

| Question from M001 | Answer established here | Remaining limit |
|---|---|---|
| Can two growth events represent one real payment? | Yes: the named PayPal capture path can cause invoice.paid and payment.received; both growth handlers append valued payment touchpoints for the same contact when the stated resolution conditions hold. | No second external capture or second Payment row is inferred from this analytics duplication. Optional connector availability, payer identity and successful consumer writes are explicit preconditions. |
| Does the declared growth schema deduplicate those observations? | JourneyTouchpoint has ordinary indexes but no source-occurrence uniqueness beyond its row ID. CustomerJourney's unique contactId identifies the aggregate, not its individual observations. | Deployed triggers/migration drift and all upstream entrypoints were not audited. |
| Are source IDs inherently unavailable? | Native form events include the persisted submission; PayPal/social connector events carry externalId. The growth adapter discards those identities and source times instead of retaining a consumer claim. | A new form submission may be legitimately distinct. Dedupe cannot be inferred from equal contact or payload content. |
| Does every storefront/Stripe payment necessarily double-count? | Not established. Main Stripe and storefront branches have different emission and contact-binding paths. Their distinctions narrow the generic M001 hypothesis. | A full every-provider/legacy-route audit is outside this trace. |
| Are social results adequate per-account receipts? | PublishResult identifies platform but not connection/attempt/content revision; results are persisted only after the channel loop and replace the previous array. Instagram's intermediate container is local and its catch merges uncertain errors into success:false. | Actual provider idempotency, API-version compatibility and remote outcomes were not tested. |
| Are publication consequences limited to gamification? | The named automation listener also writes a success-toned publication activity without inspecting per-target results. | It does not invoke arbitrary playbooks in this handler. No exhaustive subscriber-absence claim is made. |
| Is there already another campaign/content delivery model? | Yes: OutboundCampaign/OutboundContent relations and OutboundDelivery exist, separate from MarketingCampaignPlan and SocialPost. A ContentAdapter delegates publish/send to methods that only change local status. | Complete dispatch-model reuse and the outer authorized invocation path remain named next-review boundaries. |

The result advances the actual producer-to-consumer and schema chain. It does not certify a unified funnel, resolve every consent/qualification rule, or establish a fully implemented publication/attribution contract.

## 2. Source observations, recognition and economic identity

These are distinct identities:

```text
provider notification / local domain event
!= stored observation by one consumer
!= underlying capture or commercial outcome
!= recognition of that outcome as a conversion
!= allocation of its value under an attribution model
```

The same invoice can have multiple legitimate captures; one capture can cause both a receipt event and an invoice-state event. Retain those observations, but do not add their amounts as though they were unrelated sales. A contact is a subject, not an occurrence key. A provider-event key alone is also not a complete economic identity when multiple event types describe the same provider operation.

### 2.1 Named producer/consumer identity table

| Producer and event | Available identity, time and amount | Growth mapping actually consumes | Consequence |
|---|---|---|---|
| LeadFormsService: lead_form.submitted | Persisted submission row, including id/source/createdAt; form and tenant; resolved contact when available. | formId/formName metadata; source lead_form; no submission ID, original source or occurredAt forwarded. | Available replay identity and capture time are lost at the growth adapter, not necessarily absent at intake. [S08/S04] |
| PayPalConnector: payment.received | capture externalId, invoiceId, resolved payer contact when email exists, amount/currency and newly constructed timestamp. | provider/source, amount/currency, invoiceId metadata; not externalId or timestamp. | Capture identity is lost; even the connector timestamp represents local emission, not automatically provider occurrence time. [S03/S04] |
| InvoiceWorkflow: invoice.paid | Invoice ID, total, paidAt and included contact; invoice state after reconciliation. | value invoice.total, type payment, invoiceId metadata, currency hardcoded TTD; no paidAt/source-effect identity. | Invoice-state evidence is recast as another additive payment observation. [S02/S04] |
| StoreOrderService: store_order.paid | Updated order, businessId and newly created invoiceId; resolved contact is held separately during checkout. | Requires payload.order.contactId; no fallback through payload.invoiceId or the separately resolved contact. | Producer and consumer do not prove identical customer lineage merely because the event is emitted. [S06/S04] |
| SocialPlatformConnector: social.engagement_received | Engagement externalId, postId, platform, locally constructed timestamp, resolved contact only when sender externalId exists. | type/postId metadata, channel/platform and contact; not the engagement externalId or timestamp. | Replayed same engagement can lose the identity required for exactly-once projection. Anonymous inputs still correctly remain unlinked. [S09/S04] |

The normal form transaction and connector identity-resolution seams remain valuable. This trace does not turn them into evidence of current marketing consent, qualification, or causal campaign attribution. Those are separate decisions. Nor does it assert that an upstream native event is authentic merely because a listener accepts its shape.

### 2.2 PayPal: one capture, two valued growth observations

The inspected capture-completion handler checks the capture ID and existing Payment, resolves the invoice, creates the Payment with its accounting posting, reconciles the invoice, then invokes the optional PayPal connector's payment-received emitter. The invoice workflow emits invoice.paid when reconciliation moves the invoice to PAID; an unchanged invoice state does not emit that transition again. [S01/S02]

The connector resolves a Contact only when payerEmail is available. Consequently the doubled single-contact aggregate requires all of the following: a previously unconsumed successful capture reaches this handler; it fully settles the invoice; invoice reconciliation succeeds; the optional connector is available; payer resolution yields the invoice's same contact; both growth writes succeed; and a recomputation sees both rows. This is not a claim that every PayPal resource includes a payer email or every deployment wires the optional dependency. [S01/S03/S17]

Under those preconditions:

```text
one capture with numeric amount 100 settles invoice total 100
 -> one successful Payment and accounting path
 -> invoice.paid -> growth touchpoint(payment, value 100)
 -> payment.received -> growth touchpoint(payment, value 100)
 -> recompute sees two conversion-type rows
 -> numeric totalRevenue = 200
 -> conversionCount >= 2 can promote the journey to RETENTION
```

This consumer does not make a second provider capture. The wrong 200 is the derived aggregate. For a non-TTD invoice, the invoice-paid adapter additionally labels its row TTD while the capture row keeps its supplied currency; summing both does not become valid because their numeric values match. No assumption about a provider's supported currency is needed to establish the local mapping defect. [S04/S05]

Missing payerEmail makes the connector contactId undefined and the growth wrapper skips that unbound observation. A different payer/invoice contact can split the history instead of doubling one row set. Concurrent recomputations can leave other transient aggregates; the example describes a complete recomputation after both observations, not a guarantee of immediate deterministic listener order.

Provider-event/Payment dedupe remains a positive boundary. It does not remove the two different internal observations created during a single accepted handler execution. Partial captures further require explicit recognition: their separate amounts are real payment observations, whereas the later fully-paid invoice total is a cumulative state assertion. Collapsing every event by invoiceId would instead lose legitimate installments.

### 2.3 Do not generalize the PayPal path to all payment sources

The inspected main Stripe success handler creates/recognizes Payment and reconciles Invoice. It does not invoke StripeConnector.emitPaymentReceived in the shown processStripeChargeOrSession body. Separate connector and legacy entrypoints exist, but their possible overlap is not established by assuming all gateways mirror PayPal. [S01]

Storefront completeCheckout already uses one transaction for its named invoice transitions, Payment/posting, inventory and RevenueAttribution writes, with invoice events buffered until commit. These are important positive mechanisms. It then emits store_order.paid with the returned order and invoiceId. The resolved customer is not added as a separate contactId in that emitted payload, while the growth listener requires order.contactId. The shown order create/update writes do not assign that property. A full MarketplaceOrder schema/extension audit was not completed here, so the exact statement is that this chain does not establish the required contact field; no universal storefront double-counting is asserted. [S06/S04]

If a later adapter adds the missing contact linkage, the already-emitted invoice.paid and order-paid observations must then be deliberately correlated. Repairing a missing observer without defining its economic basis can activate a second valuation of the same sale. Do not count that future repaired path as a currently observed duplicate.

Refund handling in the inspected payment service records financial correction and reconciliation. The full growth listener has no corresponding refund handler in its declared subscriptions. That exposes a projection-correction obligation; it does not mean all financial refunds are absent, nor that a particular historical report has been measured as wrong. [S01/S04]

## 3. What the declared schema does and does not guarantee

The complete CustomerJourney, JourneyTouchpoint and AttributionResult blocks were inspected within the native 8620-9020 schema range. These are declared source constraints, not confirmation of deployed migrations or triggers. [S07]

| Record | Declared identity/control | Boundary |
|---|---|---|
| CustomerJourney | Unique contactId; Business and Contact references; lifetime stage/timing/value aggregates. | One aggregate per Contact does not dedupe observations or express multiple conversion occurrences. No aggregate currency/computation-generation coordinate is declared. |
| JourneyTouchpoint | CUID row ID; business/contact/journey references; optional campaignId/name/contentId; value/currency and occurredAt; ordinary indexes. | No declared source-occurrence/consumer uniqueness or canonical economic-effect reference. The same source event can be inserted again with another row ID through the shown method. |
| AttributionResult | Unique business/dimension/key/model/periodStart/periodEnd; metrics and computedAt. | Bucket uniqueness is useful, but does not identify an atomic computation generation, conversion valuation basis or currency. Both period boundaries are in storage even though M001's comparison reader ignores one. |
| RevenueAttribution | Separate commercial attribution record, unique business/revenueType/revenueId, native amount/currency, contact/visitor/campaign metadata and occurredAt. | A useful existing per-revenue-object seam. It is not the same table as model AttributionResult; native object identity still requires reconciliation of invoice/order views of the same economics. |
| OutboundCampaign / OutboundContent | A campaign-to-content relation is declared; content has variants and deliveries. | This disproves a blanket claim that all campaign/content relationships are absent. It does not join every MarketingCampaignPlan, SocialPost or LeadForm automatically. |

recordTouchpoint supplies no caller-provided occurrence ID to the create and cannot use a nonexistent source uniqueness key in this model. Its default occurredAt is a new processing-time Date. Repair requires keeping observed time, recorded time, source revision and identity separately; a timestamp cannot be upgraded into an authenticated source event time just by renaming it. [S05]

Only relation excerpts of OutboundContent/OutboundDelivery were inspected in the large raw schema, not their complete indexes and dispatch implementation. Do not use these excerpts to declare that the established outbound queue is safe, unsafe or missing. It is an explicit reuse/conformance seam for the next review.

## 4. Publication receipts, partial work and uncertainty

### 4.1 The per-target evidence contract currently loses account identity

BasePublisher.PublishResult contains platform, success, optional platformPostId/externalUrl/error/publishedAt. It does not require connectionId, content revision, grant reference, effect/attempt ID or a typed outcome-certainty class. SocialPublishingService passes the connection into publish, but appends the returned result without adding the connection identity. [S10/S12]

Two accounts on the same platform therefore need more evidence than the platform label to support an exact retry decision. A platformPostId may help correlate one actual post, but the declared result does not bind it to the intended local account/content/grant. Stored channelIds are then replaced by the used platform names, weakening a previous connection-ID selection. This does not prove external provider IDs are globally ambiguous; it proves the local receipt contract omits required target lineage.

All channel results are persisted only after the loop completes. They replace SocialPost.publishResults rather than appending an immutable attempt record in this path. A successful first channel followed by process failure before the final write can leave no persisted result from this attempt in that row. The next invocation loops the selected connections again without consuming prior successful child receipts. This is a conditional crash/re-entry sequence, not a reproduced duplicate social post. [S12]

The parent POSTED/FAILED summary and first-success externalPostId are projections of the result set, not an authoritative proof that every intended target is terminal. Preserve detailed result arrays, but strengthen their identity/durability rather than assuming JSON presence solves recovery.

### 4.2 Instagram shows the difference between definite refusal and unknown effect

The inspected publisher has three important phases: create media container, publish container, best-effort fetch permalink. Missing credentials or media return explicit failure before the provider request. Non-OK provider responses and outer network/JSON exceptions also return success:false. The container ID is only a local variable, not a durable attempt reference in this class. [S11]

If the publish request may have reached the provider and the response cannot be read, the caller receives the same Boolean failure shape as a pre-send refusal. That is insufficient evidence for a safe repost. Conversely, a failed optional permalink lookup does not undo a confirmed publish; the current inner catch correctly retains success after the successful publish response. Preserve that useful distinction.

The baseline uses fixed Graph v19.0 URL strings. This review does not establish current provider-version support, successful access permissions, universal idempotency semantics or provider processing guarantees. Those would require separate provider research and authorized sandbox verification. The finding here is local receipt/exception classification and persistence.

### 4.3 Another concrete consumer records success from the wrapper event

M001 traced gamification. The newly inspected AutomationExecutorService.onPostPublished also writes an activity with action published, title Social post published and tone success, taking post.id/content from the event. It does not check the detailed publish results. Thus the failed-return branch from M001 can produce both a first-post milestone and a success-toned activity if those local consumers succeed. [S13, M001]

This handler only logs the activity; it does not execute a marketing playbook in its body. Do not inflate this finding into an untraced autonomous-action incident. The scheduler's social.scheduled.dispatched event is different; these named consumers are subscribed to post.published, not that scheduler event. Search found no additional bridge in the returned results, but that is not proof no wildcard or other listener exists anywhere.

## 5. Campaign/content namespaces and a status-only command path

M001 examined MarketingCampaignPlan, SocialPost and LeadForm. This trace found another actual association: OutboundCampaign has related OutboundContent; content has variants and OutboundDelivery relationships. RevenueAttribution also offers campaign metadata. These existing records must be considered before proposing a new universal campaign or receipt store. [S07]

However, the inspected ContentService.createPost input does not include campaignId, while createCampaign creates an OutboundCampaign. This is one specific omitted binding in that method, not proof every outbound creation path omits it. Optional JSON source labels on a form or plan are not an enforced relationship merely because their text matches a campaign name.

A separate source-level command path is now established:

```text
ContentAdapterService.execute(publish_post)
 -> ContentService.publishPost
 -> OutboundContent status Sent + publishedAt update
 -> connectorOk(success:true)

ContentAdapterService.execute(send_campaign)
 -> ContentService.sendCampaign
 -> OutboundCampaign status sent (or draft for testOnly)
 -> connectorOk(success:true)
```

Neither inspected service method performs provider dispatch or obtains a delivery receipt. getCampaignPerformance reports sent as the number of related content rows and opened/clicked as literal zeroes. Those values are not measured delivery/open/click evidence. The adapter does actually delegate to these methods and wrap their return as success; its outer authorization/API/tool entrypoint was not fully traced, so this document does not claim an unauthorized public invocation or an observed user-facing run. [S14-S16]

This is distinct from M001's SocialService no-account refusal, which remains correct, and from the real Instagram publisher. Naming all of them publish does not make them the same execution path. Where a foundation method intentionally performs local bookkeeping only, its capability/outcome must say so rather than acting as proof of external delivery. Where it is intended to dispatch, reuse the actual outbound owner and its guarded claims/receipts; do not install another duplicate sender merely to satisfy this wrapper.

Complete campaign-to-form/content bindings, outbound recipient suppression/consent and the true dispatch route of this alternative command family remain bounded next-review questions. We have identified the concrete seam rather than restarting a generic marketing inventory.

## 6. Bounded comparison against actual canonical homes

No new F/C/REC/CONCEPT allocation is made. F228/C178 remains J8 source-time allocation loss; next free F229/C179/KF-REC-058. Numerical authority remains 04B. The following comparison uses actual register wording, not a label-only analogy. [R1-R5]

| J9 mechanism | Actual comparison | Disposition |
|---|---|---|
| One PayPal economic event becomes additive invoice and receipt touchpoints | F198 in 08AF proves a different implementation: won-deal plus paid-invoice lifetime value. Its target explicitly requires economic-occurrence and value-stage separation. | Reuse/refine the economic-lineage contract; preserve this independently traced PayPal/growth manifestation. Do not claim the old F198 code trace already proved these methods or allocate a duplicate generic value contract. |
| Duplicate conversion rows induce RETENTION; live/backfill stages differ | F197 concerns canonical Contact lifecycle convergence; F205 concerns Contact.status dialects. | Related but not identical: CustomerJourney.stage is a different projection. Retain its recognition-policy witness, do not silently rewrite F205 as a universal growth finding. |
| Store-order contact field differs from listener expectation | F204 in 08AI proves a booking-event/tool-payload mismatch with an invalid invoice path. | Reuse typed source-to-consumer adaptation as a law, not F204's exact source claim. Preserve the unresolved contact binding before assuming double count. |
| Normal failed return produces publication success event; local-only command returns success | F152 in 08K concerns compensation inferred from a non-throwing handler; F156 concerns local payment-status reset presented as retry. | Specialize outcome-evidence requirements; retain named publication/command witnesses. Neither existing finding is silently broadened into every outbound method. |
| Lost intermediate/partial publication receipt and blind child replay | REC048 explicitly separates effect dedupe from consequence completeness, unknown from confirmed failure, and resuming unresolved children from rerunning parents. | Reuse K11/K8/K9 recovery semantics with account/content/attempt identity. No new generic recovery engine or assumption of provider-native fencing. |
| Period/cohort mixing, vanished buckets, destructive growth reconstruction | M001's concrete computation traces plus current AttributionResult schema. | Retain as J9 attribution-generation candidate for target review. Neither economic dedupe nor a renamed metric alone resolves generation/window completeness. |

This is a bounded comparison, not a claim every historical analytics finding was searched exhaustively. Existing canonical homes retain their definitions. The next review must decide whether a specifically stated independent attribution-generation invariant survives reuse; it must not reserve or allocate F229 by convenience.

## 7. Refined ownership and migration requirements

These are target requirements derived from the trace, not implemented schema/validators.

**Preserve source observations; make recognition explicit.** A versioned adapter should carry tenant, source-system/type/ID, subject resolution, original occurrence time when established, observed/recorded time and amount/currency provenance. The conversion recognizer decides whether an observation creates, updates, reverses or merely corroborates a conversion. Invoice-paid and payment-received are not synonyms, nor two automatically additive economic events. Do not dedupe all installments by invoice ID.

**Separate consumer replay from economic correlation.** Reprocessing the same submission or provider observation should reuse that consumer occurrence; two distinct forms or captures may still be separate. Correlating an invoice-state event to captures is a second decision. Retain ambiguous lineage explicitly rather than merging by approximate time, equal amount or contact. A customer identity merge may require controlled projection rebuild, not an unreviewed history rewrite.

**Bind publication to the actual target set and revision.** The existing social/queue owner must retain account, provider identity, local grant, content revision, intended schedule, effect and attempt. Persist an attempt/known provider reference before losing the chance to reconcile it. Save child outcomes durably as each becomes known and derive parent completeness. Uncertain prior effects cannot be safely retried merely by clearing FAILED. Current J13 admission applies even when an earlier content command or test variant was allowed.

**Reuse the existing outbound and monetary records where their contracts fit.** OutboundDelivery/DeliveryEvent and RevenueAttribution are existing seams, not automatically proven implementations of the target. Establish their exact keys, writer and recovery behavior before choosing final DDL or deciding to extend them. SocialPost results, OutboundContent, MarketingCampaignPlan and native form submissions need explicit adapters rather than conflating similarly named states.

**Give computations a complete, immutable basis.** Attribution needs an explicit per-conversion versus cohort definition, source watermark/snapshot, recognition and model version, period boundaries, lookback policy, currency/value stage and complete result generation. Retire vanished buckets through accepted generation replacement, not destructive raw-evidence deletion. Late arrivals/refunds/corrections should produce a traceable revision; they should not silently rewrite historical claims. This strengthens M001's generation candidate without asserting the final store design has been selected.

**Keep qualification and permission separate from measurement.** A captured address or inferred interest does not establish permission for arbitrary follow-up. Existing public/form/connector guards, tenant identity and J5/J14 occurrence ownership remain; this trace does not settle jurisdiction-specific consent policy or all channel suppression implementations. A future rule must consume the applicable consent/eligibility record rather than invent consent in analytics.

Migration must inventory old observations with missing source IDs and per-target results with missing account IDs. Mark uncertainty instead of backfilling invented facts. Comparing old/new models may use isolated shadow projections, but no duplicate posts, emails, invoices or conversion events may be emitted by the comparison. Preserve original payments, submissions and verified outcome evidence; a lower metric after correction is not justification to restore known double counting. Safe withdrawal may disable affected new work when no conforming reference exists. J24's evidence and approval constraints remain in force.

## 8. Eight additional local proof designs - NOT_EXECUTED

| Case | Required isolated characterization / eventual acceptance |
|---|---|
| J9-Y01 | One fully settling capture plus invoice-state observation produces one correctly valued conversion recognition and no false repeat-customer inference; missing/different payer contacts remain explicit. |
| J9-Y02 | Partial captures, final invoice-paid state and subsequent refund/correction preserve separate payment facts while deriving the declared net/gross conversion basis exactly once. |
| J9-Y03 | Replayed saved form/social event preserves source ID and time; new genuine submissions remain distinct; anonymous/ambiguous identities are not fabricated or merged by contact alone. |
| J9-Y04 | Main Stripe and storefront mappings are characterized independently; adding order-to-contact linkage does not newly double count the correlated invoice sale. |
| J9-Y05 | Crash after one successful channel or after Instagram container/publish admission retains enough target/attempt evidence for reconciliation; unknown outcome does not become confirmed rejection or automatic repost. |
| J9-Y06 | Multiple accounts on one platform, edited content, changed grants and partial retry keep exact effect identity and exclude already-confirmed targets; manual/scheduled routes share the same rule. |
| J9-Y07 | The content-command family cannot present a local status mutation or constant performance counters as actual publication/campaign delivery; unsupported execution remains visibly unsupported. |
| J9-Y08 | A new attribution/recognition generation can be compared, activated and withdrawn without altering source evidence, mixing window/currency bases, retaining vanished buckets or sending live comparison effects. |

M001 J9-X01-X12 remains unchanged. J9 now has **20 local designed cases**, zero runner bindings and NOT_EXECUTED status. J8's 24 local designs and J13's 44-case manifest remain separate and unchanged. No new test-source file was executed or modified in this tranche; M001's source-test evidence is inherited, not a fresh passing run.

## 9. Closure and finite next action

Completed at named scope: producer/consumer identity tables; conditional PayPal duplicate recognition with explicit exceptions; actual growth schema constraints; available form/social identity loss; per-account publication receipt and Instagram uncertainty trace; a second success-event consumer; campaign/content namespace and adapter-to-status-only path; bounded actual canonical comparison and migration requirements.

Remaining: alternative outbound queue/claim and campaign-binding conformance; full source-to-campaign and eligibility/suppression adapter policy; optional connector/outer command runtime wiring; all-provider identity/refund integration; immutable attribution-generation and recognition target; final candidate allocation decision; backward convergence review and runtime proof. J9 remains **NOT CONVERGED**.

Next: **J9_PUBLICATION_OCCURRENCE_AND_ATTRIBUTION_CONTRACT_REVIEW**.

Planned output: `J9-PUBLICATION-OCCURRENCE-AND-ATTRIBUTION-CONTRACT-REVIEW.md`.

1. Resolve the newly named existing OutboundContent/OutboundDelivery/DeliveryEvent and campaign binding/dispatch seams, plus the outer ContentAdapter route and applicable recipient eligibility/suppression ownership. Read only what affects one publication/recognition contract; do not restart campaign CRUD or the already-completed payment producer scan.
2. Specify the minimal target: exact target/revision/claim and outcome certainty, source observation versus conversion recognition/economic identity, live/rebuild equivalence and complete model/window/currency computation generations. Complete the bounded canonical comparison before allocating any new root; preserve the specific source witnesses even when reusing a shared law.
3. Backward re-audit J3/J5/J7/J13/J14/J18/J23/J24, with J8's source-value and J21's public-boundary obligations. Assign declared-scope pass/defer/reopen gates and decide bounded J9 alignment or name the exact remaining invariant. Runtime/deployment proof remains separate and unexecuted.

The map pause, owner halt, baseline and documentation-only permission persist. Do not modify prior investigations or execute application/provider work to produce an artificial green gate.

## 10. Reproducible source manifest and context integrity

All S sources use `8f173bfe79f1418159cf4099ea18b0d60d203ec2`. Requested ranges can contain unrelated code; only the named methods/models are audited here. Directory/search results were discovery, not an alternative default-main evidence baseline.

| Ref | Source / inspected scope | Blob SHA |
|---|---|---|
| S01 | apps/server/src/modules/payments/payments.service.ts; 1-650 and 735-970, payment/posting helper, main Stripe handler, PayPal capture and related refund/fallback branches | 9cf9e56d5599eecb174cb34a3ca0e6f160136a26 |
| S02 | apps/server/src/modules/commerce/invoice-workflow.service.ts; 1-300, balance/state reconciliation and event emission | deee0ff9cc78235131d4932c99e35e21f80641f2 |
| S03 | apps/server/src/core/connectors/implementations/paypal.connector.ts; 85-190, especially emitPaymentReceived | 4073c01867e08c93c6f8acae4f3045f0a6020d84 |
| S04 | apps/server/src/modules/growth-intelligence/journey-listener.service.ts; full adapters and record wrapper | f864b2ebba7a7026baf2f8653c5fc3e93aacb2e0 |
| S05 | apps/server/src/modules/growth-intelligence/customer-journey.service.ts; 1-200, observation creation, aggregate/weight and stage computation | 63997bc739195e117fd548e29aeae9b2776031c1 |
| S06 | apps/server/src/modules/site/store-order.service.ts; 1-290 and 430-790, contact construction, transactional checkout and post-commit events | 3ebcc96567548ff57b6508b88c0dc852d4094378 |
| S07 | packages/db/prisma/schema.prisma; complete CustomerJourney/JourneyTouchpoint/AttributionResult blocks in 8620-9020, RevenueAttribution in 9250-9520, OutboundCampaign in 12500-12950; OutboundContent/Delivery relation excerpts only | c5f263432b30838b0f9723640282bbdeb2f4cba3 |
| S08 | apps/server/src/modules/lead-forms/lead-forms.service.ts; 100-end, transaction and full persisted-row event | 2e407bcbf537900b8babb443359e094a05111c60 |
| S09 | apps/server/src/core/connectors/implementations/social-platform.base.ts; full, especially engagement/DM event provenance and honest unsupported pull-sync boundary | c76e7b1b42c869f55f74e059019b846a30f55986 |
| S10 | apps/server/src/modules/social/publishers/base-publisher.ts; full result/adapter interfaces | 154e68217695322594584cd5220f437c7b8c0081 |
| S11 | apps/server/src/modules/social/publishers/instagram-publisher.ts; full publish and optional read behavior | c56d78200b2cb9bebe8f9aaba2b969e69dac46e9 |
| S12 | apps/server/src/modules/social/social-publishing.service.ts; full target selection/result persistence | 8f815520838c52e0b0bec6cd71ad535357664997 |
| S13 | apps/server/src/modules/flow/automation-executor.service.ts; onPostPublished within 800-end; unrelated test-execution method not run or newly audited | 0202c9dbdd0f0e3130e53d8897b6ceae69f9e601 |
| S14 | apps/server/src/modules/content/content.service.ts; 1-300, post/campaign creation, publish/send and performance methods | 1a005385a3ed6c6d95876760418507870dcafcc3 |
| S15 | apps/server/src/modules/key-cortex/adapters/content-adapter.service.ts; full command delegation | e8fcd344483f8883c6828d33c1cee93ee0f8497d |
| S16 | apps/server/src/modules/key-cortex/key-cortex-connector.utils.ts; full connectorOk/connectorFail/correlation helper | e1c5f4a4a05462a4565a59f34c2f52140037a864 |
| S17 | apps/server/src/modules/payments/payments.module.ts; full declared imports/providers; no successful DI/boot inferred | da8a9a8a0ba6a531f1990a7bb27f0876357198bf |

StripeConnector and broad schema ranges were supporting discovery; no fresh all-provider or whole-schema certification follows. The unsuccessful attempt to obtain a local raw-file copy supplied no evidence. No full checkout, tenant data, provider account or secret was inspected. No native model or source file was executed to generate these examples.

Actual comparison sources at intelligence input: R1 08AF (F197/F198), blob 1ed0fda2748dc9b475ffd2c885b5cce9dc847f5d; R2 08AJ (F205), c0b5d4035ce0806774ebab8a290bcc8f845f036a; R3 08AI (F204), 1dbfa11bdfa13c36b4a5a78efa6d4978f894e88e; R4 08K recovery supplement through 170, 9c81758f55acc2957ae155f2b1c8199c42e08f15; R5 10G/REC048 through 190, 885b3bb2d1caf341d96ac0c9538438c3e8c46c12. 04B's current allocator remains unchanged. M001's actual REC052/057 and prior J13/J8/J24 owner contracts are retained evidence, not newly runtime-proven. Historical source heads inside those registers do not rebaseline this trace.

P1 is the supplied KeyFlow OS Master Execution Blueprint: Social Intelligence/Phase X requires real publication before success consequences; its addendum permits controlled adaptation while keeping isolated verification and seamless user flow distinct. It supplies product intent, not evidence the current code or these proposed safeguards already work. No outside provider/framework-wide claims or external research were required for the local source conclusions here.

Context integrity: PASS FOR THIS BOUNDED M002 CONTINUATION. Live intelligence ref matched the input; AGENTS, AGENT-CONTINUITY, START/current state and both CURRENT/ROLLOVER pairs were loaded, with native-range continuation for the large YAML. Prior pool/ID/proof/debt state is preserved from the canonical content and continuous session. Current permission and map pause remain distinct from the historical implementation baseline. No live hosting control is newly certified by this trace.

Publish this analysis, a current J9 dossier overlay and matching state/START/handoff navigation in one intelligence-only checkpoint. Preserve M001, numerical registers, prior evidence, proof inventories and map artifacts. Dossier coverage remains 22/25 and kernel presence 12/12; this tranche creates no new journey. Git publication verification is not application verification.
