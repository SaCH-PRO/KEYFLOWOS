# J9 - Publication, Occurrence and Attribution Contract Review

Checkpoint: `J9-POA-2026-09-16-01`  
Date: 2026-09-16  
Intelligence input: `20e7501f562a1456190d26ddc3abd1aaae9a2601`  
Implementation forensic baseline: `8f173bfe79f1418159cf4099ea18b0d60d203ec2`  
Decision: **PROVISIONALLY TARGET-ALIGNED FOR THE NAMED PUBLICATION / RECOGNITION / ATTRIBUTION CORE ONLY**.

This completes the bounded contract review after [M001](J9-MARKETING-LEAD-GENERATION-MICROTRACE-001.md) and [M002](J9-MARKETING-LEAD-GENERATION-MICROTRACE-002.md). Both investigations remain unchanged. This document is the target/acceptance home, not an implemented service or a new authority system. Production code, schemas, settings, workflows and assertions are unchanged; no application, provider, DB, boot, concurrency or migration tests were executed. The programme map and its generator/check remain untouched under the user pause. Scheduled owner-halted cycles remain halted.

## 1. Declared scope and completed decisions

The named core includes the previously traced SocialService/SocialPublishingService/scheduler, native form and growth adapters, CustomerJourney/AttributionResult computations, ContentAdapter status-only commands, the inspected Cortex execute/query entrypoints, and the existing communications queue, Gmail/Resend adapter boundaries and campaign-contact projections. All-provider, all-recipient, every public-capture and every marketing campaign family conformance is not claimed.

| Review question | Disposition |
|---|---|
| Does a reusable queue and delivery history already exist? | YES. Complete declared communications model blocks and actual queue paths are now inspected. Preserve and strengthen them; do not introduce another sender by default. |
| Can a later local failure erase the meaning of an accepted send? | YES at the named queue catch boundary. Separate immutable provider outcome from local consequence repair. |
| Is an audience selected earlier still an authorized audience at dispatch? | NOT ESTABLISHED by the inspected queue/Gmail path. Current suppression/permission must reach actual effect admission. |
| Is the alternative ContentAdapter only hypothetical? | NO. Both the guarded execute route and the guarded query-to-dispatch chain are source-traced. Query does not enforce its read-only description before dispatching mutable content actions. |
| Are campaign names/IDs one interchangeable namespace? | NO. Typed OutboundCampaign association, JSON EmailCampaign linkage and MarketingCampaignPlan intent are distinct existing mechanisms. |
| Is a new generic generation/provenance system required? | NO. Apply REC049 revision/projection and REC048 recovery laws, with a concrete J9 computation contract. Preserve source-specific witnesses without creating a catch-all finding. |
| Can the named design converge without claiming code fixed? | YES, at the contract scope below. MD1-MD5 explicitly retain implementation, deployment, migration and executed-proof obligations. |

PC01-PC08 and AC01-AC08 below are document-local responsibilities. They are not new canonical concepts, required table names or a second runtime.

## 2. Existing queue: positive seams and remaining causal gaps

### 2.1 Real delivery records, claims and history exist

The schema declares ChannelConnection, ChannelDestination, OutboundContent, OutboundVariant, OutboundDelivery and DeliveryEvent. Delivery records reference an exact destination, optional variant and recipient; they retain retry count, timestamps, external references and result snapshots. Event rows preserve attempt/result information. The queue claims selected work by id plus previous status, checks update count, records events, and derives the parent from the distribution of delivery states rather than merely any success. The publish endpoint returns queued work rather than claiming it was already delivered. [S01/S02/S06]

Those are useful mechanisms, not proof of absent architecture. However, the declared models do not supply a unique logical publication-effect key, fenced lease/generation, immutable rendered-content revision or unique attempt identity. DeliveryEvent's attemptNumber and indexes do not alone prevent repeated or contradictory events. Database constraints in the source are not a verification of deployed migrations/triggers.

The queue's status claim does not compare the selected schedule, payload revision, current recipient permission or current grant. A per-row claim prevents two winners of that state transition; it does not freeze the meaning of the content or establish a common effect owner across the separate SocialPost and status-only command families. Public/worker/provider deployment coverage remains outside this source read.

### 2.2 Confirmed send versus local consequence failure

The inspected try block includes adapter.publish, the Published update, success-event persistence, event emission, campaign-contact bookkeeping and parent aggregation. Its catch treats any thrown error as an adapter error and can overwrite the delivery to RetryPending or Failed. [S01]

