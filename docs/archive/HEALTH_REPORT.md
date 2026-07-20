> **Archived 2026-07-20.** Frozen point-in-time snapshot from 2026-05-02; build/lint/CVE counts described here are stale. See `SECURITY.md` for the current audit log and run the actual lint/typecheck scripts for current numbers. Kept for historical record only.

# KeyflowOS Codebase Health Report

**Date:** 2026-05-02
**Repo:** KeyflowOS (pnpm monorepo)
**Workspaces:** `apps/server` (NestJS), `apps/web` (Next.js 16), `packages/api`, `packages/db`, `packages/ui`
**Toolchain:** Node 20.20.0, pnpm 10.26.1

This report covers a full codebase health audit of the monorepo: install, type-check, lint, build, security audit, schema validation, and a runtime smoke test of both the NestJS server and the Next.js web app. All issues found within the minimum-fix scope of the task have been resolved on this branch. Items deferred (with rationale) are clearly listed at the end.

---

## 1. Install / Dependency Resolution

| Step | Result |
|---|---|
| `pnpm install` (frozen workspace) | OK — no resolution errors |
| Workspaces detected | 5 (`apps/server`, `apps/web`, `packages/api`, `packages/db`, `packages/ui`) |
| Node engine | 20.20.0 (matches workspace `engines`) |
| Package manager | pnpm 10.26.1 |

No broken or missing workspace links. No peer-dep blockers.

---

## 2. Prisma / DB Schema

| Step | Result |
|---|---|
| `prisma generate` | OK |
| `prisma validate` | OK |
| Schema drift vs. code | None observed at type-check level after fixes (see §3) |

---

## 3. TypeScript

### Initial state
- `apps/server` `tsc --noEmit`: 0 errors
- `packages/api` `tsc --noEmit`: 0 errors
- `packages/db` `tsc --noEmit`: 0 errors
- `packages/ui` `tsc --noEmit`: 0 errors
- `apps/web` `tsc --noEmit`: **5 errors** in 4 files

### Errors fixed (apps/web)
| File | Issue | Fix |
|---|---|---|
| `src/app/app/projects/components/project-detail-tabs/client-tab.tsx` | Read `contact.leadScore` / `contact.lastInteractionAt` directly | Use `contact.meta.leadScore` / `contact.meta.lastInteractionAt` (matches API contract) |
| `src/app/app/projects/components/project-detail-tabs/overview-tab.tsx` | Read `deliverable.completed` (no longer in schema) | Use `deliverable.url` presence check |
| `src/components/ai/graph-insights-panel.tsx` | Compared `severity === "critical"` against numeric type | Compare numeric: `severity >= 80` |
| `src/lib/client.ts` (~L8209) | `apiPut` call passed wrong arg shape | Updated to current `apiPut(path, body, opts)` signature |

### Final state
- All workspaces: **`tsc --noEmit` exits 0**.

---

## 4. Build

### Initial state
`pnpm --filter web build` failed during prerender:
> `useSearchParams()` should be wrapped in a suspense boundary at page "/<route>"

This is enforced by Next.js 16's stricter prerender rules.

### Pages fixed (Suspense wrappers added)
- `apps/web/src/app/app/layout.tsx` — wrapped `AppLayoutInner`
- `apps/web/src/app/auth/callback/page.tsx`
- `apps/web/src/app/auth/login/page.tsx`
- `apps/web/src/app/book/[slug]/page.tsx`
- `apps/web/src/app/pay/[invoiceId]/page.tsx`

### Final state
- `pnpm --filter server build` → **OK**
- `pnpm --filter web build` → **OK** (exit 0, all routes prerendered or marked dynamic)
- `pnpm --filter @keyflow/api build` → **OK**
- `pnpm --filter @keyflow/db build` → **OK**
- `pnpm --filter @keyflow/ui build` → **OK**

---

## 5. ESLint

`apps/server`, `packages/*` lint: **clean.**

`apps/web` lint: **1497 problems (841 errors, 656 warnings)** — all categorized as React 19 / Next 16 / strict-typing churn:

| Rule | Count |
|---|---|
| `@typescript-eslint/no-explicit-any` | 532 |
| `@typescript-eslint/no-unused-vars` | 492 |
| `@next/next/no-img-element` | 84 |
| `react-hooks/exhaustive-deps` | 76 |
| `@next/next/no-html-link-for-pages` | 4 |
| `@next/next/no-assign-module-variable` | 3 |

**Status:** Deferred. See §10. None of these block build, runtime, or type-check; they are stylistic/strictness regressions inherited from the React 19 / Next 16 / `@typescript-eslint` upgrade and require a dedicated cleanup pass that is out of scope for a health-fix audit.

---

## 6. Broken Imports / Dead Code

- No unresolved imports detected by `tsc` after fixes.
- One dead reference removed: `apps/server` had a stray comment-only reference to `@google-cloud/storage`, which was an unused dependency. Package removed; no functional change.
- No other dead modules detected within the audit budget.

---

## 7. Security Audit (`pnpm audit`)

### Initial
- **2 critical**, **28 high**, plus moderate/low.

