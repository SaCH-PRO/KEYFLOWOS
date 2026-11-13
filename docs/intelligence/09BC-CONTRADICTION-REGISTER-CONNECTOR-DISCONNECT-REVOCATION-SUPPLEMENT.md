# KeyFlowOS Contradiction Register — Connector Disconnect / Revocation Supplement

Status: CANONICAL CONTINUATION OF the KeyFlowOS contradiction register after C176.

Implementation evidence baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`.
Production implementation remains **READ-ONLY / UNAUTHORIZED**.
Runtime proof has **NOT** been executed.

---

## C177 — product/control state can say connector `disconnected` while provider-authenticated occurrences still remain admissible into normal business processing

**Related finding:** F227

### Intended/product meaning

```text
CONNECTOR = DISCONNECTED
→ the connector is no longer authorized to participate in live tenant processing
```

### Observed implementation meaning

```text
ConnectorStatus.status = disconnected
AND retained WhatsApp routing/config still maps provider phone_number_id to Business
AND valid signed callback arrives
→ webhook routes to business
→ receiveInbound()
→ contact resolution / events / KeyInbox / conversation persistence may continue
```

The disconnect transition is therefore not load-bearing as revocation of ingress authority.

### Additional contradiction

Business-scoped ConnectorStatus may be `disconnected` while `WhatsAppConnector.healthCheck()` can still report `connected` if a global WhatsApp access token exists.

So at least three distinct notions can disagree:

```text
stored connector lifecycle state
provider credential availability
actual ingress admissibility
```

### Target resolution

Make connector lifecycle authority explicit and monotonic:

```text
CONNECTED/ACTIVE binding generation
→ live ingress/effect authority

DISCONNECTED/REVOKED
→ no new normal processing under that binding generation
→ residual callbacks are audit/quarantine evidence only unless policy explicitly permits otherwise

RECONNECTED
→ new binding generation / authority grant
```

Authentication is necessary but not sufficient; a provider-authenticated event must also belong to a currently valid tenant-scoped connector binding.

No production implementation is authorized by this contradiction supplement.
