# J13 Connector Lifecycle Microtrace 002 — Post-Disconnect Participation and Activity Resurrection

Status: COMPLETE MICROTRACE / J13 REMAINS ACTIVE
Date: 2026-09-15
Implementation evidence baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
Runtime proof: NOT EXECUTED
Production implementation: READ-ONLY / UNAUTHORIZED

---

## 1. Purpose

Continue J13 from Microtrace 001 by answering the narrow open question:

```text
Can connector-local activity bookkeeping or provider callback processing
rewrite a deliberately disconnected ConnectorStatus back to connected
without a new explicit reconnect/authentication grant?
```

This trace prioritizes Stripe, PayPal, QuickBooks, Xero, Gmail and Google Drive, then classifies the result against inherited F227/C177 before considering F228/C178.

---

## 2. Canonical result

**Yes, for Stripe and PayPal the current implementation contains reachable post-disconnect participation paths, and provider activity can restore `ConnectorStatus.status = connected` without an explicit reconnect grant.**

The observed mechanism is not a new independent root yet. It is a stronger cross-provider manifestation of inherited **F227/C177**:

```text
control plane says DISCONNECTED
+ usable credentials remain available
+ callback/outbound path does not consult ConnectorStatus
+ connector-local activity bookkeeping writes CONNECTED/HEALTHY
= old authority can continue participating and can resurrect displayed connector state
```

Therefore:

- **F228 / C178 remain UNALLOCATED**;
- this microtrace broadens F227/C177 from the already-proved WhatsApp ingress manifestation into payment-connector outbound/callback participation and activity resurrection;
- a distinct new root requires additional proof that the lifecycle defect is semantically independent rather than another consequence of the same non-load-bearing disconnect boundary.

---

## 3. Stripe trace — reachable post-disconnect participation

### 3.1 Disconnect is status-only

`apps/server/src/core/connectors/implementations/stripe.connector.ts`

Observed:

- `connect()` resolves a Stripe secret key from `Business.meta.stripeSecretKey` or global `STRIPE_SECRET_KEY` and writes connected/healthy status;
- `disconnect()` only upserts `ConnectorStatus` to disconnected/offline;
- `disconnect()` does **not** clear the business-scoped Stripe secret key and cannot revoke a global environment secret;
- `isConnected()` tests key presence, not `ConnectorStatus` lifecycle authority.

Therefore the post-disconnect state can be:

```text
ConnectorStatus = disconnected
credential source = still usable
StripeConnector.isConnected() = true
```

### 3.2 Outbound payment participation ignores the disconnected row

`apps/server/src/modules/payments/payments.service.ts`

Observed:

- `getAvailableGateways()` advertises Stripe when Stripe identifiers/keys exist in Business metadata or environment configuration;
- it does not require a connected `ConnectorStatus`;
- `createStripeCheckout()` resolves the same surviving key and calls Stripe directly;
- there is no connector-lifecycle authorization predicate between disconnected control state and provider effect attempt.

Thus a business can remain able to initiate Stripe payment participation after connector disconnect if credential material still exists.

### 3.3 Callback processing also ignores connector lifecycle state

Two webhook surfaces were inspected.

`apps/server/src/modules/payments/payments.service.ts`:

- `handleStripeWebhook()` validates the Stripe event and continues payment/invoice consequence processing;
- it does not test current `ConnectorStatus` before accepting the callback as live payment participation.

`apps/server/src/modules/webhooks/webhooks.controller.ts` legacy `/webhooks/stripe`:

- validates the Stripe signature;
- updates payment/invoice state;
- invokes `StripeConnector.emitPaymentReceived(...)` when a business is known;
- does not require the connector to still be connected.

### 3.4 Activity resurrection is reachable

`StripeConnector.emitPaymentReceived(...)` calls the local Stripe `trackActivity()` helper.

That helper unconditionally upserts:

```text
status = connected
healthStatus = healthy
lastActivity = now
```

Consequently a valid legacy Stripe provider callback arriving after disconnect can:

