# J9 - Marketing, Publication, Lead Capture and Attribution: Microtrace 001

Checkpoint: `J9-M001-2026-09-16-01`  
Date: 2026-09-16  
Intelligence input: `c8d1b24f655956615f0d197d9068a2df24f20200`  
Implementation forensic baseline: `8f173bfe79f1418159cf4099ea18b0d60d203ec2`  
Result: **J9 ACTIVATED; FIRST NAMED PUBLICATION / CAPTURE / ATTRIBUTION TRACE COMPLETED; NOT CONVERGED**.

Production source, schemas, settings, workflows and test assertions remain unchanged. No application, database, provider, boot, concurrency or migration test ran. The programme map remains frozen at J24-PA; its files, renderer and generator/check are untouched. Scheduled audit/truth/burndown/reflect cycles remain halted. Inspecting the application's social scheduler is not starting that scheduler or restarting an owner-halted routine.

S01-S19 below are pinned implementation sources. R references are accepted architecture evidence; P1 is the supplied historical blueprint. J9-X01-X12 are document-local designed cases, not new canonical findings or executable test bindings.

## 1. Question, product intent and bounded reach

Question: can the application carry truthful identity and outcome from campaign intent through actual publication, lead capture and commercial attribution, including retries and historical reconstruction?

P1's Social Intelligence module intends publishing to produce a real post, POSTED state and post.published; its Flow architecture connects activity to later business consequences. Those are product intentions, not proof any baseline path executed successfully. The inspected source uses SocialService/SocialPublishingService and an in-process SocialSchedulerService, rather than treating the blueprint's sample Nango/Trigger implementation as current fact.

Scope: campaign-plan CRUD, guarded manual social publishing, scheduled dispatch, per-channel result aggregation, a concrete gamification consumer, native lead-form capture, live customer-journey listeners, backfill, attribution computation and the Growth Intelligence dashboard/client. Email-campaign execution, lead-magnet variants, full paid-ad/social-provider adapters, consent/qualification policy and all external engagement producers are not exhaustively traced.

This is an initial cross-system trace, not an assertion that the whole funnel is absent. Several useful components already exist. The unresolved question is whether their identities, classifications and consequences agree.

## 2. Actual chain and data ownership

| Boundary | Current source owner / fields | Established behavior and limit |
|---|---|---|
| Campaign intent | MarketingCampaignPlan via MarketingCampaignService | Scoped CRUD for name/goal/audience/offer/channel, budget, expectedRevenue and dates. Status begins DRAFT and is editable. This service does not publish a post, spend budget or record observed revenue. No global absence of other campaign execution is claimed. [S01/S02/S18] |
| Content / destination selection | SocialPost content/mediaUrls/channelIds/scheduledAt | createDraft selects DRAFT or SCHEDULED and emits local creation/scheduling events; updatePost can reset status with schedule changes. Stored intent is not external publication evidence. [S03] |
| Actual dispatch | SocialPublishingService and registered publishers | Calls matching connected channels, keeps PublishResult entries, derives anySuccess and first-success references. Provider adapter internals and actual provider outcomes are outside this trace. [S04] |
| Scheduler | SocialSchedulerService | Bounded due selection, per-process running guard and status compare-and-set to PUBLISHING before dispatch. These are positive seams, not zero safeguards. [S05/S16] |
| Lead capture | LeadForm / LeadFormSubmission / Contact | Active form lookup, public guard/sanitization declarations, tenant-derived contact lookup and contact/submission transaction. Submitted source is retained as input, not independently authenticated campaign provenance. [S07/S08] |
| Journey evidence projection | JourneyListenerService -> CustomerJourneyService | Creates touchpoint rows and recomputes one contact's aggregate and weights. Does not receive a canonical occurrence ID in RecordTouchpointInput or a durable consumer claim in the shown path. [S09/S10] |
| Attribution | AttributionService | Selects journeys by first convertedAt in period, applies weights over all included touchpoints to lifetime totalRevenue, then upserts result buckets. [S11] |
| Operator result | GrowthIntelligenceService/controller/panel | Dashboard exposes funnel, channel mix, attributed revenue and model comparison; panel has Backfill and Recompute insights actions. These paths are source-reachable, not a rendered or executed UI test. [S12-S14] |

