# KF-JOURNEY-009 - Marketing / Lead Generation

Checkpoint: `J9-M001-2026-09-16-01`  
Activated: 2026-09-16  
Status: **ACTIVE / FIRST NAMED SOURCE TRACE COMPLETED / NOT CONVERGED**  
Intelligence input: `c8d1b24f655956615f0d197d9068a2df24f20200`  
Implementation forensic baseline: `8f173bfe79f1418159cf4099ea18b0d60d203ec2`.

Existing customer-to-revenue constellation: J9/J3/J5/J10/J21/J7. Primary kernels: K7 Temporal/Event/Workflow, K8 Evidence/Outcome, K9 Integration/External Reality, K10 Financial Truth. Secondary: K1/K3/K4/K5/K6/K11/K12. Adjacent J13/J14/J16/J17/J18/J23/J24/J8.

Production source/schema/settings/workflows/assertions remain read-only. No app/provider/database/boot/concurrency/migration tests ran. Scheduled owner-halted cycles stay halted. The programme map remains frozen at J24-PA; no renderer/check/output modification.

## 1. Definition and product intent

J9 follows campaign intent into content and authorized publication, audience response, identifiable capture, qualification, conversation/commercial outcomes and evidence-based attribution/learning.

```text
campaign plan != generated content != scheduled intent != actual publication
!= observed engagement != identified lead != qualified lead
!= conversion occurrence != model attribution != collected/reconciled revenue
```

The supplied blueprint intends real SocialPost publication and a post.published event as an input to seamless business Flow. The current source contains useful campaign, social, form and growth components, but their classifications and evidence must agree. Historical sample services and claimed flawless outcomes are not current implementation proof.

## 2. Completed source trace

[Microtrace 001](../investigations/J9-MARKETING-LEAD-GENERATION-MICROTRACE-001.md) is the evidence home: nineteen named source files with explicit scopes, including one unexecuted source-test file and a concrete dashboard UI/consumer trace. It covers MarketingCampaignPlan CRUD, manual/scheduled social publishing, gamification, native lead forms, live and backfilled journeys, attribution and the Growth Intelligence display.

Not fully traced: email/paid-ad/campaign variants, publisher internals, all response producers, exact schema occurrence constraints, consent/qualification, complete campaign joins, reporting-generation recovery and every downstream learning consumer. No whole-funnel absence or convergence claim is made.

## 3. Actual source chain and consequences

| Boundary | Evidence-supported result |
|---|---|
| Campaign planning | Scoped CRUD stores plan/status/budget/expectedRevenue; these writes do not themselves publish or establish observed revenue. No global absence of campaign executors is asserted. |
| Manual publication | No account/no explicit target correctly refuses. A different branch emits post.published after returned all-failed or unmatched-target results. A thrown publisher error is not that branch. |
| Per-channel result | Detailed publishResults survive, but anySuccess maps the whole post to POSTED and first-success external reference. Aggregate success is not proof every intended target completed. |
| Target identity | Manual publish without request IDs uses connected channels rather than stored post IDs; scheduler forwards stored IDs. The publisher later writes used platform names into channelIds. Account-specific retry identity needs review. |
| Scheduler | Due selection and status CAS are real. Claim does not bind selected due time/content revision; rescheduling while still SCHEDULED can leave a stale claim. Manual publish does not share that status gate. |
| Downstream consequence | Gamification trusts post.published and can set firstPostPublished after the failed manual path. Scheduled dispatch emits a different event, so that named listener is not notified by the shown scheduled path. |
| Native lead form | Public guards/sanitization, active-form-derived tenant and contact/submission transaction exist. Contact reuse is not submission dedupe; no-email capture may remain unlinked. |
| Live journey input | Form/source/submission/campaign/content identity narrows; anonymous social engagement is intentionally skipped. Identified response is not automatically a qualified lead. |
| Live versus backfill | Live booking_created/cancelled uses consideration; backfill's generic booking is counted as conversion even when cancelled. Quote conversion can set a stage without convertedAt. |
| Reconstruction | Backfill deletes touchpoints and rebuilds selected sources nonatomically; source mappings differ and typed campaign/content linkage is not preserved by the shown mappers. Original business records are not deleted by that touchpoint reset. |
| Attribution | First convertedAt selects the cohort, while lifetime totalRevenue and all touchpoint weights supply allocation. Historical periods can include later value and omit repeat conversions from older contacts. |
| Stored reporting | Upsert-only recompute leaves vanished buckets; model comparison filters periodEnd but not periodStart. Backfill then dashboard reload can combine fresh journeys and older attribution. |
| Financial labels | Invoice-paid live listener hardcodes TTD; aggregate ignores native currency. Channel mix sums quote values as revenue along with payment values, while journey total uses a different type filter. |

