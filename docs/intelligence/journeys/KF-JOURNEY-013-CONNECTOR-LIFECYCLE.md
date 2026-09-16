# KF-JOURNEY-013 - Connector Lifecycle

Status: **PROVISIONALLY TARGET-ALIGNED - MAPPED CORE ONLY / IMPLEMENTATION NOT PROVEN**  
Activated: 2026-09-10  
Checkpoint: `J13-ACM-2026-09-16-01` (2026-09-16)  
Implementation forensic baseline: `8f173bfe79f1418159cf4099ea18b0d60d203ec2`  
Primary kernels: K9 Integration & External Reality; K7 Temporal / Event / Workflow; K11 Recovery & Reliability  
Secondary: K1, K3, K5, K8  
Adjacent journeys: J5, J14, J18, J2, J15, J12, J24.

Production source/schema/deployment remains READ-ONLY / UNAUTHORIZED. Application/provider/concurrency/migration tests are NOT_EXECUTED. The entire provider estate is not declared converged.

## Definition and current result

J13 is the lifecycle through which a business grants, proves, uses, observes, degrades, revokes and re-establishes authority for an external integration. It connects configuration, current authority, credentials/account identity, scope/readiness, ingress, polling, outbound effects, refresh, disconnect, residual evidence, reconnect and recovery.

It does not replace J14 ingress occurrence ownership, J2/J15 governance, J18 recovery or J5 conversation processing.

The completed [Adapter Conformance and Migration Map](../investigations/J13-ADAPTER-CONFORMANCE-AND-MIGRATION-MAP.md) resolves Q1-Q4 at declared source/design scope and gives the mapped core provisional target alignment. The [Lifecycle Authority Contract Candidate](../investigations/J13-LIFECYCLE-AUTHORITY-CONTRACT-CANDIDATE.md) remains the single home of D01-D10/T01-T13. The map is its bounded acceptance and migration overlay, not a replacement state machine.

## Single evidence chain

| Artifact | Responsibility |
|---|---|
| [Microtrace 001](../investigations/J13-CONNECTOR-LIFECYCLE-MICROTRACE-001.md) | Initial lifecycle/state and credential/health seams |
| [Microtrace 002](../investigations/J13-CONNECTOR-LIFECYCLE-MICROTRACE-002.md) | Post-disconnect participation and activity resurrection; apply later legacy-fallback corrections |
| [Microtrace 003](../investigations/J13-CONNECTOR-LIFECYCLE-MICROTRACE-003.md) | Expiry, provider revocation and reconnect-generation analysis |
| [Microtrace 004](../investigations/J13-CONNECTOR-LIFECYCLE-MICROTRACE-004.md) | Stale OAuth connect intent and split Drive lifecycle ownership |
| [Separate callback/legacy supplement](../investigations/J13-SUBSCRIPTION-CALLBACK-LINEAGE-AND-LEGACY-CREDENTIAL-SUPPLEMENT.md) | Provider first-arrival lineage, teardown limits, QB/Xero fallback correction |
| [BCR](../investigations/J13-BOUNDED-CONVERGENCE-REVIEW.md) | W01-W18 writer/nonwriter inventory, bounded independent M004 comparison, G01-G14 |
| [LAC](../investigations/J13-LIFECYCLE-AUTHORITY-CONTRACT-CANDIDATE.md) | D01-D10/T01-T13, 32 analytical counterexamples and external guarantee limits |
| [Conformance/migration map](../investigations/J13-ADAPTER-CONFORMANCE-AND-MIGRATION-MAP.md) | Real owner/key/authority/transaction boundaries, Q1-Q4 closure, I0-I5 integration and R01-R12 reversible testing |
| [Test-design manifest](../investigations/J13-INTEGRATION-TEST-MANIFEST.yaml) | 44-case machine inventory and slice dependencies; no executable bindings/harness |

The microtraces, supplement, BCR and LAC remain unchanged. M004 is not overwritten by SUP. Current next-action navigation belongs to CURRENT-STATE.yaml, not an older artifact's historical stop point.

## Current implementation facts and qualifications

F227/C177 remains the inherited root: recorded disconnected state is not universally a load-bearing revocation of provider participation. BCR's independent M004 comparison is SPECIALIZATION / REFINE, with stale OAuth intent and split Drive ownership retained as distinct obligations.

WhatsApp retained mappings and same-page Meta recreation allow conditional old first arrivals under still-valid provider verification. Meta shared routing without a mapping is a positive boundary. Scoped tenant binding remains independent from a valid signature.

Stripe/PayPal activity can set status connected without reconnect. The source supports status writes, not an invented literal healthStatus field. Legacy Stripe still performs direct mutations despite its forwarding comment; retaining its URL cannot justify a parallel business processor. Historical settlement/refund evidence may need bounded reconciliation without fresh-effect authority.

QB/Xero central credential deletion can leave usable legacy values. Preserve conditional fallback participation, Xero's central tenantId guard and the central-only blocking seam. Actual tenant credential possession and authenticated accounting-provider callbacks were not established.

The shared Google helper can restore access/expiry after an intervening disconnect but not refresh. Its next invocation still requires refresh. **Fresh cross-path refinement:** dedicated Drive can subsequently return the restored unexpired access token without refresh, so that distinct consumer must also enforce current grant authority. This is conditional source reachability, not an executed provider incident or universal Google availability.

