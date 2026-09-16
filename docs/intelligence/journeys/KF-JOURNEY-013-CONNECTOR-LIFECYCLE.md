# KF-JOURNEY-013 — Connector Lifecycle

Status: ACTIVE / CONTRACT SPECIFIED AND ADVERSARIALLY REVIEWED / CONFORMANCE NEXT / NOT CONVERGED
Date activated: 2026-09-10
Checkpoint updated: 2026-09-16
Checkpoint: `J13-LAC-2026-09-16-01`
Implementation evidence baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Primary kernels: K9 Integration & External Reality, K7 Temporal / Event / Workflow, K11 Recovery & Reliability
Secondary kernels: K1 Tenant Genesis & Identity, K3 KEY Authority & Governance, K5 Capability Fabric, K8 Evidence & Outcome
Adjacent journeys: J5 Conversation → Business Action, J14 Webhook / External Event Ingress, J18 Failure → Recovery, J2 KEY Request → Governed Action, J12 Document/Evidence Lifecycle; J15 for fresh-action governance

> CURRENT REALITY and TARGET KEYFLOWOS remain distinct. Production implementation is READ-ONLY / UNAUTHORIZED. Application/provider/runtime proof has NOT been executed.

## Current checkpoint - authoritative over historical opening model below

**Current contract home:** [J13 Lifecycle Authority Contract Candidate](../investigations/J13-LIFECYCLE-AUTHORITY-CONTRACT-CANDIDATE.md).

**Completed:** `J13_TARGET_CONTRACT_ADVERSARIAL_REVIEW`. The candidate maps W01-W18 to permitted target writes, specifies T01-T13 transitions, and reviews 32 P/M004/N/A cases analytically. No case execution or implementation conformance is claimed.

**Next:** `J13_ADAPTER_CONFORMANCE_AND_MIGRATION_CLOSURE`, starting Q1 Local commit/authority map. The candidate's section 11 owns the four-item queue; current state/handoff/rollover point to the same queue.

### Preserved evidence pool

Paths relative to `docs/intelligence/`:

```text
investigations/J13-CONNECTOR-LIFECYCLE-MICROTRACE-001.md
investigations/J13-CONNECTOR-LIFECYCLE-MICROTRACE-002.md
investigations/J13-CONNECTOR-LIFECYCLE-MICROTRACE-003.md
investigations/J13-CONNECTOR-LIFECYCLE-MICROTRACE-004.md
investigations/J13-SUBSCRIPTION-CALLBACK-LINEAGE-AND-LEGACY-CREDENTIAL-SUPPLEMENT.md
investigations/J13-BOUNDED-CONVERGENCE-REVIEW.md
investigations/J13-LIFECYCLE-AUTHORITY-CONTRACT-CANDIDATE.md
```

The original microtraces, separate supplement and BCR are unchanged. M004 owns stale OAuth connect intent and split Drive lifecycle ownership; SUP owns its separately preserved provider callback/legacy-credential evidence. BCR performed M004's independent bounded register comparison: SPECIALIZATION / REFINE F227-C177, with separate obligations retained. F228/C178/KF-REC-058 remain unallocated.

### Current target refinement

The selected candidate makes local grant, credential version, pending intent, health, intake policy, cursor and remote authorization scope distinct. One logical lifecycle transition contract controls all named writers, but does not require a new universal connector runtime or one physical table for every concept.

T05 activation checks the current intent target and current actor authority. T06 revocation is terminal for the targeted grant and cancels applicable pending targets. T07 protects credential rotation within the same grant. T08 observations cannot grant permission. T09 local application shares an enforced commit order with revoke. T10 dispatch admission separates blocking new provider work from the impossibility of claiming retroactive cancellation of an already-admitted remote attempt. T11 preserves historical reconciliation without fresh-effect authority. T12 applies remote scope/dependency barriers to destructive cleanup. The candidate, not this summary, defines the exact write sets.

Unknown original callback lineage is not assigned to the newest grant. A separately authorized bounded adoption can allow a present use without rewriting historical origin. Shared remote authorization is not automatically revoked by a local service disconnect; an old cleanup must not destroy a valid sibling or N+1 reference.

### Fresh evidence and limits