Conditional sequence:

```text
provider returns success with reference
 -> delivery row records Published and reference
 -> success event or parent bookkeeping throws
 -> outer catch normalizes the LOCAL error as a send error
 -> delivery becomes RetryPending or Failed
 -> a later retry may issue the provider request again
```

For the inspected Gmail adapter, an error message containing timeout can be classified transient regardless of whether it originated in the provider request or the later local database operation. A retry additionally requires the catch writes to succeed and remaining retry allowance. Even a nontransient local error can leave a successful provider result marked Failed, eligible for the manual failed-row retry path. [S01/S04]

This is a source-supported interleaving, not an observed duplicate email. Existing externalPostId/success history may survive and contradict the new status; do not claim they are necessarily erased. The selected contract makes that surviving evidence authoritative for the already-completed effect and retries only missing local consequences.

Terminal failure updates also classify campaign-contact status as BOUNCED in the normal failed-result path. Missing credentials or configuration are not evidence of an actual recipient bounce. The contract must preserve rejected-before-send, provider-rejected, unknown transport, accepted and actual later delivery evidence separately. [S01]

### 2.3 Queue-time selection is not current send permission

Audience expansion uses the business's Contact rows with doNotContact not true and marketingOptIn not false, plus optional segmentation. Those explicit filters are positive controls. This review does not infer nullable-field query behavior or legal sufficiency from that syntax. Addresses and contact IDs are copied into delivery rows at enqueue/schedule time. [S01]

The inspected executeDelivery and Gmail adapter then use the retained recipient without checking the Contact's current suppression decision. The dispatch precheck establishes a connection object exists; it does not itself consume current destination isActive, connector-grant generation or a recipient-eligibility revision. Thus a later opt-out or destination disable can be missed by this named path if the remaining send succeeds. Full SystemEmailService internals and every adapter were not audited, so no universal all-channel suppression claim is made. [S01/S04]

Fallback selection is also a material identity decision: the registry uses a GOOGLE/EMAIL connection with a nonempty token for Gmail; otherwise it chooses the existing Resend adapter. The latter supports an explicit environment off switch and uses SystemEmailService. Token presence is not a check of expiry despite broader language in a comment. Routing to a platform sender instead of the connected merchant sender requires its own permitted sending context; a missing token is not permission to broaden authority. [S03-S05]

The target pre-send decision must be ordered against revocation. It cannot promise that a local opt-out retroactively cancels a remote request already admitted. Unknown in-flight sends retain a reconciliation obligation without allowing another new send.

### 2.4 Target sets, variants and campaign namespaces

The publication methods require nonempty target input and some active same-business destinations, but do not establish a complete accepted manifest accounting for every requested target. Excluded or missing targets must be explicit, not silently disappear from the denominator. Re-enqueueing creates fresh delivery identities in the shown methods; the declared schema has no semantic effect uniqueness to prevent two different requests claiming the same intended send. [S01/S02]

OutboundContentService supports destination-specific variant metadata. Queue selection uses a platform match rather than that metadata's destination identity. With multiple distinct variants for the same platform, the intended account-specific variant is therefore not enforced by that selection. The variant remains mutable in place; stored variantId is not a frozen rendition. [S01/S07]

The schema's OutboundContent.campaignId references OutboundCampaign. In contrast, ensureCampaignAndContacts creates/uses EmailCampaign and stores that ID in contentMeta.campaignId, then writes EmailCampaignContact. It catches linkage errors and logs a warning without stopping delivery. Both are real existing associations; equal spelling of campaignId does not make the identifiers interchangeable. MarketingCampaignPlan remains another upstream intent record from M001. [S01/S02/S07]

Parent status aggregates current delivery rows across the content identity, not an explicitly versioned required target set. Soft-deleting content in OutboundContentService does not itself cancel queued deliveries. Cancel/retry use an eligibility read followed by an id-only mutation on named paths; retryAllFailed has a different status-filtered update. Preserve these distinctions rather than calling every path equally unguarded. [S01/S07]

### 2.5 Tracking is an observation, not human or financial proof

Tracking endpoints refuse absent/invalid signing context before recording a click or open; this is a positive correction to any historical empty-secret assumption. A valid token establishes the bounded request authenticity represented by that scheme, not which human acted or permission for a follow-up. Campaign-contact status writes are a lossy latest-label projection, not a substitute for immutable delivery/open/click observations or a conversion decision. No tracking attack or real engagement was executed here. [S01/S06]

