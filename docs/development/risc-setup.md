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

## Backfill Google identities (accounts that last signed in before W8)

`POST /identity/bootstrap` has written the Google `sub` -> user link at every Google sign-in since W8-RISC-SIGNIN-CUTOFF (D-97), from the verified provider record. An account whose owner last signed in with Google before that deploy has no `UserIdentity` row, so a RISC event for it matches no user (`no_matching_user`, logged as `SECURITY: RISC ... matched no user`) and ends no session (D-97 residual SEC-W8RSC-3). Backfill those rows from GoTrue's admin user list:

```bash
cd apps/server
pnpm backfill:google-identities           # dry run: prints counts, writes nothing
pnpm backfill:google-identities --apply   # writes the missing rows
```

It reads `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `DATABASE_URL` from the repo-root `.env`, and:

- pages `GET /auth/v1/admin/users` with the service-role key (`SupabaseAdminService.listUsersPage`) only to enumerate the user ids; a page that fails stops the run with exit 1 (it is never read as the end of the list). GoTrue does not load identities on the list (`models.FindUsersInAudience` has no `Eager()`: every listed user carries `identities: null`; review CR-W9IBS-1);
- reads each listed user's record, `GET /auth/v1/admin/users/{id}` (`SupabaseAdminService.getUserRecord`, identities eager-loaded: the record bootstrap reads), one request per user, one after another. A record that fails, names another id, or whose `identities` is not a list (not loaded) stops the run with exit 1: it is never counted as a user without a Google identity;
- takes the record's `identities[]` entries with provider `google` (the identity's provider id, else `identity_data.sub`, the rule bootstrap uses) and NEVER `user_metadata`, which the user can edit;
- writes the row bootstrap writes (`provider: google`, `providerSubject`, the identity's email, `userId` = the GoTrue user id) only for a GoTrue user that has a local `User` row, as an upsert on `(provider, providerSubject)`; re-running is safe (idempotent);
- skips and counts: users with no Google identity, GoTrue users with no local `User` row, subs already mapped to the same user, and subs already mapped to a DIFFERENT local user (a conflict: the existing row is never re-pointed, also when another writer maps the sub between the script's read and its write, review SEC-W9IBS-2; resolve it by hand, or the real owner's next Google sign-in re-points it through bootstrap);
- counts the RISC events that arrived before the backfill (`unapplied_risc_events`, `unapplied_risc_accounts`; see below) and prints a NOTE when there are any;
- prints counts only: never an email, a Google sub, a user id or a key. Exit status: 0 done, 1 a GoTrue read, a write or the RISC event count failed (re-run), 2 bad arguments or the admin client is not configured.

Run the dry run first, then `--apply` once after deploying W8 or later. It makes no change at Google or GoTrue (read-only there).

### RISC events that arrived before the backfill (review SEC-W9IBS-1)

The backfill maps the sub for every LATER event; it does not replay an earlier one. A session-ending event (`sessions-revoked`, `tokens-revoked`, `token-revoked`, or `account-disabled` with reason `hijacking`) for a sub that was not mapped yet was answered 202 and stored as `no_matching_user`, and Google does not send it again. So such an account holds NO sign-in cutoff for that event, and its sessions (possibly the attacker's) were not ended. `unapplied_risc_events` counts those events whose sub now resolves (in a dry run: or would after `--apply`), and `unapplied_risc_accounts` the accounts. When either is above 0, list the accounts (operator database access; the script itself prints counts only):

```sql
SELECT ui.user_id, e.event_type, e.payload->>'reason' AS reason, e.received_at
FROM risc_events e
JOIN user_identities ui ON ui.provider = 'google' AND ui.provider_subject = e.provider_subject
WHERE e.user_id IS NULL
  AND e.action_taken = 'no_matching_user'
  AND (e.event_type IN (
         'https://schemas.openid.net/secevent/risc/event-type/sessions-revoked',
         'https://schemas.openid.net/secevent/oauth/event-type/tokens-revoked',
         'https://schemas.openid.net/secevent/oauth/event-type/token-revoked')
       OR (e.event_type = 'https://schemas.openid.net/secevent/risc/event-type/account-disabled'
           AND e.payload->>'reason' = 'hijacking'))
ORDER BY e.received_at;
```

and act on each account by hand, as for a live `no_matching_user` event: end its sessions and, for `hijacking`, ban it for a while in the Supabase dashboard, have the owner reset the password, and contact the owner. Until then such an account is NOT covered by the backfill.

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
- Google identity backfill (operator): `apps/server/scripts/backfill-google-identities.ts` (`pnpm backfill:google-identities` in `apps/server`)

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
