# KEYFLOWOS Connector Fabric & Device Integration Master Plan

Status: CANONICAL ARCHITECTURE OVERLAY — design/intelligence only  
Programme effect: ZERO packet credit; does not release any execution hold  
Primary execution owner: existing 35-packet programme, especially ACTION / INGRESS / CONNECTOR / CONVO / VOICE / GROWTH / NETWORK / UX / OPS  
Canonical principle: **create intelligence, not authority**

## 0. Purpose

KEYFLOWOS must become the operating system through which a business can connect its real-world software, communications, devices, files, channels and AI systems without turning KEY into a collection of provider-specific hacks.

The user experience target is:

> My business is connected to my world. KEYFLOWOS sees what matters, understands it, and helps me act.

The architectural target is:

```text
External systems / devices / AI clients
            │
            ▼
     KEYFLOW Connector Fabric
            │
   ┌────────┼─────────┐
   │        │         │
Cloud/API  Device    MCP/AI
Adapters   Bridge    Gateway
   │        │         │
   └────────┼─────────┘
            ▼
Capability Registry + Event Mesh
            │
Identity / Consent / Authority / Policy
            │
            ▼
          KEY
   observe -> understand -> plan
   -> draft -> request authority
   -> execute -> verify -> log -> learn
```

This plan extends and converges the existing connector framework. It does **not** replace:
- `apps/server/src/core/connectors`;
- the current capability registry;
- the event registry;
- the canonical ACTION authority boundary;
- the 35-packet programme;
- the frozen 12-kernel / journey model.

## 1. Existing substrate to preserve

Current code already provides a useful base:

- `IConnector` with authentication, health, sync, webhook parsing and verification;
- Google, Gmail, Calendar, Drive, Forms, Contacts, WhatsApp, Meta, Stripe, PayPal, WiPay, QuickBooks, Xero, Mailchimp, Klaviyo, LinkedIn, TikTok, X/Twitter, Typeform, Jotform and other implementations;
- `ConnectorRegistryService`, `ConnectorCredentialsService`, `ConnectorHealthMonitorService`, sync scheduling, activity/audit logging and entity resolution;
- normalized `IngestionItemInput` for email, WhatsApp, SMS, Instagram, Messenger, Drive and manual ingress;
- encrypted connector credentials;
- webhook signature verification, idempotency and business-scoped ingestion;
- a generated capability registry and event registry;
- KEY tools, approvals, idempotency, sagas, BusinessEvent and autonomy infrastructure.

The required evolution is from **provider-oriented connector CRUD** to a **capability-oriented integration fabric**.

## 2. Architectural laws

### 2.1 KEY requests capabilities, not providers

KEY should reason in provider-neutral verbs such as:

- `email.search`
- `email.read`
- `email.draft`
- `email.send`
- `message.read`
- `message.reply`
- `calendar.event.create`
- `contact.resolve`
- `file.search`
- `file.read`
- `social.publish`
- `call.start`
- `call.transcript.read`
- `commerce.order.fulfill`
- `finance.invoice.create`
- `device.notification.read`
- `computer.app.launch`
- `computer.ui.inspect`

The provider router resolves the best installed provider.

### 2.2 Connection is not authority

OAuth or an API key only establishes technical connectivity.

Every write/action still passes:

```text
Identity -> Tenant -> Effective Authority -> Capability Contract
-> Connector Grant Generation -> Risk Policy -> Approval/Autonomy
-> Idempotent Effect -> Outcome Verification -> Audit
```

No connector may bypass ACTION-001 or later canonical authority ownership.

### 2.3 Prefer official semantic interfaces

Fallback order:

1. official provider API / SDK;
2. provider webhook / change stream;
3. MCP tool/resource interface;
4. native operating-system API;
5. browser extension/native messaging;
6. accessibility/UI automation;
7. visual/screen automation only when no semantic interface exists.

UI automation must never become the primary interface where a stable API exists.

### 2.4 Event-first, polling-last

Where providers support push/change notifications, use them.

The connector runtime must normalize external activity to durable, replay-safe occurrences before business logic consumes it.

### 2.5 One person/entity across channels

Provider identities are aliases, not separate business people.

A canonical identity graph must support evidence-weighted resolution across:
- phone numbers;
- emails;
- WhatsApp identities;
- Instagram/Facebook identities;
- Google/Microsoft identities;
- CRM IDs;
- commerce/payment customer IDs;
- device contacts.

Resolution must preserve ambiguity. KEY may suggest a merge; it must not silently merge weak matches.

