# J13 - Lifecycle Authority Contract Candidate

Checkpoint: `J13-LAC-2026-09-16-01`  
Date: 2026-09-16  
Status: **TARGET CONTRACT SPECIFIED AND ADVERSARIALLY REVIEWED / NOT IMPLEMENTED / J13 NOT CONVERGED**  
Intelligence input: `a100ec1bc746e0433338e536fe21e05d55f49bb7`  
Implementation baseline: `8f173bfe79f1418159cf4099ea18b0d60d203ec2`  
Production implementation: **READ-ONLY / UNAUTHORIZED**  
Application/provider/concurrency/migration tests: **NOT_EXECUTED**  
Canonical IDs: **F228 / C178 / KF-REC-058 remain UNALLOCATED**.

This is the single current home of the J13 lifecycle-contract candidate. It executes the bounded review's next action, not another provider scan. BCR means [J13 Bounded Convergence Review](J13-BOUNDED-CONVERGENCE-REVIEW.md). M001-M004 and SUP retain their original evidence and proof detail; this document does not replace them. W01-W18 refer to BCR section 5. D, T and A labels below are document-local references, not newly allocated canonical concepts, findings or recommendations.

## 1. Transition and write-set map - W01-W18

This table specifies the **target**, with current behavior evidenced by BCR. Definitions of the state coordinates and transition IDs follow in sections 2-3. A grant transition is an authorization decision; writing a connected-looking projection is not one.

| BCR path | Target role and permitted write set | Required condition at commit/use | Prohibited write or inference |
|---|---|---|---|
| W01 setCredentials | T02-T05 stage credentials; install references only through current intent activation | Tenant, exact intent, lifecycle revision, proposed grant, provider-account evidence and current actor authority | Storage success cannot set live authority or establish provider readiness. |
| W02 clearCredentials | T06 revoke the intended local grant and cancel applicable pending intents; detach live secret use | Idempotent command receipt and expected target/revision | Clearing one central field cannot leave authorized fallback; physical deletion is not the sole revoke mechanism. |
| W03 inbox-config PATCH | T01 update intake/threshold/contact preferences with their own revision | Current user policy authority and expected config revision | No grant creation; a missing status row does not erase a revocation tombstone. |
| W04 credential save/delete routes | Same T02-T06 semantics as other lifecycle entrypoints | No alternate storage-only lifecycle bypass | Generic DELETE cannot claim provider teardown was performed. |
| W05 webhook-info GET | Read configuration only; provisioning a secret becomes an explicit T01/T02 mutation | Read authority; explicit mutation authorization for creation/rotation | A read or secret generation cannot reconnect or prove an installed provider webhook. |
| W06 registry smoke completion | T08 append a purpose-bound observation; update eligible health projection only | Originating grant/credential version, observation ordering and current projection basis | Successful probe cannot create or reactivate a grant. |
| W07 registry ordinary test | Preserve orchestration/nonwriter role; adapter results follow T08 | Same diagnostic-use admission as the adapter | Do not add a lifecycle write to an existing nonwriter. |
| W08 sync/authenticate/disconnect/reconnect orchestration | Delegate to T02-T06, T09-T10; expose separate local revoke and remote cleanup receipts | Local revoke must commit for a revoke-then-reconnect operation; remote safety per T12 | Swallowing local revoke failure cannot silently authorize replacement. Remote uncertainty is not local revoke failure. |
| W09 monitor failure | T08 record failed observation for its original basis | Compare grant and credential basis before current-health update | An old error/expired result cannot replace a revoked/currently different grant. |
| W10 shared activity logger | Append bounded activity evidence only | Tenant/source provenance; failure does not grant authority | Preserve its non-ConnectorStatus-writer role. |
| W11 unified Google callback | T02-T05 one exchange intent with individually fenced service targets | Each target child current; credential staging separate from activation; actual scope/account proof | Cancelled Drive target cannot be restored by a still-current Gmail target; partial suite success cannot become all-services success. |
| W12 Gmail completion | T08 observations plus T09 per-consumer progress/cursor commits | Work claim, grant/account, intake policy basis and eligible cursor predecessor | No connected write; no intakeEnabled=true override; partial message failure cannot silently discharge unresolved work. |
| W13 Gmail failure | T08 error evidence; J18 owns retry/certainty | Original grant/credential/attempt provenance | No current-authority overwrite from an old failed request. |
| W14 Stripe/PayPal activity | T08 observations or T11 known-effect reconciliation | Historical correlation and allowed purpose; fresh actions require T10 | Payment evidence cannot reconnect or initiate a fresh effect. |
| W15 QB/Xero activity | T08 after admitted diagnostic/read use; T10 for fresh writes | Explicit local grant; centralized and legacy credentials subordinate to it | No legacy fallback under revoked authority; preserve Xero tenantId binding guard. |
| W16 Gmail/Drive adapter activity and disconnect | T06/T08; dedicated Drive route shares the same owner | Identical revoke postconditions across public routes | Clearing credentials on one route and status on another is not two valid lifecycle contracts. |
| W17 WhatsApp/Meta config, mapping and disconnect | T01/T05/T06 local routing projection; T09 inbound admission | Trusted tenant/account plus purpose-specific current decision | Retained/recreated phone/page mapping is not proof of original event generation. |
| W18 Google refresh | T07 rotate within an existing grant and remote credential family | Expected grant, authority revision and credential version at install; recheck subsequent use | No stale token installation, old-account refresh inheritance or revoked-generation resurrection. |

