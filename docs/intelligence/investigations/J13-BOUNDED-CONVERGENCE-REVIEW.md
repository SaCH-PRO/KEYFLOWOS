# J13 — Bounded Convergence Review

Date: 2026-09-16  
Checkpoint: `J13-BCR-2026-09-16-01`  
Status: **BOUNDED REVIEW COMPLETED / J13 NOT CONVERGED**  
Intelligence input: `docs/keyflow-intelligence-foundation@4a5e4f47e3903e71f8bb5aa22e843c9d2f3693f6`  
Implementation forensic baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`  
Production: **READ-ONLY / IMPLEMENTATION UNAUTHORIZED**  
Runtime, provider and adversarial tests: **NOT EXECUTED**.

This review executes `J13_BOUNDED_CONVERGENCE_REVIEW_PREPARATION`. It preserves Microtraces 001–004 and the separately named callback/legacy-credential supplement. It adds new pinned-source writer analysis, a bounded anti-duplication decision, migration ownership, backward re-audit and explicit gate dispositions. It does not claim exhaustive repository/provider coverage or allocate F228, C178 or KF-REC-058.

## 1. Lifecycle ownership table

The following is a **target ownership proposal**, not a description of an implemented unified service. Names such as binding generation and connect intent are working vocabulary, not newly allocated canonical concepts.

| Responsibility | Authoritative owner | Existing seam / current pressure | Must not infer or own |
|---|---|---|---|
| Tenant/provider-account binding; current grant; revocation; reconnect generation | J13 / K9, consuming K1 identity and K3 authority | Concrete connector methods, Google-suite and dedicated Drive flows, retained routing/configuration [M001–M004, SUP] | A provider signature, token, health result or ConnectorStatus label alone is not a current grant. |
| Connect-intent issuance, supersession, cancellation and consumption | J13 / K9, with K7 ordering and K3 authorization | Signed OAuth state and callback credential installation [M004, S06] | Authentic, unexpired state is not proof that the initiating intent remains authorized. |
| Secret storage and credential-reference access | Existing credential service / provider adapters under J13 policy | Encrypted ConnectorStatus metadata, Business token columns and legacy metadata fallback [S01, M003, SUP] | Secret possession must not grant participation. Storage success must not independently grant lifecycle authority. |
| Provider authenticity, trusted account-to-tenant binding, occurrence identity and durable ingress processing | J14 / KF-REC-035, consuming a J13 admission decision | Existing verifier, route and occurrence-processing seams [SUP, R03] | No second webhook engine. Receipt time must not manufacture generation N+1 for an occurrence of unknown lineage. |
| New conversational processing and action proposals | J5 / KF-REC-057, consuming J13/J14 decisions | Existing KeyInbox/MessageIntake composition [R05, R06] | Conversation policy cannot independently reactivate a connector or replace generic action governance. |
| Fresh effect authorization and capability execution | J2 / J15 / K3 / K5 / K6 | Exact-action Clearance and ExecutionClaim targets [R06] | Prior connection, prior approval, late callback or old successful activity does not authorize a changed/new effect. |
| Polling, sync, refresh and delayed work eligibility | K7 work/claim semantics plus J13 binding authority | Gmail ingestion, Google refresh, health monitoring and connector orchestration [S02, S03, S07, M003] | Checking only when scheduling or selecting a row does not protect a later mutation. |
| Health, capability readiness, cursor and activity projections | Respective adapters/projectors; subordinate to J13 lifecycle | ConnectorStatus and connector-specific health methods [S01–S07] | A probe, configuration read or activity write cannot regrant authority. Health, configured credentials and lifecycle remain distinct. |
| Historical provider-effect reconciliation | J18 / KF-REC-048 and relevant domain/evidence owners | Existing provider operation identities, payment occurrence/effect evidence [SUP, R04] | Reconciliation is not reconnect, fresh payment/refund issuance, or permission to replay confirmed effects. |
| Remote subscription teardown | J13 owns the obligation and scope; adapter performs it; J18/K11 owns attempt/certainty semantics | Local disconnect paths do not establish complete remote cleanup ownership [M004, SUP] | Local revocation success is not proof of remote unsubscribe. Shared registrations must not be deleted for another tenant. |
| Evidence retention and operator attention | K8, relevant domain/J19 retention, J17 attention | Existing activity/effect records and review surfaces [S04, R04, R06] | Keeping evidence does not keep a live route authorized. A warning log alone is not durable cleanup outcome evidence. |

One lifecycle owner means one transition contract and consistent expected-state checks. It does **not** require one physical table, a new monolithic connector runtime, universal event sourcing, or forced push/webhook support for pull-only adapters.

## 2. Callback and asynchronous-result admission table

This is a **candidate policy table**. The inspected baseline does not implement these distinctions uniformly. N and N+1 describe lifecycle relationships; they are not asserted to be fields in current provider payloads.

| Input and established evidence | Permitted disposition | Forbidden inference / transition | Owner / proof |
|---|---|---|---|
| Failed provider authentication | Reject normal tenant processing; preserve bounded security evidence where policy permits | Do not choose a tenant from untrusted payload/URL data and perform business work | J14; P04 |
| Authenticated occurrence without independently trusted tenant/account binding | Unbound/quarantined evidence and operator resolution | Authentication alone does not establish the business, including a scoped URL | J14 + K1; P04 |
| Authenticated, tenant-bound occurrence whose current binding and allowed use are established | Admit only the specified current processing purpose; material actions still require current governance | Current ingress admission is not blanket autonomous action authority | J13 → J14 → J5/J2/J15; P01–P04 |
| Occurrence attributed to revoked generation N that would initiate new processing/effects | No new normal business processing under N; retain only policy-authorized audit/quarantine evidence | Retained routing metadata or provider delivery cannot undo local revocation | J13/J14; P01–P03 |
| Same phone/page/account reused after reconnect; old occurrence first arrives now | Preserve its established old lineage, or explicitly mark lineage unknown; use a documented admission/review policy | Arrival during N+1 does not make it an N+1 occurrence; dedupe of previously seen IDs does not settle first arrival | J13/J14/J5; P02–P04 |
| Authenticated, tenant/account-correlated event for a known previously initiated payment/refund/effect | Bounded reconciliation and idempotent completion of permitted local consequences, with the original effect linkage | No new external effect, silent reactivation, or automatic grant of fresh action authority | J18 + domain/K8; P05, P07 |
| Possible historical effect but correlation or provenance is uncertain | Retain uncertainty; quarantine/review or an authorized, non-effecting lookup | Do not label it current, failed, successful, or safe to replay merely to make processing continue | J18/J14/K8; P06 |
| Valid signed, unexpired OAuth state whose connect intent was revoked, cancelled, superseded or already consumed | Reject credential/grant installation under that intent | Signature, nonce and TTL do not establish current intent authorization | J13/K3/K7; M004-01, M004-02 |
| Fresh OAuth intent, current authorization and provider exchange evidence | Install only under the still-current intent/generation and an expected-state commit; record partial provisioning truth | A check before network I/O is insufficient if disconnect occurs before credential or status persistence | J13; M004-05, N05 |
| Late probe, sync or refresh result from N after revocation/reconnect | Record observation/outcome against N as policy permits; do not update current grant or current-generation cursor from stale work | Provider success and health/activity evidence cannot reactivate N or overwrite N+1 | J13/K7/K11; M004-04, M004-06, N01, N02, N04 |
| Remote cleanup timeout, rejection or uncertain result | Local revocation remains effective; cleanup stays pending/failed/unknown with its original registration/generation identity | Do not report provider-unsubscribed, roll back revocation, or let old cleanup remove N+1's registration | J13/J18/K11; P12, N06 |

Important boundary: retaining a revoked callback as evidence must not accidentally invoke contact creation, KeyInbox processing, action proposals or domain effects before the admission decision. Conversely, rejecting every late financial callback would discard potentially necessary historical outcome evidence. The policy must distinguish **use**, not only transport or provider name.

## 3. Context Integrity Check — result and scope

**Result: PASS FOR THIS BOUNDED CONTINUATION**, with the historical snapshot discrepancies below explicitly resolved. This is not a convergence or implementation-proven gate.

| Check | Evidence / disposition |
|---|---|
| Repository and intelligence checkpoint | Live branch resolved to `4a5e4f47e3903e71f8bb5aa22e843c9d2f3693f6` before publication. Its tree was `f67d2c1ee131592c476320e783dd471629001b21`. |
| Two supplied checkpoints | The later checkpoint's state explicitly preserves the `0f7000d6c141e2296ec923f6d9105bd6f7841891` input and separate supplement creation `0e8658d3b598948907c1082291e26ec5c2582eaf`. Both evidence strands were read; neither was reconstructed from chat summaries. |
| Implementation branch versus evidence | Live main was observed at `88b8016c0ef45e383cc5b0d98c7062151a6a0f27`; all new source reads below used `8f173bfe79f1418159cf4099ea18b0d60d203ec2`. No deliberate rebaseline occurred. |
| Governing entrypoints | AGENTS.md, AGENT-CONTINUITY.md, 00-START-HERE.md, 07-CURRENT-STATE.md and all four CURRENT/ROLLOVER files were loaded. |
| Actual frontier | J13 bounded convergence review preparation, after Microtraces 001–004 plus the named supplement. Not the older J18/J23 frontier; not a generic provider rescan. |
| Evidence continuity | J13 dossier, all four microtraces and separate callback supplement retained. M004 is stale OAuth intent/split Drive ownership; SUP is provider callbacks/legacy credentials. |
| Active model | Whole-system virtual modelling; J13 primary K9/K7/K11, secondary K1/K3/K5/K8; adjacent J5/J14/J18/J2/J15/J12. |
| Prior backward re-audit | J5-J14-J15-J18-J13-J22-J2-J16-J17-CONVERSATION-ACTION-BACKWARD-REAUDIT.md was read [R06]. It permits J5 provisional convergence and explicitly requires J13 to pressure-test channel binding. |
| Canonical IDs | 04B remains the numeric authority: through F227/C177/KF-REC-057, concepts through KF-CONCEPT-042. F228/C178/KF-REC-058 remain unallocated. |
| Historical contradictions resolved, not hidden | 04A retains older F222/C172/REC056 ranges; 04B explicitly governs allocation. 10P's original pending-re-audit status predates R06 and the current J5 state. Neither older snapshot is used to regress current status. |
| Execution boundary | No production edit, deployment, provider/dashboard mutation, database migration or application test was performed. No execution packet was authorized/promoted. Existing packet state is inherited, not independently re-audited here. |
| Coverage honesty | 19/25 dossier coverage and dossierless J8/J9/J20/J21/J22/J24 are inherited checkpoint figures, not a fresh directory recount or programme-completion percentage. |

The later intelligence checkpoint is the documentation source; the older pinned main commit remains the implementation source. Older recommendation documents can retain their original evidence baseline without changing the baseline of this review.

## 4. Evidence manifest and corrections

### 4.1 Newly inspected implementation sources

All S references below are at `8f173bfe79f1418159cf4099ea18b0d60d203ec2`. Symbols, file paths and blob identities provide reproducible anchors. Default-branch search was used only to discover the singular controller and Gmail-ingestion paths; source claims use the pinned fetches.

| Ref | File under `apps/server/src/` | Inspected scope / blob SHA |
|---|---|---|
| S01 | `core/connectors/connector-credentials.service.ts` | Full file; setCredentials, clearCredentials, getCredentials, readCredential; `73386084d7442c7819cd4f1d9942c3423f019bed` |
| S02 | `core/connectors/connector-health-monitor.service.ts` | Full file; tick, tickBusiness, checkOne; `2e5e5c6b3eff3b08098a2656a7540100f2686a22` |
| S03 | `core/connectors/connector-registry.service.ts` | Full file; smoke/test/sync/authenticate/disconnect/reconnect; `3f12f6df146367c67f3aec377dfd821b6d4e140d` |
| S04 | `core/connectors/connector-activity.service.ts` | Full file; record and lifecycle listeners; `93c88f783849875ba7b02b71d1aefcc576e5edf5` |
| S05 | `core/connectors/connector.controller.ts` | Full file; inbox-config, credential, webhook-info and delegated operation routes; `9de7d0d34f61fa078dc0d24a6bb789f2056e116c` |
| S06 | `core/connectors/google-suite.service.ts` | Lines 1–340: state creation, callback, credential provisioning, status upserts, service verification; `1c4a2e43480d8894bc9b26be05cb01d8c6efaf0f` |
| S07 | `core/connectors/implementations/gmail-ingestion.service.ts` | Lines 1–230: syncInbox token use, message effects, completion/failure status writers; `9ba4253e4cc2aebaa148f186ba204deada42c97c` |

### 4.2 Retained investigation evidence

- M001–M004: [Microtrace 001](J13-CONNECTOR-LIFECYCLE-MICROTRACE-001.md), [002](J13-CONNECTOR-LIFECYCLE-MICROTRACE-002.md), [003](J13-CONNECTOR-LIFECYCLE-MICROTRACE-003.md), [004](J13-CONNECTOR-LIFECYCLE-MICROTRACE-004.md).
- SUP: [Subscription, callback lineage and legacy credential supplement](J13-SUBSCRIPTION-CALLBACK-LINEAGE-AND-LEGACY-CREDENTIAL-SUPPLEMENT.md).
- Provider-specific facts carried from these documents are **inherited pinned-source evidence**, not claims that every underlying provider file was reread during this review.
- Microtrace 004's preserved blob at the input checkpoint is `19857cca34f6c89500c68d9bde8b45a4c9e24896`.

### 4.3 Canonical comparison sources actually read

- R01: [08BC / F227](../08BC-FINDING-REGISTER-CONNECTOR-DISCONNECT-REVOCATION-SUPPLEMENT.md).
- R02: [09BC / C177](../09BC-CONTRADICTION-REGISTER-CONNECTOR-DISCONNECT-REVOCATION-SUPPLEMENT.md).
- R03: [10A / KF-REC-035–037](../10A-RECOMMENDATION-REGISTER-INGRESS-CONTINUATION.md).
- R04: [10G / KF-REC-048](../10G-RECOMMENDATION-REGISTER-RECOVERY-CONTINUATION.md).
- R05: [10P / KF-REC-057](../10P-RECOMMENDATION-REGISTER-CONVERSATION-OCCURRENCE-PROCESSING-ACTION-CONTINUATION.md).
- R06: [J5 backward re-audit](J5-J14-J15-J18-J13-J22-J2-J16-J17-CONVERSATION-ACTION-BACKWARD-REAUDIT.md).
- R07: [04B allocation ledger](../04B-CANONICAL-ID-ALLOCATION-LEDGER.md), [04A taxonomy](../04A-CANONICAL-TAXONOMY-AND-NAMING-REGISTRY.md), and [08 base register](../08-FINDING-REGISTER.md), lines 1–200, including F017 and F041.

### 4.4 Corrections that must survive continuation

1. The relevant persisted field is `ConnectorStatus.status`. Do not repeat an unsupported literal `healthStatus: healthy` mutation from earlier prose.
2. Drive connector disconnect directly clears its fields; the dedicated Drive service is a distinct path that does not perform the same ConnectorStatus mutation [M004].
3. Health-monitor exclusion of already-disconnected rows is a real positive seam, but does not fence a row selected **before** disconnect [S02]. Its own success branch is a nonwriter.
4. Google-suite live verification is useful but not universal: the inspected Forms branch returns `ok: true` on the granted-scope premise without making a Forms API probe [S06]. Do not claim every suite service received a successful live API test.
5. Gmail's normal completion writer is not equivalent to `syncInbox().success === true`: individual-message errors can coexist with `status = connected`, `intakeEnabled = true` and returned `success:false` [S07].
6. QB/Xero central credential clearing is not universal credential removal while legacy fallback remains. Xero's tenant-specific central `tenantId` guard is still a real restriction; the supplement does not establish arbitrary Xero write or authenticated callback reachability.

## 5. ConnectorStatus writer inventory — named gaps resolved

Scope: the shared controller/registry/credential/monitor/logger boundary, unified Google provisioning and Gmail ingestion, joined to the concrete provider writers already named by M001–M004/SUP. This is a bounded inventory, **not** an assertion that every adapter, raw-SQL writer, seed, administrative job or later-main writer has been enumerated.

| Writer / path | Exact effect or nonwriter result | Evidence | Lifecycle consequence |
|---|---|---|---|
| W01 `ConnectorCredentialsService.setCredentials` | Upsert connected; write encryptedCredentials/connectedAt/account; update resets errors | S01, fresh | Secret installation and lifecycle status are coupled without expected generation/state. |
| W02 `clearCredentials` | Remove encryptedCredentials; upsert disconnected; clear account/connectedAt | S01, fresh | Does not erase Business.metaData legacy credentials or create a generation tombstone. |
| W03 `ConnectorController.updateInboxConfig` | Create path defaults disconnected; update changes only supplied intake/threshold/contact flags | S05, fresh | Configuration update is not itself a connected writer. Preserve this distinction. |
| W04 `saveCredentials` / `deleteCredentials` | Indirect W01/W02; save validates required form values then installs before obtaining health; delete does not invoke provider-specific disconnect | S05, fresh | Alternate lifecycle entrypoints must consume the same transition policy, not only central storage semantics. |
| W05 `getWebhookInfo` GET | Missing webhookSecret → generate secret → W01 → connected; gated by registered connector and supportsWebhook | S05 + S01, fresh | Read-looking configuration endpoint is an implicit connected writer. Not proof that provider subscription, provider credentials or capability are usable. |
| W06 `ConnectorRegistryService.smokeTestConnector` | Any successful smoke/test/presence fallback upserts connected, lastSyncAt, syncCount and optional account | S03, fresh | Shared post-result writer can restore connected without a lifecycle check. Must be distinguished from concrete adapter activity writers. |
| W07 registry `testConnector` | Delegates testConnection/isConnected and emits tested; no direct ConnectorStatus mutation | S03, fresh | Do not attribute W06's connected write to every ordinary test. Adapter internals remain separate owners. |
| W08 registry sync/authenticate/disconnect/reconnect | No direct ConnectorStatus writer in these orchestration methods; delegate to adapter | S03, fresh | Reconnect catches a disconnect exception and still calls authenticate. Cleanup failure is not a stopping condition here. |
| W09 `ConnectorHealthMonitorService.checkOne` | On failure upsert expired/error and error counters by business/type; success returns without its own write | S02, fresh | Selected-before-disconnect failure can overwrite current disconnected state. No connected write is established from the monitor's own success path. |
| W10 `ConnectorActivityService.record` and listeners | Only ConnectorActivityLog.create; **not** ConnectorStatus | S04, fresh | Preserve audit seam; do not confuse log recording with per-adapter trackActivity. |
| W11 `GoogleSuiteService.handleCallback` | Writes Business per-service credentials, awaits verification, then upserts connected/error per enabled service | S06, fresh | Credential installation and later status updates lack observed expected-intent/generation conditions in the inspected callback body; disconnect between phases is not fenced there. |
| W12 `GmailIngestionService.syncInbox` completion | Writes connected, connectedAccount, intakeEnabled=true, cursor metadata and syncCount even with per-message errors | S07, fresh | Cursor/ingestion bookkeeping doubles as lifecycle and intake-policy writer. Snapshot metadata is merged later. |
| W13 `GmailIngestionService.syncInbox` outer failure | Upsert error and error details/counter | S07, fresh | Like W09, a late old failure is not restricted to the still-current grant in the shown mutation. |
| W14 Stripe/PayPal concrete activity helpers | Provider activity can write connected after status-only disconnect; retained configuration permits conditional continued operation | M002 + SUP, inherited | Reuse F227/C177. Historical reconciliation activity cannot be a grant writer. |
| W15 QB/Xero concrete activity helpers | Legacy credential fallback can reach provider reads/smoke activity; Xero central tenantId still restricts tenant operations | M002 + SUP, inherited; S01 fallback rechecked | Reuse F227/C177; no tenant-secret presence or actual successful provider call is asserted. |
| W16 Gmail/Drive concrete activity and disconnect paths | Activity-connected writes and direct credential clearing; dedicated Drive disconnect lacks equivalent status write | M002–M004, inherited | Join these with W11/W12, not a second Google lifecycle owner. Ordinary calls starting after effective credential removal remain blocked unless another usable credential path exists. |
| W17 WhatsApp/Meta disconnect and retained mapping changes | WhatsApp status-only revocation; Meta removes SocialConnection mapping on the inspected shared-route path | M001 + SUP, inherited | Live route admission and the status projection are not one authority decision. Meta absent-mapping blocking remains a positive seam. |
| W18 Google token refresh helper | Business token/expiry writes, not established here as a ConnectorStatus writer | M003, inherited | Non-ConnectorStatus credential mutations still need current-generation fencing; deleting stored credentials cannot recall values already loaded by a request. |

The named shared-service inventory gaps are now resolved at the stated baseline. Remaining global enumeration is explicitly deferred rather than turned into the next generic scan. The inventory also identifies **nonwriters**, so future work does not add false owners.

## 6. New bounded execution traces

These are static code traces and conditional interleavings, not reproduced incidents.

### 6.1 Shared smoke success can outlive the grant

`POST .../smoke/:type` is routed through the authenticated/business-guarded controller to the registry [S05/S03]. The registry awaits the adapter result, then writes connected without comparing a generation or current lifecycle state.

```text
T0 smoke starts while credentials/grant N are usable
T1 adapter obtains a successful result (or has a successful result in flight)
T2 disconnect records disconnected / clears stored credentials
T3 registry success persistence runs by businessId + connectorType
T4 ConnectorStatus becomes connected again
```

The counterexample does not require the provider to accept a newly issued request after revocation; the result may already exist before T2. Actual scheduling and provider success remain untested. The required target is a **mutation-time expected-generation check**, not merely blocking smoke invocation when a row is already disconnected. [N01]

### 6.2 Health-monitor selection is not mutation fencing

The monitor selects connected/syncing/error/expired and excludes disconnected. It then awaits a test. A failure writer later uses only business/type [S02].

```text
select N while monitored
→ await test
→ disconnect N
→ old test reports failure
→ failure upsert replaces disconnected with expired/error
```

This can return the row to the monitor's selection set and distort current attention/health truth. It is **not** evidence that the monitor itself writes connected. Its `if (result.success) return false` behavior remains intact. A classifier based on strings such as token/401 also does not create durable provider-revocation evidence. [N02]

### 6.3 Configuration lookup is an implicit grant-like writer

`getWebhookInfo` accepts a registered connector marked `supportsWebhook`. If central webhookSecret is missing, it generates one and calls `setCredentials`; that method writes connected [S05/S01]. This route is guarded by AuthGuard/BusinessGuard, so the finding is not an asserted authentication bypass.

A disconnected connector with no central secret can therefore be marked connected by this configuration path. The method does not establish an actual remote subscription or perform provider capability verification. The supportsWebhook condition is broader than the method comment's examples of form connectors; that does not establish that every returned form-style URL is a working provider ingress route. [N03]

### 6.4 Gmail ingestion combines work outcome, cursor, intake and lifecycle

`syncInbox` obtains a token, reads current status metadata for the cursor, resolves messages, can create contacts/threads/messages, and only later writes status/cursor fields [S07]. It does not gate the shown work on the read status being connected. Starting a new request after effective token removal is still constrained by the token helper; already-loaded credentials and in-flight work are a different case.

The completion writer sets connected and intakeEnabled=true **regardless of individual-message errors**, then returns success according to whether those errors exist. Therefore:

```text
provider/message processing partly fails
→ completion branch persists connected + intakeEnabled=true + cursor
→ return success:false
```

No new standalone ingestion-loss finding is allocated: cursor completeness and individual-message retry require their own J5/J14/J18 proof, not an assumption here. The established J13 consequence is that outcome/projection bookkeeping can overwrite lifecycle and intake decisions. [N04, P11]

### 6.5 Unified Google provisioning needs the same intent fence

The suite builds signed state containing businessId/services/nonce/expiry. Its callback verifies state, exchanges the code, writes per-service Business credentials, awaits service verification, and writes connected/error per service [S06]. The inspected callback body does not consume an expected connect-intent generation at credential installation or subsequent status persistence.

This reinforces M004's distinction: cryptographic state validity and provider token success do not establish that the user's earlier connect intent remains current. A disconnect during token exchange, between Business credential installation and verification, or before a final status write needs a defined commit/cancellation policy. Partial suite provisioning must remain explicit; it must not imply all six services were live-tested. [N05, M004-01/02/05]

### 6.6 Reconnect does not currently establish successful teardown

The registry catches a concrete disconnect exception, logs it and proceeds to authenticate [S03]. This is not evidence that a remote cleanup request was made or failed; it establishes only that the orchestration does not require disconnect success before continuing. The target must distinguish local revocation commitment, remote cleanup certainty and authorization for N+1 instead of treating all three as one boolean result. [N06, P12]

## 7. Microtrace 004 anti-duplication decision

**Bounded decision: reuse/refine F227/C177 for the lifecycle-revocation root; retain the stale-intent and split-owner mechanisms as separately named obligations. No new canonical ID is justified by the evidence compared here.** This decision is based on actual register wording, not on SUP's earlier classification.

| Candidate / compared canonical home | Comparison | Disposition |
|---|---|---|
| Stale pre-disconnect OAuth intent installs credentials after disconnect vs F227 | R01 explicitly requires monotonic revocation of ingress/effect, sync, credential/subscription participation and a new explicit grant on reconnect. A still-valid old intent restoring participation violates that same lifecycle law. It is a different entry mechanism from an ordinary provider event. | **SPECIALIZATION / REFINE F227**, keeping M004-01/02/05/06 and intent-consumption semantics explicit. Do not rename it simply stale webhook replay. |
| Same candidate vs C177 | R02 contrasts recorded disconnected with continuing participation and requires a new generation on reconnect. Authenticity can remain valid while temporal authority has ended. | **SPECIALIZATION / REFINE C177**, no C178. |
| Signed OAuth state vs J14/KF-REC-035 | R03 owns provider verification, tenant binding, occurrence/claim/replay/ack semantics and explicitly says IngressOccurrence is not an authorization token. Those properties alone do not determine whether a connect intent is current. | **RELATED DISTINCT RESPONSIBILITY**. J14 verifies/binds; J13 supplies current-intent authority. No competing ingress owner. |
| Split dedicated Drive versus generic connector disconnect | M004 establishes two entrypoints with differing credential/status side effects. F227 already requires one coherent lifecycle authority contract despite separate projections. | **IMPLEMENTATION SPECIALIZATION** of the lifecycle root. Keep M004-03; do not discard the concrete ownership defect merely because no ID is allocated. |
| Health/configuration/activity connected writes vs F017 readiness conflation | R07's F017 separates readiness domains; it explains part of the misleading projection. It does not by itself prove the revocation race. | Cross-reference F017; **F227 remains the lifecycle home**. No fresh readiness finding from relabeling the same writer. |
| Missing expected-state commit vs F041 proposal CAS weakness | The base register's F041 is about proposal transitions, not OAuth credential installation. A shared concurrency technique does not make the source defects identical. | **RELATED DISTINCT MECHANISM**; use K7/K3 transition discipline, not a claim that F041 already proves Google behavior. |
| Old effect/provider callback vs KF-REC-048 | R04 distinguishes reconciliation from new effects and preserves original outcome independently of recovery outcome. | Delegate reconciliation/cleanup certainty to J18/K11. Do not invent connector-specific retry/idempotency semantics. |
| J13 lifecycle owner vs KF-REC-057 | R05 explicitly delegates lifecycle/runtime to J13/K9, while J5 references the binding generation. | Preserve delegation. REC057 is not the missing global lifecycle implementation contract; REC058 stays unallocated pending separate target acceptance. |

What is closed: the previously unperformed **bounded register comparison**. What is not closed: acceptance of the exact lifecycle/intent model, exhaustive semantic comparison with every historical register, runtime proof, and any future independent defect that survives this comparison. Reopen allocation only with a separately stated violated invariant, exact causal trace and explanation why strengthening F227/C177 plus existing owner contracts is insufficient.

R01/R02 remain the canonical home definitions. This review is supporting evidence and a refinement recommendation, not a silently broadened replacement register.

## 8. Migration and subscription-cleanup ownership

### 8.1 Source-of-truth and credential migration matrix

These are proposed responsibilities and ordering constraints, not executed migrations or an inspection of tenant secret values.

| Existing source / dependency | Established evidence | Migration responsibility and constraint |
|---|---|---|
| ConnectorStatus status, intake policy, cursor and counters | Multiple independent writers [S01–S07] | J13 separates authoritative participation from health/read-model updates; K7 fences old results. Do not automatically backfill active authority from connected labels. Preserve cursor, intake preference and error history as separate dimensions. |
| Central encryptedCredentials | Storage and lifecycle changes coupled [S01] | Keep encrypted secret storage as a seam. Introduce explicit authorized credential use and an auditable grant/credential reference, not a second secret store by default. |
| Business.metaData legacy keys for QB/Xero | Field-level readCredential fallback ignores status [S01/SUP] | Inventory the exact legacy keys/readers already identified by SUP. Disable fallback under a revoked binding before treating central clear as revocation; migrate under provenance-aware policy. A missing/decryption-failed central value must not silently reactivate a legacy value. |
| Xero central tenantId | Tenant-specific guard can block despite a legacy token [SUP] | Preserve tenant/account binding. Do not remove this guard merely to make migration-compatible smoke tests pass. |
| Business Google service token/refresh/expiry fields | Shared helper, suite and dedicated flows use them [M003/M004/S06] | Route install/refresh/clear through one lifecycle transition contract. A refresh may rotate a credential within a still-current grant, not create a fresh grant or restore a revoked one. |
| Pending Drive/unified Google OAuth state | Authentic, expiring state lacks established revocable intent ownership [M004/S06] | Record intent authorization/supersession and expected generation. Compare at installation commit, not only at callback entrance. Define cancellation after external token issuance without letting the token become live business authority. |
| WhatsApp phone mapping/config and Meta SocialConnection mapping | Retained WhatsApp route; Meta shared-route deletion/recreation behavior [SUP] | Preserve historical mapping evidence separately from live routing. Same-account reconnect does not prove that old first-arrival events belong to the new grant. |
| Payment configuration, callback/effect evidence and provider operation IDs | Historical settlement/refund reconciliation remains meaningful [SUP/R04] | Domain/J18 preserves existing effect lineage and reconciliation references without regranting payment operations. Do not erase evidence merely to make disconnected appear complete. |
| In-flight sync/probe/refresh/cleanup work | Credential values and snapshots may already be loaded [S02/S03/S06/S07, M003] | Bind claim/result writes to the originating grant and purpose. Fence new domain mutations after revoke; preserve truthful outcome of effects that already crossed their point of no return. |

### 8.2 Provider subscription ownership matrix

| Family | What this evidence establishes | Teardown/accountability owner | Remaining evidence / disposition |
|---|---|---|---|
| WhatsApp / Meta | Local config/mapping and shared/scoped callback behavior; the inspected local disconnects do not prove remote unsubscription [SUP] | J13 defines tenant/account/grant-scoped participation; provider adapter owns any supported registration operation; J18 records attempt and certainty | **DEFER actual remote registration inventory**: registration IDs, app-versus-tenant ownership, shared dependencies, provider observation and reconciliation evidence are not supplied. |
| Stripe / PayPal | Local disconnect/retained credentials and payment callback/reconciliation paths [M002/SUP] | J13 owns future-use revocation; payment/domain/J18 owns old effect reconciliation; adapter owns actual endpoint/config cleanup where applicable | **DEFER remote dashboard configuration proof**. Outbound customer-webhook CRUD is not evidence of provider inbound subscription ownership. |
| Gmail / Drive | Inspected connector metadata reports supportsWebhook=false; the carried-forward traces establish pull/sync and OAuth paths [M003/M004/SUP] | J13/K7 owns poll/sync/refresh claims; a real provider watch, if established elsewhere, needs explicit adapter ownership | No watch was established in this scope. **Do not invent unsubscribe work or assert no watch exists anywhere.** |
| QuickBooks / Xero | Manual-token operations and conditional legacy fallback; no authenticated provider callback route established [M003/SUP] | J13 owns credential-use authority and account binding | **DEFER callback/subscription claims**, not a generic scan mandate. Do not infer a push integration from authType metadata. |
| Form-style webhook configuration | S05 generates a secret and URL when supportsWebhook is true | Existing form/ingress adapter plus J13 authority boundary; J14 verifies and binds | Secret/URL generation is not a remote subscription acknowledgment. Review actual registration only when a concrete form/provider seam is in scope. |

### 8.3 Ordered migration constraints

1. **Observe without upgrading history.** Inventory existing binding/account, secret-reference, route, intent and work provenance. Unknown generation stays unknown; connected status, token presence or a recent timestamp is not sufficient to grant participation.
2. **Establish the revocation commit boundary.** A local revoke decision must monotonically invalidate new-use authorization and outstanding connect intents for the targeted binding. Existing work-family claim mechanisms should consume that fence; do not invent a universal job engine.
3. **Keep remote cleanup separate and durable.** Record the cleanup obligation against the old registration/account/grant before losing the information required to perform it. If credentials are required for teardown, retain only a bounded cleanup-purpose reference under policy, not general outbound/ingress authority. Secret retention/disposal must remain explicit.
4. **Classify cleanup outcomes truthfully.** Requested, attempted, confirmed, failed, unknown and unsupported are not interchangeable. A timeout is not successful unsubscribe; absence of inspected registration is not confirmed absence at the provider. Reuse KF-REC-048 certainty semantics.
5. **Protect shared ownership and reconnect.** A tenant must not delete a platform/shared registration still used by another active binding. Cleanup for N must name N's registration/reference and cannot target a new N+1 registration merely because the provider/account key is the same.
6. **Cut over all named writers and readers together.** W01–W18 must have an explicit role: authorized grant transition, bounded credential rotation, projection-only result, configuration update, or historical reconciliation. Fencing only callbacks or only the scheduler leaves the shared smoke and configuration writers open.
7. **Keep historical outcomes reconstructable.** Store policy decisions and known effect correlation. Reconciliation may complete missing permitted local consequences, but cannot create a new external effect or silently discharge unrelated work.
8. **Rollback must not resurrect revoked authority.** Compatibility readers and rollout toggles cannot restore legacy fallback under a tombstoned binding. A rollback of projection code must preserve the revocation record and its intended scope.

No provider API operation, schema change or migration packet is authorized by this ordering. Provider-specific retention, credential requirements and shared-registration semantics must be verified before execution planning.

## 9. Backward re-audit and kernel reinjection

This is a **target-contract backward re-audit**, extending R06 with the new J13 evidence. It is not a claim to have rerun every adjacent journey's implementation trace.

| Adjacent owner | Prior contract under pressure | Disposition and precise reinjection |
|---|---|---|
| J5 / REC057 | ConversationOccurrence references current channel binding; processing policy and claims are separate [R05/R06] | **PASS ownership; REFINE admission inputs.** Preserve a binding-decision reference and unknown/old lineage where evidence does not establish current origin. No auto-assignment to N+1 by arrival. J5 remains provisionally target-aligned, subject to J13 model acceptance. |
| J14 / REC035–037 | Authenticity, tenant binding, durable occurrence ownership and provider reconciliation [R03] | **PASS ownership; REOPEN admission-interface detail.** Add a purpose-specific J13 decision before new business mutations. Keep OAuth intent consumption separate from ordinary event replay. Do not replace occurrence dedupe with lifecycle generation. |
| J18 / REC048 | Same-effect retry, reconciliation-first uncertainty, consequence completeness, recovery authority [R04] | **PASS ownership; REFINE cleanup mapping.** Historical payment evidence and remote teardown consume certainty-aware work/outcomes. Neither successful reconciliation nor uncertain cleanup grants N+1. |
| J2 / J15 | Exact action → ControlEvidence → current Clearance → ExecutionClaim [R06] | **PASS ownership; REOPEN current-binding consumption detail.** Connector availability is an action precondition, not human control evidence. Current authority must be checked for the precise use/claim; cancellation during awaited work needs a commit/point-of-no-return policy. |
| J12 / REC056 | Stable document identity, source revision, assertion/ingestion occurrence and evidence admission [R07] | **PASS distinction.** Google connection generation is neither document revision nor ingestion dedupe identity. Connection migration must not make historical Drive revisions current or erase their evidence. |
| K9 Integration & External Reality | One coherent lifecycle owner despite multiple adapters/projections [R01] | **REOPEN target acceptance with stronger writer coverage.** The owner must govern pending connect intent, credentials, route admission, all status writers, poll/refresh claims and registration teardown references. Credential storage alone is not that owner. |
| K7 Temporal / Event / Workflow | Logical lifecycle differs from attempt/work state; stale work must not override later decisions [R03/R04] | **REFINE fence location.** Bind N at claim and compare at material/result commit. Monitor selection exclusion is insufficient; late error writes as well as late success writes are included. |
| K11 Recovery & Reliability | Outcome certainty, same-effect identity, cleanup/reconciliation and truthful projections [R04] | **REFINE certainty and retry scope.** Preserve already-effective outcomes, isolate cleanup authority, retain unknown remote state and fence old cleanup against N+1. |
| K8 / J17 | Truthful evidence and derivative operator attention [R04/R06] | **PASS ownership; REFINE observations.** Display locally revoked plus remote-cleanup-pending/unknown without promoting health/activity into authority. No new evidence or attention engine. |

No new parallel ingress, approval, recovery, knowledge or operator-attention runtime is introduced by this review. The earlier J5 ownership pass survives; its J13 reopen trigger is exercised to refine the binding decision, not to erase its completed work.

## 10. Analytical closure gates

Definitions: **PASS** = the stated bounded analytical question is answered by inspected/retained evidence; **DEFER** = a named evidence class is missing or intentionally unexecuted; **REOPEN** = a candidate contract still needs revision/acceptance. A PASS here never means the baseline implements the target correctly.

| Gate | Disposition | Evidence and boundary |
|---|---|---|
| G01 Correct checkpoint, baseline, scope and permissions | **PASS** | Section 3; current branch read, pinned source reads, no rebaseline. |
| G02 Preserve and pool both J13 evidence strands | **PASS** | M004 and SUP retain distinct subjects and proof obligations. |
| G03 Finish named shared-status-writer inventory gaps | **PASS — BOUNDED** | W01–W13 fresh; W14–W18 explicitly inherited. Shared smoke, configuration GET, monitor, logger, suite and Gmail cases are no longer unenumerated at this boundary. |
| G04 Exhaustive repository/provider writer and subscription coverage | **DEFER** | No full checkout/AST/raw-SQL/admin-job inventory or remote provider/dashboard evidence. This is not claimed by G03. |
| G05 M004 comparison against actual canonical wording | **PASS — BOUNDED** | Section 7: F227/C177 specialization with distinct OAuth and ownership obligations retained. New IDs remain unused; no global semantic-exhaustiveness claim. |
| G06 Coherent lifecycle owner and callback-use distinctions | **PASS — CANDIDATE MODEL** | Sections 1–2 specify owners and allowed/forbidden uses without competing engines. Acceptance of exact state/commit contract remains G07. |
| G07 Exact lifecycle/intent transition and mutation-time fencing contract | **REOPEN** | New W05/W06/W09/W11/W12/W13 paths require explicit expected-state, partial-write and cancellation semantics. No executable unified owner is established. |
| G08 Legacy credential/mapping migration and local-versus-remote cleanup responsibility | **PASS — DESIGN MAPPING** | Section 8 assigns sources and owners, preserves unknown history and Xero tenant binding, and separates cleanup authority. |
| G09 Real subscription identity, shared ownership and teardown confirmation | **DEFER** | Provider registrations/dashboard state/tenant secret presence were not inspected; actual cleanup was not executed. Sections 8.2–8.3 define exactly what is missing. |
| G10 Backward re-audit and K9/K7/K11 reinjection | **PASS — OWNERSHIP REVIEW** | Section 9 preserves adjacent contracts and names reopened consumption/acceptance details. It does not re-prove all adjacent implementation. |
| G11 Designed-case coverage of known risks | **PASS — DESIGN ONLY** | Section 11 retains P01–P12 and all six M004 cases and adds N01–N06 for new traces. |
| G12 Runtime/adversarial/provider/migration proof | **DEFER / NOT_EXECUTED** | No application, network-provider, concurrency or migration test was run. |
| G13 J13 provisional convergence / target acceptance | **REOPEN / NOT CONVERGED** | G07 and bounded target/admission decisions require adversarial acceptance; G04/G09 remain explicitly bounded evidence debts. This review is not a readiness certificate. |
| G14 Production execution authorization | **DEFER / UNAUTHORIZED** | Documentation-only tranche; no implementation packet promotion. |

No aggregate percentage is calculated from these gates. Counting PASS rows would mix orientation, static evidence, candidate design and runtime proof.

## 11. Proof obligation mapping — all NOT_EXECUTED

The P and M004 descriptions below index the preserved source cases rather than replace their original detail. N labels are local to this review, not canonical finding or concept IDs.

| Case | Required proof / assertion | Gate / owner |
|---|---|---|
| P01 | Disconnected WhatsApp cannot start new live work from an unseen authentic callback | G06/G07/G12; J13/J14/J5 |
| P02 | Same-phone reconnect does not assign an old first arrival to the new grant by receipt time | G06/G07/G12; J13/J14 |
| P03 | Meta shared-route delete/recreate has explicit old/unknown-lineage policy | G06/G09/G12; J13/J14 |
| P04 | Meta scoped callback independently establishes trusted tenant binding and lifecycle admission | G06/G07/G12; J14/J13 |
| P05 | Known historical payment/refund reconciles once without reconnect or a new external effect | G06/G08/G12; J18/domain |
| P06 | Uncorrelated/uncertain provider effect remains uncertain and reviewable | G06/G12; J14/J18/K8 |
| P07 | Payment activity cannot change revoked lifecycle authority to connected | G03/G07/G12; J13/K7 |
| P08 | QuickBooks legacy fallback cannot authorize a revoked new attempt | G08/G12; J13/K9 |
| P09 | Xero smoke cannot regrant authority; tenantId guard remains load-bearing | G08/G12; J13/K9 |
| P10 | Central-only credential removal preserves intended blocking where no other usable path exists | G08/G12; J13/adapters |
| P11 | In-flight work preserves already-effective outcome but cannot acquire fresh post-revocation authority | G07/G12; J13/K7/J18 |
| P12 | Cleanup failure/timeout does not undo local revoke or claim confirmed remote teardown | G09/G12; J13/J18/K11 |
| M004-01 | Issue OAuth intent, disconnect, then original callback cannot restore live credentials/status | G05/G07/G12; J13 |
| M004-02 | Intent B supersedes A; callback A cannot install the obsolete grant | G05/G07/G12; J13/K7 |
| M004-03 | Dedicated and connector Drive disconnect share one authoritative outcome | G05/G07/G08/G12; J13 |
| M004-04 | Stale activity cannot reactivate a revoked generation | G03/G07/G12; J13/K7 |
| M004-05 | Reconnect creates a new grant; only its intended callback can activate it | G05/G07/G12; J13/K3 |
| M004-06 | Refresh within an active generation cannot resurrect it after revocation | G07/G12; J13/K7 |
| N01 | Pause registry smoke success before persistence; revoke; release persistence; current grant stays revoked | G03/G07/G12; W06 |
| N02 | Select monitor row, pause failing test, revoke, release failure; current lifecycle is not overwritten by error/expired | G03/G07/G12; W09 |
| N03 | Read webhook-info with missing secret after revoke; credential/config output cannot silently regrant lifecycle | G03/G07/G12; W05 |
| N04 | Pause Gmail completion/failure, change grant/intake policy, release; stale status/cursor cannot overwrite new decision; partial errors stay explicit | G03/G07/G12; W12/W13 |
| N05 | Interrupt suite callback at token exchange, credential commit and per-service status commit; cancel/supersede; no obsolete grant activation; Forms scope-only verification labeled correctly | G03/G07/G12; W11 |
| N06 | Disconnect/teardown fails or remains unknown before reconnect; preserve local revoke and old cleanup identity; old retry cannot delete N+1 registration | G07/G09/G12; W08/J18 |

No passing test output, fixture execution or provider outcome is supplied. Any future execution report must name the baseline, environment, exact scenario and observed assertions separately from these designs.

## 12. Review outcome and exact continuation

**Completed in this tranche:** seven pinned implementation files inspected at the listed scope; named shared writer/nonwriter gaps closed; six new local proof cases; lifecycle ownership and callback-use matrices; M004 bounded canonical comparison; migration/cleanup ownership; adjacent-journey backward re-audit; fourteen individually dispositioned gates.

**Not completed or claimed:** full provider registration inventory, exhaustive adapter/writer coverage, runtime proof, implementation, production changes, final target-contract acceptance or J13 convergence.

Next action: **`J13_TARGET_CONTRACT_ADVERSARIAL_REVIEW`**, beginning from this review rather than repeating it.

Produce `docs/intelligence/investigations/J13-LIFECYCLE-AUTHORITY-CONTRACT-CANDIDATE.md` as an unallocated target candidate. Start with a transition/write-set table for W01–W18 and make the following decisions explicit:

- current grant versus credential version versus pending connect intent versus health/cursor/intake projection;
- exact expected-state/expected-generation checks at credential installation, projection persistence and material effect claim/commit, including partial suite provisioning and in-flight results;
- purpose-specific admission for new processing, historical reconciliation, configuration, probe and cleanup, including unknown callback lineage without inventing provider generation evidence;
- local revocation commitment versus remote-cleanup certainty, shared-registration ownership and N-cleanup/N+1 safety;
- treatment of legacy mappings/credentials that cannot be given trustworthy grant history.

Pressure-test that candidate against P01–P12, M004-01–06 and N01–N06 as **analytical counterexamples**, still not executed tests. Re-audit J5/J14/J18/J2/J15 and K9/K7/K11 against the resulting decisions. Resolve G07 and revisit G13; retain explicit G04/G09 evidence debts. Do not allocate KF-REC-058 or mark J13 converged merely because the candidate document exists. A provider/adapter source read is warranted only for a named unresolved transition or registration seam, not a restart of the provider scan.

Keep F228/C178/KF-REC-058 unallocated, production read-only, and the forensic baseline fixed. Refresh CURRENT/ROLLOVER and the current-state pointers after publishing this review.
