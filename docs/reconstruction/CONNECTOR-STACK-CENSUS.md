# Connector Stack Census (`RR-CONNECTOR-STACK-CENSUS`)

- **Decisions:** D-261, D-262, D-141, D-138
- **Baseline:** post-M79 `main` (`2db5e0879`, 2026-11-27)
- **Enforcement:** `apps/server/src/core/connectors/connector-stack-census.spec.ts`
- **Status:** Read-only first slice. No behaviour or schema change.

## Two Coexisting Connector Substrates

1. **Core Connector Registry (`core-registry`)**: `ConnectorRegistryService` (`apps/server/src/core/connectors/connector-registry.service.ts`), `/connectors` routes (`connector.controller.ts`), `ConnectorStatus` (`connector_statuses`), and implementations under `apps/server/src/core/connectors/implementations/`.
2. **KEY Connector Stack (`key-connector`)**: `KeyConnectorService` and `ProviderRegistryService` (`apps/server/src/modules/key-connector/`), `/key-connector` routes (`key-connector.controller.ts`), and KEY Cortex organ adapter (`key-cortex/organs/key-connector-adapter.service.ts`).
3. **Direct `ConnectorStatus` Accessors (`direct-connector-status`)**: Implementations and domain services reading/writing `prisma.client.connectorStatus` (or `connector_statuses`) directly outside `ConnectorRegistryService`.

Per `packages/shared/src/v1-modules.ts` (`NAV-B-HIDE`), payment gateways (`stripe`, `paypal`, `wipay`) and `gmail` support active v1 journeys (D/E/F/G/K); other external connectors (`quickbooks`, `xero`, `mailchimp`, `klaviyo`, `google_*`, `outlook_contacts`, `meta_social`, `shopify`, form platforms) are hidden in v1 unless a business already has legacy data.

## Connector Stack Registry

Every non-test file in `apps/server/src` that imports/references `ConnectorRegistryService`, `KeyConnectorService`, or `ProviderRegistryService`, or reads/writes `connectorStatus` (`connector_statuses`) MUST appear below. Adding an unlisted file or leaving a retired file fails CI.

