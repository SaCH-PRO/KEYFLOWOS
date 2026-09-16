# KF-JOURNEY-013 — Connector Lifecycle

Status: ACTIVE / BOUNDED CONVERGENCE REVIEW PREPARATION / NOT YET CONVERGED
Date activated: 2026-09-10
Checkpoint updated: 2026-09-16
Checkpoint: `J13-ROLLOVER-2026-09-16-M004-PLUS-CALLBACK-SUPPLEMENT`
Implementation evidence baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Primary kernels: K9 Integration & External Reality, K7 Temporal / Event / Workflow, K11 Recovery & Reliability
Secondary kernels: K1 Tenant Genesis & Identity, K3 KEY Authority & Governance, K5 Capability Fabric, K8 Evidence & Outcome
Adjacent journeys: J5 Conversation → Business Action, J14 Webhook / External Event Ingress, J18 Failure → Recovery, J2 KEY Request → Governed Action, J12 Document/Evidence Lifecycle; J15 for fresh-action governance

> This dossier distinguishes CURRENT REALITY from TARGET KEYFLOWOS. Production implementation remains READ-ONLY / UNAUTHORIZED. Runtime proof has NOT been executed.

## Current checkpoint - takes precedence over the opening sample below

Required evidence pool, relative to `docs/intelligence/`:

```text
investigations/J13-CONNECTOR-LIFECYCLE-MICROTRACE-001.md
investigations/J13-CONNECTOR-LIFECYCLE-MICROTRACE-002.md
investigations/J13-CONNECTOR-LIFECYCLE-MICROTRACE-003.md
investigations/J13-CONNECTOR-LIFECYCLE-MICROTRACE-004.md
investigations/J13-SUBSCRIPTION-CALLBACK-LINEAGE-AND-LEGACY-CREDENTIAL-SUPPLEMENT.md
```

Microtraces 001-003 cover the initial lifecycle/state model, post-disconnect participation/activity resurrection, and expiry/reconnect. The existing Microtrace 004 is **Stale OAuth Connect Intent and Split Drive Lifecycle Ownership**. It is preserved unchanged. A different trace proposed under the same filename in conversation is now the named supplement; do not overwrite or renumber either strand.

Recorded corrections to the first-pass sample and earlier shorthand:

- QuickBooks/Xero central credential clearing is not complete credential removal when usable legacy Business metadata remains. `readCredential` fallback creates conditional QuickBooks provider read/smoke-test and Xero smoke-test participation after disconnect; successful activity can set connected status. Preserve the Xero centralized `tenantId` write guard and central-only blocking behavior. Provider callback reachability and actual tenant possession of legacy tokens are not established.
- Stripe/PayPal activity writes `status: connected`; earlier `connected/healthy` shorthand does not establish a literal `healthStatus: healthy` mutation.
- GoogleDriveConnector clears credentials directly. The dedicated Drive service route separately clears credentials without updating shared ConnectorStatus, as recorded in Microtrace 004.
- A still-valid pre-disconnect Drive OAuth response can statically restore credentials because its connect intent has no revocable generation. Microtrace 004's stale-intent/split-ownership candidate remains open for canonical-register anti-duplication.
- WhatsApp retained mappings and recreated same-page Meta mappings permit conditional old first-arrival callback processing under still-valid application verification. Meta shared routing without a connection row is a positive blocking seam.
- Working refinement to the normal-ingress invariants below: known historical payment/refund evidence may require explicitly bounded reconciliation without reactivating a binding or authorizing new effects. Unknown lineage must not be silently assigned to the current grant. This is a target proposal, not implemented policy.

The supplement reuses F227/C177 for its own mechanisms; it does NOT decide Microtrace 004's separate candidate. F228/C178/KF-REC-058 remain unallocated.

### Exact next action

Stage: **J13_BOUNDED_CONVERGENCE_REVIEW_PREPARATION**.

Produce the planned candidate `investigations/J13-BOUNDED-CONVERGENCE-REVIEW.md`: start with lifecycle ownership and callback-admission tables; finish named status-writer inventory gaps; compare the Microtrace 004 candidate with canonical registers; map legacy credentials/provider mappings and subscription teardown ownership; backward re-audit J5/J14/J18/J2/J15 and K9/K7/K11; assign evidence-based pass/defer/reopen to each analytical closure gate.

The supplement's P01-P12 and Microtrace 004's six cases remain DESIGNED / NOT_EXECUTED. Exhaustive writer coverage, full subscription inventory, live teardown and pooled target acceptance are unfinished. Do not restart the generic opening scan below or mark J13 converged. This update is a persistence checkpoint, not a new source reread or runtime validation.

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

Next free IDs remain F228 / C178 / KF-REC-058. Microtrace 004's stale-intent/split-ownership candidate still requires canonical-register comparison; the supplement's reuse decision does not close it.

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

The original opening sequence is retained below as history; do not repeat it wholesale. The current checkpoint at the top defines the exact next bounded review.

Original sequence:

1. `ConnectorCredentialsService` storage/clear/fallback semantics;
2. `ConnectorHealthMonitorService` and any path that writes ConnectorStatus from health/activity;
3. Gmail/Google OAuth refresh and disconnect;
4. QuickBooks/Xero webhook + outbound lifecycle guards;
5. scheduled `ConnectorIntelligenceService` polling selection and whether it checks active status;
6. provider-specific subscription cleanup on disconnect;
7. reconnect/callback flows and whether an old binding can be silently reused.

Before F228/C178 allocation, classify each observed discrepancy against F227, J14, J18, F149/F159 and existing connector/security findings. Maintain the current/rollover checkpoint after the next material tranche.
