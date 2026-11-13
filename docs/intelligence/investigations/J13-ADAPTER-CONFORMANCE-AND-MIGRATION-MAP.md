# J13 - Adapter Conformance, Migration and Reversible Integration Map

Checkpoint: `J13-ACM-2026-09-16-01`  
Date: 2026-09-16  
Intelligence input: `2b177c772036eee83c24b79ee649d99fd3a2dba1`  
Implementation forensic baseline: `8f173bfe79f1418159cf4099ea18b0d60d203ec2`  
Result: **Q1-Q4 REVIEW COMPLETED; MAPPED J13 CORE PROVISIONALLY TARGET-ALIGNED AT THE DECLARED SCOPE**  
Implementation conformance: **NOT ACHIEVED BY THIS DOCUMENT**  
Application/provider/concurrency/migration tests: **NOT_EXECUTED**  
Production source/schema/deployment: **READ-ONLY / UNAUTHORIZED**  
F228 / C178 / KF-REC-058: **UNALLOCATED**.

This completes the four-item queue in the [Lifecycle Authority Contract Candidate](J13-LIFECYCLE-AUTHORITY-CONTRACT-CANDIDATE.md), abbreviated LAC. LAC remains the one home of D01-D10 and T01-T13; the [Bounded Convergence Review](J13-BOUNDED-CONVERGENCE-REVIEW.md), abbreviated BCR, remains the home of W01-W18 and G01-G14. This map connects that design to real source boundaries and records migration, reversible testing and closure decisions. It is not another replacement lifecycle contract or an implementation ticket authorizing production edits.

The user's latest requirement is a seamless integrated app whose behavior can be added, removed and refined during testing. The selected response is **replaceable behavior behind stable contracts, with preserved authority, business history and proof**. Reversible code selection is not reversal of money movement, messages, provider grants or data destruction. No zero-defect or universal rollback guarantee is made.

## 1. Declared scope and Q1-Q4 disposition

The reviewed core consists of the named shared connector controller/registry/credential/health/activity paths; Google suite, shared refresh and dedicated Drive lifecycle paths; retained WhatsApp/Meta/payment callback boundaries; and their legacy-credential, governance, occurrence and recovery dependencies. Provider-specific evidence not reread here is marked inherited. This scope does not include every adapter, raw-SQL writer, admin job, deployed registration or live tenant configuration.

| Work item | Result | What has been resolved | What the result does not claim |
|---|---|---|---|
| Q1 Local commit/authority map | CLOSED AT NAMED SOURCE-MAPPING SCOPE | Actual consumed entities/keys, endpoint guards, DB-client behavior, missing transaction/authority interfaces and reusable owners are mapped in section 2. | Every schema model or generic executor has been audited; required constraints are already implemented. |
| Q2 Google remote dependencies | CLOSED AT SOURCE/DESIGN SCOPE; REMOTE CONFIGURATION DEFERRED | Service fields, client/exchange sharing, account-lineage limits, refresh inheritance and the dedicated-Drive cross-path consequence are mapped in section 3. | Live accounts/grants are inspected; Google was called; every Google connector consumer conforms. |
| Q3 Callback/registration ownership | CLOSED AT NAMED BOUNDARY SCOPE; ACTUAL REGISTRATIONS DEFERRED | Routing keys, verifier/tenant/effect roles, compatibility-URL ownership and teardown uncertainty are mapped in section 4. | Local URL/secret presence proves a provider subscription, or historical payment admission grants fresh effects. |
| Q4 Bounded closure decision | PROVISIONAL TARGET ALIGNMENT FOR THE DECLARED CORE | Existing decisions survive this source comparison; the migration order and reversible testing requirements are explicit, and all 32 inherited cases are linked to them. | Whole-provider-estate convergence, execution readiness, passing application tests, or the whole app being finished. |

The new engineering-safety cases R01-R12 extend the design inventory to 44. These are local case labels, not canonical finding/recommendation IDs. Their machine index is [J13-INTEGRATION-TEST-MANIFEST.yaml](J13-INTEGRATION-TEST-MANIFEST.yaml); it is a design inventory, not a running test harness.

## 2. Q1 - Local commit, storage and authority map

### 2.1 Current source-to-contract boundaries

All implementation references in this section are at the fixed baseline. F references below refer to source-manifest entries in section 11, not canonical F### finding IDs.