### 2.6 Provider neutrality

A capability must be able to have multiple implementations:

```text
email.send
  -> Gmail
  -> Microsoft Outlook
  -> SMTP/custom provider

message.send
  -> WhatsApp Business
  -> Messenger
  -> Instagram Messaging
  -> SMS/Twilio
  -> Slack/Teams
```

Provider-specific functionality may be exposed as extensions, never as the only conceptual contract.

### 2.7 Manual parity

Every materially consequential KEY action requires a manual equivalent route unless the underlying platform itself has no manual equivalent.

## 3. Target components

### 3.1 Connector Registry v2

Evolve `ConnectorMeta` into a richer manifest:

```ts
interface ConnectorManifest {
  provider: string
  version: string
  categories: ConnectorCategory[]
  capabilities: CapabilityDescriptor[]
  auth: AuthDescriptor
  events: EventDescriptor[]
  syncModes: ('webhook'|'push'|'stream'|'delta'|'poll')[]
  tenancyModel: 'per_business'|'per_user'|'workspace'|'device'
  dataClasses: DataClass[]
  rateLimits?: RateLimitDescriptor[]
  regionLimits?: RegionConstraint[]
  sandboxSupport: boolean
  mcp?: McpDescriptor
  device?: DeviceDescriptor
}
```

### 3.2 Capability Registry

Each capability declares:
- canonical name and schema;
- read/write/external-effect classification;
- risk tier;
- reversibility;
- approval requirement;
- required scopes;
- consent class;
- idempotency support;
- effect-certainty semantics;
- manual equivalent route;
- supported providers;
- expected evidence/result contract.

### 3.3 Connector Router

Inputs:
- requested capability;
- business/user/device context;
- connected providers;
- grants/scopes;
- provider health;
- jurisdiction/region;
- cost/rate limits;
- user preference;
- reliability.

Outputs:
- selected provider adapter;
- why it was selected;
- denied/approval-required state where applicable;
- deterministic fallback order.

The router does not create authority.

### 3.4 Credential & Grant Vault

Separate:
- provider identity;
- OAuth access/refresh material;
- granted scopes;
- business/user owner;
- connector generation;
- expiry/rotation state;
- revocation;
- device binding where applicable.

A revoked/reconnected connector increments generation so stale callbacks, jobs or workers cannot continue using prior authority.

### 3.5 Event Mesh

External events must converge to a canonical envelope:

```text
provider
provider_event_id
connector_id
connector_generation
business_id
external_actor
occurred_at
received_at
event_type
resource_type
resource_id
payload_digest
raw_evidence_pointer
consent_context
trace_id
```

Ingress must be:
- signature verified where supported;
- idempotent;
- replay aware;
- tenant resolved before business handling;
- generation fenced;
- durable before downstream effects.

### 3.6 Identity Graph

Core nodes:
- Person
- Organization
- Device
- ProviderAccount
- ChannelIdentity
- ExternalObject

Edges contain:
- evidence;
- confidence;
- source;
- first/last observed;
- verified/unverified;
- superseded state.

Identity resolution must never use a single weak attribute as irreversible truth.

### 3.7 KEY Action Gateway

The gateway is the sole path from KEY planning to external effects.

It must enforce:
- effective authority;
- connector scope/grant;
- action risk;
- user consent;
- approval/autonomy;
- idempotency key;
- effect certainty;
- compensation/reconciliation strategy;
- provider response verification;
- audit/evidence emission.

### 3.8 MCP Gateway

KEYFLOWOS should expose a remote MCP server so approved AI clients can use KEYFLOWOS tools/data.

Initial clients:
- ChatGPT / Codex;
- Claude;
- other MCP-compatible clients.

MCP tools must expose user-goal capabilities rather than mirroring internal REST endpoints.

Example:
- `keyflow.contacts.search`
- `keyflow.calendar.availability`
- `keyflow.inbox.threads`
- `keyflow.invoice.draft`
- `keyflow.approvals.list`

Write tools remain governed by the same ACTION/approval path as native KEY calls.

KEY may also consume external MCP servers, but external MCP tools are treated as connector providers and receive no implicit trust.

### 3.9 Device Bridge

A local/mobile device is a connector family with stronger local security constraints.

Device Bridge capabilities may include:
- files and folders;
- clipboard;
- share target;
- camera/scanner;
- contacts;
- calendar;
- notifications where permitted;
- microphone/voice notes;
- call integration where permitted;
- app launch/deep links;
- local browser context;
- printer/scanner interfaces;
- local system health;
- controlled desktop automation.