## 3. Outer command authority is now source-traced

The Cortex controller has AuthGuard and BusinessGuard. Its execute route constructs a ConnectorCommand and enters KeyCortexExecutorService. The executor contains block/approval logic, an autonomy check and explicit fail-closed handling of a gate exception. Keep those mechanisms. Caller-provided userId and exact action decisions still need the canonical principal/authority contract; the existence of a guard is not a full action audit. [S08-S10]

A different route bypasses that executor:

```text
POST api/v1/cortex/query, under controller authentication/business guards
 -> queryModule(module, query, parameters, businessId)
 -> KeyCortexConnectorService.query
 -> command.action = queryName
 -> same execute dispatch and content adapter
 -> publish_post / send_campaign / other supported mutating action
```

The QueryModuleDto accepts a string query. The facade describes this method as read-only but does not enforce a read-only capability set before calling the mutable dispatcher. The controller call also does not pass a resolved actor into the query helper. This establishes a guarded source path around the executor's decision layer, not a public unauthenticated exploit. No HTTP request was executed. [S08/S09/S11]

M002 established that the selected ContentService publish/send methods only mutate local status, then the adapter wraps success. This review establishes their outer route. Do not now reinterpret their result as real dispatch, and do not wire a real sender behind that unclassified query path first. The read/write decision must be enforced from the existing capability registry and current actor authority before the execution capability is upgraded. Query and execution can share dispatch implementation only after a load-bearing operation-class check; their endpoint names are not security boundaries.

## 4. Bounded canonical comparison and allocation decision

M001/M002's actual REC052/057, F197/F198/F204/F205, outcome and REC048 comparisons remain evidence. This review additionally reads REC049's revision, derived-projection, analytics and LearningEligibility clauses; F178's correction/invalidation law; the historical provider-recovery supplement; and current 04B. [R01-R04]

| Pressure | Owner and decision |
|---|---|
| Successful remote send later reclassified by local failure | REUSE REC048's effect versus consequence and certainty law, applied to the concrete S01 write set. Stable delivery ID is not sufficient provider-effect recovery. |
| Missing provider-stage receipt, account/attempt/revision identity | REUSE K9/K11 recovery and J13 grant contract. Historical provider-recovery content already discusses internal/external identity and multi-stage operations; do not duplicate it as a new general engine. |
| Query label permits mutable content dispatch | SPECIALIZE existing K3/K5 exact action-class/authority rules. Retain the newly completed route witness here; do not claim older governance findings already traced these precise methods. |
| Multiple payment observations inflate one conversion | REUSE F198's economic-lineage target, retaining M002's explicitly conditional PayPal witness and its provider/contact exceptions. Do not collapse legitimate installments by invoice ID. |
| Stale, mixed-window or incomplete attribution results remain current | SPECIALIZE REC049's revision-bound analytics, source/materialized revisions and incomplete states, plus F178's derivative invalidation law. AC01-AC08 makes the J9 generation boundary precise. F178's proven Genome source is not silently expanded into this code. |
| Recipient suppression, fallback sender and mutable rendition | SPECIALIZE current authority, required-target-set and immutable intent/receipt rules. Keep specific source witnesses and their proof obligations even without allocating an omnibus new finding. |

**No new finding, contradiction, recommendation or concept is allocated.** This is an explicit reuse/composition decision, not a claim that all witnesses are the same bug or that the existing code already conforms. F229/C179/KF-REC-058 remain unallocated. F228/C178 retains its time-billing meaning. The historical provider-recovery supplement contains colliding numeric headings; its semantic content is retained, but 04B controls numeric ownership. No old header is used to remap canonical F152/F153.

## 5. Selected publication contract: PC01-PC08

