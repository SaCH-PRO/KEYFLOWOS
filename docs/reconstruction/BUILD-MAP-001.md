# KEYFLOWOS Build Map 001

```yaml
document_id: BUILD-MAP-001
companion: docs/reconstruction/BUILD-QUEUE-001.json   # machine-readable queue; this file explains it
prepared: 2026-10-31
working_branch: claude/elegant-curie-7azpsb
branch_head_at_writing: 87ca2b90   # 9c1163c1 + merge of R0-CT-03 (42 commits ahead of main)
main: b1948d27
authority: build plan only. No merge to main, no production access, no provider traffic, no PR closed or merged.
review_status: PENDING_CHATGPT_REVIEW
```

This map turns three condensed family maps (product domains, programme corpus, open-PR triage) into one ordered, tests-first build queue. It was also checked against these sources:

- **Scope and constitution:** `V1-MODULE-SCOPE.md` and `VOLUME-01-CONSTITUTION.md` (origin/docs/keyflow-reconstruction-20261029).
- **Wave board:** origin/docs/keyflow-intelligence-foundation.
- **Release 0 target:** issue #186, read through the REST API.
- **Revenue test contract:** `REVENUE-AUTH-NEGATIVE-CONTROLS-001.md`, revision 2.
- **Live repository state at writing:** the branch log, the in-flight packet branches, and the latest local journey run.

**Rules applied to every packet:**

- **Code reuse.** Reuse existing modules. No rewrites, no new providers, and no schema migration unless the packet proves one is unavoidable. Each migration packet (two in total) is isolated in its own main-tree group.
- **Tests and proof.**
  - Tests are written first and committed before the fix.
  - Every defect fix records a pre-fix red result at an exact SHA.
  - Every money packet asserts ledger rows (balanced postings, posting counts, or "nothing posted").
- **Deferred work.** Deferred items stay in the V1+ backlog with their sources. Nothing is deleted.

---

## (a) Current state per domain

State is described at branch head `87ca2b90`, not at main. Every product fix since main (`b1948d27`) is on the branch only and unadmitted. The 42 branch commits include:

- Contacts visibility (PR #190 code).
- KF-REVENUE-AUTH-PROJECTION-001.
- The Release 0 journey harness.
- R0-D1, R0-D2, R0-D3, R0-D6 and R0-D7.
- R0-QI-01 and R0-CT-03.

| Domain | State on the branch | Evidence | Open gaps, each with its packet |
|---|---|---|---|
| Auth, business, tenancy | **Works at API level; real-DB proven.** The guard chain is AuthMiddleware (local HS256 or Supabase) → AuthGuard → BusinessGuard → ModuleScopeGuard → TenantInterceptor. Genesis writes the Business and one founding OWNER membership atomically. Bootstrap is a Serializable find-or-create. | `core/auth/request-business-id.ts`; `test/tenant-founding-membership.integration.test.ts`; journey steps 1 and 6 | No sign-in path works without Supabase (M02): R0-14, gated on D-02. No business selection (M03): R0-18. Config PATCH has no settings scope, and a SUPER_ADMIN email is seeded on every boot (M04): R0-09. Interceptor resolves the tenant by truthiness (CF-24): R0-05. Invite and JobRole ceilings (CF-26/27): V1-07, V1-21. |
| Cockpit and web shell | **Routes render; the browser journey is blocked at onboarding.** `useGenomeGate` (mounted at `app/layout.tsx:41`) sends every new owner to an LLM-only chat page. | `hooks/use-genome-gate.ts:61-121`; `app/app/onboarding/page.tsx` | No manual onboarding path (M07): R0-06. A 403 renders as empty data and calls silently default to `biz_demo` (M09): R0-15. Dead deep links and no Invoices/Quotes nav entry (CF-20/21, M08): R0-08. Cockpit turns a failed source into zero (CF-19): R0-10. No web Release 0 test, and no Playwright in CI (M58): R0-23, R0-25. D-2 sprawl: V1+. |
| Contacts | **CRUD plus record visibility on list, detail and dossier are proven.** 28 real-DB cases cover visibility. Duplicate email or phone answers 409. Contact mutations record the acting user (R0-CT-03 at `87ca2b90`). | `test/contacts-visibility.integration.test.ts`; `test/crm-contact-duplicate.integration.test.ts`; `test/contacts-audit-actor.integration.test.ts` | Cross-tenant reads of custom-field values and flow-run steps, plus route shadowing (M14/M15): R0-12. DELETE, denial and validation lack real-DB proof (CF-03): R0-13. 14 sibling reads check the tenant only (M13): V1-08. A soft-deleted holder blocks re-creating the contact (M12): V1-17. tRPC paths (M06): V1-26. Purge honesty (CF-48): V1-38. |
| Quotes and invoices | **Invoice create, issue and detail are tenant-bound and scope-checked.** Errors answer 404/409/400 (revenue auth, R0-D3, R0-QI-01). Public bare-id reads are redacted and rate-limited. | `commerce.controller.ts:355-399,466-468`; `test/revenue-authorization.integration.test.ts`; `test/commerce-invoice-errors.integration.test.ts` | Unguarded quote detail: R0-04, in flight. Quote status route has no scope and no state machine (M21): R0-28. Create validates nothing, and quote/convert answer 500 (M19): R0-27. Conversion drops the quote's tax (M20): R0-29. No provider-free quote link (CF-16): R0-30. Numbering and create idempotency (M22): V1-43, V1-45. Writers bypass the lifecycle (CF-39): V1-42. Recurring guard: V1-12. |
| Payments and ledger | **The core is sound.** The 8-state machine, `computeBalance`, balanced idempotent posting, and a payment row plus posting in one transaction all work. The COA seed race is fixed (R0-D1), and manual-payment idempotency is server-side (R0-D2). Journey step 4 is green with balanced entries. | `invoice-workflow.service.ts`; `finance/posting.service.ts`; `test/commerce-payment-idempotency.integration.test.ts`; journey step 4 | Payment actor: R0-11, in flight. DRAFT payments are accepted, reconcile runs outside the transaction, and refund errors are swallowed (M27): R0-17. Mark-paid writes an unposted payment (CF-09): R0-20. The web sends no idempotency key, and the modal sums every payment status (M26/M29): R0-21. Refunds subtract twice (M28): V1-29. Float precision (M23): V1-22. Currency (CF-38): V1-37. Ledger write door (CF-40): V1-15. Cash position (CF-41): V1-34. Credit notes (CF-42): V1-44. Payment sits outside the tenant extension (M31): V1+. |
| Public commercial | **Token invoice view, token quote view and token accept work.** The bare-id invoice read returns a redacted projection, and the status route returns five keys. | `commerce.controller.ts:724-760`; `test/commerce-public-quote.e2e.test.ts` | Payment intent flips the invoice to PENDING, which hides it (CF-12): R0-22. The link shows no paid/remaining, and tokens are cuids (CF-18, M34): R0-24. No customer receipt (M24): R0-26. The bare-id pay page downgrades every token (M34): V1-46. WiPay and PayPal callbacks (M35): V1-05. |
| Storefront, site, portal | **Presence plus `/book` work and honour `storeEnabled`** (CF-56). | `site.service.ts:145-151` | CONFIRMED emits "paid", and F206 creates a second invoice (M37): V1-18. Checkout retries and CASH completion: V1-33. Public projections (M36): V1-23. Portal grant and inert rate limiter (M38): V1-14. Portal web route and KEYPORTAL backlog: V1+, gated on D-18. |
| Bookings | **REST routes, overlap guard, real-DB waitlist and calendar projection.** | `bookings.service.ts:556-679`; `test/booking-waitlist.integration.test.ts` | Core tests are mock-only, and the in-app path lacks parity with the public one (M40/M41): V1-06. Slot race and timezone: V1-16. Writers bypass the guard: V1-27. Settlement, `paymentStatus`, and the dead confirm hook (M42): V1-28. |
| KEY | **Optional on the server but mandatory in the browser.** The journey runs with `AI_DISABLED=1`; browser onboarding requires KEY (see the cockpit row). | journey step 7; M07 | Fail-open autonomy and batch replay (M45): V1-02. Client-supplied principal and the autonomy-profile kill switch: V1-03. Oversight selective failure: V1-04. `/key/command` governance (M44): V1-09. Planner and idempotency claims: V1-10, V1-19. Audit tenant: V1-11. Kill switches (M47): V1-24. Confirm binding and proposal claim (M46): V1-31, V1-32. |
| Flows and events | **Four event stores and no canonical feed.** One payment writes four Activity rows, the payment audit row is labelled `invoice.create`, and the business feed is not mounted. | `flow/activity-event.listener.ts:58-77`; `business-event.interceptor.ts:322-359` | Evidence baseline and audit row: R0-19. Business feed: V1-25. Poller claim: V1-35. D-1 execution authorities: V1+. |
| Data model and infra | **The tenant extension is real-DB tested.** Lanes disagree on its model count (77 vs about 330); this map did not re-count. Soft delete covers 14 of the 33 models that have `deletedAt`. No migration drift gate. | `packages/db/src/client.ts`; `test/tenant-scope-extension.integration.test.ts` | Covered by the money and contacts packets above. Soft delete, drift gate and FTS trigger: V1+. |
| CI, proof, harness | **CI runs real Postgres and Redis with an unfiltered suite.** Security scans cannot fail the build. K12 binds only its self-test. The journey harness has no `it.fails`. | `.github/workflows/ci-cd.yml:187-219,419-452`; `scripts/proof-admission/manifests/` | Release 0 manifests and local runner: R0-16. Playwright: R0-25. Secret scan: V1-01. Native DAST and gate: V1-13, V1-30. verify-up: V1-20. Runtime pin: V1-39. Census and log redaction: V1-40. |
| Programme and control | **42 unadmitted commits.** PR #190's exact-head merge grant is outstanding. `.agent-control` files describe the contacts pilot at `6a5c0c3f`. The wave law conflicts with issue #186. ACTION-001 is merged (PR 147) but the board records it as CHARACTERIZING. The deploy target is contradictory. | `.agent-control/active-packet.yaml`; wave board lines 12-16 | R0-01 handles the control files. D-01, D-20 and D-23 need rulings. |

---

## (b) Release 0 journey status (issue #186, seven steps)

**Evidence base.** The latest recorded local run of `apps/server/test/release0-journey.integration.test.ts` is **27/27 passed**. That run was on `pkt/R0-CT-03-CONTACT-AUDIT-ACTOR` at `db4ee154` (that is, `9c1163c1` plus two CRM commits), on 2026-10-31 at 12:37 UTC. The harness spawns the built server against real Postgres and Redis, with `AI_DISABLED=1` and no provider keys.

This author did not run the suite at exact `9c1163c1` or `87ca2b90`. In-flight integration runs share the `r0_` fixture prefix on the main-tree database, and a concurrent run would have corrupted theirs. The exact-head run is owed by R0-02.

| # | Step | API (built server, real DB) | Customer UI | Verdict | Remaining gaps |
|---|---|---|---|---|---|
| 1 | Register or log in securely; create or select a business; tenant isolation | PASS (4 cases): bootstrap creates User, Business and one OWNER membership; discovery; idempotent re-run; a disjoint second tenant | **FAIL.** Signup and login need a reachable Supabase project (M02). A new owner lands on an LLM-only onboarding page (M07). Business selection is implicit (M03). | **FAIL in UI (first failing step)** | R0-14 (D-02), R0-06 (D-03), R0-18, R0-05, R0-09 |
| 2 | Create and edit a contact | PASS (2 cases): create, edit, reload by id. Visibility has 28 cases, a duplicate answers 409, and the actor is recorded (R0-CT-03). | UNPROVEN: no web test renders contacts, and a 403 shows as an empty book (M09) | PASS on API, UNPROVEN in UI | R0-13, R0-12, R0-15, R0-23 |
| 3 | Create and issue an invoice or quote | PASS for invoices (3 cases): DRAFT with two items; SENT with number, total and sentAt; AR posted per accounting basis. Quotes have no real-DB proof; the bare-id quote detail is unguarded (fix in flight) and the status route has no scope or state machine. | UNPROVEN | PASS for invoices. The quote branch fails on authorization. | R0-04, R0-27, R0-28 to R0-30 (D-04) |
| 4 | Record an offline/manual payment safely and idempotently, with a correct balance and audit trail | PASS (5 cases): 100 paid of 250 gives PARTIALLY_PAID with balanced entries; a duplicate submit is absorbed; paying the remainder gives PAID with a second posting | UNPROVEN: the web sends no idempotency key, and the modal counts PENDING and FAILED rows as paid (M29) | **PARTIAL.** The audit trail fails: `recordedBy` is never written and BusinessEvent records `invoice.create`. A DRAFT invoice accepts the payment, then answers 409 after commit. Mark-paid writes no posting. | R0-11, R0-17, R0-19, R0-20, R0-21 |
| 5 | Inspect contacts, invoices and payments in the UI; refresh without data loss | PASS (1 case, simulated refresh through the list routes) | UNPROVEN: no jsdom or browser proof, Playwright is not in CI, and step 1 blocks the browser. Deep links dead-end (CF-21). The public link shows no paid/remaining, and there is no customer receipt. | UNPROVEN | R0-08, R0-10, R0-23, R0-25, R0-24, R0-26 |
| 6 | A user without rights cannot read or modify another tenant's objects | PASS on every journey resource (7 cases): 403 on business-prefixed routes, 404 on foreign ids, redacted public reads, tenant state byte-identical afterwards | n/a | **PARTIAL.** Two cross-tenant reads outside the harness are confirmed in code (custom-field values and flow-run steps, M14). The interceptor truthiness case (CF-24) has not been run. | R0-12, R0-05 |
| 7 | No unapproved paid external API; optional services fail visibly | PASS (1 case) for the API journey | **FAIL.** Browser onboarding needs an LLM, and sign-in needs Supabase. | **PARTIAL.** No test shows send-email or AI failing visibly. Production boot needs Resend and the Supabase service role when email verification is on (CF-35). No cost ledger exists. | R0-07, R0-06, R0-14 |

**First failing step: step 1, in the customer UI.** A fresh owner cannot sign up without a Supabase project, and once signed in cannot leave onboarding without a paid LLM. At the API level no step fails. However, step 4's audit-trail clause and step 6's two out-of-harness cross-tenant reads fail by code inspection; they are recorded as failing, not as passing.

---

## (c) Ordered packet queue

The authoritative queue is `docs/reconstruction/BUILD-QUEUE-001.json` (76 packets: 30 in R0, 46 in V1). In the "write set" and "tests first" columns, `+` marks a file the packet creates; other files exist at `87ca2b90`. Full paths, red/green proof lines and rationale are in the JSON. In `depends_on`, `D-xx` refers to an owner decision in section (g).

**Status at writing:**

- LANDED on the branch, admission proof only: R0-01, R0-02 and R0-03.
- IN FLIGHT on packet branches: R0-04 (`pkt/R0-PC-01-QUOTE-DETAIL-TENANT-ROUTE-repair`, `4544062d`) and R0-11 (`pkt/R0-PL-07-PAYMENT-ACTOR`, `92567959`).
- QUEUED: everything else.

| Order | Id | Title | Wave | Depends on | Group | Write set | Tests first | Hours |
|---|---|---|---|---|---|---|---|---|
| 1 | `R0-01-CT-RECONCILE` | Contacts correction: reconcile the branch fix with PR #190's accepted semantics and record admission proof | R0 | — | R0-G1 | 4 files: contacts-visibility.integration.test.ts, +contacts-visibility.json, active-packet.yaml, claude-return.yaml | contacts-visibility.integration.test.ts, +contacts-visibility.json | 3 |
| 2 | `R0-02-REV-AUTH-CONFORM` | Revenue authorization: conformance of the landed KF-REVENUE-AUTH-PROJECTION-001 against REVENUE-AUTH-NEGATIVE-CONTROLS-001 rev 2, with exact-head proof | R0 | — | R0-G1 | 2 files: revenue-authorization.integration.test.ts, +revenue-auth-001.json | +revenue-auth-001.json, revenue-authorization.integration.test.ts | 4 |
| 3 | `R0-03-CT-AUDIT-ACTOR` | Contact mutations record the acting HTTP user (R0-CT-03, landed on the branch at 87ca2b90; post-merge proof) | R0 | — | R0-G1 | 4 files: crm.controller.ts, crm.service.ts, contacts-audit-actor.integration.test.ts, crm.e2e.test.ts | contacts-audit-actor.integration.test.ts, crm.e2e.test.ts | 2 |
| 4 | `R0-04-QT-DETAIL-ROUTE` | Tenant-bound quote detail route; the bare-id GET commerce/quotes/:quoteId is retired to 404 (R0-PC-01, in review) | R0 | — | R0-G1 | 6 files: commerce.controller.ts, commerce.service.ts, commerce-authorization.e2e.test.ts, +commerce-quote-visibility.integration.test.ts, +client.quote-detail.test.ts, client.ts | +commerce-quote-visibility.integration.test.ts, commerce-authorization.e2e.test.ts, +client.quote-detail.test.ts | 2 |
| 5 | `R0-05-ID-REALDB-TENANT-ALIGN` | Identity guard-chain real-DB suite (deleted/banned/revoked, removal and role-change freshness) and TenantInterceptor on the guards' string-only resolver | R0 | — | R0-G1 | 5 files: +identity-boundary.integration.test.ts, +identity-fixtures.ts, tenant.interceptor.ts, +tenant.interceptor.spec.ts, tenant-membership-boundary.integration.test.ts | +tenant.interceptor.spec.ts, tenant-membership-boundary.integration.test.ts, +identity-boundary.integration.test.ts | 8 |
| 6 | `R0-06-WEB-ONBOARD-MANUAL` | Manual (non-AI) onboarding completion and a fail-open genome gate | R0 | D-03 | R0-G1 | 8 files: onboarding/page.tsx, key-onboarding-chat-view.tsx, +manual-setup-step.tsx, use-onboarding.ts, onboarding-concierge.ts, use-genome-gate.ts, +onboarding-manual-path.test.tsx, +use-genome-gate.test.ts | +onboarding-manual-path.test.tsx, +use-genome-gate.test.ts | 8 |
| 7 | `R0-07-OPTIONAL-SVC-VISIBLE` | Optional services fail visibly and independently: Gmail send paths and AI dispatch answer 503, /readyz probes Redis, declared cost ledger | R0 | — | R0-G1 | 8 files: redis.service.ts, app.controller.ts, +app.controller.spec.ts, gmail.service.ts, model-gateway.service.ts, model-gateway.service.spec.ts, +optional-services-fail-visibly.integration.test.ts, +COST-LEDGER-001.md | +app.controller.spec.ts, model-gateway.service.spec.ts, +optional-services-fail-visibly.integration.test.ts | 6 |
| 8 | `R0-08-WEB-NAV-LINKS` | Cockpit navigation: Invoices and Quotes entries, direct cockpit target, payments-to-invoice deep links, settings links, label agreement | R0 | D-09 | R0-G1 | 10 files: nav-config.ts, semantic-routes.ts, desktop-sidebar.tsx, payments/page.tsx, upgrade-prompt.tsx, upgrade-modal.tsx, addon-pack-gate.tsx, revenue-setup-drawer.tsx, link-targets.spec.ts, +nav-labels-agree.spec.ts | link-targets.spec.ts, +nav-labels-agree.spec.ts | 6 |
| 9 | `R0-09-ID-HARDEN` | Business config writes need settings scope; onboardingComplete leaves the generic PATCH; env-gated SUPER_ADMIN seed; throttled check-username | R0 | D-11 | R0-G1 | 8 files: identity.controller.ts, identity.service.ts, update-business.dto.ts, seed.service.ts, +seed.service.spec.ts, .env.example, +identity-business-config.integration.test.ts, identity-signup.e2e.test.ts | +identity-business-config.integration.test.ts, +seed.service.spec.ts, identity-signup.e2e.test.ts | 7 |
| 10 | `R0-10-COCKPIT-TRUTH` | Cockpit minimal truth: per-source status, Release 0 result counts, degraded banner, real-DB snapshot step | R0 | — | R0-G1 | 7 files: business-command-center.service.ts, business-command-center.types.ts, business-command-center.service.spec.ts, business-command-center.ts, command-center/page.tsx, newly-reachable-screens-mount.test.tsx, release0-journey.integration.test.ts | business-command-center.service.spec.ts, newly-reachable-screens-mount.test.tsx, release0-journey.integration.test.ts | 8 |
| 11 | `R0-11-PL07-PAYMENT-ACTOR` | Manual payments and refunds record the acting user (R0-PL-07, in review, stacked on R0-PC-01) | R0 | R0-04-QT-DETAIL-ROUTE | R0-G2 | 6 files: commerce.controller.ts, commerce.service.ts, payment-evidence.service.ts, commerce-adapter.service.ts, commerce-adapter.service.spec.ts, +payments-actor.integration.test.ts | +payments-actor.integration.test.ts, commerce-adapter.service.spec.ts | 3 |
| 12 | `R0-12-CT-TENANT-ROUTES` | Bind contact custom-field values, call tasks and flow-run steps to the path tenant; fix contacts/bulk and unread-counts route shadowing | R0 | R0-03-CT-AUDIT-ACTOR | R0-G2 | 9 files: crm-custom-fields.controller.ts, contact-custom-field-value.service.ts, call-task.controller.ts, call-log.service.ts, flow-runner.service.ts, flow.controller.ts, crm.controller.ts, +contact-scoped-tenancy.integration.test.ts, crm.e2e.test.ts | +contact-scoped-tenancy.integration.test.ts, crm.e2e.test.ts | 7 |
| 13 | `R0-13-CT-PERSISTENCE-PROOF` | Contacts write-contract real-DB proof: denial, validation, delete-then-refresh | R0 | R0-03-CT-AUDIT-ACTOR | R0-G2 | 2 files: +contacts-persistence.integration.test.ts, crm.service.ts | +contacts-persistence.integration.test.ts | 5 |
| 14 | `R0-14-AUTH-LOCAL-SIGNIN` | No-provider local sign-in for Release 0 (option per D-02: bounded local issuer reusing the HS256 verifier, or self-hosted GoTrue) | R0 | R0-09-ID-HARDEN, D-02 | R0-G2 | 7 files: identity-signup.service.ts, supabase-auth.service.ts, env.ts, .env.example, auth-pathway.md, docker-compose.yml, +identity-local-auth.integration.test.ts | +identity-local-auth.integration.test.ts | 8 |
| 15 | `R0-15-WEB-DENIAL-STATES` | Web renders denial and errors instead of empty data; no silent biz_demo default business | R0 | R0-04-QT-DETAIL-ROUTE | R0-G2 | 8 files: use-contacts-data.ts, overview/page.tsx, contact-header.tsx, _defaults.ts, client.ts, +use-contacts-data.test.ts, +contact-detail-denial.test.tsx, +no-demo-business-default.spec.ts | +use-contacts-data.test.ts, +contact-detail-denial.test.tsx, +no-demo-business-default.spec.ts | 7 |
| 16 | `R0-16-PROOF-BINDING` | Release 0 proof binding: one-command local runner, K12 manifests for every Release 0 suite in CI, verdict source identity, stale journey titles | R0 | R0-01-CT-RECONCILE, R0-02-REV-AUTH-CONFORM, R0-10-COCKPIT-TRUTH | R0-G2 | 12 files: +test-local.sh, package.json, package.json, +release0-journey.json, +tenant-001-real-db.json, ci-cd.yml, evaluate.mjs, k12-self.json, proof-admission.spec.ts, release0-journey.integration.test.ts, TESTING.md, +test-local.selftest.sh | proof-admission.spec.ts, +test-local.selftest.sh, +release0-journey.json, release0-journey.integration.test.ts | 8 |
| 17 | `R0-17-PAYMENT-TX-INTEGRITY` | Payment transaction integrity: refuse non-issued invoices before writing, reconcile inside the transaction, emit after commit, guard and surface refunds | R0 | R0-11-PL07-PAYMENT-ACTOR | R0-G3 | 4 files: commerce.service.ts, invoice-workflow.service.ts, invoice-workflow.service.spec.ts, +commerce-payment-integrity.integration.test.ts | +commerce-payment-integrity.integration.test.ts, invoice-workflow.service.spec.ts | 8 |
| 18 | `R0-18-WEB-BUSINESS-SELECTION` | Membership-first business selection: keep the stored choice, list from GET /identity/businesses, switcher, bootstrap only when none | R0 | R0-15-WEB-DENIAL-STATES, R0-05-ID-REALDB-TENANT-ALIGN, D-10 | R0-G3 | 8 files: workspace.ts, use-app-layout.ts, client.ts, +business-switcher.tsx, app-header.tsx, login-form.tsx, callback/page.tsx, +workspace-business-selection.test.ts | +workspace-business-selection.test.ts | 8 |
| 19 | `R0-19-EVIDENCE-BASELINE` | Real-DB evidence characterization for the Release 0 actions, a single Activity feed writer, and a payment audit row that says payment | R0 | R0-11-PL07-PAYMENT-ACTOR, D-08 | R0-G3 | 5 files: +evidence-feed.integration.test.ts, automation-executor.service.ts, +automation-executor.service.spec.ts, business-event.interceptor.ts, +business-event.interceptor.spec.ts | +evidence-feed.integration.test.ts, +automation-executor.service.spec.ts, +business-event.interceptor.spec.ts | 8 |
| 20 | `R0-20-MARKPAID-CONVERGENCE` | Mark-paid records the remaining balance through recordPayment so every SUCCESSFUL payment is posted | R0 | R0-17-PAYMENT-TX-INTEGRITY, D-05 | R0-G4 | 2 files: commerce.service.ts, +mark-paid-convergence.integration.test.ts | +mark-paid-convergence.integration.test.ts | 5 |
| 21 | `R0-21-WEB-PAYMENT-FORMS` | Web payment forms: idempotency key per form open, status-aware paid/remaining from the server, overpayment confirm, single-submit invoice save | R0 | R0-18-WEB-BUSINESS-SELECTION | R0-G4 | 8 files: client.ts, payment-record-modal.tsx, use-pipeline-actions.ts, [id]/page.tsx, invoices-panel.tsx, +payment-record-modal.test.tsx, +invoices-panel-submit.test.tsx, +record-invoice-payment-idempotency.test.ts | +payment-record-modal.test.tsx, +invoices-panel-submit.test.tsx, +record-invoice-payment-idempotency.test.ts | 7 |
| 22 | `R0-22-PUBLIC-INTENT-HARDEN` | Public payment intent: no invoice status flip, dedupe per invoice and method, payable-state gate, amount cap | R0 | R0-20-MARKPAID-CONVERGENCE, D-06 | R0-G5 | 5 files: commerce.service.ts, commerce.controller.ts, [invoiceId]/page.tsx, +public-payment-intent.integration.test.ts, revenue-authorization.integration.test.ts | +public-payment-intent.integration.test.ts, revenue-authorization.integration.test.ts | 6 |
| 23 | `R0-23-WEB-R0-SCREENS` | Web Release 0 screen tests (jsdom) with server-shaped fixtures and simulated refresh | R0 | R0-21-WEB-PAYMENT-FORMS, R0-15-WEB-DENIAL-STATES, R0-18-WEB-BUSINESS-SELECTION | R0-G5 | 2 files: +release0-journey.test.tsx, +journey-responses.json | +release0-journey.test.tsx, +journey-responses.json | 8 |
| 24 | `R0-24-PUBLIC-TOKEN-VIEW` | Public invoice link shows paid and remaining; pay-link tokens are crypto-random and honour expiresInDays | R0 | R0-22-PUBLIC-INTENT-HARDEN, D-07 | R0-G6 | 6 files: commerce.service.ts, commerce.controller.ts, [token]/page.tsx, client.ts, +public-invoice-link.integration.test.ts, +public-invoice-projection.test.tsx | +public-invoice-link.integration.test.ts, +public-invoice-projection.test.tsx | 7 |
| 25 | `R0-25-PLAYWRIGHT-R0` | Playwright live Release 0 journey, mocked e2e job in CI, rewrite of the stale onboarding spec | R0 | R0-06-WEB-ONBOARD-MANUAL, R0-23-WEB-R0-SCREENS, R0-16-PROOF-BINDING, R0-08-WEB-NAV-LINKS | R0-G6 | 5 files: +release0-live.spec.ts, onboarding-loop-regression.spec.ts, playwright.config.ts, +e2e-live.yml, ci-cd.yml | onboarding-loop-regression.spec.ts, +release0-live.spec.ts | 8 |
| 26 | `R0-26-PUBLIC-RECEIPT` | Customer receipt by pay-link token and truthful receipt-email amounts | R0 | R0-24-PUBLIC-TOKEN-VIEW, D-07 | R0-G7 | 7 files: commerce.controller.ts, commerce.service.ts, invoice-receipt-builder.service.ts, invoice-receipt.listener.ts, +invoice-receipt.listener.spec.ts, +public-receipt.integration.test.ts, [token]/page.tsx | +public-receipt.integration.test.ts, +invoice-receipt.listener.spec.ts | 6 |
| 27 | `R0-27-REVENUE-CREATE-CONTRACT` | Create DTOs for invoices and quotes, tenant-checked contact on create, quote and convert errors as HTTP exceptions | R0 | R0-26-PUBLIC-RECEIPT | R0-G8 | 8 files: +create-invoice.dto.ts, +create-quote.dto.ts, +document-line-item.dto.ts, commerce.controller.ts, commerce.service.ts, +commerce-quote-errors.integration.test.ts, commerce-invoice-errors.integration.test.ts, commerce-authorization.e2e.test.ts | +commerce-quote-errors.integration.test.ts, commerce-invoice-errors.integration.test.ts, commerce-authorization.e2e.test.ts | 6 |
| 28 | `R0-28-QUOTE-STATE-MACHINE` | Quote status state machine; revenue:write and tenant binding on the bare-id quote status route | R0 | R0-27-REVENUE-CREATE-CONTRACT, R0-04-QT-DETAIL-ROUTE, D-04 | R0-G9 | 8 files: +quote-workflow.ts, +quote-workflow.spec.ts, commerce.service.ts, commerce.controller.ts, update-quote-status.dto.ts, client.ts, +commerce-quote-status.integration.test.ts, commerce-authorization.e2e.test.ts | +quote-workflow.spec.ts, +commerce-quote-status.integration.test.ts, commerce-authorization.e2e.test.ts | 6 |
| 29 | `R0-29-QUOTE-CONVERSION-JOURNEY` | Conversion carries the accepted quote's tax and discount; real-DB quote journey | R0 | R0-28-QUOTE-STATE-MACHINE, D-04 | R0-G10 | 5 files: commerce.service.ts, quote-convert-modal.tsx, quotes-panel.tsx, +release0-quote-journey.integration.test.ts, +quote-convert-modal.test.tsx | +release0-quote-journey.integration.test.ts, +quote-convert-modal.test.tsx | 7 |
| 30 | `R0-30-QUOTE-PUBLIC-LINK` | Provider-free public quote link (copy link) for the quote branch of Release 0 | R0 | R0-29-QUOTE-CONVERSION-JOURNEY, D-04 | R0-G11 | 6 files: commerce.controller.ts, commerce.service.ts, client.ts, quotes-panel.tsx, +quote-public-link.integration.test.ts, +quotes-panel-share.test.tsx | +quote-public-link.integration.test.ts, +quotes-panel-share.test.tsx | 5 |
| 31 | `V1-01-SEC-CREDENTIAL-SECRET-SCAN` | Remove the committed audit credential, make the secret scan real (#189), capture the dependency-audit outcome (#114) | V1 | R0-25-PLAYWRIGHT-R0, R0-16-PROOF-BINDING, D-22, D-30 | V1-G1 | 5 files: audit-keyflowos.py, audit-mobile-quick.py, ci-cd.yml, +secret-scan-contract.spec.mjs, package.json | +secret-scan-contract.spec.mjs | 4 |
| 32 | `V1-02-KEY-CORTEX-FAILCLOSED` | Cortex parsed-command autonomy fails closed (#155) and BatchResult is consumed without legacy replay (#182) | V1 | D-17 | V1-G1 | 5 files: key-cortex-query-pipeline.service.ts, key-cortex-query-pipeline.service.spec.ts, +key-cortex-batch-result.mapper.ts, +key-cortex-batch-result.mapper.spec.ts, +auth-fail-closed-001-negative-controls.json | key-cortex-query-pipeline.service.spec.ts, +key-cortex-batch-result.mapper.spec.ts, +auth-fail-closed-001-negative-controls.json | 8 |
| 33 | `V1-03-KEY-CORTEX-PRINCIPAL` | Cortex controller takes the principal from AuthGuard; autonomy-profile writes limited to OWNER/ADMIN at the required tier | V1 | D-17 | V1-G1 | 3 files: key-cortex.controller.ts, +key-cortex.controller.principal.spec.ts, +autonomy-profile-authority.integration.test.ts | +key-cortex.controller.principal.spec.ts, +autonomy-profile-authority.integration.test.ts | 7 |
| 34 | `V1-04-KEY-OVERSIGHT-SELECTIVE` | AI oversight: a failed typed policy read can no longer be overridden by a legacy AiMemory policy (#180 patch) | V1 | — | V1-G1 | 2 files: ai-oversight.service.ts, ai-oversight-fails-closed.spec.ts | ai-oversight-fails-closed.spec.ts | 3 |
| 35 | `V1-05-PUB-PROVIDER-CALLBACKS` | WiPay callback fails closed without a keyed proof; PayPal capture bound to invoice, amount and currency with ledger posting | V1 | D-19 | V1-G1 | 4 files: payments.service.ts, payments.controller.ts, +payments-wipay-callback.service.test.ts, +payments-paypal-capture.service.test.ts | +payments-wipay-callback.service.test.ts, +payments-paypal-capture.service.test.ts | 8 |
| 36 | `V1-06-BK-BASELINE-PARITY` | Bookings real-DB baseline and in-app create parity: tenant-checked contact and staff, same availability rules as the public path | V1 | — | V1-G1 | 4 files: bookings.service.ts, create-booking.dto.ts, bookings.controller.ts, +bookings-core.integration.test.ts | +bookings-core.integration.test.ts | 8 |
| 37 | `V1-07-AUTH-INVITE-CEILING` | Invite grantability ceiling: a grantor cannot mint scopes or tiers above their own | V1 | R0-09-ID-HARDEN, R0-05-ID-REALDB-TENANT-ALIGN | V1-G1 | 3 files: approval-tier.ts, identity.service.ts, tenant-membership-boundary.integration.test.ts | tenant-membership-boundary.integration.test.ts | 6 |
| 38 | `V1-08-CT-SIBLING-VISIBILITY` | Apply caller CRM visibility to the 14 sibling contact-scoped REST reads; ownerId edits respect crm_reassign | V1 | R0-12-CT-TENANT-ROUTES, R0-13-CT-PERSISTENCE-PROOF, R0-01-CT-RECONCILE | V1-G1 | 8 files: crm-permissions.helper.ts, crm-timeline.service.ts, crm-journey.service.ts, crm-revenue.service.ts, crm.service.ts, crm.controller.ts, contacts-visibility.integration.test.ts, crm.e2e.test.ts | contacts-visibility.integration.test.ts, crm.e2e.test.ts | 6 |
| 39 | `V1-09-KEY-COMMAND-GOVERNED` | /key/command: bare canonical capability routing (#160 hunk only) and a read-only, governed 'ask' mode | V1 | D-17 | V1-G2 | 3 files: key-command.service.ts, +key-command-capability-routing.spec.ts, +key-command-ask-governance.spec.ts | +key-command-capability-routing.spec.ts, +key-command-ask-governance.spec.ts | 6 |
| 40 | `V1-10-KEY-PLANNER-CLAIM` | KEY plan execution claims the plan atomically and records approval pauses correctly (#174 KEY-01/02) | V1 | — | V1-G2 | 2 files: key-cortex-planner.service.ts, +key-cortex-plan-execution.integration.test.ts | +key-cortex-plan-execution.integration.test.ts | 5 |
| 41 | `V1-11-KEY-AUDIT-TENANT` | Cortex audit routes bind the tenant with GuardedBusinessId instead of an absent path param | V1 | — | V1-G2 | 3 files: key-cortex-audit.controller.ts, +key-cortex-audit.controller.spec.ts, +cortex-audit-tenant.integration.test.ts | +key-cortex-audit.controller.spec.ts, +cortex-audit-tenant.integration.test.ts | 3 |
| 42 | `V1-12-DM-RECURRING-GUARD` | Recurring invoice run guard released on failure; schedule advance and invoice creation in one transaction (#174 REL-03/04) | V1 | — | V1-G2 | 2 files: recurring-invoice.service.ts, +recurring-invoice-run.integration.test.ts | +recurring-invoice-run.integration.test.ts | 4 |
| 43 | `V1-13-SEC-NATIVE-DAST` | Native DAST harness from #114 with Release 0 auth-boundary probes (non-required workflow) | V1 | — | V1-G2 | 4 files: +native-dast.mjs, +native-dast-manifest.json, +native-dast.spec.mjs, +native-dast.yml | +native-dast.spec.mjs, +native-dast-manifest.json | 5 |
| 44 | `V1-14-PUB-PORTAL-VOICE-BINDING` | Portal grant co-membership, portal validate rate limit, signed phone-stream tenant token | V1 | — | V1-G2 | 6 files: portal.service.ts, portal.controller.ts, phone-voice.controller.ts, phone-voice.service.ts, +phone-voice-stream-auth.spec.ts, +portal-boundary.integration.test.ts | +portal-boundary.integration.test.ts, +phone-voice-stream-auth.spec.ts | 7 |
| 45 | `V1-15-DM-LEDGER-WRITE-DOOR` | Ledger write-door integrity: expense void through PostingService, closed periods enforced, raw-writer and money-writer ratchets, trial balance | V1 | — | V1-G2 | 8 files: expenses.service.ts, posting.service.ts, accounting-period.service.ts, finance.module.ts, +ledger-writer-integrity.spec.ts, +money-state-writer-inventory.spec.ts, posting.service.integration.spec.ts, +expense-void-reversal.integration.test.ts | +ledger-writer-integrity.spec.ts, +money-state-writer-inventory.spec.ts, posting.service.integration.spec.ts, +expense-void-reversal.integration.test.ts | 8 |
| 46 | `V1-16-BK-SLOT-CONCURRENCY` | Booking slot claim under an advisory transaction lock; timezone-aware slots | V1 | V1-06-BK-BASELINE-PARITY | V1-G2 | 4 files: bookings.service.ts, booking-overlap.spec.ts, bookings.controller.spec.ts, +booking-concurrency.integration.test.ts | +booking-concurrency.integration.test.ts, bookings.controller.spec.ts | 8 |
| 47 | `V1-17-DM-CONTACT-PARTIAL-UNIQUE` | Soft-delete-safe contact identity uniques (isolated SQL-only partial index migration) | V1 | V1-08-CT-SIBLING-VISIBILITY, D-16 | V1-MT1 | 4 files: +20261101000000_contact_partial_identity_uniques/migration.sql, schema.prisma, crm.service.ts, crm-contact-duplicate.integration.test.ts | crm-contact-duplicate.integration.test.ts | 5 |
| 48 | `V1-18-PUB-STOREFRONT-PAID-EVENT` | Storefront paid-event integrity: CONFIRMED is not paid; the dormant marketplace listener never creates a second PAID invoice (F206) | V1 | D-18 | V1-G3 | 4 files: store-order.service.ts, commerce-integration.service.ts, +store-order.service.spec.ts, +storefront-paid-event.integration.test.ts | +store-order.service.spec.ts, +storefront-paid-event.integration.test.ts | 6 |
| 49 | `V1-19-KEY-IDEMPOTENCY-CLAIM` | KeyIdempotencyService insert-claim with requestHash comparison; characterize the approved plan-queue re-enqueue (#174 KEY-03/04) | V1 | V1-10-KEY-PLANNER-CLAIM | V1-G3 | 3 files: key-idempotency.service.ts, +key-idempotency-claim.integration.test.ts, +plan-executor-approval-resume.integration.test.ts | +key-idempotency-claim.integration.test.ts, +plan-executor-approval-resume.integration.test.ts | 6 |
| 50 | `V1-20-SEC-VERIFY-UP` | Launch verifier rejects degraded HTTP 200 bodies (port #188) | V1 | V1-01-SEC-CREDENTIAL-SECRET-SCAN | V1-G3 | 6 files: verify-up.sh, +verify-up-body.mjs, +verify-up-body.spec.mjs, +verify-up-shell.spec.mjs, ci-cd.yml, package.json | +verify-up-body.spec.mjs, +verify-up-shell.spec.mjs | 3 |
| 51 | `V1-21-AUTH-JOBROLE-CEILING` | JobRole permissions vocabulary-validated and capped; assignment sync cannot escalate | V1 | V1-07-AUTH-INVITE-CEILING | V1-G3 | 5 files: create-job-role.dto.ts, update-job-role.dto.ts, structure.service.ts, structure.controller.ts, +structure-authority-ceiling.integration.test.ts | +structure-authority-ceiling.integration.test.ts | 6 |
| 52 | `V1-22-DM-MONEY-CENTS` | Cents-safe money arithmetic at write and balance boundaries (no schema change) | V1 | R0-30-QUOTE-PUBLIC-LINK, D-13 | V1-G3 | 6 files: +money.ts, +money.spec.ts, invoice-workflow.service.ts, invoice-workflow.service.spec.ts, commerce.service.ts, +commerce-money-rounding.integration.test.ts | +money.spec.ts, invoice-workflow.service.spec.ts, +commerce-money-rounding.integration.test.ts | 6 |
| 53 | `V1-23-PUB-PUBLIC-PROJECTIONS` | Public product, staff and service endpoints return projections, honour storeEnabled and are rate limited | V1 | V1-06-BK-BASELINE-PARITY | V1-G3 | 5 files: catalog.service.ts, catalog.controller.ts, site.service.ts, bookings.controller.ts, +public-catalog-projection.integration.test.ts | +public-catalog-projection.integration.test.ts | 6 |
| 54 | `V1-24-KEY-KILL-SWITCHES` | Unified scheduler kill switch and a server-side KEY off switch for gateway dispatch and cortex crons | V1 | R0-07-OPTIONAL-SVC-VISIBLE, R0-14-AUTH-LOCAL-SIGNIN, R0-16-PROOF-BINDING, D-17 | V1-G3 | 19 files: +scheduler-kill-switch.spec.ts, env.ts, .env.example, model-gateway.service.ts, model-gateway.service.spec.ts, margin-snapshot-scheduler.service.ts, financial-briefing-scheduler.service.ts, best-channel-scheduler.service.ts, crm-sequence-scheduler.service.ts, key-proactive-engine.service.ts, key-cortex-reflection.service.ts, key-cortex-intuition.service.ts, key-bi-engine.service.ts, key-cortex-creativity.service.ts, key-cortex-salience.service.ts, memory-consolidation.service.ts, key-cortex-homeostasis.service.ts, key-cortex-cerebellum.service.ts, release0-journey.integration.test.ts | +scheduler-kill-switch.spec.ts, model-gateway.service.spec.ts, release0-journey.integration.test.ts | 8 |
| 55 | `V1-25-EVT-BUSINESS-FEED` | Mount the business-level activity feed in the cockpit; bounded timeline limit | V1 | R0-19-EVIDENCE-BASELINE, R0-10-COCKPIT-TRUTH | V1-G3 | 5 files: query-timeline.dto.ts, business-timeline.tsx, command-center/page.tsx, +business-timeline.test.tsx, +evidence-feed.integration.test.ts | +business-timeline.test.tsx, +evidence-feed.integration.test.ts | 5 |
| 56 | `V1-26-CT-TRPC-VISIBILITY` | tRPC crm.contactDetail applies CRM visibility before reading child rows | V1 | V1-08-CT-SIBLING-VISIBILITY | V1-MT2 | 2 files: crm.ts, +crm.contact-detail.spec.ts | +crm.contact-detail.spec.ts | 3 |
| 57 | `V1-27-BK-SLOT-WRITERS` | The three booking writers that bypass the overlap guard (tRPC create, waitlist offer, calendar write-back) go through it | V1 | V1-16-BK-SLOT-CONCURRENCY | V1-MT3 | 4 files: bookings.ts, booking-waitlist.service.ts, calendar-projection.service.ts, +booking-slot-writers.integration.test.ts | +booking-slot-writers.integration.test.ts | 5 |
| 58 | `V1-28-BK-SETTLEMENT` | Booking settlement: completion invoice nets the deposit, visible invoicing outcome, paymentStatus from invoices, live invoice.paid confirm hook | V1 | V1-16-BK-SLOT-CONCURRENCY, R0-20-MARKPAID-CONVERGENCE, R0-26-PUBLIC-RECEIPT, D-26 | V1-G4 | 9 files: bookings.service.ts, +booking-payment-status.listener.ts, +booking-payment-status.listener.spec.ts, bookings.module.ts, flow.listener.ts, events.types.ts, +booking-settlement.integration.test.ts, order-confirmation.tsx, book/page.tsx | +booking-settlement.integration.test.ts, +booking-payment-status.listener.spec.ts | 8 |
| 59 | `V1-29-DM-REFUND-CONVENTION` | Manual refunds as separate negative rows, a defined full-refund state, agreeing gross and net | V1 | V1-22-DM-MONEY-CENTS, D-14 | V1-G4 | 4 files: commerce.service.ts, invoice-workflow.service.ts, invoice-workflow.service.spec.ts, +commerce-refund.integration.test.ts | +commerce-refund.integration.test.ts, invoice-workflow.service.spec.ts | 6 |
| 60 | `V1-30-SEC-DAST-GATE-SWAP` | Required admission gate swaps from 'DAST (HawkScan)' to 'DAST (Native)'; HawkScan becomes manual-only | V1 | V1-13-SEC-NATIVE-DAST, V1-01-SEC-CREDENTIAL-SECRET-SCAN, D-22 | V1-G4 | 7 files: events.mjs, AGENT_AUTOPILOT_POLICY.yaml, AGENT_AUTOPILOT.md, agent-control-autopilot.yml, hawkscan.yml, +workflow-integrity.spec.mjs, negative-controls.yaml | +workflow-integrity.spec.mjs, negative-controls.yaml | 4 |
| 61 | `V1-31-KEY-FLOW-CONFIRM-BIND` | Flow confirmations execute only the server-bound confirmation, never client-resubmitted tool arguments; approvals carry the real principal | V1 | V1-03-KEY-CORTEX-PRINCIPAL, D-17 | V1-G4 | 4 files: flow-orchestrator.service.ts, approval.controller.ts, +flow-confirmation-binding.spec.ts, approval.controller.spec.ts | +flow-confirmation-binding.spec.ts, approval.controller.spec.ts | 8 |
| 62 | `V1-32-KEY-PROPOSAL-CLAIM` | KeyActionProposal execution claims atomically and re-reads the approver | V1 | D-17 | V1-G4 | 2 files: key-action-proposal.service.ts, +key-action-proposal-claim.integration.test.ts | +key-action-proposal-claim.integration.test.ts | 4 |
| 63 | `V1-33-PUB-CHECKOUT-RETRY-OFFLINE` | Storefront checkout retry identity (existing unique slot, no migration unless proven unavoidable) and CASH-order offline completion | V1 | V1-18-PUB-STOREFRONT-PAID-EVENT, D-18 | V1-G4 | 3 files: site.controller.ts, store-order.service.ts, +storefront-checkout-retry.integration.test.ts | +storefront-checkout-retry.integration.test.ts | 6 |
| 64 | `V1-34-DM-CASH-POSITION` | Ledger-derived cash position for the cockpit and safe-to-spend | V1 | V1-15-DM-LEDGER-WRITE-DOOR | V1-G4 | 7 files: +cash-position.service.ts, finance.module.ts, safe-to-spend.service.ts, os.service.ts, finance-overview.service.ts, +cash-position.service.integration.spec.ts, os.controller.test.ts | +cash-position.service.integration.spec.ts, os.controller.test.ts | 8 |
| 65 | `V1-35-DM-POLLER-CLAIM` | Cross-module job poller runs only its own job types and claims each job atomically (#174 REL-01/02) | V1 | D-29 | V1-G4 | 2 files: cross-module-agent.service.ts, +cross-module-job-poller.integration.test.ts | +cross-module-job-poller.integration.test.ts | 5 |
| 66 | `V1-36-DM-BALANCE-READ-CONTRACT` | One canonical invoice balance read contract across server and web (packages/shared mirror of computeBalance) | V1 | V1-29-DM-REFUND-CONVENTION, V1-34-DM-CASH-POSITION | V1-MT4 | 11 files: +invoice-balance.ts, invoice-workflow.service.ts, commerce.service.ts, revenue-reporting.service.ts, revenue-action.service.ts, finance-overview.service.ts, invoice-list.tsx, invoice-stat-cards.tsx, invoices-panel.tsx, +invoice-refund-balance.integration.test.ts, +balance-arithmetic.spec.ts | +invoice-refund-balance.integration.test.ts, +balance-arithmetic.spec.ts | 6 |
| 67 | `V1-37-DM-CURRENCY` | Currency integrity: business-currency defaults, per-currency stats, single-currency guard at the posting door | V1 | V1-36-DM-BALANCE-READ-CONTRACT, V1-15-DM-LEDGER-WRITE-DOOR, D-13 | V1-G5 | 8 files: commerce.service.ts, commerce-stats.service.ts, +commerce-stats.service.spec.ts, posting.service.ts, posting.service.spec.ts, ledger-balance.service.ts, new/page.tsx, +commerce-currency.integration.test.ts | +commerce-stats.service.spec.ts, posting.service.spec.ts, +commerce-currency.integration.test.ts | 8 |
| 68 | `V1-38-CT-PRIVACY-PURGE-STATUS` | Honest GDPR purge with retained-basis audit; Contact.status vocabulary ratchet (Shopify maps, never overwrites) | V1 | V1-09-KEY-COMMAND-GOVERNED, D-25 | V1-G5 | 7 files: contact-privacy.service.ts, shopify.service.ts, key-command.service.ts, flow-tool-registry.ts, crm.constants.ts, +contact-status-vocabulary.spec.ts, +contact-privacy-purge.integration.test.ts | +contact-status-vocabulary.spec.ts, +contact-privacy-purge.integration.test.ts | 8 |
| 69 | `V1-39-SEC-RUNTIME-PIN` | Decide and align the Node runtime pin (extract from #91) with a consistency guard | V1 | V1-20-SEC-VERIFY-UP, V1-30-SEC-DAST-GATE-SWAP, D-21 | V1-G5 | 10 files: +runtime-pin.spec.mjs, package.json, .nvmrc, Dockerfile, ci-cd.yml, hawkscan.yml, AGENTS.md, README.md, DEPLOYMENT.md, LAUNCH_GUIDE.md | +runtime-pin.spec.mjs | 4 |
| 70 | `V1-40-SEC-TRUST-CENSUS-REDACTION` | Log-redaction negative control, packet-branch agent gate, dependabot, Release 0 trust census | V1 | D-22 | V1-G5 | 4 files: +log-redaction.integration.test.ts, agent-control-gate.yml, +dependabot.yml, +RELEASE0-TRUST-CENSUS-001.md | +log-redaction.integration.test.ts | 7 |
| 71 | `V1-41-DM-UNTRUSTED-MONEY-INPUTS` | Evidence-extracted and Drive-intake payments are recorded PENDING until an operator confirms (decision-gated) | V1 | D-27 | V1-G5 | 3 files: payment-evidence.service.ts, drive-intake-orchestrator.service.ts, +untrusted-payment-inputs.integration.test.ts | +untrusted-payment-inputs.integration.test.ts | 5 |
| 72 | `V1-42-DM-LIFECYCLE-OWNER-CAS` | Single invoice lifecycle owner: compare-and-set transitions; DelegationLoop and CommerceAi go through the workflow; status-writer ratchet | V1 | V1-37-DM-CURRENCY | V1-G6 | 7 files: invoice-workflow.service.ts, delegation-loop.service.ts, commerce-ai.service.ts, commerce-ai.controller.ts, commerce.service.ts, +invoice-status-writers.spec.ts, +invoice-transition-concurrency.integration.test.ts | +invoice-status-writers.spec.ts, +invoice-transition-concurrency.integration.test.ts | 8 |
| 73 | `V1-43-DM-NUMBERING` | Per-business sequential invoice/quote numbers allocated under the existing unique with P2002 retry (no migration) | V1 | V1-42-DM-LIFECYCLE-OWNER-CAS, V1-12-DM-RECURRING-GUARD, V1-31-KEY-FLOW-CONFIRM-BIND, D-15 | V1-G7 | 5 files: +document-number.service.ts, commerce.service.ts, flow-orchestrator.service.ts, recurring-invoice.service.ts, +commerce-document-numbering.integration.test.ts | +commerce-document-numbering.integration.test.ts | 7 |
| 74 | `V1-44-DM-CREDIT-NOTE` | Credit-note apply reachable (sourceType 'Invoice'), void converges, statuses owned by the workflow | V1 | V1-42-DM-LIFECYCLE-OWNER-CAS, V1-15-DM-LEDGER-WRITE-DOOR, D-28 | V1-G7 | 4 files: credit-note.service.ts, invoice-workflow.service.ts, invoice-workflow.service.spec.ts, +credit-note-reversal.integration.test.ts | +credit-note-reversal.integration.test.ts, invoice-workflow.service.spec.ts | 8 |
| 75 | `V1-45-DM-CREATE-IDEMPOTENCY` | Create idempotency key for invoices and quotes (isolated migration, only if D-15 confirms no existing unique slot) | V1 | V1-43-DM-NUMBERING, D-15 | V1-MT5 | 5 files: schema.prisma, +20261102000000_document_create_idempotency_keys/migration.sql, commerce.service.ts, client.ts, +commerce-create-idempotency.integration.test.ts | +commerce-create-idempotency.integration.test.ts | 6 |
| 76 | `V1-46-PUB-PAY-LINK-TOKEN-GATE` | Token-gated customer pay surface: /pay/link/[token] stops downgrading to the bare-id page (decision-gated) | V1 | V1-45-DM-CREATE-IDEMPOTENCY, R0-24-PUBLIC-TOKEN-VIEW, D-07 | V1-G8 | 6 files: [token]/page.tsx, [invoiceId]/page.tsx, [token]/page.tsx, commerce.controller.ts, commerce.service.ts, +pay-link-token-gate.integration.test.ts | +pay-link-token-gate.integration.test.ts | 7 |

**`.agent-control` handling.** These files are written only by the integrating session on the working branch, never inside packet worktrees. The exception is R0-01, whose purpose is to reconcile them. So they are left out of the disjointness check for every other packet.

---

## (d) Wave plan

### Execution protocol (every packet)

1. **Branch.** Branch `pkt/<id>` from the current working-branch head into its own worktree, with its own database and a unique fixture prefix.
2. **Tests first.** Commit the `tests_first` files alone. Run them and record the pre-fix result at that exact SHA (red for a defect fix; characterization for new coverage).
3. **Implement.** Change only files in `write_set`. If the fix needs another file, stop and post a CONTRADICTION; never widen silently.
4. **Prove.** Re-run the packet tests, the Release 0 journey and the affected suites at the exact head. Run the scoped typecheck and the ESLint ratchet.
5. **Review.** Run two adversarial reviews (correctness/regression and security/tenancy), then a repair pass.
6. **Integrate.** Merge `--no-ff` into `claude/elegant-curie-7azpsb` only. Never merge to main. Re-run the packet tests in the main tree. Leave `review_status: PENDING_CHATGPT_REVIEW`.
7. **Main-tree groups.** Groups `V1-MT*` hold exactly one packet and run alone in the main tree. `@keyflow/*` packages resolve to the main tree, and Prisma schema migrations must not run in worktrees.

### Wave R0: the Release 0 journey end to end (30 packets, 187 h)

Scope: auth/business, contacts, invoices and quotes, manual payment plus ledger, the public invoice/pay page and receipt, cockpit navigation and truth, and the journey test harness (jsdom, Playwright, K12 manifests).

| Group | Packets | Total h | Wall h (max) | Members |
|---|---|---|---|---|
| R0-G1 | 10 | 54 | 8 | `R0-01-CT-RECONCILE`, `R0-02-REV-AUTH-CONFORM`, `R0-03-CT-AUDIT-ACTOR`, `R0-04-QT-DETAIL-ROUTE`, `R0-05-ID-REALDB-TENANT-ALIGN`, `R0-06-WEB-ONBOARD-MANUAL`, `R0-07-OPTIONAL-SVC-VISIBLE`, `R0-08-WEB-NAV-LINKS`, `R0-09-ID-HARDEN`, `R0-10-COCKPIT-TRUTH` |
| R0-G2 | 6 | 38 | 8 | `R0-11-PL07-PAYMENT-ACTOR`, `R0-12-CT-TENANT-ROUTES`, `R0-13-CT-PERSISTENCE-PROOF`, `R0-14-AUTH-LOCAL-SIGNIN`, `R0-15-WEB-DENIAL-STATES`, `R0-16-PROOF-BINDING` |
| R0-G3 | 3 | 24 | 8 | `R0-17-PAYMENT-TX-INTEGRITY`, `R0-18-WEB-BUSINESS-SELECTION`, `R0-19-EVIDENCE-BASELINE` |
| R0-G4 | 2 | 12 | 7 | `R0-20-MARKPAID-CONVERGENCE`, `R0-21-WEB-PAYMENT-FORMS` |
| R0-G5 | 2 | 14 | 8 | `R0-22-PUBLIC-INTENT-HARDEN`, `R0-23-WEB-R0-SCREENS` |
| R0-G6 | 2 | 15 | 8 | `R0-24-PUBLIC-TOKEN-VIEW`, `R0-25-PLAYWRIGHT-R0` |
| R0-G7 | 1 | 6 | 6 | `R0-26-PUBLIC-RECEIPT` |
| R0-G8 | 1 | 6 | 6 | `R0-27-REVENUE-CREATE-CONTRACT` |
| R0-G9 | 1 | 6 | 6 | `R0-28-QUOTE-STATE-MACHINE` |
| R0-G10 | 1 | 7 | 7 | `R0-29-QUOTE-CONVERSION-JOURNEY` |
| R0-G11 | 1 | 5 | 5 | `R0-30-QUOTE-PUBLIC-LINK` |

- **Critical path: about 77 h** (the sum of each group's longest packet).
- **What sets it.** File-level write-set disjointness serializes every packet that edits `commerce.service.ts`: R0-04 → R0-11 → R0-17 → R0-20 → R0-22 → R0-24 → R0-26 → R0-27 → R0-28 → R0-29 → R0-30, about 61 h. The map does not split that file to gain concurrency; that would be a refactor, against the rules.
- **If D-04 rules invoice-only,** R0-28, R0-29 and R0-30 (18 h) move unchanged to V1, and the R0 critical path drops to about 59 h.

**R0 exit gate. All of the following must hold:**

- Every R0 packet is integrated with a RETURN.
- `proof:release0` (R0-16 manifests) is green in CI at the exact head, with zero unexplained skips.
- The jsdom Release 0 test (R0-23) and the live Playwright journey (R0-25) are green.
- D-02, D-03, D-04 and D-07 are resolved.
- The seven-step table above shows PASS for every step in both columns.

The staging run and the deployment (issue #186 steps B and E) stay operator-authorized under D-20.

### Wave V1: remaining P0/P1 scope (46 packets, 278 h)

Scope: bounded KEY (P0 fail-closed and principal first), bookings, the event feed, minimal storefront and public boundaries, data-model and money hardening, authority ceilings, contacts visibility completion, and security/CI hygiene.

| Group | Packets | Total h | Wall h (max) | Members |
|---|---|---|---|---|
| V1-G1 | 8 | 50 | 8 | `V1-01-SEC-CREDENTIAL-SECRET-SCAN`, `V1-02-KEY-CORTEX-FAILCLOSED`, `V1-03-KEY-CORTEX-PRINCIPAL`, `V1-04-KEY-OVERSIGHT-SELECTIVE`, `V1-05-PUB-PROVIDER-CALLBACKS`, `V1-06-BK-BASELINE-PARITY`, `V1-07-AUTH-INVITE-CEILING`, `V1-08-CT-SIBLING-VISIBILITY` |
| V1-G2 | 8 | 46 | 8 | `V1-09-KEY-COMMAND-GOVERNED`, `V1-10-KEY-PLANNER-CLAIM`, `V1-11-KEY-AUDIT-TENANT`, `V1-12-DM-RECURRING-GUARD`, `V1-13-SEC-NATIVE-DAST`, `V1-14-PUB-PORTAL-VOICE-BINDING`, `V1-15-DM-LEDGER-WRITE-DOOR`, `V1-16-BK-SLOT-CONCURRENCY` |
| V1-MT1 | 1 | 5 | 5 | `V1-17-DM-CONTACT-PARTIAL-UNIQUE` |
| V1-G3 | 8 | 46 | 8 | `V1-18-PUB-STOREFRONT-PAID-EVENT`, `V1-19-KEY-IDEMPOTENCY-CLAIM`, `V1-20-SEC-VERIFY-UP`, `V1-21-AUTH-JOBROLE-CEILING`, `V1-22-DM-MONEY-CENTS`, `V1-23-PUB-PUBLIC-PROJECTIONS`, `V1-24-KEY-KILL-SWITCHES`, `V1-25-EVT-BUSINESS-FEED` |
| V1-MT2 | 1 | 3 | 3 | `V1-26-CT-TRPC-VISIBILITY` |
| V1-MT3 | 1 | 5 | 5 | `V1-27-BK-SLOT-WRITERS` |
| V1-G4 | 8 | 49 | 8 | `V1-28-BK-SETTLEMENT`, `V1-29-DM-REFUND-CONVENTION`, `V1-30-SEC-DAST-GATE-SWAP`, `V1-31-KEY-FLOW-CONFIRM-BIND`, `V1-32-KEY-PROPOSAL-CLAIM`, `V1-33-PUB-CHECKOUT-RETRY-OFFLINE`, `V1-34-DM-CASH-POSITION`, `V1-35-DM-POLLER-CLAIM` |
| V1-MT4 | 1 | 6 | 6 | `V1-36-DM-BALANCE-READ-CONTRACT` |
| V1-G5 | 5 | 32 | 8 | `V1-37-DM-CURRENCY`, `V1-38-CT-PRIVACY-PURGE-STATUS`, `V1-39-SEC-RUNTIME-PIN`, `V1-40-SEC-TRUST-CENSUS-REDACTION`, `V1-41-DM-UNTRUSTED-MONEY-INPUTS` |
| V1-G6 | 1 | 8 | 8 | `V1-42-DM-LIFECYCLE-OWNER-CAS` |
| V1-G7 | 2 | 15 | 8 | `V1-43-DM-NUMBERING`, `V1-44-DM-CREDIT-NOTE` |
| V1-MT5 | 1 | 6 | 6 | `V1-45-DM-CREATE-IDEMPOTENCY` |
| V1-G8 | 1 | 7 | 7 | `V1-46-PUB-PAY-LINK-TOKEN-GATE` |

V1 starts after the R0 exit gate. V1 packets whose write sets touch no open R0 packet could fill idle R0 slots earlier, but only if the owner allows it (D-31).

**V1 exit gate. All of the following must hold:**

- Every V1 packet is integrated.
- A real-DB trial balance balances per currency after payment, refund, void and credit note.
- The KEY suites are green both with `AI_DISABLED` and with providers configured.
- Booking settlement passes on a real DB.
- Security scans block the build.
- The runtime is pinned.

### Wave V1+: later, preserved backlog (not queued; no packet written yet)

| Item | Source | Disposition and re-entry trigger |
|---|---|---|
| D-2 consolidation: cockpit redirect stubs, 4+ KEY entry points, dead billing stack of about 3.3k lines | M08; CWS-BP4, CWS-BP5, CWS-BP6, KEY-ENTRYPOINT-CONSOLIDATE-001 | P2. Removal needs reachability proof; V1 scope allows only small corrective UX (R0-08). |
| Bookings BK-04, BK-05, BK-07, BK-08: client-side slot picker, legacy ISO-text pages, deposit configuration writer, cancel/no-show financial disposition | M42, M43 | P2, after V1-28. Cancel policy needs D-26. |
| Storefront SSP-BP-04 to 08 and BP-PC-06 to 08; the portal web route; retiring KEYPORTAL KP-1..35 | M37, M38, M39 | Needs D-18. Presence plus `/book` already cover KEYPORTAL. |
| Staged Decimal migration (DM-005), DM-006, DM-007 | M23, M55 | After V1-22. Needs D-13. |
| Payment tenancy (DM-008): FK to Business, Payment readers under the tenant extension | M31 | A migration. Needs a production data check (D-20). |
| Identity AB-BP06/07/08: suspension state, real-DB invite reconcile, `Business.ownerId` FK, founding-membership backfill receipts | M05, CF-25 | Needs D-11. |
| Contacts CT-BP-06 (firstName contract between manual route and form) | M12; DEC-CONTACTS-001/002 | Needs D-25. |
| PKT-FLOW-006 (Date.now flow-run keys), PKT-TIME-007, PKT-OVD-008 (duplicate OVERDUE authority) | M52, CF-51 | TIME-001 / TEMPORAL-002. |
| KF-HARNESS-TEST-TYPECHECK-001 (tests never type-checked), KF-HARNESS-PKG-TESTS-001 (packages specs never run) | M58 | P1 infra, after R0-16. |
| Soft-delete coverage (14 of 33 models), update/aggregate gaps | M54 | P2. |
| Migration drift gate, archived Contact FTS trigger, stray raw-SQL scripts, silent findMany cap | M55, CF-52 | MIGRATE-001. |
| Public-surface ledger parser accuracy and 429 tests | M33 | P2. |
| KEY surfaces that report success for stubs (`placeholder_execution`, queued `/actions`) | M48 | P2. |
| D-1: eight execution authorities, dead AutomationService, ADR-0001 import guard, playbook test-run honesty, FlowTemplate versioning | M51, CF-53 | PLAYBOOK-001. |
| Webhook processing lifecycle; legacy `/webhooks/stripe` convergence; RA-G16-01 service-level tightening | CF-50; NC contract section 4.5 | INGRESS-001. The webhook change needs D-05. |
| ScheduledAgentJob lease (beyond V1-35), FlowRunner durable delay, `invoice.overdue` consequence identity | CF-51 | TIME-001 / TEMPORAL-002. |
| Invitation model, AUTH shadow on Release 0 routes, KEY capability contract test, registry drift gate, doc corrections, release receipt, global P2002→409 mapping | corpus v1 overflow; CF-29, CF-55 | Re-plan after the V1 exit gate. |
| `/readyz` migration-parity probe | PRS-M02 | OPS-001. |
| Deferred domains: SEO (GSC/GA4), Shopify, ticketing and events (SPACE-001), directory mock, public-events analytics, temporal/momentum, event-stream SSE, Google Calendar sync, invoice-from-time Int quantity (F228), playbook library and TEMPORAL-002, people-flow, Growth engine and paid ads, Network and Index (NETWORK-001), voice metering and LiveKit (VOICE-001), KNOWLEDGE-001/002 genome lineage, privacy derived state (PRIVACY-001), EXTFX rollout gate, CONNECTOR-001 fencing, inbound email/SMS and CONVO-001, TIME-001 occurrences, RECOVERY operator items, J8 projects and time billing, J11 contracts, J12 documents, payroll, subscription lifecycle and AI metering (ENTITLE-001), WITHDRAW-001/002, MIGRATE-001, OPS SLOs and DLQ, RELEASE canary, COGNITION-001, gamification XP idempotency, autopilot fabricated evidence (F090-F094), admin route gate (R19), keystore and API-key admin scopes | V1-MODULE-SCOPE P2-1..P2-8; wave board Waves B-E; M60; CF-57 | DEFER. Preserved with full vision. |
| PR-sourced later product items: #162 self-model, #161 finance tools, #158 goal tracker, #160 message_intake equivalence, #134 quarantine ingestion plus `search_knowledge` status filter, #112 `validFrom`, #127 auditor masking, #63 enrichment SSRF and parsing, #91 web-build Prisma scoping, #148 dedupe hash, KEY evolution learning methods (PRS-M36) | PRS family | DEFER. See section (e). |
| Control-plane work (owned by ChatGPT through #80): PR discovery (#185 vs #170 vs #168), base-aware divergence (#107), #171, #169/#175, #172, #184, worker GH_TOKEN proof skip (PRS-M49), #111, #152, #176, #191, the Atlas chain | PRS-M39 to PRS-M50 | Not product work. Needs D-32. |

---

## (e) Open-PR disposition (classification only; nothing closed or merged)

Source: `GET /repos/SaCH-PRO/KEYFLOWOS/pulls?state=open` on 2026-10-31, which returned **59 open PRs**. These were cross-checked against the 10 PR-family lanes.

The classifications are:

| Classification | Meaning |
|---|---|
| ADOPTED | Code already on the working branch. |
| PORT | Port only the named hunks into the named queue packet; never the `.agent-control` rewrites. |
| EVIDENCE | Input to a packet or decision; no code port. |
| DEFER | Product value later (V1+). |
| CONTROL | Control-plane work; a ChatGPT/#80 decision. |
| DOCS | Documentation placement ruling needed (main vs intel branch). |
| STALE | Superseded or out of date. |
| NONE | No v1 value. |

Counts: ADOPTED 1, CONTROL 15, DEFER 8, DOCS 10, EVIDENCE 3, NONE 9, PORT 9, STALE 4.

| PR | Base | Class | Queue link | Note |
|---|---|---|---|---|
| #38 KEY IRONCLAD — The 9 Layers of Consciousness | main | STALE | — | Services already on main and further evolved; the 10 endpoints are superseded by POST conscious/chat (PRS-M38). |
| #63 Free contact enrichment by default (no paid account); Apollo now optional | main | DEFER | V1+ | A CONTACTS-v1 non-goal. Fetches by default; parsing and SSRF fixes needed (PRS-M14). |
| #90 chore: optimize Copilot code review for KEYFLOWOS | main | STALE | — | Folded into #94, which #104 superseded (PRS-M10). |
| #91 chore: align KEYFLOWOS runtime with Node 24 for Vercel | main | PORT | V1-39 | Runtime-pin pieces only, after D-21. Web-build Prisma scoping is V1+ (PRS-M04, M57). |
| #94 KF-AI-PR-REVIEW-GATE-001: exact-head AI review admission gate | main | STALE | — | Superseded by #104's provider-neutral review (PRS-M10). |
| #105 docs: canonical KEYFLOW Connector Fabric architecture | intel branch | DOCS | — | Connector Fabric architecture (P2-6); needs a placement ruling. |
| #107 KF-META-BRANCH-ROLES-001: base-aware divergence and canonical branch roles | main | CONTROL | — | Base-aware divergence; the job rename may orphan a required check (PRS-M43). Needs D-32. |
| #111 KF-META-DISPATCH-QUEUE-001: per-packet authority queue foundation | main | CONTROL | — | Authority-queue library, never wired into select-directive (PRS-M41). |
| #112 KF-META-CONTEXT-GENOME-001: shared temporal context substrate foundation | main | DEFER | V1+ | Context genome (P2-7). validFrom is set from verification time (PRS-M37). |
| #114 KF-META-PROOF-INTEGRITY-001: eliminate fake green and hidden proof skips | main | PORT | V1-01, V1-13, V1-30 | Port only the audit-outcome capture, the native DAST harness and the gate swap. The worker GH_TOKEN fix is CONTROL (PRS-M07/M08/M09/M49). It keeps base: main, so it must not be ported alone. |
| #127 KF-META-MEMORY-TRUTH-AUDIT-001: executable static memory proof baseline | main | DEFER | V1+ | Memory truth audit. The DORMANT class can never fire (PRS-M36). |
| #128 KEY cognitive architecture archaeology and convergence pass 001 | intel branch | DOCS | — | KEY cognitive archaeology. Its ledger direction is superseded by the product-first plan (PRS-M53). |
| #133 KF-ASSURANCE-FABRIC-001: risk-derived proof obligation compiler | main | NONE | — | Development-system proof compiler placed inside the product API (PRS-M51). |
| #134 KF-LEARNING-STREAM-001: make existing knowledge ingestion safely reachable | main | DEFER | V1+ | Quarantine-first ingestion is only valid once search_knowledge gets a status filter (PRS-M31). |
| #136 KF-META-PROCEDURAL-MORPHOGENESIS-001: canonical contracts and experiment foundation | main | DOCS | — | Procedural morphogenesis contracts (PRS-M52). |
| #139 KF-KEY-NATIVE-CAPACITY-SHADOW-001: latent read-only capacity loop | main | NONE | — | Daily cron that mines #80; conflicts with main (PRS-M51). |
| #141 KF-ATLAS-001: establish the KEYFLOWOS Living System Atlas foundation | main | NONE | — | Atlas foundation; cites the closed #132 as built (PRS-M45/M46). |
| #142 KF-ATLAS-MATERIALIZER-001: deterministically materialize the Living System Atlas | docs/kf-living-system-atlas-001 | NONE | — | Atlas materializer; outputs never generated (PRS-M46). |
| #143 KF-ATLAS-INTELLIGENCE-001: import canonical journeys kernels and contradictions | impl/kf-atlas-materializer-001 | NONE | — | Atlas intelligence import; stale snapshot (PRS-M46). |
| #144 KF-ATLAS-PACKET-SEMANTIC-INDEX-001: map packets to journeys and kernels | impl/kf-atlas-intelligence-import-001 | NONE | — | Atlas packet semantic index (PRS-M46). |
| #145 KF-ATLAS-CODE-LINKS-001: verify packet seams against current code | impl/kf-atlas-packet-semantic-index-001 | NONE | — | Atlas code links; the backslash path guard can be bypassed (PRS-M46). |
| #146 KF-MISSION-CONTROL-ATLAS-READMODEL-001: build the owner Atlas control panel foundation | impl/kf-atlas-code-links-001 | NONE | — | Mission-control Atlas panel; collides with #179 on api/admin/mission-control (PRS-M45). |
| #148 KF-MEMORY-CONTEXT-GENOME-PLAN-001: converge KEY memory into a portable evidence-grounded world model | impl/kf-mission-control-atlas-readmodel-001 | DEFER | V1+ | Memory plan: the destructive-consolidation claim is wrong, and the dedupe hash falls back to now() (PRS-M35). |
| #149 KF-AGENT-PARALLEL-ORCHESTRATION-PLAN-001: scale Claude safely across multiple packet worktrees | main | CONTROL | — | Parallel orchestration plan, gated on ACTION-001, which has since merged (PRS-M53). |
| #150 KF-OPEN-PR-CONVERGENCE-001: classify and converge every open PR | main | STALE | — | Convergence board from 2026-10-06 (39 open then vs 59 now) (PRS-M47). |
| #152 KF-META-PR-UNLOCK-CONTRACT-001: make PR value/unlocks explicit and testable | main | CONTROL | — | Would make an unlock YAML mandatory for every PR to main (PRS-M50). |
| #154 docs(rnd): establish durable multi-lens research corpus | intel branch | DOCS | — | R&D corpus with a prototype compile-context script (PRS-M52). |
| #155 KF-EXEC-AUTH-FAIL-CLOSED-001: parsed-command autonomy fails closed | main | PORT | V1-02 | Port the parsed-command fail-closed block and its 11 tests, byte-equivalent to 26c10943. Admission is blocked by #184 (PRS-M19/M21/M22). |
| #156 docs(rnd): cross-converge book corpus with GenAI stack | docs/rnd-corpus-foundation-001 | DOCS | — | Book/GenAI convergence; stale against its research base (PRS-M52). |
| #157 KFCI-2026-10-06-01: converge active streams and repair intelligence continuity | intel branch | DOCS | — | Convergence introspection; pins main to ac3a6384 (PRS-M53/M43). |
| #158 fix(ai): tenant-scope BusinessGoal progress writes | main | DEFER | V1+ | Goal tracker; the tenant extension already blocks cross-tenant writes (PRS-M34). |
| #160 fix(ai): route KEY command intake through canonical capability | main | PORT | V1-09 | Port only the @@ -200 bare-name routing hunk. The @@ -173 message_intake remap is not equivalent and is not ported (PRS-M28/M29). |
| #161 feat(ai): canonicalize KEY finance intelligence capabilities | main | DEFER | V1+ | Canonical finance read tools (P2-2) (PRS-M33). |
| #162 feat(cortex): add operational KEY self-model projection | main | DEFER | V1+ | KEY self-model with no consumer (P2-7) (PRS-M32). |
| #163 feat(intelligence): harvest historical project-thread knowledge | main | DOCS | — | Thread harvester; pytest has no CI runner and its output directory is not ignored (PRS-M54). |
| #164 docs: establish R&D external intelligence convergence contract | main | DOCS | — | R&D external intelligence contract (PRS-M52). |
| #165 KF-INTEL-LOOP-001: Continuous intelligence and reconciliation contract | main | DOCS | — | Continuous intelligence loop; overlaps #164 (PRS-M52). |
| #167 docs(rd): skills-first harness convergence hypothesis and pilot | intel branch | DOCS | — | Skills-harness R&D (PRS-M52). |
| #168 KF-PR-INVENTORY-001: extract bounded complete PR discovery from #150 | main | CONTROL | — | PR inventory; byte-identical extraction of #150; one of three rival discovery fixes (PRS-M39/M47). |
| #169 fix(agent-control): a worktree the host can hold, and a worktree failure that is counted | main | CONTROL | — | Windows worker worktree-path repair (PRS-M44). |
| #170 feat(agent-control): the hourly sweep sees every open PR, and may merge no more than before | main | CONTROL | — | PR discovery for the sweep; file conflict with #185; no directive (PRS-M39/M41). |
| #171 feat(agent-control): look again for an AUTO_MERGE record that was never posted | main | CONTROL | — | AUTO_MERGE record audit; no directive (PRS-M41/M42). |
| #172 feat(agent-control): see what the worker is doing, and which gates main has moved under | main | CONTROL | — | Agent-control observability; the only PR that textually conflicts with main (PRS-M40). |
| #173 docs(control): where each kind of truth lives; the checkpoint is not live state; TIME-001 admission preparation | main | EVIDENCE | V1-35 | Canonical load path and TIME-001 admission prep; its 'one claimant' obligation feeds the poller claim (PRS-M18). |
| #174 docs(backlog): correctness and reliability candidates read from main | main | EVIDENCE | V1-10, V1-12, V1-19, V1-35 | Reliability backlog (KEY-01..04, REL-01..04). AC-01/AC-02 are withheld (D-24). |
| #175 fix(agent-control): one worker per repository and issue; every pre-wake failure counted (stacked on #169) | fix/agent-control-worker-worktree-path-001 | CONTROL | — | Worker machine lock, stacked on #169 (PRS-M44). |
| #176 docs: propose the multi-AI review architecture (GPT-6 independent review, risk-adaptive gates) | main | CONTROL | — | Multi-AI review architecture; partly stale against merge-grant.mjs (PRS-M48). |
| #177 docs(programme): integrated execution and recovery plan (inactive) | main | CONTROL | — | Integrated recovery programme (inactive). |
| #179 KF-META-HANDOFF-MONITOR-001: read-only handoff viewer (H1, draft) | main | NONE | — | Handoff viewer; collides with #146; unavailable in the production image (PRS-M45). |
| #180 docs(intelligence): accepted roadmap, P0/H1 review evidence and continuation | intel branch | PORT | V1-04 | Port only flow-policy-candidate.patch, the oversight selective-failure fix. The 164-file docs need a placement ruling (PRS-M23/M52). |
| #182 fix(key-cortex): consume BatchResult without uncertain execution replay | main | PORT | V1-02 | BatchResult mapper and its 12 cases, actually executed this time; merges cleanly with #155 (PRS-M20/M21). |
| #183 docs(programme): programme appraisal 2026-10-21, draft directive bundle, audit credential removed from source | main | PORT | V1-01 | Port only the credential removal; the appraisal and directive bundle need placement (PRS-M06). |
| #184 KF-META-AI-REVIEW-QUOTA-WORDING-001: recognize the Copilot bot's current quota wording (draft, no merge authority) | main | CONTROL | — | Copilot quota wording; unblocks #155's admission (PRS-M22). Needs D-32. |
| #185 KF-META-AUTOPILOT-SWEEP-COVERAGE-001: list the hourly sweep's candidates completely (draft, no merge authority) | main | CONTROL | — | Paged sweep lister; 15 impl/ PRs, #155 among them, are past the 30-item page (PRS-M39). Needs D-32. |
| #187 docs(release): identify production DB contradiction and preserve read-only findings | main | EVIDENCE | D-20 | Production DB contradiction, 443 vs 29 tables (PRS-M03). |
| #188 fix(ops): prevent false-green launch verification on degraded HTTP 200 | main | PORT | V1-20 | verify-up degraded-200 fix, its specs and a CI step (PRS-M01). |
| #189 fix(security): reject vacuous secret scans and unsurfaced scanner failures | main | PORT | V1-01 | Secret-scan range, pinned action and fail-closed contract (PRS-M07). |
| #190 KF-PRODUCT-CONTACTS-PILOT-001: contact detail applies the caller's CRM visibility (draft, no merge authority) | main | ADOPTED | R0-01 | Byte-identical on the branch via 610ecaa2. The exact-head merge grant is outstanding (D-01) (PRS-M11). |
| #191 docs(agent-control): worker ownership hardening proposal 001 (document only, no merge authority) | main | CONTROL | — | Worker ownership proposal; admission choice unresolved (PRS-M41). |

---

## (f) Coverage ledger

| Corpus | Total | Mapped here | How it was read |
|---|---|---|---|
| Canonical journeys (KF-JOURNEY-001..026) | 26 | 26 | Corpus lanes journeys-1..5 read the dossiers. This author mapped each by title and the lane findings. |
| Kernels (KF-KERNEL-001..012) | 12 | 12 | Corpus lanes kernels-1..3 read the dossiers. This author mapped them the same way. |
| Execution packets on the wave board | 35 | 35 | Corpus lanes packets-1..6; this author read the wave board directly. |
| Open PRs | 59 | 59 | 10 PR-family lanes. This author re-fetched the list through REST. |
| Product domain lanes | 12 | 12 | auth-business, cockpit-web-shell, contacts-crm, quotes-invoices, payments-ledger, public-commercial, storefront-site-portal, bookings-calendar, key-command, flows-events-playbooks, data-model-tenancy, infra-ci-harness |

**Journeys mapped to packets**

| Journey | Packets (R0 / V1) or disposition |
|---|---|
| 001 Business birth | R0-05, R0-06, R0-09, R0-14, R0-18 |
| 002 KEY request → governed action | V1-02, V1-03, V1-04, V1-09, V1-31, V1-32 |
| 003 Lead → customer → cash | R0-03, R0-12, R0-13, R0-17, R0-20, R0-27 to R0-30 |
| 004 Booking → service → payment | V1-06, V1-16, V1-27, V1-28 |
| 005 Conversation → business action | V1+ (CONVO-001, inbound tenant binding) |
| 006 Proactive KEY autonomy | V1-24 (off switch). Autonomy itself is V1+ (P2-7). |
| 007 Financial truth | R0-17, R0-20, V1-15, V1-22, V1-29, V1-34, V1-36, V1-37, V1-44 |
| 008 Project work delivery | V1+ (P2-4, F228) |
| 009 Marketing lead generation | V1+ (P2-3, GROWTH-001) |
| 010 Commerce fulfilment | V1-18, V1-33 |
| 011 Contract → obligation → renewal | V1-12 (recurring guard). Contracts are V1+. |
| 012 Document evidence lifecycle | V1-41. Documents are V1+. |
| 013 Connector lifecycle | V1+ (CONNECTOR-001) |
| 014 Webhook / external ingress | V1-05. Lifecycle is V1+ (INGRESS-001). |
| 015 Approval governance lifecycle | V1-31, V1-32, V1-07 |
| 016 Business genome evolution | R0-09 (business config). Genome lineage is V1+ (KNOWLEDGE-001). |
| 017 Command-center priority action | R0-10, V1-25 |
| 018 Failure recovery | R0-17, V1-12, V1-35. Operator projection is V1+ (RECOVERY-001). |
| 019 Privacy deletion and exit | V1-38. Derived state is V1+ (PRIVACY-001). |
| 020 Plan, subscription, AI cost | R0-07 (cost ledger), D-12. ENTITLE-001 is V1+. |
| 021 Public customer experience | R0-22, R0-24, R0-26, R0-30, V1-05, V1-14, V1-23, V1-46 |
| 022 KEY voice | V1-14 (stream tenant binding). Metering is V1+. |
| 023 Temporal flow / long-running workflow | V1-10, V1-35. TIME-001 and TEMPORAL-002 are V1+. |
| 024 System change / engineering safety | R0-16, R0-25, V1-01, V1-13, V1-20, V1-30, V1-39, V1-40 |
| 025 Human authority lifecycle | R0-05 (removal and role freshness), V1-07, V1-21 |
| 026 Business network sourcing / B2B | V1+ (NETWORK-001) |

**Kernels mapped to packets**

| Kernel | Packets or disposition |
|---|---|
| 001 Tenant genesis and identity | R0-05, R0-14, R0-18 |
| 002 Human authority and organization | R0-09, V1-07, V1-21 |
| 003 KEY authority governance | V1-02, V1-03, V1-04, V1-09, V1-24, V1-31, V1-32 |
| 004 Business knowledge | V1+ (KNOWLEDGE-001/002; PRs #112, #134) |
| 005 Capability fabric | V1-09 (canonical capability routing). D-1 consolidation is V1+. |
| 006 State transition | R0-17, R0-28, V1-42 |
| 007 Temporal, event and workflow | R0-19, V1-12, V1-24, V1-35 |
| 008 Evidence and outcome | R0-11, R0-19, V1-25 |
| 009 Integration and external reality | R0-07, V1-05 |
| 010 Financial truth | R0-17, R0-20, R0-21, V1-15, V1-22, V1-29, V1-34, V1-36, V1-37, V1-44 |
| 011 Recovery and reliability | R0-17, V1-12, V1-19, V1-35 |
| 012 Engineering control plane | R0-01, R0-02, R0-16, R0-25, V1-01, V1-30, V1-40 |

**Execution packets (wave board) mapped to packets**

| # | Packet | Board state | Mapping |
|---|---|---|---|
| 1 | K12-001 | CHECKPOINTED | R0-16 extends it with Release 0 manifests and verdict source identity. |
| 2 | EXTFX-001 | CHECKPOINTED | No new work. R0-07 respects its effect semantics. |
| 3 | TENANT-001 | CHECKPOINTED | R0-05 extends the proof. Backfill receipts are V1+. |
| 4 | AUTH-001 | CHECKPOINTED | The resolver stays shadow-only. AUTH shadow on Release 0 routes is V1+. |
| 5 | ACTION-001 | CHARACTERIZING on the board, but merged in PR 147 (`ac3a6384`) | The status record needs D-23. V1-31 extends the boundary. |
| 6 | TIME-001 | not started | V1-35 (one claimant). The rest is V1+ (D-29). |
| 7 | INGRESS-001 | not started | V1-05 partly. Lifecycle is V1+. |
| 8 | CONNECTOR-001 | not started | V1+ |
| 9 | TEMPORAL-002 | not started | V1+ |
| 10 | RECOVERY-001 | not started | V1+. R0-17 closes the payment crash window. |
| 11 | CONVO-001 | not started | V1+ |
| 12 | PLAYBOOK-001 | not started | V1+. R0-19 removes the duplicate feed writer. |
| 13 | COMMERCIAL-001 | not started | R0-27 to R0-30, V1-42, V1-43 |
| 14 | BOOKING-001 | not started | V1-28 (deposit and final settlement) |
| 15 | FINANCE-001 | not started | R0-17, R0-20, V1-15, V1-34, V1-37 |
| 16 | DELIVERYBILL-001 | not started | V1+ |
| 17 | COMMERCE-001 | not started | V1-18, V1-33 |
| 18 | ENTITLE-001 | not started | V1+. D-12 covers the FREE plan cap. |
| 19 | GROWTH-001 | not started | V1+ |
| 20 | KNOWLEDGE-001 | not started | V1+ |
| 21 | KNOWLEDGE-002 | not started | V1+ |
| 22 | COMMAND-001 | not started | R0-10, V1-25 |
| 23 | PUBLIC-001 | not started | R0-22, R0-24, R0-26, V1-14, V1-16, V1-23, V1-46 |
| 24 | SPACE-001 | not started | V1+ |
| 25 | VOICE-001 | not started | V1-14 partly. The rest is V1+. |
| 26 | PRIVACY-001 | not started | V1-38 partly. The rest is V1+. |
| 27 | NETWORK-001 | not started | V1+ |
| 28 | UX-001 | not started | R0-06, R0-08, R0-15, R0-18, R0-21, R0-23 |
| 29 | EXPERIENCE-001 | not started | R0-06, R0-08, R0-10 (minimal). Studio and virality are V1+. |
| 30 | WITHDRAW-001 | not started | V1-15 and V1-42 ratchets partly. The rest is V1+. |
| 31 | WITHDRAW-002 | not started | V1+ |
| 32 | MIGRATE-001 | not started | V1+ (drift gate). V1-17 and V1-45 follow its migration discipline. |
| 33 | INTEGRATED-001 | not started | R0-16 and R0-25 partly (Release 0 journey only) |
| 34 | OPS-001 | not started | R0-07 (`/readyz`), V1-20. The rest is V1+. |
| 35 | RELEASE-001 | not started | V1+. Staging and deployment need D-20. |

**What was not read, and what was not run, in this step**

- Issue #80 was not re-read in this step. `gh issue view` is blocked on GraphQL; REST works. The latest DIRECTIVE/REVIEW on the queue is therefore unverified (see D-01).
- The 26 journey and 12 kernel dossiers were mapped from lane-condensed findings and titles, not re-read in full by this author.
- These were cited through lanes, not re-read: `modules/*-v1.md` (AUTH-BUSINESS, CONTACTS, INVOICING, PAYMENTS-LEDGER, PUBLIC-COMMERCIAL), `REVENUE-GAP-REPORT-001.md`, and the governance census files (`IRONCLAD-ASSURANCE-CENSUS.md`, `CATASTROPHIC-FAILURE-REGISTER.yaml`).
- #174's withheld findings AC-01 and AC-02 are not in the repository or on #80 (D-24).
- Branch protection and required checks could not be read (403).
- Production was not accessed (read-only by rule).
- The Release 0 journey was not run at exact `9c1163c1` or `87ca2b90` (reason in section b). No other suite was run for this map.
- The tenant-extension model count (77 vs about 330) was not re-counted.

---

## (g) Open decisions for the owner (and ChatGPT where marked)

| Id | Decision | Gates |
|---|---|---|
| D-01 | **Admission path (ChatGPT, #80).** 42 branch commits are not on main. PR #190 has no exact-head merge grant. In what order, and by which PRs, should landed packets reach main? | admission of everything; execution is not blocked |
| D-02 | **Release 0 sign-in.** Does hosted Supabase (free tier, network required) satisfy "no required paid external API"? If not: option A, self-hosted GoTrue in compose; or option B, a bounded local issuer that reuses the existing HS256 verifier. | R0-14 |
| D-03 | **Onboarding.** Must the three-pillar genome gate (DNA ≥ 50) hold for Release 0, or may a minimal business profile complete onboarding? | R0-06 (and any server change) |
| D-04 | **Quote OR invoice.** Is the quote branch in Release 0? If invoice-only, R0-28 to R0-30 move unchanged to V1. | R0-28, R0-29, R0-30 |
| D-05 | **Mark-paid.** Should operator mark-paid without an amount record the remaining balance (as assumed), or require an amount? Is the bounded change to the legacy `/webhooks/stripe` handler (`webhooks.controller.ts:86-91`) authorized, so RA-G16-01 can leave deferral? | R0-20 |
| D-06 | **Public payment intent.** Is PENDING recorded only on payment rows, never as invoice status? Should anonymous bare-id intent stay, or require a live token? | R0-22 |
| D-07 | **Public pay surface.** Retire or token-gate `/pay/:invoiceId`? What default TTL for PaymentLink? Receipt for PAID only, or PARTIALLY_PAID too? Opt-in disclosure of bank-transfer instructions, or hide that option? | R0-24, R0-26, V1-46 |
| D-08 | **Canonical evidence.** Activity for the user feed and BusinessEvent for the audit trail (assumed), or another split? | R0-19, V1-25 |
| D-09 | **Navigation labels.** "Cockpit" or "Command Center" for `/app/command-center`? "Sales" or "Revenue" for `/app/commerce`? | R0-08 |
| D-10 | **Business selection.** Is implicit selection enough for "selects a business"? Should bootstrap prefer an existing membership when the user owns nothing? | R0-18 |
| D-11 | **Authority policy.** `settings:write` for business config? SUPER_ADMIN seed env-gated in production? RA-G4-13: SUPER_ADMIN mark-paid answers 500 on main and 403 after the fix; should the service admit SUPER_ADMIN instead? Membership suspension state? | R0-09, R0-02 (todo case) |
| D-12 | **Plan limits for the Release 0 tenant.** FREE caps at 5 invoices/month and 50 contacts. Enforce or remove `quotesEnabled=false`? | staging journey |
| D-13 | **Money precision and currency.** Cents-safe arithmetic on Float storage for v1, with Decimal staged later? Single currency per business? Which currencies are supported? | V1-22, V1-37 |
| D-14 | **Refunds.** Separate negative REFUNDED rows for manual refunds? Should a fully refunded invoice go to SENT (paidAt cleared) or to a new REFUNDED state? | V1-29 |
| D-15 | **Numbering and create idempotency.** Sequential per-business numbers from the next value, without renumbering existing rows? Idempotency key in a header or the body? Is an isolated migration for create keys acceptable? | V1-43, V1-45 |
| D-16 | **Contacts index.** Accept the SQL-only partial unique index (`bank_transactions` precedent) for contact email/phone? | V1-17 |
| D-17 | **KEY.** Which pipeline is canonical (Flow vs Cortex)? Name and semantics of the off switch (`KEY_DISABLED` vs the storefront-only `AI_DISABLED` vs default oversight 'restricted')? Port the #155 and #182 hunks as specified? When do the KEY packets run relative to R0? | V1-02, V1-03, V1-09, V1-24, V1-31, V1-32 |
| D-18 | **Storefront.** Is product checkout in P1-4 scope? Formally retire the KEYPORTAL backlog in favour of presence plus `/book`? | V1-18, V1-33 |
| D-19 | **WiPay.** What are the provider's documented hash inputs, and does a secret belong in the hash? (V1-05 fails closed either way.) | V1-05 |
| D-20 | **Production and staging.** Which host and database are production (Hetzner Compose with 443 tables, the 29-table Supabase, or Render)? Which staging target satisfies issue #186 steps B and E? Is `0_baseline` recorded as applied? | any deploy; DM-008 |
| D-21 | **Node runtime.** 20.18.1, 22.x or 24.x? Who authorizes changing the agent-control workflow pins? | V1-39 |
| D-22 | **CI gates (ChatGPT, #80).** Blocking security scans, the DAST required-gate swap, the agent gate for `pkt/*`, and the trust-census owner. | V1-01, V1-30, V1-40 |
| D-23 | **Wave law (ChatGPT, #80).** Record an exception so Release 0 money, public and cockpit work proceeds ahead of Waves B to D. Correct the ACTION-001 status (merged in PR 147, recorded as CHARACTERIZING). Rule on whether KF-DEC-013 and 07-CURRENT-STATE are superseded. | programme admission |
| D-24 | **#174's withheld findings** AC-01 (confirmed) and AC-02 (likely). Route them privately into the queue if they touch tenant isolation. | possibly R0 |
| D-25 | **Contacts.** DEC-CONTACTS-001 (firstName) and DEC-CONTACTS-002 (is ContactAuditEntry mandatory?). Is GDPR purge in v1, or disabled with a visible marker? | V1-38; CT-BP-06 (V1+) |
| D-26 | **Bookings.** Cancel-after-deposit policy: refund, credit note or forfeit? | V1-28 (cancel part) |
| D-27 | **Untrusted money inputs.** Evidence-extracted and Drive-intake payments: PENDING until confirmed, or removed? | V1-41 |
| D-28 | **Credit notes.** Are FULLY_CREDITED and PARTIALLY_CREDITED workflow states, or retired enum values? | V1-44 |
| D-29 | **Poller claim.** Run it standalone, or absorb it into KF-EXEC-TIME-001? | V1-35 |
| D-30 | **Operator action.** Rotate the test-account credential committed in `audit-keyflowos.py` and `audit-mobile-quick.py`; it remains in git history. | V1-01 completion |
| D-31 | **Concurrency.** May V1 groups with zero file overlap start before the R0 exit gate? | V1 start |
| D-32 | **Control-plane PRs (ChatGPT, #80).** Which PR-discovery implementation becomes canonical (#185, #170 or #168)? Base-aware divergence (#107)? #184 quota wording, which unblocks #155's admission? | not product |
