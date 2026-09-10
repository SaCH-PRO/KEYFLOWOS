# J13 Connector Lifecycle — Microtrace 001

Status: ACTIVE MICROSCOPIC TRACE
Date: 2026-09-10
Implementation evidence baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Production implementation remains READ-ONLY / UNAUTHORIZED.
Runtime proof has NOT been executed.

## Scope

Initial cross-provider trace of lifecycle authority versus credentials, health, polling, ingress and disconnect semantics.

## Stable inherited root

`F227 / C177` remains the canonical opening J13 root: connector `disconnected` state is not a universally load-bearing revocation boundary for new provider participation. WhatsApp is the proven manifestation.

## Shared interface

`IConnector.disconnect(businessId): Promise<void>` defines no typed semantic postcondition. Connector implementations therefore independently decide what disconnect means. This explains F227 but is not allocated as a separate F228.

## Credential service

`ConnectorCredentialsService` is a positive centralization seam:

- encrypted credentials live in `ConnectorStatus.metadata.encryptedCredentials`;
- `setCredentials()` marks status connected;
- `clearCredentials()` removes encrypted credentials and marks status disconnected;
- client reads are masked.

Its `readCredential()` supports backwards-compatible fallback to `Business.metaData[legacyMetaKey]` when the encrypted store is empty.

Repository search found readers for QuickBooks/Xero legacy keys but no current writers for `quickbooksAccessToken`, `quickbooksRealmId`, or `xeroAccessToken`. Therefore the fallback is a migration-risk surface, not yet proof of a current new revocation root. Do not allocate F228 from this alone.

## Health monitor

`ConnectorHealthMonitorService` monitors only rows currently in:

```text
connected | syncing | error | expired
```

It does not scan `disconnected` rows. A normal disconnected row is therefore not resurrected by the health monitor itself.

The monitor only writes failure states (`error` or `expired`) after unsuccessful connector tests; successful tests do not rewrite lifecycle status.

This is a positive narrowing seam.

## Scheduled connector intelligence

`ConnectorIntelligenceService.scanBusinessConnectors()` explicitly selects only:

```text
ConnectorStatus.status = connected
```

before scheduled Drive/WhatsApp/Meta/Forms/Gmail scanning.

Therefore ordinary disconnect does stop this scanner as long as the ConnectorStatus row remains disconnected.

This makes status-resurrection writers consequential: any callback/activity helper that changes a revoked/disconnected row back to `connected` can re-enable future scheduled participation.

## Cross-provider disconnect sample

### Google Drive

Positive:

- disconnect clears business-scoped access token, refresh token, token expiry and connected email;
- status is set disconnected;
- health derives actual connected state from token presence;
- unsupported provider pull sync reports explicit `PULL_SYNC_NOT_IMPLEMENTED` rather than false success.

Pressure:

- `trackActivity()` upserts ConnectorStatus as connected when Drive activity emitter methods run. Caller/authority trace remains open.

### QuickBooks

Positive:

- disconnect clears centralized connector credentials;
- material push operations call `isConnected()` before provider effects;
- unsupported pull sync is represented honestly.

Pressure:

- webhook/event helpers call `trackActivity()`;
- connector contains backwards-compatible reads from legacy Business metadata;
- exact `trackActivity()` status semantics and webhook route lifecycle predicates remain open.

### WhatsApp

Negative / canonical F227:

- disconnect only records status disconnected;
- retained routing/config can remain;
- valid shared provider callback can route to `receiveInbound()` without checking connector lifecycle authority;
- health can derive connected from global token independently of stored business status.

## Anti-duplication verdict

No F228 / C178 allocated in this microtrace.

Current observations either:

- strengthen F227/C177;
- are positive narrowing seams; or
- remain unproven migration/caller risks.

## Exact next trace

1. inspect per-connector `trackActivity()` implementations and callers, especially callback paths, for disconnected→connected resurrection;
2. trace QuickBooks/Xero/Stripe/PayPal webhook controllers against ConnectorStatus/binding authority;
3. trace Gmail/Google OAuth refresh, expiry, disconnect and reconnect generation semantics;
4. trace provider subscription/webhook cleanup at disconnect;
5. determine whether `setCredentials()` marking connected before real provider verification creates a distinct connection-evidence semantic root or is already covered by existing honesty/readiness findings;
6. allocate F228/C178 only after semantic anti-duplication.