Campaign plan status, actual publication, form submission, Contact.status=LEAD, journey stage, conversion timestamp, attribution result and financial revenue are separate represented states. This trace finds no load-bearing join from MarketingCampaignPlan to the inspected social post/form listener inputs. That is a named-boundary gap, not proof no campaign integration exists anywhere.

## 3. Publication truth differs across manual and scheduled paths

### 3.1 Preserve the already-correct no-account refusal

SocialService.publishPost finds the post under businessId/deletedAt constraints. With no explicit channelIds and no connected account, it throws and does not mark the post published. Existing source tests assert that refusal and that no postedAt is fabricated. Do not re-report the historical zero-account fake-success branch as current. [S03/S15]

A separate path survives:

```text
explicit channelIds OR at least one connected account
 -> publishToChannels returns results without throwing
 -> reload SocialPost
 -> emit post.published unconditionally
 -> optionally emit Meta connector publication event
```

The wrapper does not check results.some(success). The inner service can return all failed results, or a NONE/false result when explicit IDs match no connected channel. In the no-match case it returns before updating SocialPost. Both are normal returned results, so the wrapper still emits post.published. If the publisher throws instead, this particular event path is not reached. [S03/S04/S06]

### 3.2 A concrete downstream consumer trusts the event

GamificationListener.handlePostPublished reads Business.metaData and, if unset, writes firstPostPublished=true. It does not verify the post's status, target results or provider receipt. Therefore, with successful local writes and that listener active, an all-failed or no-matching-channel manual attempt can set the first-publication milestone despite no successful channel result. This is a static producer-to-consumer sequence, not an observed customer incident. [S19]

Other post.published consumers were found by search but not freshly traced here; their effects are not asserted. The named gamification path is sufficient to establish a consequence beyond a misleading event name.

### 3.3 Partial delivery is retained in detail but collapsed at the headline

publishToChannels iterates connections, retains per-result detail and sets the post to POSTED when any result succeeds. externalPostId/externalUrl are taken from the first success; lastError is cleared when any channel succeeds. This is not proof failed channel results are deleted: publishResults preserves them. It does mean POSTED alone cannot establish that the intended destination set completed. [S04]

Manual publishing without explicit request channelIds does not fall back to the post's stored channelIds in the inspected call chain: it selects all connected channels. Scheduled dispatch explicitly forwards stored channelIds when nonempty. A saved single-channel intent can therefore be treated differently by the two entrypoints. Whether a particular UI always supplies explicit IDs remains a next-caller question. [S03-S06]

After a real attempt, the inner service replaces channelIds with used platform names rather than the original connection IDs. A retry can therefore have weaker account-specific identity when several accounts use one platform. PublishResult retention is useful; it is not a durable claim excluding already-successful account/content effects from a later retry. Full adapter idempotency and account receipt storage remain uninspected.

### 3.4 Scheduled work has a real claim but does not share the full semantic boundary

The scheduler selects due SCHEDULED rows, then updates by id/status to PUBLISHING and checks count. This prevents two schedulers from both winning that particular status transition. Its claim does not repeat the selected scheduledAt or content/target revision. If the user moves a selected post into the future while it remains SCHEDULED, the old claim can still win and the publisher rereads content without checking the due time. This is a conditional stale-selection sequence; no actual early publication was executed. [S03-S05]

Manual publish does not consume the scheduler's PUBLISHING claim or require an eligible lifecycle status. Thus scheduler-only compare-and-set is not evidence that all manual/scheduled attempts share one effect owner. A crash can also leave a PUBLISHING row outside the shown due query; recovery elsewhere was not exhaustively searched.

Scheduled dispatch emits social.scheduled.dispatched with success, rather than the wrapper's post.published. The inspected firstPostPublished listener subscribes only to the latter. The real provider effect can therefore have different local consequences by entrypoint. No claim is made that no other adapter ever bridges these events.

## 4. Lead capture exists and is transactional, but occurrence lineage narrows

LeadFormsController's administration routes use AuthGuard/BusinessGuard. Public submit declares PublicRateLimitGuard/HoneypotGuard, sanitizes the data and bounds source text. LeadFormsService resolves an active nondeleted form and derives businessId from that record rather than directly trusting a posted businessId. These are existing controls to retain; their global context interaction and runtime efficacy were not tested. [S07/S08]

