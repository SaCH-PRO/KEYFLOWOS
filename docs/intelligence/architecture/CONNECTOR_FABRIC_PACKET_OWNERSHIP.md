# KEYFLOWOS Connector Fabric — Packet Ownership & Acceptance Map

Status: architecture overlay
Programme packets added: 0
Programme packet count remains: 35
Authority effect: none
Production effect: none

## Purpose

This file maps Connector Fabric obligations into the existing 35-packet execution programme so the architecture is actually consumed rather than becoming parallel documentation.

## Ownership matrix

| Packet | Connector Fabric ownership |
|---|---|
| KF-EXEC-ACTION-001 | Canonical provider-neutral capability → control → clearance boundary. Connector connection alone grants no action authority. |
| KF-EXEC-TIME-001 | Durable occurrence identity for scheduled/provider/device work and retry-safe temporal execution. |
| KF-EXEC-INGRESS-001 | Webhook/push/delta/event ingress, signature/authentication, replay/idempotency, tenant resolution and durable occurrence creation. |
| KF-EXEC-CONNECTOR-001 | Connector Registry v2, manifests, credential/grant semantics, generation fencing, reconnect/revoke, health/sync, provider router substrate, connector SDK contract. |
| KF-EXEC-TEMPORAL-002 | Cancellation/supersession across scheduled connector work and long-running provider tasks. |
| KF-EXEC-RECOVERY-001 | UNKNOWN_OUTCOME reconciliation, provider retries, compensations and operator recovery. |
| KF-EXEC-CONVO-001 | Unified conversation/message occurrence model across WhatsApp, email, social, Slack/Teams, SMS and similar channels. |
| KF-EXEC-PLAYBOOK-001 | Reusable connector-aware workflows and marketplace templates that bind to capabilities rather than providers. |
| KF-EXEC-COMMERCIAL-001 | CRM/provider synchronization into canonical commercial truth. |
| KF-EXEC-BOOKING-001 | Calendar/booking provider projection and external booking effects. |
| KF-EXEC-FINANCE-001 | Accounting/payment connector truth, reconciliation and financial write authority. |
| KF-EXEC-DELIVERYBILL-001 | External document/signature/billing effects and evidence lineage. |
| KF-EXEC-COMMERCE-001 | Shopify/WooCommerce/order/inventory/fulfillment provider effects. |
| KF-EXEC-ENTITLE-001 | Provider metering/cost/entitlement accounting for external integrations and AI providers. |
| KF-EXEC-GROWTH-001 | Social, ads, marketing automation, Canva/creative integrations, campaign analytics. |
| KF-EXEC-KNOWLEDGE-001 | Drive/OneDrive/SharePoint/Docs/knowledge ingestion with provenance. |
| KF-EXEC-KNOWLEDGE-002 | Correction, withdrawal and retraction propagation across externally ingested knowledge. |
| KF-EXEC-COMMAND-001 | Connector failures/opportunities surfaced as command items and priorities. |
| KF-EXEC-PUBLIC-001 | Customer/public channel boundaries, embedded widgets, external forms and public provider handoffs. |
| KF-EXEC-SPACE-001 | External registration/ticketing/community integration where applicable. |
| KF-EXEC-VOICE-001 | Native/device/cloud calling, voicemail, transcript, recording-consent and voice provider semantics. |
| KF-EXEC-PRIVACY-001 | Connector data deletion, retention, revocation and derived-state removal. |
| KF-EXEC-NETWORK-001 | Cross-business/provider/network orchestration without tenant or authority collapse. |
| KF-EXEC-UX-001 | Connect Hub, provider health, permission UX, browser/mobile/desktop integration surfaces. |
| KF-EXEC-EXPERIENCE-001 | Device/browser experiences, onboarding, Studio/Cockpit integration and seamless provider selection. |
| KF-EXEC-WITHDRAW-001 | Retire duplicate/legacy connector writers after replacement proof. |
| KF-EXEC-WITHDRAW-002 | Retire compatibility connector readers after consumer proof. |
| KF-EXEC-MIGRATE-001 | External identity/object-map migration and ambiguous historical mapping closure. |
| KF-EXEC-INTEGRATED-001 | Cross-provider, cross-device end-to-end Connector Fabric acceptance. |
| KF-EXEC-OPS-001 | Provider outage/rate-limit/token-expiry/cost/observability/operability qualification. |
| KF-EXEC-RELEASE-001 | Controlled authorized sandbox/canary integration evidence; no implicit production/provider release. |

## Characterization obligations

Any packet touching an external system, device, browser, AI provider, communication channel or connector must explicitly record:

1. provider family;
2. canonical capability names;
3. read/write/external-effect classification;
4. data classes;
5. OAuth/API/device permissions;
6. connector generation/revocation semantics;
7. ingress/event semantics;
8. tenant resolution;
9. identity-resolution impact;
10. approval/autonomy requirement;
11. idempotency/effect-certainty semantics;
12. recovery/reconciliation strategy;
13. retention/privacy requirements;
14. provider outage/rate-limit behavior;
15. manual equivalent;
16. sandbox/live-provider proof status;
17. observability/audit evidence;
18. negative controls.

## Cross-packet invariants

### Authority invariant
No provider token, OAuth grant, API key, device permission, browser permission or MCP connection is itself authority to create a business effect.

### Provider neutrality invariant
KEY and playbooks request canonical capabilities. Provider adapters satisfy them.

### Revocation invariant
Disconnect/revoke/reconnect invalidates stale generations and workers.

### Ingress invariant
External signals are authenticated, normalized and durably recorded before business effects.

### Effect-certainty invariant
Unknown external outcomes are reconciled, not blindly replayed.

### Identity invariant
Weak cross-channel matches remain ambiguous until evidence justifies resolution.

### Privacy invariant
Connector data inherits data-class retention, deletion and consent policy.

### Device invariant
Loss of OS permission immediately removes the affected capability from KEY's available-capability view.

### MCP invariant
MCP clients/providers are integration surfaces, never an authority bypass.

## Wave gates

### Wave A
ACTION-001 must establish the capability/control/clearance semantics required by every connector write.

### Wave B
INGRESS + CONNECTOR + RECOVERY + CONVO must prove a provider-shaped slice with:
- reconnect/revoke;
- stale callback fencing;
- duplicate ingress;
- provider timeout;
- UNKNOWN_OUTCOME;
- conversation identity;
- wrong tenant.

### Wave C
At least one commerce/payment/accounting provider family must prove canonical truth propagation without allowing the external provider to become the source of tenant authority.

### Wave D
Google/Microsoft/Meta/device/voice/browser surfaces must project through the same capability and identity model. UX cannot expose one-off provider semantics as the product architecture.

### Wave E
Integrated acceptance must cover representative:
- cloud productivity connector;
- communications connector;
- commerce/finance connector;
- browser/device connector;
- MCP/AI client/provider path.

## Recommended representative qualification set

Minimum high-value qualification set for whole-app acceptance:

- Google Workspace (Gmail + Calendar + Drive)
- Microsoft 365 (Outlook/Graph)
- Meta WhatsApp Business
- Twilio or equivalent telephony/SMS
- Shopify or equivalent commerce
- QuickBooks or Xero
- Browser extension + native desktop bridge
- Android companion
- iOS companion
- KEYFLOWOS MCP server consumed by an approved external AI client

This is a representative certification set, not a limit on supported providers.