Scope remains bounded to these paths and their named dependencies. There is no claim of exhaustive adapter/raw-SQL/job/administrative coverage.

## 2. Selected semantic model

### D01 - Separate authority, credentials and projections

Select one **logical lifecycle transition owner** with provider-specific adapters, not one universal connector engine. Prefer strengthening the existing registry/credential/dispatcher seams. Semantic records below may share existing physical storage when their constraints can actually be enforced; this is not a schema migration.

| Coordinate | Meaning / allowed evolution |
|---|---|
| Tenant/provider binding selector | Exact tenant, connector capability and trusted external account; points to the currently authorized local grant or none. Account identity is not inferred solely from a display email. |
| Local grant identity + authorityRevision | A distinct explicit grant; revocation is terminal for that grant. Revision orders lifecycle invalidation. An old grant is never made current by observation or token rotation. |
| Connect intent + target sequence | Authorized proposal to establish/replace a grant; binds actor, tenant, provider/client, requested services/scopes, expected lifecycle revision, expiry and proposed grant identity. Newer requests supersede the relevant earlier targets. |
| Credential version | Secret-material revision within a grant/remote authorization family. Rotation does not create another local grant. Old-version failure is not automatically evidence against a newer credential version. |
| Remote authorization/registration reference | Provider-side object or authorization scope and its known dependent local grants. It can be shared across services; sharing across tenants must never be inferred from email alone. Unknown ownership is represented explicitly. |
| Capability readiness | Purpose/resource-specific evidence: configured, scope granted, provider probe supported/succeeded/failed, stale or unknown. A grant can exist while a particular capability is not ready. |
| Health and observations | Evidence tagged with originating grant, credential basis, attempt/source and ordering. Append observations even where policy permits no current projection change. |
| Intake policy revision | User/tenant-controlled processing preferences; independent of sync success. |
| Consumer cursor/checkpoint | Source account, consumer, grant compatibility and predecessor revision. Not lifecycle authority and not proof every fetched message was applied. |
| Cleanup obligation | Exact old remote target, affected-authority scope, purpose-limited secret reference where necessary, attempt/certainty evidence and compatibility with current grants. |

These are distinct dimensions, not a list of ten required new tables. A field named status may remain a read model, but cannot be the writable authority for all of them.

### D02 - State vocabulary and non-resurrection

```text
Intent target: PENDING -> EXCHANGING -> STAGED -> CONSUMED
                    \-> CANCELLED | SUPERSEDED | EXPIRED
Exchange uncertainty is recorded separately; it is not implicit success.

Local grant: AUTHORIZED -> REVOKED   (terminal for this grant identity)
Remote readiness/loss: KNOWN_USABLE | DEGRADED | UNKNOWN | REVOKED
Projection: derived from grant + capability evidence, never a competing grant.

Reconnect: new intent -> new grant identity, not REVOKED -> AUTHORIZED.
```

A permanent provider authorization loss must block all known dependent uses and record the exact affected remote scope. A transient error changes operational evidence, not local human permission. A later provider success does not silently reverse a confirmed revocation; a new authorized grant is required. Ambiguous failure remains ambiguous rather than a guessed permanent revoke.

### D03 - Separate event origin from present admission

An occurrence's `originGrant` may be established, old, or UNKNOWN. A distinct `admissionDecision` records **which currently authorized purpose** permits a particular use, including an explicitly approved historical adoption. Never write the current grant into the origin field just because the event arrived now.

This avoids two opposite errors: accepting every old first arrival as current, and pretending all legitimate new callbacks must contain a provider-authenticated KeyFlow generation. Where two histories produce the same available evidence, the system cannot infer which occurred. Default uncertain-lineage behavior is bounded quarantine/review before normal business mutations. Explicit current human/policy authorization can adopt a specified occurrence/batch for a specified purpose without rewriting its historical origin. No automatic new-effect authority is obtained from that adoption.

## 3. Transition contract

Every mutation below binds tenant and exact target. T labels are logical operations, not proposed HTTP routes. Required audit/decision receipts are committed with the authoritative transition, or a durable intent to emit them is committed in the same transaction. Best-effort post-commit event emission alone is not the target's evidence guarantee.