Within a transaction, submission looks up a Contact by normalized email in the form's business, creates a LEAD when needed, and persists LeadFormSubmission with contactId/source/data. It contains a P2002 fallback lookup, but this trace does not certify transaction-abort/retry correctness of that fallback. With no recognized email field, contactId stays null and the submission may still succeed. That is explicit anonymous/unresolved capture, not automatically a qualified or identified lead.

The method emits lead_form.submitted after the transaction. A normal transaction protects contact/submission composition; an in-process event emitted afterward is not itself a durable delivery receipt. Each submit call creates a new submission; no request-occurrence identity is consumed in the shown method. Reusing a Contact is not deduplication of the submission or its downstream consequences.

The live journey listener records source='lead_form', form ID/name metadata and form_submit/INTEREST. It does not carry submission.id, submission.source, campaignId, campaignName or contentId into dedicated touchpoint identity fields. If no contactId, record returns without a journey touchpoint. The Contact may store LEAD_FORM/form name, but that does not by itself preserve the original campaign/source attribution. [S09]

Likewise, identified social engagement is recorded with postId in metadata, while contentId and campaign fields are not set by the inspected listener. Anonymous social fanout is intentionally skipped, a positive boundary against inventing contact identity. Matching a response to a campaign requires a trusted join; a display label or caller-supplied source is not causal proof by itself.

## 5. Live and rebuilt journeys do not currently mean the same thing

### 5.1 One booking can change classification during backfill

CustomerJourneyService's conversion-type set includes payment, invoice_paid, booking, purchase and order_paid. Live listeners use booking_created, booking_confirmed, booking_cancelled and booking_rescheduled with CONSIDERATION hints. Those typed events do not match the generic booking conversion type. [S09/S10]

backfillBusiness selects every nondeleted booking without a status filter, records generic booking at startTime, stores status only in metadata, and uses CONSIDERATION as a hint. recomputeJourney nevertheless recognizes generic booking as a conversion and elevates stage to at least CONVERSION. Two generic booking touchpoints can elevate it to RETENTION. A cancelled booking is not excluded. [S10]

Thus a contact with one cancelled booking and no payment can be a consideration-stage journey live, then become a converted journey on backfill with zero revenue. This does NOT mean the attribution engine creates positive revenue for that booking: it skips journeys with totalRevenue<=0. The distortion here is conversion/stage/time meaning, not invented positive money from a valueless booking.

There is another distinct inconsistency: quote_converted carries a CONVERSION stage hint but is not in the conversion-type set. It can set the stage to CONVERSION while convertedAt remains null. The dashboard's stage breakdown and convertedAt-based count therefore do not necessarily use the same definition of conversion.

### 5.2 Backfill is destructive reconstruction, not proven semantic idempotence

For each Contact the method fetches CRM events, invoices, bookings and submissions, deletes all current journey touchpoints for that contact/business, and recreates selected facts one by one. It runs recomputation after every inserted touchpoint; there is no enclosing snapshot replacement transaction in the method. [S10]

The reconstructed representations differ from live inputs: form source comes from stored submission.source and metadata includes submissionId, whereas live uses lead_form and omits that ID; social events use a generic mapping; campaign/content fields are not restored into their typed columns; invoice reconstruction uses invoice.currency while the live invoice-paid listener hardcodes TTD. A comment saying idempotent does not prove these reconstructions preserve meaning or original lineage.

A failure after delete can leave a partial replacement. A concurrently appended live touchpoint can be deleted or interleaved depending on ordering. Original-only touchpoints not reproducible from the selected sources can be lost. These are method-level conditional sequences; deployed constraints, collection caps and all repair jobs remain to inspect. We do not claim a runtime data-loss incident or that original business invoices/submissions are deleted by this touchpoint reset.

### 5.3 Occurrence identity and partial recompute remain open

recordTouchpoint upserts the contact aggregate, creates a new touchpoint, then calls recomputeJourney. The source event's occurredAt is not supplied by the live record wrapper, so it defaults to processing time. Replayed events can receive different times and row IDs. recompute writes each weight separately and then the aggregate; failure can leave raw and derived records at different points.

