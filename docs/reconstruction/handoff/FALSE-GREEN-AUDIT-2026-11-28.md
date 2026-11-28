# False-green audit, 2026-11-28 (D-331)

Owner directive D-331: "no false green anywhere". Four independent read-only audits of origin/main `c950dd11`, plus a
GitHub settings audit (D-332). This file is the record. Each finding below is a board row on `coord/board`, and each
is launch-track and blocking (D-331 item 4). Rows marked **server** belong to the server lane (D-297). All other rows
belong to the Claude lane.

## CRITICAL: live product defects that the audit found behind green tests

| Board | Lane | Finding |
|---|---|---|
| FG-SEC-ATRISK-PRIVATE | server | `test/money-signals.integration.test.ts:1598` is an `it.todo` that stands in for a live leak. `listAtRisk` (crm-relationship-health.service.ts:253-273) filters only by business, with no visibility clause, so a STAFF member is served another member's PRIVATE contact (id, name, email, phone). |
| FG-SEC-TIMELINE-TENANT | server | `test/memory-eval-leak.integration.test.ts:2240-2261` has 8 `it.todo` entries for missing tenant predicates. One is confirmed live: `BusinessEventService.getTimeline` queries `{subjectType, subjectId}` with no businessId. |
| FG-SEC-CONTACTDETAIL-ITFAILS | server | `packages/api/src/routers/crm.contact-detail.spec.ts:292,299,306` use `it.fails` [RED] for the tRPC contactDetail visibility hole. `it.fails` passes on any throw, so these tests don't prove the hole is still open, and they don't fix it. |

## CRITICAL: gates that pass without checking

| Board | Lane | Finding |
|---|---|---|
| FG-SHARD-SKIP-TODO | server | `scripts/ci/verify-vitest-shards.mjs:158,183` rejects only `failed` and `pending`, so `skipped` and `todo` pass. Any `it.skip`, `skipIf`, `ctx.skip()` or `it.todo` in any server suite keeps CI green. About 24 todos exist, some on security. |
| FG-DB-PKG-TESTS | server | `packages/db` specs (`token-encryption.spec.ts`, `token-encryption.kdf-cache.spec.ts`, OAuth token encryption) run in no CI job. |
| FG-ETHICS-CACHE-VACUOUS | server | `key-cortex-ethics.service.spec.ts:76` claims "one tenant cannot serve another's verdict" but asserts only `toBeDefined()`. |
| FG-E2E-NEVER-RUN | Claude | `e2e-live.yml` has never run (0 runs). It holds release0-live, harness-self-check and every journey, so no v1 journey has ever run automatically. Its journey step is also `continue-on-error`. The gating Playwright job runs 25 tests, of which only 5 drive a browser. 38 sweeps and several specs run nowhere. |

## HIGH

| Board | Lane | Finding |
|---|---|---|
| FG-AGENT-CONTROL-WAVE | Claude | The required `agent-control` check passes on every `wave/*` PR and on merge_group without checking anything. No check enforces the two-review rule. |
| FG-GATE-FILES-OWNERS | owner | No review rule on main. A PR can edit its own gate files (ci-cd.yml, census specs, ledgers). This needs a code-owner review rule for `.github/**`, `scripts/ci/**`, `scripts/proof-admission/**`, `scripts/os/ledger-sizes.mjs` and the tsconfig/eslint files (D-332 item 3). |
| FG-MAIN-FLAKES | server | Push runs on main go red after a green merge_group: `invoice-status-events` A9-R2 race and `contact-custom-field-names-tenant` CFN-X01. Nothing blocks or records this. |
| FG-SERVER-TESTS-UNTYPED | server | `apps/server` tsconfig and eslint exclude all 1,048 test files, so tests are never type-checked or linted. |
| FG-UNIT-GUARD-NOT-IN-CI | server | CI runs no server spec under `vitest.unit.config.ts`, so the no-network guard never runs, and `unit-network-guard.spec.ts:282` (`runIf`) is skipped. |
| FG-SERVER-VACUOUS | server | Vacuous or conditional checks: `key-cortex-creativity.service.spec.ts:81` (`if (called.length)`), `role-tool-reachability.spec.ts:89,154` (early return), `key-cortex-self-model.integration.test.ts:428,438` (`if (buildSpy)`), and the authority todos `sweep-census-families:266-267` and `key-cortex-organ-tool-authority:361`. The `it.fails` cases in `plan-executor-approval-resume` (365-500) pass on any failure. |

