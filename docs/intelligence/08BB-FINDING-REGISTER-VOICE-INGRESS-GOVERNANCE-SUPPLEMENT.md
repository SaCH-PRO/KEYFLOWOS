# KeyFlowOS Finding Register — Voice Ingress / Governance Supplement

Status: CANONICAL CONTINUATION OF the KeyFlowOS finding register after F225.

Implementation evidence baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`.
Production implementation remains **READ-ONLY / UNAUTHORIZED**.
Runtime proof has **NOT** been executed.

Canonical sequence continues after F225.

---

## F226 — execution-capable Phone Voice WebSocket accepts query-declared tenant identity without observed stream-level authentication / trusted tenant resolution

**Status:** VERIFIED CODE-LEVEL / EXTERNAL-INGRESS + GOVERNANCE FINDING

### Observed positive seam

`PhoneVoiceController` protects the initial public Twilio Voice HTTP webhook with Twilio signature verification and fails closed when `TWILIO_AUTH_TOKEN` is missing unless an explicit development escape hatch is enabled.

The signature check covers the externally visible request URL, including the `businessId` query string. The controller then emits TwiML containing a media-stream URL scoped to that business.

A dedicated test (`phone-voice-webhook-auth.spec.ts`) verifies this initial HTTP boundary and explicitly checks that an unverified caller cannot obtain a stream URL for an arbitrary business.

### Distinct downstream boundary

`PhoneVoiceService`, however, independently registers a raw WebSocket upgrade handler for:

```text
/api/voice/stream?businessId=<id>
```

The service reads `businessId` directly from the WebSocket request URL and establishes the call context from that value.

No equivalent Twilio signature verification, signed stream token, provider-account-to-business lookup, durable VoiceSession claim, or other stream-level tenant-authentication boundary was observed before the WebSocket is upgraded.

Once connected, the realtime model is given business-action tools including booking and helpdesk capabilities. On a model function call the service can invoke:

```text
FlowOrchestratorService.executeToolDirectly(businessId, toolName, args)
```

No `AiOversightService` / exact-action clearance call was observed in `PhoneVoiceService` itself.

Therefore the raw stream boundary is materially consequential: a URL-declared `businessId` becomes the tenant context for execution-capable realtime tool calls without observed equivalent authentication/tenant derivation at that transport boundary.

### Evidence classification

This is a **code-level reachability/security-boundary finding**. Runtime exploitability has **not** been reproduced in this programme. Network exposure, reverse-proxy restrictions, and provider connection behavior remain runtime-proof questions.

### Why this is distinct from existing roots

- F043 / F054 own generic reachability of direct Flow execution outside a universal governance choke point.
- F127–F144 / J14 own generic external occurrence, tenant binding, replay, acknowledgement and processing-ownership concerns.
- F222 owns competing conversation occurrence processors.

F226 is the stable J22 specialization where the **consequential realtime transport itself** accepts tenant identity from its URL without observed stream-level authentication or trusted tenant resolution before gaining access to execution-capable tools.

### Target law

```text
AUTHENTICATED VOICE CALL / STREAM OCCURRENCE
→ provider identity verified at every independently reachable transport boundary
→ BusinessId derived from trusted phone/account/connection mapping
→ durable VoiceSession / ConversationOccurrence identity
→ bounded voice-session principal + policy context
→ exact capability governance / clearance
→ execution claim
→ business effect
→ evidence / outcome
```

A query `businessId` may be a routing hint, but must not itself be the authority source for an execution-capable voice session.

Affected kernels: K1 Tenant Genesis & Identity, K3 KEY Authority & Governance, K5 Capability Fabric, K9 Integration & External Reality, K11 Recovery & Reliability.
Affected journeys: J5 Conversation → Business Action, J14 Webhook / External Event Ingress, J22 KEY Voice, J2 KEY Request → Governed Action, J15 Approval / Governance Lifecycle.

Related contradiction: C176.

No production implementation is authorized by this supplement.