No canonical occurrence/consumer-claim key appears in the shown input/write set. That is not yet proof no database constraint or upstream dedupe exists. Exact schema/producer identity is the next trace. In particular, payment.received, invoice.paid and store_order.paid are separate live listeners that can record valued conversion rows; whether a real payment produces more than one of them for the same contact must be traced before declaring actual double counting.

## 6. Attribution windows and financial value need separate identities

### 6.1 Lifetime value can be attributed into a historical conversion window

compute selects CustomerJourney records whose convertedAt lies in the requested period, includes all their touchpoints without an occurredAt filter, and multiplies the journey's totalRevenue by the stored first/last/linear weights. recomputeJourney sets convertedAt to the earliest matching conversion and totalRevenue to the sum of all matching valued conversion touchpoints. [S10/S11]

Static example, not a real customer report:

```text
requested reporting interval: days 1-30
first conversion: day 10, value 100
later conversion: day 40, value 200
all values use the same currency; assume valid supplied rows

journey.convertedAt = day 10
journey.totalRevenue = 300
compute(days 1-30) selects that journey and attributes 300,
including the day-40 value and day-40 touchpoint weights.
```

Conversely, a repeat conversion in the requested interval can be omitted when the contact's first conversion was before that interval. A cohort-lifetime-value report could intentionally behave this way, but then it must be labelled and bound to that definition. The inspected method and operator display do not supply an independent conversion-occurrence/window contract. We are not asserting causation can be proved by a first/last-touch model; attribution is a declared allocation model, not causal certainty.

Because last-touch weights are recomputed across the entire contact history, a later email/message/payment can alter last-touch credit for an earlier conversion. An event-specific lookback or cohort policy must be explicit; arrival/recompute time cannot silently redefine past evidence.

### 6.2 Stored attribution can retain stale buckets or mix periods

compute upserts only buckets that currently exist. It does not delete or retire buckets that disappear from the same requested period/model/dimension. A zero-result recomputation returns computed=0 without clearing prior stored results in this method. getResults can therefore still return a stale bucket. [S11]

getModelComparison chooses a period from the newest row, then filters its sampled rows by periodEnd only, not both periodStart and periodEnd. Distinct windows sharing an end time can enter the same byModel output. The take:500 limit and per-bucket writes further mean this query is not an explicit complete, atomic computation-generation selection. The 200-row results endpoint is bounded too; these are code limits, not measured population sizes.

The UI's Backfill action calls journeys/backfill and then reloads the dashboard; that endpoint does not recompute attribution results. The visible journey funnel can therefore be fresh while stored attribution is from a different basis. Recompute insights invokes a different service path that starts attribution.compute; later generation/AI enrichment was not fully traced here. [S12-S14]

### 6.3 Monetary labels promote different bases

The live invoice.paid listener records invoice.total but hardcodes currency:'TTD'. payment.received and store_order.paid preserve provided currency. recomputeJourney sums conversion values without separating currency or referencing FX provenance. Backfill uses the stored invoice currency but the aggregate still ignores that dimension. [S09/S10]

GrowthIntelligenceService.getChannelMix sums value across ALL touchpoint types in its recent window and returns it as revenue. quote_created supplies quote.total despite being a consideration touchpoint; quote_converted supplies invoice.total but is not a valued conversion type for the journey total. Consequently a same-currency quote_created of 500 followed by a single invoice-paid value of 500 can yield channelMix.revenue=1000 while journey.totalRevenue=500, absent other touchpoints. This is source-stage conflation, not a second actual payment. [S09/S13]

The KPI endpoint selects recent-first-conversion journeys, sums their conversionValue aggregate, and formats the result with TT$. The panel renders that label as Attributed revenue. The typed touchpoint currency, planned expectedRevenue, quoted value, invoiced value, actual money movement and attribution allocation cannot be treated as interchangeable. R1 already requires their separation; no second ledger is needed.

## 7. Preliminary ownership review, not canonical allocation closure

