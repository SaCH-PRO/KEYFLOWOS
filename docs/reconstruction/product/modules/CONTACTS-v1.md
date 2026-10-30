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

## 8. Known blockers / questions before v1 spec acceptance

1. **Potential staff detail visibility gap:** verify \`CrmStatsService.assertContact\` and all detail endpoints against record-level access requirements. This is a bounded security investigation, not permission to alter all CRM.
2. **Audit atomicity:** \`CrmService.auditContact\` is fire-and-forget. Establish which audit source is mandatory for mutation and whether failures create missing evidence.
3. **HTTP mock ≠ DB proof:** current \`crm.e2e.test.ts\` mocks CrmService; require test DB fixture and browser flow.
4. **Form/server firstName disagreement:** frontend requires firstName; backend create DTO optional. Decide specification based on actual product design before edits.
5. **No direct staging run in this session:** connection, deployed commit, secrets, DB state, acceptance proofs UNKNOWN.
6. Confirm current branch and authoritative packet before any implementation: \`main\` may have advanced after 2026-10-29.

## 9. Implementation approach and boundaries

**Phase A — characterize only:** re-resolve main; inspect exact DTO/controller/permissions/list/detail/service/UI/test changes and existing CI; run local tests and isolated DB/security negative controls. Report exact first failing assertion.

**Phase B — minimal correction:** if proved gap, patch only existing CRM service/guard/detail and affected tests. Separate any auth/permission correction from cosmetic UI work. No new CRM module, source-of-truth, schema, AI tool registry or worker. No production mutation.

**Phase C — independent proof:** rerun tests on exact PR head, review negative controls, report omissions and fresh source SHAs. Existing governance and issue #80 authorization continue to apply.

**Phase D — user journey proof:** staging journey at deployed SHA, real DB state proof, tenant negative controls, browser result and persistence, cost ledger. Mark PASS only on independently reviewed evidence.

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
