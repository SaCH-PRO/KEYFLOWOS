# J13 Supplement - Subscription Cleanup, Callback Lineage and Legacy Credential Fallback

Status: COMPLETE BOUNDED STATIC TRACE RECORD / J13 NOT YET CONVERGED
Persistence checkpoint: 2026-09-16
Implementation evidence baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Intelligence branch: `docs/keyflow-intelligence-foundation`
Pre-checkpoint intelligence head: `0f7000d6c141e2296ec923f6d9105bd6f7841891`
Production implementation: READ-ONLY / UNAUTHORIZED
Runtime/provider tests: NOT EXECUTED

## 1. Provenance, scope and naming collision

This artifact preserves the provider/callback source-analysis tranche and credential-fallback correction recorded in the preceding conversation. That tranche recorded reads of the pinned credential service, QuickBooks/Xero operation/activity paths, and the provider sources listed below. This persistence-only checkpoint does not claim to repeat those source reads, perform live provider inspection, or execute application tests.

The conversation had attempted to save this analysis as `J13-CONNECTOR-LIFECYCLE-MICROTRACE-004.md`. Reading the actual branch on 2026-09-16 established that this path already contains a different, valuable trace: **Stale OAuth Connect Intent and Split Drive Lifecycle Ownership**. That existing file is preserved, not overwritten or renumbered. This supplement is the durable home for this conversation's additional analysis.

It completes a bounded source-analysis unit, not the entire J13 journey or a complete provider subscription/status-writer inventory. Distinguish IMPLEMENTATION FACT RECORDED BY TRACE, CONDITIONAL STATIC REACHABILITY, TARGET PROPOSAL and NOT ESTABLISHED. Source reachability is not an executed regression test, evidence of current production tenant configuration, or a demonstrated provider incident.

`N` and `N+1` denote conceptual local grants. They are not authenticated fields established to exist in provider payloads. An event can predate disconnect in a controlled fixture without carrying a cryptographically authenticated KeyFlow grant generation.

## 2. Result and allocation boundaries

For the mechanisms recorded in THIS supplement, reuse **F227/C177**. No F228/C178/KF-REC-058 allocation is made.

- WhatsApp retains routing configuration after connector disconnect. An app-authentic, previously unseen event for the same retained phone mapping can reach normal processing without a lifecycle-generation check.
- Meta social deletes local connection rows, providing a useful shared-route boundary. Recreating the same page mapping makes an otherwise valid old event routable again; the legacy tenant-scoped route does not require a SocialConnection lookup.
- Stripe/PayPal callbacks carry provider verification and payment identity, not persisted local grant lineage. Historical payment reconciliation is not inherently unauthorized. Separate it from status resurrection and permission for new effects.
- QuickBooks/Xero centralized credential deletion is not complete credential removal when legacy Business metadata survives. Conditional post-disconnect provider participation and status resurrection are reachable through credential fallback.
- Active Gmail/Drive watch registration and authenticated QuickBooks/Xero callback paths were not established. Do not manufacture callback findings from metadata or emitter names.

These specialize the existing lifecycle-revocation root. This classification does NOT settle the distinct stale-OAuth-intent/split-Drive-ownership candidate in the existing Microtrace 004. Its canonical-register anti-duplication remains open.

## 3. Pinned source inventory

Paths are relative to the repository at the implementation baseline above. Symbol references identify evidence boundaries recorded by the preceding trace, not runtime coverage or a new source reread in this checkpoint.

