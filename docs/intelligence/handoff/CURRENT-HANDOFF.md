# KeyFlowOS Current Handoff

Last updated: 2026-09-15
Status: CURRENT — J13 CONNECTOR LIFECYCLE ACTIVE THROUGH MICROTRACE 003

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

J5 Conversation → Business Action is provisionally converged through F227/C177/KF-REC-057 and remains reopenable if J13/J22/runtime proof falsifies its target semantics.

## Active frontier — J13 Connector Lifecycle

Dossier: `docs/intelligence/journeys/KF-JOURNEY-013-CONNECTOR-LIFECYCLE.md`

Microtraces:

1. `docs/intelligence/investigations/J13-CONNECTOR-LIFECYCLE-MICROTRACE-001.md`
2. `docs/intelligence/investigations/J13-CONNECTOR-LIFECYCLE-MICROTRACE-002.md`
3. `docs/intelligence/investigations/J13-CONNECTOR-LIFECYCLE-MICROTRACE-003.md`

### Canonical root reused

```text
F227 / C177
→ connector "disconnected" is not universally a load-bearing revocation of external participation
```

No new J13 root has been allocated yet.

### Microtrace 002 — post-disconnect participation / resurrection

- Stripe and PayPal explicit disconnects are status-only while usable credential material remains.
- Their payment/callback paths do not require connected ConnectorStatus.
- Successful provider callback activity can invoke connector activity bookkeeping and rewrite disconnected state to connected/healthy without an explicit reconnect grant.
- QuickBooks/Xero activity writers can also write connected, but explicit disconnect clears centralized credentials and ordinary post-disconnect reachability was not proved.
- Gmail/Google Drive clear business-scoped OAuth credentials on explicit disconnect; normal post-disconnect paths are therefore credential-blocked.

Classification: Stripe/PayPal strengthen F227/C177; F228/C178 remain free.

### Microtrace 003 — expiry / revocation / reconnect generation

- Google has actual access/refresh/expiry token mechanics.
- Shared Google token refresh failure throws but does not clear stale credentials or persist a durable `expired` / `provider_revoked` authority state.
- Gmail ingestion collapses refresh/acquisition failure into generic ConnectorStatus `error`.
- Google Drive tells the caller to reconnect after refresh failure, but stale token material remains and connection projection can still be based on token presence.
- Unified Google Suite OAuth is a strong positive seam: fresh consent and per-service live verification precede connected status.
- Reconnect overwrites the current credential/status records in place; no binding/grant generation N→N+1 is persisted.
- QuickBooks/Xero declare OAuth2 but use manually supplied access tokens in the baseline, with no refresh-token lifecycle; health checks infer connectedness from token presence rather than proven current provider usability.

Classification: lifecycle-authority/readiness pressure, but no independent F228/C178 before stale-generation callback lineage is proved and anti-duplicated.

## Working target law

```text
ACTIVE(binding N)
→ token rollover may rotate credentials while remaining N
→ permanent provider revoke/invalid_grant durably revokes N
→ activity/health bookkeeping cannot reactivate N
→ explicit reconnect creates ACTIVE(binding N+1)
→ callbacks/effects tied to revoked N cannot authorize current work
```

Lifecycle authority, operational health and credential presence are distinct concepts.

## Exact next action

```text
1. identify provider webhook/watch/subscription registrations and disconnect cleanup;
2. trace Google, Meta/WhatsApp, Stripe/PayPal and QuickBooks/Xero registrations where present;
3. model reconnect as generation N+1 and test whether old callbacks/effects from N can still route;
4. determine whether callbacks contain enough account/grant identity to reject stale generations;
5. anti-duplicate against F227/C177, J14 ingress, J18 recovery and F149/F159 provider-effect ambiguity;
6. allocate F228/C178/KF-REC-058 only if a genuinely independent root survives;
7. keep production code untouched and do not claim runtime proof.
```

If continuity is lost, resume from **J13 provider subscription cleanup + stale-generation callback lineage after Microtrace 003**.