Device capabilities are always explicitly scoped and user-revocable.

### 3.10 Browser Extension

Browser integration should provide:
- current page metadata and selected text;
- explicit share-to-KEY;
- structured form/page extraction;
- workflow assistance;
- secure handoff to the Desktop Agent;
- tab-level consent and host permissions.

The browser extension must communicate with the native desktop bridge using authenticated native messaging where available.

### 3.11 Connector SDK & Marketplace

The SDK must let first-party and later third-party connectors implement the same contract.

Minimum package:
- manifest schema;
- auth helpers;
- capability schemas;
- webhook/event helpers;
- idempotency utilities;
- encrypted credential adapter;
- test harness;
- sandbox fixtures;
- observability hooks;
- rate-limit/backoff contract;
- certification suite.

Marketplace publication requires connector certification, not just code submission.

## 4. Provider families

### 4.1 Google Workspace

Target family:
- Gmail;
- Calendar;
- Drive;
- Docs;
- Sheets;
- Slides;
- Forms;
- People/Contacts;
- Tasks;
- Meet where supported;
- Google Chat;
- Business Profile.

Preferred mechanisms:
- OAuth with least-privilege scopes;
- Gmail push notifications;
- Calendar/Drive watch/change notifications;
- delta/history sync and cursor persistence;
- provider-specific deep links.

### 4.2 Microsoft 365

Target family:
- Outlook Mail;
- Calendar;
- Contacts;
- OneDrive;
- SharePoint;
- Teams;
- To Do;
- Excel/Office files.

Use Microsoft Graph as the primary abstraction with change notifications where available.

### 4.3 Meta

Target family:
- WhatsApp Business;
- Facebook Pages;
- Messenger;
- Instagram professional accounts.

Normalize:
- conversations;
- messages;
- comments;
- leads;
- publishing;
- media;
- delivery/read states;
- business identities.

### 4.4 Communications / telephony

Targets:
- native device calling where permitted;
- Twilio;
- SIP/VoIP adapters;
- Zoom Phone or similar providers;
- SMS providers;
- voicemail/transcription.

Call recording/transcription must require jurisdiction-aware consent policy and explicit user/business configuration.

### 4.5 Collaboration

Targets:
- Slack;
- Microsoft Teams;
- Discord where business-appropriate;
- Telegram bots;
- Google Chat.

### 4.6 CRM/support

Targets:
- Salesforce;
- HubSpot;
- Pipedrive;
- Zoho;
- Zendesk;
- Intercom;
- Freshdesk.

Avoid making KEYFLOWOS subordinate to an external CRM. External CRM data maps into canonical KEYFLOWOS people/commercial objects with provenance.

### 4.7 Commerce/payments/accounting

Targets:
- Shopify;
- WooCommerce;
- Stripe;
- PayPal;
- Square;
- WiPay / PowerTranz and regional gateways;
- QuickBooks;
- Xero;
- Sage where viable.

Financial writes inherit finance/owner-approval policy.

### 4.8 Marketing/social

Targets:
- Meta Ads;
- Google Ads;
- Mailchimp;
- Klaviyo;
- LinkedIn;
- TikTok;
- YouTube;
- X where API access is viable.

### 4.9 Creative/content

Targets:
- Canva;
- Adobe;
- Figma;
- WordPress;
- Webflow;
- common CMS/DAM providers.

Canva is especially suitable for API + MCP + app-surface integration.

### 4.10 Development/operations

Targets:
- GitHub;
- GitLab;
- Vercel;
- Supabase;
- AWS;
- Azure;
- GCP;
- Cloudflare;
- Sentry;
- Datadog/Grafana-class observability.

These connectors power KEY's business-ops/development capabilities but remain governed by elevated authority policies.

## 5. Windows, macOS, Android and iOS

### 5.1 Windows Desktop Agent

Preferred capabilities:
- local file selection/watch;
- clipboard (explicit permission);
- share target/protocol handler;
- notifications;
- app launch/deep links;
- browser native-messaging host;
- printers/scanners;
- safe local commands;
- UI Automation fallback;
- optional PowerShell-backed system adapters with explicit command allowlists.

Never expose an unrestricted shell directly to KEY.

### 5.2 macOS Agent

Use:
- App Intents/Shortcuts where applicable;
- share services;
- files/bookmarks;
- notifications;
- browser bridge;
- Accessibility only when explicitly enabled and where required.

### 5.3 Android Companion

