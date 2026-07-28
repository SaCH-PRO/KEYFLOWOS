# Connectors — Functional Inventory & Classification (Certification Phase 1)

> Evidence-based inventory of the 22 registered connectors, grouped by implementation
> family, as the foundation for Functional Completeness certification. "Verified" =
> confirmed by reading source; "to-verify" = requires per-connector sync-body review
> in Phase 3 (a fast automated sync-fidelity scan was unreliable and is not relied on).

Registered set (from `connector-initializer.service.ts`, order preserved): gmail,
calendar, drive, forms, contacts, outlookContacts, businessProfile, whatsapp, meta,
paypal, wipay, stripe, quickbooks, xero, mailchimp, klaviyo, linkedin, tiktok,
twitter, typeform, jotform, webhookForm. **22 total.**

Contract (`IConnector`): `authenticate`, `healthCheck`, `getStatus`, `isConnected`,
`sync`, `disconnect`, optional `testConnection`, `smokeTest`, `getAuthUrl`.

## Headline finding — "sync" is not uniform
Most connector `sync()` methods are **status/count refreshes** (count local rows +
upsert `ConnectorStatus`), NOT provider pulls. Real ingestion happens elsewhere:
- **OAuth-callback backfill** — `google-suite.service.handleCallback` writes tokens and
  backfills on connect.
- **Webhooks** — form connectors (typeform/jotform/webhook_form) ingest via
  `/webhooks/forms/...`; WhatsApp/Meta via their webhooks.

Verified exceptions: **`google-calendar.sync` does real bidirectional provider I/O**
(`fetch` events + insert + delete). **`google-contacts.sync` is count-only.**
**`SocialPlatformConnector.sync` is count-only (placeholder).**

→ The Phase 3 "Sync" contract must be defined **per ingestion model** (pull-sync,
callback-ingest, webhook-ingest), not assumed to be a provider pull for all.

## Families

### A. Google OAuth (6) — credential: `Business.*AccessToken/*RefreshToken` (plaintext columns)
`gmail, google-calendar, google-drive, google-forms, google-contacts, google-business-profile`
- Auth: OAuth via `google-suite.service` (state HMAC-verified); tokens on `Business`.
- Methods: full `sync/disconnect/healthCheck/getStatus/isConnected` present.
- Sync fidelity: **calendar = real (verified)**; **contacts = count-only (verified)**;
  gmail/drive/forms/business-profile = **to-verify** (ingestion likely callback/`*-ingestion.service`).
- **Reuse candidate for Phase 5** (shared auth/credential/status infra).
- ⚠ Uses the plaintext `Business` token columns (see Business-token encryption gate).

### B. Microsoft OAuth (1)
`outlook-contacts` — BusinessToken (`msContacts*`), full methods. Sync fidelity to-verify.

### C. Social (4) — shared `SocialPlatformConnector`; credential: `SocialConnection.token`
`meta-social, linkedin, twitter, tiktok`
- Thin subclasses overriding `pingProvider` only; base provides sync/disconnect/health/smokeTest.
- **`sync` = count-only placeholder (verified)** → **not functional for sync**.
- `disconnect` (deletes `SocialConnection` + status), `smokeTest`/`pingProvider` (real provider ping) = real.
- Classification: **PARTIALLY CERTIFIED** at best (connect/disconnect/health real; **sync is STUB**).

### D. Webhook-form (3) — shared `FormPlatformConnector`; ingest via webhook
`typeform, jotform, webhook-form`
- **No `sync()`** (by design — webhook-driven). Per-business `webhookSecret` (verified tenant-safe, Module 5).
- Classification: **PARTIALLY CERTIFIED** (webhook ingest + connect/disconnect; no pull-sync by design).

### E. Commerce / Accounting / Email-marketing — credential: `ConnectorCredentialsService` (encrypted)
`stripe, paypal, wipay, quickbooks, xero, mailchimp, klaviyo`
- Substantial implementations (276–491 loc), full method surface, encrypted creds (good).
- Stub-marker hits (TODO/placeholder): quickbooks 3, xero 2, mailchimp 2, klaviyo 2, paypal 1, wipay 1 — **to-verify** whether any core op is stubbed.
- Sync fidelity: **to-verify** per connector.

### F. Messaging (1)
`whatsapp` — CredService (encrypted config), full methods, webhook ingest + idempotent dedup
(verified Module D). Sync fidelity to-verify.

## First-pass certification tiers (honest; finalized in Phases 3–5)
| Tier | Connectors |
|---|---|
| Candidate CERTIFIED (verify sync) | Google family (esp. calendar), whatsapp, stripe |
| PARTIALLY CERTIFIED (sync stub / webhook-only) | social ×4 (sync stub), form ×3 (no pull-sync by design) |
| To-verify (possible stub in core op) | quickbooks, xero, mailchimp, klaviyo, paypal, wipay, outlook, gmail/drive/forms/business-profile |
| STUB | — (none confirmed yet; social `sync` is the closest) |
| DEAD | — (KEY external-connector subsystem already removed) |
| BLOCKED | — |

## Flagged per Phase 1 rules
- **Silent-success sync:** `SocialPlatformConnector.sync` returns `success:true` with a
  local-post count and performs **no provider work**. Reachable via all 4 social connectors
  and the nightly scheduler. **Do not classify social connectors as functional for sync.**
- **Alternate credential path:** Google/Microsoft connectors read tokens from `Business`
  columns, NOT the central `ConnectorCredentialsService` — two credential systems coexist.
- No connector currently throws `NotImplemented`; the risk is **silent success**, not explicit stubs.

## Next
- Phase 2: build one shared provider-mock harness (auth/pagination/cursor/rate-limit/timeout/
  refresh/revoked/duplicate/tombstone/5xx/4xx) mocking only the provider boundary.
- Phase 5: certify the Google OAuth family first, verifying each `sync` body against the
  correct ingestion model, starting with `google-calendar` (confirmed real sync).
