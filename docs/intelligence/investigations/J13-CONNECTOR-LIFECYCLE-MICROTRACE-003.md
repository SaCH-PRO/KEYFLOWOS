# J13 Connector Lifecycle Microtrace 003 — Expiry, Provider Revocation and Reconnect Generation

Status: COMPLETE MICROTRACE / J13 REMAINS ACTIVE
Date: 2026-09-15
Implementation evidence baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Runtime proof: NOT EXECUTED
Production implementation: READ-ONLY / UNAUTHORIZED

---

## 1. Purpose

Continue J13 after Microtrace 002 by tracing whether credential expiry, provider-side revocation and reconnect are represented as one durable connector lifecycle, with special attention to Google OAuth, Gmail, Google Drive, QuickBooks and Xero.

The questions are:

```text
expired access token
→ refresh attempt
→ refresh success/failure
→ durable lifecycle transition
→ provider revocation meaning
→ explicit reconnect
→ new authority generation?
```

---

## 2. Canonical result

The baseline does **not** have a first-class durable binding-generation lifecycle for OAuth expiry/revocation/reconnect.

Two implementation families exist:

1. **Google connectors** have real access/refresh/expiry token mechanics, but refresh failure is represented as a thrown/local error (and in Gmail ingestion a generic ConnectorStatus `error`), not as a durable provider-revoked / credential-expired authority transition.
2. **QuickBooks/Xero** advertise `authType: oauth2` but the traced baseline uses manually supplied access tokens and account/tenant identifiers, with no refresh-token lifecycle. `healthCheck()` treats token presence as connected even though provider usability may already have expired or been revoked.

Reconnect then overwrites the current token/status fields in-place. No durable binding/grant generation distinguishes old authority N from new authority N+1.

This is architecturally significant, but it is still best classified as a continuation of the J13 lifecycle-authority root already represented by **F227/C177**, plus existing readiness/honesty pressure, rather than allocating F228/C178 before the full anti-duplication pass is complete.

Therefore:

```text
F228 = UNALLOCATED
C178 = UNALLOCATED
KF-REC-058 = UNALLOCATED
```

---

## 3. Google shared refresh helper

`apps/server/src/modules/connect/google-token.helper.ts`

`GoogleTokenHelper.getValidAccessToken()` reads the service-specific access, refresh and expiry fields from `Business`.

Observed lifecycle:

```text
no refresh token
→ throw "<service> not connected"

unexpired access token
→ return existing token

expired/nearly-expired token + refresh token
→ call Google token endpoint
   ├─ success: overwrite access token + expiry, return new access token
   └─ failure: throw BadRequestException("Failed to refresh ... token")
```

On refresh failure the helper does **not**:

- clear the rejected refresh token;
- clear the stale access token;
- persist `expired` or `provider_revoked` state;
- persist a revocation reason;
- increment a connector binding generation;
- distinguish transient token-endpoint failure from permanent `invalid_grant`/provider revocation.

Thus the durable credential row can continue containing credentials that have already failed refresh, while lifecycle meaning is delegated to whatever caller catches the exception.

---

## 4. Gmail — generic error state substitutes for authority transition

`apps/server/src/core/connectors/implementations/gmail-ingestion.service.ts`

`syncInbox()` obtains its token through `GoogleTokenHelper`.

If token acquisition/refresh throws, the outer catch upserts Gmail `ConnectorStatus` as:

```text
status = error
lastError = <message>
lastErrorAt = now
errorCount += 1
```

This is operationally useful, but semantically incomplete.

A Google `invalid_grant` caused by revoked refresh authority and a transient Google/network failure collapse into the same generic `error` lifecycle. The implementation does not establish whether the connector is:

```text
ACTIVE but temporarily unhealthy
CREDENTIAL_EXPIRED
PROVIDER_REVOKED
RECONNECT_REQUIRED
```

The credentials themselves remain present after refresh failure.

