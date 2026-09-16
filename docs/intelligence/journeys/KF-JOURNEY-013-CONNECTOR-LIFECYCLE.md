# KF-JOURNEY-013 — Connector Lifecycle

Status: ACTIVE / BOUNDED REVIEW COMPLETED / TARGET CONTRACT REVIEW REQUIRED / NOT CONVERGED
Date activated: 2026-09-10
Checkpoint updated: 2026-09-16
Checkpoint: `J13-BCR-2026-09-16-01`
Implementation evidence baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Primary kernels: K9 Integration & External Reality, K7 Temporal / Event / Workflow, K11 Recovery & Reliability
Secondary kernels: K1 Tenant Genesis & Identity, K3 KEY Authority & Governance, K5 Capability Fabric, K8 Evidence & Outcome
Adjacent journeys: J5 Conversation → Business Action, J14 Webhook / External Event Ingress, J18 Failure → Recovery, J2 KEY Request → Governed Action, J12 Document/Evidence Lifecycle; J15 for fresh-action governance

> This dossier distinguishes CURRENT REALITY from TARGET KEYFLOWOS. Production implementation remains READ-ONLY / UNAUTHORIZED. Runtime proof has NOT been executed.

## Current checkpoint - takes precedence over the opening sample below

Completed review: [J13 Bounded Convergence Review](../investigations/J13-BOUNDED-CONVERGENCE-REVIEW.md), content commit `6dbbdd34489d77ed1fbc26ff5f6bd1968ee2b953`, based on intelligence input `4a5e4f47e3903e71f8bb5aa22e843c9d2f3693f6` and the fixed implementation baseline above.

Required evidence pool, relative to `docs/intelligence/`:

```text
investigations/J13-CONNECTOR-LIFECYCLE-MICROTRACE-001.md
investigations/J13-CONNECTOR-LIFECYCLE-MICROTRACE-002.md
investigations/J13-CONNECTOR-LIFECYCLE-MICROTRACE-003.md
investigations/J13-CONNECTOR-LIFECYCLE-MICROTRACE-004.md
investigations/J13-SUBSCRIPTION-CALLBACK-LINEAGE-AND-LEGACY-CREDENTIAL-SUPPLEMENT.md
investigations/J13-BOUNDED-CONVERGENCE-REVIEW.md
```

Microtraces 001-003 cover lifecycle/state, post-disconnect participation/activity resurrection, and expiry/reconnect. Microtrace 004 remains **Stale OAuth Connect Intent and Split Drive Lifecycle Ownership**. Callback/legacy-credential work is preserved as a separate supplement. Neither is overwritten or renumbered.

### Bounded review results

The review freshly inspected seven pinned implementation files, with exact full/partial scopes and blobs in its manifest. W01-W18 enumerate named shared writers/nonwriters and join the inherited concrete-provider evidence. This closes the named shared-service gaps, not exhaustive repository coverage.

- Registry smoke success writes connected without an expected current-state/generation condition; a completed old result can be persisted after disconnect.
- The monitor excludes disconnected at selection, but its late error/expired upsert is not fenced against intervening revocation. Its own success branch is a nonwriter.
- Guarded webhook-info GET creates a missing secret through setCredentials, thereby writing connected without proving a provider registration or usable capability.
- Shared activity logging writes ConnectorActivityLog, not ConnectorStatus. Concrete adapter activity helpers remain separately identified.
- Gmail ingestion completion sets connected, intakeEnabled=true and cursor metadata even when individual-message errors yield returned success:false. Old success/failure writes require lifecycle fencing; ordinary new calls after effective token removal remain credential-constrained without another usable path.
- Unified Google credential installation and later per-service status commits require the same current-intent fence as dedicated Drive. The inspected Forms verification is scope-based, not a live Forms API probe.
- Registry reconnect catches disconnect failure and proceeds to authenticate; this does not itself prove that remote teardown was attempted.

These are static mechanisms and conditional interleavings, not reproduced runtime incidents. New N01-N06 cases remain designed only.

### Preserved corrections and narrowed evidence

QuickBooks/Xero central clear is not complete removal when usable legacy Business metadata remains. Preserve conditional QuickBooks read/smoke and Xero smoke participation, Xero's central tenantId write guard and central-only blocking. Accounting-provider callback reachability and actual tenant secret possession remain unestablished.

Payment activity mutates `status: connected`; prior shorthand does not establish a literal `healthStatus: healthy` mutation. GoogleDriveConnector clears credentials directly; the dedicated Drive route has different shared-status effects. Stale signed OAuth intent is not the same input as an ordinary provider-event callback.

WhatsApp retained mappings and same-page Meta recreation support conditional old first-arrival processing under valid application verification. Absent shared Meta mapping is a positive blocking seam. Unknown lineage cannot be assigned to the current grant by receipt time. Known historical payment/refund evidence may require bounded reconciliation without reconnect or fresh effect authority. Watches and live subscription teardown remain unproved.

### Canonical comparison and allocation