| Ref | Source | Relevant symbols |
|---|---|---|
| S1 | `apps/server/src/core/connectors/implementations/whatsapp.connector.ts` | `disconnect`, `healthCheck` |
| S2 | `apps/server/src/modules/whatsapp/whatsapp.controller.ts` | shared/scoped webhook, signature verification, phone mapping |
| S3 | `apps/server/src/modules/whatsapp/whatsapp.service.ts` | `saveConfig`, `receiveInbound` |
| S4 | `apps/server/src/core/connectors/implementations/meta-social.connector.ts` | `disconnect` |
| S5 | `apps/server/src/modules/social/social.controller.ts` | shared/scoped webhook and tenant lookup |
| S6 | `apps/server/src/modules/social/social-connections.service.ts` | `upsertConnection`, `deleteConnection` |
| S7 | `apps/server/src/modules/social/meta-social-ingestion.service.ts` | message dedupe and ingestion consequences |
| S8 | `apps/server/src/modules/webhooks/webhooks.controller.ts` | legacy Stripe callback; separate outbound business-webhook CRUD |
| S9 | `apps/server/src/modules/payments/payments.service.ts` | Stripe/PayPal verification, event claims, capture/refund reconciliation |
| S10 | `apps/server/src/core/connectors/implementations/stripe.connector.ts` | disconnect and activity writer |
| S11 | `apps/server/src/core/connectors/implementations/paypal.connector.ts` | disconnect and activity writer |
| S12 | `apps/server/src/core/connectors/connector-credentials.service.ts` | `clearCredentials`, `readCredential`, `setCredentials` |
| S13 | `apps/server/src/core/connectors/implementations/quickbooks.connector.ts` | credential fallback, smoke test, outbound guards, activity writer |
| S14 | `apps/server/src/core/connectors/implementations/xero.connector.ts` | credential fallback, smoke test, `xeroHeaders`, activity writer |
| S15 | `apps/server/src/core/connectors/implementations/gmail.connector.ts` | webhook metadata, token-gated operations, disconnect |
| S16 | `apps/server/src/core/connectors/implementations/google-drive.connector.ts` | webhook metadata, direct credential clearing |

Canonical context: `../journeys/KF-JOURNEY-013-CONNECTOR-LIFECYCLE.md`, Microtraces 001-004, and `J5-J14-J15-J18-J13-J22-J2-J16-J17-CONVERSATION-ACTION-BACKWARD-REAUDIT.md`. No register entry is added or renumbered by this checkpoint.

## 4. WhatsApp: retained mapping and reconnect indistinguishability

IMPLEMENTATION FACT RECORDED BY TRACE (S1-S3): connector disconnect records disconnected status but leaves the business WhatsApp configuration. Configuration saving overwrites current configuration rather than creating an authority generation. The shared callback verifies the application signature, resolves the business through `phoneNumberId`, and calls `receiveInbound` without a connector-generation predicate. Normal staff/customer processing is reachable. Duplicate detection is not an old-grant revocation check for a previously unseen occurrence.

CONDITIONAL STATIC REACHABILITY:

```text
phone P / conceptual grant N
-> provider-authentic event E exists and has not been processed
-> disconnect records status only
-> configure the same phone P again (conceptual N+1)
-> E arrives while its applicable signature remains valid
-> signature and phone mapping pass
-> normal inbound processing is reachable
```

Reconnect is not necessary while the retained mapping remains. This does not prove acceptance after secret rotation, for a different provider destination, or outside applicable provider verification rules. Actual redelivery timing was not tested.

## 5. Meta social: local deletion is useful, but not grant lineage

IMPLEMENTATION FACT RECORDED BY TRACE (S4-S7):

`MetaSocialConnector.disconnect` deletes Facebook/Instagram SocialConnection rows and records disconnected status; the inspected method does not invoke provider unsubscribe. The shared callback authenticates the app signature and looks up platform/page identity. Without a matching row it returns unrouted. Preserve that positive seam.

`upsertConnection` updates or recreates the current mapping. After the same page P is mapped again, a previously unseen old event for P with a still-valid app signature can again reach ingestion. A newly generated database row ID is not a callback generation boundary when admission never consumes it.

The scoped `/social/webhook/:businessId` route checks signature and business existence without requiring the same connection lookup. Deleting the connection therefore does not establish an equivalent boundary for that route. Ingestion dedupe handles previously processed messages, not revoked authority for first arrivals.

Classification: F227/C177 specialization; scoped-route trusted tenant binding remains J14-owned. Provider-side subscription teardown, different-account reconnect behavior and a cross-tenant production incident are NOT ESTABLISHED.

## 6. Payments: retain historical evidence without restoring authority

IMPLEMENTATION FACT RECORDED BY TRACE (S8-S11): Stripe/PayPal connector disconnects do not remove provider verification configuration in the inspected methods. Their callbacks use endpoint/app verification and invoice/payment correlation, not a persisted connector grant generation. PayPal successful capture handling and the legacy Stripe callback can invoke connector activity writers that set `status: connected` without explicit reconnect.

CONDITIONAL STATIC REACHABILITY: with unchanged applicable verification configuration, a previously unseen old payment event can be accepted after disconnect/reconnect. Rotated endpoint secrets or changed PayPal app/webhook configuration may instead reject it. Universal acceptance across changed credentials is not proved.

