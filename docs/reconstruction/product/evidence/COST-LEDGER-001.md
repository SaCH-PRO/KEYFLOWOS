# Cost ledger 001: externally billable and outbound operations

```yaml
document_id: COST-LEDGER-001
for_packet: R0-07-OPTIONAL-SVC-VISIBLE; updated by R0-07a-AI-DIRECT-503 (sections 2, 4 and 7)
covers: issue #186 step 7 ("no unapproved paid external API; optional services fail visibly") and its "declared cost ledger"; CF-35
code_anchor: claude/elegant-curie-7azpsb at ab192183 plus R0-07; R0-07a at bc6dfaba (tests first at 42ead2b7)
proof: apps/server/test/optional-services-fail-visibly.integration.test.ts, apps/server/src/modules/ai/model-gateway.service.spec.ts,
       apps/server/test/ai-direct-provider-503.integration.test.ts, apps/server/src/modules/ai/ai-usage.service.spec.ts,
       apps/server/src/modules/key-cortex/key-cortex-voice.service.spec.ts (R0-07a),
       scripts/proof-admission/manifests/optional-services-fail-visibly.json
mutations: none (declaration only; no provider is turned on by this document)
review_status: PENDING_CHATGPT_REVIEW
```

## 1. The rule

Release 0 runs with **every optional provider off**. Each operation below either
stays off in Release 0, or, when a caller reaches it, **fails visibly and on its
own**: the request that needed it gets a clear answer, and nothing else breaks.
No Release 0 money route (invoice create and issue, manual payment, balance,
lists, receipt) needs any of them.

Columns:

- **Env var**: what turns the operation on. "Per business" means the business connects its own account (OAuth) or stores its own key (BYOK).
- **Code default**: what the code does when the variable is unset. `off` means the operation does not run until it is configured; `on` means it runs unless something turns it off.
- **Release 0**: the state Release 0 runs in.
- **Billing**: `paid` (metered by the provider), `free` (no charge; may have quotas), or `host` (part of hosting, not per call).
- **Failure mode**: what a caller sees when the provider is not configured or is down. **Proven** rows are pinned by the R0-07 and R0-07a suites; the others are read from code at the anchor and are declarations, not proofs.
- **Cost owner**: who pays. `Platform` is the KeyFlow operator's account; `Tenant` is the business's own account (its OAuth connection or BYOK key).

## 2. Proven by R0-07 and R0-07a: optional services that fail visibly