| Current owner / entrypoint | Actual consumed data or key | Current authorization / commit behavior | Contract destination and necessary change |
|---|---|---|---|
| ConnectorController, generic authenticate/reconnect/disconnect/credential routes | businessId route; connector type; registry lookup; credential schema | AuthGuard + BusinessGuard; business/type are passed to services. The inspected APIs do not carry an exact current connector-management decision into a shared lifecycle transaction. [H1, F01] | T01-T06: pass actor/delegation, exact operation/target and expected lifecycle coordinates; preserve ordinary authentication and tenant checks. |
| ConnectorCredentialsService.setCredentials / clearCredentials | ConnectorStatus via `businessId_connectorType`; `metadata.encryptedCredentials`, status/account/time/error fields | Read/merge metadata followed by upsert; installation marks connected; central clearing marks disconnected. No observed current-intent/generation condition or one transaction covering Business credentials and lifecycle. [H1] | T04-T06: retain encrypted storage, but make it subordinate to the lifecycle owner. Unmatched expected-state updates reject; do not upsert a new active grant after conflict. |
| ConnectorCredentialsService.readCredential | Central credential key, then `Business.metaData[legacyMetaKey]` | Central absence can fall back to legacy metadata without a current-lifecycle predicate. Central clearing alone does not revoke this reader. [H1, SUP] | T07/T13 and current-purpose credential access: migration must retire or fence the reader, not just copy/delete central values. |
| ConnectorController.updateInboxConfig / getWebhookInfo | Same ConnectorStatus key; intake preferences; central webhookSecret | Config update does not directly set connected on update. Missing-secret GET calls setCredentials, which does. [H1] | T01 config-only revision and explicit provisioning mutation; read-only inspection cannot grant participation. |
| Registry smoke/test/orchestration | businessId/type; connector result; status upsert on smoke success | Successful smoke completion writes connected after an await. Ordinary test is a direct nonwriter. Reconnect logs a disconnect exception and continues. [H1] | T08 observations; T06 local revoke receipt distinguished from T12 remote cleanup. Do not make an existing nonwriter into another lifecycle owner. |
| HealthMonitor / ActivityService | ConnectorStatus selected by monitored status; activity-log business/type | Monitor selection excludes disconnected but late failure upsert is unfenced. Its own successful branch does not write. Shared logger writes ConnectorActivityLog only. [H1] | T08 conditional current projection; retain old observations under original provenance. Activity log is not a lifecycle commit receipt by itself. |
| GoogleSuiteController auth-url / callback | businessId + services; signed state/code; suite callback result | Start has AuthGuard + BusinessGuard, but actor identity is not passed to buildAuthUrl. Callback relies on signed state. Redirect can report google=connected after the service returns without inspecting every verification outcome. [F04, H2] | T02-T05: durable actor-bound per-service intent targets; current authority at activation; return per-service activation/readiness truth. OAuth redirect authentication remains protocol-specific. |
| GoogleSuiteService.handleCallback | Business.id; per-service email/access/refresh/expiry; ConnectorStatus compound key | Business credentials written before awaited verification and per-service status upserts. Same exchange material is provisioned for granted services. [H2] | Stage non-live credentials; per-target activation under common intent/authority ordering; no partial credentials/status sequence may independently create authority. |
| Shared GoogleTokenHelper | Business.id; service-specific access/refresh/expiry triplet | Reads values, requires refresh presence, awaits token exchange, then updates access/expiry by Business.id and returns token. [H2] | T07: current grant plus credential-version/rotation ownership at install and later use. Returned token must not be a portable bypass of the admission decision. |
| Dedicated Drive controller/service | Business.id; driveEmail/access/refresh/expiry | Guarded start/disconnect; callback verifies state then calls saveDriveCredentials(businessId, code). Dedicated disconnect only clears Business fields. Refresh and credential saves are separate Business updates. [F05] | Same T02-T07 contract as generic connector path; no dedicated-route exception. Body or callback cannot invent actor/current grant. |
| GmailIngestionService | Business Gmail tokens; ConnectorStatus metadata.lastHistoryId; KeyInbox message/thread and contact resolution | Token acquisition precedes message work. Completion writes connected/intakeEnabled/cursor despite possible per-message errors; failure writes error. [H1] | T08/T09: separate preferences, cursor and lifecycle; local effects need current admission and claim; checkpoint progress requires durable per-message consequence ownership. |
| PrismaService -> @keyflow/db client | Shared extended Prisma client, Business root, selected tenant models | Service is a wrapper over db, not an automatic transaction spanning injected services. DB query extensions cover named operations when context is active. [F02] | Reuse the extended client and explicitly propagate its transaction client through all participating repositories/services. No convenience unextended client or nested independent transaction. |

These mappings identify the integration gaps at their consumers. They do not claim a similarly named field/table is absent everywhere in the repository.

### 2.2 Authority finding and resolution

AuthGuard checks that `req.user` exists; verification of how that principal is established upstream is outside this fresh read. BusinessGuard requires user.id and permits SUPER_ADMIN, Business.ownerId, or a matching member. It does not itself distinguish a connector-management permission or preserve an authority revision into callback activation. [F01]

**Selected resolution:** reuse the existing K2/K3/J25 authority ownership; connector endpoints request an exact manage/connect/revoke/use decision and carry its actor/delegation lineage to T02-T06/T10. OAuth state must reference the current durable intent. The callback must consume current authority or an explicitly valid bounded delegation, not the principal's former membership. Membership/policy invalidation and the material commit need a shared ordering/version rule; an unrelated pre-transaction role read is not enough. J13 does not create a second role system.

This is a source-level integration obligation, not an assertion that all ordinary members are malicious or that OAuth redirect endpoints require the normal HTTP business guard.

### 2.3 Existing storage seams and exact missing interface requirements

The inspected Business schema has Google service triplets, account/display fields, calendar settings, contactsSyncToken, Drive cursor relationship, inventory-linked sheet fields and metaData. ConnectorStatus's consumed key is established by source calls to `businessId_connectorType`; its complete DDL and every historical migration were not reread. `UserIdentity(provider, providerSubject)` exists for login identity/RISC. It is **not** evidence that connector grants are already bound to that login subject. [F03]

| Requirement not load-bearing in the traced paths | Existing seam to preserve | Minimum constraint/interface to supply before implementation promotion |
|---|---|---|
| One current local grant and monotonic revocation | Current business/type selector and registry | Non-reused grant identity, authority revision, expected-target revoke, immutable operation receipt and rejection on stale target; no active upsert fallback. |
| Revocable OAuth intent and per-service targets | Signed state, suite services and dedicated callback | Unique intent/target; actor/delegation + expected selector/revision; expiry/supersession/one-time consumption; per-target activation receipts. |
| Credential rotation and remote family identity | Encrypted credential storage and Business triplets | Credential version/reference; exact provider account/client and established authorization-family relationship; compare version at install and use. Unknown relationship remains explicit. |
| Local atomic transition + evidence | Shared Prisma client; existing domain/event/claim owners | Pass a transaction client through participating writes; unique receipt/request fingerprint; durable event intent with the transition. A post-commit in-process emit alone does not satisfy durability. |
| No double consumer/effect on switch | J14 occurrence and K11 claim/idempotency seams | Same occurrence/effect identity across variants; one effect owner; attempt-level receipts; no blind replay of confirmed work. Generic claim implementations remain subject to their existing J18 proof obligations. |
| Projection-only observations | ConnectorStatus/ActivityLog and existing domain cursors | Observation basis and ordering, config/cursor revisions, conditional current projection, no grant write from activity. |
| Cleanup scoped to old remote authority | Provider identities/mappings and J18 recovery vocabulary | Exact target/dependency scope, cleanup-purpose authority, persistent conflict barrier and outcome certainty; no newest-account lookup for an old cleanup. |

**Physical migration boundary:** these are required shapes/constraints, not seven mandated new tables. Existing ConnectorAccount/IntegrationConnection/ChannelConnection and claim/evidence models must be examined for reuse before final DDL is selected. Their names alone are not conformance evidence. This bounded map resolves the consumer contract and missing interfaces; the whole-schema reuse pass, SQL design, index/backfill lock impact and runtime compatibility remain execution-readiness prerequisites. Do not create parallel account or claim stores by copying this table.

### 2.4 Tenant isolation and transaction composition

The actual client chains soft-delete, pagination, tenant-read isolation, per-model tenant-write isolation and token encryption. Later code hooks create/createMany/upsert; an earlier comment saying those operations are unhooked is historical and must not override the implementation. Scoping requires an active context and an included model. Business is the tenant root; raw SQL and nested relation forms are not automatically proven safe by this extension. [F02]