| Existing owner | J9 implication | Classification |
|---|---|---|
| J13/K9 current connector authority | A selected connected row or retained token is not a new blanket grant; every actual target attempt needs current use admission. | RETAIN; provider adapter/reconnect fencing not freshly audited here. |
| J18/REC048/K11 and J23/K7 | Manual/scheduled attempts need common effect identity, bounded claim/recovery and exact content/schedule revision. Returned failure is not publication; partial successes must not be resent as new effects. | REUSE architectural laws; detailed source-to-existing-finding comparison remains. |
| J5/REC057 and J14 ingress | Identified response/submission must retain original occurrence and per-consumer claim; Contact dedupe is not occurrence dedupe. | RETAIN actual R2 contract. J9 is a growth projection consumer, not a new conversation engine. |
| J7/REC052/K10 | Monetary basis, native currency, reporting conversion and source effect remain explicit. A quote value or allocation score is not collected revenue. | REUSE actual R1 layers; do not silently expand another F-number's proved source scope. |
| K4/K8 and J16/J17 | Backfill/recompute must preserve raw evidence and clearly version derived decisions; operator/AI recommendations must not learn from fabricated outcomes. | TARGET PRESSURE, not proven downstream Genome mutation in this tranche. |
| J8 completion/billing and J24 engineering safety | Changing model/variant cannot erase accepted source work, financial history or the evidence used to judge success; shadow comparison has no live effects. | RETAIN accepted contracts and their unclosed WD/ED/CS debts. |

No F/C/REC/concept is allocated. F228/C178 retains its time-billing meaning. Current range is through F228/C178/KF-REC-057/KF-CONCEPT-042; next free F229/C179/KF-REC-058. R3 was checked. Potential J9 roots are publication-outcome propagation and occurrence/window/value-lineage integrity; they need the next bounded comparison, not one catch-all new marketing finding.

## 8. Candidate integration requirements

These are working requirements, not an accepted final J9 target or code patch:

- Keep campaign intent, content revision and exact account/destination selection distinct from publication attempts and their provider evidence. Support partial outcomes explicitly and one accountable owner for a retry of the same target effect.
- Persist lead/response occurrence provenance before projecting it. Identity resolution, qualification and permission to follow up are separate decisions. Anonymous input can remain anonymous instead of fabricating a Contact or conversion.
- Use one event classification and valuation contract across live ingestion and replay. A booking state, quote event, invoice, money movement and repeat purchase have different semantics; reconstruction must not reinterpret them merely because a mapper uses a generic name.
- Define conversion occurrence or explicitly labelled cohort basis, eligible touchpoint window, model version, amount stage/currency and source outcome. Keep attribution a model allocation, not proof of marketing causation.
- Rebuild derived projections into an identified, complete computation generation while preserving raw lineage and concurrent arrivals. Replace/retire vanished result buckets; select full period/model/basis identity rather than the latest row's end date alone.
- Permit add/disable/replace/remove experiments under J24's contract. A new scoring/model variant must not send real messages/posts, rewrite original conversion history or merge incompatible monetary bases to produce attractive metrics.

These responsibilities should strengthen existing campaign/social/form/journey/commerce/evidence services. No replacement CRM, generic workflow engine, analytics vendor or new pricing stack is selected from this first trace.

## 9. Twelve local proof designs - all NOT_EXECUTED

| Case | Required isolated characterization / eventual acceptance |
|---|---|
| J9-X01 | No account, explicit unmatched targets and all failed results never claim publication or set firstPostPublished. Preserve current no-account refusal. |
| J9-X02 | Partial multi-account publishing preserves exact destination/content effect identities; retries do not repost successful targets or broaden connection IDs into unintended same-platform accounts. |
| J9-X03 | Reschedule/edit/cancel versus due selection and manual-versus-scheduler concurrency use current revision and one claim; crash recovery distinguishes unknown provider effect from definite failure. |
| J9-X04 | Lead capture preserves transactional tenant identity, original submission/source provenance and explicit anonymous/contact/qualified stages without inventing trusted campaign attribution. |
| J9-X05 | Live and backfilled booking/quote/payment histories yield the same declared conversion semantics; cancelled/future bookings are not silently promoted to monetary conversions. |
| J9-X06 | Quoted, invoiced, received and attributed value plus native/reporting currency remain distinguishable; quote 500 plus payment 500 is not automatically 1000 revenue. |
| J9-X07 | Same business occurrence received via replay or multiple event families has explicit consumer identity; source occurrence time is retained and partial weight/aggregate updates reconcile. |
| J9-X08 | Per-conversion or clearly labelled cohort windows handle day-10/day-40 values honestly; later touches do not silently rewrite earlier conversion credit under an undeclared model. |
| J9-X09 | Zero/changed attribution recompute retires stale buckets; reads select one complete generation and both period boundaries, with bounded result coverage disclosed. |
| J9-X10 | Backfill failure/concurrent ingress preserves recoverable source occurrence, campaign/content data and coherent live/rebuild classification instead of destructive unsupported reset. |
| J9-X11 | Dashboard backfill/recompute actions expose mixed freshness, missing identity and uncomputed metrics; no error/empty result is relabelled measured success. |
| J9-X12 | Candidate model/channel toggles preserve current authority and historical outcomes; shadow evaluation emits no real publication, message, invoice or conversion effects. |