| Responsibility | Required decision and durable result | Existing owner |
|---|---|---|
| PC01 Intent and target manifest | Exact content/rendition revision, schedule, sender/account, audience/recipient basis, requested targets and explicit exclusions. Namespace-aware campaign associations. | Content/Social/communications domain services; K7 WorkDefinition semantics |
| PC02 Current admission | Trusted initiating principal and delegation; permitted operation class; business/relationship scope; current provider grant and recipient eligibility. Re-evaluate before a new material send. | K2/K3/K5, J13, existing suppression/recipient owners |
| PC03 Effect ownership | Stable logical effect identity distinct from operation request and attempt; one current fenced owner for the same content occurrence and destination/recipient purpose. | Existing OutboundDelivery/claim machinery with K11 |
| PC04 Attempt and provider evidence | Durable intent before network; exact rendered payload and account/grant coordinates; provider idempotency where verified, intermediate references, outcome certainty and attempt lineage. | Existing adapters plus DeliveryEvent/evidence references |
| PC05 Confirm and repair | Persist provider acceptance/publication evidence without demoting it on a later local failure. Record missing local consequences separately; repair them for the same effect. | Queue/domain transaction and REC048 |
| PC06 Derive parent/consequences | Required target manifest plus all child outcomes, including suppressed/unsupported/unknown. Deliver consistent typed consequences to social, campaign, activity and gamification consumers. | Existing event bus/consumer claims and K8 |
| PC07 Receive later evidence | Authenticate and bind provider delivery/read/rejection/correction observations; retain observation times and dedupe identity; do not infer recipient delivery from send acceptance. | J14/K9 ingress and channel adapters |
| PC08 Revise/cancel/retry/withdraw | New scope/rendition requires explicit revision; cancellation blocks new admissions and preserves in-flight certainty. Retry only unresolved safe effects; history and current revocation survive variant withdrawal. | K7/K11/J13/J24 |

### Load-bearing ordering

Enqueueing commits the accepted manifest and child intents with durable identity. Where the accepted business result requires all named local records, share the actual transaction client; a callback through another client is not atomic simply because the outer function opened a transaction. Large audiences may materialize in chunks under a recorded complete manifest/cursor; an interrupted chunk cannot be mistaken for the full audience.

Before a provider attempt, serialize the current claim/admission against cancellation, rescheduling, grant revocation and recipient suppression. An eligibility snapshot explains the decision but does not replace the current stop. The admission boundary must be immediately relevant to the request being issued; no guarantee of instant remote cancellation is implied. A lease expiring proves the worker lease expired, not that its remote action failed. Recovery must retain the unknown effect and fence stale completions.

Freeze the actual rendition used for the attempt: subject, body/media references, sender, exact recipient and selected account-specific variant. Later edits create another proposed revision or an explicitly reviewed replacement of unissued work. Already-issued content and receipt remain the prior revision. Avoid storing secrets in ordinary receipts; retain scoped secure references where needed.

### Truthful outcomes and adapters

Distinguish local draft/status update, queued, admitted, attempted, unknown, provider-accepted/published, recipient-delivered where established, definitively rejected, suppressed, cancelled-before-admission and local-consequence-incomplete. A provider-independent generic SUCCESS cannot substitute for the stage required by the caller. For social publication, provider-specific publication evidence may be the intended terminal stage; for email it does not prove recipient receipt.

Adapter selection/fallback records the actual sender and authority. Failed merchant credentials do not authorize platform delivery by default. The existing environment off switch is preserved, not treated as the complete consent/authority system. Unsupported capabilities return unavailable and leave existing business history truthful, rather than setting Sent to satisfy a command.

PC05 separates the external call from its post-call bookkeeping catch boundary. Once a reliable success receipt exists, later failure creates a repair task for local history/events/projections, not a fresh provider send. Unknown response handling does not assert native provider idempotency support without verification. Cross-channel retries resume unresolved children, not every target under a fresh CUID.

## 6. Observation, recognition and attribution contract: AC01-AC08

| Responsibility | Required meaning |
|---|---|
| AC01 Preserve source observation | Tenant, source system/type/ID and revision; observed event class; established occurrence time separately from receipt/recording time; original amount/currency and trusted subject linkage. Unknown lineage remains explicit. |
| AC02 Correlate economics | Bind observations to the actual sale/capture/installment/refund/obligation they describe. Per-consumer replay dedupe is distinct from correlation across event families. |
| AC03 Recognize conversion | Versioned policy decides qualifying event/state, value stage, conversion identity and customer-stage consequence. Live and backfill use the same adapter/recognizer or an explicit reviewed migration. |
| AC04 Define report basis | Per-conversion or labelled cohort-lifetime model; complete interval/cohort boundary and cutoff, lookback, subject/channel/campaign dimensions, recognition/model version, currency/valuation/rounding and attribution policy. |
| AC05 Build generation | Immutable accepted basis and source watermark/snapshot; stage all result buckets and lineage; completeness manifest, rejected/unresolved evidence and deterministic input/output identity. |
| AC06 Validate/activate | Verify membership, required sources and unit/value conservation; zero-result generation is valid only after successful complete measurement. Atomically activate one complete compatible generation, not a newest individual row. |
| AC07 Correct/rebuild | New/refunded/withdrawn/late observations invalidate affected derivatives or create an explicitly restated generation; retain historical decision lineage and respect source disposition. |
| AC08 Consume/compare/withdraw | Readers select the exact active compatible generation and expose basis/freshness/incompleteness. Shadow models have no external effects; rollback does not revive disallowed source evidence or erase economic history. |

