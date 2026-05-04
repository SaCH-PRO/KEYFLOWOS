# Off-Replit Migration Checklist

Living record of every URL, URI, env var, and external configuration that must
change when KEYFLOWOS is moved off Replit (e.g. to a custom domain or another
host). Update this file every time a new host-coupled setting is introduced.

> Replace `<PROD_DOMAIN>` below with your real production domain
> (e.g. `app.keyflowos.com`). Replace `<API_DOMAIN>` only if the API is served
> from a separate host; otherwise it is the same as `<PROD_DOMAIN>` and the API
> is reached via the `/__api/*` proxy.

---

## 1. Replit-issued URLs currently in use

| Env var | Current (Replit) value | New value (off-Replit) |
|---|---|---|
| `GOOGLE_SUITE_REDIRECT_URI` | `https://d9c92da4-0dde-44b6-a1ad-551bf4dfbe2c-00-39zpddgeqea4v.worf.replit.dev/__api/connect/google-suite/callback` | `https://<PROD_DOMAIN>/__api/connect/google-suite/callback` |

(Add a row here every time we set another `*_REDIRECT_URI` /
`*_WEBHOOK_URL` to a Replit dev domain.)

---

## 2. Core "where does the app live" env vars

Set these once for the production environment. Most other URLs derive from them.

| Env var | Purpose | Production value |
|---|---|---|
| `APP_URL` | Canonical web origin | `https://<PROD_DOMAIN>` |
| `PUBLIC_BASE_URL` | Umbrella base for both web + API | `https://<PROD_DOMAIN>` |
| `OAUTH_REDIRECT_BASE` | Base used to derive OAuth redirect URIs when not explicitly set | `https://<PROD_DOMAIN>` |
| `NEXT_PUBLIC_SITE_URL` | Public site URL exposed to browser | `https://<PROD_DOMAIN>` |
| `NEXT_PUBLIC_API_BASE_URL` | API base from the browser. Keep as `/__api` so requests stay same-origin via the Next proxy | `/__api` |
| `NEXT_PUBLIC_APP_URL` | Used in some emails / outbound links | `https://<PROD_DOMAIN>` |
| `SITE_URL` | Server-side absolute link base for emails | `https://<PROD_DOMAIN>` |
| `CORS_ALLOWED_ORIGINS` | Comma-separated list of allowed browser origins | `https://<PROD_DOMAIN>` |
| `NEXT_PUBLIC_DEV_ORIGINS` | Extra dev origins (Next 16 cross-origin guard). Leave empty in prod | _(unset)_ |

Also **delete or unset** anything Replit-specific in production:
`REPLIT_DEV_DOMAIN`, `REPLIT_DOMAINS`, `REPL_ID`, `REPL_SLUG`, `REPL_OWNER`.

---

## 3. OAuth redirect URIs (must be registered with each provider)

For each provider below: (a) set the matching env var on the server, AND
(b) add the URL to the provider's "Authorized redirect URIs" list.

### Google (one OAuth client covers Gmail / Calendar / Drive / Suite)

Console: https://console.cloud.google.com/apis/credentials → your OAuth 2.0 Client

| Env var | Production URL to register with Google |
|---|---|
| `GOOGLE_REDIRECT_URI` | `https://<PROD_DOMAIN>/__api/api/crm/google/callback` |
| `GOOGLE_SUITE_REDIRECT_URI` | `https://<PROD_DOMAIN>/__api/connect/google-suite/callback` |
| `GMAIL_REDIRECT_URI` | `https://<PROD_DOMAIN>/__api/api/commerce/gmail/callback` |
| `CALENDAR_REDIRECT_URI` | `https://<PROD_DOMAIN>/__api/bookings/calendar/callback` |
| `DRIVE_REDIRECT_URI` | `https://<PROD_DOMAIN>/__api/api/drive/callback` |

Also under **OAuth consent screen → Authorized JavaScript origins**, add:
`https://<PROD_DOMAIN>`.

### Meta (Facebook + Instagram)

Console: https://developers.facebook.com/apps/<APP_ID>/

- App Domains: `<PROD_DOMAIN>`
- Site URL: `https://<PROD_DOMAIN>`
- Valid OAuth Redirect URIs: `https://<PROD_DOMAIN>/__api/connect/meta/callback`
- Webhook callback URL (if used): `https://<PROD_DOMAIN>/__api/webhooks/meta`

### WhatsApp Business (via Meta)

- Webhook callback URL: `https://<PROD_DOMAIN>/__api/webhooks/whatsapp`
- Configure `WHATSAPP_VERIFY_TOKEN` and re-verify in Meta dashboard.

### Stripe

Console: https://dashboard.stripe.com/webhooks

- Endpoint URL: `https://<PROD_DOMAIN>/__api/webhooks/stripe`
- Update env: `STRIPE_WEBHOOK_SECRET` = the new endpoint's signing secret.
- Update success/cancel URLs in any Checkout Session creation code if they
  ever hardcode a host (currently they read `APP_URL`, so updating `APP_URL`
  is enough).

