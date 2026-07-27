# Google Cross-Account Protection (RISC) Setup

KeyFlowOS implements the [RISC](https://openid.net/specs/openid-risc-event-types-1_0.html) event receiver so that security incidents affecting a user's Google Account can trigger protective action inside KeyFlowOS.

## What is protected

When a user signs in with Google, Supabase returns the user's Google Account ID (`sub`). KeyFlowOS stores that link in the `UserIdentity` table. If Google later sends a RISC event for that Google Account, we can terminate the user's KeyFlowOS sessions and flag the account for review.

Supported event types and how KeyFlowOS responds:

| RISC event type | Required response in KeyFlowOS |
|---|---|
| `sessions-revoked` | Delete local `Session` rows and revoke Supabase sessions for the user. |
| `tokens-revoked` (Google Sign-in) | Same as `sessions-revoked`. |
| `token-revoked` | Same as `sessions-revoked` (Supabase manages OAuth refresh tokens). |
| `account-disabled` with `reason=hijacking` | Terminate sessions, set `googleSignInDisabled: true` on the user, and alert admins. |
| `account-disabled` with `reason=bulk-account` or no reason | Flag the account for review and alert admins. Sessions are NOT terminated automatically. |
| `account-enabled` | Clear `googleSignInDisabled`. |
| `account-credential-change-required` | Audit log + admin alert only. |
| `verification` | Audit log only. |

## Prerequisites

1. Google Sign-In is already configured in your GCP project.
2. Your Supabase project requests the `profile` or `email` scope (default for Google OAuth).
3. You have a public HTTPS URL that Google can POST to (e.g. `https://api.keyflowos.com/webhooks/risc`).

## GCP configuration

1. Open the [API Console Credentials page](https://console.developers.google.com/apis/credentials) and select the project that owns your Google Sign-In client IDs.
2. **Create a service account**:
   - Click **Create credentials > Service account**.
   - Grant it the **RISC Configuration Admin** role (`roles/riscconfigs.admin`).
   - Create a JSON key and download it.
3. Note the **client ID(s)** used for Sign In With Google.
4. Open the [RISC API page](https://console.developers.google.com/apis/api/risc.googleapis.com) for the same project, review the RISC Terms, and click **Enable**.

## KeyFlowOS configuration

Add to your `.env`:

```env
# The web client ID shown on the Sign In With Google button.
GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com

# Optional: additional client IDs (Android, iOS, etc.) that may appear in RISC tokens.
# GOOGLE_CLIENT_IDS=android-client-id.apps.googleusercontent.com,ios-client-id.apps.googleusercontent.com

# The JSON content of the service account key downloaded above, OR an absolute path to the .json file.
RISC_SERVICE_ACCOUNT_JSON={"type":"service_account",...}

# The public HTTPS URL Google will POST events to.
RISC_RECEIVER_URL=https://api.keyflowos.com/webhooks/risc
```

## Register the receiver with Google

Run the configuration script:

```bash
pnpm configure:risc
```

This creates or updates the RISC stream config in Google to point at `RISC_RECEIVER_URL` and subscribes to the supported event types.

## Testing

You can request a verification token from Google with:

```bash
curl -X POST https://risc.googleapis.com/v1beta/stream:verify \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{"state":"test-123"}'
```

A `verification` event should arrive at `/webhooks/risc` and be written to `AuthAuditLog`.

## Monitoring

- Received RISC events are stored in the `risc_events` table (deduplicated by `jti`).
- Every handled event is written to `auth_audit_logs` via `AuthSecurityService.audit`.
- Hijacked-account events log a warning with `SECURITY: RISC event ...` and will be surfaced in the admin Security UI.

## Code locations

- Receiver: `apps/server/src/modules/risc/risc.controller.ts`
- Validation & event handling: `apps/server/src/modules/risc/risc.service.ts`
- Google `sub` capture: `apps/server/src/modules/identity/identity.service.ts` (`persistUserIdentities`)
- Stream registration script: `scripts/configure-risc.ts`

## GDPR / data protection notes

RISC security event tokens include a Google Account identifier (`sub` /
`providerSubject`), which is personal data. KeyFlowOS handles this in line
with the RISC Terms and GDPR principles:

| Principle | How it's implemented |
|---|---|
| **Purpose limitation** | Events are used only for security, anti-fraud, and session management — exactly what the RISC Terms allow. |
| **Data minimization** | We store only `jti`, event type, the Google `sub`, the resolved `userId`, the action taken, and a tiny metadata blob (`reason`/`state` if present). The full JWT body and any Google profile data are not retained. |
| **Storage limitation** | `RiscEvent` rows are purged automatically after `RISC_EVENT_RETENTION_DAYS` (default **90 days**). A nightly cron job runs at 03:00 local server time. |
| **Right to erasure** | Call `RiscService.eraseForUser(userId)` when a user exercises their GDPR right to be forgotten. It deletes all `RiscEvent` rows linked to that user. |
| **Lawful basis** | Security incident response is a **legitimate interest** (and in some cases a legal/security obligation). Google itself requires these signals be used only for security purposes. |
| **Cross-border transfer** | Data originates from Google's US infrastructure. Ensure your Privacy Policy / GDPR records of processing reflect receipt of security notifications from a US provider. |

If you serve EU users, make sure your public Privacy Policy mentions that
you receive security event notifications from Google to protect accounts
from hijacking and abuse.