### Recognition is not an event counter

A fully paid invoice corroborates a commercial state; a capture records a monetary operation. Two emitted observations about one economic operation must not count as repeat purchasing or double value. Conversely, separate installment captures must not be merged solely because they share invoiceId. Missing payer/subject identity remains unresolved, not assigned to a convenient contact. Correcting the storefront adapter requires correlation with its invoice observation before admitting another valued conversion.

A booking conversion may be a legitimate configured nonmonetary goal. It must be explicit and consistent for cancellation, timing and replay; it does not become collected revenue. Quote, order, invoice, receipt, margin and attributed allocation remain different value stages. Native currency is preserved; combining currencies requires an explicit valuation source/time/policy from K10. Invalid or absent valuation yields unknown/degraded evidence, not an arbitrary TTD label.

Attribution is a declared allocation model, not proof that marketing caused the sale. For each admitted monetary conversion under one basis, attributed shares plus an explicit unattributed residual conserve the admitted value within declared rounding. Reversals/corrections trace to their original occurrence. First/last-touch ties require a deterministic rule and stable source-time identity, not processing-order accident.

### Generation and window integrity

The report definition must include both periodStart and periodEnd with declared boundary/timezone semantics; a cohort report also needs its value-observation cutoff. A cohort selected on day 10 may intentionally report day-40 value only under that labelled basis. A per-event days-1-to-30 report must not silently include it. Later touches alter older credit only through an explicit restatement/model revision, not by mutating the meaning of an already-read report.

Use a consistent source snapshot or a recorded watermark with deterministic catch-up for later arrivals. Build raw-to-recognition-to-allocation lineage in staging; validate the selected input set, exclusions, currency, model and complete buckets. Activate by comparing the current generation/base revision, so an older slow job cannot overwrite a newer correction. All required reader projections either activate together or report their incompatible/stale states rather than mixing new journeys with old attribution silently.

A zero-bucket result is a complete generation with measured absence; it retires older buckets when activated. Setup failure, missing shard/source or interrupted rebuild is INCOMPLETE and leaves the previous qualified generation marked with its actual freshness. Never delete authoritative observation history merely to recalculate derivatives. Current legacy touchpoints with unreconstructable origin require classification/quarantine/reconciliation, not invented source IDs.

Generation storage may reuse/extend existing AttributionResult and knowledge/evidence mechanisms after exact schema design. These contract terms do not demand one new table each. RevenueAttribution remains a distinct commercial attribution/source link, not a synonym for model results. K4 LearningEligibility permits an admitted result to inform recommendations; it never grants stronger sending authority.

## 7. Integration and reversible migration

| Slice | Existing mechanisms to adapt | Required exit condition / withdrawal floor |
|---|---|---|
| P0 Operation and environment admission | Existing registry, Cortex query/execute, J24 isolated runs | Read-only allowlist enforced before any status-only command gains real sending ability; current actor and purpose recorded. No production execution authorized here. |
| P1 Compatible intent/receipt/basis storage | Existing content, variant, delivery/event, campaign, observation and attribution records | Exact existing-record reuse and additive constraints chosen; legacy unknown identity retained honestly. No destructive replacement of receipts. |
| P2 Common publication ownership | Social/manual/scheduled/communications/content commands and adapters | All named paths share admission/target identity and stage-correct results; gate catches do not trigger new sends after known success. |
| P3 Recognition and attribution shadow | Existing growth adapters/recompute/backfill and K4 evidence | Reproduce complete same-basis inputs without duplicate business events. Validate windows, refunds, native currency, subject lineage and zero buckets. |
| P4 Reader and downstream cutover | Dashboard, campaign status, activity, gamification and other named consumers | One compatible generation/receipt basis is selected; stale/incomplete states visible. No unverified success events fed into learning. |
| P5 Controlled activation and withdrawal | Existing reviewed feature selection and deployment process | Current authority remains mandatory; one effect owner; known-good compatible reference or safely disabled new action. Prior report generation only usable if still permitted by source disposition. |

