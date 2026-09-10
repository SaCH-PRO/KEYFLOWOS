# KeyFlowOS Finding Register — Connector Disconnect / Revocation Supplement

Status: CANONICAL CONTINUATION OF the KeyFlowOS finding register after F226.

Implementation evidence baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`.
Production implementation remains **READ-ONLY / UNAUTHORIZED**.
Runtime proof has **NOT** been executed.

Canonical sequence continues after F226.

---

## F227 — connector `disconnected` state is not a load-bearing revocation boundary for external ingress; retained WhatsApp routing/config can continue to admit provider-authenticated occurrences after disconnect

**Status:** VERIFIED CODE-LEVEL / CONNECTOR-LIFECYCLE + EXTERNAL-INGRESS FINDING

### Observed disconnect semantics

The generic connector endpoint delegates disconnect to `ConnectorRegistryService.disconnectConnector()`, which calls the concrete connector's `disconnect()` and emits `connector.disconnected`.

For WhatsApp, `WhatsAppConnector.disconnect()` only upserts:

```text
ConnectorStatus.status = disconnected
```

It does not clear `ConnectorStatus.intakeEnabled`, remove the business-level WhatsApp configuration, revoke provider routing metadata, or remove the stored `phoneNumberId` used by the shared webhook router.

### Observed ingress semantics

The shared WhatsApp webhook authenticates Meta payloads, extracts provider `phone_number_id`, and resolves a business by:

```text
Business.metaData.whatsapp.phoneNumberId == payload.phone_number_id
```

It then calls `WhatsAppService.receiveInbound(business.id, ...)`.

Neither the shared webhook route nor `receiveInbound()` requires the corresponding `ConnectorStatus.status` to be `connected` before contact resolution, message/intake event emission, KeyInbox persistence and WhatsApp conversation persistence proceed.

`WhatsAppService.saveConfig()` persists the WhatsApp configuration under `Business.metaData.whatsapp`; the connector disconnect path does not remove that configuration.

Therefore, after the product/control plane records WhatsApp as `disconnected`, a later valid Meta callback that still targets the retained `phoneNumberId` can remain routable into business processing.

### Additional lifecycle inconsistency

`WhatsAppConnector.healthCheck()` also treats the presence of a global `WHATSAPP_ACCESS_TOKEN` as sufficient for a reported `connected` health state even when the business-scoped stored ConnectorStatus is disconnected. This reinforces that connection status, credential availability and tenant-specific ingress authority are not represented by one load-bearing lifecycle contract.

### Evidence classification

This is code-level reachability. Runtime proof has not been executed; actual post-disconnect provider delivery depends on provider-side webhook/subscription state and deployment configuration. The architecture defect does not require proving that Meta will always deliver after disconnect: the independently reachable KeyFlowOS ingress boundary itself does not enforce the recorded revocation state.

### Why this is distinct from existing roots

- J14 / F127–F136 own generic external occurrence authenticity, tenant binding, durable acceptance, replay and acknowledgement semantics.
- F222 owns competing conversation occurrence processors.
- F226 owns the independently reachable execution-capable Phone Voice stream tenant-binding boundary.

F227 owns a different temporal/lifecycle rule: **an explicit connector disconnect/revocation transition does not necessarily revoke the authority of later authenticated provider occurrences to enter business processing.** Authentication and correct tenant routing can both be valid while connector lifecycle authority is no longer valid.

### Target law

```text
CONNECTOR CONNECTION GRANT
→ explicit tenant-scoped provider binding + credential/subscription state
→ ingress/effect authority ACTIVE

DISCONNECT / REVOKE
→ one durable revocation occurrence
→ atomically or monotonically revoke:
   - new ingress processing authority
   - outbound effect authority
   - polling/sync claims
   - callback/subscription routing where provider supports it
   - credentials/tokens according to connector policy
→ later callbacks may be durably observed/quarantined for audit
→ they may not silently re-enter normal business processing

RECONNECT
→ new explicit connection grant / binding generation
```

Connector status, credential presence, provider subscription state, routing identity and intake policy may be separate projections, but they must derive from one coherent lifecycle authority contract.

Affected kernels: K7 Temporal / Event / Workflow, K9 Integration & External Reality, K11 Recovery & Reliability, K1 Tenant Genesis & Identity.
Affected journeys: J13 Connector Lifecycle, J5 Conversation → Business Action, J14 Webhook / External Event Ingress.

Related contradiction: C177.

No production implementation is authorized by this supplement.