Selected integration rules:

- Keep explicit business/account predicates, including callbacks and background jobs; do not assume HTTP context exists there.
- Preserve encryption and tenant extensions inside the exact transaction path; test that property rather than assume generated Prisma types prove it.
- The logical grant gate, target/credential commit and required local business consequences must share the intended transaction/order boundary. A service accepting only global PrismaService access cannot silently escape to another client while its caller holds a lock.
- Lock/order the same relevant records for revoke and use; establish missing-row uniqueness. Avoid provider I/O inside a DB transaction that may be retried. PostgreSQL row-lock semantics support this design, but do not prove the application already implements it. [E02]
- Preserve J6/J18/J23 failure/retry ownership. A control wait, transaction conflict, provider timeout and confirmed rejection have different outcomes.

Q1 closes with these concrete source-to-contract requirements. It does not authorize a schema patch or claim that an unexecuted transaction design is safe in the deployed database.

## 3. Q2 - Google credential and remote-dependency map

### 3.1 Service coordinates actually represented

All rows below share Business.id as the current persistence coordinate in the inspected schema/suite; they are not six independent provider-authenticated grant histories. [F03, H2]

| Suite target | Connector type | Business field family | Additional existing coordinates / qualification |
|---|---|---|---|
| gmail | gmail | gmailEmail / gmailAccessToken / gmailRefreshToken / gmailTokenExpiry | Ingestion cursor lives in ConnectorStatus metadata in the traced path. |
| calendar | google_calendar | calendarEmail / calendarAccessToken / calendarRefreshToken / calendarTokenExpiry | calendarId, calendarSyncEnabled/direction/settings; these are resource/preferences, not proof of OAuth lineage. |
| drive | google_drive | driveEmail / driveAccessToken / driveRefreshToken / driveTokenExpiry | Dedicated Drive service reads/writes the same triplet; DriveSyncCursor relationship and linked inventory sheet coordinates exist. |
| forms | google_forms | formsEmail / formsAccessToken / formsRefreshToken / formsTokenExpiry | Suite verification branch uses granted-scope evidence without a live Forms probe. |
| contacts | google_contacts | contactsEmail / contactsAccessToken / contactsRefreshToken / contactsTokenExpiry | contactsLastSyncAt and contactsSyncToken need account/revision compatibility on reconnect. |
| business_profile | google_business_profile | bpEmail / bpAccessToken / bpRefreshToken / bpTokenExpiry | bpAccountId / bpLocationId are resource identifiers, not a complete credential-family lineage. |

`googleSuiteEmail` is a display/account preference, not a durable authorization-family identifier. Both suite and dedicated Drive use GOOGLE_CLIENT_ID/SECRET, but deployed values, Google project configuration and live grant ownership were not inspected. Do not derive cross-tenant sharing from an equal email.

### 3.2 New cross-path refinement: later Drive calls can use restored access

The shared helper's already-established race is:

```text
read access/refresh/expiry under old connection
-> refresh request in flight
-> disconnect clears stored fields
-> refresh succeeds and writes access + expiry, returns token
```

It does not restore refresh. Its next invocation requires refresh and therefore remains blocked without another restoration. However the dedicated Drive service has a different predicate: it first requires access, refreshes only if expiry is near/expired AND refresh is present, otherwise returns the access value. [F05, H2]

Consequently a valid unexpired access token restored by a late refresh can be consumed by a **subsequent dedicated Drive operation** without the refresh field having been restored. This is conditional static composition of two inspected paths, not a live incident, not universal provider availability, and not a claim that shared-helper calls now succeed. It strengthens F227/C177 and M004-06 without allocating a new root.

Migration must route **both** token consumers through current grant/use admission. Fixing only shared GoogleTokenHelper, or only clearing refresh, leaves the dedicated consumer outside the contract. Test fixtures must include this cross-path sequence, not only repeat the same helper twice.

### 3.3 Missing refresh material and account changes

Suite provisioning explicitly omits writing a refresh column when tokens.refresh_token is absent. Therefore it can leave a previously stored value in place. The source does not establish that the old refresh and newly returned access token belong to the same account/family. Whether a provider response with those conditions occurs in a deployed flow is not proved here. [H2]

Selected migration policy: reuse old refresh material only after positive same-account/client/family compatibility evidence; otherwise stage the new access material with missing refresh readiness, or require a new connect flow. Never fabricate a complete credential pair from a display email. Dedicated Drive's assignment of a possibly absent response field also requires version-specific ORM characterization rather than an assumption about undefined handling. No ORM upgrade is selected.

### 3.4 Local service disconnect versus remote authorization revoke

Google documents that combined authorization can include scopes from multiple clients in one project, and revoking that authorization removes its scopes for the associated user. That is an external constraint, not evidence that baseline disconnect calls revoke. [E01]

Selected responsibilities:

```text
Drive-only local disconnect
 -> revoke Drive's local participation and pending Drive targets
 -> preserve independently authorized sibling services
 -> do not blindly revoke a shared provider authorization

explicit remote authorization revoke
 -> establish affected account/client/project scope and authority
 -> block affected local uses and conflicting activation
 -> perform named cleanup through J18 certainty/attempt ownership
 -> keep unknown propagation/outcome visible
```

Per-service partial suite activation, shared credential rotation and remote cleanup therefore use distinct coordinates. A newly cancelled token or losing CAS result must not automatically be remotely revoked: its provider scope may overlap a valid sibling or new grant.

For legacy rows whose relationship is unknown, migration records UNKNOWN, blocks unsafe destructive cleanup and asks for explicit reconnection/adoption where needed. Unknown scope is not permission to keep normal revoked work live. Actual provider registration IDs, user/client/project dependency evidence and teardown outcomes remain G09 deployment prerequisites.

Q2 is analytically closed at this source/design boundary. The remote-provider evidence debt is not falsely converted into a pass.

## 4. Q3 - Callback, identity and cleanup responsibility

