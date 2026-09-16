# KeyFlowOS Current Handoff

Last updated: 2026-09-16
Status: CURRENT — J13 CONNECTOR LIFECYCLE ACTIVE THROUGH MICROTRACE 004

## Integrity

```text
repository:            SaCH-PRO/KEYFLOWOS
implementation branch: main
forensic baseline:     8f173bfe79f1418159cf4099ea18b0d60d203ec2
intelligence branch:   docs/keyflow-intelligence-foundation
production code:       READ-ONLY / UNAUTHORIZED
context integrity:     PASS
runtime proof:         NOT EXECUTED
```

Later main movement has been observed but no deliberate forensic rebaseline has been taken.

## Canonical ranges

```text
Findings:         F001–F227
Contradictions:   C001–C177
Recommendations: KF-REC-001–KF-REC-057
Concepts:         KF-CONCEPT-001–KF-CONCEPT-042
Next free:        F228 / C178 / KF-REC-058 — UNALLOCATED
```

J5 Conversation → Business Action remains provisionally converged through F227/C177/KF-REC-057 and reopenable if J13/J22/runtime proof falsifies its target semantics.

## Active frontier — J13 Connector Lifecycle

Dossier: `docs/intelligence/journeys/KF-JOURNEY-013-CONNECTOR-LIFECYCLE.md`

Microtraces:

1. `docs/intelligence/investigations/J13-CONNECTOR-LIFECYCLE-MICROTRACE-001.md`
2. `docs/intelligence/investigations/J13-CONNECTOR-LIFECYCLE-MICROTRACE-002.md`
3. `docs/intelligence/investigations/J13-CONNECTOR-LIFECYCLE-MICROTRACE-003.md`
4. `docs/intelligence/investigations/J13-CONNECTOR-LIFECYCLE-MICROTRACE-004.md`

### Canonical inherited root

```text
F227 / C177
→ connector "disconnected" is not universally a load-bearing revocation of external participation
```

No new J13 root has been allocated yet.

## Microtrace 004 — new exact-baseline result

Dedicated Google Drive OAuth state is HMAC-authenticated and time-bounded, but carries no durable connect-intent ID, lifecycle generation or revocation epoch. The callback verifies any still-valid signed state and then saves credentials without checking whether a disconnect occurred after the auth URL was issued.

Static reachability therefore supports:

```text
request auth URL
→ receive signed state S
→ disconnect Drive
→ old OAuth flow returns with still-valid code + S
→ callback accepts S
→ saveDriveCredentials writes new Drive credentials
```

Thus an explicit disconnect does not necessarily cancel an already-issued Drive connect intent. Runtime proof has NOT been executed.

A second exact-baseline issue is split Drive lifecycle ownership:

- `GoogleDriveConnector.disconnect()` clears credentials and updates shared `ConnectorStatus` to disconnected.
- `GoogleDriveService.disconnect()` clears credentials only.
- `DELETE /drive/businesses/:businessId/disconnect` calls the service path.

Therefore a legitimate public disconnect route can leave credentials absent while the shared status row remains connected until another writer changes it.

Classification: this may be an independent stale-intent / fragmented-lifecycle root, but F228/C178 remain unallocated until anti-duplication against the canonical registers and J14/J18/readiness roots is complete.

## Working target law

```text
one tenant-scoped ConnectorBinding generation is the authority root
→ lifecycle authority is separate from operational health and credential presence
→ OAuth connect intent binds to a proposed generation
→ disconnect revokes current generation AND cancels pending connect intents
→ activity/health cannot reactivate a revoked generation
→ provider invalid_grant/revocation creates durable lifecycle evidence
→ reconnect creates N+1
→ callbacks/effects from N cannot authorize current work after N is revoked
→ reconciliation of known prior effects is distinct from permission to originate new effects
```

All public lifecycle entrypoints should delegate to one lifecycle authority that coordinates credential clearing, provider-side subscription teardown, binding revocation, status projection and pending-intent cancellation.

## Exact next action

```text
1. enumerate provider webhook/watch/subscription registrations and disconnect cleanup;
2. trace Google, Meta/WhatsApp, Stripe/PayPal and QuickBooks/Xero where registrations exist;
3. reconnect conceptually as generation N+1 and test whether old callbacks/effects from N still route;
4. determine whether callback identity can bind to provider account + connector generation;
5. enumerate every ConnectorStatus writer and classify: grant-creating / projection-only / activity-evidence / health-observation / revocation;
6. anti-duplicate Microtrace 004 candidate root against F001-F227, C001-C177, KF-REC-001-057, J14, J18, F149/F159 and readiness/honesty roots;
7. allocate F228/C178/KF-REC-058 only if genuinely independent;
8. keep production untouched and do not claim runtime proof.
```

If continuity is lost, resume from **J13 provider subscription cleanup + stale-generation callback lineage after Microtrace 004**, with the stale Drive OAuth connect-intent race and split disconnect ownership already proven statically at the fixed baseline.