Two named source reads at the fixed baseline: unified Google provisioning lines 180-285 and the full shared token helper. The suite copies the same exchange token to enabled service fields; refresh assignment is conditional on a returned refresh token. The helper can conditionally rewrite access/expiry and return a refreshed token after an intervening disconnect, but does not restore the cleared refresh field; its next invocation still requires that field. Do not inflate that into universal subsequent usability or an executed incident.

Primary external PostgreSQL/Google/RFC7009 documentation is identified separately in the candidate. Google remote revocation scope is a target constraint, not evidence that baseline disconnect already performs a broad revoke. Current tenant secrets and remote registrations were not inspected.

Preserve BCR's writer distinctions: shared smoke success, secret-creating webhook-info GET, late monitor failure, Gmail completion and suite commits require target discipline. Shared ConnectorActivityService is an activity-log writer, not ConnectorStatus; the monitor's own success branch is also a nonwriter. Gmail completion can set connected/intake/cursor while reporting per-message errors.

Preserve SUP corrections: payment activity changes status connected, not a proved literal healthStatus field; QB/Xero central clearing can leave usable legacy values, with Xero's tenantId write guard retained; central-only credential blocking remains real. WhatsApp retained and Meta recreated mappings support conditional old first arrivals; absent shared Meta mapping blocks. Accounting callback reachability, Gmail/Drive watches and actual remote teardown remain unestablished, not invented.

### Kernel and adjacent-journey reinjection

| Owner | Current obligation / result |
|---|---|
| K9 / J13 | One logical lifecycle owner; separate local grant, provider authorization scope and registration dependencies; current intent/account/use admission; no broad cleanup without scope proof. |
| K7 | Order revocation with local material commits; version intents, credentials, config and cursors appropriately; delayed failure/success cannot change later authority. |
| K11 / J18 | Distinguish pre-admitted remote attempt from completed effect; preserve exchange/refresh/cleanup unknowns; do not blindly retry or use current account references for old cleanup. |
| J5 | Preserve ownership alignment; reference origin lineage and present purpose admission separately. No provider-generation fabrication or new conversation authority engine. |
| J14 | Keep authenticity, trusted tenant binding, occurrence/claim/replay/ack; apply J13 admission before normal local consequences, including compatibility routes. |
| J2 / J15 | Current actor/control authority remains required; connector readiness/adoption/probe success is not Clearance. |
| J12 / K4 / K8 | Connection generation is not source revision or fact verification; historical adoption cannot upgrade evidence truth/provenance. |
| J17 | Surface local revoke, in-flight outcomes and remote cleanup uncertainty as attention evidence, not a second lifecycle owner. |

### Gates and exact next action

G07 now **PASS_DESIGN_WITH_STATED_GUARANTEE_LIMITS**: conditions, write sets, replay and external limits are specified and challenged. G13 remains **DEFER_CONFORMANCE_AND_MIGRATION_DECISION**. G04 exhaustive coverage and G09 actual remote evidence remain deferred. G12 is NOT_EXECUTED and G14 UNAUTHORIZED. No mixed-gate completion percentage is meaningful.

Create `investigations/J13-ADAPTER-CONFORMANCE-AND-MIGRATION-MAP.md`:

```text
Q1 NEXT: local commit/authority map for named controller/registry/credentials/suite/helper/Drive
Q2: Google service/account/client/credential-family and remote-scope dependencies
Q3: retained WhatsApp/Meta/payment callback and registration ownership
Q4: bounded closure decision against all 32 designed cases
```

Start Q1 with actual entities/keys, guards/authority consumers and transaction/claim boundaries mapped to T01-T10. Identify existing seams and missing schema/interfaces without editing production. Each item ends in evidence-based close/defer/reopen. Do not recreate BCR or the lifecycle candidate; reopen its D/T decisions only for a concrete counterexample. Persist results and refresh CURRENT/ROLLOVER together.

---

## Historical opening model - retained analytical context

Sections A-P preserve the opening dossier, not a second current state machine. Apply the corrections above and the current candidate where later evidence refines them. Historical next-action lists are not the live queue.

## A. Definition

J13 is the lifecycle by which a business grants, proves, uses, observes, degrades, revokes and later re-establishes authority for an external integration.

It covers:

```text
connector discovery/configuration
→ authentication / credential grant
→ provider account / destination binding
→ connected state
→ health and scope validation
→ inbound webhook/poll participation
→ outbound provider effects
→ sync ownership
→ token refresh / expiry / provider revocation
→ degraded/error state
→ disconnect / explicit revoke
→ residual callback handling
→ reconnect / new grant generation
→ recovery / reconciliation
```

J13 does not own provider-event occurrence semantics after valid ingress (J14), business-action governance (J2/J15), generic recovery (J18), or conversation processing (J5).

---

## B. Product Intent

When KeyFlow says a connector is **connected**, the user should be able to trust that the configured provider/account is actually usable under current credentials/scopes and is authorized for the business.

When KeyFlow says a connector is **disconnected**, the user should be able to trust that the old binding no longer authorizes new normal ingress, polling/sync or outbound effects.

Target user meaning:

```text
CONNECTED
= current tenant-scoped provider binding exists
+ required credentials/scopes are valid enough for declared capabilities
+ allowed connector participation is active

DISCONNECTED / REVOKED
= old binding generation can no longer authorize new live processing/effects
```

A status badge alone is not the lifecycle.

---

## C. Current Framework Surface

The shared `IConnector` contract currently exposes:

```text
authenticate(businessId)
healthCheck(businessId)
getStatus(businessId)
isConnected(businessId)
sync(businessId)
disconnect(businessId): Promise<void>
testConnection?()
smokeTest?()
syncToIngestion?()
parseInbound?()
verifyWebhook?()
```

The interface defines status vocabulary:

```text
connected | disconnected | error | expired | syncing
```

but does not define a semantic postcondition for `disconnect()` or a binding-generation/revocation object. Implementations therefore determine lifecycle meaning independently.

This absence is currently classified as the architectural explanation behind F227/C177 rather than a new F228 root.

---

## D. First Cross-Provider Sample

This opening sample is retained as analysis history. Apply the current checkpoint's corrections above before relying on its credential-blocking conclusions.

### WhatsApp — weak disconnect/revocation seam

Observed in the J5 pressure test:

- `WhatsAppConnector.disconnect()` records `ConnectorStatus.status = disconnected`;
- retained business WhatsApp configuration/routing data is not cleared by that method;
- shared Meta webhook resolves tenant from retained `Business.metaData.whatsapp.phoneNumberId`;
- webhook/`receiveInbound()` does not require ConnectorStatus to be connected;
- therefore a later valid provider callback remains code-level routable into normal business processing after the control plane says disconnected;
- `healthCheck()` may also report connected from a global access token despite business-scoped stored disconnected state.

Canonical root: **F227 / C177**.

### Google Drive — stronger credential revocation seam

`GoogleDriveConnector` determines actual connected health from the presence of the business-scoped Drive access token.

`disconnect()` clears:

```text
driveEmail
driveAccessToken
driveRefreshToken
driveTokenExpiry
```

and upserts ConnectorStatus to disconnected.

This is directionally stronger because runtime credential availability and displayed connection state move together.

However `trackActivity()` can upsert ConnectorStatus back to connected when a Drive activity emitter is called, so later lifecycle tracing must establish which callers are allowed to invoke those emitters and whether they require current connection authority.

### QuickBooks — stronger outbound guard seam

QuickBooks uses `ConnectorCredentialsService` for credentials.

`disconnect()` clears connector credentials.

`healthCheck()` derives connected state from usable credential presence (with a test-token development path), and material outbound operations such as `pushInvoice()` / `pushCustomer()` explicitly reject when `isConnected()` is false.

This is a positive pattern to preserve, though full webhook/revocation behavior still requires trace. The current checkpoint qualifies this seam: a credential-derived `isConnected()` can succeed through surviving legacy fallback and is not by itself a revocation guard.

---

## E. First State Model

### Current reality

There is no one enforced lifecycle state machine across providers.

Observed concepts are spread across:

```text
ConnectorStatus.status
credential/token presence
Business metadata/config
provider destination/account IDs
OAuth token expiry
provider-side subscriptions/webhooks
intakeEnabled
healthCheck interpretation
global environment credentials
lastSyncAt / lastErrorAt / counts
actual ability to execute provider operation
```

These can disagree.

### Target working state model

```text
UNCONFIGURED
→ CONNECTING
→ ACTIVE(binding generation N)
   ├→ DEGRADED
   ├→ CREDENTIAL_EXPIRED
   ├→ PROVIDER_REVOKED
   ├→ ERROR_RECOVERABLE
   └→ DISCONNECTING
        → REVOKED(binding generation N)

REVOKED
→ RECONNECTING
→ ACTIVE(binding generation N+1)
```