| Surface | Actual available identifiers / current behavior | T09/T11 admission owner | T12 cleanup boundary / migration |
|---|---|---|---|
| Shared WhatsApp webhook | Parsed provider occurrence/message identity; Meta authentication; phone_number_id resolves Business.metaData.whatsapp.phoneNumberId; receiveInbound precedes activity logging. No current-grant check is visible before normal processing. [F06] | J14 verifies/binds/identifies; J13 admits the permitted use; J5 owns downstream conversation policy and bounded consumers. | Mapping deletion/status is local. Handshake secret/URL does not establish a subscription receipt. Preserve historical mapping separate from live route authority. |
| Shared Meta social webhook | Signature; page/recipient ID; SocialConnection platformId + platform resolves business; absent mapping returns unrouted. [F07] | Preserve absent-mapping boundary; require current use admission after trusted binding; same-page recreation does not identify old event origin. | Local SocialConnection removal is not provider unsubscribe. Identify the real remote owner and other dependents before deletion. |
| Scoped Meta webhook | Signature plus URL businessId and Business existence; inspected path does not require corresponding account/connection lookup. [F07] | J14 must establish trusted account-to-tenant binding independently of the URL, then consume the same J13 decision. | Compatibility URL cannot retain weaker tenant/admission semantics after main route cutover. |
| Legacy Stripe /webhooks/stripe | Signature/raw body; invoiceId from metadata or client_reference_id; commerce.markInvoicePaid; invoice business lookup; optional connector activity carries session.id. Actual body mutates directly despite comment describing forwarding. [F08] | Verified historical effect must be correlated to tenant/account/original operation; J18/domain owns reconciliation. Current provider authenticity alone cannot reactivate connection. | Keep URL only as compatibility transport into one canonical verifier/binder/processor; characterize effect/evidence parity before migration. No dual live applicators. |
| Main payment Stripe/PayPal processing | Existing verification, payment/invoice and provider-event/effect correlation from SUP/BCR; PayPal capture may invoke connected activity writer. [SUP, H1: inherited here] | T11 known-effect reconciliation distinct from T10 fresh effects and J14 occurrence claim. Not all late payments are unauthorized merely because a connector was disconnected. | Retain old effect evidence and appropriate verifier/account context without authorizing new effects. Actual configured provider endpoints/secrets/registrations remain uninspected. |
| Customer-outbound Webhook CRUD | Webhook.id/businessId, url, events, secret, isActive; dispatcher test/delivery functions. [F08] | This is a separate outbound subscription/delivery concern, not an inbound provider subscription registry. | Do not delete these rows as alleged Stripe/Meta/Gmail provider cleanup. Preserve tenant-scoped removal and delivery identity. |
| Gmail/Drive watch; QB/Xero callback | Not established by the retained bounded traces. [SUP] | No fabricated callback route or generation evidence. Pull use is admitted by its actual work/credential path. | No invented unsubscribe operation; unsupported/unknown registration remains explicit, not confirmed absent across the repository. |

The scoped WhatsApp and concrete provider-disconnect behavior not freshly read here retain SUP's evidence classification and limitations. This map does not elevate comments or emitter names into live remote subscription proof.

### Registration ledger required for later rollout

For each actual remote object, implementation-readiness evidence must identify: provider, stable account/client/project scope, tenant/local grants depending on it, native registration ID when supported, callback destination/verifier context, origin and current ownership, whether deletion is target-specific or broader, cleanup method/required authority, unresolved attempts, and compatibility with N+1. Record references and non-secret metadata, not credential values.

If registration was created manually in a dashboard, its accountable owner and observed configuration are still required. If no registration is established, mark NOT_ESTABLISHED rather than deriving one from a URL. No live dashboard or provider mutation occurred in this review.

Q3 closes the named responsibility map. It does not close G09 actual deployment evidence or J14's wider ingress inventory.

## 5. Integration decisions: one owner, incremental replacement

The blueprint's §6.3 distinguishes isolated construction from seamless user-facing integration, and §6.1-6.2 permits controlled changes rather than dogmatic stack/logic adherence. [P01] For this existing application, the **current recommendation** is incremental isolated tests plus immediate cross-boundary integration rehearsal for every changed slice. That adaptation is not a claim that the older document literally specified this sequence, and it does not reapply its initial-stack scaffold over the current repository.

### 5.1 Six dependency-ordered integration slices

These are migration/planning units, not authorized KF-EXEC packets or implemented services.

| Slice | Dependencies | Existing owners affected | Admission to integration | Safe withdrawal |
|---|---|---|---|---|
| I0 Environment and proof isolation | none | Existing Vitest/build/test configuration and execution workflow | Dedicated resources, selected nonempty cases, positive environment validation, preserved assertions and negative controls | Tear down only the verified run-owned sandbox; retain result evidence. |
| I1 Compatible storage and receipts | I0 | @keyflow/db, existing selector/account/claim/evidence models | Additive schema/reference design, tenant/encryption behavior, uniqueness, old/new-reader characterization; physical reuse analysis completed first | Keep expanded schema and tombstones; use compatible reader, not destructive down migration. |
| I2 Lifecycle and credential authority | I1 | Registry, credential service, suite/Drive entrypoints and all named live credential consumers | Exact authority/intent/version gate; no legacy consumer/writer outside protected migrated scope | Deny affected new work or use a proven conforming reference. Never fall back to the unfenced baseline. |
| I3 Local consumers and projections | I2 | Gmail ingestion, health/activity, WhatsApp/Meta routing and J14/J5 consumers | One occurrence/consumer owner; no status regrant, no intake overwrite, bounded cursor progress and transaction-context propagation | Stop new claims; preserve already-applied domain work, pending receipts and historical review. |
| I4 External effects and remote cleanup | I2, I3 | Payments/provider adapters, K11/J18, registration/dependency owners | Exact effect/attempt identity, current authority and remote-scope proof; canonical compatibility routes | Block new admissions, reconcile admitted attempts, retain cleanup barriers; no automatic inverse provider action. |
| I5 UX and integrated rollout | I3, I4 | Existing connect/management/attention/public-flow consumers | Real outcome-based status and mixed-version API/event compatibility; supported dependency combinations only | Disable optional presentation/automation; preserve established evidence and safe manual/recovery path. |

A slice existing in source is not permission to route users through it. I2 cannot claim protection while an old instance, callback, task or raw reader in that migrated scope can still use credentials outside it. Before protection is claimed, such paths must conform, be denied, or be drained/isolated. Legacy behavior may remain for a separately declared unmigrated scope, which must not be advertised as protected.

### 5.2 Synchronous and asynchronous boundaries

Use synchronous coordination for the immediate user result that must be correct together, using authoritative domain owners and a shared local transaction where appropriate. Use durable event/queue intent for later work. Neither in-process event emission nor a pile of direct cross-service calls supplies that guarantee alone.

For the booking-to-payment journey, the integration rehearsal must check contact/booking/invoice relationships and failure cases without creating an orphan invoice or duplicate reservation. This is a **cross-journey acceptance requirement**, not a new claim that those modules were traced or fixed in this tranche. J3/J4/J7 retain their existing ownership/contracts.