The slices are an ordered design, not implementation packets. J24 retains separate proof, merge and release decisions. Report-model switches must never resend email or reconstruct payments as new business effects. Cancelling an experiment stops its future work; it cannot undo a delivered message by deleting a row. Retention/deletion follows J19's permitted evidence policy, not unlimited raw-content retention in the name of reproducibility.

No replacement sender, CRM, consent vendor, universal queue or new analytics stack is selected. Existing mechanisms are reused only where they meet the named contract. A source comment claiming automatic safety is not a gate. Final DDL and provider-specific behavior remain MD1/MD3 rather than silently filled with generic framework assumptions.

## 8. Backward re-audit and preserved ownership

| Owner | Bounded review result |
|---|---|
| J3 / commercial relationship | RETAIN separate identified/qualified/customer states and economic value stage. Capture or tracking alone does not qualify a person or prove consent. |
| J5 / REC057 and J14 | RETAIN original occurrence and consumer-claim ownership. J9 projects it and does not create another conversation/ingress engine. |
| J7 / REC052 and J8 | RETAIN native financial facts, allocation conservation and correction. Recognition/attribution cannot change an invoice or erase billed work to match a metric. |
| J13 / K9 | RETAIN current grant/revocation and per-account scope. Queue existence, fallback selection and stale credentials do not regrant authority. |
| J18 / REC048 | RETAIN attempt/effect/consequence distinctions; successful external effect plus local failure repairs locally. Unknown effects are reconciled before retry. |
| J23 / K7 | RETAIN definition/occurrence/attempt and version/schedule ordering. A saved mutable row is not immutable scheduled intent. |
| J2/J15 / K2/K3/K5 | REFINE application to the query route: operation class and actual principal precede dispatch; preserve working autonomy and fail-closed execution gates. |
| J16/J17 / REC049/K8 | RETAIN revision-aware analytics and learning; no source correction is complete while incompatible active derivatives masquerade as current. |
| J24 / K12 | RETAIN isolated proof, independent acceptance rules, nonempty cases and safe withdrawal. A reviewed target is not deployment permission. |
| J19/J21 and later public coverage | DEFER full surface audit, retain explicit source-disposition and public grant/eligibility interface requirements. No legal consent certification made. |

The architectural comparison is bounded: these owners' accepted contracts are consumed, not every earlier runtime re-audited. Later counterexamples reopen the exact invalidated invariant. No global completion score is inferred from this table.

## 9. Designed verification and analytical challenge review

M001's twelve X cases and M002's eight Y cases are preserved and covered by PC/AC responsibilities:

| Existing cases | Target coverage |
|---|---|
| X01-X03, Y05-Y07 | PC01-PC06/PC08: false success, account/variant identity, partial retry, schedule/claim races, provider certainty and status-only command truth. |
| X04-X07, Y01-Y04 | AC01-AC03: capture identity, live/replay equivalence, economic overlap, currency/value-stage and distinct provider/contact paths. |
| X08-X11 | AC04-AC07: report windows, complete generations, vanished buckets, interrupted backfill and mixed dashboard freshness. |
| X12, Y08 | PC08/AC08 plus J24: safe model/channel comparison and withdrawal without source-history or external-effect duplication. |

Six additional document-local designs expose this tranche's specific witnesses:

| Case | Required isolated characterization / acceptance |
|---|---|
| J9-Z01 | Provider accepts, then local success-event/aggregate persistence fails: retain known outcome and repair consequences without another send. |
| J9-Z02 | Queue a recipient, then suppress/revoke/change sender permission before admission: no new prohibited request; admitted in-flight uncertainty remains explicit. |
| J9-Z03 | Authenticated query requests cannot dispatch mutating content actions; ordinary execution still consumes existing policy and truthful effect-stage results. |
| J9-Z04 | Two same-platform destinations with different variants, edited content and a partial target selection use the exact accepted manifest and immutable rendition. |
| J9-Z05 | Sender fallback and enqueue/retry use one authorized logical effect; re-enqueue, stale worker and lost lease cannot bypass current recipient/grant policy. |
| J9-Z06 | Complete zero-result or corrected generations retire stale buckets atomically; late older jobs cannot reactivate them and withdrawal cannot expose revoked source material. |

