# Module Contract — Contacts / CRM Core v1

**Status:** DRAFT FOR CHARACTERIZATION AND PILOT / NOT AN IMPLEMENTATION DIRECTIVE  
**Source main:** \`b1948d2797e1bae3660a3d7173abb75397e05aad\` (2026-10-29)  
**Related product target:** issue #186 Release 0  
**Scope:** tenant-scoped create, list/search, view, update, refresh, authorization and persistent/audit behavior. Existing advanced CRM capabilities remain outside this pilot but are not cut from KEYFLOWOS.

## 1. Customer outcome / acceptance

A permitted owner/staff member can enter a contact, return later, find and edit the same record, and link it to the business's future quote/invoice. Another business or a staff member without rights cannot access or mutate it. No paid AI or external connector is needed.

The pilot is a *specification-to-proof* test, not a mandate to rewrite a module whose implementation already exists.

## 2. Current code owners — read on exact base before editing

| Concern | Existing main file | Observed |
|---|---|---|
| Schema / Contact | \`packages/db/prisma/schema.prisma\` | Contact with businessId, first/last name, email/phone normalized, status, tags, visibility, ownerId, audit/event/note/task/quote/invoice/booking relations, soft delete |
| REST entry points | \`apps/server/src/modules/crm/crm.controller.ts\` | GET list/detail; POST create; PATCH update; DELETE soft delete under /crm/businesses/:businessId/contacts |
| Business logic | \`apps/server/src/modules/crm/crm.service.ts\` | create/list/update/soft-delete; tenant filters; events; transaction/timeline |
| Input validation | \`apps/server/src/modules/crm/dto/create-contact.dto.ts\`, \`update-contact.dto.ts\` | class-validator decorators and sanitation |
| Access scopes | \`apps/server/src/modules/crm/crm-permissions.helper.ts\` | module and record visibility/ownership logic |
| Basic tenant predicate | \`apps/server/src/modules/crm/crm.helpers.ts\` | businessId plus deletedAt null |
| Contact detail projection | \`apps/server/src/modules/crm/crm-stats.service.ts\` | contact, events, notes, tasks, invoice/booking contextual counts |
| Contact UI | \`apps/web/src/app/app/crm/contacts/page.tsx\` | current list screen and keyboard shortcuts; /app/crm redirects here |
| Client calls / UI orchestration | \`apps/web/src/lib/client.ts\`, \`apps/web/src/app/app/crm/pipeline/hooks/use-contacts-data.ts\`, \`use-contact-actions.ts\` | existing REST wrappers and create/update actions |
| Form | \`apps/web/src/components/contacts/contact-form.tsx\` | client-side form validation and duplicate warnings |
| Existing HTTP test | \`apps/server/test/crm.e2e.test.ts\` | exercises controller/guard responses using mocked CRM service and mock storage; **does not prove real DB persistence** |

### Snapshot evidence

- \`crm.controller.ts\` blob \`7074e1214ecdb7b552c223e04d8a7bf1875ba0d7\`
- \`crm.service.ts\` blob \`f21bea05cb71f122ac114e5688301f683f9dd089\`
- \`schema.prisma\` blob \`d8b5b1c70a02478fab7528916a55b8b5d2bea101\`
- \`crm-permissions.helper.ts\` blob \`784a79f0d6d485a44bef196e5aa6ae5d4633c2dc\`
- \`crm.helpers.ts\` blob \`785aaa84cc4c5467504df44650f8fba4116330a6\`
- \`crm-stats.service.ts\` blob \`f381a383798351384a95e6fa700869e1723e954c\`
- \`contacts/page.tsx\` blob \`947ca1e403c6359ac3bd15a1663a5fb9d728513f\`
- \`client.ts\` blob \`1035e66e56d803f41f654fd14859ad3e5c9b15f0\`
- \`crm.e2e.test.ts\` blob \`cb7eb75aa3a285a530491965b0f614aa93696930\`

## 3. Core domain models

**Existing Contact:** id, businessId, firstName, lastName, optional displayName, email/emailNormalized, phone/phoneNormalized, status (default LEAD), source, ownerId, visibility (default TEAM), tags, custom, createdAt, updatedAt, deletedAt, related quote/invoice/booking, events, notes, tasks and audit.

**Existing Membership and Business:** business is tenant root; membership and module scopes determine permitted work. Exact field/constraint SQL must be validated against current migration and staging schema before any write.

**Existing ContactEvent:** businessId, contactId, type, data, source/actor and createdAt, intended as activity timeline. **Existing ContactAuditEntry:** per-contact audit row, actor and before/after fields.

No new model is required for the pilot. An additional migration is prohibited unless the characterization phase identifies and proves a necessary gap.

## 4. HTTP contracts to characterize and retain

- \`GET /crm/businesses/:businessId/contacts\` — list/search/filter/paginate; guards AuthGuard, BusinessGuard, ModuleScopeGuard (crm/read), rate limiting; response shape must be captured from live code + test before freezing.
- \`GET /crm/businesses/:businessId/contacts/:contactId\` — detail projection; same guards. **Investigate additional row-level privacy controls for staff**.
- \`POST /crm/businesses/:businessId/contacts\` — authenticated business member with crm/write and plan limits; accepts CreateContactDto; response includes created contact.
- \`PATCH /crm/businesses/:businessId/contacts/:contactId\` — crm/write and permission/ownership; accepts UpdateContactDto; updates record plus timeline/event.
- \`DELETE /crm/businesses/:businessId/contacts/:contactId\` — soft delete subject to delete scope; NOT part of first happy-path mutation but security/recovery tests required.

Do not invent a new REST surface or tRPC requirement for this packet. Determine exact response envelope and serialization from existing code first.

## 5. UI contract

- Canonical entry: \`/app/crm/contacts\`; \`/app/crm\` redirects there.
- Create/contact editor: existing form, searchable list, loading and error handling, view existing contact, return/refresh with persisted state, edit; preserve keyboard and navigation behavior where already working.
- On inadequate permission, show denial state; do not interpret 403 or 404 as empty customer data.
- No KEY or paid provider dependency for the core journey.

## 6. Invariants and failure rules

- **TENANT:** all persisted and fetched contacts belong to the requested business; cross-business IDs are not enough to authorize read/write; returned linked child rows remain tenant-scoped.
- **RECORD VISIBILITY:** PRIVATE and staff-owned records obey membership-level CRM visibility and sharing restrictions on *every* detail and read path, not just list. Current detail controller calls \`crmStats.contactDetail\` without actorUserId, and the detail service's \`assertContact\` must be audited; this is a **review hypothesis** rather than a confirmed exploitable issue.
- **INPUT:** client and server validation agree on required names, optional contact fields, length/email/phone, normalization and null handling. In particular, frontend requires firstName while server marks it optional; must decide intended contract before changing.
- **PERSISTENCE:** successful create/edit survives an actual DB read, reload and new authorized session; mock-only tests insufficient.
- **EVENT/AUDIT:** create/update are reflected in a durable activity trace with actor and exact record; \`auditContact\` currently dispatches asynchronously fire-and-forget, so failure behavior and recovery must be characterized rather than assuming atomic audit.
- **NO FAKE SUCCESS:** UI, API and agent claims match actual persisted result.
- **IDEMPOTENCY:** repeating form actions under network loss must not unintentionally duplicate critical customer records; assess existing duplicate handling versus explicit idempotency.
- **MONEY RELATIONSHIP:** subsequent invoice uses the same contact ID under same tenant; no cross-tenant invoice attachment allowed.
- **SAFETY:** do not erase existing contact history through hard delete; respect existing privacy/forget policies.

## 7. Pilot proof matrix (must be executed, not self-certified)

| Test ID | Test | Expected |
|---|---|---|
| CT-P01 | Real authenticated owner creates contact in test/staging DB | 201 and persisted Contact businessId+normalized fields |
| CT-P02 | Owner reloads contacts list; opens new detail | Same ID and fields; no lost data |
| CT-P03 | Owner edits contact then rereads in fresh session | Updated persisted fields and activity evidence |
| CT-P04 | User from tenant B lists/reads/patches tenant A contact via path/id guessing | Fail closed, no disclosure or change |
| CT-P05 | Read-only member attempts create/edit | Denied, no DB mutation |
| CT-P06 | Staff with owned/private visibility attempts another staff member's PRIVATE record via detail endpoint | Denied; no disclosure, even if they can list other TEAM records |
| CT-P07 | Invalid and mismatched form/server input | Consistent 400/validation, no partial writes |
| CT-P08 | Duplicate submit / replay / retry | Defined duplicate prevention or explicit surfaced limitation |
| CT-P09 | Created/updated event and audit evidence can be queried | Durable correct business/contact/actor/changes or explicitly recorded blocker |
| CT-P10 | No AI/messaging/payment keys configured | Contacts journey succeeds; optional modules fail independently |
| CT-P11 | Existing \`crm.e2e.test.ts\` + real DB integration fixture | Existing mock test still passes, real persistence and guards proven |
| CT-P12 | Browser smoke through new contact → list → edit → refresh | User-visible correct state with screenshot/video or other direct evidence |

## 8. Implementer verification and blocker disposition (October 29, 2026)

**Implementer report:** Claude read CONTACTS-v1 against main@b1948d2797e1bae3660a3d7173abb75397e05aad and reported all nine recorded blob anchors and 14 files matching. This is a code-review result, not an executed test suite. ChatGPT subsequently inspected the source snippets and the existing real-database integration-test fixture; it did not run the application or database tests.

| Blocker / disposition | Status | Verified by implementer — SHA and line | Follow-up |
|---|---|---|---|
| 1. Contact detail visibility | **CONFIRMED BY CODE READING**; CT-P06 runtime FAIL not yet reproduced | Claude reported verified. Independently read \`crm.controller.ts\` blob \`7074e121\` lines **322–330**; \`crm-stats.service.ts\` blob \`f381a383\` lines **149–158, 571–573**; \`crm-permissions.helper.ts\` blob \`784a79f0\` visibilityClause | Detail receives no actor and applies only tenant predicate. Create negative control for STAFF crm_view=owned/PRIVATE and make smallest fail-closed fix after authorized directive. Do not infer a cross-tenant bypass. |
| 2. Audit propagation | **CONFIRMED CODE DEFECT / DECISION GATED** | Claude reported unawaited contact mutation call sites. Independently read \`crm.service.ts\` blob \`f21bea05\` lines **148–169, 492, 812, 862, 969, 1072, 1433–1442, 1675–1735**; \`contact-audit.service.ts\` blob \`9673b331\` lines **142–169** | **Correction to implementer summary:** even notes/tasks' syntactic \`await this.auditContact(...)\` does NOT await the database write because helper returns \`void\` and calls \`void this.contactAudit.write(...)\`. The writer also logs/swallows failure. Await alone does not make audit mandatory or atomic. Operator decision required on audit evidence contract; design durable proof and failure injection. |
| 3. Existing HTTP tests | **CONFIRMED MOCKED; REAL-DB FIXTURE EXISTS** | \`apps/server/test/crm.e2e.test.ts\` blob \`cb7eb75a\` service mock near **82–96**, HTTP cases **190–328**; \`tenant-scope-extension.integration.test.ts\` blob \`2f55e3e0\` lines **1–49**; \`tenant-membership-boundary.integration.test.ts\` blob \`85518758\` lines **1–55** | Use existing DATABASE_URL + pgvector/pg16 CI real-DB pattern; new test file is a new **test case**, not a new test framework. Test fixture existence does not establish that this Contacts test passes. |
| 4. firstName web/server mismatch | **CONFIRMED BY CODE READING / DECISION GATED** | \`create-contact.dto.ts\` blob \`31b2a0f0\` lines **12–17** has \`@IsOptional() firstName?: string\`; \`contact-form.tsx\` blob \`4c73765f\` line **52** uses \`z.string().min(1,...)\` | Choose whether manual REST route requires firstName or permits an identifiable email/phone-only contact. Do not narrow internal \`CrmService.createContact\` blindly: Google Forms/connector ingestion can supply null firstName. |
| 5. End-to-end staging | **UNVERIFIED / BLOCKED ON ENVIRONMENT** | No pinned executed real-DB/browser log supplied | CT-P12 requires staging, synthetic identities, exact release SHA and screenshots/HTTP/DB proof; no production mutations. |
| 6. Current source and authority | **PREFLIGHT REQUIRED** | main bound to \`b1948d27\` for code review; issue #80 carries concurrent meta packets and holds | Freshly resolve main, worktree lock, #80 authority and relevant PR overlaps before any worker writes. A documentation update or issue #186 alone does not grant merge or deploy rights. |

### Security finding in precise terms

- AuthGuard, BusinessGuard, and ModuleScopeGuard protect the detail controller at the business/module level.
- The list flow passes actorUserId to \`CrmService.listContacts\`, which applies \`visibilityClause\`.
- Detail \`CrmStatsService.contactDetail\` is invoked without actorUserId and calls \`assertContact\`, whose predicate is \`{id, businessId, deletedAt: null}\`, then loads related rows. A member with crm/read can therefore be *authorized at the business/module level* without passing the intended per-contact PRIVATE/owned visibility test.
- **Expected fix:** filter/check the specific Contact row using the *same effective visibility logic as list* before related data queries. Prefer 404 on an invisible row to avoid an existence oracle. Preserve valid OWNER/ADMIN/STAFF/read-only cases and existing tenant guard. Exact code and response status require worker characterization.
- **Evidence boundary:** confirmed by source and access-control reasoning; exploit reproduction and patch regression remain NOT_RUN.

### Proposed operator decisions (not silently approved)

- **DEC-CONTACTS-001:** Should the *manual REST create route* reject missing/blank firstName to agree with current web form, or support identifiable name-less contacts with a different UI rule? Preserve service/internal-ingestion compatibility. **Current status: PENDING_OPERATOR_APPROVAL.**
- **DEC-CONTACTS-002:** Is ContactAuditEntry a required durably committed part of a contact mutation, or a best-effort secondary report alongside another durable/transactional audit source? If required, merely awaiting a helper that swallows exceptions is insufficient; use transaction/outbox/error propagation and real failure-injection proof appropriate to exact existing owner. **Current status: PENDING_OPERATOR_APPROVAL.**

See \`docs/reconstruction/product/DECISION-LEDGER-CONTACTS-001.md\` for alternatives, impact and a proposed default, not authority.

## 9. Implementation approach and boundaries

**Phase A — characterize only:** re-resolve main; inspect exact DTO/controller/permissions/list/detail/service/UI/test changes and existing CI; run local tests and isolated DB/security negative controls. Report exact first failing assertion.

**Phase B — minimal correction:** if proved gap, patch only existing CRM service/guard/detail and affected tests. Separate any auth/permission correction from cosmetic UI work. No new CRM module, source-of-truth, schema, AI tool registry or worker. No production mutation.

**Phase C — independent proof:** rerun tests on exact PR head, review negative controls, report omissions and fresh source SHAs. Existing governance and issue #80 authorization continue to apply.

**Phase D — user journey proof:** staging journey at deployed SHA, real DB state proof, tenant negative controls, browser result and persistence, cost ledger. Mark PASS only on independently reviewed evidence.

## Delivery authority update

This document is not a directive. The immediate implementation release, if any, is limited to the separately published issue-80 DIRECTIVE and its exact declared write set. Section 10 below is the complete *candidate* pilot, not automatic authority to edit firstName/audit. The two operator decisions remain deferred until explicit authorization.

## 10. Delivery packet candidate for Claude Code / Kimi Code

Packet ID proposal: \`KF-PRODUCT-CONTACTS-PILOT-001\` (NOT released).

**Objective:** establish truthful, tenant-safe, persisted Contacts CRUD journey and smallest corrections necessary to prove CT-P01..12.

**Allowed characterization read-set:** relevant \`apps/server/src/modules/crm/**\`, membership/tenant/Prisma extension, \`apps/web/src/app/app/crm/**\`, \`apps/web/src/lib/client.ts\`, app auth/workspace, test suite, migrations and staging configuration.

**Allowed write-set:** NONE until a current governed directive specifies exact files.

**Non-goals:** general CRM redesign, import/enrichment/AI campaigns, new queue, broad permissions rewrite, new ORM, full contacts scope expansion, general UI redesign, production data operations.

**Stop:** no verified test database, stale base/ref, unresolved authority, overlapping writer, paid external effect, discovered tenant/data-loss risk requiring wider review, or unproven acceptance results.

**Acceptance:** every proof obligation has exact-head PASS / FAIL / BLOCKED with evidence and real-DB/UI coverage, independent review, and authorized merge and staging release gates. Silence is not PASS.

## 11. Subsequent modules

Prepare separate \`INVOICING-v1.md\`, \`PAYMENTS-LEDGER-v1.md\`, \`AUTH-BUSINESS-v1.md\` and \`PUBLIC-COMMERCIAL-v1.md\` at the same granularity. Contacts is not a substitute for the full Release 0 outcome.

**Provenance caution:** source SHA anchors establish the code examined, not runtime proof. The date/deadlines in the execution plan are proposed human-driven milestones, not background automation.