Review section 7 now independently completes M004's named canonical-register comparison. Result: **SPECIALIZATION / REFINE F227-C177**, retaining stale intent and split Drive ownership as separately named obligations. This is not merely the supplement's earlier reuse decision and does not collapse OAuth intent consumption into webhook replay.

F228/C178/KF-REC-058 remain unallocated. The comparison is bounded, not exhaustive historical-register coverage or acceptance of the final target. 08BC/09BC remain canonical home definitions; the review adds supporting evidence and refinement.

### Kernel and adjacent-journey reinjection

| Owner | Reinjected obligation / review result |
|---|---|
| K9 / J13 | One lifecycle transition contract governs intents, credentials, route admission, poll/refresh claims and all named grant-like writers; credential storage alone is not the owner. Exact target acceptance remains open. |
| K7 | Bind work/results to the originating grant and compare expected state at material/result commit, not only scheduling or selection. Fence late failure as well as late success. |
| K11 / J18 | Preserve original-effect certainty; remote cleanup pending/unknown cannot undo local revoke or grant new effects. Old cleanup names the old registration and cannot remove N+1 or another tenant's shared registration. |
| J5 | Ownership alignment survives; consume the purpose-specific binding decision and preserve unknown lineage. J5 remains provisionally target-aligned and reopenable. |
| J14 | Retain authentication, trusted tenant binding, occurrence/claim/replay/ack ownership. J13 admission precedes new domain consequences; OAuth intent authority is not supplied by generic occurrence dedupe. |
| J2 / J15 | Current connector participation is an action precondition, not human approval evidence; exact action governance remains authoritative. |
| J12 | Connection generation is not document/source revision or ingestion occurrence identity; migration must preserve historical evidence coordinates. |
| K8 / J17 | Expose truthful local-revoked and remote-cleanup-pending/unknown evidence without a second evidence or attention runtime. |

The detailed ownership, admission, migration and backward re-audit tables are in review sections 1-2 and 8-9. No parallel ingress, governance, recovery, knowledge or attention engine is introduced.

### Gates and exact next action

Review section 10 assigns fourteen evidence-linked gates. G03 named shared writers and G05 canonical comparison PASS at bounded scope. G06/G08/G10/G11 pass as candidate/design/ownership work only. **G07 exact transition/intent/mutation-time fencing and G13 J13 convergence remain REOPEN.** G04 exhaustive coverage and G09 actual subscription identity/shared ownership/teardown remain DEFER. G12 runtime proof and G14 production authorization remain absent.

Stage: **`J13_TARGET_CONTRACT_ADVERSARIAL_REVIEW`**.

Planned output, not created by this checkpoint:
`investigations/J13-LIFECYCLE-AUTHORITY-CONTRACT-CANDIDATE.md`.

Start with W01-W18 transition/write sets. Separate current grant, credential version, pending connect intent, health, cursor and intake policy. Specify expected-state checks at credential installation, effect/work claims and result commits, including partial suite provisioning and in-flight cancellation. Define admission separately for new work, historical reconciliation, configuration, probe and cleanup; preserve uncertain lineage, shared-registration ownership and N-cleanup/N+1 safety.

Analytically challenge the candidate with P01-P12, M004-01-06 and N01-N06; all remain DESIGNED / NOT_EXECUTED. Re-audit adjacent journeys/kernels; resolve G07 and revisit G13 with G04/G09 debts explicit. Do not recreate the bounded review, restart the opening generic scan, allocate a recommendation because a candidate file exists, or mark J13 converged prematurely. Refresh CURRENT/ROLLOVER after the next substantive tranche.

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

`ACTIVE` is an authority state, not just a health label. This is the opening working model, not final transition acceptance; the current review separates authority, credential health and cleanup certainty before accepting exact state transitions.

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

This is still a working target concept, not yet a new KF-CONCEPT allocation. A single semantic owner does not mandate one physical table or a monolithic connector runtime.

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

Residual callbacks after revoke should be auditable/quarantinable but should not silently regain normal processing authority. Preserve the current checkpoint's purpose-specific historical-reconciliation and unknown-lineage distinctions.

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

The opening target separation was:

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