### Patches applied (this branch)
| Workspace | Package | From → To | Reason |
|---|---|---|---|
| `apps/web` | `jspdf` | older → `^4.2.1` | Critical advisory (transitive `dompurify` mXSS) |
| `apps/web` | `next` | `^16.1.x` → `^16.2.4` | Multiple high-severity advisories in older 16.x; also resolves runtime issue noted in §9 |
| `apps/server` | `multer` | `<2.0` → `^2.1.1` | Critical: multipart DoS / path traversal |
| `apps/server` | `express-rate-limit` | older → `^8.4.1` | High: bypass via header normalization |
| `apps/server` | `@google-cloud/storage` | (removed) | Unused; only referenced in a comment |
| `apps/server` | `xlsx` → `exceljs@^4.4.0` | (replaced) | High: prototype pollution / ReDoS, no upstream fix. Migrated CRM import + marketplace import/export to maintained `exceljs`. |

### Final
`pnpm audit` summary: **0 critical, 23 high, 26 moderate, 1 low.**

The remaining 23 high-severity advisories are **transitive** and have no upstream patch yet, or are in dev-only tooling. Specifically:
- `xlsx` — server-side usage migrated to `exceljs` (`apps/server`). The `apps/web` workspace still imports `xlsx` dynamically in two places; tracked as a follow-up to migrate the browser bundle.
- Transitive deps inside `@paypal/*` SDKs, `prisma` engine downloader, `storybook`, `vitest`, `google-auth-library` — all pending upstream releases.

These are listed in `.local/audit/audit-high.json` for follow-up.

---

## 8. Runtime Smoke Test

### Server (`apps/server`)
- Started via `pnpm dev` on port 3001.
- `GET /` → **200**
- `GET /crm/health` → **200 OK**
- `GET /ai/health` → **200 OK**
- No global API prefix; controllers are namespaced (e.g. `/crm/*`, `/ai/*`).

### Web (`apps/web`)
After clean rebuild:
- `next start -p 5000` boots in ~290ms.
- `GET /` → **200**
- `GET /pricing` → **200**
- `GET /env-check` → **200**
- Process remains healthy under request load (no crash on first request).

### Notable runtime issue resolved
The first attempt to `next start` after the security bump crashed immediately with:
> `TypeError: Cannot read properties of undefined (reading 'map') at setupFsCheck`

Root cause: the `.next` build artifact on disk was produced by Next 16.1.x and was missing the `onMatchHeaders` field in `routes-manifest.json`, which Next 16.2.x's `setupFsCheck` requires. **A clean rebuild (`rm -rf apps/web/.next && pnpm --filter web build`) regenerates a manifest containing `onMatchHeaders: []` and the server starts and serves traffic correctly.**

This is documented here so future Next minor-version bumps remember to wipe `.next` to avoid the same failure mode.

---

## 9. Summary Table

| Category | Found | Fixed | Deferred |
|---|---|---|---|
| TypeScript errors | 5 (web) | 5 | 0 |
| Build failures (prerender) | 5 routes | 5 | 0 |
| Critical CVEs | 2 | 2 | 0 |
| High CVEs | 28 | 5 | 23 (no upstream patch) |
| ESLint errors (web) | 841 | 0 | 841 (React19/Next16 strictness) |
| ESLint warnings (web) | 656 | 0 | 656 |
| Broken imports | 0 | 0 | 0 |
| Dead deps | 1 (`@google-cloud/storage`) | 1 | 0 |
| Schema drift | 0 (post-fix) | — | 0 |
| Runtime crashes | 1 (web `setupFsCheck`) | 1 | 0 |

---

## 10. Deferred Work (Recommended Follow-ups)

1. **Web lint cleanup (~1500 issues).** Bulk-driven by React 19 hook rules and the new `@typescript-eslint` defaults flagging existing `any` usage. Tackle in a dedicated PR with codemods (`@typescript-eslint/no-explicit-any` → typed unknowns, `react-hooks/exhaustive-deps` → audit-then-suppress per call site).
2. **Replace `xlsx` in `apps/web`.** Server-side usage has been migrated to `exceljs`. The web app still imports `xlsx` dynamically in `apps/web/src/lib/contacts-export.ts` and `apps/web/src/app/app/marketplace/components/inventory-command-center.tsx`; migrate those call sites to `exceljs` to fully retire the dependency.
3. **Transitive high-severity advisories** (PayPal SDK, Prisma engine downloader, Storybook/Vitest dev deps, google-auth-library): track upstream releases and bump when available.
4. **`<img>` → `<Image />`.** 84 occurrences flagged by `@next/next/no-img-element`. Wins on LCP/CLS; mechanical change but needs visual QA.
5. **Branch handoff (`replit-work`).** This environment's rules of engagement forbid running `git` commands directly. The intended branch operation is:
   ```
   git checkout -b replit-work
   git push -u origin replit-work
   ```
   This must be performed by an operator (or via the platform's git UI) once these fixes are merged.

---

## 11. Final Verification

| Check | Command | Result |
|---|---|---|
| Install | `pnpm install` | OK |
| Prisma | `pnpm --filter @keyflow/db prisma generate && prisma validate` | OK |
| Type-check (all workspaces) | `pnpm -r exec tsc --noEmit` | **0 errors** |
| Build server | `pnpm --filter server build` | OK |
| Build web | `pnpm --filter web build` | OK |
| Build packages | `pnpm --filter "@keyflow/*" build` | OK |
| Audit | `pnpm audit` | **0 critical** (23 high deferred, see §7) |
| Server runtime | `pnpm --filter server dev` + curl smoke | 200 on `/`, `/crm/health`, `/ai/health` |
| Web runtime | `pnpm --filter web start` + curl smoke | 200 on `/`, `/pricing`, `/env-check`; process stable |

**Overall status: HEALTHY for build/type/runtime; lint hygiene and remaining transitive CVEs deferred to follow-up tasks per §10.**
