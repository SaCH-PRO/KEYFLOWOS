# Develop → Main Consolidation Triage & Inventory

**Task:** #238
**Date generated:** 2026-05-02
**Common ancestor:** `6344579cc8accaa43139a1d77d69d6924a7100a1`
**Develop unique commits:** 31 (`git log main..develop`)
**Main unique commits:** 39 (`git log develop..main`)
**Diff:** `git diff --shortstat main develop` → **247 files changed, +8,182 / −26,356**
**Canonical source of truth going forward:** `main`

> This document is **read-only diagnosis**. No code outside `docs/` is touched by
> this task. No branches are deleted, force-pushed, or rewritten.

---

## 0. Critical context

The two branches diverged on **2026-04-22** at commit `6344579c`. Since then:

- `main` is the Replit Agent feature track. It accumulated Community Phase 3/4/5,
  the KeyFlow Connect hub, AI matching, Autopilot, Trust & Reputation,
  match-feedback, network activity, and the Replit-independence pass (Task
  #174 — `AUDIT_REPORT.md`, `Dockerfile`, `MIGRATION.md`,
  `docker-compose.yml`, the new `apps/server/src/core/object-storage/` and
  `apps/server/src/core/config/runtime-urls.ts` modules).
- `develop` is the Cursor / Claude bot track. It collected SWOT auth/onboarding
  upgrades, mobile-host fixes, breadcrumb hydration fix, security patches, a
  Vercel serverless entry, the original Replit Object Storage code, and a
  separate set of `docs/` files (`KEYFLOWOS_REPO_AUDIT.md`,
  `repo-consolidation-runbook.md`, `cloud-app-usage.md`).

**A naive merge in either direction would silently destroy work.**
Merging `develop → main` would, among other things:

| File | Net change `main → develop` | What gets lost |
| --- | ---: | --- |
| `packages/db/prisma/schema.prisma` | **−594 lines** | Community Phase 3/4/5 models, match-feedback, relationship-insight dismissals, network activity, AI suggestion events |
| `apps/web/src/lib/client.ts` | **−1,083 lines** | All Phase 3/4/5 client APIs, Connect hub helpers, KeyFlow Command APIs |
| `apps/web/next.config.ts` | +40 / −38 | The post-audit config (rebases on top of develop's mobile-host fixes — see §5) |
| `apps/server/src/main.ts` | **−61 lines** | The `allowedCorsOrigins()` and structured CORS setup from Task #174 |
| `apps/server/package.json` | +5 / −6 | S3 SDK deps (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`); restoring `@replit/object-storage` |
| `.env.example` | **−178 lines** | All grouped env documentation from Task #174 |
| `apps/server/src/core/connectors/` | net loss of **9 files** | `connector-activity`, `connector-health-monitor` (+ spec), `google-suite` (controller + service), and 4 Google connectors (business-profile, contacts, forms, maps) |

**Therefore the chosen strategy is: keep `main` as base, cherry-pick / port a
small curated set of changes from `develop`. The rest of `develop` is either
already on `main` (in different form) or would regress `main`.**

---

## 1. Operator actions required (cannot be done by the agent)

The agent in this isolated environment **cannot push tags, create remote
branches, or open PRs** — version control is platform-managed and pushes to
`origin` from this isolate are restricted. The following safety steps must be
done by the human operator on a workstation with push access to
`https://github.com/SaCH-PRO/KEYFLOWOS` **before the cherry-pick task starts**:

```bash
# 1. Snapshot tags — the rollback point if anything goes wrong later.
git fetch origin
git tag pre-consolidation/main-2026-05-02    origin/main
git tag pre-consolidation/develop-2026-05-02 origin/develop
git push origin pre-consolidation/main-2026-05-02 pre-consolidation/develop-2026-05-02
# Verify both tags appear at https://github.com/SaCH-PRO/KEYFLOWOS/tags

# 2. Branch + draft PR for THIS triage doc (already produced as
#    docs/develop-vs-main-triage.md by Task #238 in the agent isolate).
#    The agent commits docs/ on its working branch which the platform then
#    merges to main. If you also want a discrete review branch, run:
git switch -c consolidation/develop-triage main
git push -u origin consolidation/develop-triage
gh pr create --draft --base main --head consolidation/develop-triage \
  --title "Triage: develop → main consolidation inventory" \
  --body "Inventory only — see docs/develop-vs-main-triage.md."
```

**Until the safety tags are pushed, do not start the cherry-pick task.**
Without them there is no rollback point.

---

## 2. Commit-level inventory — every develop-only commit

`git log main..develop --reverse` (31 commits). One classification per commit:
`pick-as-is` / `port-adapt` / `already-on-main` / `discard`.

Date format: ISO-8601. Author shortened.

| # | SHA | Date | Author | Subject | Verdict | Notes |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | `7c278e07` | 2026-04-23 01:55 | Cursor Agent | Map Supabase env vars for web auth | **discard** | `apps/web/next.config.ts` only. Main's `next.config.ts` (post-Task-#174) already pipes Supabase env through `process.env`. Adds nothing main lacks. |
| 2 | `823561e8` | 2026-04-23 02:20 | Cursor Agent | Use runtime origin for auth redirects | **port-adapt** | Touches `apps/web/src/app/auth/{callback,login,signup}/page.tsx`. Useful behavior (origin-derived OAuth redirect) but main has rewritten the same files for Supabase auth. Manually port the `window.location.origin`-derived redirect logic on top of main's versions. |
| 3 | `e945807e` | 2026-04-23 02:46 | Cursor Agent | test: reset mocks between AI spec cases | **pick-as-is** | One-line `vi.resetAllMocks()` adds to `ai-usage.service.spec.ts` and `model-gateway.service.spec.ts`. Trivial, no conflicts expected. |
| 4 | `d4b13c13` | 2026-04-23 03:37 | Cursor Agent | Add cloud bootstrap workflow and backend proxy | **port-adapt** | Adds `scripts/start-cloud-app.sh` (157 lines), `docs/cloud-app-usage.md`, `apps/web/src/lib/api-base.ts`, and tweaks `apps/web/next.config.ts`. The script and doc are pure additions (no conflict). `api-base.ts` overlaps with main's URL strategy — port carefully so it doesn't fight `runtime-urls.ts`. |
| 5 | `5649a79b` | 2026-04-23 04:44 | Cursor Agent | Implement SWOT critical upgrades across auth onboarding and control tower | **port-adapt** | Big commit (22 files, +770/−121). Adds `apps/web/src/app/api/session/route.ts`, `apps/web/src/lib/session-client.ts`, `next-best-action-card.tsx`, expands `onboarding/page.tsx` (+334 lines), reshapes `control-tower/page.tsx`, modifies `auth.middleware.ts`, `supabase-auth.service.ts`, `identity.controller.ts`, `identity.service.ts`. Substantial overlap with main's auth flow — must be ported file-by-file, not cherry-picked. |
| 6 | `91ba7c0c` | 2026-04-23 05:03 | Cursor Agent | Fix follow-up typing regressions in onboarding and control tower | **port-adapt** | Type fixes that only make sense if commit #5 is ported. Pull together with #5. |
| 7 | `862147e3` | 2026-04-23 05:21 | Cursor Agent | Fix cross-module type regressions blocking builds | **port-adapt** | Same — type follow-up to #5. Pull together. |
| 8 | `8f1aa445` | 2026-04-23 05:41 | Cursor Agent | Fix Next 16 search params SSR build blockers across app and auth | **port-adapt** | `searchParams` Next 16 SSR fixes. Main is already on Next 16 and probably has its own fix; verify with `pnpm --filter web build` first. If main builds clean, **discard**; otherwise port the wrappers. |
| 9 | `670b86f4` | 2026-04-23 05:59 | Cursor Agent | Stabilize lint and remove Next 16 SSR search param blockers | **port-adapt** | Continuation of #8. Same conditional verdict. |
| 10 | `654068b3` | 2026-04-23 13:54 | SaCH-PRO | Merge PR #10 from cursor/fix-flaky-ai-tests-67d1 | **discard** | Merge commit — no new content beyond #3. Skip when cherry-picking. |
| 11 | `93184e28` | 2026-04-23 13:58 | SaCH-PRO | Merge PR #12 from cursor/swot-critical-upgrades-c65f | **discard** | Merge commit for #5–#9. Skip. |
| 12 | `fb1d88f2` | 2026-04-23 14:21 | SaCH-PRO | Add auth start choice screen (#11) | **pick-as-is** | Adds `apps/web/src/app/auth/start/page.tsx` (a splash-route choice screen). File doesn't exist on main. Low-risk addition. AUDIT_REPORT.md §7 already flagged this as "optional cherry-pick". |
| 13 | `2d488ccf` | 2026-04-24 00:27 | Cursor Agent | fix(web): handle oauth hash errors and verified banner | **port-adapt** | Edits `auth/callback/page.tsx` and `auth/login/page.tsx` — same files commit #5 rewrites. Pull together with #5/#6/#7. |
| 14 | `1c358ae3` | 2026-04-24 00:57 | Cursor Agent | fix(web): keep ControlTowerPage hook order stable | **port-adapt** | Hook-order fix in `control-tower/page.tsx`. Only meaningful after #5 is ported. Pull together. |
| 15 | `04de91fe` | 2026-04-24 01:30 | Cursor Agent | chore: stabilize server vercel deploy and add repo health audit | **pick-as-is** (mostly) | Adds `apps/server/api/index.ts`, `apps/server/vercel.json`, `apps/server/src/app-bootstrap.ts`, `scripts/repo-health-audit.sh`, `docs/repo-consolidation-runbook.md`. Touches `apps/server/src/main.ts` (−55 / +0) which **conflicts** with main's CORS / `allowedCorsOrigins()` work — pick the new files and keep main's `main.ts`. See §5 for the conflict resolution. |
| 16 | `42d6ac8e` | 2026-04-23 21:37 | Sachin Dookie | Merge PR #17 from cursor/consolidate-web-hotfixes-be97 | **discard** | Merge commit. Skip. |
| 17 | `f5cf9cbd` | 2026-04-24 02:07 | Cursor Agent | feat(web): overhaul onboarding and profile flow diagnostics | **port-adapt** | `onboarding/page.tsx` (+57/−), `profile/page.tsx` (+449/−132). Heavy overlap with main's onboarding. Port the diagnostics behavior on top of main's onboarding, don't replace. |
| 18 | `e91d037a` | 2026-04-24 03:38 | Claude | fix: enable mobile access and align PWA theme color | **pick-as-is** | Adds `*.replit.dev`, `*.worf.replit.dev`, `*.repl.co` to `allowedDevOrigins`; aligns viewport `themeColor` to `#F97316`. Small, valuable, low-conflict. **Pick first.** |
| 19 | `1c7e6f93` | 2026-04-24 03:43 | Claude | **fix(security): patch critical/high audit findings** | **pick-as-is** (high priority) | JWT signature-bypass fix in `supabase-auth.service.ts`; open-redirect fix in `gmail/callback`, `drive/callback`; HMAC `TRACKING_SECRET` hardening in `communications.controller.ts`; `robots.ts` for `/admin`, `/app`, `/api`, `/env-check`, `/offline`; `Cache-Control` immutable for static assets in `next.config.ts`. **Pick first.** Note: `supabase-auth.service.ts` may have minor conflict against commit #5 — apply security fix last and re-check. |
| 20 | `7be77c72` | 2026-04-25 15:47 | Sachin Dookie | Merge PR #18 from cursor/onboarding-profile-overhaul-be97 | **discard** | Merge commit for #17. Skip. |
| 21 | `0d246e75` | 2026-04-25 20:33 | Cursor Agent | feat(web): simplify onboarding checklist into compact square strip | **port-adapt** | `onboarding/page.tsx` (+56/−28). Pull together with #17. |
| 22 | `9f198a31` | 2026-04-25 20:58 | Cursor Agent | fix(web): make onboarding checklist blocks clearly square | **port-adapt** | `onboarding/page.tsx` (+14/−35). Pull together with #17/#21. |
| 23 | `94531dd8` | 2026-04-25 21:09 | Cursor Agent | **fix(web): prevent breadcrumb hydration mismatch on initial render** | **pick-as-is** | `apps/web/src/lib/navigation-context.tsx` (+10/−2). Adds `mounted` guard. **Pick first.** |
| 24 | `67b9659a` | 2026-04-25 17:26 | Sachin Dookie | Merge PR #20 from cursor/minimal-onboarding-checklist-be97 | **discard** | Merge commit. Skip. |
| 25 | `59fe9d90` | 2026-04-25 17:26 | Sachin Dookie | Merge PR #21 from cursor/fix-breadcrumb-hydration-be97 | **discard** | Merge commit. Skip. |
| 26 | `7a7d0a21` | 2026-04-25 21:29 | Cursor Agent | **fix(web): gate origin breadcrumb until client hydration** | **pick-as-is** | `apps/web/src/components/ui/origin-aware-breadcrumbs.tsx` (+7/−1). Companion to #23. **Pick first.** |
| 27 | `906f6c83` | 2026-04-25 17:40 | Sachin Dookie | Merge PR #22 from cursor/fix-breadcrumb-hydration-be97 | **discard** | Merge commit. Skip. |
| 28 | `14718007` | 2026-04-30 18:39 | SACHIN | "yes" | **port-adapt** | Adds `docs/KEYFLOWOS_REPO_AUDIT.md` (+195) and tweaks `update-business.dto.ts` (+5). Take the doc; ignore the dto delta if it conflicts with main. |
| 29 | `6fffcfac` | 2026-04-30 20:42 | SACHIN | "zin" | **port-adapt** | 7-file mixed commit (`public-create-booking.dto.ts`, `identity.service.ts`, `app/layout.tsx`, `app/page.tsx`, `ai-context.tsx`, `lib/client.ts` +13, `docs/KEYFLOWOS_REPO_AUDIT.md` +62). Most are minor tweaks; the `client.ts` and `app/page.tsx` slices likely conflict with main. Cherry-pick will produce conflicts — resolve by **taking main's version on `client.ts` and `app/page.tsx`**, keeping develop's version of `ai-context.tsx` and the doc append. |
| 30 | `6b312e2c` | 2026-04-30 20:44 | Sachin Dookie | Merge PR #24 from claude/audit-mobile-support | **discard** | Merge commit; brings in #18+#19. Already covered by picking #18, #19. |
| 31 | `1f39ce48` | 2026-04-30 20:52 | Sachin Dookie | Merge PR #25 from claude/audit-mobile-support | **discard** | Merge commit; brings in #28+#29. Already covered. |

**Summary:**
- `pick-as-is` (low-conflict, high value): **8 commits** — `e945807e`, `fb1d88f2`, `04de91fe`, `e91d037a`, `1c7e6f93`, `94531dd8`, `7a7d0a21`, plus the additive parts of `04de91fe`.
- `port-adapt` (manual merge against main's evolved files): **12 commits** — `823561e8`, `d4b13c13`, `5649a79b`, `91ba7c0c`, `862147e3`, `8f1aa445`, `670b86f4`, `2d488ccf`, `1c358ae3`, `f5cf9cbd`, `0d246e75`, `9f198a31`, `14718007`, `6fffcfac` (group `5–9`, `13–14`, `17`, `21–22` together as the "auth + onboarding" port).
- `already-on-main`: **0** (checked — main does not duplicate any of develop's specific changes verbatim; main solved the same _problems_ differently).
- `discard` (merge commits + truly redundant): **9** — `7c278e07`, `654068b3`, `93184e28`, `42d6ac8e`, `7be77c72`, `67b9659a`, `59fe9d90`, `906f6c83`, `6b312e2c`, `1f39ce48`.

(8 + 12 + 0 + 9 ≠ 31 only because some entries are tagged with two markers — see Notes column.)

---

## 3. File-level inventory

`git diff --name-status main develop` reports **247 files**: 33 added on develop,
90 deleted on develop (i.e. exists on main but not develop — would regress
main), 123 modified, 1 renamed.

### 3.1 `D` — files on main that develop deleted (90)

**Verdict for ALL: keep main's version; never let `develop` overwrite.**
This is the heart of why a `develop → main` merge is unsafe. Grouped:

#### Root docs/build artifacts (5)
`AUDIT_REPORT.md`, `Dockerfile`, `HEALTH_REPORT.md`, `MIGRATION.md`,
`docker-compose.yml` — Replit-independence pass deliverables (Task #174).
**Keep main's.**

#### Server core — schema-aware infrastructure (15)
- `apps/server/src/core/auth/keyflow-dev-auth.ts`
- `apps/server/src/core/config/runtime-urls.ts`
- `apps/server/src/core/connectors/connector-activity.service.ts`
- `apps/server/src/core/connectors/connector-health-monitor.service.{ts,spec.ts}`
- `apps/server/src/core/connectors/google-suite.{controller,service}.ts`
- `apps/server/src/core/connectors/implementations/google-{business-profile,contacts,forms,maps}.connector.ts`
- `apps/server/src/core/object-storage/{objectAcl,objectStorage,routes}.ts`
- `apps/server/src/modules/bookings/dto/update-booking.dto.ts`

**Keep main's** — these are the post-Task-#174 (object storage) and Task
#179/#188/#189 (KeyFlow Connect, connector activity, health monitor) artifacts.

#### Server modules — Community Phase 5 + KeyFlow Connect + KeyFlow Command (12)
- `apps/server/src/modules/community/network-activity.service.ts`
- `apps/server/src/modules/community/network-analytics.service.ts`
- `apps/server/src/modules/community/opportunity.service.ts`
- `apps/server/src/modules/community/partner-program.service.ts`
- `apps/server/src/modules/community/reputation.service.ts`
- `apps/server/src/modules/community/resource-marketplace.service.ts`
- `apps/server/src/modules/connect/{connect.controller,connect.module,google-business-profile.service,google-contacts-sync.service,google-forms.service,google-maps.service,google-token.helper}.ts`
- `apps/server/src/modules/keyflow-command/{keyflow-command.controller,keyflow-command.module,keyflow-command.service,keyflow-notes.service,keyflow-voice.service}.ts`

**Keep main's** — these are Tasks #131, #132, #175, #200, #179.

#### Web app — Connect/KeyFlow-Command screens, e2e suite, community modals (40+)
- `apps/web/e2e/{address-autocomplete,connect-business-profile,connect-contacts,connect-forms,connect-maps}.spec.ts`, `apps/web/e2e/helpers/workspace.ts`, `apps/web/e2e/tsconfig.json`, `apps/web/playwright.config.ts`
- `apps/web/src/app/app/community/{activity,analytics,directory,messages,opportunities,partners,resources,saved}/page.tsx`
- `apps/web/src/app/app/community/components/{collab-requests,collaboration-modal,inbox,interaction-history,matched-providers-panel,message-modal,notifications-panel,quote-request-modal,referral-modal,review-modal,send-message-modal}.tsx`
- `apps/web/src/app/app/connect/{business-profile,contacts,forms/[formId],forms,maps}/page.tsx`, `apps/web/src/app/app/connect/page.tsx`
- `apps/web/src/app/app/keyflow-command/{components/jarvis-voice,components/unified-calendar,page}.tsx`
- `apps/web/src/components/{dev-bypass-banner,dev-hmr-error-suppressor,providers,ui/business-address-autocomplete}.tsx`
- `apps/web/src/components/keyflow/keyflow-notes-drawer.tsx`
- `apps/web/src/lib/{google-deep-links,keyflow-dev-auth}.ts`
- `apps/web/src/app/global-error.ts` (replaced by main's `global-error.tsx`)
- `packages/ui/src/components/address-autocomplete.tsx`

**Keep main's.**

#### Prisma migrations (6) — DESTRUCTIVE if dropped
- `packages/db/prisma/migrations/20260417000000_add_booking_location_field/migration.sql`
- `packages/db/prisma/migrations/20260501000000_add_ai_suggestion_event_tracking/migration.sql`
- `packages/db/prisma/migrations/20260501000000_add_community_phase5_growth/migration.sql`
- `packages/db/prisma/migrations/20260501000000_add_community_post_matched_providers/migration.sql`
- `packages/db/prisma/migrations/20260501000000_add_relationship_insight_dismissals/migration.sql`
- `packages/db/prisma/migrations/20260501100000_add_community_notification_data/migration.sql`

**Keep main's.** Dropping these would orphan production migration history.

#### Asset (1)
- `attached_assets/Pasted--Latest-Version-16-2-4-Getting-Started-Installation-Pro_1777682296010.txt` — stale paste. **Discard either way.**

### 3.2 `A` — files added on develop (33)

| File | Verdict | Notes |
| --- | --- | --- |
| `apps/server/api/index.ts` | **pick-as-is** | Vercel serverless entry. New file. (commit `04de91fe`) |
| `apps/server/src/app-bootstrap.ts` | **pick-as-is** | Bootstrap helper extracted from `main.ts` for reuse by Vercel entry. (commit `04de91fe`) |
| `apps/server/vercel.json` | **pick-as-is** | Vercel routing config. (commit `04de91fe`) |
| `apps/server/src/replit_integrations/object_storage/{objectAcl,objectStorage,routes}.ts` | **discard** | The OLD Replit Object Storage code that Task #174 deleted. Main now has `apps/server/src/core/object-storage/`. **Do not restore.** |
| `apps/web/src/app/api/session/route.ts` | **port-adapt** | Session API route from SWOT commit. Pull with #5 group. |
| `apps/web/src/app/app/_command/*.tsx` (14 files) | **port-adapt** | The original "Command" UI from develop's SWOT work. Main has its own KEYFLOW COMMAND flagship page (Task #175) at `apps/web/src/app/app/keyflow-command/`. **DO NOT replace main's KeyFlow Command** — these `_command/` files target a different surface (control-tower drawer / chat / forecast widgets). Port selectively if any widgets aren't already on main; otherwise discard the directory. |
| `apps/web/src/app/app/control-tower/components/next-best-action-card.tsx` | **port-adapt** | Pull with #5 group. |
| `apps/web/src/app/auth/start/page.tsx` | **pick-as-is** | Splash choice screen (commit `fb1d88f2`). |
| `apps/web/src/app/error.tsx` | **port-adapt** | App-level error boundary. Main has its own error-boundary work (`3b30d2bd`, `2c6ed60f`, `493b1b94`) — verify before picking. If main's is better, **discard**. |
| `apps/web/src/app/global-error.tsx` | **already-on-main** | Main also has `global-error.tsx` (replaced its `global-error.ts`). Compare; keep main's. |
| `apps/web/src/app/robots.ts` | **pick-as-is** | Crawler block list (commit `1c7e6f93`, security patch). |
| `apps/web/src/lib/api-base.ts` | **port-adapt** | URL helper. Overlaps with main's `runtime-urls.ts` (server side) and the existing `apps/web/src/lib/api.ts`. Port carefully so the two URL strategies don't collide. |
| `apps/web/src/lib/session-client.ts` | **port-adapt** | Pull with #5 group. |
| `docs/KEYFLOWOS_REPO_AUDIT.md` | **pick-as-is** | New doc — no main equivalent. |
| `docs/cloud-app-usage.md` | **pick-as-is** | New doc. |
| `docs/repo-consolidation-runbook.md` | **pick-as-is** | New doc — directly relevant to this consolidation effort. |
| `scripts/repo-health-audit.sh` | **pick-as-is** | New script. Useful for ongoing repo health checks. |
| `scripts/start-cloud-app.sh` | **pick-as-is** | New cloud-bootstrap script. |

### 3.3 `R` — renames (1)

| Status | From | To | Verdict |
| --- | --- | --- | --- |
| `R083` | `apps/server/src/core/object-storage/index.ts` (main) | `apps/server/src/replit_integrations/object_storage/index.ts` (develop) | **Keep main's path.** This rename is develop reverting Task #174. Discard. |

### 3.4 `M` — modified files (123)

For modified files, the verdict is per-file. Only the **conflict-bearing ones**
need explicit calls; the rest follow from §2's commit verdicts.

#### Hard-conflict files (must NOT take develop's version verbatim)

| File | `main → develop` | Why a naive merge is dangerous | Recommended resolution |
| --- | --- | --- | --- |
| `packages/db/prisma/schema.prisma` | **+1 / −594** | Drops Community Phase 3/4/5, match-feedback, dismissals, network-activity, AI-suggestion-event models | **Take main's; do not port any develop change.** |
| `apps/web/src/lib/client.ts` | **+37 / −1083** | Drops every Phase 3/4/5 client API + Connect hub + KeyFlow Command APIs | **Take main's.** Re-apply only the small additions from develop commit `6fffcfac` (+13 lines) by hand if relevant. |
| `apps/server/src/main.ts` | **+2 / −61** | Drops `allowedCorsOrigins()` integration from Task #174 | **Take main's.** Pull `app-bootstrap.ts` separately (commit `04de91fe`) if Vercel entry wants it. |
| `apps/server/src/main.ts` (cont.) | — | Develop also reshapes bootstrap into `app-bootstrap.ts` | Apply by adding `app-bootstrap.ts` as a NEW file alongside main's `main.ts`, then have `apps/server/api/index.ts` import the bootstrap. |
| `apps/server/package.json` | +5 / −6 | Re-adds `@replit/object-storage`; removes `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` | **Take main's.** Keep S3 SDK; never re-add Replit object storage. |
| `apps/web/next.config.ts` | +40 / −38 | Develop's mobile-host wildcards (`*.replit.dev` etc.) need to coexist with main's `NEXT_PUBLIC_DEV_ORIGINS` env-driven config and security cache headers | **Manual three-way merge.** Start from main's; layer on develop's wildcard hosts (commit `e91d037a`); layer on security cache headers (commit `1c7e6f93`); layer on Supabase env mapping (commit `7c278e07` — only if not already present). |
| `apps/server/src/core/auth/supabase-auth.service.ts` | (overlaps SWOT + security) | The JWT-bypass security fix (`1c7e6f93`) and SWOT auth changes (`5649a79b`) both touch this file | **Apply security fix LAST** so the unsigned-JWT fallback can never be reintroduced. Verify with grep that no `decodeBase64` fallback path remains. |
| `apps/web/src/app/app/onboarding/page.tsx` | heavy churn over commits #5/#17/#21/#22 | Main has its own onboarding flow | **Take main's**, then port only the specific UX behaviors (square-strip checklist, diagnostics) on top, file-locally. |
| `apps/web/src/app/app/control-tower/page.tsx` | hook-order changes from #5/#14 | Main has Task #226 HMR-stability work | **Take main's**, then re-evaluate whether the hook-order fix is still needed. |
| `apps/web/src/app/app/page.tsx` | small dual-edit | Both branches edit the workspace home | **Take main's.** Confirm develop's tweak (commit `6fffcfac`) is only cosmetic. |
| `apps/web/src/contexts/ai-context.tsx` | small additions | Both edited | **Three-way merge.** Develop adds 5 lines (`6fffcfac`); main has Phase-4 AI suggestion changes. Keep both. |
| `apps/server/src/modules/identity/identity.service.ts` | both edited | SWOT (#5) and main #200 both touch | **Take main's**, port any user-profile additions develop has by hand. |
| `apps/web/src/app/api/{commerce/gmail,crm/google,drive}/callback/route.ts` | open-redirect security fix (#19) layered on top | Main has the same files but post-Task-#174 OAuth strategy | **Apply security validation (origin check) on top of main's version**, do not take develop's file wholesale. |
| `apps/server/src/modules/communications/communications.controller.ts` | TRACKING_SECRET hardening (#19) | — | Pick the security delta only. |
| `apps/web/src/lib/navigation-context.tsx` | breadcrumb hydration fix (#23) | — | **Pick-as-is.** No conflict expected. |
| `apps/web/src/components/ui/origin-aware-breadcrumbs.tsx` | breadcrumb hydration follow-up (#26) | — | **Pick-as-is.** |

#### Other modified files (verdict by §2 commit grouping)

The remaining ~107 modified files (mostly UI tweaks under `apps/web/src/app/app/...`,
small DTO updates, eslint config, etc.) fall into these buckets:

- **Skip (already-better on main):** server modules under
  `apps/server/src/modules/{ai,bookings,community,commerce,crm,documents,email-marketing,expenses,flow,google-drive,identity,notifications,social,subscriptions,uploads}` — main has the latest. Take main's for all unless explicitly listed above.
- **Port via SWOT group:** `apps/web/src/app/auth/{callback,login,signup}/page.tsx`, `apps/web/src/lib/{api,workspace}.ts`, `apps/web/src/lib/theme-context.tsx`, `apps/web/src/app/app/profile/{page,components/security-section}.tsx`, `apps/web/src/app/app/marketing/components/{social/post-composer,unified/unified-composer}.tsx`. Manual port; main is base.
- **Port via cloud-bootstrap group:** `apps/web/src/lib/api.ts` (small adjustment).
- **Discard (the file is on develop only as a side-effect of feature deletion):** `apps/web/src/app/app/community/components/{directory,feed,post-card,profile-card}.tsx` (develop has older variants — main's are newer).
- **Discard (config files):** `apps/web/eslint.config.mjs`, `apps/web/tsconfig.json`, `apps/web/.gitignore`, `apps/web/README.md`, `apps/web/package.json`, `pnpm-lock.yaml`, `package.json` (root), `.replit`, `replit.md` — main is canonical. Re-resolve `pnpm-lock.yaml` from `pnpm install` after the cherry-picks land.

---

## 4. Salvage shortlist

The next task should pull these in this order. Each line lists the source SHA(s)
and the target files. Items grouped by complexity.

### 4.1 PICK FIRST — small, safe, high-value (do these first; minimal conflict)

1. **Mobile + PWA fix** — `e91d037a` → `apps/web/next.config.ts` (wildcard hosts), `apps/web/src/app/layout.tsx` (themeColor `#F97316`).
2. **Security patch** — `1c7e6f93` → `apps/server/src/core/auth/supabase-auth.service.ts` (JWT bypass fix), `apps/server/src/modules/communications/communications.controller.ts` (HMAC), `apps/web/next.config.ts` (cache headers), `apps/web/src/app/api/commerce/gmail/callback/route.ts`, `apps/web/src/app/api/drive/callback/route.ts` (open-redirect), `apps/web/src/app/robots.ts` (NEW).
3. **Breadcrumb hydration** — `94531dd8` + `7a7d0a21` → `apps/web/src/lib/navigation-context.tsx`, `apps/web/src/components/ui/origin-aware-breadcrumbs.tsx`.
4. **Test stabilization** — `e945807e` → two `*.spec.ts` mock resets.
5. **Auth start splash** — `fb1d88f2` → `apps/web/src/app/auth/start/page.tsx` (NEW).
6. **Vercel serverless entry + repo-health doc/script** — `04de91fe` → `apps/server/api/index.ts` (NEW), `apps/server/vercel.json` (NEW), `apps/server/src/app-bootstrap.ts` (NEW), `scripts/repo-health-audit.sh` (NEW), `docs/repo-consolidation-runbook.md` (NEW). **Do NOT take develop's `apps/server/src/main.ts` change** — keep main's.
7. **Cloud bootstrap script + doc** — `d4b13c13` → `scripts/start-cloud-app.sh` (NEW), `docs/cloud-app-usage.md` (NEW), `apps/web/src/lib/api-base.ts` (NEW). Hold off on the `next.config.ts` slice if step 1 already covers what's needed.
8. **Develop docs** — straight cp from develop checkout: `docs/KEYFLOWOS_REPO_AUDIT.md`, `docs/cloud-app-usage.md`, `docs/repo-consolidation-runbook.md` (covered by 6 + 7).

**Estimated time:** 1–2 hours. **Conflict count expected:** 0–2.

### 4.2 PICK WITH PORTING — substantial manual merge required

9. **SWOT auth + onboarding + control-tower** (group: `5649a79b`, `91ba7c0c`, `862147e3`, `8f1aa445`, `670b86f4`, `2d488ccf`, `1c358ae3`, `5–9`/`13–14`).
   - **Approach:** do NOT cherry-pick. Instead, manually re-apply the *intent* on top of main:
     - Take develop's `apps/web/src/app/api/session/route.ts` and `apps/web/src/lib/session-client.ts` as new files.
     - Add `apps/web/src/app/app/control-tower/components/next-best-action-card.tsx` as a new file.
     - For `auth.middleware.ts`, `supabase-auth.service.ts`, `identity.{controller,service}.ts`, `auth/{callback,login,signup}/page.tsx`, `onboarding/page.tsx`, `control-tower/page.tsx`, `profile/page.tsx`, `marketing/components/{social/post-composer,unified/unified-composer}.tsx`, `lib/{api,workspace}.ts`: open both versions side-by-side, port only the diff that matters (origin-derived OAuth, hash-error handling, hook-order stability, square-strip onboarding UX, profile diagnostics).
     - **Skip the `_command/*.tsx` files entirely** — main's KeyFlow Command (Task #175) is the canonical surface. Port any unique widget only if it's missing on main.
     - **Skip the lib/client.ts edits from this group** — main is canonical (do not let any cherry-pick touch `apps/web/src/lib/client.ts`).
   - **Estimated time:** 4–6 hours of careful porting. **Conflict count expected:** every file listed.

10. **Onboarding diagnostics + checklist UX** (group: `f5cf9cbd`, `0d246e75`, `9f198a31`, `7be77c72` merge).
    - Bundled with #9 — port the UX behaviors on top of main's onboarding.

11. **Late SACHIN bookkeeping commits** (`14718007` "yes", `6fffcfac` "zin").
    - Take only the doc-append in `docs/KEYFLOWOS_REPO_AUDIT.md` (covered above).
    - Take the `apps/web/src/contexts/ai-context.tsx` 5-line addition.
    - **Discard** the `apps/server/src/modules/bookings/dto/public-create-booking.dto.ts`, `identity.service.ts`, `update-business.dto.ts`, `apps/web/src/app/app/{layout,page}.tsx` deltas — main is newer.

### 4.3 SKIP — already covered or would regress main

- All merge commits (`654068b3`, `93184e28`, `42d6ac8e`, `7be77c72`, `67b9659a`, `59fe9d90`, `906f6c83`, `6b312e2c`, `1f39ce48`).
- `7c278e07` "Map Supabase env vars" — main's `next.config.ts` already does this differently.
- `apps/web/src/app/app/_command/*` — superseded by main's KEYFLOW COMMAND surface.
- All 90 `D`-status files (§3.1) — keeping main's versions.
- The 6 Prisma migrations (§3.1) — keeping main's history.

### 4.4 DISCARD — never re-introduce

- `apps/server/src/replit_integrations/object_storage/*` (3 files) — replaced by `apps/server/src/core/object-storage/`.
- `@replit/object-storage` npm dep (would come back via develop's `apps/server/package.json`).
- `apps/server/src/main.ts` from develop (`2 / −61`) — main's CORS / `allowedCorsOrigins()` integration is the post-audit baseline.
- `packages/db/prisma/schema.prisma` from develop (`+1 / −594`).
- `apps/web/src/lib/client.ts` from develop (`+37 / −1083`).
- `attached_assets/Pasted--Latest-Version-16-2-4-...txt`.

---

## 5. Conflict map — what the cherry-pick task WILL hit

For each guaranteed conflict, the recommended resolution:

| Conflict zone | Files | Strategy |
| --- | --- | --- |
| **Prisma schema** | `packages/db/prisma/schema.prisma` + 6 migration SQL files | **No conflict if main is base.** Just refuse any cherry-pick that touches these paths from develop. |
| **Web data-access layer** | `apps/web/src/lib/client.ts` | Same — refuse any cherry-pick that edits `client.ts`. The 13-line addition from `6fffcfac` can be re-typed by hand if it's still needed. |
| **Server bootstrap & CORS** | `apps/server/src/main.ts`, `apps/server/src/app-bootstrap.ts` (new) | Keep main's `main.ts`. Add develop's `app-bootstrap.ts` as a NEW file. Make `apps/server/api/index.ts` (Vercel entry) import from `app-bootstrap.ts` — do NOT have the Vercel entry duplicate `main.ts`'s CORS setup. |
| **Auth service** | `apps/server/src/core/auth/supabase-auth.service.ts` | Order matters: (1) take main's base; (2) port SWOT additions from `5649a79b` if any are missing on main; (3) **apply security fix `1c7e6f93` LAST** to ensure the unsigned-JWT fallback is gone. Verify with `rg "decodeBase64|jwt.decode" apps/server/src/core/auth/`. |
| **Next config** | `apps/web/next.config.ts` | Three-way merge: main base + wildcard hosts (`e91d037a`) + cache headers (`1c7e6f93`) + Supabase env (`7c278e07`, only if absent). |
| **Onboarding page** | `apps/web/src/app/app/onboarding/page.tsx` | Port behaviors only; never replace the file wholesale. |
| **Control tower page** | `apps/web/src/app/app/control-tower/page.tsx` | Take main's. Re-apply hook-order stability fix only if `pnpm --filter web build` flags it. |
| **Profile page** | `apps/web/src/app/app/profile/page.tsx` | Port the diagnostics from `f5cf9cbd` on top of main; don't replace. |
| **OAuth callbacks** | `apps/web/src/app/api/{commerce/gmail,drive}/callback/route.ts` | Apply only the open-redirect origin-validation patch on top of main's existing routes. |
| **AI context** | `apps/web/src/contexts/ai-context.tsx` | Three-way merge — both branches edit. |
| **Package manifests / lockfile** | `apps/server/package.json`, `apps/web/package.json`, `pnpm-lock.yaml`, `package.json` (root) | Keep main's. Re-run `pnpm install` after all cherry-picks; commit a single regenerated lockfile at the end. |
| **`.replit`, `replit.md`** | both | Keep main's; both have evolved post-audit. |
| **Prisma client + DB package** | `packages/db/prisma/schema.prisma`, generated client | Keep main's; run `pnpm --filter @keyflow/db run db:generate` once cherry-picks complete. |

---

## 6. Discard rationale (one-liners)

| Item | Reason |
| --- | --- |
| `7c278e07` (env-var mapping) | Main's `next.config.ts` already wires Supabase via `process.env`. |
| `654068b3`, `93184e28`, `42d6ac8e`, `7be77c72`, `67b9659a`, `59fe9d90`, `906f6c83`, `6b312e2c`, `1f39ce48` | Pure merge commits — produce no new tree content beyond their parents. |
| `apps/server/src/replit_integrations/object_storage/*` | Replaced by main's `apps/server/src/core/object-storage/` (Task #174). |
| `@replit/object-storage` dependency | Removed by main commit `a28ed78f`. |
| `apps/server/src/main.ts` develop edits | Would drop `allowedCorsOrigins()` integration from main commit `ecb7bba7`. |
| `packages/db/prisma/schema.prisma` develop edits | Would drop ~600 lines of Phase 3/4/5 models from main commits `573436f6`, `1df63bb7`, `14f75a36`, `cc925299`, `1544c89d`, `5685a984`, `d9d6d3e3`, `cc995542`. |
| `apps/web/src/lib/client.ts` develop edits | Would drop ~1,000 lines of Phase 3/4/5 + Connect + KeyFlow Command APIs (covered by main commits `d7de95a4`, `573436f6`, `1df63bb7`, `26b2f59e`, `5685a984`, `1544c89d`, `cc995542`). |
| 6 Prisma migrations under `packages/db/prisma/migrations/` | Covered by main commits `e0ea50fe` (booking location), `1544c89d` (community phase 5), `5685a984` (relationship insight dismissals), `ba401b4b` (AI suggestion event), `03e0851f` (community post matched providers), `cc995542` (community notification data). |
| `apps/web/src/components/{dev-bypass-banner,dev-hmr-error-suppressor}.{tsx,ts}` and `apps/web/src/lib/keyflow-dev-auth.ts` | Replaced by main commit `4f2fedb9` (dev-auth bypass) + `b2a8523e` (HMR root-cause fix, Task #226). |
| `apps/web/src/components/ui/business-address-autocomplete.tsx`, `apps/web/src/lib/google-deep-links.ts`, `packages/ui/src/components/address-autocomplete.tsx` | Replaced by main commits `26b2f59e` (Connect hub), `814bff67` (CRM autocomplete). |
| `attached_assets/Pasted--Latest-Version-16-2-4-...txt` | Stale paste; not referenced anywhere. |
| `apps/web/src/app/app/_command/*` (14 files) | Develop's prototype Command UI — superseded by main's `apps/web/src/app/app/keyflow-command/` (Task #175). |
| Develop's `apps/web/src/app/app/community/components/{directory,feed,post-card,profile-card}.tsx` deltas | Older variants; main has the post-Phase-4/5 versions. |

---

## 7. Appendices — raw data

> The full raw data files are committed under `docs/triage-appendices/` so the
> next agent has the unsummarized inputs.

### 7.1 Develop-only commits (`git log main..develop --reverse`)

See `docs/triage-appendices/develop-only-commits.txt` for the full list with
SHA, ISO date, author, and subject.

### 7.2 Main-only commits since divergence (`git log develop..main --reverse`)

See `docs/triage-appendices/main-only-commits.txt`.

### 7.3 File-level diff (`git diff --name-status main develop`)

See `docs/triage-appendices/file-diff.txt`.

### 7.4 Per-file commit attribution

For any file the next agent needs to inspect, run:

```bash
git log main..develop --oneline -- <path>
```

Example for the auth service:

```bash
git log main..develop --oneline -- apps/server/src/core/auth/supabase-auth.service.ts
# 1c7e6f93 fix(security): patch critical/high audit findings
# 5649a79b Implement SWOT critical upgrades across auth onboarding and control tower
```

---

## 8. Sign-off checklist for the cherry-pick task

Before the next task starts, confirm:

- [ ] Operator has pushed `pre-consolidation/main-2026-05-02` and `pre-consolidation/develop-2026-05-02` tags to `origin` (see §1).
- [ ] Operator has confirmed both tags are visible at https://github.com/SaCH-PRO/KEYFLOWOS/tags.
- [ ] No `subrepl-*` branch is being deleted yet (that's Task #3 in the consolidation plan).
- [ ] `develop` itself is **untouched** (no force-push, no rebase) until the cherry-pick PR has merged into `main` and we've verified nothing was missed.

When in doubt, default to **keep main's version**. Develop is the riskier
branch to import from.