TARGET PROPOSAL:

```text
verified historical settlement/refund evidence
-> trusted tenant/account/existing-effect correlation
-> controlled, idempotent reconciliation of that existing effect
-> preserve historical provenance or explicit lineage uncertainty
-> never reconnect a revoked binding as a side effect
-> never grant permission for a fresh outbound effect from this callback alone
```

Rejecting every late callback could lose legitimate evidence for work initiated before disconnect. Conversely, a valid callback must not authorize arbitrary new work. J14 retains authentication/durable admission ownership, J18 retains recovery/certainty ownership, and J2/J15 retain new-action authority.

The business Webhook CRUD in S8 is KeyFlow-to-customer outbound delivery. It is not evidence of provider-to-KeyFlow subscription cleanup.

## 7. Correction to Microtrace 002: legacy credentials survive central deletion

IMPLEMENTATION FACT RECORDED BY TRACE (S12): `clearCredentials` removes `ConnectorStatus.metadata.encryptedCredentials` and records disconnected. It does not delete `Business.metaData` legacy values. `readCredential` falls back to the supplied legacy metadata key when the central value is missing; it does not disallow fallback because the connector is disconnected.

### QuickBooks

IMPLEMENTATION FACT RECORDED BY TRACE (S13): health/isConnected, smoke test, and material provider operations read token/realm through that fallback. Successful smoke-test/read activity reaches a writer that sets `status: connected`.

```text
usable legacy quickbooksAccessToken + quickbooksRealmId
-> clear central credentials / record disconnected
-> readCredential returns legacy token and realm
-> isConnected can return true
-> smokeTest or listChartOfAccounts can attempt the provider call
-> successful response reaches trackActivity
-> connected status is written without explicit reconnect
```

`pushInvoice` also uses the fallback. Its apparent connectedness guard is not a revocation guard; an actual successful push additionally needs valid domain data, customer linkage and provider responses. No live write was attempted.

### Xero

IMPLEMENTATION FACT RECORDED BY TRACE (S14): after central clearing, `smokeTest` can read a surviving `xeroAccessToken`, call `GET /connections`, and on success invoke `trackActivity`, which writes connected status.

Do not generalize this to every Xero write: the inspected `xeroHeaders` requires a centralized `tenantId` without a legacy-key fallback, so clearing that value can still block tenant-specific writes. Environment test-token health fallback alone is not proof of usable provider credentials.

Classification: conditional function-level source reachability under F227/C177. Current tenant possession of these legacy fields was not inspected. QuickBooks/Xero provider callback reachability remains NOT ESTABLISHED.

This supersedes the blanket interpretation in Microtrace 002 that central clearing necessarily blocks ordinary participation. Central-only installations with no usable fallback retain a real credential-blocking seam.

## 8. Bounded cleanup inventory

| Adapter | Inspected disconnect | Provider teardown evidence | Result |
|---|---|---|---|
| WhatsApp | status only; retained mapping | no call in inspected method | conditional stale first-arrival processing |
| Meta social | local connection deletion + status | no call in inspected methods | shared route blocks absent mapping; same-page reconnect restores lookup |
| Stripe | status only | no call in inspected method | payment identity/verification without local grant generation |
| PayPal | status only | no call in inspected method | current configured verification without historical local grant lineage |
| Gmail | business OAuth token clearing + status | active watch registration not established | no stale callback claim |
| Drive | direct clearing of email/access/refresh/expiry + status | active watch registration not established | no stale provider-event callback claim here; see Microtrace 004 for OAuth response race |
| QuickBooks | central encrypted store clearing | callback registration/teardown not established | conditional legacy-token operation path |
| Xero | central encrypted store clearing | callback registration/teardown not established | conditional legacy-token smoke-test path |

The inspected Gmail/Drive adapters declare `supportsWebhook: false`; that does not prove repository-wide absence of alternate watches. Likewise `supportsWebhook: true`, comments, and emitter method names do not establish a mounted authenticated callback route.

Live dashboards, actual remote grant revocation, a full provider subscription inventory and an exhaustive status-writer inventory were not established. These remain explicit review/acceptance gates, not inferred defects or completed work.

## 9. Exactness corrections and limits

The inspected payment/accounting activity mutation is `status: connected` plus sync bookkeeping. Earlier `connected/healthy` shorthand must not be read as evidence that a literal `healthStatus: healthy` field was written.