Use:
- share targets;
- Contacts Provider;
- notifications with explicit Notification Listener access;
- camera/files;
- calendar;
- deep links;
- calling/SMS only within Play policy and OS role restrictions;
- Accessibility only as an explicit high-risk fallback.

### 5.4 iPhone/iPad Companion

Use:
- App Intents;
- Siri/Shortcuts;
- Share Sheet;
- Contacts/Calendar/Files/Camera;
- notifications;
- CallKit / calling-app integration where eligible.

Do not design around unrestricted Messages access. User-mediated compose/share flows remain valid capabilities.

## 6. Permission model

A connector has two independent states:

### Connectivity
- DISCONNECTED
- CONNECTING
- CONNECTED
- DEGRADED
- EXPIRED
- REVOKED

### Action authority
- OBSERVE
- READ
- SUGGEST
- DRAFT
- EXECUTE_WITH_APPROVAL
- AUTONOMOUS_LOW_RISK
- AUTONOMOUS_SCOPED

Example:
A business may grant Gmail READ + DRAFT but require approval for SEND.

## 7. Data classes and consent

Every capability declares data classes, including:
- public;
- business internal;
- personal contact data;
- communications content;
- financial;
- authentication/security;
- precise location;
- health/sensitive;
- children/minors;
- call audio/transcript.

Data-class handling defines:
- collection scope;
- retention;
- encryption;
- export/delete behavior;
- model/AI use;
- logging/redaction;
- human approval;
- jurisdiction-specific policy.

## 8. Reliability and effect certainty

Every external write must resolve to one of:
- CONFIRMED_SUCCEEDED
- CONFIRMED_FAILED
- UNKNOWN_OUTCOME
- RECONCILIATION_REQUIRED

Unknown outcomes must never be blindly retried if duplication could create a second real-world effect.

Connector adapters declare:
- idempotency support;
- provider request ID;
- reconciliation query;
- compensation capability;
- retry classification.

## 9. Testing and certification standard

Every connector requires:

1. contract tests;
2. auth/scope tests;
3. wrong-tenant tests;
4. revoked-generation tests;
5. webhook signature tests;
6. replay/duplicate tests;
7. retry/backoff tests;
8. provider-timeout and unknown-outcome tests;
9. malformed payload tests;
10. rate-limit tests;
11. partial-permission tests;
12. sandbox/live-fixture tests where authorized;
13. negative controls proving the tests fail when the safety behavior is removed.

Device connectors additionally require:
- permission revocation;
- background/foreground lifecycle;
- offline/reconnect;
- local secret storage;
- compromised-device assumptions;
- capability denial when OS permission disappears.

## 10. KEY integration

KEY must never parse raw provider capability directly into ungoverned action.

KEY sees:
- canonical business objects;
- canonical events;
- available capabilities;
- current grants;
- approval requirements;
- provider health;
- uncertainty.

KEY's planner may choose among providers, but the Action Gateway verifies the final choice.

External AI systems using MCP are clients of KEYFLOWOS. They do not become KEY's authority source.

## 11. User experience

### Connect Hub

Show:
- Connected;
- Recommended;
- Needs attention;
- Available capabilities;
- granted permissions;
- last healthy event/sync;
- data being shared;
- KEY autonomy status;
- disconnect/revoke;
- test connection.

### Unified Inbox

Channels converge into one thread model while preserving provider source and reply constraints.

### Contact/Business Object Drawer

Display linked external identities and provenance without leaking secret identifiers.

### Approval UX

A user approves the business effect, not low-level API syntax.

Example:
"Send this follow-up to Sarah by WhatsApp" rather than "POST /messages".

## 12. Integration with the canonical 35-packet programme

This architecture adds **no new execution packet**.

Ownership:

- **ACTION-001** — provider-neutral capability -> control -> clearance boundary.
- **TIME-001** — durable occurrence identity for scheduled/device/provider work.
- **INGRESS-001** — webhook/event occurrence lifecycle, replay and signature handling.
- **CONNECTOR-001** — connector grants, generation fencing, credential/grant semantics, Connector Registry v2.
- **RECOVERY-001** — unknown outcome and operator reconciliation.
- **CONVO-001** — unified message/conversation occurrence model.
- **PLAYBOOK-001** — connector-aware reusable workflows.
- **COMMERCIAL/FINANCE/COMMERCE** — canonical commercial/financial effects behind external systems.
- **GROWTH-001** — social/ads/marketing provider use.
- **KNOWLEDGE-001/002** — external document/knowledge ingestion provenance and correction.
- **PUBLIC-001 / SPACE-001** — public/customer channel integration.
- **VOICE-001** — phone/voice/device calling and transcript semantics.
- **PRIVACY-001** — deletion/retention across external identities and derived data.
- **NETWORK-001** — external business/network/provider orchestration.
- **UX-001 / EXPERIENCE-001** — Connect Hub, device surfaces, browser/mobile UX.
- **INTEGRATED-001** — cross-provider and cross-device end-to-end proof.
- **OPS-001** — rate limits, provider outages, observability, token expiry, cost.
- **RELEASE-001** — authorized sandbox/canary evidence only.

