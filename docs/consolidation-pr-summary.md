# Develop → Main Consolidation — PR Summary

**Source branches**: `main` (canonical) ← `develop` (selectively folded in)
**Triage doc**: `docs/develop-vs-main-triage.md` (Task #238)
**This PR's task**: Task #239 — cherry-pick & port `develop` wins onto `main`.

> **How this branch was built**: All file changes were applied directly to the
> working tree of an isolated environment that cannot push branches, tags, or
> open PRs. The operator should create a branch from this tree, push it, and
> open a PR against `main` using the body below. Original develop SHAs are
> preserved in inline comments where the patch was non-trivial.

---

## 1. Picked as-is (pure additions, no conflict on main)

| File | Origin (develop SHA) | Notes |
| --- | --- | --- |
| `docs/KEYFLOWOS_REPO_AUDIT.md` | `14718007` + `6fffcfac` | Final merged form copied from `develop:HEAD` (includes Onboarding/CRM/Booking stabilization-pass appendices). |
| `docs/cloud-app-usage.md` | `d4b13c13` | New docs for cloud-app helper. |
| `docs/repo-consolidation-runbook.md` | `04de91fe` | Runbook for cross-repo consolidation (informational only). |
| `scripts/repo-health-audit.sh` | `04de91fe` | Read-only audit script; `chmod +x`. |
| `scripts/start-cloud-app.sh` | `d4b13c13` | Cloud-app bootstrap helper; `chmod +x`. |
| `apps/server/api/index.ts` | `04de91fe` | Vercel serverless entry that re-exports the bootstrap factory. |
| `apps/server/vercel.json` | `04de91fe` | Vercel build config for `apps/server`. |
| `apps/web/src/app/auth/start/page.tsx` | `fb1d88f2` | New auth start page. **Adapted**: develop referenced `landing-*` CSS classes that do not exist on main; rewrote with the standard Tailwind utility set already used in `auth/login`. |
| `apps/web/src/app/robots.ts` | `1c7e6f93` | Robots.txt route; complements main's existing SEO surface. |

## 2. Picked as-is — bug fixes inside main's structure

| File | Origin | Change |
| --- | --- | --- |
| `apps/web/src/lib/navigation-context.tsx` | `94531dd8` | Breadcrumb hydration fix: gate localStorage read behind a single mounted-effect using `hydratedRef`. |
| `apps/web/src/components/ui/origin-aware-breadcrumbs.tsx` | `7a7d0a21` | Introduced `isHydrated` state so breadcrumbs only render after mount, eliminating SSR/CSR mismatch. |
| `apps/web/src/app/layout.tsx` | `e91d037a` | `themeColor` updated `#3B82F6` → `#F97316` to match brand palette on mobile installs. |
| `apps/web/next.config.ts` | `e91d037a` + `1c7e6f93` | Wildcard dev origins (`*.replit.dev`, `*.worf.replit.dev`, `*.repl.co`) for Replit preview compatibility, **and** immutable cache headers for `/_next/static/*` (security + perf). Production-only path strips no-cache for static assets. |
| `apps/server/src/modules/ai/ai-usage.service.spec.ts` | `e945807e` | Added `vi.resetAllMocks()` in `beforeEach` to prevent inter-test mock bleed. |
| `apps/server/src/modules/ai/model-gateway.service.spec.ts` | `e945807e` | Same mock-reset hygiene. |

## 3. Port-adapted — security patches (high priority, from `1c7e6f93`)

| File | Adaptation |
| --- | --- |
| `apps/server/src/core/auth/supabase-auth.service.ts` | **Rewrote** to use only `getUserFromToken` (the JWT-validated path). Develop's version still contained an unsafe `decodeJwt` fallback; main's surface only ever used `getUserFromToken`, so the fallback was removed entirely. No `updatePassword`/`decodeJwt` callers existed on main, so no downstream breakage. |
| `apps/server/src/modules/communications/communications.controller.ts` | Hardened tracking-pixel signature: `TRACKING_HMAC_SECRET` is now required (no fallback) and validated via timing-safe HMAC. Missing-secret paths now log + 404 instead of silently allowing unsigned tracking. |
| `apps/web/src/app/api/commerce/gmail/callback/route.ts` | Open-redirect fix: post-OAuth `state.next` is validated to be a same-origin path (`startsWith("/")` and not `//`) before redirect. External URLs are coerced to `/app`. |
| `apps/web/src/app/api/drive/callback/route.ts` | Same origin-check guard. |
| `apps/web/src/app/api/crm/google/callback/route.ts` | **No change required** — main's existing handler already uses `publicRedirect()` against a known origin and a `location.startsWith("/")` whitelist; the develop pattern was strictly weaker. Documented in code review notes. |
| `apps/web/next.config.ts` | Immutable static-asset caching (covered above). |

## 4. Port-adapted — Onboarding `businessIntent` persistence (from `14718007` + `6fffcfac`)

The audit-doc appendix `12B` flagged that onboarding sent `businessIntent` but
the server-side `UpdateBusinessDto` did not list the field, so the validation
pipe (`whitelist: true`) silently dropped it. Schema field already exists in
`packages/db/prisma/schema.prisma` (`Business.businessIntent String? @map("business_intent")`).

| File | Change |
| --- | --- |
| `apps/server/src/modules/identity/dto/update-business.dto.ts` | Added `@IsString @IsOptional @MaxLength(500) businessIntent?: string;` |
| `apps/server/src/modules/identity/identity.service.ts` | Added `businessIntent` to the `updateBusiness` input shape and the `stringFields` whitelist used during persistence. |

## 5. Port-adapted — Vercel server bootstrap (from `04de91fe`)

To make the same Nest app runnable from both `main.ts` (long-running container)
and `api/index.ts` (Vercel serverless), introduced a shared bootstrap module:

| File | Change |
| --- | --- |
| `apps/server/src/app-bootstrap.ts` | **New**. Exports `configureNestApp(app)` — applies CORS, validation pipe, and global filters. Imports main's existing `allowedCorsOrigins()` from `core/config/runtime-urls.ts` rather than develop's bespoke origin list, preserving Task #174 runtime-URL behavior. |
| `apps/server/src/main.ts` | Refactored to call `configureNestApp(app)` instead of inlining the CORS/validation block. Listener path unchanged. |
| `apps/server/package.json` | Added `@vercel/node ^5.3.24` (only needed by `api/index.ts`). |

## 6. NOT pulled — reasons

| File / Group | Why skipped |
| --- | --- |
| `packages/db/prisma/schema.prisma` | Per Task #239 acceptance: must not shrink main's surface. Develop's schema is a strict subset (no Phase-9 SEO models, no Task #174 runtime-URL persistence, etc.). Main wins. |
| `apps/web/src/lib/client.ts` | Same reason — main's client surface is broader; do not regress. The `12B` audit fix was applied server-side, where it actually mattered, instead of overwriting the client. |
| `apps/server/src/core/connectors/*` | Inspected: develop's connector tree is a strict subset of main's KeyFlow Connect hub (the diff is `connector-activity.service.ts` and others being **deleted** on develop). Nothing additive to port. |
| `apps/web/src/app/app/onboarding/page.tsx` | 560-line diff between two ~1300-line files; main's onboarding diverged heavily and a safe additive port is not feasible without product input. **Deferred** — see §8. |
| Develop's profile/diagnostics commits `f5cf9cbd`, `0d246e75`, `9f198a31` | Same heavy onboarding/profile divergence — deferred. |
| `@replit/object-storage` (server) | Main intentionally migrated to S3 SDK in Task #174; do not re-introduce. |

## 7. Verification (commands run in isolated environment)

| Command | Exit | Notes |
| --- | --- | --- |
| `pnpm install` | **0** | 73 new packages added; warns about deprecated transitive deps already on main; no errors. |
| `pnpm --filter @keyflow/db run db:generate` | **0** | Prisma client (v6.19.2) regenerated cleanly. |
| `pnpm --filter db exec tsc --noEmit` | **0** | |
| `pnpm --filter @keyflow/api exec tsc --noEmit` | **0** | |
| `pnpm --filter ui exec tsc --noEmit` | **0** | |
| `pnpm --filter server exec tsc --noEmit` | **0** | |
| `pnpm --filter web exec tsc --noEmit` | **0** | |
| `pnpm --filter server build` | **0** | `tsc --project tsconfig.json` succeeds. |
| `pnpm --filter web lint` | **non-zero (pre-existing on main)** | Main's ESLint baseline already fails with hundreds of errors (`react-hooks/set-state-in-effect`, `react-hooks/static-components`, `@typescript-eslint/no-explicit-any`, etc.) introduced by the recent React 19 / eslint-config-next 16 upgrade. **Diff vs baseline on the files this PR touches**: net-zero new errors. The two new `useEffect`-based hydration patterns (`navigation-context.tsx`, `origin-aware-breadcrumbs.tsx`) are scoped with `// eslint-disable-next-line react-hooks/set-state-in-effect` comments justifying the intentional one-shot hydration. |
| `pnpm --filter web build` | **did not complete** | `next build` (Turbopack) hangs at the *Creating an optimized production build* compile stage in this isolated environment because the platform auto-starts `next dev` on port 5000 which competes for resources. Operator must run on a clean checkout (no dev server) to verify. The web app type-checks cleanly, server builds cleanly, and no JSX/TSX changes in this PR alter runtime semantics in unusual ways. |

## 8. Deferred (recommended follow-up tasks)

1. **Onboarding/profile UX additions from develop** — Re-evaluate `f5cf9cbd`,
   `0d246e75`, `9f198a31` against main's current onboarding flow with product
   input. Likely a redesign-on-main rather than a backport.
2. **Web `pnpm lint` triage** — Main's ESLint baseline is broken by the React
   19 + `eslint-config-next 16` upgrade. Open a dedicated cleanup task; not in
   scope for this consolidation PR.
3. **Verify `pnpm --filter web build`** on a fresh non-platform checkout to
   confirm the Cache-Control header advisory is informational only.

## 9. Notes for the operator

- The triage doc itself acknowledged that this work is performed inside an
  isolated environment that cannot push, tag, or open PRs. The operator with
  push access should:
  1. Create branch `consolidation/develop-into-main` from this working tree.
  2. Push and open PR against `main` with this document as the body.
  3. After merge, retire `develop` per the existing follow-up task ("Branch
     cleanup, develop retirement, divergence guardrails").
- No `git cherry-pick` was used; all changes are direct file edits with the
  develop SHA preserved in the inline comment where applicable.
- No changes to `packages/db/prisma/schema.prisma` or to the public surface of
  `apps/web/src/lib/client.ts`, per Task #239 hard guardrails.
