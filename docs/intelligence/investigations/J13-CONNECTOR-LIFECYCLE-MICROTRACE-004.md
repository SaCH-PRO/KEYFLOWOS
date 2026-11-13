# J13 Connector Lifecycle Microtrace 004 — Stale OAuth Connect Intent and Split Drive Lifecycle Ownership

Status: COMPLETE MICROTRACE / J13 REMAINS ACTIVE
Date: 2026-09-16
Implementation evidence baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Runtime proof: NOT EXECUTED
Production implementation: READ-ONLY / UNAUTHORIZED

---

## 1. Purpose

Continue J13 after Microtrace 003 by testing two narrower lifecycle questions:

1. can an OAuth authorization response that was initiated before disconnect still restore credentials after that disconnect because the connect intent has no revocable generation/epoch; and
2. does Google Drive have one authoritative disconnect path, or multiple lifecycle surfaces that can diverge.

This tranche also anti-duplicates the new evidence against the inherited F227/C177 connector-revocation root rather than allocating new IDs reflexively.

---

## 2. Exact-baseline evidence

### 2.1 Dedicated Google Drive OAuth state has authenticity and expiry, but no lifecycle generation

`apps/server/src/modules/google-drive/google-drive.service.ts`

The dedicated Drive OAuth state contains:

```text
businessId
nonce
exp
flow
```

It is HMAC-signed and expires after ten minutes. This is a positive security seam: a caller cannot simply invent another businessId without a valid signature.

However, the state carries no durable connect-intent identifier, connector binding ID, lifecycle generation, disconnect epoch, or revocation counter.

Therefore the state proves:

```text
this callback belongs to a signed authorization flow that was valid when issued
```

but not:

```text
this authorization flow is still the currently authorized connect intent after later lifecycle mutations
```

### 2.2 Dedicated callback accepts any still-valid signed state

`apps/server/src/modules/google-drive/google-drive.controller.ts`

The callback route verifies state and then calls:

```text
saveDriveCredentials(oauthState.businessId, code)
```

There is no second check against a durable connect-intent generation or a later disconnect/revocation marker.

The callback is intentionally not protected by the normal authenticated business guards because it is the OAuth redirect endpoint; its authority comes from the signed state. The important issue is not absence of those guards, but that the signed state is not invalidated by an intervening disconnect.

### 2.3 Credential persistence can therefore occur after an intervening disconnect

`saveDriveCredentials()` exchanges the code, resolves the Google account and overwrites:

```text
driveEmail
driveAccessToken
driveRefreshToken
driveTokenExpiry
```

The dedicated service disconnect clears those same fields.

Static reachability therefore supports the following race:

```text
T0 user requests Drive auth URL
T1 signed state S is issued and remains valid for <=10 minutes
T2 user explicitly disconnects Drive
T3 provider redirects the already-started OAuth flow with valid code + S
T4 callback verifies S (still cryptographically valid and unexpired)
T5 saveDriveCredentials writes new Drive credentials
```

No durable lifecycle generation/cancellation check appears between T2 and T5.

Result: an explicit disconnect does not necessarily cancel an already-issued Drive connect intent. A late but valid OAuth callback can re-credential the business without a fresh post-disconnect connect action.

This is a stronger lifecycle-resurrection form than ordinary token refresh: the callback can install new credential material after disconnect because authorization-flow validity and current lifecycle authority are not distinguished.

Runtime proof has not been executed; this is exact-baseline static reachability.

---

## 3. Google Drive has split disconnect ownership

There are at least two lifecycle surfaces for Drive in the baseline.

### Connector-class disconnect

`apps/server/src/core/connectors/implementations/google-drive.connector.ts`

This path:

1. clears Drive email/access/refresh/expiry from `Business`; and
2. upserts `ConnectorStatus(google_drive)` to `disconnected`.

That is internally coherent as a local disconnect projection.

### Dedicated Drive service/controller disconnect

`apps/server/src/modules/google-drive/google-drive.service.ts`
`apps/server/src/modules/google-drive/google-drive.controller.ts`

The guarded endpoint:

```text
DELETE /drive/businesses/:businessId/disconnect
```

calls `GoogleDriveService.disconnect()`.

That service clears the same credential fields but does not update shared `ConnectorStatus`.

Therefore a user can traverse a legitimate disconnect route that removes credentials while the canonical-looking ConnectorStatus row remains `connected` until another writer/observer changes it.

This is the inverse split-brain of F227-style retained external participation:

```text
credentials absent / provider work blocked
while
status projection may remain connected
```

It proves that lifecycle ownership is fragmented across credential storage, status projection and connector/service entrypoints.

---

## 4. Activity writer remains non-authoritative but can mutate status

`GoogleDriveConnector.trackActivity()` upserts `ConnectorStatus.status = connected` whenever its local activity helpers run.