There are 12 local J9 designs, zero bindings and no executed product results. They do not change the J13 44-case manifest or J8's 24-case inventory. The existing SocialService test source was read only: no-account regression assertions are useful, but its nominal success mock uses ok rather than the publisher's success field and does not test all-failed/no-match outcomes or real provider behavior. A test title saying publishes for real is not runtime/provider evidence. [S15]

## 10. Bounded closure and exact next action

Completed: J9 activation and this named campaign/publication/capture/journey/attribution trace, including concrete UI and gamification consumers and preserved positive seams. Not completed: J9 convergence; all campaign families, publisher adapters, schema/receipt constraints, ingestion dedupe, conversion identity, consent/qualification, full source-to-campaign joins, financial reconciliation and runtime proof.

Next: **J9_OCCURRENCE_ATTRIBUTION_AND_CHANNEL_CONSEQUENCE_TRACE**.

Produce `J9-MARKETING-LEAD-GENERATION-MICROTRACE-002.md` in this order:

1. Trace exact source occurrence/time/currency and schema keys for lead_form.submitted, payment.received, invoice.paid, store_order.paid and identified social response. Determine which events share one economic/response occurrence and which have distinct meanings; inspect actual constraint/consumer dedupe, not comments.
2. Trace named per-target publication receipts/claims and consumers of post.published versus social.scheduled.dispatched, plus existing campaign-to-post/form/content bindings. Inspect only adapters/callers needed for those claims; preserve current no-account refusal and scheduler CAS.
3. Compare the surviving publication and attribution candidates against actual canonical finding homes, then refine source/conversion/model/window/computation-generation ownership and migration needs. Preserve live/replay equivalence and reversible testing. Do not allocate by resemblance or declare J9 converged from this first document.

Do not repeat the campaign CRUD or default guard scan. Do not update the programme map or run its generator/check. Carry forward J13/J24/J8 contracts, ED1-ED5, CS1-CS5, WD1-WD5 and current F228/C178 allocation.

## 11. Reproducible source manifest

All source facts are pinned to `8f173bfe79f1418159cf4099ea18b0d60d203ec2`. Whole-file retrieval does not imply a fresh whole-module audit. Native source ranges/symbols below are the inspected scope.

