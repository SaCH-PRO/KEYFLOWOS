# KeyFlowOS Contradiction Register — Voice Ingress / Governance Supplement

Status: CANONICAL CONTINUATION OF the KeyFlowOS contradiction register after C175.

Implementation evidence baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`.
Production implementation remains **READ-ONLY / UNAUTHORIZED**.
Runtime proof has **NOT** been executed.

Canonical sequence continues after C175.

---

## C176 — initial voice webhook is authenticated, but the independently reachable execution-capable WebSocket trusts URL-declared tenant identity

**Observed implementation claims**

1. The Twilio HTTP voice webhook validates provider signature before returning TwiML.
2. The TwiML contains a WebSocket media-stream URL carrying `businessId`.
3. `PhoneVoiceService` independently upgrades `/api/voice/stream?businessId=<id>` and builds call context from that query value.
4. No equivalent stream-level signature/token/provider-account tenant derivation was observed before upgrade.
5. The resulting realtime session can invoke direct Flow business tools.

**Contradiction**

```text
HTTP ingress semantics:
provider authenticity + signed request URL
→ trusted tenant-scoped stream URL

WebSocket semantics:
query businessId
→ tenant context
→ execution-capable realtime tools
```

The consequential downstream transport is therefore weaker than the authenticated ingress that introduced it.

Target:

```text
independently reachable consequential transport
→ independently verifiable session occurrence
→ trusted provider/account/phone mapping to BusinessId
→ bounded session principal/policy
→ governed exact capability execution
```

The signed HTTP request may bootstrap a stream credential/session, but the downstream stream must not inherit authority merely from a replayable or caller-declared tenant query parameter.

Related finding: F226.
Affected journeys: J5, J14, J22, J2, J15.
Affected kernels: K1, K3, K5, K9, K11.

No production implementation is authorized by this supplement.