| Operation | Provider (host) | Code | Env var | Code default | Release 0 | Billing | Failure mode | Cost owner |
|---|---|---|---|---|---|---|---|---|
| Send invoice, reminder and receipt email; quote email; direct send and reply | Gmail API (gmail.googleapis.com) | `commerce/gmail.service.ts` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GMAIL_REDIRECT_URI`, `GOOGLE_STATE_SECRET`; per business: the Gmail OAuth connection | off | off | free (Gmail API quota) | **Proven.** 503 `{code:'provider_not_configured', details:{service:'gmail'}}` before any outbound call when the business has no connection, or when the deployment has no Google OAuth client to connect or refresh one. The invoice stays in its status and no FinancialTransaction or LedgerEntry is written; no reminder or receipt is logged as sent. `GET .../gmail/status` answers 200 `{connected:false}`. A send that reaches Google and fails keeps its old 400. | Tenant (its mailbox); Platform (the Google Cloud OAuth client) |
| Gmail inbox read, search, labels, attachments | Gmail API | `commerce/gmail.service.ts` (`getValidAccessToken`) | as above | off | off | free | Same 503 as above (shared token path). | Tenant |
| Gmail connect (auth URL, code exchange) | accounts.google.com, oauth2.googleapis.com | `commerce/gmail.service.ts` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_STATE_SECRET` | off | off | free | **Proven** for the auth URL: 503 `provider_not_configured`. The OAuth callback redirects with `gmail=error`, as before. | Platform |
| AI dispatch through the model gateway (`complete`): chat, briefings, generation, classification, tool calling | OpenAI (api.openai.com or `AI_INTEGRATIONS_OPENAI_BASE_URL`), Anthropic, xAI, Kimi, Google Gemini, native, OpenRouter or Ollama | `ai/model-gateway.service.ts` | `AI_INTEGRATIONS_OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`, `KIMI_API_KEY`, `GOOGLE_API_KEY` or `GEMINI_API_KEY`, `NATIVE_AI_API_KEY` or `KEYFLOW_NATIVE_AI_URL`, `OPENROUTER_API_KEY` or `OLLAMA_BASE_URL`; per business: BYOK keys (`BYOK_ENCRYPTION_SECRET` to store them) | off | off | paid (per token) | **Proven.** 503 `{code:'provider_not_configured', details:{service:'ai'}}` when no candidate provider has a key; 503 `provider_unavailable` when candidates are configured but every circuit is open. A circuit belongs to the credential that failed (the platform's env key, or one business's BYOK key), so one business's revoked key never makes AI unavailable for another. Nothing is billed: no AiUsageLog row, no LLM cost write, no provider call. A provider that was called and failed keeps its own error. | Platform (env keys); Tenant (BYOK) |
| AI streaming (`streamComplete`) | as above | `ai/model-gateway.service.ts` | as above | off | off | paid | **Proven.** One `{type:'error', code:'provider_not_configured'}` chunk; no provider call. | Platform or Tenant |
| Embeddings, image analysis (vision), voice synthesis and transcription through `AiUsageService`, which call OpenAI directly, not through the gateway | OpenAI (api.openai.com or `AI_INTEGRATIONS_OPENAI_BASE_URL`) | `ai/ai-usage.service.ts` (`trackEmbedding`, `trackVision`, `trackAudio`) | `AI_INTEGRATIONS_OPENAI_API_KEY` or `OPENAI_API_KEY`; `AI_INTEGRATIONS_OPENAI_BASE_URL` | off | off | paid | **Proven by R0-07a (bc6dfaba).** With neither key set (an empty value counts as unset), each helper throws the gateway's 503 `{code:'provider_not_configured', details:{service:'ai'}}` before it builds an OpenAI client, calls OpenAI, spends a rate-limit slot or credit, or writes an AiUsageLog row. It used to throw the SDK constructor's plain error. `POST /crm/businesses/:b/import/scan` (vision) now answers this 503; it answered 500. `POST /voice/businesses/:b/tts` answers 503 and builds no client, but its provider wrapper drops the code (section 7 item 7). With a key, nothing changes: same key, base URL, provider call and usage row. | Platform |
| KEY voice (speech and transcription) | OpenAI | `key-cortex/key-cortex-voice.service.ts` | `AI_INTEGRATIONS_OPENAI_API_KEY` or `OPENAI_API_KEY` | off (warns at boot) | off | paid | **Proven by R0-07a (bc6dfaba).** The sentinel key `sk-no-key` is gone. With neither key set the service builds no client, and `synthesize` and `transcribe` (with the metadata and preview paths that use them) throw the same 503 before any provider call or usage record. `POST /api/v1/cortex/voice/speak` and `/voice/listen` answer 503 and send nothing; they used to send the request to OpenAI with `Authorization: Bearer sk-no-key` (401 in production). `KeyCortexController` still replaces the body with `'Voice synthesis unavailable'` / `'Speech transcription unavailable'` without the code (section 7 item 7), and its two handlers read the tenant from the query rather than from the field the guard checked (section 7 item 9). With a key, nothing changes. | Platform |

## 3. On the Release 0 path, or deciding whether it boots