| Transition | Admission / expected state | Atomic local write set | Failure and replay result |
|---|---|---|---|
| T01 Configure | Authorized user; expected config revision | Config changes and revision; explicit secret provisioning request when applicable; no local grant | Same operation ID returns its receipt; conflict requires reread, not unconditional merge. |
| T02 Issue/supersede connect intent | Current connect authority; expected binding selector/revision; exact service set | Allocate non-reused intent/target identity and proposed grant; supersede conflicting pending target; preserve current active grant until replacement is explicitly committed | Delayed client request cannot supersede a newer request without a fresh expected revision. |
| T03 Claim/exchange OAuth | Authenticated state/protocol checks plus live pending intent, unexpired target, expected revision and one exchange claimant | Durable exchange claim; perform provider exchange outside DB transaction | Crash after exchange but before durable receipt is EXCHANGE_UNKNOWN; do not assume code can be retried or token issuance did not occur. Cancel/supersede locally and require a fresh flow when safe recovery cannot be established. |
| T04 Stage and verify | Exchange evidence bound to intent/provider/client/account and requested scopes | Store encrypted non-live credential reference and per-target verification observations | Staging grants no normal read/send/sync access. Rejected or cancelled material is disposed of under the remote-scope policy, not blindly revoked. |
| T05 Activate/replace | Intent target still current and authorized; expected authorityRevision/sequence; provider account, scopes and readiness admitted for declared uses | Consume target once; create new local grant; retire/revoke replaced local grant as intended; update selector/reference and lifecycle receipt | Zero matching target means reject activation; no upsert fallback. Retries return prior receipt and cannot reinstall old credentials. |
| T06 Revoke/disconnect | Exact grant/target set and expected lifecycle revision; current revoke authority | Terminal revoke, revision advance, target-intent cancellation, disable new-use admission and fallback, detach live references, record cleanup obligations and receipt | Same command returns the original receipt. A stale retry cannot revoke N+1. No rollback of local revoke because remote cleanup is unknown. |
| T07 Rotate credential | Current grant and usable remote family; expected credential version and rotation claimant | Replace only that credential version/reference; record rotation basis; do not alter grant/intake | Old results cannot overwrite the new version. Ambiguous provider rotation uses J18 reconciliation; do not replay a potentially single-use refresh blindly. |
| T08 Record observation/project | Valid observation provenance; current projection basis where a projection is requested | Append evidence; conditional update of health/counters appropriate to the exact basis | Old success/failure remains historical. A no-longer-current result cannot grant authority or change current health. |
| T09 Admit and apply local ingress/sync work | J14 verified/bound occurrence; J13 purpose decision; current grant/config and K11 claim as required | Same commit gate as revoke plus domain/consumer mutations, consumption progress and durable causal event intent | Revocation first prevents new normal mutation; mutation first remains committed history. Cursor progression needs per-consumer completeness or explicit durable unresolved-item ownership. |
| T10 Admit external attempt | Exact ActionEnvelope, current J2/J15 authority/Clearance, readiness and current grant; K11 claim/attempt | Durable single-attempt dispatch admission and exact effect/credential/provider identity, serialized with local revoke | Does not assert a remote effect happened. Post-admission crash/timeouts remain potentially in-flight/unknown; section 4.3 bounds the guarantee. |
| T11 Reconcile historical effect | Trusted tenant/account/effect correlation; explicit bounded reconciliation authority | Idempotent permitted local consequences and evidence linked to the original effect | No grant/status activation; no fresh send/charge/refund. Reversal/compensation is a separately governed new effect. |
| T12 Retire remote subscription/authorization | Exact cleanup target; known dependency scope; purpose authority; shared-scope barrier where required | Reserve cleanup against target/scope; record attempt and certainty via J18; provider I/O outside transaction | Unknown outcome cannot be recast as confirmed teardown. Activation/registration that could be destroyed by the unsettled cleanup remains blocked unless independence is proved. |
| T13 Migrate legacy source | Explicit migration policy; trusted tenant/account and grant provenance or reconnection | Preserve source provenance, retire live fallback under revoke, attach only justified references/cursors; unknown history stays unknown | No inference of active grant from token presence, connected badge, email or lastSyncAt. Rollback cannot revive revoked fallback. |

### D04 - Current actor authority is not frozen inside OAuth state

HMAC, expiry and nonce remain valuable protocol checks. They do not prove the initiator is still permitted to connect a provider for the business. The activation commit must consume current authority (or a still-valid explicitly bounded delegation) and the current intent target. A membership/policy change during consent must not be ignored. Exact transaction/version integration with the existing K2/K3 authority owner is a named conformance requirement, not a claim it already exists.

### D05 - Partial Google-suite authorization is per target, not all-or-nothing by accident

One provider exchange may support multiple service targets. Each has its own expected local lifecycle revision and consumable target status. Disconnecting Drive cancels its pending target; still-authorized Gmail may activate only its own target. A whole remote-account/project revoke instead affects the dependency group. A partial grant/failed probe is reported per service; Forms scope evidence is not relabelled a live Forms probe.

An exchange that omits a refresh token must not inherit a previous account's refresh token. Reuse is permitted only with positively established same remote authorization/account lineage and version compatibility; otherwise refresh readiness is absent and background uses that require refresh are blocked. There is no requirement to fabricate a token or replace an unknown grant with a guessed one.

## 4. Ordering, concurrency and honest guarantees

### D06 - One local commit gate, not a detached status check

Select short database transactions using a common logical binding gate, plus expected-state/version conditions. The revoker, activator, rotator and affected local-domain mutation must all participate. Locking one row while another writer bypasses it does not enforce this contract. A SELECT inside a transaction without appropriate concurrency control is not sufficient.

Abstract algorithm (design, NOT executed SQL/code):

```text
begin short transaction
  lock binding gate in agreed ordering
  load current selector, authority revision and purpose policy
  verify expected grant/intent/config/credential coordinates as applicable
  verify current governing authority/control evidence
  on mismatch: no new live mutation; record/return a bounded rejected receipt
  otherwise: commit exact permitted write set and durable receipt/event intent
commit
```

Missing gate rows require a uniqueness-enforced initialization protocol; callers must not treat absence as permission to create an active binding. Multi-binding operations acquire gates in a stable order and retry only the transaction portion on conflict. Provider calls do not occur inside retried DB transactions. Cross-service authoritative stores require their own enforceable coordination contract; this document does not assert a distributed transaction exists.