Schema/event/API versions and causal IDs must cross the frontend/backend/worker boundary. A compatibility route may transform transport but must not introduce a second domain effect owner. Shadow execution must never emit real events that trigger ordinary domain consumers.

## 6. Reversible experimentation and testing contract

### 6.1 What can be changed versus what must remain true

Optional UI, matching/ranking logic, workflow composition, provider adapters and candidate implementations can be enabled, disabled, replaced or removed in a verified test environment. Each variant declares its dependencies and supported contracts. Unsupported combinations are rejected explicitly, not made to appear successful.

Regardless of variant, preserve tenant/account separation, current authority/revocation, exact effect ownership, secret protection, truthful evidence, and the ability to reconcile historical outcomes. These are acceptance invariants, not feature flags to turn off because a test is red. A legitimate change to a requirement is possible through explicit review, a superseding contract and retained regression evidence; automatic agents may not silently weaken gates. This follows the repository OS constitution, which remains unmodified. [F11]

### 6.2 Modes and effect ownership

| Proposed mode | Permitted behavior | Required default / limitation |
|---|---|---|
| DISABLED_SAFE | No new normal use/effects for the disabled capability; bounded historical evidence/reconciliation remains separately authorized | Safe when no conforming implementation is available. Not a connection revocation undo. |
| SAFE_REFERENCE | Run an explicitly characterized reference implementation behind the same invariant checks | The current buggy baseline is not automatically a safe reference. |
| SHADOW_COMPARE | Evaluate a pure candidate against fixture/sanitized observation copies; compare decisions | No live credential acquisition, provider calls, domain writes, ordinary event publication or consumer cursor changes. Separate shadow telemetry only. |
| CANDIDATE_SANDBOX | Run candidate against dedicated fake/provider-sandbox accounts and isolated data/resources | Explicit environment/capability admission. No production credentials or destinations. |
| CONTROLLED_CANARY | Later authorized tenant-scoped exposure with proof, rollback and observability gates | Not enabled or authorized here; rollout freshness and mixed worker versions must be characterized. |

One actual effect owner is selected for each operation. Variant identity is recorded with occurrence/effect/attempt and contract version. A mode switch cannot cause both variants to send, charge, create contacts or claim the same effect. Resume/retry retains the logical identity; a new mode does not give a previously completed child new work to perform.

Snapshot the selected implementation for an admitted operation, but recheck current revocation, safety stop and material authorization at the defined admission/commit boundaries. Sticky variant assignment must not override a later safety stop.

### 6.3 Use existing flags without treating them as authorization

GrowthBookService is present in the pinned source. It evaluates through isEnabled/getValue and returns the calling code's fallback when disabled, uninitialized, unknown or evaluation throws. It initializes the client with a timeout; the inspected wrapper does not itself establish a tested fleet-wide kill-switch propagation guarantee. Current SDK documentation describes update mechanisms, but its examples must not be assumed available/configured in the pinned package range. [F09, E04]

Selected constraints for its use:

- Reuse this service for exposure/variant choice rather than adding another experimentation SDK by reflex. Existing navigation flags remain presentation controls, not security decisions.
- Validate returned mode and trusted tenant targeting attributes. `toUserContext` spreads extra attributes after reserved values; callers must not allow untrusted id/businessId overrides. This is a required caller discipline, not a claimed demonstrated exploit.
- Record configuration/version provenance with the operation. Unknown/invalid mode or unavailable config must route to a proven safe reference or DISABLED_SAFE, never silently to old unfenced behavior.
- A cached ON value during service outage must not bypass the local authoritative stop/revocation decision. The exposure service is not the durable grant gate.
- Characterize update freshness, restarts, multi-worker agreement and mode changes before claiming rapid rollback. SDK caching is not evidence of instantaneous global change.

### 6.4 Safe add / disable / replace / remove sequence

```text
ADD
 -> declare interface, dependencies, migration and proof obligations
 -> register default-disabled variant
 -> isolate tests -> contract tests -> integrated fixture journey
 -> compare shadow decisions without live effects
 -> enable sandbox variant only after its prerequisites pass

DISABLE
 -> stop new admissions/claims
 -> drain/cancel eligible work under policy
 -> preserve admitted/in-flight outcome and reconciliation ownership
 -> surface capability unavailable, not false success

REPLACE
 -> compatible storage/API/event contract
 -> same logical effect IDs, one writer
 -> switch explicitly at eligible operation boundary
 -> verify old/new interaction and negative controls

REMOVE
 -> prove no active consumer/worker/pending intent still needs the variant
 -> retain required history/tombstones/receipts
 -> archive or retire code/config after compatibility and review
 -> remove physical data only under separately approved retention/migration rules
```

Re-enabling creates no automatic reconnect and replays no completed effect. Existing revoked grants remain revoked. Arbitrarily removing a mandatory dependency is a configuration error, not a supported freedom to lose safety.

### 6.5 Database and external-effect rollback are different

During experimentation, prefer additive storage changes, staged backfills with provenance, version-compatible readers, and delayed retirement. Test old reader/new schema, new reader/expanded schema and interrupted backfill. Only permit code rollback to a version known to understand retained revocation/receipt semantics. If none exists, disable the affected feature and repair forward; do not reinstall an unsafe binary under the label rollback.

A deleted optional module must not delete invoices, decisions, provider operation IDs or unresolved cleanup evidence. An external action already performed requires its domain-native reversal/compensation or reconciliation, with appropriate authority. Restoring a database snapshot can itself lose later business truth; it is not a routine feature-toggle operation and is not authorized here.

## 7. Test-environment and proof integrity findings

### 7.1 Actual test infrastructure pressure

The server package exposes unit/smoke/integration scripts, with Vitest as the runner. `vitest.integration.config.ts` sets `passWithNoTests: true`. A process exit code alone therefore cannot prove the intended selected suite existed. [F10]

The inspected social-sync regression test loads the repository-root .env, uses fixed `tss_` fixture IDs, and performs best-effort raw prefix cleanup before/after the tests. The assertions are useful regression evidence in source and must be preserved. The file does not prove that its database is dedicated to one run. Two concurrent runs against the same database could share those coordinates; no actual collision or production database use is claimed. No .env was opened and no cleanup/test was executed. [F10]

### 7.2 Selected test preflight

Before any future write-capable test or cleanup:

1. Establish a dedicated database/resource set and a restricted test role, using a positively verified environment identity. A URL containing the word test or a NODE_ENV value alone is insufficient.
2. Assign a unique run ID and resource ownership manifest: DB/schema, fixture tenant IDs, queue prefix, storage prefix/bucket, callback destination, fake/provider-sandbox account, and clock/seed. Never rely on a fixed global prefix alone.
3. Deny production resources/credentials and uncontrolled network egress. Use explicit fake/local endpoints by default; sandbox-provider tests need separately authorized account and destination checks.
4. Resolve required cases to actual runner tests. Missing bindings, empty discovery, skipped/failed required cases or a failing setup cannot count as proof. Check results, not only exit status.
5. Record source commit, environment fingerprint without secrets, build/artifact version, selected configuration, seed, discovered/executed case IDs, assertions, skips/failures and outputs.
6. Cleanup only resources owned by that verified run. Make incomplete cleanup visible; do not silence it as evidence of success. Keep other runs and all business production history untouched.

The current integration config is not edited here. These requirements are to be implemented/verified through the engineering-safety work, subject to the existing human-reviewed gate-change policy.

### 7.3 Multi-agent execution and composability

Claude Code and Kimi Code should use separate branches/worktrees for nonoverlapping authorized slices and separate test resource namespaces. Git worktrees provide separate working directories; they do not by themselves isolate databases, provider accounts, queues or secrets. [E03; resource-isolation consequence is our design reasoning]

One integrator owns the combined dependency order and shared schema/API/lockfile edits. Both agents consume the same current-state and contract manifest. Results include exact diffs and executable evidence, not mutual declarations that the other agent tested it. A reviewer should independently challenge the changed assumptions and negative controls; no agent approves its own production merge under the repository operating rules.

Feature-specific tests may be added or explicitly retired when their requirement changes. Mandatory isolation/authority/history/effect-uniqueness gates cannot be removed just to make a variant pass. Pairwise combinations can help exploratory coverage, but critical cross-journey and boundary races remain named mandatory cases; no assertion that all possible combinations have been tested is made.

## 8. Case-to-migration coverage

COVERED below means **the design and migration responsibility are specified**, not that the baseline passes. LIMITED marks an intentionally bounded external guarantee. Every case has application/runtime status NOT_EXECUTED.

### 8.1 All 32 inherited cases

| Case | Concrete mapping / required assertion | Integration slices | Analytical disposition |
|---|---|---|---|
| P01 | Shared WhatsApp old-grant first arrival cannot start normal domain work before T09 admission | I2/I3 | COVERED |
| P02 | Same-phone reconnect keeps old/unknown origin distinct from present adoption | I2/I3 | COVERED |
| P03 | Meta mapping absent/recreated preserves route and use-admission distinctions | I2/I3 | COVERED |
| P04 | Scoped Meta signature plus URL is not independent tenant/account binding | I3 | COVERED |
| P05 | Historical settlement/refund completes permitted local consequences once without reconnect/new effect | I3/I4 | COVERED |
| P06 | Uncorrelated payment/callback stays uncertain and reviewable | I3/I4 | COVERED |
| P07 | Payment activity cannot write new grant authority | I2/I3 | COVERED |
| P08 | QuickBooks legacy fallback cannot authorize revoked use | I2 | COVERED; actual tenant secret presence uninspected |
| P09 | Xero smoke stays diagnostic; central tenantId/account guard survives | I2/I3 | COVERED |
| P10 | Central-only credential deletion remains blocking without another admitted path | I2 | COVERED |
| P11 | Revoke and an already-admitted external attempt preserve exact outcome, not retroactive no-effect claims | I2/I4 | LIMITED; provider outcome unexecuted |
| P12 | Remote timeout/failure leaves local revoke intact and cleanup uncertainty visible | I4 | LIMITED; actual target/scope proof required |
| M004-01 | Cancelled signed OAuth intent cannot install live credentials through either Drive entrypoint | I2 | COVERED |
| M004-02 | New intent supersedes old callback at expected-target activation | I2 | COVERED |
| M004-03 | Generic and dedicated Drive revoke have the same authoritative postconditions | I2 | COVERED |
| M004-04 | Old activity remains observation, not authority | I2/I3 | COVERED |
| M004-05 | Reconnect uses a new grant and current authority; only intended targets activate | I2 | COVERED |
| M004-06 | Late shared/dedicated refresh is fenced; subsequent dedicated Drive read cannot use restored access after revoke | I2 | COVERED; fresh cross-path refinement in section 3.2 |
| N01 | Registry smoke result arriving after revoke cannot update grant/current projection | I2/I3 | COVERED |
| N02 | Late monitor failure cannot replace disconnected with current error/expired authority | I2/I3 | COVERED |
| N03 | Webhook-info GET cannot create a grant; secret provisioning is explicit | I2/I5 | COVERED |
| N04 | Gmail completion cannot overwrite intake revision/cursor lineage or hide unresolved message work | I3 | COVERED contract; concrete durable per-message recovery binding required |
| N05 | Partial suite result does not restore a cancelled service or report every service live-verified | I2/I5 | COVERED |
| N06 | Local revoke failure stops replacement; uncertain remote cleanup blocks conflicting remote-scope activation | I2/I4 | LIMITED to evidenced remote scope |
| A01 | Same-grant competing refresh uses credential-version/rotation ownership, not generation alone | I2 | COVERED |
| A02 | Membership/authority change during consent invalidates unsupported activation | I2 | COVERED; existing K2/K3 ordering must participate |
| A03 | A retried old disconnect cannot revoke N+1 | I2 | COVERED |
| A04 | Lost exchange response becomes exchange-unknown, not assumed retry-safe | I2/I4 | LIMITED; provider-supported recovery required |
| A05 | Local Drive disconnect does not blindly revoke sibling Google authorization | I2/I4 | COVERED design; deployment dependencies uninspected |
| A06 | Stale remote cleanup cannot race new/sibling registration without conflict barrier or independence proof | I4 | LIMITED; G09 remains |
| A07 | Missing refresh on new access grant cannot inherit an unrelated old account token | I2 | COVERED |
| A08 | Indistinguishable first arrivals remain unknown-origin; explicit adoption is a separate decision | I3 | COVERED |

### 8.2 Twelve reversible-integration cases added

