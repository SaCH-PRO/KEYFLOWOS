# Contacts v1 — Operator Decision Ledger (2026-10-29)

Status: DECISIONS PENDING; this is not consent to implementation.
Source: main@b1948d2797e1bae3660a3d7173abb75397e05aad.
Related: CONTACTS-v1.md, issue #186, issue #80.

## DEC-CONTACTS-001 — Contact first-name requirement

**Conflict independently verified:** web contact-form.tsx (blob 4c73765f) line 52 requires nonempty firstName; server create-contact.dto.ts (blob 31b2a0f0) lines 12-17 permits missing firstName; crm.service.ts accepts nullable firstName; internal CRM callers include forms and connector ingestion that can deliver null firstName.

**Option A (recommended for manual-entry UX):** require firstName on the *manual REST create route only*, with appropriate blank/whitespace validation and a clear 400; preserve nullable firstName in shared service/ingestion paths, with integration tests for both. Verify other REST consumers before narrowing the DTO.

**Option B:** make the manual UI support contacts without first names, when uniquely identifiable by organization/email/phone; define identity/display policy, adjust UI and tests.

Decision: PENDING_OPERATOR_APPROVAL. No automatic implementation. Do not force a global NOT NULL DB migration or block connector-created contacts merely to align a single form.

## DEC-CONTACTS-002 — Audit integrity and mutation outcome

**Conflict independently verified:** crm.service.ts (blob f21bea05) lines 148-169 calls `void this.contactAudit.write(...)` inside a helper returning void. Create/update/delete/bulk/merge invoke the helper without await. Note/task call sites syntactically use `await this.auditContact(...)`, but it still returns void and cannot await the underlying write. ContactAuditService.write() (blob 9673b331) lines 142-169 catches exceptions, logs and returns resolved void. Therefore awaiting the existing helper would not ensure audit persistence or error observability.

**Option A (recommended where audit is mandatory evidence):** define a fail-closed durable audit contract and integrate the audit record with the contact mutation in the same transaction when possible. Where cross-service/outbox boundaries apply, ensure durable intent/event and replay with explicit non-green failure state. Never announce success with missing mandatory evidence. Add database failure-injection tests and verify no duplicate audit on retry.

**Option B:** treat `ContactAuditEntry` as best-effort enrichment only, but identify the separate transactional canonical audit source that proves the mutation and demonstrate that evidence under failures/retries. The UI must not imply ContactAuditEntry itself is guaranteed.

Decision: PENDING_OPERATOR_APPROVAL. No automatic source changes. Need to inspect `TeamAuditInterceptor`, `CrmTimelineService`, and `BusinessEvent` exact persistence transaction boundaries before selecting the minimally invasive fix.

## Decision discipline

The operator owns product semantics and audit obligation strength. ChatGPT can recommend but must not equate a review report with permission to change code. A bounded issue-80 directive for the *confirmed within-tenant visibility defect* may proceed independently of these two choices if the controller/service fix is surgical, tests are real, and all control-plane preconditions remain satisfied.

## Implementer verification ledger

| Finding | Review method | Pinned evidence | Status |
|---|---|---|---|
| Detail visibility | Claude read; ChatGPT independently read | crm.controller.ts 7074e121:322–330; crm-stats.service.ts f381a383:149–158,571–573; crm-permissions.helper.ts 784a79f0 | CODE_CONFIRMED / RUNTIME_NOT_RUN |
| Form/DTO mismatch | Claude read; ChatGPT independently read | create-contact.dto.ts 31b2a0f0:12–17; contact-form.tsx 4c73765f:52 | CODE_CONFIRMED |
| Audit helper semantics | Claude read; ChatGPT independently read | crm.service.ts f21bea05:148–169; contact-audit.service.ts 9673b331:142–169 | CODE_CONFIRMED / DURABILITY_NOT_PROVED |
| HTTP mock tests | Claude read; ChatGPT independently read | crm.e2e.test.ts cb7eb75a:82–96,190–328 | CODE_CONFIRMED |
| Existing real-DB test pattern | Claude read; ChatGPT independently read | tenant-scope-extension.integration.test.ts 2f55e3e0:1–49; tenant-membership-boundary.integration.test.ts 85518758:1–55 | HARNESS_EXISTS; CONTACTS_PROOF_NOT_RUN |