External reference E3 documents the database ordering properties. The selection of this local protocol is a **target design inference**, not evidence that existing Prisma calls enforce it.

### D07 - Same-generation races need credential and projection versions too

A generation fence alone fails this counterexample:

```text
refresh A reads credential v4
refresh B installs v5 within the same active grant
A's delayed success/failure arrives
A overwrites v5 or marks it failed
```

T07 requires credential-version conditional installation. T08 requires observation basis and ordering, not arrival time or wall-clock comparison alone. Provider-specific rotation may require one rotation claimant for the shared credential family; a failed CAS does not prove there were no remote rotation consequences. Preserve those consequences for reconciliation and do not automatically revoke the returned token, whose remote scope may be shared.

A cursor or intake policy similarly has its own revision. Gmail completion is not allowed to turn intake back on. Preserving raw evidence for an already-admitted occurrence is distinct from creating new contacts/messages or claiming its semantic processing is complete.

### D08 - Local revocation cannot promise retroactive remote cancellation

Define the **dispatch admission boundary** precisely. T10 is a durable, single-attempt permission for one exact effect, ordered with T06; the actual network operation follows outside the database transaction. A pre-dispatch check is repeated as near to send as practical, but no database check alone makes remote I/O atomic with local revocation.

```text
revoke wins before T10 commits
  -> no new dispatch admission under the old grant
T10 wins before revoke
  -> exact admitted attempt may already be or become in flight
  -> record it in the revoke receipt; cancel/abort cooperatively where supported
  -> no blanket claim that the provider cannot act afterward
```

An outstanding admission is bounded to one claimant/attempt, exact payload and expiry; it is not a reusable old-connection credential lease. Retries require fresh current-purpose admission, not a recycled permit. Enforced provider fencing/cancellation can strengthen the guarantee only when actually available and proved. A paused process and a crash near send must be treated through K11/J18, not by asserting zero remote effects after a local status flip.

The disconnect receipt therefore separates:

```text
local new-use authority: REVOKED
known admitted/in-flight attempts: named or UNKNOWN
remote cleanup: pending / attempted / confirmed / failed / unknown / unsupported
provider effect outcomes: tracked independently
```

Do not suppress true provider-success evidence merely because the local grant was revoked before the response returned. Do not apply fresh downstream actions merely because a true old effect was reconciled.

## 5. Remote authority and cleanup - corrected target

### D09 - Local connector grant is not provider-wide authorization

Fresh pinned-source E1 shows the unified Google callback copies the same exchange token into multiple enabled service fields. External reference E4 documents that revocation can span a combined authorization and project clients for the associated user. **Design implication:** a Drive-only local disconnect is not automatically permission to revoke the underlying shared Google authorization.

Local per-service participation and the remote authorization's affected scope need separate references. Their dependency relationship is required even if stored in existing metadata rather than a new table. Do not group different users/tenants by display email, and do not claim every token in a deployment shares the same remote grant.

Supported target operations must be explicit:

- local service disconnect: revoke this local use, remove live references for it and preserve authorized sibling uses;
- remote account/project authorization revoke: obtain authority for the documented affected scope, suspend/revoke all affected local uses and expose that scope to the operator;
- subscription retirement: target the identified subscription/channel separately from credential grant revocation;
- unknown target scope: no destructive automatic cleanup; record the unresolved obligation and block only operations whose safety depends on it.

This is a correction to an over-broad possible implementation of the candidate, **not a claim that the current baseline already performs destructive remote revoke**.

### D10 - An old registration ID alone may not protect N+1

A local check before a remote delete has the same external race as send. Where the provider deletes by account/project or can affect related authorizations, a queued cleanup for N can damage N+1 even if the local callback/result writer is fenced.

Select a **remote-scope cleanup barrier**: reserve the affected scope before issuing destructive cleanup; prohibit conflicting registration/grant activation until the old request is terminal and its effective scope is known. New activation can proceed only when provider semantics establish independence (for example, a distinct immutable target with no wider revocation effect). Unknown old-request outcome means unknown safety; a lease timeout alone is not permission to reuse that scope.

Shared subscriptions cannot be deleted while other authorized owners depend on them. Authoritative provider/group identities and dependency discovery are conformance requirements, not inferred from local row IDs. Provider propagation delays and related-token effects remain separate from local control completion (E4/E5).

Cancelled OAuth exchanges and discarded refresh results follow this same rule. Never automatically call a broad revoke endpoint merely because a token failed a local generation CAS. That could undo a valid sibling/new grant. Retain only a policy-permitted sealed cleanup reference while resolving scope; never expose it for normal processing.

## 6. Purpose-specific admission contract

An admission result minimally references tenant, exact provider/account, purpose, source occurrence or action fingerprint, origin-lineage evidence/uncertainty, governing local grant or explicit historical decision, authority/config versions, allowed effects, expiry and decision reason. It is not a substitute for Clearance or ExecutionClaim.