## 13. Cross-cutting acceptance gates

A packet touching Connector Fabric must state:

- connector capabilities affected;
- provider(s);
- data classes;
- scopes/permissions;
- ingress events;
- external effects;
- idempotency/effect certainty;
- generation/revocation behavior;
- tenant resolution;
- approval/autonomy policy;
- retention/privacy impact;
- offline/provider-outage behavior;
- manual equivalent;
- observability;
- sandbox/live-provider proof status.

No provider adapter is "done" merely because OAuth succeeds.

## 14. Provider rollout priority

### Foundation tier
1. Google Workspace family
2. Microsoft 365 family
3. Meta family
4. ChatGPT/OpenAI MCP gateway
5. Claude/MCP compatibility
6. browser extension
7. Windows Desktop Agent
8. Android companion
9. iOS companion

### Business tier
10. Slack/Teams collaboration
11. Twilio/telephony
12. Shopify/WooCommerce
13. Stripe/PayPal/regional gateways
14. QuickBooks/Xero
15. HubSpot/Salesforce
16. Canva
17. Zendesk/Intercom
18. marketing/ad platforms

### Ecosystem tier
19. public Connector SDK
20. certified connector marketplace
21. partner-developed adapters
22. business-specific private connectors

Priority is determined by user value, canonical data fit, API stability, provider terms, regional availability, security cost and maintenance burden.

## 15. Architecture decisions locked by this plan

1. The existing core connector framework is evolved, not replaced.
2. Provider-neutral capabilities are first-class.
3. Connector connection never grants autonomous action by itself.
4. External events become durable occurrences before business logic.
5. Generation fencing is mandatory for reconnect/revoke.
6. Identity graph preserves ambiguity and provenance.
7. MCP is an ingress/egress integration surface, not an authority bypass.
8. Desktop/mobile agents are connectors subject to the same policy system.
9. UI/accessibility automation is a fallback.
10. No unrestricted shell or unrestricted device control is exposed to KEY.
11. The Connector Fabric is cross-cutting architecture mapped into existing packets, not a 36th packet.
12. ACTION-001 remains the authority boundary and must be admitted before downstream connector execution semantics can be trusted.

## 16. External standards/reference surfaces

Authoritative implementation references should be refreshed at packet characterization. Current architecture is informed by:

- OpenAI Plugins/MCP: https://developers.openai.com/plugins/concepts/mcp-server
- OpenAI tool design: https://developers.openai.com/plugins/plan/tools
- Google Drive push notifications: https://developers.google.com/workspace/drive/api/guides/push
- Microsoft Graph Outlook change notifications: https://learn.microsoft.com/graph/outlook-change-notifications-overview
- Microsoft Teams change notifications: https://learn.microsoft.com/graph/teams-changenotifications-chatmessage
- Twilio Voice webhooks: https://www.twilio.com/docs/usage/webhooks/voice-webhooks
- Chrome Native Messaging: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
- Android Contacts Provider: https://developer.android.com/identity/providers/contacts-provider
- Apple default calling app / CallKit: https://developer.apple.com/documentation/CallKit/Preparing-your-app-to-be-the-default-calling-app
- Canva REST APIs: https://www.canva.dev/docs/apps/rest-apis/
- Salesforce Pub/Sub / CDC: https://developer.salesforce.com/docs/platform/pub-sub-api/guide/intro.html

## 17. Final completion condition

Connector Fabric is not complete when many logos appear in Connect.

It is complete only when KEYFLOWOS can prove that an authorized business intent can safely traverse:

```text
person/device/provider event
-> authenticated connector
-> durable occurrence
-> identity resolution
-> canonical business context
-> KEY/manual decision
-> ACTION authority
-> provider-neutral capability
-> selected adapter
-> external effect
-> verified/reconciled outcome
-> timeline/audit/learning
```

across representative cloud, communication, browser and device providers without tenant leakage, duplicate effects, stale grants, hidden authority escalation or false success.
