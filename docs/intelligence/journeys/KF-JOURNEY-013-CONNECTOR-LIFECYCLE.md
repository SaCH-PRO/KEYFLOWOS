# KF-JOURNEY-013 — Connector Lifecycle

Status: ACTIVE FIRST-PASS / MICROSCOPIC TRACE IN PROGRESS
Date activated: 2026-09-10
Implementation evidence baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Primary kernels: K9 Integration & External Reality, K7 Temporal / Event / Workflow, K11 Recovery & Reliability
Secondary kernels: K1 Tenant Genesis & Identity, K3 KEY Authority & Governance, K5 Capability Fabric, K8 Evidence & Outcome
Adjacent journeys: J5 Conversation → Business Action, J14 Webhook / External Event Ingress, J18 Failure → Recovery, J2 KEY Request → Governed Action, J12 Document/Evidence Lifecycle

> This dossier distinguishes CURRENT REALITY from TARGET KEYFLOWOS. Production implementation remains READ-ONLY / UNAUTHORIZED. Runtime proof has NOT been executed.

---

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

This is a positive pattern to preserve, though full webhook/revocation behavior still requires trace.

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

Residual callbacks after revoke should be auditable/quarantinable but should not silently regain normal processing authority.

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

QuickBooks' explicit `isConnected()` guard on outbound pushes is a favorable local seam. J13 must determine whether comparable guards are universal across outbound connectors.

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

Disconnect must not mean merely “change the card to grey.”

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

Historical occurrences/effects retain their old binding lineage.

---

## L. Recovery / Token Expiry Questions

Open microscopic questions:

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

Connector disconnected state is not universally load-bearing as revocation of external participation. WhatsApp proves a reachable manifestation.

### Reuse requirements

Do not duplicate:

- J14/KF-REC-035 for provider occurrence/authentication/replay semantics;
- J18/KF-REC-048 for retry/reconcile/certainty recovery;
- F149/F159 for provider failure ambiguity and provider-success/local-persistence crash windows;
- J15/K3 for business-action governance;
- F225 for conversation delivery evidence;
- J12/F220 for source revision occurrence semantics.

Next free IDs remain F228 / C178 / KF-REC-058.

---

## N. Positive Seams to Preserve

- shared `IConnector` vocabulary and registry;
- `ConnectorCredentialsService` direction for centralized secret handling;
- Google Drive disconnect clears business-scoped OAuth credentials and status;
- QuickBooks disconnect clears connector credentials;
- QuickBooks material push paths call `isConnected()`;
- explicit `testConnection` / `smokeTest` concepts distinguish configuration from real provider proof;
- unsupported sync can return an explicit `PULL_SYNC_NOT_IMPLEMENTED` rather than false success.

---

## O. First Target Invariants

1. One tenant-scoped connector binding/grant is the authority root for active provider participation.
2. Display status, credential presence and operational health are projections, not competing authority roots.
3. Disconnect/revoke is monotonic for the old binding generation.
4. A revoked binding cannot be resurrected by activity bookkeeping.
5. Provider-authenticated callbacks require a currently valid binding in addition to J14 authentication/tenant routing.
6. Polling/sync workers must claim work only for current active bindings.
7. Outbound provider effects must verify the current binding before effect attempt.
8. Token/provider revocation must produce explicit lifecycle evidence rather than silently becoming generic error.
9. Reconnect creates or advances a grant generation and revalidates provider identity/scopes.
10. Historical mappings/evidence survive revocation when needed for audit/reconciliation but cannot authorize new work.
11. Health state must not silently override lifecycle authority.
12. Global development/provider credentials must not make a tenant-scoped revoked binding appear live in production semantics.

---

## P. Immediate Next Trace

Trace, in order:

1. `ConnectorCredentialsService` storage/clear/fallback semantics;
2. `ConnectorHealthMonitorService` and any path that writes ConnectorStatus from health/activity;
3. Gmail/Google OAuth refresh and disconnect;
4. QuickBooks/Xero webhook + outbound lifecycle guards;
5. scheduled `ConnectorIntelligenceService` polling selection and whether it checks active status;
6. provider-specific subscription cleanup on disconnect;
7. reconnect/callback flows and whether an old binding can be silently reused.

Before F228/C178 allocation, classify each observed discrepancy against F227, J14, J18, F149/F159 and existing connector/security findings.