| Purpose | Required basis | Allowed result | Not allowed |
|---|---|---|---|
| CONFIG_READ | Authenticated tenant-scoped read authority | Return masked/configuration information | Generate secret and reconnect as a hidden GET side effect. |
| CONFIG_WRITE / CONNECT | Current user/delegation authority and current intent/version | T01-T05 bounded mutation | Treat stored credentials as proof the user approved a new grant. |
| PROBE | Explicit diagnostic purpose plus permitted credential use | Bounded provider read/probe and T08 evidence | Provider send/write disguised as an automatically harmless test; grant activation on success. |
| NEW_INGRESS / SYNC | J14 authenticity/binding as applicable, current J13 processing purpose and intake policy | T09 bounded consumers and local consequences | Contact/KeyInbox mutation before admission; automatic adoption of unknown lineage. |
| NEW_EFFECT | Exact governed action, current connector readiness and grant, K11 claim | T10 one admitted attempt | Action substitution, old-permit replay or policy confidence as human control evidence. |
| HISTORICAL_RECONCILE | Trusted original-effect correlation and explicit bounded authority | T11 observe/complete allowed missing local consequences once | New charge/send/refund/reversal or reconnect. |
| CLEANUP | Exact remote target/scope, current cleanup authority and dependency barrier | T12 one identified cleanup attempt | Reuse newest credentials/registration by account lookup or destroy shared scope without authority. |

Default revoked/unknown callback handling records only policy-allowed evidence before review. Unauthenticated input never earns historical-reconciliation privilege. New explicit adoption of an old/unknown occurrence retains `originGrant = UNKNOWN/old` and records a separate current decision. J5 processing policy cannot independently waive J13/J14 requirements. Failure to correlate remains visible rather than guessed.

## 7. Adversarial analytical review

This section evaluates proposed rules against source-derived counterexamples; it does not execute the application or provider fixtures. COVERED means the selected contract specifies a response; LIMITED means the intended guarantee is explicitly bounded; DEFERRED refers to named adapter/implementation proof. **All cases below have runtime status NOT_EXECUTED.**

### 7.1 Existing 24 cases retained individually

| Case | Attempted failure | Contract disposition / mechanism |
|---|---|---|
| P01 | Authentic unseen WhatsApp callback after revoke creates work | COVERED: D03/T06/T09 deny normal old-grant use before domain mutations. |
| P02 | Same-phone reconnect relabels old first arrival current | COVERED: D03 separates origin and adoption; unchanged signature/mapping is insufficient. |
| P03 | Meta mapping delete/recreate bypasses revocation | COVERED: mapping supplies routing, not authority; T09 applies after trusted binding. |
| P04 | Scoped Meta URL supplies tenant identity without independent evidence | COVERED: J14 trusted account binding precedes J13 purpose decision. |
| P05 | Late known settlement/refund reconnects or duplicates an effect | COVERED: T11 correlates original effect, admits bounded local reconciliation only. |
| P06 | Unknown correlation is guessed current/successful | COVERED: D03 quarantine/review and explicit uncertainty; no blind effect. |
| P07 | Payment activity changes revoked to active | COVERED: W14/T08 has no authority write set. |
| P08 | QB fallback authorizes a post-clear provider attempt | COVERED: T06 disables live fallback by authority, T13 retires legacy reader bypass. |
| P09 | Xero smoke restores authority or migration removes tenant guard | COVERED: probe-only admission and T08; tenant-specific account proof retained. |
| P10 | Central-only credential removal stops blocking | COVERED: no alternate secret acquisition through the revoked use; missing references deny normal operation. |
| P11 | Disconnect races a request that already may reach provider | LIMITED: D08 preserves pre-admitted/in-flight truth, blocks new admissions and requires bounded reconciliation; not retroactive provider cancellation. |
| P12 | Cleanup timeout undoes local revoke | COVERED locally; remote confirmation DEFERRED: T06 receipt persists, T12 keeps uncertainty and barrier. |
| M004-01 | Old valid OAuth callback after disconnect installs live credentials | COVERED: T05 expected intent/revision fails; non-live disposal follows D10. |
| M004-02 | A's callback wins after newer B | COVERED: target sequence/intent CAS; activation cannot consume a superseded target. |
| M004-03 | Dedicated and generic Drive disconnect differ | COVERED contractually: W02/W04/W16 share T06; each actual entrypoint requires conformance proof. |
| M004-04 | Old activity reactivates old grant | COVERED: T08 append/projection-only write set. |
| M004-05 | Reconnect reuses old authority | COVERED: T02/T05 mint and consume a new grant; old identities remain revoked. |
| M004-06 | Refresh restores revoked credentials | COVERED locally: T07 current-grant plus credential CAS; returned token use requires new current-purpose admission. |
| N01 | Registry smoke paused before persistence overwrites revoke | COVERED: T08 cannot write lifecycle, and current projection basis must match. |
| N02 | Monitor error after revoke overwrites disconnected | COVERED: T08 records old observation only; stale failure cannot update new projection. |
| N03 | webhook-info GET silently reconnects | COVERED: W05 is read-only; explicit secret provisioning is distinct. |
| N04 | Gmail result restores intake/cursor after user change | COVERED for policy/version fencing: separate config/cursor conditions. Per-message durable recovery mapping remains a named conformance debt. |
| N05 | Partial suite callback restores a cancelled service | COVERED: D05 target-child CAS, verification classification and no old-account refresh inheritance. |
| N06 | Reconnect after cleanup failure is damaged by old cleanup | LIMITED pending remote-scope conformance: local revoke must succeed; D10 blocks conflicting activation, not merely its late result writer. |