### PayPal

Console: https://developer.paypal.com/dashboard/applications/

- Return URL / Webhook URL: `https://<PROD_DOMAIN>/__api/webhooks/paypal`
- Switch `PAYPAL_ENVIRONMENT` from `sandbox` → `live` and rotate
  `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` to live credentials.

### WiPay

- Update merchant callback URL in the WiPay merchant portal:
  `https://<PROD_DOMAIN>/__api/webhooks/wipay`

### Resend (email)

Console: https://resend.com/domains

- Verify `<PROD_DOMAIN>` (DKIM + SPF DNS records).
- Update `EMAIL_FROM_ADDRESS` to a verified sender on the new domain
  (e.g. `no-reply@<PROD_DOMAIN>`).

### Supabase Auth

Console: https://supabase.com/dashboard/project/<PROJECT>/auth/url-configuration

- Site URL: `https://<PROD_DOMAIN>`
- Redirect URLs (allow-list): add
  - `https://<PROD_DOMAIN>/**`
  - `https://<PROD_DOMAIN>/auth/callback`
- Update email templates if they hardcode any URL.
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` stay the same
  (Supabase project doesn't move).

### Google Search Console / GA4

- Re-verify domain ownership for `<PROD_DOMAIN>` (DNS TXT or HTML file).
- Update GA4 stream URL to `https://<PROD_DOMAIN>`.

---

## 4. Object storage (S3 / Replit Object Storage)

If staying on Replit Object Storage: nothing to do (URLs are issued by the
storage service, not by Replit hosting).

If migrating to a different S3-compatible bucket:

| Env var | New value |
|---|---|
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | new bucket id |
| `PRIVATE_OBJECT_DIR` | new private prefix |
| `PUBLIC_OBJECT_SEARCH_PATHS` | new public prefixes |
| `S3_PUBLIC_URL` | `https://<cdn-or-bucket-domain>` |

CORS on the bucket must allow `https://<PROD_DOMAIN>` for both browser GETs
and presigned PUTs.

---

## 5. Files / code that read host-coupled config

These are the only places in the codebase that reach for host-specific env
vars. They already fall back through the chain
`APP_URL` → `PUBLIC_BASE_URL` → `OAUTH_REDIRECT_BASE` → `REPLIT_DEV_DOMAIN`,
so setting the production env vars in section 2 is normally enough. Listed
here so we can audit if behavior looks wrong:

- `apps/server/src/core/config/runtime-urls.ts` — central URL resolver
- `apps/server/src/app-bootstrap.ts` — CORS allow-list
- `apps/server/src/core/connectors/google-suite.service.ts` — Google Suite OAuth
- `apps/server/src/modules/crm/crm-google.service.ts` — Google CRM OAuth
- `apps/server/src/modules/commerce/gmail.service.ts` — Gmail OAuth
- `apps/server/src/modules/bookings/calendar.service.ts` — Calendar OAuth
- `apps/server/src/modules/google-drive/google-drive.service.ts` — Drive OAuth
- `apps/server/src/modules/social/social.controller.ts` — social OAuth callbacks
- `apps/server/src/modules/documents/documents.service.ts` — share links
- `apps/server/src/modules/payments/payments.service.ts` — payment return URLs
- `apps/server/src/modules/identity/identity-signup.service.ts` — verification email links
- `apps/server/src/modules/autopilot/delegation-loop.service.ts` — outbound links
- `apps/server/src/modules/commerce/commerce.controller.ts` — outbound links
- `apps/web/next.config.ts` — `allowedDevOrigins` and `/__api/*` rewrite
- `apps/web/src/app/api/crm/google/callback/route.ts` — front-channel callback

---

## 6. DNS / infra to set up on the new host

- A / AAAA / CNAME records for `<PROD_DOMAIN>` → new host.
- TLS certificate (Let's Encrypt or platform-managed).
- (Optional) separate `api.<PROD_DOMAIN>` if not using the `/__api/*` proxy —
  in that case set `NEXT_PUBLIC_API_BASE_URL=https://api.<PROD_DOMAIN>`.
- Resend DNS records (SPF/DKIM) for the sending domain.
- Google Search Console verification record.

---

## 7. Cutover order (suggested)

1. Provision DNS + TLS for `<PROD_DOMAIN>`.
2. Deploy code to new host (env vars unset → app starts but external integrations still point at Replit).
3. Set section-2 env vars on the new host.
4. For each provider in section 3: register the new URL **alongside** the Replit one (both active), then set the matching env var on the new host.
5. Smoke-test each integration on the new host: Google connect, Stripe checkout, Resend email, Supabase login.
6. Flip DNS / traffic to new host.
7. Remove Replit URLs from each provider's allow-list.
8. Decommission the Replit deployment.

---

## 8. Change log

| Date | What changed | Note |
|---|---|---|
| 2026-05-04 | Initial document. Captured `GOOGLE_SUITE_REDIRECT_URI` set to Replit dev domain. | First entry. |
