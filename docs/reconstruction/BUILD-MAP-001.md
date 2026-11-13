# KEYFLOWOS Build Map 001

```yaml
document_id: BUILD-MAP-001
revision: 2   # post-judge revision; supersedes the draft committed at dae49f5d
companion: docs/reconstruction/BUILD-QUEUE-001.json   # machine-readable queue; this file explains it
prepared: 2026-10-31
working_branch: claude/elegant-curie-7azpsb
branch_head_at_revision: dae49f5d   # the draft docs commit
code_head_at_revision: c2f6f46d     # 87ca2b90 + R0-PC-01 and R0-PL-07 (merged at 7183c364) + ST-PC01-1
main: b1948d27
authority: build plan only. No merge to main, no production access, no provider traffic, no PR closed or merged.
review_status: PENDING_CHATGPT_REVIEW
```

This map turns three condensed family maps (product domains, programme corpus, open-PR triage) into one ordered, tests-first build queue. It was also checked against these sources:

- **Scope and constitution:** `docs/reconstruction/product/V1-MODULE-SCOPE.md` and `docs/reconstruction/product/VOLUME-01-CONSTITUTION.md` (read from origin/docs/keyflow-reconstruction-20261029, tip `1b143fa3`; in this repository since the 2026-11-12 tie-off).
- **Wave board:** `docs/intelligence/execution/IMPLEMENTATION-WAVE-EXECUTION-BOARD.md` (read from origin/docs/keyflow-intelligence-foundation; in this repository since the 2026-11-13 tie-off, D-141, as a dated historical record).
- **Release 0 target:** issue #186, read through the REST API.
- **Revenue test contract:** `REVENUE-AUTH-NEGATIVE-CONTROLS-001.md`, revision 2.
- **Live repository state:** the branch log, the packet branches and worktrees, and the latest local journey run.

Revision 2 applies three independent judgements of the draft: release0-first, correctness and evidence, and parallel safety. Section (h) lists every blocking issue and what changed. The family maps are not committed to the repository, so section (f) now carries an ID ledger that places every M, CF and PRS finding.

**Rules applied to every packet:**

- **Code reuse.** Reuse existing modules. No rewrites, no new providers, and no schema migration unless the packet proves one is unavoidable. The one migration packet left (V1-17) runs alone in the main tree. Packets that may discover a schema need (R0-14 option B, V1-29, V1-33, V1-44, V1-45) carry a stop rule instead.
- **Tests and proof.**
  - Tests are written first and committed before the fix.
  - Every defect fix records a pre-fix red result at an exact SHA.
  - Every money packet asserts ledger rows (balanced postings, posting counts, or "nothing posted"). Release 0 ledger checks use refund-free fixtures, because the refund arithmetic is wrong on this base (M28, fixed by V1-29).
  - Every Release 0 server suite is bound by a K12 case manifest that its own packet adds. R0-35 proves none was missed.
- **Isolation.** Every real-DB packet runs on its own database and Redis index with a registered fixture prefix (R0-00). Resources are listed in section (f).
- **Ordering.** `depends_on` holds logical dependencies, owner decisions, and file-order edges: any two packets that write the same file are connected by a dependency path. So the queue is safe to run as a DAG without group barriers. Within each file chain, packets gated on a decision come after decision-free ones, so a pending ruling never blocks unrelated work.
- **Citations.** File:line citations are at c2f6f46d unless a SHA is named. `commerce.service.ts` and `commerce.controller.ts` moved in 7183c364 (by 30 to 99 lines), so citations carried from the draft say "at 87ca2b90".
- **Deferred work.** Deferred items stay in the V1+ backlog with their sources. Nothing is deleted.

---

## (a) Current state per domain

State is described at code head `c2f6f46d`, not at main (CF-01). Every product fix since main (`b1948d27`) is on the branch only and unadmitted. The 50 code commits on the branch include:

