# KeyFlowOS Current State

Checkpoint: `J9-M001-2026-09-16-01`  
Updated: 2026-09-16  
Status: **CANONICAL CURRENT PROGRAMME STATE**.

## Current position

**Completed:** J9_MARKETING_LEAD_GENERATION_ACTIVATION and [J9 Microtrace 001](investigations/J9-MARKETING-LEAD-GENERATION-MICROTRACE-001.md). The new [J9 dossier](journeys/KF-JOURNEY-009-MARKETING-LEAD-GENERATION.md) records scope, source findings, shared owners and remaining questions.

**Now:** J9_OCCURRENCE_ATTRIBUTION_AND_CHANNEL_CONSEQUENCE_TRACE. Planned `investigations/J9-MARKETING-LEAD-GENERATION-MICROTRACE-002.md` is not created here. J9 remains ACTIVE / NOT CONVERGED.

**Programme map remains frozen at J24-PA by user instruction.** No generator/check, output, preview, HTML/JSON, renderer or template was changed. CURRENT-STATE.yaml and these handoffs carry the current analysis. Scheduled cycles remain halted.

## What advanced

Nineteen named implementation files were examined at explicit full/partial scope. One existing SocialService test file was read, not run. The trace spans campaign-plan CRUD, manual/scheduled social dispatch, an actual gamification consumer, native lead-form capture, live/rebuilt journey records, attribution and the Growth Intelligence UI.

| Result | Exact interpretation |
|---|---|
| Failed publication can emit success-named event | Manual wrapper emits post.published after returned all-failed or unmatched-target results; gamification can mark firstPostPublished without checking the outcome. A thrown publish error is a different path. |
| Earlier no-account fix is present | No account and no explicit target correctly refuses without a fabricated POSTED state. Its regression assertions remain unchanged. |
| Manual/scheduled targets and events differ | Scheduler forwards stored targets and has a real status CAS; manual default uses connected accounts. Stored connection IDs become platform names after an attempt. Scheduled dispatch emits another event. |
| Lead capture has real safeguards | Public guard/sanitization declarations, active-form-derived business and contact/submission transaction exist. Contact reuse is not submission dedupe or qualification. |
| Live and rebuilt conversion definitions differ | Backfill's generic booking is a conversion type even for a cancelled booking; live booking_cancelled is consideration. The resulting zero-revenue conversion is not positive money invented by attribution. |
| Historical attribution can use later lifetime value | First-conversion date selects the journey, while lifetime totalRevenue and all touchpoints supply weights/value. Explicit cohort reporting would need an honest declared basis. |
| Value stages/currencies differ across projections | Channel mix sums quote values and payment values as revenue; invoice-paid live listener hardcodes TTD and journey aggregation ignores native currency. These do not prove extra money moved. |
| Stored results can outlive their computation basis | Upsert-only recompute does not retire vanished buckets; model comparison filters only periodEnd. UI backfill reload does not itself refresh stored attribution. |

Campaign planning and the actual publishing/capture services exist; this is not a finding that the whole funnel is absent. The source-to-campaign joins, all provider/ingress producers and schema identities are next-source questions.

## Concrete source-derived examples

A contact with a cancelled booking and no payment can move from live consideration to backfilled CONVERSION with zero revenue. Attribution.compute skips nonpositive revenue, so this example distorts classification rather than producing a positive monetary allocation.

A first conversion of 100 on day 10 plus another of 200 on day 40 yields lifetime value 300. A days-1-to-30 computation can select the journey by its first conversion and allocate all 300 using the full history. This may be a cohort-lifetime report only if explicitly declared; it is not equivalent to conversion-event revenue for that interval.

A quote_created value of 500 and one payment value of 500 can produce channelMix.revenue=1000 while the journey conversion total is 500. This is incompatible source-value classification, not evidence that two real payments occurred. All examples are static derivations, not customer incidents or executed fixtures.

## Ownership and convergence boundaries

Existing REC052/J7/K10 owns financial amount stage, currency and valuation. REC057/J5 and J14 own occurrence identity and consumer claims. J13 supplies current provider-use authority. J18/J23 govern partial effects, same-occurrence recovery and temporal ordering. K4/K8 govern evidence and learning admission. J8's accepted scope/allocation and J24's independent proof/withdrawal constraints remain intact.

The preliminary J9 direction is exact campaign/content/target and occurrence identity, common publication outcomes, live/replay classification parity and an explicitly versioned conversion/model/window basis. Derived reports should not overwrite raw history or retain vanished buckets as current evidence. These are working requirements, not a final J9 target, new analytics engine or authorized code patch.

No new finding/contradiction/recommendation/concept was allocated. F228/C178 keeps its J8 time-billing meaning. Ranges remain F228/C178/KF-REC-057/KF-CONCEPT-042; next free F229/C179/KF-REC-058. The actual REC052/REC057 and 04B were checked; full J9 candidate-to-finding comparison is not yet complete.

## Counts, proof and retained history

The new J9 dossier increments prior 21 to **22/25 dossier coverage (88%)**, not application completion or a new portfolio maturity census. J20/J21/J22 remain dossierless; twelve kernel dossiers are unchanged.

J9 has **12 local designed cases**, zero bindings, NOT_EXECUTED. J8's separate 24 designs and J13's 44-case manifest are unchanged. No application/provider/database/boot/concurrency/migration test or harness was added/executed. Prior source evidence, numerical registers and mature pools are not rewritten.

J8 named-core alignment and WD1-WD5, J13 alignment and ED1-ED5, J24 alignment and CS1-CS5 are preserved in machine state. Detailed hosting observations remain prior J24 evidence; the main head/summary was reconfirmed, not a new exhaustive settings audit.

## Coordinates and exact next work

```text
Repository: SaCH-PRO/KEYFLOWOS
Branch: docs/keyflow-intelligence-foundation
Input: c8d1b24f655956615f0d197d9068a2df24f20200
Forensic baseline: 8f173bfe79f1418159cf4099ea18b0d60d203ec2
Main head separately reconfirmed: 88b8016c0ef45e383cc5b0d98c7062151a6a0f27
Production: READ-ONLY / UNAUTHORIZED
Scheduled cycles: HALTED
Map refresh: PAUSED UNTIL EXPLICIT USER REQUEST
```

Resolve actual output head and matching checkpoint, not input as output. All substantive source work used pinned GitHub reads. No application launch or provider operation occurred; Git publication verification is not product proof.

Next, establish exact source event/schema occurrence/time/currency and economic overlap, trace per-target publication receipts/claims and event consumers, then complete bounded candidate comparison and refine conversion/model/window/computation-generation ownership. Do not repeat campaign CRUD or the default guard scan. Preserve known positives and do not assert real payment double counting before tracing the relevant producer/constraint chain. Persist substantive results and matching continuity without touching the frozen map.