### 7.2 Eight additional design counterexamples

| Case | Rejected weaker design | Selected correction and review result |
|---|---|---|
| A01 Same-grant refresh A/B | Generation check alone accepts both old/new credentials | D07 adds credential version and shared-family rotation ownership. COVERED locally; provider rotation recovery must conform. |
| A02 Actor loses connect authority during consent | Valid signed state permanently carries former permission | D04 checks current authority/delegation at activation. COVERED contractually; K2/K3 integration mapping required. |
| A03 Disconnect retry after N+1 | A repeated command revokes whatever is current now | T06 target/revision and operation receipt return the old result instead. COVERED. |
| A04 Lost exchange response | Retry OAuth code or infer no token was issued | T03 records EXCHANGE_UNKNOWN; fresh authorized flow or provider-supported recovery, plus scoped cleanup. COVERED with explicit uncertainty. |
| A05 Drive-only disconnect shares Google grant | Blind remote revoke deletes sibling authorization | D09 separates local service permission from provider scope. COVERED as a target correction, not a baseline incident. |
| A06 Stale cleanup races registration/reconnect | Check old ID locally, then delete by account after N+1 starts | D10 reserves affected remote scope until uncertainty is resolved; independent immutable targets must be proved. LIMITED by provider evidence. |
| A07 New account exchange lacks refresh token | Preserve any old refresh token because field was omitted | D05 requires positive same-account/family lineage or missing refresh readiness; do not create a mixed-account credential pair. COVERED. |
| A08 Signed first arrivals are observationally indistinguishable | Infer generation from receipt time, or claim perfect old/new filtering | D03 preserves UNKNOWN and separates explicit adoption authority. COVERED without fabricated provenance; policy tradeoff remains visible. |

These attacks changed the candidate: generation-only fencing, automatic broad token cleanup, callback-time-only checks and retroactive no-provider-effect promises were rejected. The model now includes credential/config coordinates, current actor authority, dispatch-boundary uncertainty and remote-scope dependency barriers.

## 8. Backward re-audit and causal reinjection

Read scope: BCR's R01-R07 contracts and earlier J5 re-audit are retained from the same pinned intelligence state; current kernel K7/K9 definitions and K11 dossier were additionally read. This is a target compatibility review, not a fresh whole-source re-audit of all adjacent journeys.

| Owner | Result | Exact relationship / remaining obligation |
|---|---|---|
| J5 / KF-REC-057 | RETAIN + REFINE | Keep one ConversationOccurrence/processing policy. Reference both original channel lineage and present admission decision; do not require a invented provider generation. Quarantined evidence is not normal KeyInbox processing. |
| J14 / KF-REC-035/036 | RETAIN + REFINE | Authenticate, bind tenant/account, identify occurrence, claim and durably admit. J13 supplies purpose authority; transport compatibility routes consume the same decision. No second ingress engine. |
| J18 / KF-REC-048 / K11 | RETAIN + REFINE | Reuse exact effect/attempt/claim and certainty-aware recovery. Pre-admitted remote attempts, lost token exchange and cleanup uncertainty do not become generic failure. Old cleanup cannot implicitly authorize retry with new account credentials. |
| J2 / J15 / K3 | RETAIN + REFINE | Current connector use is a prerequisite, not a substitute for ControlEvidence/Clearance. Connect-intent activation consumes current human authority; new adoption/reversal/compensation is separately governed. |
| K7 | RETAIN | Coordinates intent supersession, ordering, expiry and delayed results; K6 owns local valid transitions and K11 owns effect claims. Same gate must order local revoke and mutation, not just task selection. |
| K9 | REFINE | Add relationship between local grant, remote authorization scope and registrations to its existing ConnectorIdentity/ProviderAccount/ExternalEffectAttempt semantics. Provider-wide sharing is not inferred from local tenant identity. |
| K6 | RETAIN | Execute permitted domain write sets atomically with their consumption/fence requirements; a late response cannot roll back a true already-committed outcome. |
| J12 / K4 / K8 | RETAIN | Connector generation is not document revision or fact verification. Preserve exact source/effect evidence; historical adoption changes permission, not origin or truth strength. |
| J17 | RETAIN | Surface locally revoked, residual attempts, unknown remote scope and explicit cleanup blocking as attention candidates; do not create a parallel queue authority. |

Causal update, TARGET MODEL:

```text
explicit local revoke
 -> invalidate new-use admission and applicable connect targets
 -> dependent connector capabilities become unavailable for new work
 -> pending/current work rechecks at commit/admission, not only schedule time
 -> exact pre-admitted provider attempts remain reconcilable
 -> remote cleanup tracks its own scope/certainty
 -> operator attention reflects unresolved risk
 -> evidence/health can improve knowledge without granting new authority
```

A connector failure must not indiscriminately stop unrelated module work. A shared remote authorization loss may affect multiple local capabilities, but only the evidenced dependency set is propagated. This is compatible with the source blueprint's isolation-for-building / seamless-integration-for-users principle; it is not a restart of its historical stack prescription.

## 9. Migration sequence and proof obligations

No migrations are executed or authorized. Select this order because turning on a new badge or writing new grant IDs while legacy consumers still bypass admission would preserve the defect.