| Case | Required assertion | Slices |
|---|---|---|
| R01 | Add -> enable -> disable -> re-enable -> remove variant preserves grant revocation and does not duplicate completed effects | I2/I3/I4/I5 |
| R02 | Mixed binary/schema versions and rollback retain readable business history, tombstones and receipts | I1/I5 |
| R03 | Empty discovery, missing bindings, skipped required tests or failed setup cannot produce an accepted proof report; negative control fails as expected | I0 |
| R04 | Wrong/shared/production resource identity is rejected before fixture creation or cleanup | I0 |
| R05 | Two concurrent agent/test runs cannot see or delete the other's DB/queue/storage fixtures | I0 |
| R06 | Shadow comparison cannot acquire live credentials, send provider requests, emit live events or mutate business/cursor state | I0/I3/I4 |
| R07 | Missing/invalid/stale/outage flag state cannot bypass a current safety stop or route to an unsafe fallback | I2/I5 |
| R08 | Mid-operation mode switch preserves exact logical identity and single effect owner; later safety revoke still applies | I2/I3/I4 |
| R09 | Removing an optional consumer is explicit and recoverable; removing a required dependency rejects activation instead of false success | I3/I5 |
| R10 | Withdrawal/rollback cannot remove a sibling/N+1 remote registration through old cleanup | I4 |
| R11 | Code rollback does not erase settled outcomes or claim external undo; compensation is a separately authorized effect | I1/I4 |
| R12 | Legitimate test/requirement evolution has reviewed supersession and retained safety regression; weakening a red gate is rejected | I0/I5 |

Additional future cases are welcome. Retiring a case requires identifying its superseding requirement/coverage and review, not silently reducing an expected count. The manifest's 44 count describes this checkpoint only; it is not a permanent ceiling or permission to remove a safety obligation.

## 9. Q4 - Bounded convergence and cross-kernel reinjection

### 9.1 Decision

**Select provisional target alignment for the mapped J13 core.** The lifecycle contract is no longer awaiting another general definition or repeated generic provider scan. The named source paths now have an owner, key, required authority/transaction boundary, migration slice, proof obligation and explicit external limit. This closes the Q1-Q4 analytical loop at its declared scope.

This does not mark the entire integration estate converged. Full schema/executor reuse, unenumerated adapters, actual remote registrations, final migration SQL and runtime proof remain separately visible prerequisites. A source path whose transaction/authority integration is not implemented remains nonconforming; documentation does not change its behavior.

F227/C177 remains the finding home. The cross-path Drive refinement is an additional manifestation. Testing/rollout concerns become J24 investigation input, not automatic new findings. No canonical IDs are allocated. The selected LAC stays a candidate document with a bounded acceptance overlay here; its historical next-Q1 instructions are completed, and CURRENT-STATE.yaml owns the live frontier.

### 9.2 Backward re-audit result

| Owner | Result of this map | Integration obligation preserved |
|---|---|---|
| K9 / J13 | Target retained, named conformance gaps made concrete | All credential/route/projection entrypoints consume one lifecycle authority. Local grant is not provider-wide authorization. |
| K7 / K6 | Target retained | Same enforced local ordering across revoke and commit; explicit version/intent/cursor basis; transaction context reaches actual writers. |
| K11 / J18 | Target retained with external limits | Exact effect/attempt/claim survives variant switches, compatibility URLs, cleanup and rollback. Unknown outcome is not safe retry. |
| J14 | Target retained | Provider authenticity, tenant binding, durable ingress and canonical processing remain separate from J13 use admission. No second webhook engine. |
| J5 | Provisional alignment retained and refined | One conversation processing owner; explicit admission and optional-consumer behavior; no automated old-origin relabelling. |
| J2 / J15 / J25 | Target retained | Current connector management/use authority consumes existing control owners, not BusinessGuard membership alone. |
| J12 / K4 / K8 | Target retained | Remove optional behavior without changing document revision, evidence strength, historical truth or provenance. |
| J17 | Target retained | Truthful unavailable/cleanup-pending/in-flight/partial attention, not a green status derived from a normal return. |
| J24 | NEXT PROGRAMME FRONTIER, dossier not created here | Translate I0 and R01-R12 into source-grounded engineering-safety ownership and an authorized isolated verification workflow. |

There is no new parallel authority, flag, ingress, recovery or evidence engine. Kernel refinements are reinjected through this table and the J13 dossier; existing kernel files and LAC definitions are not silently rewritten.

### 9.3 Gate dispositions

| Gate | Current disposition |
|---|---|
| G01 context / G02 preserved evidence | PASS_FOR_BOUNDED_CONTINUATION |
| G03 named writers / G05 bounded anti-duplication | RETAIN_PASS_BOUNDED |
| G04 exhaustive repository/provider coverage | DEFER_EXPLICIT_OUTSIDE_DECLARED_CORE |
| G06 ownership/admission / G07 transition design | PASS_BOUNDED_TARGET_REVIEW_WITH_EXTERNAL_LIMITS |
| G08 migration ownership/order | PASS_SOURCE_TO_DESIGN_MAPPING; FINAL_DDL_AND_RUNTIME_MIGRATION_NOT_DONE |
| G09 actual registration/dependency/teardown evidence | DEFER_DEPLOYMENT_CONFORMANCE_REQUIRED |
| G10 backward re-audit | PASS_BOUNDED_OWNERSHIP_REVIEW |
| G11 case inventory | 44_DESIGNED_AND_MAPPED; NOT_EXECUTED |
| G12 application/provider/migration proof | NOT_EXECUTED |
| G13 convergence | PROVISIONALLY_TARGET_ALIGNED_MAPPED_CORE_ONLY |
| G14 implementation authorization | UNAUTHORIZED |

### 9.4 Remaining evidence debts - not hidden in a green badge

- ED1: whole-schema reuse and exact DDL/index/backfill/rollback-floor design, including existing account/claim models and extension behavior under transactions;
- ED2: complete adapter/worker/legacy-reader conformance outside W01-W18 and a protected-scope cutover inventory;
- ED3: real remote registration, account/client/project dependency, verifier rotation and cleanup outcome evidence;
- ED4: actual case-to-runner bindings, isolated environment enforcement, application/concurrency/provider/migration results and negative controls;
- ED5: deliberate comparison/revalidation against any later implementation baseline before execution; this forensic baseline remains fixed.

ED1-ED5 prevent implementation-readiness or broad correctness claims. They do not require restarting the completed bounded contract/source analysis. Reopen only the specific invariant or path contradicted by new evidence.

## 10. Exact next programme action

**J24_ENGINEERING_SAFETY_AND_REVERSIBLE_TESTING_ACTIVATION**.