```text
accept/provider-process callback
→ produce business-side payment consequences
→ call emitPaymentReceived
→ call trackActivity
→ rewrite disconnected ConnectorStatus to connected/healthy
```

No reconnect/authentication generation is created in that path.

**Classification:** reachable **F227/C177 activity-resurrection manifestation**.

---

## 4. PayPal trace — reachable post-disconnect participation and resurrection

### 4.1 Disconnect is status-only while credentials survive

`apps/server/src/core/connectors/implementations/paypal.connector.ts`

Observed:

- PayPal credentials are resolved from `Business.meta.paypalClientId/paypalClientSecret` or environment configuration;
- `disconnect()` marks `ConnectorStatus` disconnected/offline;
- it does not clear the Business metadata credentials;
- `isConnected()` is based on credential presence rather than lifecycle status.

Therefore PayPal has the same core split:

```text
stored lifecycle status = disconnected
usable provider credential = present
```

### 4.2 Payment service does not load-bear on connector status

`apps/server/src/modules/payments/payments.service.ts`

Observed:

- gateway availability is credential/configuration based;
- PayPal checkout/provider paths do not require a currently connected ConnectorStatus;
- `handlePayPalWebhook()` verifies the provider callback and processes successful captures without a connector-status predicate.

### 4.3 PayPal callback directly triggers activity resurrection

After `PAYMENT.CAPTURE.COMPLETED`, the payment webhook path invokes `PayPalConnector.emitPaymentReceived(...)`.

`emitPaymentReceived(...)` calls PayPal's local `trackActivity()` helper, which unconditionally upserts connected/healthy state.

Reachable sequence:

```text
operator disconnects PayPal
→ ConnectorStatus = disconnected
→ credentials remain usable
→ provider sends a valid capture callback
→ PaymentsService verifies/processes callback
→ PayPalConnector.emitPaymentReceived
→ trackActivity
→ ConnectorStatus = connected/healthy
```

Again, no explicit reconnect grant is required.

**Classification:** reachable **F227/C177 activity-resurrection manifestation**.

---

## 5. QuickBooks and Xero — dangerous writer, post-disconnect reachability not yet proved

`quickbooks.connector.ts` and `xero.connector.ts` each contain connector-local `trackActivity()` helpers that can unconditionally write connected/healthy status.

However their disconnect seams are materially stronger than Stripe/PayPal:

- disconnect clears centralized connector credentials through `ConnectorCredentialsService`;
- normal outbound/smoke-test paths fetch credentials before successful activity tracking;
- after explicit credential clearing, those ordinary paths should fail before `trackActivity()` is reached.

Webhook/event helper methods can call `trackActivity()`, but this trace did not find a current production caller proving that a post-disconnect provider callback reaches those helpers.

Therefore:

```text
unconditional resurrection writer = PRESENT
post-disconnect callback reachability = NOT PROVED
canonical new root = NO
```

This remains a latent lifecycle hazard to revisit when concrete QuickBooks/Xero callback/subscription ownership is traced.

---

## 6. Gmail and Google Drive — dangerous writer, stronger local revocation seam

### Gmail

`GmailConnector.disconnect()` clears business-scoped Gmail access/refresh credentials and writes disconnected/offline status.

Its local `trackActivity()` can still write connected/healthy unconditionally, and emitter helpers call it, but no current caller was proved that can reach those emitters after credentials have been cleared.

### Google Drive

`GoogleDriveConnector.disconnect()` delegates to `GoogleDriveService.disconnect()`, which clears:

```text
driveAccessToken
driveRefreshToken
driveTokenExpiry
```

and then records disconnected/offline state.

The connector's `recordActivity()` can unconditionally write connected/healthy, but ordinary Drive operations require a valid access token first, so normal post-disconnect participation is credential-blocked.

The separate expiry/refresh-failure semantics remain open: a failed refresh throws but does not itself establish one canonical provider-revoked/credential-expired lifecycle transition. That question requires anti-duplication against existing readiness/honesty roots before any F228/C178 allocation.

---

## 7. Cross-provider classification matrix