| Order | Bounded migration objective | Readiness evidence before promotion |
|---|---|---|
| 1 | Map current live readers/writers, authority storage and remote references for W01-W18 | Exact paths, guards, transaction owners and legacy fallbacks, with explicit remaining coverage boundaries. |
| 2 | Introduce or strengthen durable gate/intent/receipt and credential-version relationships | Missing-row uniqueness, same-command replay, actor change, revoke/activate race and recovery semantics mapped to existing stores. |
| 3 | Cut over lifecycle entrypoints and normal credential acquisition together | Dedicated Drive, suite, central credential routes, secret provisioning and adapter paths share the contract; no grandfathered fallback under revoke. |
| 4 | Fence local consumers and provider-attempt admissions | Every named producer/consumer either conforms or is visibly disabled from the claimed migrated scope. No fake safety from an unused new service. |
| 5 | Enable projection/diagnostic/cursor adapters | Observations cannot grant; cursor partial work has durable ownership; intake preferences remain user controlled. |
| 6 | Enable scoped remote cleanup and reconnect compatibility | Provider target/scope and dependency proof; cleanup reservation cannot destroy sibling/N+1; operational unknowns stay visible. |
| 7 | Migrate historical evidence and retire compatibility | Unknown old origin never backfilled as known; exact effect/occurrence identities preserved; rollback cannot revive obsolete secret access. |

Credential migration must not copy usable secrets into these intelligence documents, fixtures, logs or reviews. Prove account/ref relationships with metadata and controlled environment evidence. Connect-related DB retries must not replay provider exchange or remote effects implicitly.

## 10. Value-engineering decision

| Alternative | Disposition | Reason |
|---|---|---|
| H1: Add ConnectorStatus checks at ingress/scheduler only | REJECT as sufficient solution | W05/W06/W09/W11/W18 and post-check races survive; one overloaded status still mixes authority and observations. |
| H2: Replace all connectors/queues with a universal runtime | NOT JUSTIFIED | No evidence here requires replacing existing verifiers, domain owners, credential encryption or K11 execution fabrics. Broader replacement adds migration scope without proving the invariants. |
| H3: Shared logical authority transitions + existing adapters/claims + purpose-specific evidence | SELECTED CONTRACT CANDIDATE | Covers named writer/intent/admission semantics, preserves existing owners, and exposes provider uncertainty instead of inventing universal guarantees. |

Selection is a bounded architectural decision in this candidate, not allocation of KF-REC-058, approval of a physical schema, or production permission. Exact adapter conformance is the next work product, not another generic contract-definition cycle.

## 11. Gate update and finite continuation

| Existing BCR gate | New disposition | Reason / boundary |
|---|---|---|
| G01 context / G02 preserved evidence | PASS | Input head verified, old baseline preserved, both evidence strands and BCR retained. |
| G03 named writer scope / G05 bounded anti-duplication | RETAIN PASS_BOUNDED | All W01-W18 receive target roles; F227/C177 refinement retained, not reallocated. |
| G04 exhaustive source/provider coverage | DEFER_EXPLICIT_SCOPE | No whole-repository enumeration or live dashboard inspection claimed. Must not advertise universal conformance. |
| G06 ownership/admission | PASS_DESIGN_REFINED | D01-D05 and section 6 define purpose and origin/adoption separation. |
| G07 exact transition/fencing contract | PASS_DESIGN_WITH_STATED_GUARANTEE_LIMITS | T01-T13 specify conditions, write sets, replay and local ordering; D08/D10 explicitly limit remote guarantees. Implementation conformance not proved. |
| G08 migration ownership | PASS_DESIGN_ORDERED | Section 9 sequences retirement of bypasses and preserves legacy uncertainty. |
| G09 actual subscription/remote ownership | DEFER_NAMED_CONFORMANCE | Shared Google scope established as a design constraint; actual registrations/dependency configuration and cleanup outcomes remain unknown. |
| G10 backward re-audit | PASS_BOUNDED_TARGET_REVIEW | Section 8 retains ownership and names required interfaces. |
| G11 designed coverage | PASS_ANALYTICAL_MAPPING | All original 24 cases plus A01-A08 have dispositions; LIMITED cases are not hidden. |
| G12 runtime/provider/migration proof | NOT_EXECUTED | No application, concurrency or provider tests run. |
| G13 J13 provisional convergence | DEFER_CONFORMANCE_AND_MIGRATION_DECISION | Contract is now specified/reviewed. Named source-to-contract obligations below must be resolved before a bounded convergence decision. |
| G14 implementation authorization | UNAUTHORIZED | Production stays read-only; no execution packet promotion. |

### Next stage: J13_ADAPTER_CONFORMANCE_AND_MIGRATION_CLOSURE

Produce `J13-ADAPTER-CONFORMANCE-AND-MIGRATION-MAP.md` from this contract, not a new general provider scan or another lifecycle candidate. Work the following **four work items in order**, each ending in an evidence-linked close/defer/reopen judgment:

1. **Q1 Local commit/authority map.** For the shared controller/registry/credential service, Google suite/helper and dedicated Drive paths already named, map actual DB entities/keys, authentication/authority consumer and transaction/claim boundaries to T01-T10. State which existing storage/claim seams can be strengthened and which exact schema/interface gap remains. Keep new schema proposals unimplemented.
2. **Q2 Google remote dependency boundary.** Complete the named suite/dedicated service credential-reference and service-target map. Apply E4's remote-scope constraint; identify what account/client/credential-family evidence the baseline retains, what is missing, and how legacy references avoid cross-account refresh inheritance. No tenant secrets or live remote mutations.
3. **Q3 Retained callback and registration ownership.** Using SUP's known WhatsApp/Meta and payment surfaces, map current route/account/effect identifiers to T09/T11/T12. Distinguish local routing, customer-outbound webhooks, provider subscriptions and remote authorization revoke. Where source or current provider docs cannot establish a registration, explicitly defer actual deployment evidence rather than manufacture a delete operation.
4. **Q4 Closure decision.** Map the conformance/migration gaps back to all 32 designed cases. Decide whether J13 can be provisionally target-aligned at a declared scope, or name the exact invariant still unresolved. Runtime/deployment proof remains a separate unexecuted gate; it must not be silently turned into analytical proof, nor used as an excuse to restart closed source analysis.

Q1 is the immediate next action. Preserve the selected D/T contract unless a concrete counterexample falsifies it. Additional source reads require one of Q1-Q3, a contradiction or a stated provider constraint. No new finding/recommendation allocation without the existing canonical gate. Refresh the J13 dossier and all CURRENT/ROLLOVER pointers in the same checkpoint as the resulting work.

## 12. Evidence and context integrity

### Repository evidence

- BCR at input commit: source manifest S01-S07, W01-W18, R01-R07, P01-P12, M004-01-06 and N01-N06; supporting rather than independently reread provider files remain labelled inherited.
- E1 fresh named-scope source read: `apps/server/src/core/connectors/google-suite.service.ts`, baseline `8f173bfe79f1418159cf4099ea18b0d60d203ec2`, lines 180-285, blob `1c4a2e43480d8894bc9b26be05cb01d8c6efaf0f`. Copies one token response to enabled service columns; refresh column is conditional on response refresh_token; status writes follow awaited verification. This establishes code behavior, not actual deployment account/token sharing or a successful remote incident.
- E2 fresh full source read: `apps/server/src/modules/connect/google-token.helper.ts`, same baseline, blob `6087ec1dd1534ab1d5639c7b321b442fa6555bb0`. Reads refresh/access/expiry, awaits exchange, writes access/expiry by businessId and returns the token without an observed generation or expected-token condition.
- E2 static interleaving: read old credentials -> start refresh -> disconnect clears stored fields -> refresh succeeds -> helper restores access/expiry and returns token. **It does not restore the cleared refresh field.** The helper's next invocation still requires refresh presence. This is a conditional in-flight mutation/use path, not proof every subsequent Google path is enabled or that a runtime test passed. It strengthens M004-06/W18/F227 rather than allocating a new root.
- K7 definition/scope/inputs read at lines 1-155; K9 definition/scope/inputs read at lines 1-155; K11 dossier read in full from the intelligence input. Their older internal evidence-baseline headings are historical provenance, not a rebaseline of this tranche.
- Canonical comparison remains BCR section 7 and 04B. Existing finding homes are 08BC/09BC; provider safety constraints and candidate design attacks here do not create F228/C178 automatically.

### External research - separate from baseline implementation facts

Accessed 2026-09-16; primary sources only. These are constraints on the candidate, not evidence of code or tests running.

- E3: PostgreSQL 16, [Explicit Locking](https://www.postgresql.org/docs/16/explicit-locking.html), section 13.3.2; [Transaction Isolation](https://www.postgresql.org/docs/16/transaction-iso.html), section 13.2.1. Conflicting row mutations can be ordered with row locks; read-committed conditional updates re-evaluate their predicates. These facts motivate D06; they do not establish which isolation/locking policy this application actually uses. Exact deployed DB configuration is not inspected.
- E4: Google, [OAuth for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server), Incremental authorization and Revoking a token. Revocation scope can span combined scopes/project clients for the associated user, and effects may propagate after the response. D09-D10 are our design consequences, not a report of a live KEYFLOWOS revoke.
- E5: [RFC 7009](https://www.rfc-editor.org/rfc/rfc7009.html), sections 2.1-2.2. Revocation can affect related tokens; successful responses also cover already-invalid tokens; propagation and server errors need careful interpretation. This supports cleanup certainty separation without claiming universal provider behavior.

### Context Integrity Check

**PASS FOR THIS BOUNDED TARGET-CONTRACT TRANCHE.** Live intelligence head matched `a100ec1bc746e0433338e536fe21e05d55f49bb7`; main was independently observed at `88b8016c0ef45e383cc5b0d98c7062151a6a0f27`. New implementation reads used only the fixed baseline. AGENTS/AGENT-CONTINUITY and all microtraces/SUP/BCR are available from this continuous session; current START/STATE and all four CURRENT/ROLLOVER files were reread at the verified input. Active J13/K9/K7/K11 and adjacent J5/J14/J18/J2/J15/J12 are preserved. The last completed BCR and current planned contract were distinguished. Historical 04A/10P status conflicts remain resolved by 04B and the later J5 re-audit as recorded in BCR, not by silently reassigning IDs. Execution packets are unpromoted/unauthorized; existing packet-specific statuses are inherited, not independently re-audited. No missing context is concealed as runtime proof.

No production code, provider account, deployment, tenant data, test suite, schema or migration was modified. This tranche adds a reviewed target, two named source reads and clearly separated external constraints. Persistence verification is a repository operation, not an application test.