One `status` field should not be forced to represent all three. The bounded review now requires the candidate to specify which expiry condition concerns a credential versus termination of a grant; the opening vocabulary above is not a final state-machine decision.

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
→ cancel stale pending connect intents
→ stop new polling/sync claims under N
→ stop new outbound effect claims under N
→ fence stale material/result commits under N
→ reject/quarantine new normal processing under N
→ preserve explicitly permitted historical reconciliation
→ revoke/remove credentials or make them unusable according to provider policy
→ record provider-cleanup obligation and perform teardown where supported
→ preserve historical evidence and mappings needed for reconciliation
→ report residual provider-side cleanup uncertainty explicitly
```

Disconnect must not mean merely “change the card to grey.” Local revocation and confirmed remote cleanup are distinct. The review maps bounded cleanup authority and old-registration identity so cleanup cannot remove N+1 or a registration shared with another active tenant.

---

## K. Reconnect Invariant

Reconnect should not silently reactivate ambiguous historical authority.

Target:

```text
RECONNECT
→ authenticate/grant again under a current intent
→ validate current provider account/destination/scopes
→ create/advance binding generation through an expected-state commit
→ establish new ingress/sync/effect authority
→ reconcile pending residual provider state without reusing old authority
```

Historical occurrences/effects retain their old binding lineage where established. Where provider-authenticated lineage is unavailable, retain explicit uncertainty rather than assigning the current generation by receipt time.

---

## L. Recovery / Token Expiry Questions

Opening microscopic questions, now partially answered by Microtraces 001-004, the supplement and the bounded review; consult those before reopening:

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

Connector disconnected state is not universally load-bearing as revocation of external participation. WhatsApp proves a reachable manifestation. The supplement adds conditional callback/fallback manifestations. The bounded review classifies M004's stale-intent/split-owner mechanisms as specializations requiring refinement of this lifecycle root, while retaining their separate proof obligations.

### Reuse requirements

Do not duplicate:

- J14/KF-REC-035 for provider occurrence/authentication/replay semantics;
- J18/KF-REC-048 for retry/reconcile/certainty recovery;
- F149/F159 for provider failure ambiguity and provider-success/local-persistence crash windows;
- J15/K3 for business-action governance;
- F225 for conversation delivery evidence;
- J12/F220 for source revision occurrence semantics.

Next free IDs remain F228 / C178 / KF-REC-058. M004's named canonical-register comparison is now complete at bounded scope; final target acceptance and any genuinely independent future root remain separate questions. Do not allocate merely to count additional manifestations as progress.

---

## N. Positive Seams to Preserve

- shared `IConnector` vocabulary and registry;
- `ConnectorCredentialsService` direction for centralized secret handling;
- Google Drive connector-class disconnect clears business-scoped OAuth credentials and status;
- QuickBooks disconnect clears centralized connector credentials, subject to the legacy-fallback limitation;
- QuickBooks material push paths call `isConnected()`, though credential presence alone is insufficient authority;
- explicit `testConnection` / `smokeTest` concepts distinguish configuration from real provider proof;
- unsupported sync can return an explicit `PULL_SYNC_NOT_IMPLEMENTED` rather than false success;
- monitor selection excludes already-disconnected rows, though it needs mutation-time fencing;
- shared activity logging is separate from lifecycle status;
- absent shared Meta routing configuration blocks that route.

---

## O. Target Invariants Under Review

These remain working proposals, now refined by the bounded review:

1. One tenant-scoped connector binding/grant is the authority root for active provider participation.
2. Display status, credential presence and operational health are projections, not competing authority roots.
3. Disconnect/revoke is monotonic for the old binding generation and invalidates stale pending connect intents.
4. A revoked binding cannot be resurrected by activity, health, configuration lookup, credential storage or cursor bookkeeping.
5. Provider-authenticated callbacks need current purpose-specific admission in addition to J14 authentication/tenant routing; controlled historical reconciliation requires explicit separate authority.
6. Polling/sync workers must claim work only for current active bindings, and later mutations/results must compare the expected grant rather than trust old selection.
7. Outbound provider effects must verify the current binding before effect attempt; effects already past their point of no return require truthful outcome/reconciliation handling.
8. Credential expiry, failed refresh and provider revocation must retain their actual evidence and must not be treated as interchangeable authority transitions without policy.
9. Reconnect uses a current connect intent, creates a new grant generation and revalidates provider identity/scopes.
10. Historical mappings/evidence survive when needed but cannot authorize new work; unknown lineage is not upgraded by arrival time.
11. Local revocation and remote cleanup certainty are separate; cleanup retries preserve old registration ownership and cannot remove N+1 or another tenant's registration.
12. Global development/provider credentials and legacy fallback must not make a tenant-scoped revoked grant appear authorized.
13. Google-suite partial provisioning and late results must not overwrite a newer cancellation, grant or intake-policy decision.
14. Migration/rollback preserves revocation and cannot restore legacy authority by re-enabling a compatibility reader.

---

## P. Historical Opening Trace Plan - superseded as next-action instructions

The original opening sequence is retained below as history; do not repeat it wholesale. The current checkpoint at the top defines the exact target-contract adversarial review after the completed bounded review.

Original sequence:

1. `ConnectorCredentialsService` storage/clear/fallback semantics;
2. `ConnectorHealthMonitorService` and any path that writes ConnectorStatus from health/activity;
3. Gmail/Google OAuth refresh and disconnect;
4. QuickBooks/Xero webhook + outbound lifecycle guards;
5. scheduled `ConnectorIntelligenceService` polling selection and whether it checks active status;
6. provider-specific subscription cleanup on disconnect;
7. reconnect/callback flows and whether an old binding can be silently reused.

Before any later F228/C178 allocation, classify an independently stated discrepancy against F227, J14, J18, F149/F159 and existing connector/security findings. Maintain the current/rollover checkpoint after the next material tranche.