Normal post-disconnect Drive operations are credential-blocked because connector/service disconnect clears business-scoped credentials. That is a positive seam.

However, the status writer itself still treats observed activity as sufficient evidence to set `connected`; there is no lifecycle-generation predicate. This remains part of the broader J13 rule:

```text
activity evidence != authority grant
```

The newly proved stale OAuth callback path is more important because it can first restore credentials, after which later ordinary activity can again project connectedness.

---

## 5. Anti-duplication classification

The new evidence is semantically adjacent to F227/C177 but not identical in mechanism.

Inherited F227/C177 explains that a displayed/control `disconnected` state is not universally a load-bearing revocation of provider participation, especially where provider-authenticated ingress remains routable.

Microtrace 004 adds two narrower mechanisms:

1. **stale connect-intent resurrection** — a pre-disconnect OAuth state remains valid after disconnect and can install credentials later; and
2. **split lifecycle ownership** — one Drive disconnect surface clears credentials without updating the shared status projection, while another clears both.

Both could justify a distinct finding if the canonical registers do not already encode stale intent/generation invalidation or fragmented lifecycle ownership. However, allocation remains deferred until the anti-duplication pass against J14 ingress, readiness/honesty, connector state-machine findings and existing recommendation semantics is complete.

Therefore:

```text
F228 = UNALLOCATED
C178 = UNALLOCATED
KF-REC-058 = UNALLOCATED
```

Candidate root wording, NOT YET ALLOCATED:

```text
Connector lifecycle mutations do not invalidate outstanding connect intents or share one authoritative binding generation; a still-valid pre-disconnect OAuth callback can re-establish credentials after disconnect, and different lifecycle entrypoints can leave credential truth and status projection divergent.
```

---

## 6. Target lifecycle law strengthened

The target state now needs an explicit connect-intent/binding generation boundary:

```text
DISCONNECTED / REVOKED generation N
→ explicit CONNECT request creates connectIntent I for proposed generation N+1
→ OAuth state binds to {business, connector, connectIntent I, generation N+1}
→ callback may install credentials only if I is still current and not cancelled
→ successful provider verification activates binding N+1
→ DISCONNECT increments/revokes lifecycle epoch and cancels all pending intents for <=N+1
→ late callback for cancelled/stale I is rejected or quarantined; it MUST NOT restore credentials/status
```

Additional invariant:

```text
all disconnect entrypoints delegate to one lifecycle authority
→ credential clearing
→ provider-side subscription teardown where applicable
→ binding revocation
→ status projection update
→ pending-connect-intent cancellation
```

Status becomes a projection of authoritative lifecycle state, not a separately writable authority flag.

---

## 7. Proof ratchets implied by this trace

Future implementation packets/tests must include at least:

```text
1. initiate OAuth -> disconnect -> deliver original callback -> credentials remain absent and lifecycle remains revoked;
2. initiate OAuth A -> initiate OAuth B -> callback A after B -> A rejected as stale;
3. disconnect through every public Drive entrypoint -> identical authoritative lifecycle result;
4. stale activity cannot promote revoked generation to connected;
5. reconnect creates a new generation and only callbacks bound to that generation can activate it;
6. token refresh may rotate credentials inside the same active generation but cannot resurrect a revoked one.
```

---

## 8. Positive seams to preserve

- OAuth state is HMAC-authenticated and time-bounded.
- Dedicated Drive connect flow obtains fresh provider tokens instead of trusting arbitrary client-supplied credentials.
- Dedicated and connector-class disconnect both clear Drive credential material.
- Connector-class disconnect also writes the disconnected status projection.
- Normal Drive operations require credential presence, so ordinary post-disconnect execution is generally blocked.

The target should preserve these seams while centralizing authority.

---

## 9. Remaining J13 frontier

The next unit remains provider binding/subscription lineage across disconnect/reconnect, now with a sharper generation model:

```text
A. enumerate webhook/watch/subscription registration ownership;
B. prove provider-side cleanup on disconnect;
C. determine callback identity/account/binding lineage;
D. reconnect as generation N+1;
E. test whether callbacks/effects from revoked N still route or can mutate N+1;
F. anti-duplicate candidate stale-intent/split-ownership root before allocating F228/C178;
G. preserve distinction between reconciliation of known prior effects and authority to originate new effects.
```

Priority remains Google watch/subscriptions, Meta/WhatsApp, Stripe/PayPal, then QuickBooks/Xero registration where present.

---

## 10. Continuity statement

J13 is active through **Microtrace 004**.

No new canonical finding/contradiction/recommendation ID has been allocated.

Exact resume point:

```text
J13 provider subscription cleanup + stale generation callback lineage
→ use Microtrace 004's connect-intent generation law
→ enumerate every lifecycle/status writer
→ anti-duplicate stale-intent + split-ownership candidate root
→ allocate F228/C178 only if independent after register comparison
```