When a later sync succeeds, Gmail ingestion upserts `status = connected`, so the status row primarily reflects latest operation health rather than a monotonic authority grant/revocation lifecycle.

**Classification:** strengthens J13's separation of lifecycle authority from operational health; no independent F228 root allocated yet.

---

## 5. Google Drive — explicit reconnect message, but no durable revocation state

`apps/server/src/modules/google-drive/google-drive.service.ts`

Drive has a dedicated `getValidAccessToken()` / `refreshAccessToken()` path.

Observed:

- access token expiry is detected from `driveTokenExpiry`;
- if a refresh token exists, Google refresh is attempted;
- on success, `driveAccessToken` and `driveTokenExpiry` are overwritten;
- on refresh failure, the service throws `Failed to refresh Google Drive connection. Please reconnect.`

The error tells the operator what to do, but durable lifecycle ownership is absent:

- stale/rejected access and refresh tokens remain stored;
- no `expired` / `provider_revoked` connector status is written in this service;
- no explicit revocation evidence object is created;
- no provider failure class distinguishes permanent grant loss from temporary refresh failure.

`getConnectionStatus()` reports `connected: !!driveAccessToken`, so a stale access-token value can still project as connected even after a refresh attempt has proved the current grant unusable.

This is a direct example of why credential presence cannot be the lifecycle authority root.

---

## 6. Google reconnect — overwrites authority in place

Two Google connect mechanisms were traced:

### Dedicated Drive flow

`saveDriveCredentials()` exchanges an authorization code and overwrites:

```text
driveEmail
driveAccessToken
driveRefreshToken
driveTokenExpiry
```

No historical binding generation is retained.

### Unified Google Suite flow

`apps/server/src/core/connectors/google-suite.service.ts`

The unified callback:

- verifies signed OAuth state;
- exchanges the code for Google tokens;
- writes per-service access/refresh/expiry fields for granted scopes;
- performs a live provider verification for each enabled service;
- upserts each ConnectorStatus to connected or error.

This contains an important positive seam: **fresh OAuth consent + live verification precede connected status**.

However reconnect still overwrites the same Business credential columns and the same `(businessId, connectorType)` status record. There is no persisted:

```text
bindingId
generation
old grant revokedAt
new grant connectedAt lineage
provider account binding lineage
callback/subscription generation
```

So reconnect establishes usable current credentials, but it does not create a durable N→N+1 authority boundary capable of rejecting stale callbacks/effects from an older grant.

---

## 7. QuickBooks — OAuth2 label, static access-token reality

`apps/server/src/core/connectors/implementations/quickbooks.connector.ts`

The connector declares:

```text
authType = oauth2
connectMode = dialog
```

but its connection instructions require the operator to generate and paste an OAuth **access token** plus Realm ID.

No refresh-token field/lifecycle appears in the traced connector contract.

`healthCheck()` computes:

```text
hasToken = accessToken || QUICKBOOKS_TEST_TOKEN
status = hasToken ? connected : disconnected
```

Therefore token **presence** is treated as connectedness even if the upstream token is expired or provider-revoked.

Actual provider usability is only tested by a provider call such as `smokeTest()` / material push paths. A failed provider call does not by itself transform the stored credential into a first-class expired/revoked binding generation.

Disconnect does clear centralized credentials, which remains a positive seam.

---

## 8. Xero — same static-token lifecycle gap

`apps/server/src/core/connectors/implementations/xero.connector.ts`

Xero likewise declares OAuth2 but asks the operator to paste an access token and tenant ID.

`healthCheck()` reports connected from token presence (or a test token). No refresh-token/expiry lifecycle is represented in the traced connector.

As with QuickBooks:

```text
credential string present
!= provider grant currently usable
```

The live `smokeTest()` can reveal provider rejection, but the connector model lacks a durable transition from active grant to expired/provider-revoked/reconnect-required authority.

Disconnect clearing centralized credentials is directionally correct, but expiry/revocation before explicit disconnect remains under-modelled.