These are **analytical designs, not executed tests**. J9 now has 26 local designs (12 X + 8 Y + 6 Z), zero runner bindings and NOT_EXECUTED status. J13's 44-case manifest and J8's 24 designs remain separate and unchanged. No assertion was weakened or test suite run. The target covers the listed challenge responses; its enforcement is not thereby proven.

## 10. Closure gates and remaining readiness debts

| Gate | Disposition | Evidence boundary |
|---|---|---|
| G9-01 continuity and controls | PASS_BOUNDED | Input, source baseline, prior contracts, owner halt and map pause preserved. |
| G9-02 existing outbound/source schema | PASS_NAMED_SOURCE | Full declared communications blocks and the queue/adapters read at named scope; deployed constraints not verified. |
| G9-03 invocation and permission | PASS_SOURCE_CLASSIFICATION | Guarded execute and query paths distinguished; current suppression gap and namespace/variant bindings identified. |
| G9-04 canonical comparison | PASS_BOUNDED_REUSE | REC048/049/052/057 and current allocation retained; no new ID or competing generic system. |
| G9-05 publication contract | PASS_DESIGN | PC01-PC08 establishes current admission, exact effect/target identity, immutable known outcome and repair. |
| G9-06 recognition/generation contract | PASS_DESIGN | AC01-AC08 binds source, economics, model/window/value and complete activation. |
| G9-07 integration/withdrawal | PASS_DESIGN | Named entrypoint cutover and compatible state/receipt/generation floors specified. |
| G9-08 backward re-audit | PASS_BOUNDED_TARGET | Shared kernel ownership retained; query and recipient witnesses reinjected. |
| G9-09 all-provider/public/deployed conformance | DEFER | Named scope is not the whole marketing or public estate. |
| G9-10 runtime proof | NOT_EXECUTED | No app/provider/DB/concurrency/migration execution or test bindings. |
| G9-11 convergence | PROVISIONALLY_TARGET_ALIGNED_NAMED_CORE_ONLY | Source/design loop closed at declared scope, not software correctness. |
| G9-12 implementation/release authority | UNAUTHORIZED | No production edits, scheduled-cycle restart or deployment. |

Remaining debts: **MD1** final existing-record reuse, namespace migration, indexes/constraints and legacy source/receipt reconstruction; **MD2** implement/characterize all named dispatch/query/adapter and downstream-reader paths, plus later-discovered writers before expanding scope; **MD3** actual provider capability/idempotency/receipt semantics, sender and recipient eligibility integrations and full public-surface/deployment conformance; **MD4** recognition, economic/refund/currency and atomic generation implementation with historical reconciliation; **MD5** authorized isolated runtime, concurrency, negative-control and migration proof after deliberate baseline comparison.

No current code defect is marked fixed by this decision. J13 ED1-ED5, J8 WD1-WD5 and J24 CS1-CS5 remain explicit. Reopen on a concrete stale-authority send, duplicate known effect, query mutation, incorrect recognition or mixed/incomplete generation counterexample rather than repeating the whole investigation on every new chat.

## 11. Exact next programme action

**J20_PLAN_SUBSCRIPTION_AI_COST_ACTIVATION**.

Planned, not created here: `journeys/KF-JOURNEY-020-PLAN-SUBSCRIPTION-AI-COST.md`.

Trace actual plan/subscription/payment state into feature entitlements, AI allowance/admission, usage recording, billable classification, credits/overage and reconciliation. Distinguish a displayed plan, paid subscription, effective permission, reserved budget, successful or failed model attempt, recorded usage and invoiced/settled cost. Reuse K3 authority, K10 value policy, K11 partial-outcome recovery, J24 trustworthy proof and the current sender/provider admission boundaries. Do not start model calls, invoice creation or subscription writes during analysis.

This chooses an existing remaining canonical journey, not J26 or a new tech-stack programme. J20 is not analysed by this checkpoint. J20/J21/J22 remain dossierless until actually created; coverage remains 22/25 and twelve kernel dossiers. The map stays frozen.

## 12. Source manifest and context integrity