At the pinned baseline, `GoogleDriveConnector.disconnect` clears Business credentials directly; do not describe it as delegating to GoogleDriveService. The existing Microtrace 004 separately traces the service route and its missing shared-status update.

Clearing stored credentials does not recall a token already copied into in-flight work. Fencing that work is a proof obligation, not an executed race result here.

An app-valid signature does not identify which conceptual KeyFlow grant authorized an occurrence. Unknown lineage must not be relabelled N+1 merely because N+1 is current at receipt.

A provider event webhook and an OAuth authorization response are different lifecycle inputs. This supplement's F227/C177 classification must not silently close Microtrace 004's separate stale-connect-intent candidate.

## 10. Anti-duplication and composition

| Observation | Existing owner or unresolved question | Disposition |
|---|---|---|
| retained mappings, legacy token fallback, status resurrection | F227/C177 / J13 | specialize existing root |
| provider signature, tenant binding, replay and durable claim | J14 / KF-REC-035 | retain ownership |
| historical settlement/refund after disconnect | J18 / KF-REC-048 / K8 | evidence reconciliation, not reconnect |
| provider success with local persistence failure | F149/F159 | no duplicate J13 root |
| conversation consequences after admitted event | J5 / KF-REC-057 | consume admission decision |
| fresh business effects | J2/J15/K3 | require current action authority |
| Microtrace 004 stale connect intent / split Drive ownership | canonical-register comparison still required | OPEN; no new IDs allocated |

J13 should provide an explicit admission decision, including lineage uncertainty where necessary. It must not fabricate a provider-authenticated generation or create a parallel ingress/recovery engine.

## 11. Finite proof matrix - designed, NOT executed

| Case | Required target result |
|---|---|
| P01 WhatsApp disconnected, unseen signed callback | no new live work under revoked authority |
| P02 same-phone reconnect, old first arrival | no automatic assignment to current grant by receipt time |
| P03 Meta shared mapping deleted/recreated | absent mapping remains unrouted; recreated mapping applies explicit admission policy |
| P04 Meta scoped callback | trusted tenant binding and lifecycle policy also required |
| P05 known historical payment/refund | reconcile once without reconnect or new-effect authorization |
| P06 uncorrelated/lineage-uncertain callback | durable quarantine/review disposition, not implicit active-grant admission |
| P07 payment connector activity after revoke | activity cannot reactivate authority |
| P08 QuickBooks legacy token/realm after clearing | no provider attempt authorized by revoked binding |
| P09 Xero legacy token after clearing | smoke test cannot silently reactivate; retain tenantId write guard |
| P10 central-only credentials removed | preserve current credential-blocking behavior |
| P11 disconnect racing an existing request | retain outcome truth but fence subsequent new claims |
| P12 provider teardown failure/timeout | local revocation remains effective; cleanup uncertainty remains visible |

All P01-P12 remain NOT_EXECUTED. These are target acceptance cases, not baseline passes. Also retain the existing Microtrace 004's six designed OAuth/disconnect/refresh cases; do not drop them because this supplement has a separate matrix.

## 12. Exact next stage and stop rule

Next stage: **J13_BOUNDED_CONVERGENCE_REVIEW_PREPARATION**.

Produce one pooled J13 closure candidate from Microtraces 001-004 plus THIS supplement. Start with lifecycle ownership and callback-admission tables, then close or explicitly defer the finite gaps:

1. authority/health/capability ownership and lifecycle transitions, including pending OAuth connect intents;
2. current, historical and uncertain callback lineage admission;
3. the remaining ConnectorStatus-writer inventory, classified as grant-creating, projection-only, activity-evidence, health-observation or revocation;
4. legacy-credential and retained-provider-mapping migration;
5. subscription teardown ownership and residual registration/live-provider unknowns;
6. Microtrace 004 candidate-root anti-duplication against canonical registers and J14/J18/readiness roots;
7. backward re-audit against J5/J14/J18/J2/J15 and K9/K7/K11;
8. proof coverage for P01-P12 and Microtrace 004 cases, with pass/defer/reopen decisions for analytical closure gates.

The label denotes preparation/review, NOT achieved convergence. Do not restart the generic provider scan or claim an exhaustive inventory. Reopen a source path only for a named inventory gap, contradictory pinned evidence, a distinct reachable path, provider constraint or failing regression case.

J13 is not yet provisionally converged. F228/C178/KF-REC-058 remain unallocated. This checkpoint authorizes no production implementation.