| Connector | Disconnect clears usable credentials? | Normal outbound path checks lifecycle authority? | Callback path checks ConnectorStatus? | Local activity can write connected? | Post-disconnect resurrection proved? |
| --- | --- | --- | --- | --- | --- |
| WhatsApp | not a complete revocation boundary | no load-bearing lifecycle gate | no | activity/status disagreement already known | external participation already proved under F227/C177 |
| Stripe | **No** | **No** | **No** | **Yes** | **Yes — reachable** |
| PayPal | **No** | **No** | **No** | **Yes** | **Yes — reachable** |
| QuickBooks | Yes, centralized credentials cleared | credential-gated / positive `isConnected()` seams | callback reachability not proved | Yes | Not proved |
| Xero | Yes, centralized credentials cleared | credential-gated in traced paths | callback reachability not proved | Yes | Not proved |
| Gmail | Yes, business OAuth credentials cleared | token-gated | inbound emitter reachability not proved | Yes | Not proved |
| Google Drive | Yes, business OAuth credentials cleared | token-gated | callback path not established here | Yes | Not proved |

The important distinction is between **a dangerous writer existing** and **a disconnected path being able to reach that writer**. Only the latter is canonical implementation proof of resurrection.

---

## 8. Architectural interpretation

The connector layer currently allows three different concepts to masquerade as one status:

```text
credential/configuration presence
operational activity/health
lifecycle authorization
```

Stripe/PayPal prove why these must be separated.

An activity observation may establish:

```text
provider responded / event arrived / operation succeeded
```

It must **not** establish:

```text
this tenant has granted a new current connector binding
```

Target law remains:

```text
REVOKE(binding generation N)
→ N can never be made ACTIVE again by health/activity bookkeeping
→ a later ACTIVE state requires explicit reconnect/grant generation N+1
```

---

## 9. Canonical impact

### Strengthens existing root

**F227 / C177** should now be understood as a broader connector-lifecycle authority defect, with at least these proved manifestations:

1. WhatsApp: external ingress remains routable/processable after disconnected control state.
2. Stripe: credentials and payment paths remain live after disconnect; legacy callback activity can rewrite status to connected.
3. PayPal: credentials and payment paths remain live after disconnect; successful provider callback activity can rewrite status to connected.

### No new IDs allocated

```text
F228 = UNALLOCATED
C178 = UNALLOCATED
KF-REC-058 = UNALLOCATED
```

Reason: current evidence is parsimoniously explained by the same missing lifecycle authority boundary already represented by F227/C177.

---

## 10. Positive seams to preserve

- QuickBooks disconnect clearing centralized credentials.
- QuickBooks explicit connectedness guards on material outbound paths.
- Gmail and Google Drive clearing business-scoped OAuth credentials at disconnect.
- Health monitor behavior from Microtrace 001 that does not overwrite an explicitly disconnected row.
- Scheduled connector intelligence selecting connected rows rather than all configured connectors.

These show the implementation already contains pieces of the target invariant even though it is not universal.

---

## 11. Remaining J13 frontier

Next trace should move from explicit disconnect into **expiry, provider revocation and reconnect generation semantics**:

1. Google Drive refresh failure / expired-token durable state ownership.
2. Gmail refresh/expiry behavior and whether stale credential presence can be mistaken for authority/readiness.
3. QuickBooks/Xero OAuth reconnect and token replacement semantics.
4. Provider subscription/webhook cleanup during disconnect where supported.
5. Whether any reconnect path silently reuses historical provider destination/account identifiers without a new binding generation.
6. Whether callbacks can be associated with an old grant after a reconnect and still authorize current processing.

Before allocating F228/C178, compare any newly proved root against F227/C177, J14 provider-ingress authority, J18 recovery/certainty, F149/F159 provider-effect ambiguity, and existing readiness/honesty findings.

---

## 12. Continuity statement

J13 remains **ACTIVE**.

The exact next unit is not another generic connector scan. It is:

```text
OAuth/token expiry + provider revocation + reconnect generation trace
→ prove durable lifecycle transition ownership
→ test stale-generation callback/effect authority
→ anti-duplicate
→ allocate F228/C178 only if a genuinely independent root remains
```