All implementation reads use `8f173bfe79f1418159cf4099ea18b0d60d203ec2`. Names/ranges below delimit the audit; discovery-only ranges are not a full schema or whole-controller review.

| Ref | Source / inspected scope | Blob |
|---|---|---|
| S01 | apps/server/src/modules/communications/delivery-queue.service.ts; claim/execute/parent aggregation, publish/schedule/audience, retry/cancel and campaign/tracking methods via full and 355-760/715-1000 ranges; critical 140-310 independently reread | a498faaa6a81fbf0962a8913d79beb1c6442f098 |
| S02 | packages/db/prisma/schema.prisma; complete communications blocks within 3830-4090. Other ranges were discovery only | c5f263432b30838b0f9723640282bbdeb2f4cba3 |
| S03 | communications/adapters/adapter-registry.service.ts; full | 256e940da33d5313b06c8ea1b11c78bafab2c124 |
| S04 | communications/adapters/email-adapter.ts; full Gmail call/normalization/tracking composition | bf06a33e3576c7ae4420b975a9356b32d2b1e065 |
| S05 | communications/adapters/resend-email-adapter.ts; full wrapper, not SystemEmailService internals | 71eb0d430d9c2f5119c51fc26a7f1b9f729e8091 |
| S06 | communications/communications.controller.ts; 1-255, guards, queue entry and signed tracking | f4496604004eefdc15879b0f081f735e66c33ef4 |
| S07 | communications/outbound-content.service.ts; full mutable content/variant and scoped soft-delete paths | 7ce14cfb7ae0346710186e6c741043a97471393f |
| S08 | key-cortex/key-cortex.controller.ts; 260-550 DTOs, 730-815 class guards, 1400-1590 execute/query; imports/other ranges discovery only | 2c30ce7c843380a658500df49ba08af0edd3252f |
| S09 | key-cortex/key-cortex-connector.service.ts; full dispatch and query construction | 449080151bcafe62342abd862dde04a1af5edee4 |
| S10 | key-cortex/key-cortex-executor.service.ts; 1-455, block/autonomy/approval/dispatch/result gates; not every helper | d7438c181bd7007a04b531a3513d41f28078b93c |
| S11 | key-cortex/adapters/content-adapter.service.ts; full action delegation | e8fcd344483f8883c6828d33c1cee93ee0f8497d |

Abbreviated S03-S11 paths are relative to `apps/server/src/modules/`. M001/M002 retain their exact earlier source manifests for SocialPost, ContentService, economic producers and attribution computations. Their source-derived examples remain inherited evidence, not freshly executed fixtures.

R01: 10H/REC049 sections A-M, blob 7b722b50e92caf7ee875fe1bee9ae8cf7de67d97. R02: 08R/F178, blob aba7ccf59a7f709e967e49b9b27d235fdab20ed1. R03: 08L provider-recovery supplement, blob ac56bd3ce3d1478ee1fefee33103a1690e0bb039; historical colliding numbers are not allocation authority and its external provider claims are not reverified here. R04: current 04B through its allocation/rules tail, blob f4506aa16bf0b52b63d7be4d286cb8305fcd5b44; 03 canonical roster, blob 10400870f9b66a482d4f53c1e56cf142680baa73. M001/M002's actual register comparisons and accepted J13/J8/J24 contracts remain inherited with their original scopes.

P1: supplied KeyFlow OS Master Execution Blueprint/KEYFLOW v3, Social Intelligence and Phase X event intent, section 6.1-6.3 controlled adaptation and isolation-versus-integration. The blueprint explicitly permits minimal synchronous composition for a necessary user result; it does not establish current transaction, receipt, authority or generation correctness. This review's contracts are derived design, not claims already proven by P1. No provider API compatibility, current legal consent rule or external standard was inferred without source research.

Context integrity: PASS FOR THIS BOUNDED REVIEW. AGENTS/AGENT-CONTINUITY, START, 07 and both CURRENT/ROLLOVER pairs were loaded; large machine state completed by native tail reads. Input commit/tree and earlier programme state are available. No fresh live-admin-settings audit or application boot is implied. Container raw-file access failed and supplied no evidence; source work used the connected GitHub reads. No local app code or resource fixture ran. Publication/diff checks are Git/document evidence only.

Persist this result with the current J9 dossier and matching navigation in one intelligence-only checkpoint. Preserve M001/M002, registers, kernels, original evidence and all map artifacts. No new canonical identity or journey dossier is created by the review.