`ACTIVE` is an authority state, not just a health label.

---

## F. Connector Binding Generation — Working Primitive

Candidate target primitive:

```text
ConnectorBinding {
  bindingId
  generation
  businessId
  connectorType
  providerAccountId / destinationId
  credentialRef / authGrantRef
  grantedScopes / capabilitySet
  connectedAt
  revokedAt?
  revocationReason?
  status
  policyVersion
  evidence
}
```

Purpose:

- bind ingress routing to the current grant;
- bind polling/sync ownership to the current grant;
- bind outbound effects to the current grant;
- distinguish reconnect from silent reuse of an old binding;
- preserve audit evidence without allowing a revoked historical binding to authorize new work.

This is still a working target concept, not yet a new KF-CONCEPT allocation.

---

## G. Ingress Relationship to J14

J14 owns:

```text
provider authentication
→ tenant binding
→ provider occurrence identity
→ durable ingress claim
→ processing / consequences
```

J13 adds a separate predicate:

```text
IS THIS PROVIDER/TENANT BINDING CURRENTLY AUTHORIZED TO PARTICIPATE?
```

Therefore:

```text
signature valid
AND tenant mapping valid
DOES NOT IMPLY
connector binding currently active
```

F227/C177 proves this distinction in WhatsApp.

Residual callbacks after revoke should be auditable/quarantinable but should not silently regain normal processing authority. The checkpoint's proposed historical-evidence admission distinction must be retained.

---

## H. Outbound Effect Relationship to J2/J15/J18

Material provider operations require all relevant predicates:

```text
current ConnectorBinding
+ capability/tenant authority
+ governance/Clearance when required
+ ExecutionClaim
+ provider operation
+ ProviderEffectId / OutcomeEvidence
+ certainty-aware recovery
```

Connector connectedness is necessary but not sufficient authorization for arbitrary business action.

QuickBooks' explicit `isConnected()` guard on outbound pushes is a favorable local seam, subject to the legacy-fallback qualification above. J13 must determine whether comparable guards are universal across outbound connectors and whether they enforce authority rather than credential presence alone.

---

## I. Health Semantics

A useful target separation is:

```text
LIFECYCLE AUTHORITY STATE
  active / revoked / connecting / expired

OPERATIONAL HEALTH
  healthy / degraded / unavailable / unknown

CAPABILITY READINESS
  can_receive_webhook
  can_poll
  can_send
  can_write
  can_read
  can_refresh_token
```

One `status` field should not be forced to represent all three.

Current examples show why:

- WhatsApp stored status may be disconnected while a global token makes health report connected;
- Google Drive health derives from token presence;
- QuickBooks health derives from credential presence;
- provider reachability/scope validity may only be tested by `testConnection` or `smokeTest`.

---

## J. Disconnect / Revocation Invariant

Target law:

```text
DISCONNECT / REVOKE(binding N)
→ persist revocation before reporting success
→ stop new polling/sync claims under N
→ stop new outbound effect claims under N
→ reject/quarantine new callbacks under N where binding identity is available
→ revoke/remove credentials or make them unusable according to provider policy
→ tear down provider subscriptions/webhooks where supported
→ preserve historical evidence and mappings needed for reconciliation
→ report residual provider-side cleanup uncertainty explicitly
```

Disconnect must not mean merely “change the card to grey.” Microtrace 004 adds pending-connect-intent cancellation as a proposed required lifecycle postcondition.

---

## K. Reconnect Invariant

Reconnect should not silently reactivate ambiguous historical authority.

Target:

```text
RECONNECT
→ authenticate/grant again
→ validate current provider account/destination/scopes
→ create/advance binding generation
→ establish new ingress/sync/effect authority
→ reconcile pending residual provider state
```

Historical occurrences/effects retain their old binding lineage where established. Where provider-authenticated lineage is unavailable, retain explicit uncertainty rather than assigning the current generation by receipt time.

---

## L. Recovery / Token Expiry Questions

Opening microscopic questions, now partially answered by Microtraces 001-004 and the supplement; consult those before reopening:

1. Does OAuth refresh failure transition one durable lifecycle owner, or merely produce local provider errors?
2. Can scheduled sync continue after credentials are expired/revoked?
3. Can `trackActivity()` or a webhook flip a disconnected connector back to connected without an explicit reconnect grant?
4. Are provider subscriptions removed on disconnect where supported?
5. Are credentials cleared centrally or connector-by-connector?
6. Does a reconnect preserve/reuse stale destination/account IDs safely?
7. Is a disconnected connector allowed to send through global environment credentials?
8. How are partial disconnects represented when local credentials are cleared but provider subscription cleanup fails?
9. Can outbound provider operations execute after the UI/control state says disconnected?
10. Which connector state is authoritative when ConnectorStatus, credentials and provider reality disagree?

---

## M. Current Canonical Finding Pressure

### F227 / C177 — inherited opening root

Connector disconnected state is not universally load-bearing as revocation of external participation. WhatsApp proves a reachable manifestation. The supplement adds conditional callback/fallback manifestations under this root.

### Reuse requirements

Do not duplicate:

- J14/KF-REC-035 for provider occurrence/authentication/replay semantics;
- J18/KF-REC-048 for retry/reconcile/certainty recovery;
- F149/F159 for provider failure ambiguity and provider-success/local-persistence crash windows;
- J15/K3 for business-action governance;
- F225 for conversation delivery evidence;
- J12/F220 for source revision occurrence semantics.

Next free IDs remain F228 / C178 / KF-REC-058. The bounded review independently completed Microtrace 004's named comparison, retaining it as a specialization/refinement of F227/C177 with separate intent/ownership obligations. The supplement's earlier reuse decision alone did not close that comparison. Final target acceptance and exhaustive historical-register comparison remain distinct.

---

## N. Positive Seams to Preserve

- shared `IConnector` vocabulary and registry;
- `ConnectorCredentialsService` direction for centralized secret handling;
- Google Drive connector-class disconnect clears business-scoped OAuth credentials and status;
- QuickBooks disconnect clears centralized connector credentials, subject to the legacy-fallback limitation;
- QuickBooks material push paths call `isConnected()`, though credential presence alone is insufficient authority;
- explicit `testConnection` / `smokeTest` concepts distinguish configuration from real provider proof;
- unsupported sync can return an explicit `PULL_SYNC_NOT_IMPLEMENTED` rather than false success.

---

## O. First Target Invariants

These remain working proposals, with the checkpoint's historical-evidence and connect-intent refinements:

1. One tenant-scoped connector binding/grant is the authority root for active provider participation.
2. Display status, credential presence and operational health are projections, not competing authority roots.
3. Disconnect/revoke is monotonic for the old binding generation.
4. A revoked binding cannot be resurrected by activity bookkeeping.
5. Provider-authenticated callbacks require a currently valid binding for new normal participation in addition to J14 authentication/tenant routing; controlled historical reconciliation requires an explicit separate admission policy.
6. Polling/sync workers must claim work only for current active bindings.
7. Outbound provider effects must verify the current binding before effect attempt.
8. Token/provider revocation must produce explicit lifecycle evidence rather than silently becoming generic error.
9. Reconnect creates or advances a grant generation and revalidates provider identity/scopes.
10. Historical mappings/evidence survive revocation when needed for audit/reconciliation but cannot authorize new work.
11. Health state must not silently override lifecycle authority.
12. Global development/provider credentials must not make a tenant-scoped revoked binding appear live in production semantics.

---

## P. Historical Opening Trace Plan - superseded as next-action instructions

The original opening sequence is retained below as history; do not repeat it wholesale. The current checkpoint at the top defines the exact next bounded unit.

Original sequence:

1. `ConnectorCredentialsService` storage/clear/fallback semantics;
2. `ConnectorHealthMonitorService` and any path that writes ConnectorStatus from health/activity;
3. Gmail/Google OAuth refresh and disconnect;
4. QuickBooks/Xero webhook + outbound lifecycle guards;
5. scheduled `ConnectorIntelligenceService` polling selection and whether it checks active status;
6. provider-specific subscription cleanup on disconnect;
7. reconnect/callback flows and whether an old binding can be silently reused.

Before F228/C178 allocation, classify each observed discrepancy against F227, J14, J18, F149/F159 and existing connector/security findings. Maintain the current/rollover checkpoint after the next material tranche.