---

## 9. State ownership comparison

| Provider family | Expiry known? | Refresh supported? | Refresh failure durability | Provider-revoked state? | Reconnect generation? |
| --- | --- | --- | --- | --- | --- |
| Google shared token helper | Yes | Yes | exception only | No explicit durable state | No |
| Gmail ingestion | Yes via helper | Yes | generic ConnectorStatus `error` | No | No |
| Google Drive | Yes | Yes | exception instructing reconnect | No durable revoke transition in service | No |
| QuickBooks | Not modelled in connector | No refresh lifecycle in traced baseline | provider operation may fail | No | No |
| Xero | Not modelled in connector | No refresh lifecycle in traced baseline | provider operation may fail | No | No |

---

## 10. Target lifecycle law strengthened

The trace strengthens the J13 target model:

```text
ACTIVE(binding generation N)
  ├─ access-token rollover succeeds
  │    → remain ACTIVE(N), rotate credential material with evidence
  ├─ transient refresh failure
  │    → DEGRADED(N), authority uncertainty classified
  └─ permanent invalid_grant / provider revoke
       → PROVIDER_REVOKED(N)
       → no new provider work may claim authority under N
       → explicit reconnect required
       → ACTIVE(binding generation N+1)
```

Operational health and token refresh mechanics must not silently become the authority state machine.

---

## 11. Anti-duplication classification

This trace does **not** allocate a new root yet.

Reasons:

1. The absence of binding generation is already part of J13's architectural explanation for F227/C177.
2. The false implication `credential present ⇒ connected/usable` overlaps established readiness/honesty concerns and must be compared against their canonical homes before a new finding is justified.
3. Provider-call failure/retry uncertainty overlaps J18 and provider-effect ambiguity roots such as F149/F159.
4. Ingress acceptance from stale grants is J14-adjacent and requires a concrete callback/subscription trace before a separate connector-lifecycle finding is warranted.

Current classification:

```text
Google refresh failure semantics
→ F227/C177 lifecycle-authority strengthening + readiness/honesty pressure

QuickBooks/Xero token-presence connectedness
→ readiness/honesty pressure + J13 lifecycle gap

reconnect without generation
→ F227/C177 architectural strengthening
```

---

## 12. Positive seams to preserve

- Google access-token expiry is explicitly tracked.
- Google refresh-token rotation path exists.
- Unified Google Suite connection performs fresh consent and per-service live verification before saying connected.
- Google Drive/Gmail explicit disconnect clears business-scoped credentials.
- QuickBooks/Xero explicit disconnect clears centralized connector credentials.
- QuickBooks/Xero provider smoke tests can distinguish configured credentials from real provider usability at test time.

---

## 13. Remaining J13 frontier

The highest-value remaining trace is now **provider subscription/callback lineage across disconnect and reconnect**:

1. identify connectors that establish provider webhook/watch/subscription registrations;
2. determine whether disconnect removes those provider-side subscriptions;
3. determine whether callbacks carry enough provider/account/binding identity to associate them with grant N;
4. reconnect and establish whether old callbacks from N can still route under current N+1 credentials/status;
5. trace Google watch/subscription cleanup if present, plus Meta/WhatsApp and payment webhook ownership;
6. anti-duplicate against J14 ingress occurrence/authentication and J18 recovery before F228/C178.

The decisive new-root question is:

```text
Can a callback/effect that is cryptographically/provider-valid but belongs to an old revoked grant generation still be accepted after reconnect because KeyFlow has no generation lineage?
```

Until that is proved reachable, F228/C178 remain free.

---

## 14. Continuity statement

J13 remains **ACTIVE** through Microtrace 003.

Exact next unit:

```text
provider subscription cleanup + stale-generation callback lineage
→ disconnect provider-side registration semantics
→ reconnect N+1
→ old callback/effect authority test
→ anti-duplicate
→ allocate F228/C178 only if independently justified
```