| File | Stack | V1 Journey | Credential Read |
| --- | --- | --- | --- |
| `apps/server/src/core/connectors/connector-credentials.service.ts` | direct-connector-status | Shared credential store (Journeys D/E/F/G/K & hidden connectors) | Encrypted connector credentials in `ConnectorStatus.metadata`; env `CONNECTOR_CREDENTIALS_KEY`, `CREDENTIALS_ENCRYPTION_KEY`, `JWT_SECRET` |
| `apps/server/src/core/connectors/connector-exports.ts` | direct-connector-status | Export-receiver binding guard (hidden in v1 connectors & Gmail/CRM exports) | Export binder metadata on `ConnectorStatus` (no raw secret read) |
| `apps/server/src/core/connectors/connector-health-monitor.service.ts` | core-registry | Background health monitor for registered connectors (D/E/F/G & hidden connectors) | none (delegates health checks to registered connectors) |
| `apps/server/src/core/connectors/connector-initializer.service.ts` | core-registry | Boot-time connector registration (all core connectors) | none (registers connector instances only) |
| `apps/server/src/core/connectors/connector-metadata.ts` | direct-connector-status | Shared connector metadata sanitizer (all core connectors) | Redacts/strips encrypted credential fields from `ConnectorStatus.metadata` |
| `apps/server/src/core/connectors/connector-registry.service.ts` | core-registry | Core registry backing `/connectors` (Journeys D/E/F/G/K & hidden connectors) | Delegates credential load/health to registered connectors & `ConnectorStatus` |
| `apps/server/src/core/connectors/connector-sync-scheduler.service.ts` | core-registry | Scheduled connector sync runner (hidden in v1 connectors & Gmail) | none (delegates sync execution to registered connectors) |
| `apps/server/src/core/connectors/connector.controller.ts` | core-registry | `/connectors` REST API (payment/Gmail setup in Settings + hidden in v1 connectors) | Reads/writes encrypted connector credentials via `ConnectorCredentialsService` (settings admin) |
| `apps/server/src/core/connectors/connector.module.ts` | core-registry | NestJS DI module wiring `ConnectorRegistryService` and implementations | none (DI wiring only) |
| `apps/server/src/core/connectors/form-webhook.controller.ts` | core-registry | Form webhook ingress (hidden in v1 per `NAV-B-HIDE`) | Form webhook signing secrets via `ConnectorCredentialsService` |
| `apps/server/src/core/connectors/google-suite.service.ts` | core-registry | Google Suite OAuth connect/status (Gmail in Journeys D/E; Calendar/Drive/Contacts/Forms hidden in v1) | Google OAuth tokens (`Business` columns) & env `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_STATE_SECRET` |
| `apps/server/src/core/connectors/implementations/form-platform.base.ts` | direct-connector-status | Base class for third-party form connectors (hidden in v1 per `NAV-B-HIDE`) | Encrypted API keys & webhook secrets via `ConnectorCredentialsService` |
| `apps/server/src/core/connectors/implementations/gmail-ingestion.service.ts` | direct-connector-status | Gmail inbound message ingestion (hidden in v1 unless legacy connected) | Gmail OAuth `accessToken`/`refreshToken` via `Business` / `ConnectorStatus` |
| `apps/server/src/core/connectors/implementations/gmail.connector.ts` | direct-connector-status | Gmail connector status & dispatch (Journeys D/E quote & invoice email) | Gmail OAuth `accessToken`/`refreshToken` on `Business` |
| `apps/server/src/core/connectors/implementations/google-business-profile.connector.ts` | direct-connector-status | Google Business Profile connector (hidden in v1 per `NAV-B-HIDE`) | Google Business Profile OAuth tokens on `Business` |
| `apps/server/src/core/connectors/implementations/google-calendar.connector.ts` | direct-connector-status | Google Calendar connector (hidden in v1 per `NAV-B-HIDE`) | Google Calendar OAuth tokens on `Business` |
| `apps/server/src/core/connectors/implementations/google-contacts.connector.ts` | direct-connector-status | Google Contacts connector (hidden in v1 per `NAV-B-HIDE`) | Google Contacts OAuth tokens on `Business` |
| `apps/server/src/core/connectors/implementations/google-drive.connector.ts` | direct-connector-status | Google Drive connector (hidden in v1 per `NAV-B-HIDE`) | Google Drive OAuth tokens on `Business` |
| `apps/server/src/core/connectors/implementations/google-forms-ingestion.service.ts` | direct-connector-status | Google Forms response ingestion (hidden in v1 per `NAV-B-HIDE`) | Google Forms OAuth tokens on `Business` |
| `apps/server/src/core/connectors/implementations/google-forms.connector.ts` | direct-connector-status | Google Forms connector (hidden in v1 per `NAV-B-HIDE`) | Google Forms OAuth tokens on `Business` |
| `apps/server/src/core/connectors/implementations/klaviyo.connector.ts` | direct-connector-status | Klaviyo marketing connector (hidden in v1 per `NAV-B-HIDE`) | Klaviyo API key via `ConnectorCredentialsService` / env `KLAVIYO_API_KEY` |
| `apps/server/src/core/connectors/implementations/mailchimp.connector.ts` | direct-connector-status | Mailchimp marketing connector (hidden in v1 per `NAV-B-HIDE`) | Mailchimp API key via `ConnectorCredentialsService` / env `MAILCHIMP_API_KEY` |
| `apps/server/src/core/connectors/implementations/meta-social.connector.ts` | direct-connector-status | Meta Social connector (hidden in v1 per `NAV-B-HIDE`) | Social connection tokens via `SocialConnection` / `ConnectorStatus` |
| `apps/server/src/core/connectors/implementations/outlook-contacts.connector.ts` | direct-connector-status | Outlook Contacts connector (hidden in v1 per `NAV-B-HIDE`) | Microsoft OAuth tokens via `MicrosoftOAuthService` |
| `apps/server/src/core/connectors/implementations/paypal.connector.ts` | direct-connector-status | PayPal payment gateway connector (Journeys D/E/F/G payments) | PayPal client credentials via `ConnectorCredentialsService` / env `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` |
| `apps/server/src/core/connectors/implementations/quickbooks.connector.ts` | direct-connector-status | QuickBooks accounting connector (hidden in v1 per `NAV-B-HIDE`) | QuickBooks OAuth tokens via `ConnectorCredentialsService` / env `QUICKBOOKS_TEST_TOKEN` |
| `apps/server/src/core/connectors/implementations/social-platform.base.ts` | direct-connector-status | Base class for social platform connectors (hidden in v1 per `NAV-B-HIDE`) | Social platform connection status (no direct secret read in base) |
| `apps/server/src/core/connectors/implementations/stripe.connector.ts` | direct-connector-status | Stripe payment gateway connector (Journeys D/E/F/G payments) | Stripe secret key via `Business` / env `STRIPE_SECRET_KEY` |
| `apps/server/src/core/connectors/implementations/whatsapp.connector.ts` | direct-connector-status | WhatsApp messaging connector (hidden in v1 unless legacy configured) | WhatsApp access token & phone number ID via `ConnectorCredentialsService` / `Business.metaData` / env `WHATSAPP_ACCESS_TOKEN` |
| `apps/server/src/core/connectors/implementations/wipay.connector.ts` | direct-connector-status | WiPay payment gateway connector (Journeys D/E/F/G payments) | WiPay account & API key via `ConnectorCredentialsService` |
| `apps/server/src/core/connectors/implementations/xero.connector.ts` | direct-connector-status | Xero accounting connector (hidden in v1 per `NAV-B-HIDE`) | Xero OAuth tokens via `ConnectorCredentialsService` / env `XERO_TEST_TOKEN` |
| `apps/server/src/modules/ai/connector-intelligence.service.ts` | core-registry | KEY connector health/status context (Journey K) | Connector status & OAuth expiry metadata (no raw secrets returned) |
| `apps/server/src/modules/commerce/gmail.service.ts` | direct-connector-status | Commerce quote/invoice email delivery (Journeys D/E) | Encrypted Gmail OAuth tokens on `Business`; env `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_STATE_SECRET` |
| `apps/server/src/modules/connect/connector-form-mapping.service.ts` | direct-connector-status | External form field mapping (hidden in v1 per `NAV-B-HIDE`) | Encrypted connector credentials via `ConnectorCredentialsService` |
| `apps/server/src/modules/connect/contact-sync.service.ts` | direct-connector-status | Contact sync orchestrator (hidden in v1 per `NAV-B-HIDE`) | Provider OAuth tokens via Google/Microsoft sync services |
| `apps/server/src/modules/connect/google-business-profile.service.ts` | direct-connector-status | Google Business Profile sync/posts (hidden in v1 per `NAV-B-HIDE`) | Google Business Profile OAuth `accessToken`/`refreshToken` on `Business` |
| `apps/server/src/modules/connect/google-contacts-sync.service.ts` | direct-connector-status | Google Contacts two-way sync (hidden in v1 per `NAV-B-HIDE`) | Google Contacts OAuth `accessToken`/`refreshToken` on `Business` |
| `apps/server/src/modules/connect/microsoft-oauth.service.ts` | direct-connector-status | Microsoft OAuth consent & token storage (hidden in v1 per `NAV-B-HIDE`) | Encrypted Microsoft OAuth tokens via `ConnectorCredentialsService`; env `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_STATE_SECRET` |
| `apps/server/src/modules/connect/outlook-contacts-sync.service.ts` | direct-connector-status | Outlook Contacts sync (hidden in v1 per `NAV-B-HIDE`) | Microsoft OAuth tokens via `MicrosoftOAuthService` |
| `apps/server/src/modules/ingestion/ingestion-orchestrator.service.ts` | direct-connector-status | Inbound connector ingestion coordinator (hidden in v1 per `NAV-B-HIDE`) | none (reads `ConnectorStatus` active state & delegates to ingestion services) |
| `apps/server/src/modules/key-connector/ai-gateway/ai-gateway.service.ts` | key-connector | KEY Connector AI gateway facade (Journey K / KEY connector organ) | Encrypted `KeyConnector` credentials via `ProviderRegistryService` |
| `apps/server/src/modules/key-connector/health/health-check.service.ts` | key-connector | KEY Connector provider health probe (Journey K / `/key-connector`) | Decrypted `KeyConnector` API keys & OAuth tokens via `ProviderRegistryService` |
| `apps/server/src/modules/key-connector/key-connector.controller.ts` | key-connector | `/key-connector` REST API (settings admin; Journey K connector management) | Encrypted credentials via `KeyConnectorService` (redacted in read views) |
| `apps/server/src/modules/key-connector/key-connector.module.ts` | key-connector | NestJS DI module wiring `KeyConnectorService` and `ProviderRegistryService` | none (DI wiring only) |
| `apps/server/src/modules/key-connector/key-connector.service.ts` | key-connector | Core KEY Connector CRUD & lifecycle service (`/key-connector`, Journey K) | Delegates encrypted provider credential storage/validation to `ProviderRegistryService` & encryption helpers |
| `apps/server/src/modules/key-connector/providers/provider-registry.service.ts` | key-connector | KEY Connector provider catalog & credential validator (Journey K) | Provider API keys & OAuth credentials during connect/health validation |
| `apps/server/src/modules/key-cortex/organs/key-connector-adapter.service.ts` | key-connector | KEY Cortex `key_connector` organ adapter (Journey K) | Dispatches connector operations through `KeyConnectorService` (credentials stay server-side) |
| `apps/server/src/modules/shopify/shopify.controller.ts` | direct-connector-status | Shopify store sync routes (hidden in v1 per `NAV-B-HIDE`) | Encrypted Shopify access token via `ShopifyService` / `ConnectorCredentialsService` |
| `apps/server/src/modules/shopify/shopify.service.ts` | direct-connector-status | Shopify store sync & webhook handling (hidden in v1 per `NAV-B-HIDE`) | Encrypted Shopify OAuth access token via `ConnectorCredentialsService` |
| `apps/server/src/modules/whatsapp/whatsapp.service.ts` | direct-connector-status | WhatsApp messaging service (hidden in v1 unless legacy configured) | Encrypted WhatsApp access token in `Business.metaData` / `ConnectorCredentialsService`; env `WHATSAPP_BUSINESS_ACCOUNT_ID` |

## Planned Later Slices (Not in This Packet)

1. Unify on one connected-account state model (`CONFIGURED` .. `VERIFIED_CONNECTED` .. `REVOKED`).
2. Move KEY's `key_connector` organ onto the unified substrate and retire the redundant stack.