## MEDIUM

| Board | Lane | Finding |
|---|---|---|
| FG-RELEASE0-EXIT3 | Claude | `ci-cd.yml:866-874` rewrites proof:release0 exit 3 (NOT MET) to exit 0 with a warning. `release0.mjs:100` counts only OPEN, and a V1-SCOPE "explained" entry needs no ruling and is not a ledger. |
| FG-DEPLOY-GATE | server | `scripts/deploy.sh:397-436` gates production on the "Run Tests" check only, not on "CI verdict". It also hard-codes `SaCH-PRO/KEYFLOWOS`. |
| FG-LINT-NOT-GATING | Claude | Lint is outside the CI verdict and not required. |
| FG-WEB-TYPES-GAPS | Claude | `apps/web/tsconfig.json` excludes `.next`, so `.next/types/**` is never type-checked. `apps/web/e2e` is neither linted nor type-checked, although an eslint comment claims it is. |
| FG-WEB-TESTS | Claude | `use-products-switch-r5.test.tsx:95,108` swallow with `.catch(() => {})` on a tenancy test. 54 files silence `console.error` and never check it. In `trust-copy-true-only-r6/r7`, the "every option opened" loops can open nothing. `use-store-data-inventory-scope.test.tsx:67` makes an absence check with no wait. The `trust-badges-true-only` and `customer-page-honesty` absence checks have no positive check that anything rendered. |
| FG-E2E-SPECS | Claude | `public-flows` and `sweep-public-quote` mock `api.test.local` but don't skip in live mode. `g-sell-online:324` uses `.catch(() => {})` on an expect. In `b-catalog:280`, the photo step passes green when the field is absent. `journey-text.ts:24` `amountAfter` reads "(30d)" as 30. Mocked CI uses `retries: 1`. The `ci-cd.yml:580` comment is wrong. `sweep-expense-receipt` has a permanent `fixme`. |
| FG-STATUS-MJS | Claude | `scripts/agent-memory/lib.mjs:62-73,350`: status.mjs marks a packet done from a RED-only commit, or from any fix subject that names it. It reads commit subjects, not trees. |
| FG-CI-MISC | server | TruffleHog runs `--only-verified`. Divergence checks accept expired overrides with only a warning. The ledger census finds ledgers by phrase only. The script-spec census credits non-gating jobs. |

## GitHub (D-332)

| Item | Status |
|---|---|
| Secret scanning + push protection | **On** (verified via API, 16:35 UTC). Validity checks and non-provider patterns are still off. |
| Dependency graph, Dependabot alerts, security updates | Off, with the owner. Then triage the Dependabot PRs #203 to #213. |
| Private vulnerability reporting, CodeQL default setup | Off, with the owner. |
| `main: merge queue` ruleset: review rule, conversation resolution, code owners for gate files | With the owner. |
| Copilot review ruleset | A false green: every review is "unable to review: insufficient quota". Fund it or disable it, with the owner. |

## Journey failures on main (D-331 item 4), classified

These are product gaps unless marked otherwise. They are tracked under P247 and P278.
- **B:** B1 has no tax field on the product form. B2 has no "New service" door. B3 has no service in the pickers. B7 on phone: the bottom nav covers "Apply Template".
- **D:** D7 has no owed or revenue figures on Money or Today.
- **E:**
  - E2: decimal quantity 2.5 is saved as 2.
  - E4: the web has no VAT number field.
  - E6: the invoice detail has no WhatsApp share.
  - E7: a paid invoice has no receipt link.
  - E8: copy only, now ruled by D-333 ("I've paid by bank transfer").
- **F:**
  - F1 and F6: no staff name, and raw ids show.
  - F3: PayPal is offered for TTD without keys.
  - F4: the deposit is hidden.
  - F7: the booking detail has no status actions, and cancelling doesn't record who cancelled.
- **G:**
  - G1: no stock state on the store.
  - G3: the cart goes over stock.
  - G4: the checkout methods don't match.
  - G7: there is no Orders tab.
  - G8: an offline store shows "Page Not Found".
  - G9: the frame headers block the embeds.
- **H:**
  - H1: no "Owed to you" figure, and the spec misreads "(30d)".
  - H3: pending claims aren't listed.
  - H9: the accountant panel isn't role=dialog.
- **J:** J10 has no staff explainer and no Team link.
- **`public-flows` (live mode):** a harness issue (FG-E2E-SPECS).