All conditional failure sequences remain static source analysis, not customer incidents or executed tests. The detailed trace separates known inputs, missing deployment/producer evidence and target implications.

## 4. Concrete analytical examples

An unpaid cancelled booking rebuilt as generic booking can become CONVERSION with zero revenue; attribution.compute skips nonpositive-revenue journeys, so the example does not invent positive money.

A first conversion of 100 on day 10 and another of 200 on day 40 gives lifetime value 300. A days-1-to-30 attribution computation can select that journey by day 10 yet attribute 300 using all touchpoints. A cohort-lifetime report could deliberately choose that basis, but it must not silently present it as event-period conversion revenue.

A quote_created touchpoint valued 500 plus one payment valued 500 can sum to channelMix.revenue=1000 while journey.totalRevenue is 500. That is incompatible value-stage projection, not a second actual payment. These examples use one currency to isolate the classification/window issue from the additional FX problem.

## 5. Existing strengths and shared owners

Keep no-account refusal/tests, connected-channel filtering, detailed publication results, bounded scheduler selection and compare-and-set, public form guards, tenant-derived contact/submission transaction, anonymous-response non-attribution, explicit attribution model names and authenticated growth routes. Do not reintroduce false success or replace existing components because their composition needs stronger contracts.

KF-REC-057/J5 and J14 retain canonical response occurrence and consumer ownership. J13 supplies current provider-use authority. J18/REC048 and J23 own attempt/recovery/temporal semantics, including partial channel success. J7/REC052/K10 requires amount stage, currency and valuation evidence. K4/K8 own evidence and learning admission. J8 and J24 preserve exact source history and reversible, independently evaluated experimentation.

Preliminary integration requirements: exact campaign/content/target and occurrence identity; one common publication outcome consumed by all entrypoints; live/replay classification parity; explicit per-conversion or labelled cohort windows; preserved raw evidence plus atomic/versioned derived computation generations; no monetary label stronger than its basis. This is not yet a final J9 contract, physical schema, new analytics vendor or parallel conversation/workflow/ledger engine.

## 6. Allocation, proof and status

No new F/C/REC/concept allocation. F228/C178 still means the J8 source-time billing loss; next free F229/C179/KF-REC-058. Actual REC052/REC057 and 04B were checked; full source-candidate-to-register comparison is next, not falsely declared complete.

J9-X01-X12 are twelve local designed cases, zero runner bindings, NOT_EXECUTED. J13's 44-case manifest and J8's 24 designs remain separate and unchanged. The SocialService test file was read, not run; its mock delegation success is not provider evidence.

J9 activation/first trace is complete; J9 convergence remains open. Creating this dossier increments prior 21 to 22/25 dossier coverage, not app completion or a new portfolio maturity census. J20/J21/J22 remain without dedicated dossiers. Twelve kernel dossiers and all prior bounded alignments/debts are retained.

## 7. Exact next action

**J9_OCCURRENCE_ATTRIBUTION_AND_CHANNEL_CONSEQUENCE_TRACE**.

Planned, not created here: `investigations/J9-MARKETING-LEAD-GENERATION-MICROTRACE-002.md`.

First establish exact event/schema occurrence identity, economic overlap and source time/currency for the named form/payment/order/social producers. Then trace per-target publication claim/receipt and post.published versus scheduled-dispatched consequences plus actual campaign-to-content bindings. Finally compare surviving publication/attribution candidates with canonical homes and refine source/model/window/computation ownership and migration. No repeat of the campaign CRUD/guard scan and no premature J9 convergence or F-number allocation.

Keep the fixed baseline, production read-only boundary, current owner halt and map pause. Persist substantive results and matching CURRENT/ROLLOVER navigation without modifying the frozen map or earlier evidence.