Gmail completion can write connected/intake/cursor while returning individual-message errors. Shared smoke success, webhook-info secret creation, late monitor failure and suite callback commits need their separate D/T roles. Shared activity logging and the monitor's own success branch remain direct nonwriters of lifecycle authority.

BusinessGuard supplies business access, not a current manage-connectors decision; reuse the generic authority owner. Prisma tenant/encryption and per-model write hooks are real seams but not universal transaction/current-authority proof. Existing contexts, raw SQL, nested writes and transaction propagation require characterization. Gmail/Drive watches and real remote cleanup remain unestablished, not globally absent.

## Selected target and integration consequences

Current grant, credential version, pending intent, intake policy, cursor, health and remote authorization scope are separate. Configuration/health/activity success cannot grant authority. All named lifecycle entrypoints use one logical transition owner across existing adapters.

T05 consumes current intent and actor authority. T06 terminally revokes the exact grant and cancels applicable intents. T07 fences same-grant credential rotation. T08 records observations without regranting. T09 shares a current-authority commit order with local domain consequences. T10 records a bounded exact external attempt; local revoke cannot promise retroactive cancellation. T11 reconciles historical effects without issuing fresh effects. T12 protects shared remote dependencies and N+1 from old cleanup.

An occurrence's origin remains old/unknown where that is all the evidence supports; present bounded adoption is a separate decision. Local Drive-only disconnect is not automatic permission for broad provider OAuth revoke. Removing a feature must not erase those distinctions.

The map orders I0 environment/proof isolation -> I1 compatible storage -> I2 lifecycle/credential authority -> I3 local consumers/projections -> I4 external effects/cleanup -> I5 UX/rollout, with explicit dependencies and withdrawal behavior. Unsupported feature combinations reject activation. Shadow comparison has no live effects; one effect owner and retained business truth survive switches.

## Backward re-audit / kernel reinjection

| Owner | Retained or refined obligation |
|---|---|
| K9 / J13 | One lifecycle authority; exact account/use and remote-scope relationships; all named credential consumers protected, not only the helper |
| K7 / K6 | Transaction client and expected coordinates reach actual writes; delayed success/error cannot overwrite a later grant or intake/cursor policy |
| K11 / J18 | Stable occurrence/effect/attempt identity across variants and compatibility routes; honest external/cleanup uncertainty; no blind replay or fake undo |
| J14 | Authenticate/bind/claim before normal consequences; J13 use decision does not replace ingress ownership |
| J5 | One processing policy and consumer claim; optional removal does not resurrect or duplicate effects |
| J2 / J15 / J25 | Current management/action authority and control evidence; no alternative role engine |
| J12 / K4 / K8 | Historical adoption and code rollback cannot rewrite source revision, provenance or business outcome truth |
| J17 | Surface unavailable/partial/cleanup-pending/in-flight states truthfully |
| J24 | Next activation: source-grounded safe experimentation and proof/environment ownership, preserving existing OS/gates |

No new parallel runtime is selected. Kernel definitions and previous reinjection remain intact; this dossier and the conformance map carry the latest cross-owner application.

## Q1-Q4 closure and remaining scope

Q1 closes the named entity/key/guard/transaction map, not all physical schema design. Q2 closes source/design Google relationships, not deployed grants. Q3 closes named callback/cleanup responsibilities, not remote registration discovery. Q4 provisionally aligns only that mapped core.

G07 remains a design pass with external limits. G08 is a source-to-design migration map; final DDL is not done. G13 is PROVISIONALLY_TARGET_ALIGNED_MAPPED_CORE_ONLY. G04 exhaustive coverage, G09 actual remote evidence, G12 executed proof and G14 authorization remain unclosed.

ED1 schema/account/claim reuse and migration details; ED2 unmapped adapters/workers/readers; ED3 actual remote registrations/dependencies; ED4 executable bindings/harness/results; ED5 later-baseline comparison before execution. These are explicit prerequisites, not evidence that the existing source is fixed.

All 44 cases are designed and mapped. The only executed validation is an offline design-metadata consistency check: unique IDs, complete slice mapping, no dependency cycle. It did not execute application/provider code. The manifest is not a runnable harness.

F228/C178/KF-REC-058 remain unallocated. No new concept allocation is made. J5 and broader pools remain reopenable and retained.

## Reopen rules and next frontier

Reopen the exact J13 invariant if a new adapter bypasses it, schema/claim composition cannot enforce it, provider scope contradicts cleanup assumptions, a runtime/migration case fails, or a later journey/baseline provides contrary evidence. Do not restart the entire provider scan just because another chat resumes.

Next programme action: **J24_ENGINEERING_SAFETY_AND_REVERSIBLE_TESTING_ACTIVATION**, from the concrete Vitest/GrowthBook/OS observations and I0/R01-R12 in the map. J24's dossier is planned, not created here. Runtime/prod authorization remains separate.

## Historical dossier preservation

This live dossier consolidates current navigation and accepted scope instead of repeating superseded opening state models and next-work lists. The complete prior opening/history sections remain available at the [LAC checkpoint](https://github.com/SaCH-PRO/KEYFLOWOS/blob/2b177c772036eee83c24b79ee649d99fd3a2dba1/docs/intelligence/journeys/KF-JOURNEY-013-CONNECTOR-LIFECYCLE.md), with detailed evidence preserved in the unchanged microtraces/SUP/BCR/LAC above. This is an explicit navigation consolidation, not a claim that the earlier hypotheses were all correct or a deletion of their evidence.