Read the existing operating constitution and assurance/handoff protocols, then activate the canonical J24 journey under its existing J24 identity. Start from the concrete F09-F11 test/flag/runtime sources and I0/R01-R12 here. Do not weaken OS.md or existing test assertions. Identify the actual runner/setup/environment/cleanup, build/boot, feature-exposure and integration ownership boundaries, and produce the minimum isolated verification and change-admission design. Keep any implementation PR or runtime/provider action separately authorized.

This is the same whole-system programme moving to engineering safety, not abandoning J13 or opening another ecosystem-selection exercise. J13's mapped-core acceptance, source findings and migration debts remain input to J24 and later global convergence. The J24 dossier is **not created by this checkpoint**; the inherited dossier count therefore remains 19/25, not recounted and not a completion percentage.

## 11. Evidence manifest and exactness

### Fresh source reads in this tranche

All implementation paths are pinned to `8f173bfe79f1418159cf4099ea18b0d60d203ec2`. File identifiers F01-F11 below are local evidence groups, not the canonical F### namespace.

| Ref | Paths / inspected scope | Reproducible anchor / limit |
|---|---|---|
| F01 | apps/server/src/core/auth/business.guard.ts and auth.guard.ts, full | BusinessGuard blob 3d31a1104cac22a70ef29376672e0d0834f335a8; AuthGuard 926619b54f985e173cd6c556c9d1dc51f92db813. Upstream principal creation not re-audited. |
| F02 | apps/server/src/core/prisma/prisma.service.ts; packages/db/src/index.ts; client.ts named extension/read/write/export sections | PrismaService 459ca12dac25a9f619889e128415472e5a21deb7; index 0274ca75461c66685e1c9bfb2e46b24052c1f8da; client 33f8dd53553ffda959466bc14121dc3870dc0d56. Long historical comments are not new runtime proof. |
| F03 | packages/db/prisma/schema.prisma, lines 1-610 | c5f263432b30838b0f9723640282bbdeb2f4cba3. Only this subset read; no complete schema absence/model-count claim. |
| F04 | apps/server/src/core/connectors/google-suite.controller.ts, full | 212e7596ece08d419a236fd908a136054ffc8517; actor propagation and callback redirect. |
| F05 | apps/server/src/modules/google-drive/google-drive.controller.ts, lifecycle routes and direct operation delegation; google-drive.service.ts lines 1-320 | Service 2fe2f2fc6cb4d46fc56f14e182a3491a48f94d58; callback/token/disconnect predicates. Not a full Drive method inventory. |
| F06 | apps/server/src/modules/whatsapp/whatsapp.controller.ts, lines 1-265 | 07fd8e1895dae82e5a1567935c6e9203fa3c5a3f; scoped route continuation remains inherited SUP evidence. |
| F07 | apps/server/src/modules/social/social.controller.ts, lines 1-270 | 1bdb7eba9e8782e702a8933605ca8ea610725ded; shared/scoped callback and verification boundaries. |
| F08 | apps/server/src/modules/webhooks/webhooks.controller.ts, full | b22ce8378f5516c01254082f2929fae1afdb820d; direct legacy Stripe behavior and distinct customer-outbound CRUD. |
| F09 | apps/server/src/core/growthbook/growthbook.service.ts, full | 13fa52d9e06bae72bcdc667fc0e6719356032c6d; exposure seam, fallback and attributes. No deployed SDK/config freshness result. |
| F10 | apps/server/package.json; vitest.integration.config.ts; test/social-sync-unsupported.integration.test.ts, full | fabcc52a15c6f0c62e2128b476098074bcdd242f; 0975d0cce26d8d3a2a1ab3b4761c6c4c6f99109f; b4a4208c38fd2fc03f061bc716176226cf5eda45. Source tests are not executed results. |
| F11 | architecture/os/OS.md and AGENTS.md at intelligence input | OS blob f2a79023740f91e4f520339a1be14036cc997da1. Governing operating instructions, not implementation evidence. |

H1: BCR S01-S07 and W01-W18, inherited pinned-source evidence for unchanged shared paths. H2: LAC E1/E2, including suite provisioning and shared Google helper blob 6087ec1dd1534ab1d5639c7b321b442fa6555bb0. SUP: separately preserved callback/legacy-credential supplement. M001-M004, BCR and LAC are unchanged by this tranche. Their source scopes and earlier corrections remain binding.

Repository search was used only for path discovery; default-main search hits are not a rebaseline. Archived migrations and the generated tenant-model inventory were discovery context, not proof of current deployed schema. No tenant values, credential plaintext, .env contents, production resource or provider dashboard was inspected.

### Product source versus current recommendation

P01: uploaded `KEYFLOW v3.docx`, Execution Addendum sections 6.1-6.3, and isolated/final integration test descriptions. It supports flexible changes and the distinction between isolated building and seamless product flow. It does not prove this app is flawless, that the historical code examples are the current implementation, or that every external effect is reversible. The I/R rollout requirements here are current design recommendations derived from the new user request and repository evidence; they are not silently inserted into that source.

### External primary-source checks, accessed 2026-09-16

- E01: Google, [OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server), incremental/combined authorization and token revocation. Supports the remote-scope constraint, not a live KEYFLOWOS configuration claim.
- E02: [PostgreSQL 16 Explicit Locking](https://www.postgresql.org/docs/16/explicit-locking.html), row-level locks/transactions. Supports the chosen concurrency reasoning; deployed isolation/locks were not measured.
- E03: [Git worktree documentation](https://git-scm.com/docs/git-worktree). Supports separate worktree usage; resource isolation is a separate requirement proposed here.
- E04: [GrowthBook Node SDK documentation](https://docs.growthbook.io/lib/node), update/evaluation mechanisms. Current docs can exceed the pinned package range; no new SDK API, version or upgrade is prescribed by this map.

### Context integrity and persistence boundary

PASS for the bounded Q1-Q4 continuation: the input checkpoint, canonical branch, baseline, active contract, former next action, adjacent owners, ID limits, unpromoted execution status and preserved evidence strands were reconciled from repository reads and this continuous session. Current-state/handoff/rollover and J13/START navigation are refreshed with this result. Historical 04A/10P status snapshots do not override 04B and later re-audits. Future sessions must resolve the live head and matching checkpoint rather than use the input SHA as output.

The only mutations in this tranche are repository intelligence documents. Git persistence verification and any design-manifest consistency check are not application tests. No production code, schema, provider registration, feature flag, queue, environment, test assertion or deployment is modified.