- Contacts visibility (PR #190 code).
- KF-REVENUE-AUTH-PROJECTION-001, which also fixed the harness defects R0-D4 and R0-D5.
- The Release 0 journey harness.
- R0-D1, R0-D2, R0-D3, R0-D6 and R0-D7.
- R0-QI-01, R0-CT-03, R0-PC-01 and R0-PL-07.

| Domain | State on the branch | Evidence | Open gaps, each with its packet |
|---|---|---|---|
| Auth, business, tenancy | **Works at API level; real-DB proven.** The guard chain is AuthMiddleware (local HS256 or Supabase) → AuthGuard → BusinessGuard → ModuleScopeGuard → TenantInterceptor. Genesis writes the Business and one founding OWNER membership atomically. Bootstrap is a Serializable find-or-create. | `core/auth/request-business-id.ts`; `test/tenant-founding-membership.integration.test.ts`; journey steps 1 and 6 | Onboarding needs an LLM, and the server refuses completion below the three-pillar minimum (M07): R0-06 and R0-32, gated on D-03. No sign-in path works without Supabase (M02): R0-14, gated on D-02; this is a Release 0 failure only if D-02 rejects hosted free-tier Supabase. No business selection (M03): R0-18. Config PATCH has no settings scope, and a hard-coded email is promoted to SUPER_ADMIN on every boot (M04): R0-09. The username-oracle throttle is V1-56. The interceptor resolves the tenant by truthiness (CF-24): R0-05, in flight. Invite and JobRole ceilings (CF-26/27): V1-07, V1-21. |
| Cockpit and web shell | **Routes render; the browser journey is blocked at onboarding.** `useGenomeGate`, mounted at `apps/web/src/app/app/layout.tsx:41`, sends every new owner to an LLM-only chat page until `onboardingComplete` is set. | `hooks/use-genome-gate.ts:61-121`; `app/app/onboarding/page.tsx` renders only KeyOnboardingChatView, and `completion-step.tsx` is not mounted | No manual onboarding path (M07): R0-06 with R0-32. A 403 renders as empty data and calls silently default to `biz_demo` (M09): R0-15, in flight, narrowed to the Release 0 screens. Dead deep links and no Invoices/Quotes nav entry (CF-20/21, M08): R0-08. The cockpit turns a failed source into zero (CF-19): V1-47 (formerly R0-10; not a #186 step). No web Release 0 test and no Playwright in CI (M58): R0-23, R0-25. D-2 sprawl: V1+. |
| Contacts | **CRUD plus record visibility on list, detail and dossier are proven.** 28 real-DB cases cover visibility. A duplicate email or phone answers 409. Contact mutations record the acting user (R0-CT-03). | `test/contacts-visibility.integration.test.ts`; `test/crm-contact-duplicate.integration.test.ts`; `test/contacts-audit-actor.integration.test.ts` | Cross-tenant reads of custom-field values and flow-run steps (M14): R0-12. Route shadowing and call-log attribution (M15): V1-54. DELETE, denial and validation lack real-DB proof (CF-03): R0-13. 14 sibling reads check the tenant only (M13): V1-08. A soft-deleted holder blocks re-creating the contact (M12): V1-17. tRPC paths (M06): V1-26. Purge honesty (CF-48): V1-38. |
| Quotes and invoices | **Invoice create, issue and detail are tenant-bound and scope-checked.** Errors answer 404/409/400 (revenue auth, R0-D3, R0-QI-01). The bare-id quote detail is retired to 404 (R0-PC-01). Public bare-id reads are redacted and rate-limited. | `commerce.controller.ts:738-746` (retired quote GET); `test/revenue-authorization.integration.test.ts`; `test/commerce-invoice-errors.integration.test.ts`; `test/commerce-quote-visibility.integration.test.ts` | Invoice create validates nothing and links a foreign tenant's contact (M19, CF-37): R0-27. The quote status route has no write scope and leaks a cross-tenant 500 (M21): R0-28. If D-04 picks quotes: state machine V1-50, quote errors V1-53, conversion tax (M20) V1-51, provider-free quote link (CF-16) V1-52. Numbering and create idempotency (M22): V1-43, V1-45. Writers bypass the lifecycle (CF-39): V1-42. Recurring guard: V1-12. |
| Payments and ledger | **The core is sound.** The 8-state machine, `computeBalance`, balanced idempotent posting, and a payment row plus posting in one transaction all work. The COA seed race is fixed (R0-D1), manual-payment idempotency is server-side (R0-D2), and payments and refunds record the acting user (R0-PL-07). Journey step 4 is green with balanced entries. | `invoice-workflow.service.ts`; `finance/posting.service.ts`; `test/commerce-payment-idempotency.integration.test.ts`; `test/payments-actor.integration.test.ts`; journey step 4 | DRAFT payments are accepted, and reconcile runs outside the transaction (M27): R0-17, in flight. Mark-paid writes an unposted payment (CF-09): R0-20 (D-05). The web sends no idempotency key, and the modal sums every payment status (M26/M29): R0-21. A refund flips the row to REFUNDED and `computeBalance` subtracts it twice; refunding a PENDING row is accepted and the reconcile error is swallowed (M28, CF-11): V1-29. Float precision (M23): V1-22. Currency (CF-38): V1-37. Ledger write door (CF-40): V1-15. Cash position (CF-41): V1-34. Credit notes (CF-42): V1-44. Payment sits outside the tenant extension (M31): V1+ (DM-008); each Release 0 Payment reader or writer carries a foreign-tenant control on Payment rows. |
| Public commercial | **Token invoice view, token quote view and token accept work.** The bare-id invoice read returns a redacted projection, and the status route returns five keys. | `commerce.controller.ts:752` (public quote by token) and `:1258` (public invoice link); `test/commerce-public-quote.e2e.test.ts` | An anonymous payment intent flips another tenant's invoice to PENDING, which hides it (CF-12): R0-22, a step-6 fix. The link shows no paid/remaining, and tokens are cuids (CF-18, M34): V1-48 (D-07). No customer receipt (M24): V1-49 (D-07). The bare-id pay page downgrades every token (M34): V1-46. WiPay and PayPal callbacks (M35): V1-05. |
| Storefront, site, portal | **Presence plus `/book` work and honour `storeEnabled`** (CF-56). | `site.service.ts:145-151` | Portal grants bind a foreign tenant's contact (CF-46): R0-33, a step-6 fix. CONFIRMED emits "paid", and F206 creates a second invoice (M37): V1-18. Checkout retries and CASH completion: V1-33. Public projections (M36): V1-23. The portal validate limiter is inert (M38): V1-14. Portal web route and KEYPORTAL backlog: V1+, gated on D-18. |
| Bookings | **REST routes, overlap guard, real-DB waitlist and calendar projection.** | `bookings.service.ts:556-679`; `test/booking-waitlist.integration.test.ts` | Core tests are mock-only, and the in-app path lacks parity with the public one (M40/M41): V1-06. Slot race and timezone: V1-16. Writers bypass the guard: V1-27. Settlement, `paymentStatus`, and the dead confirm hook (M42): V1-28. |
| KEY | **Optional on the server but mandatory in the browser.** The journey runs with `AI_DISABLED=1`; browser onboarding requires KEY (see the cockpit row). | journey step 7; M07 | Cortex audit routes call services with no tenant (PRS-M30): R0-34, a step-6 fix. Fail-open autonomy and batch replay (M45): V1-02. Client-supplied principal and the autonomy-profile kill switch: V1-03. Oversight selective failure: V1-04. `/key/command` governance (M44): V1-09. Planner and idempotency claims: V1-10, V1-19. Kill switches (M47): V1-24. Confirm binding and proposal claim (M46): V1-31, V1-32. The phone stream binds a tenant from the query string (CF-47): V1-14; live only when an OpenAI key is configured. |
| Flows and events | **Four event stores and no canonical feed.** A manual payment writes several Activity rows, the payment audit row is labelled `invoice.create`, and the business feed is not mounted. | `business-event.interceptor.ts:113-138` (inferEventMeta has no 'payments' entry, so the route falls back to 'invoices'). Activity writers located at `revenue-posting.service.ts:340-350` → `timeline.service.ts:49-51`, `activity-event.listener.ts:58` and `automation-executor.service.ts:650-653`. The lane finding names a fourth, a crm mirror, which this revision did not re-locate. | Payment audit row (M16): R0-19. Activity dedupe (M50): V1-55 (D-08). Business feed (M49): V1-25. Poller claim: V1-35. D-1 execution authorities: V1+. |
| Data model and infra | **The tenant extension is real-DB tested.** Lanes disagree on its model count (77 vs about 330); this map did not re-count. Soft delete covers 14 of the 33 models that have `deletedAt`. No migration drift gate. | `packages/db/src/client.ts`; `test/tenant-scope-extension.integration.test.ts` | Covered by the money and contacts packets above. Soft delete, drift gate and FTS trigger: V1+. The build itself shares one database, one Redis and unregistered fixture prefixes across worktrees: R0-00. |
| CI, proof, harness | **CI runs real Postgres and Redis.** `pnpm test:ci` is an unfiltered `vitest run` (ci-cd.yml:444), and the web unit suite runs (:471). Security scans cannot fail the build (continue-on-error at :210 and :218). The only proof steps are resource admission with `ci-resources.json` (:423) and the K12 self-test. The journey harness has no `it.fails`. | `.github/workflows/ci-cd.yml:187-219,419-471`; `scripts/proof-admission/manifests/` holds only action-001-*.json, ci-resources.json and k12-self.json | Worktree isolation: R0-00. Release 0 manifests (one per suite, each added by its packet), the local runner and CI evaluation: R0-16, R0-35. Playwright: R0-25. Committed credential: R0-31. Secret scan: V1-01. Native DAST and gate: V1-13, V1-30. verify-up: V1-20. Runtime pin: V1-39. Census and log redaction: V1-40. packages/api specs in CI: V1-26. |
| Programme and control | **50 unadmitted code commits** (51 with the draft docs). PR #190's exact-head merge grant is outstanding. `.agent-control` files describe the contacts pilot at `6a5c0c3f`. The wave law conflicts with issue #186 (CF-30). ACTION-001 is merged (PR 147) but the board records it as CHARACTERIZING. The deploy target is contradictory. | `.agent-control/active-packet.yaml`; wave board lines 12-16 | R0-01 handles the control files. D-01, D-20 and D-23 need rulings. |

---

## (b) Release 0 journey status (issue #186, seven steps)

**Evidence base.** The latest recorded local run of `apps/server/test/release0-journey.integration.test.ts` is **27/27 passed**. That run was on `pkt/R0-CT-03-CONTACT-AUDIT-ACTOR` at `db4ee154` (that is, `9c1163c1` plus two CRM commits), on 2026-10-31 at 12:37 UTC. The harness spawns the built server against real Postgres and Redis, with `AI_DISABLED=1` and no provider keys.

No suite was run for this revision. Three packets are running in worktrees at c2f6f46d (R0-05, R0-15 and R0-17). Two of them (R0-05 and R0-17) use the one shared main-tree database, and a spawned server rewrites the users table on boot (SeedService), so a run now could corrupt theirs. The exact-head run is owed by R0-02 and R0-35, each on an isolated database (R0-00).

| # | Step | API (built server, real DB) | Customer UI | Verdict | Remaining gaps |
|---|---|---|---|---|---|
| 1 | Register or log in securely; create or select a business; tenant isolation | PASS (4 cases): bootstrap creates User, Business and one OWNER membership; discovery; idempotent re-run; a disjoint second tenant | **FAIL.** (i) Unconditional: a new owner lands on an LLM-only onboarding page, and the server refuses completion below the three-pillar minimum (M07). (ii) Signup and login need a reachable Supabase project (M02); this is a failure only if D-02 rejects hosted free-tier Supabase. (iii) Business selection is implicit and overwritten on every navigation (M03). | **FAIL in UI (first failing step)** | R0-06 and R0-32 (D-03); R0-14 (D-02); R0-18; R0-05; R0-09; R0-25 |
| 2 | Create and edit a contact | PASS (2 cases): create, edit, reload by id. Visibility has 28 cases, a duplicate answers 409, and the actor is recorded (R0-CT-03). | UNPROVEN: no web test renders contacts, and a 403 shows as an empty book (M09) | PASS on API, UNPROVEN in UI | R0-13, R0-15, R0-23, R0-25 |
| 3 | Create and issue an invoice or quote | PASS for invoices (3 cases): DRAFT with two items; SENT with number, total and sentAt; AR posted per accounting basis. Invoice create accepts invalid input (500) and a foreign tenant's contact. Quotes: the bare-id detail is retired (R0-PC-01); the status route lacks a write scope. | UNPROVEN | PASS for invoices on the happy path. The quote branch is in Release 0 only if D-04 picks it. | R0-27, R0-28, R0-23, R0-25; V1-50 to V1-53 if D-04 picks quotes |
| 4 | Record an offline/manual payment safely and idempotently, with a correct balance and audit trail | PASS (5 cases): 100 paid of 250 gives PARTIALLY_PAID with balanced entries; a duplicate submit is absorbed; paying the remainder gives PAID with a second posting | UNPROVEN: the web sends no idempotency key, and the modal counts PENDING and FAILED rows as paid (M29) | **PARTIAL.** `recordedBy` is now written (R0-PL-07), but the BusinessEvent audit row says `invoice.create`. A DRAFT invoice accepts the payment, then answers 409 after commit. Mark-paid writes no posting. | R0-19, R0-17, R0-20, R0-21, R0-23, R0-25 |
| 5 | Inspect contacts, invoices and payments in the UI; refresh without data loss | PASS (1 case, simulated refresh through the list routes) | UNPROVEN: no jsdom or browser proof, Playwright is not in CI, and step 1 blocks the browser. Deep links dead-end (CF-21). | UNPROVEN | R0-08, R0-23, R0-25. Cockpit truth, the public link and the receipt are not part of #186 step 5 (V1-47, V1-48, V1-49). |
| 6 | A user without rights cannot read or modify another tenant's objects | PASS on every journey resource (7 cases): 403 on business-prefixed routes, 404 on foreign ids, redacted public reads, tenant state byte-identical afterwards | n/a | **PARTIAL.** Confirmed in code, outside the harness: custom-field values and flow-run steps are readable cross-tenant (M14); invoice create links and echoes a foreign tenant's contact (R0-27); an anonymous payment intent changes another tenant's invoice status (CF-12); a read-scope member changes quote status and a foreign tenant gets a 500 (M21); portal grants bind a foreign contact (CF-46); cortex audit routes call services with no tenant (PRS-M30). Not yet run: the interceptor truthiness case (CF-24). | R0-12, R0-27, R0-22, R0-28, R0-33, R0-34, R0-05 |
| 7 | No unapproved paid external API; optional services fail visibly | PASS (1 case) for the API journey | **FAIL.** Browser onboarding needs an LLM, and sign-in needs Supabase unless D-02 accepts it. No web test shows a missing provider failing visibly. | **PARTIAL.** No server test shows send-email or AI failing with a structured 503. Signup calls the HIBP breach API (free, outbound, fails open). Production boot needs Resend and the Supabase service role when email verification is on (CF-35). No cost ledger exists. | R0-07, R0-06, R0-32, R0-14, R0-23 |

**Step 6 scope.** The exit gate's PASS for step 6 covers the journey resources and every finding in the row above. The rest is stated, not claimed:

- **Known open, not reachable in the Release 0 configuration:** the phone media stream binds a tenant from its query string (CF-47, V1-14), but only when an OpenAI key is configured, and Release 0 runs keyless.
- **Not a cross-tenant path:** tRPC `crm.contactDetail` checks business access but not record visibility (V1-26). That is within-tenant visibility.
- **Defence in depth:** Payment is outside the tenant extension (M31, DM-008 in V1+). Every Release 0 Payment reader and writer carries a foreign-tenant control on Payment rows.
- **Pending ruling:** #174 withholds AC-01 (confirmed) and AC-02 (likely), which may touch tenant isolation (D-24). The R0 exit gate waits for D-24.
- **Unassessed:** this map has no census of mounted modules outside the journey and the findings above. The exit record lists them as UNASSESSED rather than claiming them.

**First failing step: step 1, in the customer UI.** The unconditional failure is onboarding. A fresh owner is redirected to an LLM-only page (`apps/web/src/app/app/layout.tsx:41` mounts `useGenomeGate`; `use-genome-gate.ts:61-121`). The server also refuses completion until the founder, business and market DNA scores each reach 50 (`onboarding-concierge.service.ts:1114-1134`). So with no paid LLM, nobody reaches the workspace. Sign-up without a Supabase project answers 400 `server_misconfigured` (`identity-signup.service.ts:98-106`). That is a Release 0 failure only if D-02 rejects hosted free-tier Supabase. At the API level no step fails. Step 4's audit-trail clause and step 6's out-of-harness findings fail by code inspection and are recorded as failing, not as passing.

**Evidence class: static.** The code references above were re-verified at c2f6f46d. Issue #186 step C asks for a reproduction with logs, and none is recorded yet. The reproduction is the RED of three packets, each run on an isolated database after R0-00:

- **R0-14:** POST /identity/signup with no `SUPABASE_*` env answers 400.
- **R0-32:** a bootstrapped owner's POST /onboarding-concierge/businesses/:id/complete answers 403 `GENOME_GATE_BLOCKED`.
- **R0-25:** GET /app redirects to /app/onboarding.

---

## (c) Ordered packet queue

The authoritative queue is `docs/reconstruction/BUILD-QUEUE-001.json`: 86 packets, 31 in R0 and 55 in V1. The JSON is the only basis for the write-set disjointness check; the table below shortens paths.

How to read the table:

- **Write set and tests first:** basenames, with parent directories where a name repeats (`page.tsx`, `package.json`). `+` marks a file the packet creates: absent at c2f6f46d and not created by an earlier packet.
- **Depends on:** short ids. `†` marks a file-order edge (the two packets write the same file). `D-xx` is an owner decision in section (g).
- **Ids are stable across revisions; the order column is the execution order.** Renamed and moved packets are listed after the table.

**Status at revision:**

- **LANDED on the branch, admission proof only:** R0-01, R0-02, R0-03 (87ca2b90), R0-04 and R0-11 (merged at 7183c364, with the ST-PC01-1 fix at c2f6f46d).
- **IN FLIGHT, worktrees at c2f6f46d with no commits yet:** R0-05 (`pkt/R0-AB-04-IDENTITY-BOUNDARY-PROOF`), R0-15 (`pkt/R0-CT-05-WEB-CONTACT-DENIAL-STATES`) and R0-17 (`pkt/R0-PL-03-PAYMENT-ATOMIC-RECONCILE`). This revision changes R0-15 (narrowed sweep) and R0-17 (refund clauses removed). The integrating session hands the revised entries to them before their tests-first commits.
- **R0-D4 and R0-D5** (from the journey harness's defect list) never had a branch. Both were fixed inside KF-REVENUE-AUTH-PROJECTION-001 (`bd66cde0`) and flipped in the journey by `0abed339`:
  - R0-D4: a bare-id status or paid request from a foreign tenant answers 404.
  - R0-D5: bare-id public reads answer the redacted projection.
- **QUEUED:** everything else.

| Order | Id | Title | Wave | Depends on | Group | Write set | Tests first | Hours |
|---|---|---|---|---|---|---|---|---|
| 1 | `R0-00-WT-ISOLATION` | Worktree resource isolation: a database and Redis index per packet, a fixture-prefix registry with escaped LIKE cleanup, namespaced public rate-limit keys | R0 | — | R0-G0 | 11 files: +worktree-resources.sh, admit-resources.mjs, +local-worktree-resources.json, +admit-resources-packet.spec.ts, +fixture-prefixes.json, +sql-like.ts, +fixture-prefix-registry.spec.ts, public-rate-limit.guard.ts, public-rate-limit.guard.spec.ts, revenue-authorization.integration.test.ts, commerce-invoice-detail.integration.test.ts | +admit-resources-packet.spec.ts, +fixture-prefix-registry.spec.ts, public-rate-limit.guard.spec.ts | 8 |
| 2 | `R0-05-ID-REALDB-TENANT-ALIGN` | Identity guard-chain real-DB suite (deleted/banned/revoked, removal and role-change freshness) and TenantInterceptor on the guards' string-only resolver | R0 | — | R0-G0 | 6 files: +identity-boundary.integration.test.ts, +identity-fixtures.ts, tenant.interceptor.ts, +tenant.interceptor.spec.ts, tenant-membership-boundary.integration.test.ts, +identity-boundary.json | +tenant.interceptor.spec.ts, tenant-membership-boundary.integration.test.ts, +identity-boundary.integration.test.ts, +identity-boundary.json | 8 |
| 3 | `R0-15-WEB-DENIAL-STATES` | Web renders denial and errors instead of empty data; no silent biz_demo default on the Release 0 screens | R0 | — | R0-G0 | 8 files: use-contacts-data.ts, [contactId]/overview/page.tsx, contact-header.tsx, _defaults.ts, client.ts, +use-contacts-data.test.ts, +contact-detail-denial.test.tsx, +no-demo-business-default.spec.ts | +use-contacts-data.test.ts, +contact-detail-denial.test.tsx, +no-demo-business-default.spec.ts | 7 |
| 4 | `R0-06-WEB-ONBOARD-MANUAL` | Manual (non-AI) onboarding completion and a fail-open genome gate | R0 | D-03 | R0-G0 | 8 files: app/onboarding/page.tsx, key-onboarding-chat-view.tsx, +manual-setup-step.tsx, use-onboarding.ts, onboarding-concierge.ts, use-genome-gate.ts, +onboarding-manual-path.test.tsx, +use-genome-gate.test.ts | +onboarding-manual-path.test.tsx, +use-genome-gate.test.ts | 8 |
| 5 | `R0-17-PAYMENT-TX-INTEGRITY` | Payment transaction integrity: refuse non-issued invoices before writing, reconcile inside the transaction, emit after commit | R0 | — | R0-G0 | 5 files: commerce.service.ts, invoice-workflow.service.ts, invoice-workflow.service.spec.ts, +commerce-payment-integrity.integration.test.ts, +commerce-payment-integrity.json | +commerce-payment-integrity.integration.test.ts, invoice-workflow.service.spec.ts, +commerce-payment-integrity.json | 7 |
| 6 | `R0-08-WEB-NAV-LINKS` | Cockpit navigation: Invoices and Quotes entries, direct cockpit target, payments-to-invoice deep links, settings links, label agreement | R0 | D-09 | R0-G0 | 10 files: nav-config.ts, semantic-routes.ts, desktop-sidebar.tsx, app/payments/page.tsx, upgrade-prompt.tsx, upgrade-modal.tsx, addon-pack-gate.tsx, revenue-setup-drawer.tsx, link-targets.spec.ts, +nav-labels-agree.spec.ts | link-targets.spec.ts, +nav-labels-agree.spec.ts | 6 |
| 7 | `R0-31-SEC-CREDENTIAL-REMOVE` | Remove the committed audit credential from the two root audit scripts (security carve-out, not a #186 step) | R0 | — | R0-G0 | 3 files: audit-keyflowos.py, audit-mobile-quick.py, +no-committed-credential.spec.mjs | +no-committed-credential.spec.mjs | 2 |
| 8 | `R0-18-WEB-BUSINESS-SELECTION` | Membership-first business selection: keep the stored choice, list from GET /identity/businesses, switcher, bootstrap only when none | R0 | R0-15, R0-05 | R0-G1 | 7 files: workspace.ts, use-app-layout.ts, +business-switcher.tsx, app-header.tsx, login-form.tsx, auth/callback/page.tsx, +workspace-business-selection.test.ts | +workspace-business-selection.test.ts | 8 |
| 9 | `R0-21-WEB-PAYMENT-FORMS` | Web payment forms: idempotency key per form open, status-aware paid/remaining from the server, overpayment confirm, single-submit invoice save | R0 | R0-15 | R0-G1 | 8 files: client.ts, payment-record-modal.tsx, use-pipeline-actions.ts, invoices/[id]/page.tsx, invoices-panel.tsx, +payment-record-modal.test.tsx, +invoices-panel-submit.test.tsx, +record-invoice-payment-idempotency.test.ts | +payment-record-modal.test.tsx, +invoices-panel-submit.test.tsx, +record-invoice-payment-idempotency.test.ts | 7 |
| 10 | `R0-02-REV-AUTH-CONFORM` | Revenue authorization: conformance of the landed KF-REVENUE-AUTH-PROJECTION-001 against REVENUE-AUTH-NEGATIVE-CONTROLS-001 rev 2, with exact-head proof | R0 | R0-00 | R0-G1 | 2 files: revenue-authorization.integration.test.ts, +revenue-auth-001.json | +revenue-auth-001.json, revenue-authorization.integration.test.ts | 4 |
| 11 | `R0-01-CT-RECONCILE` | Contacts correction: reconcile the branch fix with PR #190's accepted semantics and record admission proof | R0 | R0-00 | R0-G1 | 4 files: contacts-visibility.integration.test.ts, +contacts-visibility.json, active-packet.yaml, claude-return.yaml | contacts-visibility.integration.test.ts, +contacts-visibility.json | 3 |
| 12 | `R0-07-OPTIONAL-SVC-VISIBLE` | Optional services fail visibly and independently: Gmail send paths and AI dispatch answer 503; declared cost ledger | R0 | R0-00 | R0-G1 | 6 files: gmail.service.ts, model-gateway.service.ts, model-gateway.service.spec.ts, +optional-services-fail-visibly.integration.test.ts, +COST-LEDGER-001.md, +optional-services-fail-visibly.json | model-gateway.service.spec.ts, +optional-services-fail-visibly.integration.test.ts, +optional-services-fail-visibly.json | 5 |
| 13 | `R0-14-AUTH-LOCAL-SIGNIN` | No-provider sign-in for Release 0, per D-02: self-hosted GoTrue, a bounded local issuer reusing the HS256 verifier, or hosted Supabase documented | R0 | R0-00, D-02 | R0-G1 | 8 files: identity-signup.service.ts, supabase-auth.service.ts, env.ts, .env.example, auth-pathway.md, docker-compose.yml, +identity-local-auth.integration.test.ts, +identity-local-auth.json | +identity-local-auth.integration.test.ts, +identity-local-auth.json | 8 |
| 14 | `R0-27-REVENUE-CREATE-CONTRACT` | Invoice create contract: DTO validation, server-computed totals and a tenant-checked contact | R0 | R0-00, R0-17† | R0-G1 | 7 files: +create-invoice.dto.ts, +document-line-item.dto.ts, commerce.controller.ts, commerce.service.ts, commerce-invoice-errors.integration.test.ts, commerce-authorization.e2e.test.ts, +invoice-create-contract.json | commerce-invoice-errors.integration.test.ts, commerce-authorization.e2e.test.ts, +invoice-create-contract.json | 5 |
| 15 | `R0-32-ONBOARD-COMPLETE-SERVER` | Onboarding completes without AI on a real DB: the manual genome path reaches the three-pillar minimum (D-03 keeps the gate) or the server accepts a minimal profile (D-03 relaxes it) | R0 | R0-00, D-03 | R0-G1 | 3 files: +onboarding-manual-complete.integration.test.ts, onboarding-concierge.service.ts, +onboarding-manual-complete.json | +onboarding-manual-complete.integration.test.ts, +onboarding-manual-complete.json | 6 |
| 16 | `R0-12-CT-TENANT-ROUTES` | Bind contact custom-field values and flow-run steps to the path tenant | R0 | R0-00 | R0-G1 | 6 files: crm-custom-fields.controller.ts, contact-custom-field-value.service.ts, flow-runner.service.ts, flow.controller.ts, +contact-scoped-tenancy.integration.test.ts, +contact-scoped-tenancy.json | +contact-scoped-tenancy.integration.test.ts, +contact-scoped-tenancy.json | 5 |
| 17 | `R0-13-CT-PERSISTENCE-PROOF` | Contacts write-contract real-DB proof: denial, validation, delete-then-refresh | R0 | R0-00 | R0-G1 | 3 files: +contacts-persistence.integration.test.ts, crm.service.ts, +contacts-persistence.json | +contacts-persistence.integration.test.ts, +contacts-persistence.json | 5 |
| 18 | `R0-19-EVIDENCE-BASELINE` | Payment audit row says payment: BusinessEvent label for the manual payment route, with real-DB evidence pins for step 4 | R0 | R0-00 | R0-G2 | 4 files: +evidence-feed.integration.test.ts, business-event.interceptor.ts, +business-event.interceptor.spec.ts, +evidence-feed.json | +evidence-feed.integration.test.ts, +business-event.interceptor.spec.ts, +evidence-feed.json | 5 |
| 19 | `R0-33-PORTAL-GRANT-TENANT` | Portal access grants bind only a contact of the path tenant | R0 | R0-00 | R0-G2 | 3 files: portal.service.ts, +portal-grant-tenant.integration.test.ts, +portal-grant-tenant.json | +portal-grant-tenant.integration.test.ts, +portal-grant-tenant.json | 3 |
| 20 | `R0-34-KEY-AUDIT-TENANT` | Cortex audit routes bind the tenant with GuardedBusinessId instead of an absent path param | R0 | R0-00 | R0-G2 | 4 files: key-cortex-audit.controller.ts, +key-cortex-audit.controller.spec.ts, +cortex-audit-tenant.integration.test.ts, +cortex-audit-tenant.json | +key-cortex-audit.controller.spec.ts, +cortex-audit-tenant.integration.test.ts, +cortex-audit-tenant.json | 3 |
| 21 | `R0-03-CT-AUDIT-ACTOR` | Contact mutations record the acting HTTP user (R0-CT-03, landed at 87ca2b90): post-merge proof and manifest | R0 | R0-00 | R0-G2 | 1 file: +contacts-audit-actor.json | +contacts-audit-actor.json | 1 |
| 22 | `R0-04-QT-DETAIL-ROUTE` | Tenant-bound quote detail route; the bare-id GET commerce/quotes/:quoteId is retired to 404 (R0-PC-01, landed at 7183c364): proof and manifest | R0 | R0-00 | R0-G2 | 1 file: +quote-detail-route.json | +quote-detail-route.json | 1 |
| 23 | `R0-11-PL07-PAYMENT-ACTOR` | Manual payments and refunds record the acting user (R0-PL-07, landed at 7183c364): proof and manifest | R0 | R0-00 | R0-G2 | 1 file: +payments-actor.json | +payments-actor.json | 1 |
| 24 | `R0-16-PROOF-BINDING` | Release 0 proof binding: one-command local runner, CI evaluation of every case manifest, verdict source identity, stale journey titles | R0 | R0-00, R0-01, R0-02 | R0-G3 | 13 files: +test-local.sh, package.json (root), server/package.json, +release0-journey.json, +tenant-001-real-db.json, ci-cd.yml, evaluate.mjs, k12-self.json, proof-admission.spec.ts, release0-journey.integration.test.ts, TESTING.md, +test-local.selftest.sh, +release0-landed.json | proof-admission.spec.ts, +test-local.selftest.sh, +release0-journey.json, release0-journey.integration.test.ts, +release0-landed.json | 10 |
| 25 | `R0-23-WEB-R0-SCREENS` | Web Release 0 screen tests (jsdom) with server-shaped fixtures and simulated refresh | R0 | R0-21, R0-15, R0-18, R0-06, R0-07 | R0-G3 | 2 files: +release0-journey.test.tsx, +journey-responses.json | +release0-journey.test.tsx, +journey-responses.json | 8 |
| 26 | `R0-22-PUBLIC-INTENT-HARDEN` | Public payment intent: no invoice status flip, dedupe per invoice and method, payable-state gate, amount cap | R0 | R0-00, R0-02†, R0-27† | R0-G3 | 6 files: commerce.service.ts, commerce.controller.ts, pay/[invoiceId]/page.tsx, +public-payment-intent.integration.test.ts, revenue-authorization.integration.test.ts, +public-payment-intent.json | +public-payment-intent.integration.test.ts, revenue-authorization.integration.test.ts, +public-payment-intent.json | 6 |
| 27 | `R0-09-ID-HARDEN` | Business config writes need settings scope; onboardingComplete leaves the generic PATCH; env-gated SUPER_ADMIN promotion | R0 | R0-00, R0-14†, D-11 | R0-G3 | 8 files: identity.controller.ts, identity.service.ts, update-business.dto.ts, seed.service.ts, +seed.service.spec.ts, .env.example, +identity-business-config.integration.test.ts, +identity-business-config.json | +identity-business-config.integration.test.ts, +seed.service.spec.ts, +identity-business-config.json | 6 |
| 28 | `R0-25-PLAYWRIGHT-R0` | Playwright live Release 0 journey, mocked e2e job in CI, rewrite of the stale onboarding spec | R0 | R0-06, R0-14, R0-18, R0-32, R0-23, R0-16, R0-08 | R0-G4 | 5 files: +release0-live.spec.ts, onboarding-loop-regression.spec.ts, playwright.config.ts, +e2e-live.yml, ci-cd.yml | onboarding-loop-regression.spec.ts, +release0-live.spec.ts | 12 |
| 29 | `R0-28-QUOTE-STATUS-AUTH` | Quote status route: revenue:write scope and tenant binding on PATCH commerce/quotes/:quoteId/status/:status (no state machine) | R0 | R0-00, R0-22† | R0-G4 | 5 files: commerce.controller.ts, commerce.service.ts, +commerce-quote-status-auth.integration.test.ts, commerce-authorization.e2e.test.ts, +quote-status-auth.json | +commerce-quote-status-auth.integration.test.ts, commerce-authorization.e2e.test.ts, +quote-status-auth.json | 3 |
| 30 | `R0-20-MARKPAID-CONVERGENCE` | Mark-paid records the remaining balance through recordPayment so every SUCCESSFUL payment is posted | R0 | R0-00, R0-17, R0-28†, D-05 | R0-G5 | 3 files: commerce.service.ts, +mark-paid-convergence.integration.test.ts, +mark-paid-convergence.json | +mark-paid-convergence.integration.test.ts, +mark-paid-convergence.json | 5 |
| 31 | `R0-35-EXIT-PROOF` | Release 0 exit proof: every Release 0 server suite bound by a manifest, proof:release0 green at the exact head with zero unexplained skips | R0 | R0-31, R0-03, R0-04, R0-11, R0-12, R0-13, R0-19, R0-33, R0-34, R0-09, R0-25, R0-20 | R0-G6 | 2 files: +release0-index.json, +release0-proof-coverage.spec.ts | +release0-proof-coverage.spec.ts, +release0-index.json | 3 |
| 32 | `V1-15-DM-LEDGER-WRITE-DOOR` | Ledger write-door integrity: expense void through PostingService, closed periods enforced, raw-writer and money-writer ratchets, trial balance | V1 | — | V1-G1 | 8 files: expenses.service.ts, posting.service.ts, accounting-period.service.ts, finance.module.ts, +ledger-writer-integrity.spec.ts, +money-state-writer-inventory.spec.ts, +ledger-write-door.integration.test.ts, +expense-void-reversal.integration.test.ts | +ledger-writer-integrity.spec.ts, +money-state-writer-inventory.spec.ts, +ledger-write-door.integration.test.ts, +expense-void-reversal.integration.test.ts | 12 |
| 33 | `V1-22-DM-MONEY-CENTS` | Cents-safe money arithmetic at write and balance boundaries (no schema change) | V1 | R0-20†, D-13 | V1-G1 | 6 files: +money.ts, +money.spec.ts, invoice-workflow.service.ts, invoice-workflow.service.spec.ts, commerce.service.ts, +commerce-money-rounding.integration.test.ts | +money.spec.ts, invoice-workflow.service.spec.ts, +commerce-money-rounding.integration.test.ts | 6 |
| 34 | `V1-03-KEY-CORTEX-PRINCIPAL` | Cortex controller takes the principal from AuthGuard; autonomy-profile writes limited to OWNER/ADMIN at the required tier | V1 | D-17 | V1-G1 | 3 files: key-cortex.controller.ts, +key-cortex.controller.principal.spec.ts, +autonomy-profile-authority.integration.test.ts | +key-cortex.controller.principal.spec.ts, +autonomy-profile-authority.integration.test.ts | 7 |
| 35 | `V1-10-KEY-PLANNER-CLAIM` | KEY plan execution claims the plan atomically and records approval pauses correctly (#174 KEY-01/02) | V1 | — | V1-G1 | 2 files: key-cortex-planner.service.ts, +key-cortex-plan-execution.integration.test.ts | +key-cortex-plan-execution.integration.test.ts | 5 |
| 36 | `V1-12-DM-RECURRING-GUARD` | Recurring invoice run guard released on failure; schedule advance and invoice creation in one transaction (#174 REL-03/04) | V1 | — | V1-G1 | 2 files: recurring-invoice.service.ts, +recurring-invoice-run.integration.test.ts | +recurring-invoice-run.integration.test.ts | 4 |
| 37 | `V1-06-BK-BASELINE-PARITY` | Bookings real-DB baseline and in-app create parity: tenant-checked contact and staff, same availability rules as the public path | V1 | — | V1-G1 | 4 files: bookings.service.ts, create-booking.dto.ts, bookings.controller.ts, +bookings-core.integration.test.ts | +bookings-core.integration.test.ts | 8 |
| 38 | `V1-47-COCKPIT-TRUTH` | Cockpit minimal truth: per-source status, Release 0 result counts, degraded banner, real-DB snapshot step | V1 | R0-16† | V1-G1 | 7 files: business-command-center.service.ts, business-command-center.types.ts, business-command-center.service.spec.ts, business-command-center.ts, app/command-center/page.tsx, newly-reachable-screens-mount.test.tsx, release0-journey.integration.test.ts | business-command-center.service.spec.ts, newly-reachable-screens-mount.test.tsx, release0-journey.integration.test.ts | 8 |
| 39 | `V1-54-CT-ROUTE-ORDER-CALLER` | Contacts route order (contacts/bulk and unread-counts reachable) and call logs take the caller from the session | V1 | R0-12 | V1-G1 | 4 files: crm.controller.ts, call-task.controller.ts, call-log.service.ts, crm.e2e.test.ts | crm.e2e.test.ts | 3 |
| 40 | `V1-01-SEC-CREDENTIAL-SECRET-SCAN` | Make the secret scan real (#189) and capture the dependency-audit outcome (#114); run scripts/security/tests in CI | V1 | R0-31, R0-25†, D-22 | V1-G1 | 3 files: ci-cd.yml, +secret-scan-contract.spec.mjs, package.json (root) | +secret-scan-contract.spec.mjs | 4 |
| 41 | `V1-09-KEY-COMMAND-GOVERNED` | /key/command: bare canonical capability routing (#160 hunk only) and a read-only, governed 'ask' mode | V1 | D-17 | V1-G1 | 3 files: key-command.service.ts, +key-command-capability-routing.spec.ts, +key-command-ask-governance.spec.ts | +key-command-capability-routing.spec.ts, +key-command-ask-governance.spec.ts | 6 |
| 42 | `V1-13-SEC-NATIVE-DAST` | Native DAST harness from #114 with Release 0 auth-boundary probes (non-required workflow) | V1 | — | V1-G2 | 4 files: +native-dast.mjs, +native-dast-manifest.json, +native-dast.spec.mjs, +native-dast.yml | +native-dast.spec.mjs, +native-dast-manifest.json | 5 |
| 43 | `V1-07-AUTH-INVITE-CEILING` | Invite grantability ceiling: a grantor cannot mint scopes or tiers above their own | V1 | R0-09, R0-05 | V1-G2 | 3 files: approval-tier.ts, identity.service.ts, tenant-membership-boundary.integration.test.ts | tenant-membership-boundary.integration.test.ts | 6 |
| 44 | `V1-18-PUB-STOREFRONT-PAID-EVENT` | Storefront paid-event integrity: CONFIRMED is not paid; the dormant marketplace listener never creates a second PAID invoice (F206) | V1 | D-18 | V1-G2 | 4 files: store-order.service.ts, commerce-integration.service.ts, +store-order.service.spec.ts, +storefront-paid-event.integration.test.ts | +store-order.service.spec.ts, +storefront-paid-event.integration.test.ts | 6 |
| 45 | `V1-02-KEY-CORTEX-FAILCLOSED` | Cortex parsed-command autonomy fails closed (#155) and BatchResult is consumed without legacy replay (#182) | V1 | D-17 | V1-G2 | 5 files: key-cortex-query-pipeline.service.ts, key-cortex-query-pipeline.service.spec.ts, +key-cortex-batch-result.mapper.ts, +key-cortex-batch-result.mapper.spec.ts, +auth-fail-closed-001-negative-controls.json | key-cortex-query-pipeline.service.spec.ts, +key-cortex-batch-result.mapper.spec.ts, +auth-fail-closed-001-negative-controls.json | 8 |
| 46 | `V1-05-PUB-PROVIDER-CALLBACKS` | WiPay callback fails closed without a keyed proof; PayPal capture bound to invoice, amount and currency with ledger posting | V1 | D-19 | V1-G2 | 3 files: payments.service.ts, payments.controller.ts, +payments-provider-callbacks.integration.test.ts | +payments-provider-callbacks.integration.test.ts | 8 |
| 47 | `V1-40-SEC-TRUST-CENSUS-REDACTION` | Log-redaction negative control, packet-branch agent gate, dependabot, Release 0 trust census | V1 | D-22 | V1-G2 | 4 files: +log-redaction.integration.test.ts, agent-control-gate.yml, +dependabot.yml, +RELEASE0-TRUST-CENSUS-001.md | +log-redaction.integration.test.ts | 7 |
| 48 | `V1-14-PUB-PORTAL-VOICE-BINDING` | Portal validate rate limit and a signed phone-stream tenant token | V1 | R0-33 | V1-G2 | 5 files: portal.controller.ts, phone-voice.controller.ts, phone-voice.service.ts, +phone-voice-stream-auth.spec.ts, +portal-boundary.integration.test.ts | +portal-boundary.integration.test.ts, +phone-voice-stream-auth.spec.ts | 5 |
| 49 | `V1-35-DM-POLLER-CLAIM` | Cross-module job poller runs only its own job types and claims each job atomically (#174 REL-01/02) | V1 | D-29 | V1-G2 | 2 files: cross-module-agent.service.ts, +cross-module-job-poller.integration.test.ts | +cross-module-job-poller.integration.test.ts | 5 |
| 50 | `V1-41-DM-UNTRUSTED-MONEY-INPUTS` | Evidence-extracted and Drive-intake payments are recorded PENDING until an operator confirms (decision-gated) | V1 | D-27 | V1-G2 | 3 files: payment-evidence.service.ts, drive-intake-orchestrator.service.ts, +untrusted-payment-inputs.integration.test.ts | +untrusted-payment-inputs.integration.test.ts | 5 |
| 51 | `V1-32-KEY-PROPOSAL-CLAIM` | KeyActionProposal execution claims atomically and re-reads the approver | V1 | D-17 | V1-G2 | 2 files: key-action-proposal.service.ts, +key-action-proposal-claim.integration.test.ts | +key-action-proposal-claim.integration.test.ts | 4 |
| 52 | `V1-04-KEY-OVERSIGHT-SELECTIVE` | AI oversight: a failed typed policy read can no longer be overridden by a legacy AiMemory policy (#180 patch) | V1 | — | V1-G3 | 2 files: ai-oversight.service.ts, ai-oversight-fails-closed.spec.ts | ai-oversight-fails-closed.spec.ts | 3 |
| 53 | `V1-56-AUTH-USERNAME-THROTTLE` | Throttle the username availability oracle with a window the debounced signup form cannot exceed | V1 | R0-09 | V1-G3 | 3 files: identity.controller.ts, identity-signup.e2e.test.ts, +signup-username-throttle.test.tsx | identity-signup.e2e.test.ts, +signup-username-throttle.test.tsx | 3 |
| 54 | `V1-34-DM-CASH-POSITION` | Ledger-derived cash position for the cockpit and safe-to-spend | V1 | V1-15 | V1-G4 | 7 files: +cash-position.service.ts, finance.module.ts, safe-to-spend.service.ts, os.service.ts, finance-overview.service.ts, +cash-position.integration.test.ts, os.controller.test.ts | +cash-position.integration.test.ts, os.controller.test.ts | 8 |
| 55 | `V1-29-DM-REFUND-CONVENTION` | Manual refunds as separate negative rows, a refund status guard, a surfaced reconcile, a defined full-refund state, agreeing gross and net | V1 | V1-22, D-14 | V1-G4 | 4 files: commerce.service.ts, invoice-workflow.service.ts, invoice-workflow.service.spec.ts, +commerce-refund.integration.test.ts | +commerce-refund.integration.test.ts, invoice-workflow.service.spec.ts | 7 |
| 56 | `V1-31-KEY-FLOW-CONFIRM-BIND` | Flow confirmations execute only the server-bound confirmation, never client-resubmitted tool arguments; approvals carry the real principal | V1 | V1-03, D-17 | V1-G4 | 4 files: flow-orchestrator.service.ts, approval.controller.ts, +flow-confirmation-binding.spec.ts, approval.controller.spec.ts | +flow-confirmation-binding.spec.ts, approval.controller.spec.ts | 8 |
| 57 | `V1-19-KEY-IDEMPOTENCY-CLAIM` | KeyIdempotencyService insert-claim with requestHash comparison; characterize the approved plan-queue re-enqueue (#174 KEY-03/04) | V1 | V1-10 | V1-G4 | 3 files: key-idempotency.service.ts, +key-idempotency-claim.integration.test.ts, +plan-executor-approval-resume.integration.test.ts | +key-idempotency-claim.integration.test.ts, +plan-executor-approval-resume.integration.test.ts | 6 |
| 58 | `V1-16-BK-SLOT-CONCURRENCY` | Booking slot claim under an advisory transaction lock; timezone-aware slots | V1 | V1-06 | V1-G4 | 4 files: bookings.service.ts, booking-overlap.spec.ts, bookings.controller.spec.ts, +booking-concurrency.integration.test.ts | +booking-concurrency.integration.test.ts, bookings.controller.spec.ts | 8 |
| 59 | `V1-08-CT-SIBLING-VISIBILITY` | Apply caller CRM visibility to the 14 sibling contact-scoped REST reads; ownerId edits respect crm_reassign | V1 | R0-12, R0-13, R0-01, V1-54† | V1-G4 | 8 files: crm-permissions.helper.ts, crm-timeline.service.ts, crm-journey.service.ts, crm-revenue.service.ts, crm.service.ts, crm.controller.ts, contacts-visibility.integration.test.ts, crm.e2e.test.ts | contacts-visibility.integration.test.ts, crm.e2e.test.ts | 6 |
| 60 | `V1-24-KEY-KILL-SWITCHES` | Unified scheduler kill switch and a server-side KEY off switch for gateway dispatch and cortex crons | V1 | R0-07, R0-14, R0-16, R0-09†, V1-47†, D-17 | V1-G4 | 19 files: +scheduler-kill-switch.spec.ts, env.ts, .env.example, model-gateway.service.ts, model-gateway.service.spec.ts, margin-snapshot-scheduler.service.ts, financial-briefing-scheduler.service.ts, best-channel-scheduler.service.ts, crm-sequence-scheduler.service.ts, key-proactive-engine.service.ts, key-cortex-reflection.service.ts, key-cortex-intuition.service.ts, key-bi-engine.service.ts, key-cortex-creativity.service.ts, key-cortex-salience.service.ts, memory-consolidation.service.ts, key-cortex-homeostasis.service.ts, key-cortex-cerebellum.service.ts, release0-journey.integration.test.ts | +scheduler-kill-switch.spec.ts, model-gateway.service.spec.ts, release0-journey.integration.test.ts | 12 |
| 61 | `V1-20-SEC-VERIFY-UP` | Launch verifier rejects degraded HTTP 200 bodies (port #188) | V1 | V1-01 | V1-G4 | 6 files: verify-up.sh, +verify-up-body.mjs, +verify-up-body.spec.mjs, +verify-up-shell.spec.mjs, ci-cd.yml, package.json (root) | +verify-up-body.spec.mjs, +verify-up-shell.spec.mjs | 3 |
| 62 | `V1-25-EVT-BUSINESS-FEED` | Mount the business-level activity feed in the cockpit; bounded timeline limit | V1 | R0-19, V1-47 | V1-G4 | 5 files: query-timeline.dto.ts, business-timeline.tsx, app/command-center/page.tsx, +business-timeline.test.tsx, evidence-feed.integration.test.ts | +business-timeline.test.tsx, evidence-feed.integration.test.ts | 5 |
| 63 | `V1-30-SEC-DAST-GATE-SWAP` | Required admission gate swaps from 'DAST (HawkScan)' to 'DAST (Native)'; HawkScan becomes manual-only | V1 | V1-13, V1-01, D-22 | V1-G4 | 7 files: events.mjs, AGENT_AUTOPILOT_POLICY.yaml, AGENT_AUTOPILOT.md, agent-control-autopilot.yml, hawkscan.yml, +workflow-integrity.spec.mjs, negative-controls.yaml | +workflow-integrity.spec.mjs, negative-controls.yaml | 4 |
| 64 | `V1-38-CT-PRIVACY-PURGE-STATUS` | Honest GDPR purge with retained-basis audit; Contact.status vocabulary ratchet (Shopify maps, never overwrites) | V1 | V1-09, D-25 | V1-G5 | 7 files: contact-privacy.service.ts, shopify.service.ts, key-command.service.ts, flow-tool-registry.ts, crm.constants.ts, +contact-status-vocabulary.spec.ts, +contact-privacy-purge.integration.test.ts | +contact-status-vocabulary.spec.ts, +contact-privacy-purge.integration.test.ts | 8 |
| 65 | `V1-21-AUTH-JOBROLE-CEILING` | JobRole permissions vocabulary-validated and capped; assignment sync cannot escalate | V1 | V1-07 | V1-G5 | 5 files: create-job-role.dto.ts, update-job-role.dto.ts, structure.service.ts, structure.controller.ts, +structure-authority-ceiling.integration.test.ts | +structure-authority-ceiling.integration.test.ts | 6 |
| 66 | `V1-23-PUB-PUBLIC-PROJECTIONS` | Public product, staff and service endpoints return projections, honour storeEnabled and are rate limited | V1 | V1-06 | V1-G5 | 5 files: catalog.service.ts, catalog.controller.ts, site.service.ts, bookings.controller.ts, +public-catalog-projection.integration.test.ts | +public-catalog-projection.integration.test.ts | 6 |
| 67 | `V1-33-PUB-CHECKOUT-RETRY-OFFLINE` | Storefront checkout retry identity (existing unique slot, no migration unless proven unavoidable) and CASH-order offline completion | V1 | V1-18, D-18 | V1-G5 | 3 files: site.controller.ts, store-order.service.ts, +storefront-checkout-retry.integration.test.ts | +storefront-checkout-retry.integration.test.ts | 6 |
| 68 | `V1-28-BK-SETTLEMENT` | Booking settlement: completion invoice nets the deposit, visible invoicing outcome, paymentStatus from invoices, live invoice.paid confirm hook | V1 | V1-16, R0-20, D-26 | V1-G6 | 9 files: bookings.service.ts, +booking-payment-status.listener.ts, +booking-payment-status.listener.spec.ts, bookings.module.ts, flow.listener.ts, events.types.ts, +booking-settlement.integration.test.ts, order-confirmation.tsx, public/book/page.tsx | +booking-settlement.integration.test.ts, +booking-payment-status.listener.spec.ts | 8 |
| 69 | `V1-55-EVT-ACTIVITY-DEDUPE` | One Activity feed row per payment event: remove the duplicate invoice.paid feed writer and pin feed rows on a real DB | V1 | R0-19, V1-25†, D-08 | V1-G6 | 3 files: automation-executor.service.ts, +automation-executor.service.spec.ts, evidence-feed.integration.test.ts | evidence-feed.integration.test.ts, +automation-executor.service.spec.ts | 4 |
| 70 | `V1-17-DM-CONTACT-PARTIAL-UNIQUE` | Soft-delete-safe contact identity uniques (isolated SQL-only partial index migration) | V1 | V1-08, D-16 | V1-MT1 | 4 files: +migration.sql, schema.prisma, crm.service.ts, crm-contact-duplicate.integration.test.ts | crm-contact-duplicate.integration.test.ts | 5 |
| 71 | `V1-26-CT-TRPC-VISIBILITY` | tRPC crm.contactDetail applies CRM visibility before reading child rows | V1 | V1-08, V1-20† | V1-MT2 | 3 files: crm.ts, +crm.contact-detail.spec.ts, ci-cd.yml | +crm.contact-detail.spec.ts | 3 |
| 72 | `V1-27-BK-SLOT-WRITERS` | The three booking writers that bypass the overlap guard (tRPC create, waitlist offer, calendar write-back) go through it | V1 | V1-16 | V1-MT3 | 4 files: bookings.ts, booking-waitlist.service.ts, calendar-projection.service.ts, +booking-slot-writers.integration.test.ts | +booking-slot-writers.integration.test.ts | 5 |
| 73 | `V1-36-DM-BALANCE-READ-CONTRACT` | One canonical invoice balance read contract across server and web (packages/shared mirror of computeBalance) | V1 | V1-29, V1-34, R0-21† | V1-MT4 | 11 files: +invoice-balance.ts, invoice-workflow.service.ts, commerce.service.ts, revenue-reporting.service.ts, revenue-action.service.ts, finance-overview.service.ts, invoice-list.tsx, invoice-stat-cards.tsx, invoices-panel.tsx, +invoice-refund-balance.integration.test.ts, +balance-arithmetic.spec.ts | +invoice-refund-balance.integration.test.ts, +balance-arithmetic.spec.ts | 9 |
| 74 | `V1-37-DM-CURRENCY` | Currency integrity: business-currency defaults, per-currency stats, single-currency guard at the posting door | V1 | V1-36, V1-15, D-13 | V1-G7 | 8 files: commerce.service.ts, commerce-stats.service.ts, +commerce-stats.service.spec.ts, posting.service.ts, posting.service.spec.ts, ledger-balance.service.ts, invoices/new/page.tsx, +commerce-currency.integration.test.ts | +commerce-stats.service.spec.ts, posting.service.spec.ts, +commerce-currency.integration.test.ts | 8 |
| 75 | `V1-39-SEC-RUNTIME-PIN` | Decide and align the Node runtime pin (extract from #91) with a consistency guard | V1 | V1-20, V1-30, V1-26†, D-21 | V1-G7 | 10 files: +runtime-pin.spec.mjs, package.json (root), .nvmrc, Dockerfile, ci-cd.yml, hawkscan.yml, AGENTS.md, README.md, DEPLOYMENT.md, LAUNCH_GUIDE.md | +runtime-pin.spec.mjs | 4 |
| 76 | `V1-42-DM-LIFECYCLE-OWNER-CAS` | Single invoice lifecycle owner: compare-and-set transitions; DelegationLoop and CommerceAi go through the workflow; status-writer ratchet | V1 | V1-37 | V1-G8 | 7 files: invoice-workflow.service.ts, delegation-loop.service.ts, commerce-ai.service.ts, commerce-ai.controller.ts, commerce.service.ts, +invoice-status-writers.spec.ts, +invoice-transition-concurrency.integration.test.ts | +invoice-status-writers.spec.ts, +invoice-transition-concurrency.integration.test.ts | 10 |
| 77 | `V1-43-DM-NUMBERING` | Per-business sequential invoice/quote numbers allocated under the existing unique with P2002 retry (no migration) | V1 | V1-42, V1-12, V1-31, D-15 | V1-G9 | 5 files: +document-number.ts, commerce.service.ts, flow-orchestrator.service.ts, recurring-invoice.service.ts, +commerce-document-numbering.integration.test.ts | +commerce-document-numbering.integration.test.ts | 7 |
| 78 | `V1-44-DM-CREDIT-NOTE` | Credit-note apply reachable (sourceType 'Invoice'), void converges, statuses owned by the workflow | V1 | V1-42, V1-15, D-28 | V1-G9 | 4 files: credit-note.service.ts, invoice-workflow.service.ts, invoice-workflow.service.spec.ts, +credit-note-reversal.integration.test.ts | +credit-note-reversal.integration.test.ts, invoice-workflow.service.spec.ts | 8 |
| 79 | `V1-45-DM-CREATE-IDEMPOTENCY` | Create idempotency key for invoices and quotes on the existing IdempotencyKey table (no migration) | V1 | V1-43, V1-19, D-15 | V1-G10 | 3 files: commerce.service.ts, client.ts, +commerce-create-idempotency.integration.test.ts | +commerce-create-idempotency.integration.test.ts | 6 |
| 80 | `V1-48-PUBLIC-TOKEN-VIEW` | Public invoice link shows paid and remaining; pay-link tokens are crypto-random and honour expiresInDays | V1 | V1-45†, D-07 | V1-G11 | 6 files: commerce.service.ts, commerce.controller.ts, invoice/[token]/page.tsx, client.ts, +public-invoice-link.integration.test.ts, +public-invoice-projection.test.tsx | +public-invoice-link.integration.test.ts, +public-invoice-projection.test.tsx | 7 |
| 81 | `V1-49-PUBLIC-RECEIPT` | Customer receipt by pay-link token and truthful receipt-email amounts | V1 | V1-48, D-07 | V1-G12 | 7 files: commerce.controller.ts, commerce.service.ts, invoice-receipt-builder.service.ts, invoice-receipt.listener.ts, +invoice-receipt.listener.spec.ts, +public-receipt.integration.test.ts, invoice/[token]/page.tsx | +public-receipt.integration.test.ts, +invoice-receipt.listener.spec.ts | 6 |
| 82 | `V1-46-PUB-PAY-LINK-TOKEN-GATE` | Token-gated customer pay surface: /pay/link/[token] stops downgrading to the bare-id page (decision-gated) | V1 | V1-45, V1-49†, D-07 | V1-G13 | 6 files: link/[token]/page.tsx, pay/[invoiceId]/page.tsx, invoice/[token]/page.tsx, commerce.controller.ts, commerce.service.ts, +pay-link-token-gate.integration.test.ts | +pay-link-token-gate.integration.test.ts | 7 |
| 83 | `V1-50-QUOTE-STATE-MACHINE` | Quote status state machine: transition table, single viewToken mint, bulk update through the same table | V1 | R0-28, V1-46†, D-04 | V1-G14 | 5 files: +quote-workflow.ts, +quote-workflow.spec.ts, commerce.service.ts, update-quote-status.dto.ts, +commerce-quote-status.integration.test.ts | +quote-workflow.spec.ts, +commerce-quote-status.integration.test.ts | 5 |
| 84 | `V1-51-QUOTE-CONVERSION-JOURNEY` | Conversion carries the accepted quote's tax and discount; real-DB quote journey | V1 | V1-50, D-04 | V1-G15 | 5 files: commerce.service.ts, quote-convert-modal.tsx, quotes-panel.tsx, +release0-quote-journey.integration.test.ts, +quote-convert-modal.test.tsx | +release0-quote-journey.integration.test.ts, +quote-convert-modal.test.tsx | 7 |
| 85 | `V1-52-QUOTE-PUBLIC-LINK` | Provider-free public quote link (copy link) for the quote branch of Release 0 | V1 | V1-51, D-04 | V1-G16 | 6 files: commerce.controller.ts, commerce.service.ts, client.ts, quotes-panel.tsx, +quote-public-link.integration.test.ts, +quotes-panel-share.test.tsx | +quote-public-link.integration.test.ts, +quotes-panel-share.test.tsx | 5 |
| 86 | `V1-53-QUOTE-CREATE-ERRORS` | Quote create DTO and quote edit, delete and convert errors as HTTP exceptions | V1 | R0-27, V1-52†, D-04 | V1-G17 | 4 files: +create-quote.dto.ts, commerce.controller.ts, commerce.service.ts, +commerce-quote-errors.integration.test.ts | +commerce-quote-errors.integration.test.ts | 4 |

**Renamed and moved packets.**

| Draft id | Revision 2 | Why |
|---|---|---|
| `R0-10-COCKPIT-TRUTH` | `V1-47-COCKPIT-TRUTH` | Not a #186 step; P0-6 asks only for a minimal route |
| `R0-24-PUBLIC-TOKEN-VIEW` | `V1-48-PUBLIC-TOKEN-VIEW` | P0-5 is conditional on the journey; back to R0 if D-07 rules the link in |
| `R0-26-PUBLIC-RECEIPT` | `V1-49-PUBLIC-RECEIPT` | As V1-48 |
| `R0-28-QUOTE-STATE-MACHINE` | `R0-28-QUOTE-STATUS-AUTH` (R0) + `V1-50-QUOTE-STATE-MACHINE` | Authorization closes regardless of D-04; the state machine follows D-04 |
| `R0-29-QUOTE-CONVERSION-JOURNEY` | `V1-51-QUOTE-CONVERSION-JOURNEY` | Quote branch, D-04 |
| `R0-30-QUOTE-PUBLIC-LINK` | `V1-52-QUOTE-PUBLIC-LINK` | Quote branch, D-04 |
| `R0-27-REVENUE-CREATE-CONTRACT` (quote half) | `V1-53-QUOTE-CREATE-ERRORS` | Quote branch, D-04; the invoice half stays in R0-27 |
| `R0-12-CT-TENANT-ROUTES` (route order, call log) | `V1-54-CT-ROUTE-ORDER-CALLER` | Not journey steps |
| `R0-19-EVIDENCE-BASELINE` (Activity dedupe) | `V1-55-EVT-ACTIVITY-DEDUPE` | P1-3 minimal evidence; takes D-08 off step 4 |
| `R0-09-ID-HARDEN` (username throttle) | `V1-56-AUTH-USERNAME-THROTTLE` | Not needed by #186; it could break signup |
| `R0-17-PAYMENT-TX-INTEGRITY` (refund guards) | merged into `V1-29-DM-REFUND-CONVENTION` | They only make sense once the refund convention is fixed |
| `V1-01-SEC-CREDENTIAL-SECRET-SCAN` (credential removal) | `R0-31-SEC-CREDENTIAL-REMOVE` | Zero-overlap security carve-out |
| `V1-11-KEY-AUDIT-TENANT` | `R0-34-KEY-AUDIT-TENANT` | Step 6 |
| `V1-14-PUB-PORTAL-VOICE-BINDING` (portal grant) | `R0-33-PORTAL-GRANT-TENANT` | Step 6 |
| (new) | `R0-00-WT-ISOLATION`, `R0-32-ONBOARD-COMPLETE-SERVER`, `R0-35-EXIT-PROOF` | Judge blocking issues (section h) |

**`.agent-control` handling.** These files are written only by the integrating session on the working branch, never inside packet worktrees. The exception is R0-01, whose purpose is to reconcile them. So they are left out of the disjointness check for every other packet.

---

## (d) Wave plan

### Execution protocol (every packet)

0. **Resources (R0-00).** Before a packet starts, the integrating session runs `scripts/worktree-resources.sh provision <id>` in the main tree. That creates:
   - database `kf_wt_<id>`, copied from a template that `prisma migrate deploy` built in the main tree;
   - a Redis index from 1 to 15;
   - the worktree's gitignored `.env`.

   The session records these, with the packet's fixture prefix from `apps/server/test/helpers/fixture-prefixes.json`, in `active-packet.yaml` and in the resource ledger (section f). The worktree shell never exports `DATABASE_URL` or `REDIS_URL`, because dotenv would not override them. Until R0-00 lands, the in-flight R0-05 and R0-17 run real-DB suites one at a time.
1. **Branch.** Branch `pkt/<id>` from the current working-branch head into its own worktree.
2. **Tests first.** Commit the `tests_first` files alone, including the packet's K12 case manifest. Run them and record the pre-fix result at that exact SHA: red for a defect fix, characterization for new coverage.
3. **Implement.** Change only files in `write_set`. If the fix needs another file, stop and post a CONTRADICTION; never widen silently.
4. **Prove.** Run `admit-resources.mjs --packet <id>` first. Then re-run the packet tests, the Release 0 journey and the affected suites at the exact head, on the packet's own database. Run the scoped typecheck and the ESLint ratchet.
5. **Review.** Run two adversarial reviews (correctness/regression and security/tenancy), then a repair pass.
6. **Integrate.** Merge `--no-ff` into `claude/elegant-curie-7azpsb` only. Never merge to main. Re-run the packet tests in the main tree. Release the packet's resources. Leave `review_status: PENDING_CHATGPT_REVIEW`.
7. **Main-tree groups (`V1-MT*`).** Each holds exactly one packet and runs alone in the main tree.
   - **Before it starts:** `git worktree list` shows only the main tree, counting review and locked worktrees (four exist at revision).
   - **Never inside a worktree:** `pnpm install`, lockfile changes and `prisma generate`. Worktrees symlink `node_modules` and `apps/server/node_modules` to the main tree, and `@keyflow/*` resolve to main-tree packages.
   - **Migrations:** schema migrations never run in worktrees. Worktree databases are copies of the main tree's deployed template. After a migration lands, `worktree-resources.sh reprovision` rebuilds the template and every live packet database.
8. **Ordering.** Because `depends_on` includes every file-order edge, a packet may start as soon as its `depends_on` are integrated. Groups are DAG levels, capped at 10 packets with the longest remaining path first, and are shown for planning only. If an owner decision rules a gated packet out, the integrating session withdraws it and re-points its file-order edges to the previous active writer of each file.
9. **Stop rules.** A packet that finds it needs a schema change stops, and an isolated main-tree migration packet is opened first. This applies to R0-14 option B, V1-29 if D-14 adds a REFUNDED state, V1-33, V1-44 if D-28 retires enum values, and V1-45.

### Wave R0: the Release 0 journey end to end (31 packets, 169 h)

Scope:

- Isolation of the build itself.
- Auth and business: sign-up, onboarding without AI, selection.
- Contacts.
- The invoice path of "invoice or quote", including quote-route authorization.
- Manual payment plus ledger and audit row.
- Every confirmed cross-tenant finding.
- Optional services failing visibly, with the cost ledger.
- Cockpit navigation.
- The journey test harness: jsdom, Playwright, and K12 manifests for every suite.

The public link, the receipt, the quote branch and cockpit truth are V1 unless D-07 or D-04 rule them in.

| Group | Packets | Total h | Wall h (max) | Members |
|---|---|---|---|---|
| R0-G0 | 7 | 46 | 8 | `R0-00-WT-ISOLATION`, `R0-05-ID-REALDB-TENANT-ALIGN`, `R0-15-WEB-DENIAL-STATES`, `R0-06-WEB-ONBOARD-MANUAL`, `R0-17-PAYMENT-TX-INTEGRITY`, `R0-08-WEB-NAV-LINKS`, `R0-31-SEC-CREDENTIAL-REMOVE` |
| R0-G1 | 10 | 56 | 8 | `R0-18-WEB-BUSINESS-SELECTION`, `R0-21-WEB-PAYMENT-FORMS`, `R0-02-REV-AUTH-CONFORM`, `R0-01-CT-RECONCILE`, `R0-07-OPTIONAL-SVC-VISIBLE`, `R0-14-AUTH-LOCAL-SIGNIN`, `R0-27-REVENUE-CREATE-CONTRACT`, `R0-32-ONBOARD-COMPLETE-SERVER`, `R0-12-CT-TENANT-ROUTES`, `R0-13-CT-PERSISTENCE-PROOF` |
| R0-G2 | 6 | 14 | 5 | `R0-19-EVIDENCE-BASELINE`, `R0-33-PORTAL-GRANT-TENANT`, `R0-34-KEY-AUDIT-TENANT`, `R0-03-CT-AUDIT-ACTOR`, `R0-04-QT-DETAIL-ROUTE`, `R0-11-PL07-PAYMENT-ACTOR` |
| R0-G3 | 4 | 30 | 10 | `R0-16-PROOF-BINDING`, `R0-23-WEB-R0-SCREENS`, `R0-22-PUBLIC-INTENT-HARDEN`, `R0-09-ID-HARDEN` |
| R0-G4 | 2 | 15 | 12 | `R0-25-PLAYWRIGHT-R0`, `R0-28-QUOTE-STATUS-AUTH` |
| R0-G5 | 1 | 5 | 5 | `R0-20-MARKPAID-CONVERGENCE` |
| R0-G6 | 1 | 3 | 3 | `R0-35-EXIT-PROOF` |

- **Critical path:** about 39 h as a DAG (R0-05 → R0-18 → R0-23 → R0-25 → R0-35). About 51 h if every group waits for the one before it. Both figures are lower bounds on effort, because the estimates are judgement and several sit at the 8 h ceiling.
- **The commerce chain.** Write-set disjointness serializes `commerce.service.ts`: R0-17 → R0-27 → R0-22 → R0-28 → R0-20, about 26 h. R0-20 is last because it alone waits on a decision (D-05). The map does not split that file to gain concurrency; that would be a refactor, against the rules.
- **Concurrency.** At most 15 real-DB packets run at once (Redis indexes 1-15).

**R0 exit gate. All of the following must hold:**

- Every R0 packet is integrated with a RETURN.
- R0-35 is green: every Release 0 server suite is bound by a manifest, and `proof:release0` is green in CI at the exact head with zero unexplained skips.
- The jsdom Release 0 test (R0-23) and the live Playwright journey (R0-25) are green. The live run starts at sign-up, or records the D-02 option C substitution.
- **Decisions are resolved:**
  - every decision an R0 packet depends on: D-02, D-03, D-05, D-09 and D-11;
  - the scope rulings D-04 (quote branch) and D-07 (link and receipt). If either rules packets in, they join R0 at the end of the R0 commerce chain, and the gate waits for them;
  - D-24 (#174's withheld findings).
- The seven-step table above shows PASS for every step in both columns. For step 6, that is within the scope stated under the table.

The staging run and the deployment (issue #186 steps B and E) stay operator-authorized under D-20.

### Wave V1: remaining P0/P1 scope (55 packets, 339 h)

Scope: bounded KEY (P0 fail-closed and principal first), bookings, the event feed, minimal storefront and public boundaries, data-model and money hardening, authority ceilings, contacts visibility completion, and security/CI hygiene. It also holds the conditional Release 0 candidates: V1-48 and V1-49 (D-07) and V1-50 to V1-53 (D-04).

| Group | Packets | Total h | Wall h (max) | Members |
|---|---|---|---|---|
| V1-G1 | 10 | 63 | 12 | `V1-15-DM-LEDGER-WRITE-DOOR`, `V1-22-DM-MONEY-CENTS`, `V1-03-KEY-CORTEX-PRINCIPAL`, `V1-10-KEY-PLANNER-CLAIM`, `V1-12-DM-RECURRING-GUARD`, `V1-06-BK-BASELINE-PARITY`, `V1-47-COCKPIT-TRUTH`, `V1-54-CT-ROUTE-ORDER-CALLER`, `V1-01-SEC-CREDENTIAL-SECRET-SCAN`, `V1-09-KEY-COMMAND-GOVERNED` |
| V1-G2 | 10 | 59 | 8 | `V1-13-SEC-NATIVE-DAST`, `V1-07-AUTH-INVITE-CEILING`, `V1-18-PUB-STOREFRONT-PAID-EVENT`, `V1-02-KEY-CORTEX-FAILCLOSED`, `V1-05-PUB-PROVIDER-CALLBACKS`, `V1-40-SEC-TRUST-CENSUS-REDACTION`, `V1-14-PUB-PORTAL-VOICE-BINDING`, `V1-35-DM-POLLER-CLAIM`, `V1-41-DM-UNTRUSTED-MONEY-INPUTS`, `V1-32-KEY-PROPOSAL-CLAIM` |
| V1-G3 | 2 | 6 | 3 | `V1-04-KEY-OVERSIGHT-SELECTIVE`, `V1-56-AUTH-USERNAME-THROTTLE` |
| V1-G4 | 10 | 67 | 12 | `V1-34-DM-CASH-POSITION`, `V1-29-DM-REFUND-CONVENTION`, `V1-31-KEY-FLOW-CONFIRM-BIND`, `V1-19-KEY-IDEMPOTENCY-CLAIM`, `V1-16-BK-SLOT-CONCURRENCY`, `V1-08-CT-SIBLING-VISIBILITY`, `V1-24-KEY-KILL-SWITCHES`, `V1-20-SEC-VERIFY-UP`, `V1-25-EVT-BUSINESS-FEED`, `V1-30-SEC-DAST-GATE-SWAP` |
| V1-G5 | 4 | 26 | 8 | `V1-38-CT-PRIVACY-PURGE-STATUS`, `V1-21-AUTH-JOBROLE-CEILING`, `V1-23-PUB-PUBLIC-PROJECTIONS`, `V1-33-PUB-CHECKOUT-RETRY-OFFLINE` |
| V1-G6 | 2 | 12 | 8 | `V1-28-BK-SETTLEMENT`, `V1-55-EVT-ACTIVITY-DEDUPE` |
| V1-MT1 | 1 | 5 | 5 | `V1-17-DM-CONTACT-PARTIAL-UNIQUE` |
| V1-MT2 | 1 | 3 | 3 | `V1-26-CT-TRPC-VISIBILITY` |
| V1-MT3 | 1 | 5 | 5 | `V1-27-BK-SLOT-WRITERS` |
| V1-MT4 | 1 | 9 | 9 | `V1-36-DM-BALANCE-READ-CONTRACT` |
| V1-G7 | 2 | 12 | 8 | `V1-37-DM-CURRENCY`, `V1-39-SEC-RUNTIME-PIN` |
| V1-G8 | 1 | 10 | 10 | `V1-42-DM-LIFECYCLE-OWNER-CAS` |
| V1-G9 | 2 | 15 | 8 | `V1-43-DM-NUMBERING`, `V1-44-DM-CREDIT-NOTE` |
| V1-G10 | 1 | 6 | 6 | `V1-45-DM-CREATE-IDEMPOTENCY` |
| V1-G11 | 1 | 7 | 7 | `V1-48-PUBLIC-TOKEN-VIEW` |
| V1-G12 | 1 | 6 | 6 | `V1-49-PUBLIC-RECEIPT` |
| V1-G13 | 1 | 7 | 7 | `V1-46-PUB-PAY-LINK-TOKEN-GATE` |
| V1-G14 | 1 | 5 | 5 | `V1-50-QUOTE-STATE-MACHINE` |
| V1-G15 | 1 | 7 | 7 | `V1-51-QUOTE-CONVERSION-JOURNEY` |
| V1-G16 | 1 | 5 | 5 | `V1-52-QUOTE-PUBLIC-LINK` |
| V1-G17 | 1 | 4 | 4 | `V1-53-QUOTE-CREATE-ERRORS` |

V1 starts after the R0 exit gate. V1 packets whose write sets touch no open R0 packet could start earlier, but only if the owner allows it (D-31), and never before R0-00 has landed.

- **Critical path:** about 101 h as a DAG, set by the `commerce.service.ts` chain from V1-15 through V1-53. About 146 h if every group waits for the one before it. Six links of that chain (V1-48 to V1-53, about 34 h) are the D-04 and D-07 candidates, which sit at its end because each waits on a decision. If D-04 or D-07 rules them into R0 or out of scope, the V1 chain shortens accordingly.
- **Re-estimates.** These packets were raised from the draft's 8 h ceiling, and the figures remain judgement: V1-24 (12 h), V1-15 (12 h), V1-42 (10 h) and V1-36 (9 h).

**V1 exit gate. All of the following must hold:**

- Every V1 packet is integrated.
- A real-DB trial balance balances per currency after payment, refund, void and credit note.
- The KEY suites are green both with `AI_DISABLED` and with providers configured.
- Booking settlement passes on a real DB.
- Security scans block the build, and the packages/api specs run in CI.
- The runtime is pinned.

### File-order edges (20)

Each edge below connects two packets that write the same file. Without it, they would be ordered only by group barriers, which D-31 or in-flight stacking could break.

| Later packet | Earlier packet | Shared file(s) |
|---|---|---|
| R0-27 | R0-17 | `apps/server/src/modules/commerce/commerce.service.ts` |
| R0-22 | R0-02 | `apps/server/test/revenue-authorization.integration.test.ts` |
| R0-22 | R0-27 | `apps/server/src/modules/commerce/commerce.controller.ts`, `apps/server/src/modules/commerce/commerce.service.ts` |
| R0-09 | R0-14 | `.env.example` |
| R0-28 | R0-22 | `apps/server/src/modules/commerce/commerce.controller.ts`, `apps/server/src/modules/commerce/commerce.service.ts` |
| R0-20 | R0-28 | `apps/server/src/modules/commerce/commerce.service.ts` |
| V1-22 | R0-20 | `apps/server/src/modules/commerce/commerce.service.ts` |
| V1-47 | R0-16 | `apps/server/test/release0-journey.integration.test.ts` |
| V1-01 | R0-25 | `.github/workflows/ci-cd.yml` |
| V1-08 | V1-54 | `apps/server/src/modules/crm/crm.controller.ts`, `apps/server/test/crm.e2e.test.ts` |
| V1-24 | R0-09 | `.env.example` |
| V1-24 | V1-47 | `apps/server/test/release0-journey.integration.test.ts` |
| V1-55 | V1-25 | `apps/server/test/evidence-feed.integration.test.ts` |
| V1-26 | V1-20 | `.github/workflows/ci-cd.yml` |
| V1-36 | R0-21 | `apps/web/src/app/app/commerce/invoices/invoices-panel.tsx` |
| V1-39 | V1-26 | `.github/workflows/ci-cd.yml` |
| V1-48 | V1-45 | `apps/server/src/modules/commerce/commerce.service.ts`, `apps/web/src/lib/client.ts` |
| V1-46 | V1-49 | `apps/server/src/modules/commerce/commerce.controller.ts`, `apps/server/src/modules/commerce/commerce.service.ts`, `apps/web/src/app/public/invoice/[token]/page.tsx` |
| V1-50 | V1-46 | `apps/server/src/modules/commerce/commerce.service.ts` |
| V1-53 | V1-52 | `apps/server/src/modules/commerce/commerce.controller.ts`, `apps/server/src/modules/commerce/commerce.service.ts` |

### Wave V1+: later, preserved backlog (not queued; no packet written yet)

| Item | Source | Disposition and re-entry trigger |
|---|---|---|
| D-2 consolidation: cockpit redirect stubs, 4+ KEY entry points, dead billing stack of about 3.3k lines | M08; CWS-BP4, CWS-BP5, CWS-BP6, KEY-ENTRYPOINT-CONSOLIDATE-001 | P2. Removal needs reachability proof; V1 scope allows only small corrective UX (R0-08). |
| Full `DEFAULT_BUSINESS_ID` sweep of `client.ts` (132 functions) | M03 | P2. R0-15 covers the Release 0 screens and pins the remaining count so it can only shrink. |
| Bookings BK-04, BK-05, BK-07, BK-08: client-side slot picker, legacy ISO-text pages, deposit configuration writer, cancel/no-show financial disposition | M42, M43 | P2, after V1-28. Cancel policy needs D-26. |
| Storefront SSP-BP-04 to 08 and BP-PC-06 to 08; the portal web route; retiring KEYPORTAL KP-1..35 | M37, M38, M39 | Needs D-18. Presence plus `/book` already cover KEYPORTAL. |
| Staged Decimal migration (DM-005), DM-006, DM-007 | M23, M55 | After V1-22. Needs D-13. |
| Payment tenancy (DM-008): FK to Business, Payment readers under the tenant extension | M31 | A migration. Needs a production data check (D-20). Until then, foreign-tenant Payment controls in each packet. |
| Identity AB-BP06/07/08: suspension state, real-DB invite reconcile, `Business.ownerId` FK, founding-membership backfill receipts | M05, CF-25 | Needs D-11. |
| Contacts CT-BP-06 (firstName contract between manual route and form) | M12; DEC-CONTACTS-001/002 | Needs D-25. |
| PKT-FLOW-006 (Date.now flow-run keys), PKT-TIME-007, PKT-OVD-008 (duplicate OVERDUE authority) | M52, CF-51 | TIME-001 / TEMPORAL-002. |
| KF-HARNESS-TEST-TYPECHECK-001 (tests never type-checked), KF-HARNESS-PKG-TESTS-001 (packages specs never run) | M58 | P1 infra, after R0-16. V1-26 adds the packages/api step; the rest of the packages remain. |
| Soft-delete coverage (14 of 33 models), update/aggregate gaps | M54 | P2. |
| Migration drift gate, archived Contact FTS trigger, stray raw-SQL scripts, silent findMany cap | M55, CF-52 | MIGRATE-001. The drift gate must allowlist V1-17's SQL-only index. |
| Public-surface ledger parser accuracy and 429 tests | M33 | P2. |
| KEY surfaces that report success for stubs (`placeholder_execution`, queued `/actions`) | M48 | P2. |
| D-1: eight execution authorities, dead AutomationService, ADR-0001 import guard, playbook test-run honesty, FlowTemplate versioning | M51, CF-53 | PLAYBOOK-001. |
| Webhook processing lifecycle; legacy `/webhooks/stripe` convergence; RA-G16-01 service-level tightening | CF-50; NC contract section 4.5 | INGRESS-001, unless D-05 moves RA-G16-01 into R0-20. The webhook change needs D-05. |
| ScheduledAgentJob lease (beyond V1-35), FlowRunner durable delay, `invoice.overdue` consequence identity | CF-51 | TIME-001 / TEMPORAL-002. |
| Invitation model, AUTH shadow on Release 0 routes, KEY capability contract test, registry drift gate, doc corrections, release receipt, global P2002→409 mapping | corpus v1 overflow; CF-29, CF-55 | Re-plan after the V1 exit gate. |
| `/readyz` Redis probe (moved out of R0-07) and migration-parity probe | CF-52, PRS-M02 | OPS-001. Redis is required infrastructure, not an optional service. Inject the failure per process (an unreachable `REDIS_URL` for the spawned server), never by stopping the shared container. |
| Deferred domains: SEO (GSC/GA4), Shopify, ticketing and events (SPACE-001), directory mock, public-events analytics, temporal/momentum, event-stream SSE, Google Calendar sync, invoice-from-time Int quantity (F228), playbook library and TEMPORAL-002, people-flow, Growth engine and paid ads, Network and Index (NETWORK-001), voice metering and LiveKit (VOICE-001), KNOWLEDGE-001/002 genome lineage, privacy derived state (PRIVACY-001), EXTFX rollout gate, CONNECTOR-001 fencing, inbound email/SMS and CONVO-001, TIME-001 occurrences, RECOVERY operator items, J8 projects and time billing, J11 contracts, J12 documents, payroll, subscription lifecycle and AI metering (ENTITLE-001), WITHDRAW-001/002, MIGRATE-001, OPS SLOs and DLQ, RELEASE canary, COGNITION-001, gamification XP idempotency, autopilot fabricated evidence (F090-F094), admin route gate (R19), keystore and API-key admin scopes | V1-MODULE-SCOPE P2-1..P2-8; wave board Waves B-E; M60; CF-57 | DEFER. Preserved with full vision. |
| PR-sourced later product items: #162 self-model, #161 finance tools, #158 goal tracker, #160 message_intake equivalence, #134 quarantine ingestion plus `search_knowledge` status filter, #112 `validFrom`, #127 auditor masking, #63 enrichment SSRF and parsing, #91 web-build Prisma scoping, #148 dedupe hash, KEY evolution learning methods (PRS-M36) | PRS family | DEFER, except as the tie-off ruled (D-141, 2026-11-13): #158 adopted, #91's web-build scoping ported, #148's plan ported as a DEFER V1+ record; #63, #134, #162 and #161 (after #195) queued as wave-11b packets; #160, #112 and #127 closed. See section (e). |
| Control-plane work (owned by ChatGPT through #80): PR discovery (#185 vs #170 vs #168), base-aware divergence (#107), #171, #169/#175, #172, #184, worker GH_TOKEN proof skip (PRS-M49), #111, #152, #176, #191, the Atlas chain | PRS-M39 to PRS-M50 | Not product work. D-32 resolved by D-141 (2026-11-13): #185, #184, #171, #169/#175, #172, #168, #176 and #191 ported; #170, #107, #111, #152 and the Atlas chain closed (#141 kept as a design record); the worker GH_TOKEN proof (PRS-M49) is a follow-up control packet. See section (e). |

---

## (e) Open-PR disposition (classified 2026-10-31; tied off 2026-11-13)

Source: `GET /repos/SaCH-PRO/KEYFLOWOS/pulls?state=open` on 2026-10-31, which returned **59 open PRs**. These were cross-checked against the 10 PR-family lanes. This revision changed only the queue links of #174, #183 and #114.

**Tie-off, 2026-11-12/13 (D-141).** Every open PR and branch is tied off. Each row below now says what actually happened, with its 2026-10-31 class in brackets and its original note after it. The ports landed through int/converge-1 and int/converge-final; the `conv/*` branch named in a note is the packet that brought it. Every branch gets an `archive/<branch>` tag and is then deleted. The 22 old-history branches get clean archive tags (their own change squashed onto main and secret-scanned), because their history carries a committed `.env`.

The tie-off dispositions are:

| Disposition | Meaning |
|---|---|
| PORTED | All of the PR's change is on main through the tie-off, with dated notes where needed. The PR is closed with a note. |
| PORTED PARTS | Only the parts the note names are on main; the rest stays on the archive tag. |
| CLOSED already-in-main | Main already had the change (the note names the commit). Closed with a note. |
| CLOSED superseded | Main has replaced the change or rules it out. Closed with a note; nothing brought. |
| CLOSED not adopted (D-141) | A control-plane experiment closed and archived, not ported. |
| QUEUED wave 11b | An unfinished feature, rebuilt tests-first as a wave-11b packet. |

The 2026-10-31 classifications were:

| Classification | Meaning |
|---|---|
| ADOPTED | Code already on the working branch. |
| PORT | Port only the named hunks into the named queue packet; never the `.agent-control` rewrites (PRS-M40). |
| EVIDENCE | Input to a packet or decision; no code port. |
| DEFER | Product value later (V1+). |
| CONTROL | Control-plane work; a ChatGPT/#80 decision. |
| DOCS | Documentation placement ruling needed (main vs intel branch). |
| STALE | Superseded or out of date. |
| NONE | No v1 value. |

Counts at the tie-off (59 PRs): PORTED 18, PORTED PARTS 14, CLOSED already-in-main 4, CLOSED superseded 12, CLOSED not adopted (D-141) 7, QUEUED wave 11b 4. Classified 2026-10-31: ADOPTED 1, CONTROL 15, DEFER 8, DOCS 10, EVIDENCE 3, NONE 9, PORT 9, STALE 4. No open PR other than #190 touched the Release 0 path (PRS-M56).

| PR | Base | Disposition (2026-10-31 class) | Queue link | Note |
|---|---|---|---|---|
| #38 KEY IRONCLAD — The 9 Layers of Consciousness | main | CLOSED superseded (was STALE) | — | Tie-off: closed, nothing brought; the organs are on main in modules/key-cortex and POST conscious/chat replaced its endpoints (PRS-M38). Old-history branch: clean archive tag. Classified 2026-10-31: Services already on main and further evolved; the 10 endpoints are superseded by POST conscious/chat (PRS-M38). |
| #63 Free contact enrichment by default (no paid account); Apollo now optional | main | QUEUED wave 11b (was DEFER) | V1+ | Tie-off: website-based contact enrichment is a wave-11b packet (D-141), rebuilt tests-first on main's outbound-address guard with robust parsing (PRS-M14). Old-history branch: clean archive tag. Classified 2026-10-31: A CONTACTS-v1 non-goal. Fetches by default; parsing and SSRF fixes needed (PRS-M14). |
| #90 chore: optimize Copilot code review for KEYFLOWOS | main | PORTED (was STALE) | — | Tie-off (conv/docs-records): the five Copilot review-guidance files under `.github/`, with the programme-state bullet rewritten to the control-state precedence of AGENT_CONTROL_PLANE.md and this map added to the read-first list (PRS-M10 closed). Classified 2026-10-31: Folded into #94, which #104 superseded (PRS-M10). |
| #91 chore: align KEYFLOWOS runtime with Node 24 for Vercel | main | PORTED PARTS (was PORT) | V1-39 | Tie-off (conv/web-build-vercel): the turbo.json web-build Prisma scoping and the removal of the /_next/static Cache-Control override (PRS-M57 closed). The Node 24 changes were dropped (D-21). Classified 2026-10-31: Runtime-pin pieces only, after D-21. Web-build Prisma scoping is V1+ (PRS-M04, PRS-M57). |
| #94 KF-AI-PR-REVIEW-GATE-001: exact-head AI review admission gate | main | CLOSED superseded (was STALE) | — | Tie-off: closed, nothing brought. The reviewer policy it carried reached main through #90's port (PRS-M10); its AI Review Gate is superseded by main's semantic-review admission. Classified 2026-10-31: Superseded by #104's provider-neutral review (PRS-M10). |
| #105 docs: canonical KEYFLOW Connector Fabric architecture | intel branch | PORTED (was DOCS) | — | Tie-off (conv/intelligence-corpus): the 3 Connector Fabric architecture files, marked 'V1+ target architecture (P2-6), not current programme law', and the wave-board paragraph (D-141; PRS-M52 closed). Classified 2026-10-31: Connector Fabric architecture (P2-6); needs a placement ruling (PRS-M52). |
| #107 KF-META-BRANCH-ROLES-001: base-aware divergence and canonical branch roles | main | CLOSED not adopted (D-141) (was CONTROL) | — | Tie-off: closed; every branch converges to main, so base-aware divergence always resolves to main (PRS-M43 closed). Classified 2026-10-31: Base-aware divergence; the job rename may orphan a required check (PRS-M43). Needs D-32. |
| #111 KF-META-DISPATCH-QUEUE-001: per-packet authority queue foundation | main | CLOSED not adopted (D-141) (was CONTROL) | — | Tie-off: one of the eight control-plane experiments closed and archived, not ported (PRS-M41 closed). Classified 2026-10-31: Authority-queue library, never wired into select-directive (PRS-M41). |
| #112 KF-META-CONTEXT-GENOME-001: shared temporal context substrate foundation | main | CLOSED not adopted (D-141) (was DEFER) | V1+ | Tie-off: one of the eight control-plane experiments closed and archived, not ported; the validFrom defect never reached main (PRS-M37 closed). Classified 2026-10-31: Context genome (P2-7). validFrom is set from verification time (PRS-M37). |
| #114 KF-META-PROOF-INTEGRITY-001: eliminate fake green and hidden proof skips | main | PORTED PARTS (was PORT) | V1-01, V1-13, V1-30 | Tie-off (conv/agent-control-observability): the branch-divergence capture-and-reraise check, added to workflow-integrity.spec.mjs. Its DAST harness, gate swap and audit capture were already on main (V1-01, V1-13, V1-30). The worker GH_TOKEN plus CI-mandatory cursor proof is a follow-up control packet (PRS-M49 open). Classified 2026-10-31: Port only the audit-outcome capture (V1-01), the native DAST harness (V1-13) and the gate swap (V1-30). The worker GH_TOKEN fix is CONTROL (PRS-M07/M08/M09/M49). It keeps base: main, so it must not be ported alone. |
| #127 KF-META-MEMORY-TRUTH-AUDIT-001: executable static memory proof baseline | main | CLOSED not adopted (D-141) (was DEFER) | V1+ | Tie-off: one of the eight control-plane experiments closed and archived, not ported. Classified 2026-10-31: Memory truth audit. The DORMANT class can never fire (PRS-M36). |
| #128 KEY cognitive architecture archaeology and convergence pass 001 | intel branch | PORTED PARTS (was DOCS) | — | Tie-off (conv/intelligence-corpus): the 6 research docs, each with a dated historical note; the root PROJECT-SOURCE-BOOTSTRAP.md, the ledger and the handoff edits were not brought (PRS-M53 closed). Classified 2026-10-31: KEY cognitive archaeology. Its ledger direction is superseded by the product-first plan (PRS-M53). |
| #133 KF-ASSURANCE-FABRIC-001: risk-derived proof obligation compiler | main | CLOSED superseded (was NONE) | — | Tie-off: closed, nothing brought; main's exact-head proof manifests (scripts/proof-admission) do this outside the product runtime (PRS-M51 closed). Classified 2026-10-31: Development-system proof compiler placed inside the product API (PRS-M51). |
| #134 KF-LEARNING-STREAM-001: make existing knowledge ingestion safely reachable | main | QUEUED wave 11b (was DEFER) | V1+ | Tie-off: business knowledge upload is a wave-11b packet (D-141); it needs a status filter in cortex.search_knowledge and RequireModuleScope first (PRS-M31). Classified 2026-10-31: Quarantine-first ingestion is only valid once search_knowledge gets a status filter (PRS-M31). |
| #136 KF-META-PROCEDURAL-MORPHOGENESIS-001: canonical contracts and experiment foundation | main | PORTED PARTS (was DOCS) | — | Tie-off (conv/docs-records-2): the research doc and the key-cognition schemas, experiments and benchmark. Its auto-triggering .agents/skills/procedural-intelligence/SKILL.md was dropped (D-149). Classified 2026-10-31: Procedural morphogenesis contracts (PRS-M52). |
| #139 KF-KEY-NATIVE-CAPACITY-SHADOW-001: latent read-only capacity loop | main | CLOSED superseded (was NONE) | — | Tie-off: closed, nothing brought; main's binding tests supersede its control tests and the #80 motif miner is not adopted (PRS-M51 closed). Classified 2026-10-31: Daily cron that mines #80; conflicts with main (PRS-M51). |
| #141 KF-ATLAS-001: establish the KEYFLOWOS Living System Atlas foundation | main | PORTED PARTS (was NONE) | — | Tie-off (conv/docs-records): architecture/atlas README, SCHEMA, atlas.yaml and MISSION-CONTROL-INTEGRATION.md as a dated, never-materialized design record; the AGENTS.md hunks and the status YAML were not brought (PRS-M46 closed). Classified 2026-10-31: Atlas foundation; cites the closed #132 as built (PRS-M45/M46). |
| #142 KF-ATLAS-MATERIALIZER-001: deterministically materialize the Living System Atlas | docs/kf-living-system-atlas-001 | CLOSED superseded (was NONE) | — | Tie-off: closed, nothing brought; the generator has no consumer and this map's registries and coverage ledger are the maps in use (PRS-M46 closed). Classified 2026-10-31: Atlas materializer; outputs never generated (PRS-M46). |
| #143 KF-ATLAS-INTELLIGENCE-001: import canonical journeys kernels and contradictions | impl/kf-atlas-materializer-001 | CLOSED superseded (was NONE) | — | Tie-off: closed, nothing brought; replaced by the (f) coverage ledger, and its synchronizer does not parse (PRS-M46 closed). Classified 2026-10-31: Atlas intelligence import; stale snapshot (PRS-M46). |
| #144 KF-ATLAS-PACKET-SEMANTIC-INDEX-001: map packets to journeys and kernels | impl/kf-atlas-intelligence-import-001 | CLOSED superseded (was NONE) | — | Tie-off: closed, nothing brought; packet-to-journey mapping is done by the (f) coverage ledger (PRS-M46 closed). Classified 2026-10-31: Atlas packet semantic index (PRS-M46). |
| #145 KF-ATLAS-CODE-LINKS-001: verify packet seams against current code | impl/kf-atlas-packet-semantic-index-001 | CLOSED superseded (was NONE) | — | Tie-off: closed; the Atlas design record reached main through #141's port and the generator never produced outputs. Its extra docs stay on the archive tag (PRS-M46 closed). Classified 2026-10-31: Atlas code links; the backslash path guard can be bypassed (PRS-M46). |
| #146 KF-MISSION-CONTROL-ATLAS-READMODEL-001: build the owner Atlas control panel foundation | impl/kf-atlas-code-links-001 | CLOSED not adopted (D-141) (was NONE) | — | Tie-off: one of the eight control-plane experiments closed and archived, not ported; no product Mission Control page (PRS-M45 closed). Classified 2026-10-31: Mission-control Atlas panel; collides with #179 on api/admin/mission-control (PRS-M45). |
| #148 KF-MEMORY-CONTEXT-GENOME-PLAN-001: converge KEY memory into a portable evidence-grounded world model | impl/kf-mission-control-atlas-readmodel-001 | PORTED PARTS (was DEFER) | V1+ | Tie-off (conv/docs-records-2): the 3 memory planning files with a dated correction note (the dead resolveConflicts delete, the now() dedupe fallback), status DEFER V1+; the 52 stacked Atlas / Mission Control commits were not brought (PRS-M35 closed). Classified 2026-10-31: Memory plan: the destructive-consolidation claim is wrong, and the dedupe hash falls back to now() (PRS-M35). |
| #149 KF-AGENT-PARALLEL-ORCHESTRATION-PLAN-001: scale Claude safely across multiple packet worktrees | main | PORTED PARTS (was CONTROL) | — | Tie-off (conv/docs-records-2): the plan with a dated historical header (never adopted; R0-00 implemented resource isolation; its open-PR map is superseded by this section) (PRS-M53 closed). Classified 2026-10-31: Parallel orchestration plan, gated on ACTION-001, which has since merged (PRS-M53). R0-00 implements the resource half for this queue. |
| #150 KF-OPEN-PR-CONVERGENCE-001: classify and converge every open PR | main | CLOSED superseded (was STALE) | — | Tie-off: closed, nothing brought; replaced by this section and the tie-off. Its inventory script reached main through #168 (PRS-M47 closed). Classified 2026-10-31: Convergence board from 2026-10-06 (39 open then vs 59 now) (PRS-M47). |
| #152 KF-META-PR-UNLOCK-CONTRACT-001: make PR value/unlocks explicit and testable | main | CLOSED not adopted (D-141) (was CONTROL) | — | Tie-off: one of the eight control-plane experiments closed and archived, not ported; no mandatory unlock YAML (PRS-M50 closed). Classified 2026-10-31: Would make an unlock YAML mandatory for every PR to main (PRS-M50). |
| #154 docs(rnd): establish durable multi-lens research corpus | intel branch | PORTED (was DOCS) | — | Tie-off (conv/intelligence-corpus): all 56 files, the research corpus and the scripts/agent-control/research compiler, as a dated historical record (D-141; PRS-M52 closed). Classified 2026-10-31: R&D corpus with a prototype compile-context script (PRS-M52). |
| #155 KF-EXEC-AUTH-FAIL-CLOSED-001: parsed-command autonomy fails closed | main | CLOSED already-in-main (was PORT) | V1-02 | Tie-off: closed; on main as V1-02-KEY-CORTEX-FAILCLOSED (ee15ad04, cedc9712), merged in #197 at f5d58ef7 (PRS-M22 closed). Classified 2026-10-31: Port the parsed-command fail-closed block and its 11 tests, byte-equivalent to 26c10943. Admission is blocked by #184 (PRS-M19/M21/M22). |
| #156 docs(rnd): cross-converge book corpus with GenAI stack | docs/rnd-corpus-foundation-001 | PORTED (was DOCS) | — | Tie-off (conv/intelligence-corpus): applied on top of #154 (D-141; PRS-M52 closed). Classified 2026-10-31: Book/GenAI convergence; stale against its research base (PRS-M52). |
| #157 KFCI-2026-10-06-01: converge active streams and repair intelligence continuity | intel branch | PORTED PARTS (was DOCS) | — | Tie-off (conv/intelligence-corpus): the 7 records as dated history; the root PROJECT-SOURCE-BOOTSTRAP.md and its handoff rewrites were not brought (PRS-M43, PRS-M53 closed). Classified 2026-10-31: Convergence introspection; pins main to ac3a6384 (PRS-M53/M43). |
| #158 fix(ai): tenant-scope BusinessGoal progress writes | main | PORTED (was DEFER) | — | Tie-off (conv/goal-tenant-safety): adopted unchanged (a0a3a861, 72752f3d): updateProgress and suggestActions write BusinessGoal through updateMany scoped by businessId, like updateGoal, return null / [] when the scoped write matches nothing, and emit goal.achieved only when the call made the active-to-achieved transition (PRS-M34 closed). Classified 2026-10-31: Goal tracker; the tenant extension already blocks cross-tenant writes (PRS-M34). |
| #160 fix(ai): route KEY command intake through canonical capability | main | CLOSED superseded (was PORT) | V1-09 | Tie-off: closed, nothing brought; the routing hunk is on main as V1-09 resolveCapability and the message_intake remap stays rejected (PRS-M29). Classified 2026-10-31: Port only the @@ -200 bare-name routing hunk. The @@ -173 message_intake remap is not equivalent and is not ported (PRS-M28/M29). |
| #161 feat(ai): canonicalize KEY finance intelligence capabilities | main | QUEUED wave 11b (was DEFER) | V1+ | Tie-off: ported tests-first after the #195 port, with the three tools under revenue read (D-57), per the tie-off classification (PRS-M33). Classified 2026-10-31: Canonical finance read tools (P2-2) (PRS-M33). |
| #162 feat(cortex): add operational KEY self-model projection | main | QUEUED wave 11b (was DEFER) | V1+ | Tie-off: the KEY operational self-model is a wave-11b packet (D-141): riskTier becomes riskLevel, the goal-status filter matches the stored case, Prisma errors are no longer swallowed, and it gets a consumer (PRS-M32). Classified 2026-10-31: KEY self-model with no consumer (P2-7) (PRS-M32). |
| #163 feat(intelligence): harvest historical project-thread knowledge | main | PORTED (was DOCS) | — | Tie-off (conv/docs-records): the harvester, its README, KF-HIR-001 (proposed, not adopted) and its tests (module registered before it runs); .artifacts/thread-harvest/ is ignored, and int/converge-1 hardened its redaction and output paths. No CI job runs the Python tests (PRS-M54 open). Classified 2026-10-31: Thread harvester; pytest has no CI runner and its output directory is not ignored (PRS-M54). |
| #164 docs: establish R&D external intelligence convergence contract | main | PORTED (was DOCS) | — | Tie-off (conv/docs-records-2): brought as written (D-141; PRS-M52 closed). Classified 2026-10-31: R&D external intelligence contract (PRS-M52). |
| #165 KF-INTEL-LOOP-001: Continuous intelligence and reconciliation contract | main | PORTED (was DOCS) | — | Tie-off (conv/docs-records-2): brought as written, with #164 (D-141; PRS-M52 closed). Classified 2026-10-31: Continuous intelligence loop; overlaps #164 (PRS-M52). |
| #167 docs(rd): skills-first harness convergence hypothesis and pilot | intel branch | PORTED (was DOCS) | — | Tie-off (conv/intelligence-corpus): both files (D-141; PRS-M52 closed). Classified 2026-10-31: Skills-harness R&D (PRS-M52). |
| #168 KF-PR-INVENTORY-001: extract bounded complete PR discovery from #150 | main | PORTED (was CONTROL) | — | Tie-off (conv/agent-control-observability): the read-only inventory script, its spec and the two dated docs. It does not drive the sweep; #185's lister does (PRS-M39, PRS-M47 closed). Classified 2026-10-31: PR inventory; byte-identical extraction of #150; one of three rival discovery fixes (PRS-M39/M47). |
| #169 fix(agent-control): a worktree the host can hold, and a worktree failure that is counted | main | PORTED (was CONTROL) | — | Tie-off (conv/agent-control-worker-coordination): both commits (PRS-M44 closed). Classified 2026-10-31: Windows worker worktree-path repair (PRS-M44). |
| #170 feat(agent-control): the hourly sweep sees every open PR, and may merge no more than before | main | CLOSED superseded (was CONTROL) | — | Tie-off: closed in favour of #185 (D-141); nothing brought (PRS-M39 closed). Classified 2026-10-31: PR discovery for the sweep; file conflict with #185; no directive (PRS-M39/M41). |
| #171 feat(agent-control): look again for an AUTO_MERGE record that was never posted | main | PORTED (was CONTROL) | — | Tie-off (conv/agent-control-sweep-admission): the merge-record audit step, with --reconcile (PRS-M41, PRS-M42 closed). Classified 2026-10-31: AUTO_MERGE record audit; no directive (PRS-M41/M42). |
| #172 feat(agent-control): see what the worker is doing, and which gates main has moved under | main | PORTED (was CONTROL) | — | Tie-off (conv/agent-control-observability): worker status and stale gates; the negative-controls conflict was resolved by keeping both blocks (PRS-M40 closed). Classified 2026-10-31: Agent-control observability; the only PR that textually conflicts with main (PRS-M40). |
| #173 docs(control): where each kind of truth lives; the checkpoint is not live state; TIME-001 admission preparation | main | PORTED PARTS (was EVIDENCE) | V1-35 | Tie-off (conv/docs-records-2): the DAG header-comment correction, CANONICAL-SOURCE.md refreshed to name this map as the current plan, and ADMISSION-PREPARATION.md as a dated record. The .agent-control/README.md correction and the CLAUDE.md pointer were not brought (control-plane follow-ups). Classified 2026-10-31: Canonical load path and TIME-001 admission prep; its 'one claimant' obligation feeds the poller claim (PRS-M18). |
| #174 docs(backlog): correctness and reliability candidates read from main | main | PORTED PARTS (was EVIDENCE) | V1-10, V1-12, V1-19, V1-35; D-24 | Tie-off (conv/docs-records-2): the doc verbatim with a dated header mapping each finding to its fix. AC-01/AC-02 stay withheld and D-24 stays open (PRS-M55 open). Classified 2026-10-31: Reliability backlog (KEY-01..04, REL-01..04). AC-01/AC-02 are withheld (PRS-M55); the R0 exit gate now waits for D-24. |
| #175 fix(agent-control): one worker per repository and issue; every pre-wake failure counted (stacked on #169) | fix/agent-control-worker-worktree-path-001 | PORTED (was CONTROL) | — | Tie-off (conv/agent-control-worker-coordination): both commits, with #169 (PRS-M44 closed). Classified 2026-10-31: Worker machine lock, stacked on #169 (PRS-M44). |
| #176 docs: propose the multi-AI review architecture (GPT-6 independent review, risk-adaptive gates) | main | PORTED (was CONTROL) | — | Tie-off (conv/docs-records-2): the proposal of record with a dated note. Implementing its review classes and the Kimi exclusion is follow-up control-plane work (PRS-M48 closed). Classified 2026-10-31: Multi-AI review architecture; partly stale against merge-grant.mjs (PRS-M48). |
| #177 docs(programme): integrated execution and recovery plan (inactive) | main | PORTED (was CONTROL) | — | Tie-off (conv/docs-records-2): the inactive October recovery plan, with a dated note that this map superseded it. Classified 2026-10-31: Integrated recovery programme (inactive). |
| #179 KF-META-HANDOFF-MONITOR-001: read-only handoff viewer (H1, draft) | main | CLOSED not adopted (D-141) (was NONE) | — | Tie-off: one of the eight control-plane experiments closed and archived, not ported (PRS-M45 closed). Classified 2026-10-31: Handoff viewer; collides with #146; unavailable in the production image (PRS-M45). |
| #180 docs(intelligence): accepted roadmap, P0/H1 review evidence and continuation | intel branch | PORTED PARTS (was PORT) | V1-04 | Tie-off (conv/intelligence-corpus): the evidence and roadmap files as a dated historical record (nested lockfiles dropped, nested package.json renamed package.evidence.json). Its two patches stay evidence only: both fixes were already on main (V1-04, merge-grant HOLD_CLEAR) (PRS-M52 closed). Classified 2026-10-31: Port only flow-policy-candidate.patch, the oversight selective-failure fix. The 164-file docs need a placement ruling (PRS-M23/M52). |
| #182 fix(key-cortex): consume BatchResult without uncertain execution replay | main | CLOSED already-in-main (was PORT) | V1-02 | Tie-off: closed; ported verbatim as V1-02-KEY-CORTEX-FAILCLOSED (ee15ad04, cedc9712), merged in #197; main's mapper spec runs all 12 cases. Classified 2026-10-31: BatchResult mapper and its 12 cases, actually executed this time; merges cleanly with #155 (PRS-M20/M21). |
| #183 docs(programme): programme appraisal 2026-10-21, draft directive bundle, audit credential removed from source | main | PORTED PARTS (was PORT) | R0-31 | Tie-off (conv/docs-records-2): the programme appraisal and the draft directive bundle as historical records. The audit-script change (278ec483) was dropped: R0-31 replaced it. D-30 stays open. Classified 2026-10-31: Port only the credential removal (now R0-31, a Release 0 security carve-out); the appraisal and directive bundle need placement (PRS-M06). |
| #184 KF-META-AI-REVIEW-QUOTA-WORDING-001: recognize the Copilot bot's current quota wording (draft, no merge authority) | main | PORTED PARTS (was CONTROL) | — | Tie-off (conv/agent-control-sweep-admission), owner-approved (D-141): the 'insufficient remaining quota' wording, its tests and NC-SR-COPILOT-INSUFFICIENT-QUOTA-UNRECOGNIZED; the .agent-control rewrites were dropped (PRS-M22 closed). Classified 2026-10-31: Copilot quota wording; unblocks #155's admission (PRS-M22). Needs D-32. |
| #185 KF-META-AUTOPILOT-SWEEP-COVERAGE-001: list the hourly sweep's candidates completely (draft, no merge authority) | main | PORTED PARTS (was CONTROL) | — | Tie-off (conv/agent-control-sweep-admission), owner-approved (D-141): list-open-impl-prs.mjs lists every open impl/* PR for the hourly sweep, with its spec, the workflow step, the doc section and the 5 NC-SWEEP controls; the .agent-control rewrites were dropped (PRS-M39 closed). Classified 2026-10-31: Paged sweep lister; 15 impl/ PRs, #155 among them, are past the 30-item page (PRS-M39). Needs D-32. |
| #187 docs(release): identify production DB contradiction and preserve read-only findings | main | PORTED (was EVIDENCE) | D-20 | Tie-off (conv/docs-records-2): both files with a dated note. D-20's production question is resolved by D-148 (PRS-M03 closed). Classified 2026-10-31: Production DB contradiction, 443 vs 29 tables (PRS-M03). |
| #188 fix(ops): prevent false-green launch verification on degraded HTTP 200 | main | CLOSED already-in-main (was PORT) | V1-20 | Tie-off: closed; on main as V1-20-SEC-VERIFY-UP (46830a30, 996cb778), merged in #197 (PRS-M01). Classified 2026-10-31: verify-up degraded-200 fix, its specs and a CI step (PRS-M01). |
| #189 fix(security): reject vacuous secret scans and unsurfaced scanner failures | main | CLOSED superseded (was PORT) | V1-01 | Tie-off: closed, nothing brought; superseded by V1-01-SEC-CREDENTIAL-SECRET-SCAN (22dca1c7, 9116d238), merged in #197 (PRS-M07). Classified 2026-10-31: Secret-scan range, pinned action and fail-closed contract (PRS-M07). |
| #190 KF-PRODUCT-CONTACTS-PILOT-001: contact detail applies the caller's CRM visibility (draft, no merge authority) | main | CLOSED already-in-main (was ADOPTED) | R0-01 | Tie-off: closed; adopted byte-identically via 610ecaa2 (R0-01-CT-RECONCILE), merged in #197 at f5d58ef7 (PRS-M11 closed). Classified 2026-10-31: Byte-identical on the branch via 610ecaa2. The exact-head merge grant is outstanding (D-01) (PRS-M11). |
| #191 docs(agent-control): worker ownership hardening proposal 001 (document only, no merge authority) | main | PORTED (was CONTROL) | — | Tie-off (conv/docs-records-2): the proposal as the record of the incident and the design. Whether to implement it stays an open control-plane decision. Classified 2026-10-31: Worker ownership proposal; admission choice unresolved (PRS-M41). |

PRs opened after the census, tied off the same way: #192 PORTED (conv/docs-records-2); #193 and #194 CLOSED not adopted (D-141); #195 PORTING (payroll ledger, safe-to-spend, journal UI and KEY treasury; lands in the PR right after this tie-off, together with the Books write-door and memberless-KEY gates, under D-142 to D-147); #196 done, CLOSED superseded (its new parts were rebuilt on main as the PR196-* packets, D-80 to D-87); #197 merged to main at f5d58ef7; #198 to #202 PORTED (conv/ci-action-bumps, with version-agnostic checkout anchors). Branches with no PR: docs/keyflow-intelligence-foundation and the corpus branches are on main under docs/intelligence/ as a dated historical record; docs/keyflow-reconstruction-20261029 is on main under docs/reconstruction/; the wave-10 WIP records are on main as dated history; claude/keyflowos-agent-skill-arch-j44584 (tiered/distributor pricing) is QUEUED wave 11b (D-141).

---

## (f) Coverage ledger

| Corpus | Total | Mapped here | How it was read |
|---|---|---|---|
| Canonical journeys (KF-JOURNEY-001..026) | 26 | 26 | Corpus lanes journeys-1..5 read the dossiers. This author mapped each by title and the lane findings. |
| Kernels (KF-KERNEL-001..012) | 12 | 12 | Corpus lanes kernels-1..3 read the dossiers. This author mapped them the same way. |
| Execution packets on the wave board | 35 | 35 | Corpus lanes packets-1..6; this author read the wave board directly. |
| Open PRs | 59 | 59 | 10 PR-family lanes. This author re-fetched the list through REST. |
| Product domain lanes | 12 | 12 | auth-business, cockpit-web-shell, contacts-crm, quotes-invoices, payments-ledger, public-commercial, storefront-site-portal, bookings-calendar, key-command, flows-events-playbooks, data-model-tenancy, infra-ci-harness |
| Family-map findings (M01-M60, CF-01-CF-57, PRS-M01-PRS-M57) | 174 | 174 | ID ledger below; every id has a packet or a stated disposition (a build check fails on any empty row). |
| REVENUE-AUTH-NEGATIVE-CONTROLS-001 rev 2 RA ids | 39 | 39 | All bound by R0-02's manifest. RA-G16-01's deferral target 'KF-REVENUE-FINANCIAL-INTEGRITY' maps to R0-20 if D-05 allows, otherwise to INGRESS-001. |
| Branch commits (b1948d27..dae49f5d) | 51 | 51 | Commit map below. |

**Journeys mapped to packets**

| Journey | Packets (R0 / V1) or disposition |
|---|---|
| 001 Business birth | R0-05, R0-06, R0-09, R0-14, R0-18, R0-32 |
| 002 KEY request → governed action | V1-02, V1-03, V1-04, V1-09, V1-31, V1-32 |
| 003 Lead → customer → cash | R0-03, R0-12, R0-13, R0-17, R0-20, R0-27; quote leg V1-50 to V1-53 (D-04) |
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
| 016 Business genome evolution | R0-09 (business config), R0-32 (genome gate at completion). Genome lineage is V1+ (KNOWLEDGE-001). |
| 017 Command-center priority action | V1-47, V1-25 |
| 018 Failure recovery | R0-17, V1-12, V1-35. Operator projection is V1+ (RECOVERY-001). |
| 019 Privacy deletion and exit | V1-38. Derived state is V1+ (PRIVACY-001). |
| 020 Plan, subscription, AI cost | R0-07 (cost ledger), D-12. ENTITLE-001 is V1+. |
| 021 Public customer experience | R0-22, R0-33, V1-05, V1-14, V1-23, V1-46, V1-48, V1-49, V1-52 |
| 022 KEY voice | V1-14 (stream tenant binding). Metering is V1+. |
| 023 Temporal flow / long-running workflow | V1-10, V1-35. TIME-001 and TEMPORAL-002 are V1+. |
| 024 System change / engineering safety | R0-00, R0-16, R0-25, R0-31, R0-35, V1-01, V1-13, V1-20, V1-30, V1-39, V1-40 |
| 025 Human authority lifecycle | R0-05 (removal and role freshness), V1-07, V1-21 |
| 026 Business network sourcing / B2B | V1+ (NETWORK-001) |

**Kernels mapped to packets**

| Kernel | Packets or disposition |
|---|---|
| 001 Tenant genesis and identity | R0-05, R0-14, R0-18, R0-32 |
| 002 Human authority and organization | R0-09, V1-07, V1-21, V1-56 |
| 003 KEY authority governance | R0-34, V1-02, V1-03, V1-04, V1-09, V1-24, V1-31, V1-32 |
| 004 Business knowledge | V1+ (KNOWLEDGE-001/002; PRs #112, #134) |
| 005 Capability fabric | V1-09 (canonical capability routing). D-1 consolidation is V1+. |
| 006 State transition | R0-17, R0-28, V1-42, V1-50 |
| 007 Temporal, event and workflow | R0-19, V1-12, V1-24, V1-35, V1-55 |
| 008 Evidence and outcome | R0-11, R0-19, V1-25, V1-55 |
| 009 Integration and external reality | R0-07, V1-05 |
| 010 Financial truth | R0-17, R0-20, R0-21, V1-15, V1-22, V1-29, V1-34, V1-36, V1-37, V1-44 |
| 011 Recovery and reliability | R0-17, V1-12, V1-19, V1-35 |
| 012 Engineering control plane | R0-00, R0-01, R0-02, R0-16, R0-25, R0-35, V1-01, V1-30, V1-40 |

**Execution packets (wave board) mapped to packets**

| # | Packet | Board state | Mapping |
|---|---|---|---|
| 1 | K12-001 | CHECKPOINTED | R0-16 and R0-35 extend it with a manifest per Release 0 suite and verdict source identity; R0-00 adds per-packet resource admission. |
| 2 | EXTFX-001 | CHECKPOINTED | No new work. R0-07 respects its effect semantics. |
| 3 | TENANT-001 | CHECKPOINTED | R0-05 extends the proof; R0-12, R0-22, R0-27, R0-28, R0-33 and R0-34 close step-6 findings. Backfill receipts are V1+. |
| 4 | AUTH-001 | CHECKPOINTED | The resolver stays shadow-only. AUTH shadow on Release 0 routes is V1+. |
| 5 | ACTION-001 | CHARACTERIZING on the board, but merged in PR 147 (`ac3a6384`) | The status record needs D-23. V1-31 extends the boundary. |
| 6 | TIME-001 | not started | V1-35 (one claimant). The rest is V1+ (D-29). |
| 7 | INGRESS-001 | not started | V1-05 partly. Lifecycle is V1+. |
| 8 | CONNECTOR-001 | not started | V1+ |
| 9 | TEMPORAL-002 | not started | V1+ |
| 10 | RECOVERY-001 | not started | V1+. R0-17 closes the payment crash window. |
| 11 | CONVO-001 | not started | V1+ |
| 12 | PLAYBOOK-001 | not started | V1+. V1-55 removes the duplicate feed writer. |
| 13 | COMMERCIAL-001 | not started | R0-27, R0-28, V1-42, V1-43, V1-50 to V1-53 |
| 14 | BOOKING-001 | not started | V1-28 (deposit and final settlement) |
| 15 | FINANCE-001 | not started | R0-17, R0-20, V1-15, V1-29, V1-34, V1-37 |
| 16 | DELIVERYBILL-001 | not started | V1+ |
| 17 | COMMERCE-001 | not started | V1-18, V1-33 |
| 18 | ENTITLE-001 | not started | V1+. D-12 covers the FREE plan cap. |
| 19 | GROWTH-001 | not started | V1+ |
| 20 | KNOWLEDGE-001 | not started | V1+ |
| 21 | KNOWLEDGE-002 | not started | V1+ |
| 22 | COMMAND-001 | not started | V1-47, V1-25 |
| 23 | PUBLIC-001 | not started | R0-22, R0-33, V1-14, V1-16, V1-23, V1-46, V1-48, V1-49 |
| 24 | SPACE-001 | not started | V1+ |
| 25 | VOICE-001 | not started | V1-14 partly. The rest is V1+. |
| 26 | PRIVACY-001 | not started | V1-38 partly. The rest is V1+. |
| 27 | NETWORK-001 | not started | V1+ |
| 28 | UX-001 | not started | R0-06, R0-08, R0-15, R0-18, R0-21, R0-23 |
| 29 | EXPERIENCE-001 | not started | R0-06, R0-08 (minimal); V1-47. Studio and virality are V1+. |
| 30 | WITHDRAW-001 | not started | V1-15 and V1-42 ratchets partly. The rest is V1+. |
| 31 | WITHDRAW-002 | not started | V1+ |
| 32 | MIGRATE-001 | not started | V1+ (drift gate). V1-17 follows its migration discipline and adds a drift guard. |
| 33 | INTEGRATED-001 | not started | R0-16, R0-25 and R0-35 partly (Release 0 journey only) |
| 34 | OPS-001 | not started | V1-20; the `/readyz` probes are V1+ (backlog). |
| 35 | RELEASE-001 | not started | V1+. Staging and deployment need D-20. |

**V1-MODULE-SCOPE items and issue #186 sequence mapped to packets**

| Item | Release 0 requirement | Packets |
|---|---|---|
| P0-1 Account, business onboarding, auth, team | Required | R0-05, R0-06, R0-09, R0-14, R0-18, R0-32; V1-07, V1-21, V1-56 |
| P0-2 Contacts, CRM record | Required | R0-01, R0-03, R0-12, R0-13, R0-15; V1-08, V1-17, V1-26, V1-38, V1-54 |
| P0-3 Quotes, invoices | Required (quote OR invoice) | Invoice path: R0-27, R0-28 (authorization). Quote branch: V1-50 to V1-53 if D-04 picks quotes. |
| P0-4 Offline/manual payment, balance, posting | Required | R0-11, R0-17, R0-19, R0-20, R0-21; V1-15, V1-22, V1-29, V1-34, V1-36, V1-37, V1-44 |
| P0-5 Customer-facing link, receipt | Conditional on journey | R0-22 (security of the existing route); V1-48 and V1-49 per D-07; V1-46 |
| P0-6 Cockpit, navigation, business status | Minimal route and result | R0-08 (navigation); the existing cockpit route meets "minimal"; V1-47 |
| P0-7 Business profile, currency, timezone | Minimal setup | R0-09; R0-32 (minimal profile if D-03 relaxes the gate); V1-37 |
| P1-1 Bookings | Not required | V1-06, V1-16, V1-27, V1-28 |
| P1-2 Bounded KEY Command | Optional | R0-07 (AI fails visibly), R0-34; V1-02, V1-03, V1-04, V1-09, V1-10, V1-19, V1-24, V1-31, V1-32 |
| P1-3 Event history, feed, playbooks | Minimal evidence only | R0-19; V1-25, V1-35, V1-55 |
| P1-4 Storefront, public presence | Public commercial artifacts only | R0-33; V1-14, V1-18, V1-23, V1-33 |
| P2-1 to P2-8 | No | V1+ backlog (deferred domains) |
| #186 A: read contracts, reconcile what exists | — | The planning lanes; admission proof R0-01 to R0-04, R0-11, R0-16 |
| #186 B: staging target, synthetic journey, cost declaration | — | Operator-authorized under D-20. R0-25's live spec is the synthetic journey; COST-LEDGER-001 (R0-07) is the cost declaration. |
| #186 C: run the journey, first failing step, logs, reproduction | — | Section (b); the reproduction is owed by the REDs of R0-14, R0-32 and R0-25 |
| #186 D: smallest bounded corrections | — | The R0 wave |
| #186 E: deploy after operator authorization | — | D-20; not in this queue |

**Branch commits mapped to packets** (b1948d27..dae49f5d, 51 commits)

| Landed work | Commits | Queue entry |
|---|---|---|
| Contacts pilot (PR #190 code) | b3b17b11, 6a5c0c3f, 740df74e (control only), 610ecaa2, ab1e122f (merge) | R0-01 |
| Revenue gap report and NC matrix rev 2 | 50e4a584 | R0-02 (contract) |
| KF-REVENUE-AUTH-PROJECTION-001, including R0-D4 and R0-D5 | 78b2c73c, bd66cde0, 2aea264a, 9b7d0a70 (merge), 0abed339 (journey flips) | R0-02 |
| Release 0 journey harness (#186 step C) | b1e31844, 17addbbd (merge) | R0-16 (retitle, manifest) |
| R0-D1 COA seed race | d8241c6e, 1228c29f, 8345ed98, b5dcf6d6 (merge) | R0-16 (release0-landed.json) |
| R0-D6 listen fallback | 538502f9, 529cf9df, e958e8e8, 0f9a22d2 (merge), 414dfd16 | R0-16 (release0-landed.json) |
| R0-D7 contact email 409 | 933dd88f, 99cdc159, 8e677fc5, a168ea84 (merge) | R0-16 (release0-landed.json) |
| R0-D3 invoice route error mapping | fdf1e8fd, d9cf86a6, 2c9d4859, ae074ac4 (merge) | R0-16 (release0-landed.json); extended by R0-27 |
| R0-D2 manual payment idempotency | 6481a172, 9ee90df0, 70e5e45e, 3ca4cf1d (merge), f0747a19 (named e2e config) | R0-16 (release0-landed.json); web key R0-21 |
| R0-QI-01 tenant invoice detail route | d1d8a66d, d98f7fa9, 9c1163c1 (merge) | R0-16 (release0-landed.json) |
| R0-CT-03 contact audit actor | d479fe67, db4ee154, e448b8bd, 87ca2b90 (merge) | R0-03 |
| R0-PC-01 quote detail tenant route | ec9c8c76, 4b7873e1, 4544062d, c2f6f46d (ST-PC01-1) | R0-04 |
| R0-PL-07 payment actor | af8e0799, 92567959, 1303093f | R0-11 |
| Merge of R0-PC-01 and R0-PL-07 | 7183c364 | R0-04, R0-11 |
| This map's draft | dae49f5d | — |

**Resource ledger** (database, Redis and fixture prefix per real-DB packet). Every packet's Redis index (1-15) is allocated at provision time and recorded in `active-packet.yaml`. Spawned-server suites pick a free port and pass their prefix as `RATE_LIMIT_KEY_NAMESPACE`. New prefixes follow R0-00's registry rule: `k<NN><a-z>_` for R0 and `v<NN><a-z>_` for V1. Existing suites keep their declared prefix, and R0-00 resolves the one duplicate (`rva_`).

| Packet | Group | Database | Fixture prefixes (suite = prefix) |
|---|---|---|---|
| R0-00 | R0-G0 | `kf_wt_r0_00` | revenue-authorization.integration.test.ts = rva_ (existing); commerce-invoice-detail.integration.test.ts = cid_ (existing) |
| R0-05 | R0-G0 | kf_wt_ after R0-00; serialized on main until then | identity-boundary.integration.test.ts = k05a_ (new); tenant-membership-boundary.integration.test.ts = t2d_ (existing) |
| R0-17 | R0-G0 | kf_wt_ after R0-00; serialized on main until then | commerce-payment-integrity.integration.test.ts = k17a_ (new) |
| R0-02 | R0-G1 | `kf_wt_r0_02` | revenue-authorization.integration.test.ts = rva_ (existing) |
| R0-01 | R0-G1 | `kf_wt_r0_01` | contacts-visibility.integration.test.ts = tcv_ (existing) |
| R0-07 | R0-G1 | `kf_wt_r0_07` | optional-services-fail-visibly.integration.test.ts = k07a_ (new) |
| R0-14 | R0-G1 | `kf_wt_r0_14` | identity-local-auth.integration.test.ts = k14a_ (new) |
| R0-27 | R0-G1 | `kf_wt_r0_27` | commerce-invoice-errors.integration.test.ts = cie_ (existing) |
| R0-32 | R0-G1 | `kf_wt_r0_32` | onboarding-manual-complete.integration.test.ts = k32a_ (new) |
| R0-12 | R0-G1 | `kf_wt_r0_12` | contact-scoped-tenancy.integration.test.ts = k12a_ (new) |
| R0-13 | R0-G1 | `kf_wt_r0_13` | contacts-persistence.integration.test.ts = k13a_ (new) |
| R0-19 | R0-G2 | `kf_wt_r0_19` | evidence-feed.integration.test.ts = k19a_ (new) |
| R0-33 | R0-G2 | `kf_wt_r0_33` | portal-grant-tenant.integration.test.ts = k33a_ (new) |
| R0-34 | R0-G2 | `kf_wt_r0_34` | cortex-audit-tenant.integration.test.ts = k34a_ (new) |
| R0-16 | R0-G3 | `kf_wt_r0_16` | release0-journey.integration.test.ts = r0_ (existing) |
| R0-22 | R0-G3 | `kf_wt_r0_22` | public-payment-intent.integration.test.ts = k22a_ (new); revenue-authorization.integration.test.ts = rva_ (existing) |
| R0-09 | R0-G3 | `kf_wt_r0_09` | identity-business-config.integration.test.ts = k09a_ (new) |
| R0-28 | R0-G4 | `kf_wt_r0_28` | commerce-quote-status-auth.integration.test.ts = k28a_ (new) |
| R0-20 | R0-G5 | `kf_wt_r0_20` | mark-paid-convergence.integration.test.ts = k20a_ (new) |
| V1-15 | V1-G1 | `kf_wt_v1_15` | ledger-write-door.integration.test.ts = v15a_ (new); expense-void-reversal.integration.test.ts = v15b_ (new) |
| V1-22 | V1-G1 | `kf_wt_v1_22` | commerce-money-rounding.integration.test.ts = v22a_ (new) |
| V1-03 | V1-G1 | `kf_wt_v1_03` | autonomy-profile-authority.integration.test.ts = v03a_ (new) |
| V1-10 | V1-G1 | `kf_wt_v1_10` | key-cortex-plan-execution.integration.test.ts = v10a_ (new) |
| V1-12 | V1-G1 | `kf_wt_v1_12` | recurring-invoice-run.integration.test.ts = v12a_ (new) |
| V1-06 | V1-G1 | `kf_wt_v1_06` | bookings-core.integration.test.ts = v06a_ (new) |
| V1-47 | V1-G1 | `kf_wt_v1_47` | release0-journey.integration.test.ts = r0_ (existing) |
| V1-07 | V1-G2 | `kf_wt_v1_07` | tenant-membership-boundary.integration.test.ts = t2d_ (existing) |
| V1-18 | V1-G2 | `kf_wt_v1_18` | storefront-paid-event.integration.test.ts = v18a_ (new) |
| V1-05 | V1-G2 | `kf_wt_v1_05` | payments-provider-callbacks.integration.test.ts = v05a_ (new) |
| V1-40 | V1-G2 | `kf_wt_v1_40` | log-redaction.integration.test.ts = v40a_ (new) |
| V1-14 | V1-G2 | `kf_wt_v1_14` | portal-boundary.integration.test.ts = v14a_ (new) |
| V1-35 | V1-G2 | `kf_wt_v1_35` | cross-module-job-poller.integration.test.ts = v35a_ (new) |
| V1-41 | V1-G2 | `kf_wt_v1_41` | untrusted-payment-inputs.integration.test.ts = v41a_ (new) |
| V1-32 | V1-G2 | `kf_wt_v1_32` | key-action-proposal-claim.integration.test.ts = v32a_ (new) |
| V1-34 | V1-G4 | `kf_wt_v1_34` | cash-position.integration.test.ts = v34a_ (new) |
| V1-29 | V1-G4 | `kf_wt_v1_29` | commerce-refund.integration.test.ts = v29a_ (new) |
| V1-19 | V1-G4 | `kf_wt_v1_19` | key-idempotency-claim.integration.test.ts = v19a_ (new); plan-executor-approval-resume.integration.test.ts = v19b_ (new) |
| V1-16 | V1-G4 | `kf_wt_v1_16` | booking-concurrency.integration.test.ts = v16a_ (new) |
| V1-08 | V1-G4 | `kf_wt_v1_08` | contacts-visibility.integration.test.ts = tcv_ (existing) |
| V1-24 | V1-G4 | `kf_wt_v1_24` | release0-journey.integration.test.ts = r0_ (existing) |
| V1-25 | V1-G4 | `kf_wt_v1_25` | evidence-feed.integration.test.ts = k19a_ (created by R0-19) |
| V1-38 | V1-G5 | `kf_wt_v1_38` | contact-privacy-purge.integration.test.ts = v38a_ (new) |
| V1-21 | V1-G5 | `kf_wt_v1_21` | structure-authority-ceiling.integration.test.ts = v21a_ (new) |
| V1-23 | V1-G5 | `kf_wt_v1_23` | public-catalog-projection.integration.test.ts = v23a_ (new) |
| V1-33 | V1-G5 | `kf_wt_v1_33` | storefront-checkout-retry.integration.test.ts = v33a_ (new) |
| V1-28 | V1-G6 | `kf_wt_v1_28` | booking-settlement.integration.test.ts = v28a_ (new) |
| V1-55 | V1-G6 | `kf_wt_v1_55` | evidence-feed.integration.test.ts = k19a_ (created by R0-19) |
| V1-17 | V1-MT1 | main tree (runs alone) | crm-contact-duplicate.integration.test.ts = tcd_ (existing) |
| V1-27 | V1-MT3 | main tree (runs alone) | booking-slot-writers.integration.test.ts = v27a_ (new) |
| V1-36 | V1-MT4 | main tree (runs alone) | invoice-refund-balance.integration.test.ts = v36a_ (new) |
| V1-37 | V1-G7 | `kf_wt_v1_37` | commerce-currency.integration.test.ts = v37a_ (new) |
| V1-42 | V1-G8 | `kf_wt_v1_42` | invoice-transition-concurrency.integration.test.ts = v42a_ (new) |
| V1-43 | V1-G9 | `kf_wt_v1_43` | commerce-document-numbering.integration.test.ts = v43a_ (new) |
| V1-44 | V1-G9 | `kf_wt_v1_44` | credit-note-reversal.integration.test.ts = v44a_ (new) |
| V1-45 | V1-G10 | `kf_wt_v1_45` | commerce-create-idempotency.integration.test.ts = v45a_ (new) |
| V1-48 | V1-G11 | `kf_wt_v1_48` | public-invoice-link.integration.test.ts = v48a_ (new) |
| V1-49 | V1-G12 | `kf_wt_v1_49` | public-receipt.integration.test.ts = v49a_ (new) |
| V1-46 | V1-G13 | `kf_wt_v1_46` | pay-link-token-gate.integration.test.ts = v46a_ (new) |
| V1-50 | V1-G14 | `kf_wt_v1_50` | commerce-quote-status.integration.test.ts = v50a_ (new) |
| V1-51 | V1-G15 | `kf_wt_v1_51` | release0-quote-journey.integration.test.ts = v51a_ (new) |
| V1-52 | V1-G16 | `kf_wt_v1_52` | quote-public-link.integration.test.ts = v52a_ (new) |
| V1-53 | V1-G17 | `kf_wt_v1_53` | commerce-quote-errors.integration.test.ts = v53a_ (new) |
| R0-25 | R0-G4 | `kf_wt_r0_25` (live stack) | release0-live.spec.ts = k25a_ (new) |

**ID ledger: product-domain findings (M)**

| Id | Sev | Finding (shortened) | Where it lands |
|---|---|---|---|
| M01 | P3 | Identity and tenant guard chain implemented end to end (middleware, guards, interceptor … | (a) Auth row: implemented state; extended by R0-05 |
| M02 | P0 | No no-provider sign-in path: signup, login, refresh and dev seed all need a reachable Supabase … | R0-14 |
| M03 | P1 | No business selection: bootstrap business re-stamped on every navigation, invited members get … | R0-15, R0-18 |
| M04 | P1 | Identity surface hardening gaps: business config PATCH lacks settings scope, hard-coded … | R0-09, V1-56 |
| M05 | P2 | Identity proof gaps: no real-DB HTTP test for identity routes, freshness and invite reconcile … | R0-05 |
| M06 | P2 | tRPC routers are mounted at /trpc with weaker guards and bypass writers, but no web consumer | V1-26, V1-27 |
| M07 | P0 | Web onboarding gate makes a paid LLM mandatory for a new owner and fails closed on API error | R0-06, R0-32 |
| M08 | P2 | D-2: competing cockpit and KEY entry points, redirect stubs, a dead 3.3k-line billing stack … | R0-08 |
| M09 | P1 | Web renders denial and errors as empty data (contacts list 403 shows no contacts; detail … | R0-15 |
| M10 | P3 | Contacts core CRUD is tenant-scoped with record visibility on list, detail and dossier (PR … | R0-01 |
| M11 | P1 | Branch work is unadmitted: PR #190 exact-head merge grant outstanding and .agent-control files … | R0-01 |
| M12 | P2 | Contact identity write contract: 409 now returned on branch, but soft-deleted holder blocks … | R0-13, V1-17 |
| M13 | P2 | Contact-scoped sibling routes enforce tenant only: child reads/writes skip record visibility … | V1-08 |
| M14 | P1 | Confirmed cross-tenant reads: contact custom-field values and flow run steps; call-task … | R0-12 |
| M15 | P1 | Route-order shadowing: PATCH contacts/bulk and GET contacts/unread-counts are declared after … | R0-12, V1-54 |
| M16 | P1 | Durable actor attribution missing on contacts, payments and the payment audit row | R0-19, R0-03, R0-11 |
| M17 | P3 | Revenue authorization and tenant-bound invoice detail landed on branch (not main) | (a) Quotes row: landed (KF-REVENUE-AUTH-PROJECTION-001, R0-QI-01); proof R0-02, R0-16 |
| M18 | P3 | Public token invoice view, public quote view/accept/reject and a provider-free issue path … | (a) Public row: implemented state |
| M19 | P2 | Revenue write-contract residuals: quote and convert errors still 500, create does not validate … | R0-27, V1-53 |
| M20 | P1 | Quote-to-invoice conversion drops the quote's tax and discount; UI defaults tax to 12.5 percent | V1-51 |
| M21 | P1 | Quote lifecycle uncontrolled: no state machine, unscoped bare-id status route, unguarded GET … | R0-04, R0-28, V1-50 |
| M22 | P1 | Document numbering and create idempotency: timestamp numbers under a per-tenant unique … | V1-43, V1-45 |
| M23 | P1 | Money precision policy undefined: Float document rows, Decimal(18,4) ledger, no write-time … | V1-22, V1-37 |
| M24 | P0 | No customer-facing receipt; booking confirmation opens the authenticated receipt; receipt … | V1-49 |
| M25 | P3 | Money core implemented: state machine, rounded balance, balanced idempotent posting, payment … | (a) Payments row: implemented state |
| M26 | P1 | Manual payment idempotency landed server-side on branch via the providerPaymentId slot; the … | R0-21 |
| M27 | P0 | Payment state paths can split invoice status from payments and ledger: DRAFT accepted … | R0-17, R0-20 |
| M28 | P1 | Refund semantics inconsistent: manual refund double-subtracts, full refund has no terminal … | R0-17, R0-21, R0-20, V1-29, V1-48, V1-49 |
| M29 | P1 | Payment UI misreports cash: modal sums every payment status and overpayment is never surfaced | R0-21 |
| M30 | P1 | Journal balance enforced only in application code; no real-DB trial-balance proof per currency | V1-15 |
| M31 | P1 | Payment sits outside the tenant extension and has no FK to Business; tenancy is service-layer … | R0-17, R0-22, R0-20, V1-29, V1-48, V1-49; V1+ DM-008; the packets listed carry foreign-tenant Payment controls |
| M32 | P1 | Untrusted inputs settle money: evidence extraction and Drive intake write SUCCESSFUL posted … | V1-41 |
| M33 | P2 | Unauthenticated surface is pinned by a shrink-only ledger; throttle semantics give false … | V1+ backlog: public-surface ledger and 429 tests |
| M34 | P1 | Pay-link token is a cuid and every token path downgrades to bare-id /pay/:invoiceId, so … | V1-48, V1-46 |
| M35 | P0 | Provider callbacks can settle invoices without proof: WiPay hash has no secret and is … | V1-05 |
| M36 | P1 | Public product, staff and service endpoints spread full rows (downloadUrl, licenseTerms … | V1-23 |
| M37 | P1 | Storefront order lifecycle: server-side pricing works, but no offline completion, unpaid … | V1-18, V1-33 |
| M38 | P1 | Client portal: admin mints a /portal/{token} link with no web route, no content endpoint … | R0-33, V1-14 |
| M39 | P2 | Presence site builder plus /book storefront are the working public presence; the KEYPORTAL … | V1+ backlog: storefront and KEYPORTAL (D-18) |
| M40 | P3 | Bookings core implemented: tenant-scoped REST, shared overlap guard and /slots, real-DB … | V1-06 |
| M41 | P1 | Slot integrity: check-then-insert without lock, three writers bypass the guard, in-app create … | V1-06, V1-16, V1-27 |
| M42 | P1 | Booking money chain broken: paymentStatus has no writer, invoice.paid confirm hook is dead … | V1-28 |
| M43 | P2 | Storefront slot picker computes slots client-side, legacy public pages need ISO text … | V1-16 |
| M44 | P1 | /key/command is LLM-free but 'ask' executes tools ungoverned, defaults to unregistered tools … | V1-09 |
| M45 | P0 | Cortex pipeline fails open on autonomy errors, replays batches on the legacy executor, and … | V1-03, V1-02 |
| M46 | P1 | Non-boundary KEY execution: Flow confirms client-resubmitted tool calls, proposals execute … | V1-32, V1-31 |
| M47 | P1 | No global KEY off switch: AI_DISABLED is storefront-only, about 18 cortex crons run ungated … | V1-03, V1-24 |
| M48 | P2 | Bounded KEY surfaces exist (advisor chat, capability contracts, ACTION-001 helpdesk boundary) … | V1+ backlog: KEY stub surfaces |
| M49 | P1 | No canonical evidence feed: four stores, orphaned business feed component, no tenant read of … | R0-19, V1-25 |
| M50 | P1 | One manual payment writes four Activity rows; partial payments are invisible to feed … | V1-55 |
| M51 | P2 | D-1: eight concurrent execution authorities, dead AutomationService, orphan Workflow models … | V1+ backlog: D-1 execution authorities (PLAYBOOK-001) |
| M52 | P2 | Scheduler and temporal fabric unsafe: Date.now flow-run keys, unclaimed ScheduledAgentJob … | V1-24 |
| M53 | P2 | Tenant isolation extension is real and real-DB tested; documented blind spots remain | (a) Data model row: implemented state; blind spots M31 and M54 |
| M54 | P2 | Soft-delete extension covers 14 of 33 deletedAt models, ignores update/aggregate/groupBy, and … | V1+ backlog: soft-delete coverage |
| M55 | P2 | Schema and migration hygiene: no CI drift gate, Contact FTS trigger archived, stray raw-SQL … | V1+ backlog: MIGRATE-001 (V1-17 adds a drift guard) |
| M56 | P2 | CI topology and structural gates implemented; security scans cannot fail the build | (a) CI row: implemented state; scans V1-01, V1-30 |
| M57 | P3 | Release 0 journey harness runs the built server against a real DB with every pin flipped … | (b) evidence base (the journey harness); R0-16, R0-35 |
| M58 | P1 | Test coverage gaps: web renders no Release 0 screen, Playwright not in CI, tests never … | R0-23, R0-25 |
| M59 | P2 | Proof admission and local runs: no K12 manifest binds the Release 0 suites, no one-command … | R0-16 |
| M60 | P3 | Deferred surfaces characterized (later/none): SEO, Shopify, ticketing, directory mock … | V1+ backlog: deferred domains |

**ID ledger: corpus findings (CF)**

| Id | Sev | Finding (shortened) | Where it lands |
|---|---|---|---|
| CF-01 | P1 | Code anchor drift: HEAD 9c1163c1 is 16 merges past b1948d27; several lane defects are already … | (a) intro: state is described at the branch head, not main |
| CF-02 | P0 | Tenant root implemented and proven: atomic founding OWNER Membership, Serializable bootstrap … | R0-05 |
| CF-03 | P2 | Contacts create/edit/detail with record-level visibility and 409 on duplicate email are … | R0-13 |
| CF-04 | P1 | Invoice create/issue path and bare-id status routes are tenant-bound; operator detail now … | (a) Quotes row: landed (R0-QI-01); proof R0-16 (release0-landed.json) |
| CF-05 | P0 | Ledger spine is a governed write door; payment row and deposit posting commit in one … | (a) Payments row: implemented state |
| CF-06 | P1 | Manual payment idempotency landed on the HTTP route (R0-D2); contradiction with older lanes … | (a) Payments row: landed (R0-D2); web key R0-21; proof R0-16 |
| CF-07 | P2 | Release 0 journey harness has stale step-4 title and harness recovery case; not bound to K12 … | R0-16 |
| CF-08 | P1 | Web record-payment forms never send idempotencyKey; a blank-reference retry still creates two … | R0-21 |
| CF-09 | P0 | markInvoicePaid fabricates a SUCCESSFUL Payment with no ledger posting, outside any … | R0-20 |
| CF-10 | P1 | Payment on a DRAFT invoice commits money then answers 409; invoice reconcile runs outside the … | R0-17 |
| CF-11 | P1 | Refund path swallows reconcile failure and has no status guard | R0-17, V1-29 |
| CF-12 | P1 | Public payment-intent is an anonymous bare-id write that flips the invoice to non-shareable … | R0-22 |
| CF-13 | P1 | Manual payments record no actor: Payment.recordedBy has no writer, no AuditAction … | R0-11 |
| CF-14 | P0 | GET /commerce/quotes/:quoteId is unguarded and reads by bare id, disclosing contact email and … | R0-04 |
| CF-15 | P1 | Quote status route lacks revenue scope, tenant binding and a transition contract | R0-28, V1-50 |
| CF-16 | P1 | Quote branch has no provider-free customer handoff and only mocked tests | V1-52 |
| CF-17 | P2 | Paid/refund arithmetic duplicated: recordPayment, listPayments, reporting and five web … | V1-29, V1-36 |
| CF-18 | P1 | Public invoice link is correctly redacted but shows no paid/remaining, no customer receipt … | V1-48 |
| CF-19 | P1 | Cockpit snapshot collapses failed sources into zero fallbacks, has no Release 0 results and no … | V1-47 |
| CF-20 | P2 | Navigation: four documented rails, one shipped; labels disagree; duplicate /os cockpit … | R0-08 |
| CF-21 | P2 | Operator deep links misdirect: payments rows link to tab=invoices (rewritten to pipeline) … | R0-08 |
| CF-22 | P1 | Onboarding gate redirects to a KEY-chat onboarding page; the Playwright spec asserting the … | R0-06, R0-32, R0-09, R0-25 |
| CF-23 | P2 | Business selection is implicit; no switcher; invited members bootstrap into a fresh workspace | R0-18 |
| CF-24 | P1 | TenantInterceptor resolves tenant by truthiness while guards require a string | R0-05 |
| CF-25 | P2 | Dual access authority: BusinessGuard admits ownerId-only owners; ModuleScopeGuard requires … | V1+ backlog: identity AB-BP06/07/08 (D-11) |
| CF-26 | P1 | Team invite accepts caller-supplied scopes/maxApprovalTier without grantor ceiling and creates … | V1-07 |
| CF-27 | P1 | JobRole permissions are destructively copied into Membership; team:write can self-escalate | V1-21 |
| CF-28 | P1 | Business config PATCH and KEY autonomy-profile PATCH are guarded by membership only | R0-09, V1-03 |
| CF-29 | P2 | EffectiveAuthorityResolver is shadow-only; legacy approval regimes are read-then-update and … | V1-32 |
| CF-30 | P1 | Programme sequencing contradicts issue #186; ACTION-001 merged but recorded as CHARACTERIZING | (a) Programme row; D-23 |
| CF-31 | P1 | K12 proof admission enforces only its self-test; Release 0 and ACTION-001 proofs are … | R0-16 |
| CF-32 | P1 | Secure-SDLC gates advisory; root CODEOWNERS exists (contradiction resolved); agent gate binds … | V1-40 |
| CF-33 | P0 | Trust census never refreshed; release law unsatisfiable as recorded; no trust_impact returned | V1-40 |
| CF-34 | P2 | Web Release 0 inspection has no executed browser proof; Playwright never runs in CI; dev demo … | R0-15, R0-25 |
| CF-35 | P1 | No-paid-provider rule: AI optional and journey runs keyless, but production boot needs Resend … | R0-07, R0-14 |
| CF-36 | P2 | FREE plan is the default and caps a fresh tenant at 5 invoices/month and 50 contacts … | D-12 (plan limits for the Release 0 tenant) |
| CF-37 | P2 | Invoice input integrity: INV-${Date.now()} numbering in four writers, client-trusted totals … | R0-27, V1-43 |
| CF-38 | P2 | Currency integrity: literal 'TTD' defaults, cross-currency revenue sums, currency-blind ledger … | V1-37 |
| CF-39 | P2 | Invoice lifecycle has several writers outside InvoiceWorkflow and no compare-and-set on … | V1-42 |
| CF-40 | P2 | Ledger write door bypassed by expense void; closed periods never enforced at posting; money … | V1-15 |
| CF-41 | P1 | FinancialAccount.currentBalance is an opening snapshot read as live cash by cockpit … | V1-34 |
| CF-42 | P1 | Credit notes: apply is unreachable (sourceType 'INVOICE' vs 'Invoice'), void does not converge | V1-44 |
| CF-43 | P1 | Bookings: completion invoice re-bills the deposit, invoicing failure is swallowed … | V1-28 |
| CF-44 | P1 | Booking slot ownership is read-then-insert with no constraint; slot generation ignores … | V1-16 |
| CF-45 | P1 | Storefront: CONFIRMED emits store_order.paid; listener's notes-based dedupe creates a second … | V1-18 |
| CF-46 | P2 | Portal grant binds any contactId; portal validate rate limit is inert (contradiction … | R0-33, V1-14 |
| CF-47 | P1 | Phone media stream binds tenant from an unauthenticated query string; booking/calendar tools … | V1-14 |
| CF-48 | P1 | GDPR contact purge is silently a soft delete while the audit records 'GDPR purge completed' | V1-38 |
| CF-49 | P2 | Contact.status has five dialects; Shopify sync overwrites canonical status | V1-38 |
| CF-50 | P2 | Provider webhook dedupe is first-seen, not consequence-aware; legacy /webhooks/stripe runs a … | V1+ backlog: INGRESS-001 (webhook lifecycle, RA-G16-01) |
| CF-51 | P2 | Temporal substrate: unclaimed scheduled-job pollers, FlowRunner long delays complete … | V1+ backlog: TIME-001 / TEMPORAL-002 |
| CF-52 | P2 | Operability and release evidence: readyz ignores Redis; deployment target contradictory; no … | V1+ backlog: OPS-001 (/readyz Redis probe, moved from R0-07) and MIGRATE-001 |
| CF-53 | P2 | Playbooks: two automation authorities, test-run fabricates run evidence, FlowTemplate … | V1+ backlog: PLAYBOOK-001 |
| CF-54 | P2 | Money precision: Float on Invoice/Quote/Payment versus Decimal(18,4) ledger | V1-22 |
| CF-55 | P3 | Architecture docs drift: tRPC mounted but unreachable, execution-paths lacks the manual … | V1+ backlog: re-plan after the V1 exit gate |
| CF-56 | P3 | Public storefront slug routing honours storeEnabled (open question resolved); presence … | (a) Storefront row: resolved, implemented |
| CF-57 | P3 | Deferred domains exist as substrate but are out of v1 scope (later) | V1+ backlog: deferred domains |

**ID ledger: open-PR findings (PRS)**

| Id | Sev | Finding (shortened) | Where it lands |
|---|---|---|---|
| PRS-M01 | P1 | pnpm verify:up false-greens: verify-up.sh accepts any HTTP 200 while web healthz returns 200 … | V1-20 |
| PRS-M02 | P2 | /readyz checks DB connectivity only; a schema-incompatible database reports ready | V1+ backlog: OPS-001 (/readyz migration parity) |
| PRS-M03 | P2 | Production database/host identity is unverified (DEPLOY_RUNBOOK vs PRODUCTION_STATE vs … | D-20; #187 (EVIDENCE); closed 2026-11-13 by the tie-off (D-148 names production; staging stays a future task) |
| PRS-M04 | P2 | Node runtime drift: declared 20.18.1, local proof harness on v22.22.0, PR #91 proposes 24.x | V1-39 |
| PRS-M05 | P2 | KEY cognition cron jobs call the LLM nightly for every business with no environment kill switch | V1-24 |
| PRS-M06 | P1 | Committed test-account login in two root audit scripts | R0-31, V1-01 |
| PRS-M07 | P2 | Security Scan job cannot fail: shallow checkout, trufflehog@main with base: main … | V1-01 |
| PRS-M08 | P2 | Required admission gate 'DAST (HawkScan)' passes without scanning when HAWK_API_KEY is absent | V1-13, V1-30 |
| PRS-M09 | P2 | PR #114 native DAST harness is worth porting but probes no Release 0 route | V1-13 |
| PRS-M10 | P3 | Admission consumes Copilot reviews but main has no repository reviewer policy (#90/#94 … | (e) #90, #94; closed 2026-11-13 by the tie-off (#90's Copilot reviewer policy ported, #94 closed) |
| PRS-M11 | P1 | PR #190 Contacts visibility fix and tests are already on the working branch (byte-identical) … | R0-01; closed 2026-11-13 by the tie-off (#190 closed, already in main) |
| PRS-M12 | P1 | Fourteen sibling contact-scoped REST reads apply the tenant predicate only; within-tenant … | V1-08 |
| PRS-M13 | P2 | tRPC crm.contactDetail applies business access only and reads child records before checking … | V1-26 |
| PRS-M14 | P3 | PR #63 free public-data enrichment applies cleanly but is a CONTACTS-v1 non-goal with parsing … | (e) #63: QUEUED wave 11b (D-141) |
| PRS-M15 | P2 | Recurring-invoice run guard is set before an awaited query with no try/finally; one DB error … | V1-12 |
| PRS-M16 | P2 | Recurring invoice is created and set to SENT before nextRunDate advances, outside any … | V1-12 |
| PRS-M17 | P2 | Cross-module poller executes every due PENDING ScheduledAgentJob regardless of jobType and … | V1-35 |
| PRS-M18 | P2 | Cross-module poller has no atomic claim; overlapping ticks or instances double-create quote … | V1-35 |
| PRS-M19 | P0 | P0: LLM-parsed command path fails open when the autonomy check throws | V1-02 |
| PRS-M20 | P1 | Pipeline calls .map() on the executor's BatchResult; v2 execution throws and the catch … | V1-02 |
| PRS-M21 | P2 | #155 and #182 edit disjoint hunks of the same pipeline file and three-way merge cleanly | V1-02 |
| PRS-M22 | P3 | #155 admission is blocked by the semantic-review Copilot quota wording (#184) | (e) #184; closed 2026-11-13 by the tie-off (#184 ported under D-141; #155 already in main as V1-02) |
| PRS-M23 | P1 | AI oversight: a parsed legacy AiMemory policy overrides a failed typed AutopilotSettings read … | V1-04 |
| PRS-M24 | P2 | KEY planner executePlan sets status running unconditionally; a double submit re-runs every step | V1-10 |
| PRS-M25 | P2 | A plan paused for approval is recorded as failed because the final status reads stale … | V1-10 |
| PRS-M26 | P3 | KeyIdempotencyService.check is read-then-insert; a pending key is treated as new and … | V1-19 |
| PRS-M27 | P3 | OPEN: an approved plan-queue step re-enqueued under a reused idempotency key may never run … | V1-19 |
| PRS-M28 | P2 | KEY command executeApprovedPlan tries only the dotted capability name, so bare FLOW_TOOLS … | V1-09 |
| PRS-M29 | P2 | #160's message_intake planner remap changes the data source (MessageIntake approval queue to … | V1-09 |
| PRS-M30 | P2 | Cortex audit routes read @Param('businessId') on paths without a :businessId segment | R0-34 |
| PRS-M31 | P2 | KnowledgeIngestionService is dormant (verified); cortex.search_knowledge ignores status, so … | (e) #134: QUEUED wave 11b (D-141), status filter first |
| PRS-M32 | P3 | #162 KEY self-model projection applies cleanly but has no consumer and swallows Prisma errors | (e) #162: QUEUED wave 11b (D-141) |
| PRS-M33 | P3 | #161 canonical finance read tools are clean but deferred scope and leave a second name for … | (e) #161: QUEUED wave 11b, after the #195 port |
| PRS-M34 | P3 | #158 goal-tracker writes use bare ids; cross-tenant risk is already blocked by the tenant … | (e) #158; closed 2026-11-13 by the tie-off (#158 adopted) |
| PRS-M35 | P3 | #148 memory plan: the 'destructive consolidation' claim is wrong (dead delete); the dedupe … | (e) #148; closed 2026-11-13 by the tie-off (the plan ported with a dated correction note; the work stays DEFER V1+) |
| PRS-M36 | P3 | KEY evolution learning methods are never called; #127's memory auditor cannot report DORMANT … | (e) #127: CLOSED not adopted (D-141); the dormant learning methods stay V1+ |
| PRS-M37 | P3 | #112 Context Genome adapter uses verification time as validFrom | (e) #112; closed 2026-11-13 by the tie-off (#112 closed, not adopted; the defect never reached main) |
| PRS-M38 | P3 | #38 consciousness services are already on main, further evolved and tested; its 10 endpoints … | (e) #38; closed 2026-11-13 by the tie-off (#38 closed, superseded) |
| PRS-M39 | P2 | Hourly autopilot sweep lists with gh pr list default page (30); verified 15 impl/ PRs … | (e) #185, #170, #168; closed 2026-11-13 by the tie-off (#185 ported, #170 closed, #168 ported; D-141) |
| PRS-M40 | P2 | Nearly every impl PR rewrites .agent-control artifacts and packet-pinned tests that main … | (e) PORT rule: .agent-control rewrites are never ported; closed 2026-11-13 by the tie-off (no port brought one) |
| PRS-M41 | P2 | Control-plane drafts run on operator ACK without a ChatGPT DIRECTIVE or REVIEW | (e) #111, #170, #171, #191; closed 2026-11-13 by the tie-off (D-141 ruled the control-plane PRs: #171 and #191 ported, #111 and #170 closed) |
| PRS-M42 | P3 | #171 AUTO_MERGE record audit is absent from main and depends on the literal login … | (e) #171; closed 2026-11-13 by the tie-off (#171 ported) |
| PRS-M43 | P2 | Branch divergence: PR job only covers PRs into main; push job compares every branch to … | (e) #107, #157; closed 2026-11-13 by the tie-off (#107 closed: every branch converges to main; #157 ported in part) |
| PRS-M44 | P3 | #169/#175 Windows worker worktree-path and machine-lock repairs are absent from main; #175 is … | (e) #169, #175; closed 2026-11-13 by the tie-off (both ported) |
| PRS-M45 | P3 | Mission Control consoles (#146 Atlas panel, #179 handoff viewer) collide on … | (e) #141, #146, #179; closed 2026-11-13 by the tie-off (#146 and #179 closed, not adopted; #141 kept as a design record) |
| PRS-M46 | P3 | Atlas chain (#141 to #146, #148): outputs are never generated, the intelligence snapshot is … | (e) Atlas chain #141 to #146; closed 2026-11-13 by the tie-off (#141 kept as a design record, #142 to #146 closed) |
| PRS-M47 | P3 | #150 convergence board is 11 commits behind with facts from 2026-10-06; #168 is a … | (e) #150, #168; closed 2026-11-13 by the tie-off (#150 closed, #168 ported) |
| PRS-M48 | P3 | #176 review-architecture proposal is partly stale; #180's F9 correction is already on main | (e) #176; closed 2026-11-13 by the tie-off (#176 ported as the dated proposal of record) |
| PRS-M49 | P3 | Worker cursor-idempotency proof silently skips in CI (no GH_TOKEN) | (e) #114 worker GH_TOKEN skip; still open: a follow-up control packet (tests-first, proven on Windows CI) |
| PRS-M50 | P3 | #152 would make a validated unlock YAML mandatory for every PR to main | (e) #152; closed 2026-11-13 by the tie-off (#152 closed, not adopted) |
| PRS-M51 | P3 | Development-system tooling proposed inside the product API and CI (#133 proof-obligation … | (e) #133, #139; closed 2026-11-13 by the tie-off (both closed, superseded) |
| PRS-M52 | P3 | Intelligence/R&D docs PRs would split the corpus between main and the orphan intel branch | (e) docs PRs #105, #136, #154, #156, #164, #165, #167, #180; closed 2026-11-13 by the tie-off (D-141: the docs/intelligence corpus is on main as a dated historical record) |
| PRS-M53 | P2 | Old handoff/ledger direction (#157, #128) is superseded by the 2026-10-29 product-first plan … | (e) #128, #149, #157; closed 2026-11-13 by the tie-off (each ported, in full or in part, under a dated historical header) |
| PRS-M54 | P3 | #163 thread harvester ships pytest tests with no Python runner in CI, and its default output … | (e) #163: PORTED, tests fixed and output ignored; still open: no CI job runs the Python tests |
| PRS-M55 | P1 | #174 withholds two access-control findings (AC-01 confirmed, AC-02 likely) from the public repo | D-24; R0 exit gate; still open at the tie-off (D-24 not ruled) |
| PRS-M56 | P3 | No open PR other than #190 touches the Release 0 path; most stale bases carry no application … | (e) note: no other open PR touches the Release 0 path |
| PRS-M57 | P3 | #91 separable build value: web build runs Prisma generation it does not need; custom immutable … | (e) #91: PORT (runtime pin, V1-39); web-build Prisma scoping V1+; closed 2026-11-13 by the tie-off (web-build scoping ported, conv/web-build-vercel) |

**What was not read, and what was not run, for this map**

- **Issue #80 was not re-read.** `gh issue view` is blocked on GraphQL; REST works. The latest DIRECTIVE/REVIEW on the queue is therefore unverified (see D-01).
- **The 26 journey and 12 kernel dossiers** were mapped from lane-condensed findings and titles, not re-read in full by this author.
- **Cited through lanes, not re-read:** `modules/*-v1.md` (AUTH-BUSINESS, CONTACTS, INVOICING, PAYMENTS-LEDGER, PUBLIC-COMMERCIAL), `REVENUE-GAP-REPORT-001.md`, and the governance census files (`IRONCLAD-ASSURANCE-CENSUS.md`, `CATASTROPHIC-FAILURE-REGISTER.yaml`).
- **Family maps.** The M, CF and PRS maps are not committed. The ID ledger above was built from the lane outputs of this planning run.
- **#174's withheld findings** AC-01 and AC-02 are not in the repository or on #80 (D-24).
- **Not accessed:** branch protection and required checks could not be read (403). Production was not accessed (read-only by rule).
- **No suite was run** for this revision (reason in section b). The Release 0 journey has not been run at exact `9c1163c1`, `87ca2b90` or `c2f6f46d`.
- **Not re-counted:** the tenant-extension model count (77 vs about 330).
- **Not determined:** whether the profile genome editor alone can reach the three-pillar minimum (R0-32 characterizes it), and where the fourth Activity writer (the crm mirror) lives (V1-55 records the actual count).

---

## (g) Open decisions for the owner (and ChatGPT where marked)

| Id | Decision | Gates |
|---|---|---|
| D-01 | **Admission path (ChatGPT, #80).** 50 code commits are not on main. PR #190 has no exact-head merge grant. In what order, and by which PRs, should landed packets reach main? | admission of everything; execution is not blocked |
| D-02 | **Release 0 sign-in.** Does hosted Supabase (free tier, network required) satisfy "no required paid external API"? If yes (option C), R0-14 is docs only and the live sign-up leg runs only in staging. If not, choose between option A, self-hosted GoTrue in compose with its own database, and option B, a bounded local issuer that reuses the existing HS256 verifier. Option B needs a credential store that neither User nor UserIdentity has, so it means an isolated main-tree migration packet before R0-14. | R0-14 (and R0-25's start point) |
| D-03 | **Onboarding.** There are two gates. The web gate (`use-genome-gate.ts`) checks only `onboardingComplete`. The server gate on POST /complete (`GENOME_GATE_BLOCKED`, `onboarding-concierge.service.ts:1114-1134`) requires founder, business and market DNA scores of at least 50. Must the server gate hold for Release 0, or may a minimal business profile (name, currency, timezone) complete onboarding? Should completion keep seeding a demo contact and a DRAFT demo invoice? | R0-06, R0-32 |
| D-04 | **Quote OR invoice.** Is the quote branch in Release 0? If yes, V1-50 to V1-53 move into R0 unchanged, after R0-20. R0-28 (quote-route authorization) is in R0 either way. The FREE plan has `quotesEnabled=false` (plans.ts:370; see D-12). | V1-50, V1-51, V1-52, V1-53 |
| D-05 | **Mark-paid.** Should operator mark-paid without an amount record the remaining balance (as assumed), or require an amount? Is the bounded change to the legacy `/webhooks/stripe` handler (`webhooks.controller.ts:86-91`) authorized, so RA-G16-01 can leave deferral? | R0-20 |
| D-06 | **Anonymous payment intent.** Should anonymous bare-id intent stay (hardened by R0-22), or be retired to token-only? R0-22 no longer waits on this: no reading of D-06 lets an anonymous request change invoice status. | V1-46 |
| D-07 | **Public pay surface.** Is the customer link (paid and remaining) and a receipt in Release 0? If yes, V1-48 and V1-49 move into R0 after R0-20. Retire or token-gate `/pay/:invoiceId`? What default TTL for PaymentLink? Receipt for PAID only, or PARTIALLY_PAID too? Opt-in disclosure of bank-transfer instructions, or hide that option? | V1-48, V1-49, V1-46 |
| D-08 | **Canonical evidence.** Activity for the user feed and BusinessEvent for the audit trail (assumed), or another split? It no longer gates step 4: R0-19 labels the payment audit row whatever the split. | V1-55, V1-25 |
| D-09 | **Navigation labels.** "Cockpit" or "Command Center" for `/app/command-center`? "Sales" or "Revenue" for `/app/commerce`? | R0-08 |
| D-10 | **Business selection.** Should the switcher UI ship in Release 0, and should bootstrap prefer an existing membership when the user owns nothing? R0-18's core (keep the stored choice, list memberships, bootstrap only when none) is unconditional. | R0-18 (switcher only) |
| D-11 | **Authority policy.** `settings:write` for business config? SUPER_ADMIN promotion env-gated in production? RA-G4-13: SUPER_ADMIN mark-paid answers 500 on main and 403 after the fix; should the service admit SUPER_ADMIN instead? Membership suspension state? | R0-09, R0-02 (todo case) |
| D-12 | **Plan limits for the Release 0 tenant.** FREE caps at 5 invoices/month and 50 contacts (CF-36), and onboarding completion adds a demo invoice. Enforce or remove `quotesEnabled=false`? | staging journey |
| D-13 | **Money precision and currency.** Cents-safe arithmetic on Float storage for v1, with Decimal staged later? Single currency per business? Which currencies are supported? | V1-22, V1-37 |
| D-14 | **Refunds.** Separate negative REFUNDED rows for manual refunds? Should a fully refunded invoice go to SENT (paidAt cleared) or to a new REFUNDED state? A new state needs an enum migration (V1-29 stops and a migration packet opens). | V1-29 |
| D-15 | **Numbering and create idempotency.** Sequential per-business numbers from the next value, without renumbering existing rows? Idempotency key in a header or the body? V1-45 now uses the existing IdempotencyKey table, so no migration is expected. | V1-43, V1-45 |
| D-16 | **Contacts index.** Accept the SQL-only partial unique index (`bank_transactions` precedent) for contact email/phone? | V1-17 |
| D-17 | **KEY.** Which pipeline is canonical (Flow vs Cortex)? Name and semantics of the off switch (`KEY_DISABLED` vs the storefront-only `AI_DISABLED` vs default oversight 'restricted')? Port the #155 and #182 hunks as specified? When do the KEY packets run relative to R0? | V1-02, V1-03, V1-09, V1-24, V1-31, V1-32 |
| D-18 | **Storefront.** Is product checkout in P1-4 scope? Formally retire the KEYPORTAL backlog in favour of presence plus `/book`? | V1-18, V1-33 |
| D-19 | **WiPay.** What are the provider's documented hash inputs, and does a secret belong in the hash? (V1-05 fails closed either way.) | V1-05 |
| D-20 | **Production and staging.** Which host and database are production (Hetzner Compose with 443 tables, the 29-table Supabase, or Render)? Which staging target satisfies issue #186 steps B and E? Is `0_baseline` recorded as applied? **Resolved 2026-11-13 by D-148** for production (the Hetzner VPS Docker Compose stack); the staging half stays open as a future task. | any deploy; DM-008 |
| D-21 | **Node runtime.** 20.18.1, 22.x or 24.x? Who authorizes changing the agent-control workflow pins? | V1-39 |
| D-22 | **CI gates (ChatGPT, #80).** Blocking security scans, the DAST required-gate swap, the agent gate for `pkt/*`, and the trust-census owner. | V1-01, V1-30, V1-40 |
| D-23 | **Wave law (ChatGPT, #80).** Record an exception so Release 0 money, public and cockpit work proceeds ahead of Waves B to D. Correct the ACTION-001 status (merged in PR 147, recorded as CHARACTERIZING). Rule on whether KF-DEC-013 and 07-CURRENT-STATE are superseded. | programme admission |
| D-24 | **#174's withheld findings** AC-01 (confirmed) and AC-02 (likely). Route them privately into the queue if they touch tenant isolation. Still open at the 2026-11-13 tie-off: the owner has not supplied them. | R0 exit gate |
| D-25 | **Contacts.** DEC-CONTACTS-001 (firstName) and DEC-CONTACTS-002 (is ContactAuditEntry mandatory?). Is GDPR purge in v1, or disabled with a visible marker? | V1-38; CT-BP-06 (V1+) |
| D-26 | **Bookings.** Cancel-after-deposit policy: refund, credit note or forfeit? | V1-28 (cancel part) |
| D-27 | **Untrusted money inputs.** Evidence-extracted and Drive-intake payments: PENDING until confirmed, or removed? | V1-41 |
| D-28 | **Credit notes.** Are FULLY_CREDITED and PARTIALLY_CREDITED workflow states, or retired enum values? Retiring them is an enum migration (V1-44 stops and a migration packet opens). | V1-44 |
| D-29 | **Poller claim.** Run it standalone, or absorb it into KF-EXEC-TIME-001? | V1-35 |
| D-30 | **Operator action.** Rotate the test-account credential committed in `audit-keyflowos.py` and `audit-mobile-quick.py`; it remains in git history after R0-31. | R0-31 completion |
| D-31 | **Concurrency.** May V1 packets with zero file overlap start before the R0 exit gate (never before R0-00)? | V1 start |
| D-32 | **Control-plane PRs (ChatGPT, #80).** Which PR-discovery implementation becomes canonical (#185, #170 or #168)? Base-aware divergence (#107)? #184 quota wording, which unblocks #155's admission? **Resolved 2026-11-13 by D-141**: #185 is the sweep's lister, #170 closed, #168 brought as a read-only tool, #107 closed, #184 approved. | not product |
| D-33 | **Self-declared subscription payments.** `POST /subscriptions/businesses/:id/record-payment` with `method: 'manual'` activates a paid plan and writes a COMPLETED SubscriptionPayment from the caller's own claim, with no money moving. R0-08c limits it to the owner (and SUPER_ADMIN) and audits it; should a manual record instead stay PENDING until platform staff confirm the transfer? | R0-08c (found by the R0-08 security review, ST-R008-1) |
| D-34 | **Navigation labels default.** Until D-09 is ruled, R0-08/R0-08b keep the majority labels already in the code (`Command Center`, `Sales`) in one constant, `NAV_ROUTE_LABELS` in `apps/web/src/lib/semantic-routes.ts`; ruling D-09 is a one-line change there. | R0-08, R0-08b |
| D-35 | **KEY tools for existing job roles.** Job roles written before V1-21 may carry KEY tool-family keys (`finance`, `sales`, `commerce`, `calendar`, `inbox`, ...). Since V1-21b a governed tool (one whose service sits behind a module-scoped route) is reached only through its own canonical module, so such a role loses those tools (finance loses bills and expenses; sales and commerce lose the invoice and payment tools; calendar loses event creation). Migrate the stored keys to the canonical vocabulary (a data migration), or accept the narrowing? | V1-21b |
| D-36 | **KEY tier ladder.** A canonical grant at write reaches tier 2; 14 tier-3 tools whose web routes need only write (send invoice, refund, reply to an inbox thread, approve payroll, delete contact, merge, ...) still need admin for KEY. Lift write to tier 3 for tools whose route needs only write, or keep KEY one step stricter than the web? | V1-21b |
| D-37 | **KEY reads and row visibility.** KEY's contact and calendar reads ignore PRIVATE contacts and `crm_view: 'owned'` (the dispatcher queries without the member's visibility clause). Fix in the dispatcher by passing the member as the actor (after R0-09c) and applying the visibility clause, or withhold those reads from positions whose view scope is 'owned'? | V1-21b, R0-09c, V1-03 |
| D-38 | **KEY tools with no web route.** Legacy keys still reach tools no HTTP route exposes (`comms_send_broadcast`, `contract_extract_clauses`, `structure_find_person`, `finance_customer_balance`), and every position keeps the baseline reads (`fetch_*`, `calendar_check_conflicts`, `documents_list`) whatever its grants. Keep, or gate them behind a canonical module? | V1-21b |
| D-39 | **RISC session revocation.** A Google cross-account-protection event bans the Supabase account for 65 minutes and writes the local cutoffs, but GoTrue keeps the refresh token, so the session works again after the ban. A durable cutoff needs a User-row field (schema change) or a provider global logout under a server-minted user token. Which? | R0-ID-F7 (F7-SEC-2) |
| D-40 | **Module scope for command and procurement.** The command-centre items and procurement routes (including the bulk complete/dismiss and supplier/stats routes R0-13f brought back to life) need only a business membership: `CANONICAL_MODULES` has no key for them. Gate them under an existing module (e.g. `operations`), add a module, or keep them open to every member? | R0-13f (review ST-3) |
| D-41 | **Closing an accounting period.** V1-15 enforces closed periods at the single posting door. To keep live money from being refused (a payment, refund or provider callback dated today inside a closed current month got 409 and was lost), a period can now be closed only after it has ended, and a legacy CLOSED row whose period has not ended is not enforced. Keep that, or allow closing the current period and route late money to the next open period? | V1-15, V1-15b |
| D-42 | **Google sign-in for non-owners.** Since R0-CMF5 the server refuses the default Google Suite service set (which includes Gmail) for a non-owner with 403 GMAIL_OWNER_ONLY; the web retries without Gmail so staff can still connect Calendar, Drive, Forms, Contacts and Business Profile. Keep the strict server contract, or have the server drop Gmail silently for non-owners? | R0-CMF5 |
| D-43 | **Gmail consent without a refresh token.** A consent that returns no refresh token is linked only when it re-consents the mailbox already stored; replacing the mailbox or a first connect without one gets 409 GMAIL_PENDING_NO_REFRESH_TOKEN (before, the business kept the old mailbox's refresh token next to the new address, or ended up half-linked). Keep? | R0-CMF5 (repair2) |
| D-44 | **KEY chat mode picker.** `/ai/.../flow/chat/stream` no longer takes `role` from the client (V1-21b, client-forged envelope fix), so the web chat's mode picker no longer pins the crew; the server detects it from the message. A role can only narrow (the minimum of ceilings): restore it as a validated narrowing-only field? | V1-21b |
| D-45 | **Sending invoices by staff message.** `commerce_send_invoice` is reached by no position over WhatsApp or SMS (it emailed the customer before the status change and ignored VOID); member chats keep it with a VOID guard. Granting it back to positions needs a holder-aware send path that mirrors POST send-email. Keep it withheld? | V1-21b |
| D-46 | **Platform super-admin and invoice writes.** The revenue-authorization door admits a business's OWNER, ADMIN and the commerce scope it names. A platform SUPER_ADMIN who is not a member of the business is refused on invoice writes today. Admit platform super-admins to tenant invoice writes (audited as such), or keep them out and use a membership? | R0-02 (review RA-G4-13) |
| D-47 | **Where autonomy settings live.** KEY reads autonomy from two places: `AiMemory` rows and `AutopilotSettings`. V1-04 reads both and takes the stricter. Pick one as the authority (and migrate the other into it), or keep the stricter-of-both rule? | V1-04 (review SEC-V104-2) |
| D-48 | **Terms version on public quote accept.** A public accept must now name the terms version the customer saw (`termsVersion`); an accept without it, or with a version that is not the quote's current one, is refused, so a customer never accepts terms that changed under them. Keep it mandatory? | V1-50..53 (quote chain) |
| D-49 | **KEY `convert_quote`.** Through ai-execute, `convert_quote` now only accepts the quote (the same compare-and-set as the operator accept); it does not create the invoice. Invoice creation stays an explicit operator step. Keep, or let KEY create the invoice in the same step (it would then need the invoice-write authority and the D-04 quote-to-invoice contract)? | V1-QUOTE-CHAIN-finish |
| D-50 | **Who may edit or delete accounting periods.** PATCH and DELETE of accounting periods are now OWNER or ADMIN only (a member with the finance scope can read and post, not reopen or remove a period). Keep, or OWNER only (as D-11 does for the business profile)? | V1-15 |
| D-51 | **Stranded KEY idempotency claims.** A claim whose holder crashed before settling stays pending, so a retry with the same key is refused, not run twice. Releasing it needs a lease: how long a pending claim may stand before a retry may take it over (and whether the takeover must first check the tool's effect). Pick the lease, or keep manual release only? | V1-19b |
| D-52 | **Staff approvals by message.** A staff YES over WhatsApp or SMS now approves only when the inbound message has a provider message id (so a replayed or forged webhook cannot approve). Providers or test numbers that omit the id can no longer approve by message. Keep? | V1-21c (WB-3) |
| D-53 | **KEY sandbox routes.** `POST .../sandbox/execute` ran client-supplied code in `node:vm`, which reaches the host process, and `sandbox/apply` applied client template parameters. V1-31c answers both with 410 Gone. Keep them retired, or rebuild a real isolated sandbox (a separate process or service: a new dependency or provider)? | V1-31c |
| D-54 | **Flows with runtime-filled parameters.** `POST flows/:id/execute` now refuses a stored flow whose node parameters are filled at run time from the request (client inputs reaching a tool's arguments). Flows with fixed parameters still run. Keep the refusal, or allow a declared, validated input schema per flow? | V1-31c |

---

### Owner rulings, 2026-10-31

| Id | Ruling | Effect on the queue |
|---|---|---|
| D-02 | Hosted Supabase free tier (option C). | R0-14 is documentation only. The live sign-up leg runs where a Supabase project is configured. |
| D-03 | Manual minimal profile: business name, currency and timezone complete onboarding without AI. The AI genome stays as optional enrichment. | R0-32 relaxes the server gate. R0-06 adds the manual web path and makes the genome gate fail open. |
| D-07 | The customer link (paid and remaining) and the receipt are in Release 0, token links only. The bare-id pay page is retired. | V1-48, V1-49 and V1-46 move to wave R0, after R0-20. |
| D-11 | Editing the business profile is OWNER only, regardless of granted scopes. | R0-09 implements owner-only on PATCH /identity/businesses/:id. |

### Owner rulings, 2026-11-02

| Id | Ruling | Effect on the queue |
|---|---|---|
| D-04 | The quote branch is in Release 0. | V1-50 to V1-53 run now as a chain (state machine, conversion carrying tax and discount, provider-free public link, quote create/edit/convert errors). Quotes stay disabled on the FREE plan (`quotesEnabled=false`) until D-12 is ruled. |
| D-13 | Cents-safe integer-cents arithmetic at every write and balance boundary on the existing Float columns (no migration; Decimal staged later). One currency per business, defaulting to the business currency; TTD and USD supported. | V1-22 and V1-37 run without a migration; the chain V1-22, V1-29, V1-34, V1-36, V1-37, V1-42 is unblocked. |
| D-14 | Manual refunds are separate negative REFUNDED rows (the provider convention). A fully refunded invoice returns to SENT with paidAt cleared; no new invoice state, no enum migration. | V1-29 runs without its stop rule; V1-36 follows. |
| D-17 | Keep both KEY pipelines (Flow for member chat, Cortex for plans) and harden each as its packet specifies. A server-side `KEY_DISABLED` off switch, distinct from the storefront-only `AI_DISABLED`. Port the #155 and #182 hunks as specified. Run the KEY packets now. | V1-02, V1-03, V1-09, V1-24, V1-32 run now (with V1-04); V1-31 follows V1-03. |
| D-15 | Invoice and quote numbers are sequential per business, continuing from its current highest number; existing numbers are never renumbered. A retried create carries an `Idempotency-Key` HTTP header (the existing IdempotencyKey table, no migration). | V1-43 and V1-45 run after the money chain (V1-42). |
| D-27 | Payments extracted from evidence or Drive intake are recorded PENDING and move no balance until a member confirms them. | V1-41 runs after the money chain. |
| D-28 | FULLY_CREDITED and PARTIALLY_CREDITED stay as real invoice states, driven by credit notes that post to the ledger. No enum migration. | V1-44 runs after V1-42. |
| D-26 | A deposit is forfeit when the customer cancels after paying it. The owner may refund it manually (a negative refund row, D-14). Nothing moves automatically. | V1-28 (cancel part) is released. |
| D-22 | The secret scan and the native DAST become required, blocking CI checks; the agent gate runs on `pkt/*` branches; the owner owns the trust-census list. Ruled by the owner directly (the item was routed to ChatGPT via #80, which this worker does not post to). | V1-01, V1-30, V1-40, then V1-20, V1-26 and V1-39 are released. |
| D-21 | CI and `engines` pin Node 22.x LTS (Node 20 reached end-of-life in April 2026; every proof in this build ran on Node 22). | V1-39 is released (after V1-20, V1-30, V1-26). |
| D-16 | The isolated SQL-only partial unique index for contact email and phone (ignoring soft-deleted rows, `bank_transactions` precedent) is authorized. It is a migration, proven on the local database only. | V1-17 is released. |
| D-19 | WiPay callbacks are verified against WiPay's published hash documentation (read, never called); any callback that does not verify is refused. | V1-05 is released. |
| D-18 | Storefront product checkout is in scope and is hardened, not retired. | V1-18 and V1-33 are released. |
| D-25 | The GDPR purge is in v1: it erases personal fields and keeps a retained-basis audit row. Every contact write records a ContactAuditEntry. | V1-38 is released. |
| D-29 | The cross-module job poller is fixed now as its own packet. | V1-35 is released. |
| D-08 | Activity rows power the user feed; BusinessEvent is the audit trail. | V1-55 runs after V1-25. |
| D-05 | Operator mark-paid without an amount records the remaining balance as one payment. The bounded change to the legacy `/webhooks/stripe` handler is authorized, so provider-paid invoices go through the same audited mark-paid door (RA-G16-01 leaves deferral). | A follow-up packet routes the legacy webhook through the door. |
| D-46 | A platform SUPER_ADMIN who is not a member stays refused on tenant invoice writes. | No change. |
| D-40 | Command-centre and procurement routes are gated under the existing `operations` module scope (OWNER and ADMIN keep access). No new module key. | A follow-up packet adds the gate. |
| D-41..D-45, D-47..D-52 | Kept as built: a period closes only after it ends (D-41); the Gmail owner-only and refresh-token rules (D-42, D-43); no client role on KEY chat (D-44); no staff invoice send by message (D-45); the stricter of the two autonomy settings wins (D-47); termsVersion is mandatory on public accept (D-48); KEY convert_quote only accepts (D-49); OWNER/ADMIN period edits (D-50); stranded idempotency claims are released manually (D-51); message approvals need a provider message id (D-52). | No change. |

### Owner rulings, 2026-11-03

All accepted as recommended, in one batch, by the owner directly (the FOLLOW3 residual scoping, `follow3-scope`).

| Id | Ruling | Effect on the queue |
|---|---|---|
| D-55 | A hand-recorded payment whose method is `stripe`, `paypal` or `wipay` (HTTP route or KEY) is accepted as today but stored with provider `manual`, so no gateway refund door can match it; it still posts to the payment-processor account. | FOLLOW3-A1. |
| D-56 | A Stripe refund event verified by the deployment's webhook secret but carrying no owner tag may read the charge through the existing `StripeConnector.isOwnCharge` to bind it to the business the platform tagged, and is refused when the matched payment belongs to another business. | FOLLOW3-A3. |
| D-57 | The Books reads that carry revenue and cash figures (general ledger, per-account balance, receivables aging, customer balance, finance overview, safe-to-spend) and every money report (`reports/*`, commerce revenue reports) need `revenue:read`, the trial-balance gate. No new module key. | FOLLOW3-A6, FOLLOW3-A7. |
| D-58 | An outbound webhook subscribed to `invoice.paid` also receives `invoice.reopened`. | FOLLOW3-A9. |
| D-59 | When a booking's live deposit is in another currency than the final invoice, completion refuses with 409 (`DEPOSIT_CURRENCY_MISMATCH`), writes nothing, and the operator settles by hand (D-13: one currency per business). | FOLLOW3-A10. |
| D-60 | Once an invoice has left DRAFT, a PATCH that changes its lines, tax or discount (and so its total) is refused with 409; corrections go through void-and-reissue or a credit note (D-28). Restating the stored amounts unchanged, notes, due date and contact edits stay allowed. | FOLLOW3-B2. |
| D-61 | Repository admission binds each required gate to its workflow file (CI/CD Pipeline, Agent Control Gate, Branch divergence, DAST (Native), Agent Control Worker Proof) and fails closed when a run's path is absent or different. | FOLLOW3-C5. |
| D-62 | Deploy scripts (`post-merge.sh`, `start-cloud-app.sh`) run `prisma migrate deploy` instead of `db push`. A database without `0_baseline` fails loudly (P3005) until an operator runs `prisma migrate resolve --applied 0_baseline` once. No auto-baseline. | FOLLOW3-C6. D-20 remains an operator fact to confirm. |
| D-63 | Timeline (Activity) rows map to canonical scopes: KEY/AI rows to `ai`, settings rows to `settings`, communications/messages/inbox to `crm`, genome/site/notifications/analytics per the pinned table; a row of an unmapped module is visible to OWNER/ADMIN only, and the census keeps that set empty. | FOLLOW3-D1. |
| D-64 | Invoice and quote create, update and convert refuse (404) a contact the acting member cannot open under CRM visibility, as bookings create does since V1-06. | FOLLOW3-D6. |
| D-37 | KEY's member-chat contact and calendar reads pass the member as the actor and apply the CRM visibility clause. | FOLLOW3-D7. |
| D-65 | A CANCELLED from the operator status route without an initiator is a customer cancel: a paid deposit is forfeit, as today. KEY `bookings_cancel_booking`, undo and saga compensation are business-initiated and never forfeit. | FOLLOW3-D18. |
| D-66 | Only DRAFT and VOID invoices may be deleted (single, bulk, KEY); an issued invoice is voided first. | FOLLOW3-B6. |
| D-67 | A posted expense refuses amount, items or currency edits with 409 (void and re-record). On the expense detail page, Approve pays a BILL (`POST bills/:id/pay`) and Reject voids it (`POST bills/:id/void`); both are hidden for expenses that are not BILLs. | FOLLOW3-B7. |
| D-68 | The tRPC endpoint (packages/api routers, no web consumer) is unmounted by default: the server serves /trpc only when TRPC_ENABLED=1. V1-26's blocked visibility cases stay it.fails until it is re-enabled with fixes. | Repair round 2 (trpc area); V1-26 closes as partial. |
| D-69 | A WiPay checkout (invoice or storefront) for an amount not in TTD answers 400 and WiPay is not offered for it, until WiPay's currency parameter is verified from its documentation (D-19 fail closed). | Repair round 2 (g6pub area). |
| D-70 | An approved queued KEY action step is run from a Run action on that queue item in the web control tower, executing exactly the stored step through the bound execute route (V1-31b), with no re-planning. | Repair round 2 (key area). |
| D-71 | Each KEY plan step needs the creator's module scope for its module (write for writes, read for reads). OWNER and ADMIN keep every module; a STAFF creator's own-contact (owned-view) rules still apply. | Wave 2: KEY plan authority packet. |
| D-72 | The approved-action queue with its Run action (D-70) is mounted on the Command Center page. | Wave 2: KEY web packet. |
| D-73 | A KEY plan always runs as a member: a trigger records its creator and the plans it fires run as that member, with module scopes and D-46 checked at run time. A plan with no member principal may not write money or invoices and may not read contacts. | Wave 2: KEY plan authority packet. |
| D-74 | A plan step's output is filtered by the viewer's visibility when it is read: a row the viewer cannot see is withheld, even when the OWNER approved the step. | Wave 2: KEY plan reads packet. |
| D-75 | Every invoice read projection (operator detail, public page, payments list, payment status) and every money decision counts only the invoice's own business's payment rows. | Wave 2: deposit/read-contract packet. |
| D-76 | A verified WiPay success for a non-TTD invoice or order (a checkout started before D-69) is not recorded as money: it is kept as a refused webhook event and the owner is told to reconcile by hand. | Wave 2: store/provider packet. |
| D-77 | An operator-created (STANDARD) order marked paid on creation goes through the paid door (invoice, payment and ledger posting), like storefront orders. | Wave 2: store/provider packet. |
| D-78 | Paying the remainder of a part-credited invoice leaves it PARTIALLY_CREDITED, not PAID. | Kept as built (V1-44). |
| D-79 | Numbering continues from a business's highest existing number, legacy INV-<timestamp> numbers included; a scanned invoice number already in use falls back to the next sequence number. | Kept as built (V1-43). |


### Owner rulings, 2026-11-09

Raised by the review of PR #196 (`feat/core-journeys-and-foundation-completion`, built on main without this branch). All accepted as recommended. The PR is not merged; its new parts are rebuilt here as tested packets (PR196-*).

| Id | Ruling | Effect on the queue |
|---|---|---|
| D-80 | At booking completion an unpaid deposit is netted at its billed amount and stays owed on its own invoice (as built by V1-28). | No change. |
| D-81 | The system may move a contact only from LEAD or PROSPECT to CLIENT, when an invoice of that contact is paid: forward-only, through an audited CrmService compare-and-set (ContactAuditEntry, contact.updated), lifecycleStage untouched; one follow-up task goes to the contact's owner. | PR196-CRM-LIFECYCLE. |
| D-82 | A KEY inbox reply without Gmail connected does not fall back to the platform email sender: it fails visibly. Platform relays of business mail elsewhere follow the same rule. | PR196-SYSTEM-EMAIL. |
| D-83 | Outbound webhook delivery logs stay in memory for now; a later dedicated table keys them by host and webhook id and never stores the URL. They are never Activity rows (D-08). | No port. |
| D-84 | There is no separate sample-contact seeding route; the existing demo seed is OWNER-only and audited. | PR196-SEED-DEMO-OWNER. |
| D-85 | Approving or deleting a project plan needs OWNER/ADMIN or projects:write; the actor is recorded; only draft plans may be deleted. | PR196-PROJECTS-SERVER. |
| D-86 | Waitlisted customers get no public accept link yet: staff are notified and the offered slot is held for a fixed 120 minutes. | PR196-WAITLIST-EXPIRY. |
| D-87 | A project task's assignee may be a member of the business or one of its booking staff. | PR196-PROJECTS-SERVER, PR196-PROJECTS-WEB. |

**D-59 as built (FOLLOW3-A10; accepted as D-91 below).** The booking status route keeps V1-28's contract: completion with a live deposit in another currency than the final invoice answers 201, the booking is COMPLETED, and its `invoicing` result is `{ status: FAILED, code: DEPOSIT_CURRENCY_MISMATCH }` with no invoice written or netted. POST create-invoice for that booking answers 409 `DEPOSIT_CURRENCY_MISMATCH`. The operator settles by hand (D-13). Still open: the commerce PATCH accepts a currency switch on a netted DRAFT deposit or on the DRAFT final (SEC-A10-1, follow-up).

### Owner rulings, 2026-11-09 (wave-2 residuals)

Raised by the FOLLOW3 wave-2 packets' recorded residuals. All accepted as recommended.

| Id | Ruling | Effect on the queue |
|---|---|---|
| D-88 | KEY's commerce tools follow D-64 by acting as the member: the dispatcher hands invoice and quote create, update and convert the member the command runs for, and D-64 applies to that member; a run with no member (the autonomous plan queue) uses the OWNER's view, as KEY's contact reads do since KEY-R3b. | W3 D-64 completion (SEC-D6-1). |
| D-89 | An invoice edit that would bring its total below the money it holds (received net of refunds) is refused with 409, including a DRAFT the AI undo returned from an issued state. | W3 overpaid-edit packet (B2 residual). |
| D-90 | The finance payment row in the feed names who recorded the payment, and the CRM `invoice.payment_recorded` Activity copy is no longer written: one feed row per payment (D-08). | W3 V1-55c (V55-07b). |
| D-91 | D-59 is amended to the shipped shape: completion keeps V1-28's contract (201, booking COMPLETED, invoicing FAILED with `DEPOSIT_CURRENCY_MISMATCH`, no invoice written); POST create-invoice answers 409; the operator settles by hand. | No change (FOLLOW3-A10 as built). |

### Owner rulings, 2026-11-09 (wave-3 residuals)

Raised by the wave-3 (FOLLOW4) packets' recorded residuals. All accepted as recommended.

| Id | Ruling | Effect on the queue |
|---|---|---|
| D-92 | An imported (or legacy) DORMANT contact status is stored as CLIENT: every stored status is one of LEAD, PROSPECT, CLIENT, LOST, and "dormant" is always worked out from inactivity (the Dormant segment shows clients with no recent activity). | W4 follow-up to V1-38c (CR-V38c-1): import, automation update_status writer, readers that honour a stored DORMANT. |
| D-93 | D-73 stands as written: a KEY plan with no member principal reads no contacts (and writes no money or invoices). The Pro Auto monitor and any other system-created plan run with the business owner as their member, so they keep working and their reads are attributed. D-88's "no member uses the OWNER's view" is narrowed to D-88's own writes, which D-73 already refuses to a memberless plan. | W4: plan-step authority, Pro Auto monitor principal, KEY CRM visibility CV-08b/CV-08c. |
| D-94 | Only the business owner may connect, sync or disconnect Google Analytics and Search Console (as Gmail, GMAIL_OWNER_ONLY); anyone else gets 403. | W4: SEO controller (MW-27). |

### Owner rulings, 2026-11-10 (wave-5 residuals)

| Id | Ruling | Effect on the queue |
|---|---|---|
| D-95 | Restoring or permanently deleting a trashed record needs write access to the module the record belongs to (CRM for contacts, accounts and opportunities; revenue for invoices, quotes and recurring invoices; people for staff; marketing for community posts and landing pages); seeing it in the trash needs that module's read access. D-46 still refuses a non-member SUPER_ADMIN. | W6 trash packet (SEC-TL500-3). |
| D-96 | The Command Center cockpit snapshot stays open to every member; each tile is filtered by that member's own module permissions (V1-47). D-40's operations scope does not gate it. | None (as built); closes the R0-35 referred explanation. |
| D-97 | D-39 resolved: a RISC hijacking, account-disabled, sessions-revoked or token-revoked event records a durable per-user sign-in cutoff (stored on the user, no schema change, no new secret); the API refuses any token whose original sign-in time is older than the cutoff, even after refresh, and the real user simply signs in again. The provider global logout that needs SUPABASE_JWT_SECRET is not used (R0-SEC-02 stands). | W8 RISC durable cutoff packet; also persist UserIdentity from the verified provider record so RISC events resolve a user (SEC-W7RR-1). |
| D-98 | When a member drives KEY (chat or a plan), KEY's money-writing tools (mark an invoice paid, update an invoice, record a payment) need that member's own revenue write permission, as the web routes do; a read-only member gets a refusal from KEY too. | W8 KEY revenue gate (SEC-W7IAR-2, SEC-W7KMP-2). |
| D-99 | Every Google connection for a business (Calendar, Drive, Contacts, Gmail, Analytics, Search Console) is started, synced and disconnected only by the business owner. | W8 Google consent doors (CR-RCV-1, SEC-W7RCV-2). |
| D-100 | A member without revenue read sees no money signals at all: revenue sorts and filters on the contact list are ignored, and the payment-health ratio is withheld, as amounts are (D-63, D-90). | W8 money-signal packet (CR-W7CMV-2, SEC-W7CMV-3, SEC-W7CMV-1). |
| D-101 | After a D-97 sign-in cutoff, the account accepts only a new sign-in with Google or an emailed link (methods the attacker cannot produce from a stolen refresh token); a password sign-in made after the cutoff is refused until the real user has signed in once with Google or the emailed link, which clears the restriction. | W9 RISC password-route packet (SEC-W8RSC-4). |

### Owner rulings, 2026-11-10 (wave-9 decision residuals)

| Id | Ruling | Effect on the queue |
|---|---|---|
| D-102 | When a paid invoice is reopened (refund or reversal), its money effects are undone: the referral reward credit and the referrer's lead-score bump are reversed, linked projects step back to the status they left, the margin snapshot is marked reversed, and a review request not yet sent is cancelled. Messages already sent, attribution history and the business's first-sale flag stay. The reopen messages no one. | W10 reopen reversals (VR-05 census in invoice-status-events). |
| D-103 | A KEY idempotency claim still unfinished 15 minutes after it was taken can be taken over by a retry; the takeover is audited, and a finished claim is never run again. | W10 claim lease (CR-V19-2). |
| D-104 | Membership is the single rule for business access: an owner recorded only as Business.ownerId, with no Membership row, is refused everywhere (as D-73 and the module-scope guard already do); an operator script, dry-run by default, creates the missing OWNER membership for such owners, and the guards that admit them today are aligned. | W10 owner membership (BRS-12). |
| D-105 | WiPay checkout is offered only to a business that has connected its own WiPay key; tenants no longer share the platform's WiPay account. | W10 WiPay key binding (PC-11b, SEC-V33-2). |
| D-106 | PayPal is not offered for an invoice or order in a currency PayPal does not support (TTD, JMD, BBD, GYD, XCD and any other it does not list); the payer sees which methods can pay it, and payment settings say why PayPal is missing. | W10 PayPal currency (PC-08b). |
| D-107 | The low-runway warning stays, computed from business-currency cash, and states when other-currency cash exists, listing each currency's amount unconverted (or saying it is withheld from this viewer); never a silent alarm. | W10 low runway (CP-18). |
| D-108 | D-97 confirmed as built: an account-disabled event sets the sign-in cutoff only when its reason is hijacking; other reasons (bulk-account and so on) are logged and end no session. | None (as built, W8). |
| D-109 | D-95 confirmed as built: staff records map to Team write, and community posts and landing pages to Content write. | None (as built, W6). |
| D-110 | A platform SUPER_ADMIN who is not a member of a business is refused every trash restore and permanent delete in it, as on revenue writes (D-46); support work uses the admin tools. | None (as built, W6). |
| D-111 | Managing KEY connectors (connect, change, remove) is limited to OWNER and ADMIN members; staff may use them. Google connections stay owner-only (D-99). | None (as built). |
| D-112 | A storefront order not created paid may be marked PAID (order status edit or the fulfilment mark-paid action) only by a member with revenue write, and only through the audited paid door (payment row, ledger posting, actor named); anyone else gets 403. Fulfilment status changes stay open as today. | W10 order paid door (STL-SEC-1, V18-T2c). |
| D-113 | D-101 extended: after a sign-in cutoff, password sign-ins stay refused until the user completes a password reset through KEYFLOW after the cutoff (the existing reset flow); Google and emailed-link sign-ins are accepted meanwhile and clear the rest of the restriction. A password set during the hijack therefore never signs in. | W10 RISC reset (SEC-W9RPC-1/2). |
| D-114 | An explicit module scope binds ADMINs too: an ADMIN whose revenue access is set to 'none' is refused money steps in KEY plans (P&L, revenue reports, invoice actions), amending D-71's ADMIN bypass for explicit 'none' only; ADMINs with default scopes are unaffected. | W10 KEY plan scope (SEC-W9MRK-1). |
| D-115 | Timeline rows written before W9 that name a contact only in their text are backfilled by an operator script (dry-run default) that sets their contact link from the invoice or message intake behind them; a row whose source is gone is served only to OWNER and ADMIN. | W10 timeline backfill (SEC-W9TO-1). |
| D-116 | Owner-only actions (D-11 writes and every other check that asks whether a member is the business owner) require the recorded owner (Business.ownerId) to hold an OWNER-role membership; a recorded owner who holds only an ADMIN or STAFF membership is treated as that role. Amends the D-94/D-104 reading that any membership made the recorded owner "the owner". | W11 owner checks (SEC-W10OM-4, ruling R-6). |
| D-117 | Editing a store order cannot mark it paid: a PATCH that sets a paid-equivalent payment status (COMPLETED or any synonym the readers treat as paid) is refused; only the audited paid door (D-112) marks an order paid, so every paid order has its invoice, payment and books. | W11 store order paid values (SOP-V3, ruling R-10). |
| D-118 | D-115 narrowed: a withheld timeline row whose reason is a name mismatch (its title may name a PRIVATE contact) is served only to the OWNER (and SUPER_ADMIN); other withheld rows keep D-115. | W11 withheld rows (SEC-W10DCS-2, ruling R-1). |
| D-119 | KEY chat stays fail-closed for tools missing from the member authority map (dotted organ and legacy cortex tools): only the business owner may run them until each tool's map entry lands; ADMINs are not admitted meanwhile. | W11 KEY tool authority entries (SEC-W10CCS-R1, ruling R-3). |
| D-120 | The names of the owner's Google calendars (calendar sync settings and the booking calendar list) are listed to the owner and ADMINs only; STAFF may see that a calendar is connected, not its names. Connecting and disconnecting stay owner-only (D-99). | W11 calendar reads (W10-GOOGLE-DOORS-REST residual, ruling R-2). |
| D-121 | A store order paid through the audited paid door (D-112) can be refunded in part through the same door: the refunded amount is recorded against its payment and its books are reversed for that amount, and the order shows it is partly refunded. Amends D-14 for door-paid orders; until it lands a partial refund of such an order answers 400. | W11 partial refund door (CR-W10SOP-2, ruling R-8). |
| D-122 | D-114 confirmed as built: an ADMIN whose explicit scope map has no revenue key is read as revenue 'none' for KEY plan money steps, as the module-scope guard reads it. | None (as built, W10; ruling R-4). |
| D-123 | D-104 confirmed as built for sign-in: a recorded owner who is a member of no live business is answered 403 OWNER_MEMBERSHIP_REQUIRED at bootstrap and is restored by the operator owner-membership backfill; a recorded owner who is a member of any live business signs in to it. | None (as built, W10 trial-Z3 OMV-2; ruling R-7). |
| D-124 | D-103 confirmed as built: a KEY proposal whose outcome cannot be written even after three retries is taken over after its 15-minute lease, and the retry may file a second proposal; the takeover is audited. | None (as built, W10; ruling R-9). |
| D-125 | D-116 read: the owner rule is "holds an OWNER membership of this business". A co-owner (OWNER membership, not the recorded owner) is the owner for owner-only actions; the recorded-owner field grants nothing on its own. | W11 owner helper. |
| D-126 | Shipping a store order books its shipping fee once per order, as a paid shipping expense, on the first "shipped" made by a member with revenue write on any order route; a ship by any other member books nothing. | W11 shipping expense once (F-24). |
| D-127 | The paid door posts cost of goods sold for every order it marks paid, storefront included, inside its own transaction; if the cost accounts are missing the settlement fails and the provider retries, as a failed revenue posting does. | W11 checkout COGS (F-18). |
| D-128 | The KEY genome's financial metrics, snapshot recompute, signals and recommendations are written by members with revenue write; reading them needs revenue read (D-100). | W11 genome finance scope. |
| D-129 | The full KEY context snapshot route (GET cortex/context) is served to the business owner (D-125) and a platform SUPER_ADMIN only; everyone else is refused before anything is read. | W11 cortex read routes. |
| D-130 | KEY chat's learned-lessons block carries only lessons from the reader's own conversations; lessons from other members and member-less rows are not shown (as for memory fragments, SEC-W10CCS-R2). | W11 cortex memory. |
| D-131 | KEY tool authority map (D-119): KEY connector reads need Connect read; timeline reads that derive money signals need AI read and revenue read; tools still unmapped stay owner-only. | W11 KEY organ authority map. |
| D-132 | Setting up and running bank-statement sweeps of the business's Gmail or Drive is owner-only on KEY and on the web (D-99); creating Drive files stays with members who have operations write. | W11 statement sources. |
| D-133 | CRM count widgets (contact stats by status and source, recent growth, the contacts poll) count only the contacts the member may open; the owner sees business-wide figures; people-flow totals stay business-wide (V1-84). | W11 CRM counts. |
| D-134 | D-73 refined: a 409 answered to a KEY plan step is final (answered once, not counted toward the tool's circuit) unless the service marks it retryable (today only the project-task edit race); money conflicts stay final so a person looks. | W11 dispatch refusal finality (DS-05, ruling R-5). |
| D-135 | Every runway alarm reads the ledger cash position in the business currency and counts only business-currency expenses in its burn, naming other-currency amounts unconverted (extends D-107 to FIN_CASHFLOW_RISK, money moves and the genome). | W11 runway ledger cash (F-2). |
| D-136 | Stock rules: a purchase order line with a fractional quantity for a stock product is refused (legacy lines stored as digit text are received as that number); a shipped or delivered order cannot be cancelled by a status edit (refund or return it); a storefront line taken from stock at checkout is never sent to a supplier. | W11 PO lines, order cancel, storefront routing. |
| D-137 | Operator repair scripts (dry run by default, applied by an operator after a backup): delete cross-business planted stock rows with nothing reserved, keeping their movement history, and list reserved ones for manual repair; release storefront reservations held for stock the checkout already decremented. | W11 planted stock census, storefront reservations. |
| D-138 | D-105 extended to PayPal and Stripe: a storefront offers PayPal or Stripe only when the business has saved its own complete credential set; the platform's PayPal and Stripe credentials never stand in for a store's, and a store's keys are never mixed with the platform's. | W11b storefront own payment keys (review SEC-W11SCM-1). |
| D-139 | Setting a stock count directly (POST .../inventory) writes one ADJUSTMENT stock movement (reason SET, the difference, the acting member); a count below the row's reserved quantity is refused with 400; reserved is not hand-editable (only order reservations change it); the Excel import keeps its single EXCEL_IMPORT movement. | W11b inventory set movement (review SEC-UPS-2). |
| D-140 | An OWNER membership that carries an explicit permissionScopes map is bound by it on KEY as on REST: it is refused every unmapped KEY tool (fail closed), as it already is any mapped tool outside its map; an OWNER membership with no explicit map keeps every tool. | W11b owner map on unmapped KEY tools (seam review SEC-SR-3). |

### Owner rulings, 2026-11-12/13 (open-PR tie-off and the PR #195 port)

Ruled by the owner directly, for the tie-off of every open PR and branch and for the port of PR #195 (payroll ledger, safe-to-spend, journal UI, KEY treasury).

| Id | Ruling | Effect on the queue |
|---|---|---|
| D-141 | Open-PR tie-off (2026-11-12/13). Every open PR and branch is tied off: brought into main where main lacks it, closed with a note where main already has it or replaced it. Old-history branches: port what main lacks (squashed, secret-scanned, never their history). Control-plane tooling is included when its own tests pass; anything that widens what automation may merge or approve needs the owner: #185 (the sweep sees every open impl/* PR) and #184 (Copilot quota wording) are approved, #170 is closed in favour of #185, #107 is closed (every branch converges to main). The docs/intelligence research corpus comes into main as a dated historical record. Eight control-plane experiments are closed and archived, not ported: #146, #127, #112, #111, #152, #194, #193, #179. Unfinished features are queued as wave-11b packets: tiered/distributor pricing (branch claude/keyflowos-agent-skill-arch-j44584), website-based contact enrichment (#63), the KEY operational self-model (#162: fix riskTier to riskLevel and the goal-status case, stop swallowing Prisma errors), business knowledge upload (#134: needs a status filter in cortex.search_knowledge and RequireModuleScope first). Every branch gets an archive/<branch> tag and is then deleted; the 22 old-history branches get clean archive tags (their own change squashed onto main, secret-scanned) because their history carries a committed .env. | Section (e) records each PR's disposition; four wave-11b packets are queued. Resolves D-32 and the PRS-M52 placement ruling. |
| D-142 | Payroll mark-paid requires an explicit payment account or method; there is no default account. | PR #195 port, as built (lands in the PR after the tie-off). |
| D-143 | A legacy PAID payroll run with no posting is posted on a repeat mark-paid, dated its original paidAt; a closed period refuses that with 409. No separate backfill script. | PR #195 port, as built (lands in the PR after the tie-off). |
| D-144 | DRAFT and APPROVED payroll runs are reserved in safe-to-spend. | PR #195 port, as built. Wave 11b adds a way to discard a DRAFT run and to discard a legacy run whose currency is not the business currency. |
| D-145 | KEY's treasury figures (ledger cash, unpaid bills, committed payroll, treasury alert) are shown at revenue read; open-ticket counts at operations read. The REST business-graph snapshot carries none of these sections. A KEY plan or monitor with no member principal is refused payroll_mark_paid (D-73 confirmed). | PR #195 port, as built (lands in the PR after the tie-off). |
| D-146 | Writes to the Books need a module write scope. Manual journals, recurring-journal templates, bank rules and matching, reconciliation, opening balances, fixed-asset depreciation and disposal, and period close and reopen need revenue write (the Books' module per D-57; no new key). Payments out that are expenses by nature (tax-liability pay, bill pay) need expenses write; a door that is both needs both. Books reads, recurring-journal templates included, need revenue read. | PR #195 port (journal scope and Books doors). |
| D-147 | The legacy 'finance' job-role key no longer reaches finance_post_journal_entry (the D-35 narrowing is accepted); owners re-grant from the Team page. | PR #195 port, as built (lands in the PR after the tie-off). |
| D-148 | Production is the Hetzner VPS (37.27.27.0) Docker Compose stack in /opt/keyflowos with its own Postgres container, deployed by scripts/deploy.sh. The 29-table Supabase database and Render are retired as production targets (Supabase remains the sign-in provider). A staging environment with real provider test accounts is wanted later. | Resolves D-20; its staging half stays open as a future task. |
| D-149 | The tie-off drops #136's .agents/skills/procedural-intelligence/SKILL.md (it tells agents to update issue #106) and keeps docs/reconstruction/SOURCE-MANIFEST.json. | Done in this tie-off. |
| D-24 | Stays open: the owner has not supplied #174's withheld AC-01/AC-02. | No change. |

---

## (h) Judge dispositions

Three judges scored the draft: release0-first (6/10), correctness and evidence (7/10), and parallel safety (5/10). Each blocking issue is listed with what changed. Disputed claims were re-checked read-only at c2f6f46d before any change.

### Blocking issues

| # | Judge | Issue | Disposition |
|---|---|---|---|
| 1 | Release0-first | R0-16 sat in an early group, so about 18 later Release 0 suites had no manifest and "zero unexplained skips" could not be checked. | **Adopted, by binding each suite rather than moving R0-16 last.** R0-16 stays early so every packet can use the local runner. Its CI step now evaluates every case manifest in the directory, so no later packet edits ci-cd.yml. Every R0 packet with a server suite carries its own manifest in `write_set` and `tests_first`. R0-16 adds `release0-landed.json` for the six suites of packets that landed before the queue. The new R0-35 (last group) proves through a coverage spec that every suite is bound, and runs `proof:release0` at the exact head. |
| 2 | Release0-first | No packet proved step 1 in the Customer UI: R0-25 drove a seeded owner and did not depend on R0-14 or R0-18. | **Adopted.** R0-25 now depends on R0-14, R0-18 and R0-32. Its live spec starts at /auth/signup with local sign-in per D-02, completes manual onboarding, and lands on the selected business before the contact, invoice and payment steps. Under D-02 option C, the sign-up leg moves to the operator's staging run and the spec records the substitution. |
| 3 | Release0-first | Neither D-03 outcome had a packet: the server's three-pillar gate could leave a fresh owner stuck. | **Adopted.** The new R0-32 is a real-DB test with AI off. It characterizes whether the non-AI profile path (PATCH /blueprint) reaches the minimum, and then follows D-03. If the gate is kept, completion must succeed with no model call, or the packet stops with a CONTRADICTION. If the gate is relaxed, the server accepts the minimal profile. Verified: `onboarding-concierge.service.ts:1114-1134`. It also found that completion seeds a demo contact and a demo invoice (`demo-data-seeder.service.ts:77-110`), now pinned in R0-32 and put to D-03. |
| 4 | Release0-first | The first-failing-step fix waited on unrelated decisions linked only by shared files (R0-14 behind R0-09/D-11; R0-21 behind R0-18/D-10; R0-16 behind R0-10). | **Adopted, reconciled with the parallel-safety judge's request for explicit file-order edges.** Edges stay explicit, but they are oriented so decision-free and first-failing-step packets come first. R0-09 now follows R0-14, not the reverse. R0-18 no longer edits client.ts (it reuses workspace.ts's fetch at :237), so R0-21 depends only on R0-15, and D-10 now gates only the switcher UI. R0-10 moved to V1. R0-06 depends only on D-03; R0-14 and R0-32 depend only on R0-00 and D-02 or D-03. |
| 5 | Release0-first | R0-09's check-username throttle could break signup (300 ms debounced checks plus a check on submit). | **Adopted.** Moved to V1-56, with a window above what the form can send and a web signup regression test. Verified: `use-username-availability.ts:31`, `signup/page.tsx:143,150-151`. |
| 6 | Release0-first | Step 6 was undercounted, and R0-27's foreign-contact defect sat late in the commerce chain. | **Adopted.** Step 6 now lists R0-12, R0-27, R0-22, R0-28, R0-33, R0-34 and R0-05. R0-27 (invoice half) is the first commerce.service.ts writer after the in-flight R0-17, ahead of R0-22. Verified: `createInvoice` (commerce.service.ts:271) sets `contactId` unchecked and includes the contact. |
| 7 | Correctness | Refund arithmetic: R0-17, R0-21, R0-24 and R0-26 assumed V1-29's fixed convention. | **Adopted, option (b).** Verified: `markPaymentRefunded` flips the row (commerce.service.ts:2006-2045), and `computeBalance` drops it from paid and subtracts it again (invoice-workflow.service.ts:90-113). R0 ledger lines now state paid = sum(SUCCESSFUL) = ledger cash net on refund-free fixtures. Refunds are a pinned characterization that names V1-29. R0-17's refund clauses (guard, swallowed reconcile, reopening) moved into V1-29. R0-21's fixture drops the nonexistent "REFUNDED -20" row. R0-24 and R0-26, now V1-48 and V1-49, restate their LEDGER lines the same way. |
| 8 | Correctness | V1-05's mock-pattern tests could not prove its row and ledger claims. | **Adopted.** Replaced by one real-DB `test/payments-provider-callbacks.integration.test.ts`, with the PayPal SDK client stubbed at `getPaypalClient` and no network. Citations corrected: `capturePaypalOrder` at payments.service.ts:1473, `payment.create` at 1498-1508. |
| 9 | Correctness | V1-34's `src/.../cash-position.service.integration.spec.ts` would run in the no-DB unit config. | **Adopted.** Renamed to `apps/server/test/cash-position.integration.test.ts`. Verified: vitest.unit.config.ts includes `src/**/*.spec.ts` with `isolate:false` and shuffle. |
| 10 | Correctness | V1-26's packages/api spec never runs in CI. | **Adopted.** ci-cd.yml joins V1-26's write set with a `pnpm --filter @keyflow/api test:unit` step. Verified: CI runs only `pnpm test:ci` (:444) and the web unit suite (:471); `@keyflow/api` has `test:unit`. |
| 11 | Parallel safety | Per-worktree database isolation was promised but never set up, and the map contradicted itself. | **Adopted.** The new R0-00 (first group) provisions `kf_wt_<id>` from a main-tree template, a Redis index and a worktree `.env`. `admit-resources.mjs --packet` enforces them. The protocol (section d, steps 0, 4 and 7) replaces the contradictory lines. Verified: no `.env` in the main tree or any of the four worktrees, and the journey loads `../../../.env` (:74). The two in-flight real-DB packets (R0-05, R0-17) run serialized until R0-00 lands. |
| 12 | Parallel safety | Redis was shared, rate-limit keys had no namespace, and suites deleted every `pub_rate_limit:*` key. | **Adopted.** R0-00 adds an optional `RATE_LIMIT_KEY_NAMESPACE` (the key is unchanged when unset) and per-worktree Redis indexes, and the two deleting suites delete only their namespace. Verified: public-rate-limit.guard.ts:34; revenue-authorization.integration.test.ts:171-173. |
| 13 | Parallel safety | No fixture-prefix registry; unescaped LIKE cleanup can delete other suites' rows; globally unique values were unprefixed. | **Adopted.** The JSON schema has no field for a prefix, so it is stated in each real-DB packet's proof (a RESOURCES line) and in the resource ledger. R0-00 adds a registry and a spec that rejects duplicates, prefixes another prefix's unescaped LIKE would match, new suites that LIKE without escaping, and unprefixed literals in unique columns. Verified: 31 suites declare 30 distinct prefixes, so one (`rva_`) is a live duplicate. |
| 14 | Parallel safety | R0-14, V1-29 and V1-44 might need schema changes from a worktree. | **Adopted.** Each carries a stop rule, and D-02, D-14 and D-28 now state the migration consequence. Verified: no credential column on User or UserIdentity (schema.prisma:139-153); InvoiceStatus has no REFUNDED (:11-23). |
| 15 | Parallel safety | Security packets sat behind feature packets, and step 6 could pass with known cross-tenant paths live. | **Adopted.** Credential removal is now R0-31 (zero overlap, first group). Quote-route authorization is R0-28 with no D-04 gate; the state machine is V1-50. The portal grant is R0-33 and cortex audit is R0-34, both verified at portal.service.ts:15-37 and key-cortex-audit.controller.ts:18-19,70-105. The step-6 scope note states what is known-open (the phone stream, which needs an OpenAI key) and what is unassessed. |

### Improvements

| Judge | Suggestion | Disposition |
|---|---|---|
| Release0-first | Move R0-10, R0-24, R0-26 and the quote branch out of R0 | Adopted: V1-47 to V1-53. The conditional ones return to R0 if D-04 or D-07 rule them in. R0-04 stays (landed). |
| Release0-first | Split scope creep (R0-12 shadowing and callerId; R0-17 refunds; R0-19 Activity dedupe) | Adopted: V1-54, V1-29, V1-55. CallLog is under the tenant extension (packages/db/src/client.ts:85), so callerId is attribution, not isolation. |
| Release0-first | First-failing-step evidence is static; ambiguous layout citation | Citation fixed to `apps/web/src/app/app/layout.tsx:41`. The D-02 conditionality is stated, and M07 is named as the unconditional failure. **The reproduction was not run:** a spawned server rewrites the shared users table while two in-flight packets use that database. It is owed by the REDs of R0-14, R0-32 and R0-25 on isolated databases. |
| Release0-first | HIBP and the D-02 hosted outcome in R0-14 | Adopted: HIBP_DISABLED for Release 0, HIBP in COST-LEDGER-001, and option C (docs only). |
| Release0-first | Web proof of visible failure (step 7) | Adopted in R0-23. |
| Release0-first | Narrow R0-15's 132-function sweep | Adopted: the Release 0 functions plus a shrink-only count; the full sweep is a V1+ row. |
| Release0-first | Label R0-07's /readyz probe | Moved instead: the OPS-001 backlog row, with per-process failure injection. |
| Correctness | Wrong citations (interceptor 322-359, PayPal 1434-1470), V1-25's "+" marker, R0-17 SHA, R0-21 grep, SUPER_ADMIN wording, D-03 gate | All adopted. The "+" marker is now computed: absent at c2f6f46d and not created by an earlier packet. |
| Correctness | Four Activity rows are cited with one file | Partly adopted. Three writers are cited; the crm mirror was not re-located, so V1-55's RED records the actual count. |
| Correctness | Estimates capped at 8 h | Adopted for the named packets (R0-16 10 h, R0-25 12 h, V1-24 12 h, V1-15 12 h, V1-42 10 h, V1-36 9 h). Critical paths are stated as lower bounds. |
| Correctness | R0-25 RED expects two red cases; only one is red | Adopted: one red case, and the rewrite scans use-genome-gate.ts. |
| Correctness | V1-15 bound DB claims to a stubbed spec | Adopted: new `test/ledger-write-door.integration.test.ts`. |
| Correctness | Script specs had no named runner | Adopted: V1-01 (`node --test scripts/security/tests/`), V1-13 (native-dast.yml) and V1-39 (ci-cd.yml step). R0-16's selftest also gets a ci-cd.yml step. |
| Parallel safety | Add file-order edges | Adopted: 20 edges, computed by script and marked † in section (c). |
| Parallel safety | R0-12 into the first wave; shrink R0-03's write set | Adopted: R0-03, R0-04 and R0-11 (all landed) now write only their manifests. |
| Parallel safety | D-24 in the exit gate | Adopted. |
| Parallel safety | V1-45 may not need a migration | Adopted: it uses the existing IdempotencyKey table (schema.prisma:7617-7634) with a namespaced key and V1-19's insert-claim. It is no longer a main-tree packet. |
| Parallel safety | Main-tree resource rule; V1-17 drift guard; R0-07 failure injection; SeedService on isolated DBs; Payment foreign-tenant controls; V1-43 plain function | All adopted (protocol step 7, V1-17, the OPS-001 row, R0-09, R0-17/R0-20/R0-22/V1-48/V1-49/V1-29, V1-43). |
| Parallel safety | Table hides path collisions | Adopted: repeated names are disambiguated, and the JSON is stated as the only basis for disjointness. |
| Parallel safety | Coverage ledger gaps | Adopted: the ID ledger (all 174 findings), RA mapping, R0-D4/R0-D5, resource ledger, V1-MODULE-SCOPE and #186 rows, and the branch commit map. |

**Not adopted.** Two suggestions were declined, both for the same reason: they conflict with the release0-first lens.

- **Moving V1-29 into R0 (option a of issue 7).** Refunds are not a #186 step. Pinning the defect as a characterization keeps R0 honest without widening it.
- **Moving R0-16 to the last R0 group (one option of issue 1).** Every packet would then lose the local runner. The per-suite manifests plus R0-35 meet the same exit condition.
