# KEYFlowOS Production Readiness Checklist

Use this checklist before shipping KEYFlowOS to real users.

---

## 1. Build

- [ ] `pnpm build` succeeds in `apps/web`.
- [ ] `pnpm build` succeeds in `apps/server`.
- [ ] `pnpm db:generate` produces a current Prisma client.
- [ ] All pending Prisma migrations are applied or deployed.

## 2. Tests

- [ ] `pnpm test:ci` passes in `apps/server`.
- [ ] `pnpm test:flaky` failures, if any, are documented with an owner and a remediation date.
- [ ] New features have unit tests in `src/**/*.spec.ts`.
- [ ] Cross-module features have smoke tests in `test/**/*.smoke.test.ts`.

## 3. Environment

- [ ] `KEYFLOW_DEV_AUTH_BYPASS` is **not** set in production.
- [ ] `KEYFLOW_SKIP_ENV_VALIDATION` is **not** set in production.
- [ ] `DATABASE_URL` and `DIRECT_URL` point to a managed Postgres instance.
- [ ] `REDIS_URL` points to a managed Redis instance.
- [ ] `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_JWT_SECRET` are set.
- [ ] `APP_URL`, `API_URL`, `NEXT_PUBLIC_SITE_URL`, and `NEXT_PUBLIC_API_BASE_URL` use HTTPS.
- [ ] `.env.example` is up to date with any new variables.

## 4. Database

- [ ] Backups are scheduled and tested.
- [ ] Connection pooling is configured.
- [ ] Long-running migrations are planned for a maintenance window.

## 5. Auth

- [ ] Email verification behavior is intentional (`AUTH_REQUIRE_EMAIL_VERIFICATION`).
- [ ] Service-role keys are never exposed to the browser.
- [ ] Admin local auth credentials (`ADMIN_LOCAL_*`) are strong and rotated.

## 6. Payments

- [ ] Stripe webhook endpoints are registered and the signing secret is set.
- [ ] PayPal webhooks are registered.
- [ ] Test-mode keys are replaced with live keys.

## 7. Email

- [ ] `RESEND_API_KEY` and `EMAIL_FROM_ADDRESS` are set if verification is required.
- [ ] SPF/DKIM/DMARC are configured for the sending domain.

## 8. Communications

- [ ] WhatsApp Business account and phone number are approved.
- [ ] Meta app review is complete for Messenger/Instagram DMs if sending outbound.
- [ ] Connector credentials are encrypted (`CONNECTOR_ENCRYPTION_KEY`).

## 9. Calendar

- [ ] Google OAuth app is verified for Calendar/Gmail/Drive scopes.
- [ ] Redirect URIs match the deployed URLs exactly.

## 10. Object storage

- [ ] S3 bucket, region, access key, and secret are set.
- [ ] CORS policy allows uploads from `APP_URL`.
- [ ] Public/private prefixes match the app configuration.

## 11. Observability

- [ ] `SENTRY_DSN` is set.
- [ ] Log aggregation is configured.
- [ ] Health check endpoint (`/api/healthz`) is monitored.

## 12. Backups

- [ ] Database backups are automated.
- [ ] Object storage buckets have versioning or backup policy.
- [ ] Encryption keys are stored in a secrets manager.

## 13. Security

- [ ] CORS origins are restricted (`CORS_ALLOWED_ORIGINS`).
- [ ] Rate limiting is enabled.
- [ ] Secrets are not committed to the repo.
- [ ] Dependency audit (`pnpm audit`) is run and high/critical issues are addressed.

## 14. Rate limits

- [ ] AI usage limits are configured per plan.
- [ ] API rate limits are enabled for public endpoints.

## 15. Background jobs

- [ ] BullMQ workers are running.
- [ ] Failed jobs are retried and dead-lettered appropriately.
- [ ] Job queues are monitored.

## 16. Smoke tests in production

- [ ] `/api/healthz` returns 200.
- [ ] `/business-command-center/businesses/:id/snapshot` returns a valid snapshot.
- [ ] `/key-autonomy/businesses/:id/actions/proposals` lists proposals.
- [ ] `/intelligence/businesses/:id/executive-brief` returns the brief.
- [ ] Web app `/app/command-center` loads without errors.

## 17. Rollback plan

- [ ] Previous release artifact is retained.
- [ ] Database rollback steps are documented for the latest migration.
- [ ] Feature flags or killswitches exist for high-risk new features.
- [ ] On-call runbook is updated.

---

## Sign-off

| Role | Name | Date | Notes |
|------|------|------|-------|
| Engineering lead | | | |
| Infrastructure | | | |
| Security | | | |
| Product | | | |

Once every box is checked, the platform is ready for stable release.