| Operation | Provider (host) | Code | Env var | Code default | Release 0 | Billing | Failure mode | Cost owner |
|---|---|---|---|---|---|---|---|---|
| Password breach check at sign-up (k-anonymity range query) | Have I Been Pwned (api.pwnedpasswords.com, or `HIBP_API_BASE`) | `identity/password-policy.service.ts` | `HIBP_DISABLED`, `HIBP_API_BASE`, `HIBP_THRESHOLD` | **on** (runs unless `HIBP_DISABLED=true`) | **off** (`HIBP_DISABLED=true`) | free | Fails open: a network error or the 1.5 s timeout counts as zero breaches and sign-up proceeds. Outbound but not billed. | None |
| Sign-in and token verification | Supabase Auth (`SUPABASE_URL`) | `core/auth/*`, `identity/*` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET` | off | on: hosted Supabase per owner decision D-02 | host (Supabase plan) | Without `SUPABASE_URL` no user can sign in. A token signed with `SUPABASE_JWT_SECRET` is still verified locally without a call (`SupabaseAuthService.verifyLocal`; the Release 0 journey suite runs this way). | Platform |
| Sign-up user creation | Supabase Admin API | `core/auth/supabase-admin.service.ts` | `SUPABASE_SERVICE_ROLE_KEY` | off | as decided under D-02 | host | Missing key: boot prints a warning and `POST /identity/signup` answers `server_misconfigured`. | Platform |
| Verification and system email | Resend | `notifications/system-email.service.ts`, `finance/accountant-export-email.service.ts`, `commerce/financial-briefing-scheduler.service.ts` | `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS` | off (skipped with a warning) | off unless email verification is on | paid (per email over the free tier) | With `AUTH_REQUIRE_EMAIL_VERIFICATION` on (the default when `NODE_ENV=production`), `main.ts` refuses to boot without `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY` and `EMAIL_FROM_ADDRESS` (CF-35). Otherwise the email is skipped. | Platform |
| Database | PostgreSQL + pgvector | `packages/db` | `DATABASE_URL`, `DIRECT_URL` | required | required | host | Required infrastructure, not an optional service. | Platform |
| Cache, rate limits, token revocation | Redis | `core/redis/*` | `REDIS_URL` | required | required | host | Required infrastructure, not an optional service. See section 6. | Platform |

## 4. AI calls that bypass the gateway (declared; not covered by the R0-07 503)

The `AiUsageService` direct helpers and KEY voice were listed here until
R0-07a proved their failure mode; they are now in section 2.

| Operation | Provider | Code | Env var | Code default | Release 0 | Billing | Failure mode | Cost owner |
|---|---|---|---|---|---|---|---|---|
| KEY document embeddings | OpenAI | `key-cortex/key-cortex-document.service.ts` | `AI_INTEGRATIONS_OPENAI_API_KEY` or `OPENAI_API_KEY` | off (warns at boot) | off | paid | Still builds its client with the sentinel key `sk-no-key`, so an embedding call goes out to OpenAI and fails there with a 401. Found by R0-07a, outside its write set (section 7 item 8). | Platform |
| Text to speech | ElevenLabs | `voice/elevenlabs-voice.provider.ts` | `ELEVENLABS_API_KEY` | off | off | paid | 503 `ELEVENLABS_API_KEY is not configured.` | Platform |
| Code execution sandbox | E2B | `ai/code-executor.service.ts` | `E2B_API_KEY` with `PUBLIC_API_URL` | off (local backend) | off | paid | Falls back to the local executor. | Platform |
| LLM tracing | Langfuse (cloud.langfuse.com or `LANGFUSE_BASE_URL`) | `ai/langfuse.service.ts` | `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` | off | off | paid above free tier | Tracing disabled; calls still routed and costed. | Platform |

## 5. Other outbound integrations (declared; not on the Release 0 path)

All are off until configured, and none is called by a Release 0 money route.
Failure modes are read from code at the anchor.

| Operation | Provider | Code | Env var | Billing | Failure mode | Cost owner |
|---|---|---|---|---|---|---|
| Online card payments, checkout, webhooks | Stripe | `payments/payments.service.ts`, `webhooks/webhooks.controller.ts` | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`, or per-business keys | paid (per transaction) | Gateway not offered; checkout answers 400 `Stripe is not configured for this business`. | Tenant (processing fees) |
| PayPal and WiPay payments | PayPal, WiPay | `payments/payments.service.ts`, `core/connectors/implementations/wipay.connector.ts` | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `WIPAY_API_KEY` | paid (per transaction) | Gateway not offered. | Tenant |
| FX rates | Frankfurter (api.frankfurter.app) | `payments/currency-rates.service.ts` | none | free | Falls back to stored or fallback rates (`source: 'fallback'`). | None |
| Phone calls and SMS | Twilio | `key-cortex/key-cortex-phone.service.ts`, `phone-voice/*` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | paid | 503 `Twilio is not configured...` when a call is started. | Platform |
| WhatsApp messages | Meta WhatsApp Cloud API | `core/connectors/implementations/whatsapp.connector.ts` | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET` | paid (per conversation) | Connector not connected. | Tenant |
| Realtime voice rooms | LiveKit | `livekit/livekit.service.ts` | `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL` | paid | Unavailable when unset. | Platform |
| Web push | Browser push services | `push-notifications/push-notification.service.ts` | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | free | Push disabled. | None |
| Contact enrichment | Apollo | `crm/enrichment/apollo-enrichment.provider.ts` | `APOLLO_API_KEY` | paid | Provider disabled; every failure resolves to `null`, never blocks a contact write. | Platform |
| Email-domain MX lookup | DNS | `crm/crm-data-quality.util.ts` | `KF_DISABLE_MX` | free | Skipped when `KF_DISABLE_MX=1`; cached per domain. | None |
| Marketing email and audiences | Klaviyo, Mailchimp, SendGrid (health check) | `core/connectors/implementations/{klaviyo,mailchimp}.connector.ts`, `key-connector/health/health-check.service.ts` | `KLAVIYO_API_KEY`, `MAILCHIMP_API_KEY`, or per-business keys | paid | Connector not connected. | Tenant |
| Accounting sync | QuickBooks, Xero | `core/connectors/implementations/{quickbooks,xero}.connector.ts` | per-business OAuth | free (API) | Connector not connected. | Tenant |
| Google Drive, Calendar, People, Forms, Sheets, Business Profile, Analytics | Google APIs | `google-drive/*`, `connect/google-token.helper.ts`, `core/connectors/google-suite.service.ts` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DRIVE_TOKEN_ENCRYPTION_SECRET`; per-business OAuth | free (quota) | Not connected. | Tenant |
| Microsoft 365 mail and calendar | Microsoft Graph | `connect/microsoft-oauth.service.ts` | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_STATE_SECRET` | free (quota) | Not connected. | Tenant |
| Social publishing and analytics | Meta (Facebook, Instagram), TikTok, X, LinkedIn | `social/*` | `META_APP_SECRET`, `META_SOCIAL_VERIFY_TOKEN`; per-business OAuth | free or paid by platform tier | Not connected. | Tenant |
| Forms and automation connectors | Typeform, Jotform, Zapier, Slack | `core/connectors/implementations/*`, `key-connector/*` | per-business tokens | free or paid by vendor plan | Not connected. | Tenant |
| Support inbox | Chatwoot | `chatwoot/chatwoot.service.ts` | `CHATWOOT_URL`, `CHATWOOT_API_TOKEN`, `CHATWOOT_ACCOUNT_ID` | host or paid | Not called when unset. | Platform |
| Error reporting | Sentry | `core/sentry/sentry.module.ts` | `SENTRY_DSN` | paid above free tier | Disabled when unset. | Platform |
| Feature flags | GrowthBook (cdn.growthbook.io or `GROWTHBOOK_API_HOST`) | `core/growthbook/growthbook.service.ts` | `GROWTHBOOK_CLIENT_KEY` | paid above free tier | Disabled; every flag resolves to the caller's fallback. | Platform |
| File storage | S3-compatible storage | `core/config/env.ts`, `crm/privacy/contact-privacy.service.ts` | `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_URL`, `AWS_*` | paid (storage and egress) | Storage-backed features unavailable when unset. | Platform |
| Document parsing sidecar | Docling (local sidecar, default `http://localhost:5001`) | `ingestion/document-parsing.service.ts` | `DOCLING_URL` | host | Fails open: returns `null` and callers use the raw path. | Platform |
| Business-configured outbound webhooks | The business's own endpoints | `webhooks/*` | per business | none | Not called unless the business registers an endpoint. | Tenant |

## 6. Moved out of R0-07

The `/readyz` Redis probe is not part of this ledger. Redis is required
infrastructure, not an optional service, so it is not an issue #186 step 7 item.
It joins the OPS-001 row of the V1+ backlog (BUILD-MAP-001 section d). When it is
built, the failure is injected per process (an unreachable `REDIS_URL` for the
spawned server), never by stopping the shared container.

## 7. Follow-ups found by R0-07 (outside its write set)

1. **Done by R0-07a-AI-DIRECT-503 (bc6dfaba; tests first at 42ead2b7).** `AiUsageService` and `KeyCortexVoiceService` call OpenAI directly, so they did not get the gateway's structured 503. They now throw it themselves when no OpenAI key is configured, before any client, provider call or usage row (section 2). The proof is `ai-direct-provider-503.integration.test.ts` (real database, prefix `k07c_`), `ai-usage.service.spec.ts` and `key-cortex-voice.service.spec.ts`, bound by the `optional-services-fail-visibly.json` manifest. Items 7 and 8 are what R0-07a found outside its write set, and item 9 is what its review found there.
2. `POST .../quotes/:id/send-email` moves a DRAFT quote to SENT before it sends (`commerce.controller.ts`, owned by the commerce chain). A refused send now answers 503, but a DRAFT quote is left SENT. A SENT quote, as in the R0-07 suite, is unchanged.
3. `POST .../invoices/:id/send-email` creates the invoice's payment link before it sends, so a refused send can leave a new PaymentLink row. It writes no ledger rows and does not change the invoice status.
4. Gmail connect is not bound to the user who started it (R0-07 review ST-2). The signed OAuth state names only the business, and `GET /commerce/gmail/callback` needs no login, so whoever completes Google consent on a forwarded auth URL links their mailbox to that business. R0-07 made a state single-use (per process); binding it to the initiating user, or confirming the link in that user's session, needs `commerce.controller.ts`.
5. `GET .../gmail/auth-url` is guarded by `revenue:read` (R0-07 review ST-3), so STAFF can start connecting, or replacing, the business mailbox that invoices and receipts are sent from. The guard is in `commerce.controller.ts`.
6. The web client retries every GET 503 three times and then drops the body (R0-07 review ST-4 / R07-CR-1: `apps/web/src/lib/fetch-with-retry.ts`, `api.ts`). GET consumers of the R0-07 503 (Gmail auth URL, inbox reads, AI GET routes such as the weekly plan) see `HTTP 503: <statusText>` and a "backend unreachable" warning instead of `provider_not_configured`, and spend four requests of their rate limit. The web client should hand a 503 whose body code is `provider_not_configured` to its caller without retrying.
7. Callers of the direct AI paths lose the R0-07a code or hide the failure (found by R0-07a; recorded as `it.todo` cases in `ai-direct-provider-503.integration.test.ts`):
   - `KeyCortexController.speak` and `.listen` (`POST /api/v1/cortex/voice/speak`, `/voice/listen`) catch every error and throw a new `ServiceUnavailableException('Voice synthesis unavailable' / 'Speech transcription unavailable')`. The status is 503, but the body code is `UNKNOWN_ERROR`. Owned by `key-cortex.controller.ts`. The same two handlers also read the tenant from the wrong field (item 9); both fixes are in that file.
   - `OpenAiVoiceProvider` (`POST /voice/businesses/:b/tts`) and `KeyflowVoiceService` (`POST /keyflow/businesses/:b/voice/tts`, `/voice/transcribe`) rewrap the error the same way. The voice provider keeps the cause in its message (`OpenAI TTS failed: No AI providers available: ...`); KeyflowVoiceService replaces it with `Voice synthesis failed.` or `Voice transcription failed.`. The fix is to rethrow an `HttpException` unchanged.
   - `CommerceVisionService.extractProductsFromImage` (`POST /commerce/businesses/:b/products/import/scan`) catches every error and returns no products, so a missing key looks like an image with nothing in it.
   - `SemanticMemoryService.search` and `backfillFromAiMemory` (`GET /ai/businesses/:b/agent/memory/search`, `POST .../agent/memory/backfill`) and the background `store` callers log the error and return empty results. Nothing is billed and no client is built, but nothing tells the user that search is not configured.
8. `KeyCortexDocumentService` (`key-cortex/key-cortex-document.service.ts`, document embeddings) still builds its OpenAI client with the sentinel key `sk-no-key` (section 4). It should use `directOpenAiKey()` and `directOpenAiNotConfigured()` from `ai/ai-usage.service.ts`, as KEY voice now does. Outside R0-07a's write set.
9. `KeyCortexController.speak` and `.listen` read the tenant with `@Query('businessId')`, but `BusinessGuard` checks the tenant that `resolveRequestBusinessId` resolves: path parameter, then body, then query (R0-07a review ST-1, security and tenancy; predates R0-07a). On `speak`, a user who is a member of business B only can send `?businessId=A` with the JSON body `{text, businessId: "B"}`. The guard passes for B, and the handler hands A to `KeyCortexVoiceService.synthesize`. A review probe on the real guards and database got 200 with `synthesize` receiving A; the same request without the body field gets 403 `No access to this business`. In production the global `TenantInterceptor` and the Prisma tenant extension should keep the usage row in B, but `synthesize`, `trackAudioUsage` (with its log lines) and `checkAlertThresholds` run under A's id. On `listen`, multer parses the multipart body after the guards, so the guard sees only the query and the probe's body field got 403. The handler still reads a different source from the guard, so the same fix applies. This is the guard and handler split that `core/auth/request-business-id.ts` says is closed for bare-id routes. The fix is `@GuardedBusinessId()` in both handlers, refusing `undefined`, together with item 7's first bullet. `key-cortex.controller.ts` is outside R0-07a's write set; `V1-03-KEY-CORTEX-PRINCIPAL` owns it in BUILD-QUEUE-001. Recorded as an `it.todo` in `ai-direct-provider-503.integration.test.ts`. That suite now also proves the query-only case: a member of another business only, naming A in the query, gets 403 on both routes before KEY voice runs.

## 8. Keeping the ledger true

- A packet that adds an outbound call or a paid provider adds its row here in the same change.
- A row moves to section 2 only when a suite proves its failure mode and a K12 manifest binds that suite.
- "Release 0" values change only by an owner decision recorded in BUILD-MAP-001 section g.