| Ref | Path / scope | Blob |
|---|---|---|
| S01 | apps/server/src/modules/marketing/marketing.controller.ts; complete declared CRUD routes/guards | c300bee9369b93aa77dd2aa05d5cce4e05b4a6bd |
| S02 | apps/server/src/modules/marketing/marketing-campaign.service.ts; full | 56f35563fe01e42da50ab9325520197bb10441fb |
| S03 | apps/server/src/modules/social/social.service.ts; full | 7f70a8a88682461ae2ad919f83273ac09e6fd571 |
| S04 | apps/server/src/modules/social/social-publishing.service.ts; full | 8f815520838c52e0b0bec6cd71ad535357664997 |
| S05 | apps/server/src/modules/social/social-scheduler.service.ts; full | 99aa5d3fe167f70806e658ceef61fa856b3c0432 |
| S06 | apps/server/src/modules/social/social.controller.ts; create/update/delete/publish methods in fetched 280-570 range; OAuth content not treated as fresh lifecycle audit | 1bdb7eba9e8782e702a8933605ca8ea610725ded |
| S07 | apps/server/src/modules/lead-forms/lead-forms.controller.ts; full | 45922a70518673688a922d6bac623fe6480f59af |
| S08 | apps/server/src/modules/lead-forms/lead-forms.service.ts; full | 2e407bcbf537900b8babb443359e094a05111c60 |
| S09 | apps/server/src/modules/growth-intelligence/journey-listener.service.ts; full | f864b2ebba7a7026baf2f8653c5fc3e93aacb2e0 |
| S10 | apps/server/src/modules/growth-intelligence/customer-journey.service.ts; record/recompute/read/backfill and mappings; truncated tail completed with 330-end | 63997bc739195e117fd548e29aeae9b2776031c1 |
| S11 | apps/server/src/modules/growth-intelligence/attribution.service.ts; full | b200d45b0a08ee9ffcb8e5378da747901759be41 |
| S12 | apps/server/src/modules/growth-intelligence/growth-intelligence.controller.ts; full | ced92b032ee61d317cbe14ab2384791426992328 |
| S13 | apps/server/src/modules/growth-intelligence/growth-intelligence.service.ts; 1-235, dashboard/KPIs/channel mix and generateInsights entry only | ea743fc7a66c4c79f19a999fb87b9338b2fc8488 |
| S14 | apps/web/src/app/app/control-tower/components/growth-intelligence-panel.tsx; 1-255, API actions and KPI rendering | b585ecb6075984580a956a234c44bd16ab9379ba |
| S15 | apps/server/test/social.service.test.ts; full source; not executed | 115299b143e862fa645039a9a7d68edc2e19a1ed |
| S16 | apps/server/src/modules/social/social.module.ts; full registrations | d6e4c17de8bf3ba6a190404cc8528bcf8d845833 |
| S17 | apps/server/src/modules/growth-intelligence/growth-intelligence.module.ts; full registrations | ee2507276aeacc0b4de137ff246588d16fae5c0c |
| S18 | apps/server/src/modules/marketing/marketing.module.ts; full registrations | d1e33f3aa31a791b59ba6abd2904837c5f9d8d21 |
| S19 | apps/server/src/modules/gamification/gamification.listener.ts; full, specifically post.published consumer | 3b71d961fae8f3ab64028fe1466064bd97fa8719 |

R1: 10K/KF-REC-052, first 150 lines, blob 8d72fda595eba12b0e6384eceff02f0ecc72c585; its older internal implementation head is historical provenance. R2: 10P/KF-REC-057, first 155 lines, blob 7343f5bb8df87c3bae2f4763f40d0fa832c6914b. R3: 04B at input, current allocation/rules, blob f4506aa16bf0b52b63d7be4d286cb8305fcd5b44. Prior J13/J8/J24 accepted contracts and recovery/temporal relationships are retained from canonical current state/handoff and the continuing session, not newly runtime-proven here.

P1: supplied KEYFLOW v3 / Master Execution Blueprint, Social Intelligence module, Flow integration and section 6.3. Source prescribes real publication followed by business events and permits controlled adaptation. The actual code divergences, attribution examples and candidate requirements above are repository analysis, not claims stated or proved by P1. No current provider API compatibility or outside financial/legal rule is asserted; no external research was needed for these local source derivations.

## 12. Context integrity and publication boundary

Context integrity: **PASS FOR THIS BOUNDED J9 ACTIVATION**. Live intelligence head matched c8d1b24; AGENTS/AGENT-CONTINUITY, START/current state and both CURRENT/ROLLOVER pairs were loaded, with targeted tail reads for the large YAML. Main was independently observed at 88b8016 with the owner-halt commit; implementation reads stay at 8f173bf. Current permission and user map pause remain separate from historical forensic evidence. Existing execution packets remain unpromoted/unauthorized; their individual contents were not re-audited.

Default-branch search was used for path discovery, not as an alternate evidence baseline. A direct container raw-file download failed due to DNS and was not used as source evidence; all repository content reads and writes use the connected GitHub tools. No full checkout, secret inspection or application execution occurred. Git publication checks are documentation/persistence evidence only.

Publish this investigation, the new J9 dossier and matching canonical/handoff navigation in one intelligence-only checkpoint. Increment prior 21 dossiers by the newly created J9 dossier to 22/25 coverage, not app completion or a fresh maturity census. Prior investigations, all twelve kernel dossiers, numerical registers, J13/J8 proof inventories and the frozen programme map remain unchanged.
