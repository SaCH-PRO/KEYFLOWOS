# Plan: Document Intelligence / Contract Registry Revival

## Context
- Approval Center unification is complete and passing tests.
- Next Phase 1 foundation target from the compaction: **Document Intelligence / Contract Registry revival**.
- Existing models:
  - `DocumentInstance` / `DocumentVersion` / `DocumentSection` — AI-generated document engine.
  - `BusinessAsset` — generic asset registry that already supports `type = CONTRACT` with `status`, `expiresAt`, `metadata`.
  - `Asset`, `KeyDocument`, `DriveIntakeFile`, `IngestionItem` — file/ingestion stores.
  - `DocumentIntelligenceService` — LLM extraction for invoices/receipts/contact cards and a bare `contract` branch.
- Existing UI:
  - `/app/document-intelligence` is a static mock dashboard.
  - `/app/documents` redirects to `/app/document-intelligence`.

## Goal
Make contracts and legal documents first-class objects:
1. **Classify/tag/link** uploaded/generated documents as contracts.
2. **Extract contract terms** (parties, effective date, expiry, renewal, value, key clauses) via AI.
3. **Renewal / expiration alerts** surfaced in the UI and optionally as notifications.
4. **Version history** for contract-linked documents.
5. **Retention** status / policy tracking.

## Three candidate approaches

### Option A: Lightweight — extend `BusinessAsset` (Recommended)
- Reuse the existing `BusinessAsset` table (`type = CONTRACT`) for the registry.
- Add a small migration with:
  - `ContractTerm` table for normalized extracted terms.
  - `ContractAlert` table for expiration/renewal alerts.
  - Optional `retentionPolicy` / `retentionUntil` columns on `BusinessAsset`.
- Link contracts to files via `BusinessAsset.metadata.{assetId,documentInstanceId,driveFileId}`.
- Enhance `DocumentIntelligenceService` contract extraction to populate `BusinessAsset` + `ContractTerm` rows.
- Add `ContractRegistryController` + `ContractRegistryService` under `/contracts/businesses/:businessId`.
- Build `/app/contracts` registry page and add it to nav under Governance or Intelligence.

**Pros:** Minimal schema churn, fast to ship, leverages existing asset status/lifecycle.  
**Cons:** Less normalized than a dedicated contract model; metadata links are looser.

### Option B: Canonical — new `Contract` domain
- Add dedicated `Contract`, `ContractParty`, `ContractTerm`, `ContractVersion`, `ContractAlert`, `ContractTag` tables.
- Link to `BusinessAsset`, `DocumentInstance`, `Asset`, `Contact` as needed.
- Rewrite extraction flow to target the new schema.
- Full controller/service/frontend.

**Pros:** Cleanest long-term domain model, supports complex contracts (multiple parties, amendments, redlines).  
**Cons:** Larger migration, more code, longer delivery; overlaps with existing dormant document engine.

### Option C: Document-centric — extend `DocumentInstance`
- Treat contracts as `DocumentInstance`s of contract document types.
- Add `ContractTerm` and `ContractAlert` tables linked to `documentInstanceId`.
- Reuse document versions for version history.

**Pros:** Uses the richest existing document model and version history.  
**Cons:** `DocumentInstance` is tied to the dormant AI document generator and may carry UI/editor baggage not needed for a registry.

## Proposed implementation (Option A)

### 1. Schema migration (`packages/db/prisma/schema.prisma`)
```prisma
model ContractTerm {
  id          String   @id @default(cuid())
  businessId  String   @map("business_id")
  business    Business @relation(fields: [businessId], references: [id], onDelete: Cascade)

  contractId  String   @map("contract_id") // BusinessAsset.id
  termKey     String   @map("term_key")    // e.g. renewal_clause, value, term_length
  termValue   String   @map("term_value")
  extractedAt DateTime @default(now()) @map("extracted_at")
  confidence  Float    @default(0)
  sourceText  String?  @map("source_text")

  @@index([businessId])
  @@index([contractId])
  @@index([termKey])
  @@map("contract_terms")
}

model ContractAlert {
  id          String    @id @default(cuid())
  businessId  String    @map("business_id")
  business    Business  @relation(fields: [businessId], references: [id], onDelete: Cascade)

  contractId  String    @map("contract_id")
  alertType   String    @map("alert_type") // expiry_30, expiry_7, renewal_due, expired
  dueDate     DateTime  @map("due_date")
  acknowledgedAt DateTime? @map("acknowledged_at")
  createdAt   DateTime  @default(now()) @map("created_at")

  @@index([businessId])
  @@index([contractId])
  @@index([dueDate])
  @@map("contract_alerts")
}
```
- Add `retentionPolicy String?` and `retentionUntil DateTime?` to `BusinessAsset`.

### 2. Backend: `ContractRegistryModule`
- `ContractRegistryService`
  - `listContracts(businessId, filters)` — by status, tag, expiry window, search.
  - `getContract(businessId, contractId)` — includes terms, alerts, linked files.
  - `createContract(businessId, dto)` — manual or from extraction.
  - `updateContract(businessId, contractId, dto)` — tags, status, retention, links.
  - `deleteContract(businessId, contractId)`.
  - `extractFromDocument(businessId, assetId/documentId, userId)` — call `DocumentIntelligenceService`, upsert `BusinessAsset`, write `ContractTerm`s, regenerate `ContractAlert`s.
  - `regenerateAlerts(businessId, contractId)` — create expiry/renewal alerts.
  - `acknowledgeAlert(businessId, alertId)`.
  - `getStats(businessId)`.
- `ContractRegistryController` under `/contracts/businesses/:businessId`
  - `GET /contracts`, `GET /contracts/:contractId`, `GET /stats`
  - `POST /contracts`, `PATCH /contracts/:contractId`, `DELETE /contracts/:contractId`
  - `POST /contracts/:contractId/extract`, `POST /contracts/:contractId/acknowledge-alert/:alertId`
  - `GET /alerts` (optionally separate).
- Wire module into `AppModule`.

### 3. AI extraction enhancement
- Extend `DocumentIntelligenceService` contract prompt to output:
  - `parties`, `effectiveDate`, `expiryDate`, `renewalType` (auto/manual/none), `renewalNoticeDays`, `contractValue`, `currency`, `termLength`, `keyClauses`, `jurisdiction`.
- Add `ExtractedContractData` interface and use it in `processExtractedDocument` when `documentType === 'contract'` to call `ContractRegistryService.upsertFromExtraction`.

### 4. Background alert generation
- Add a daily job (reuse existing cron pattern) that calls `ContractRegistryService.regenerateAlertsForBusiness` for active contracts and creates/updates `ContractAlert` rows.
- Keep it lightweight; notification emission can be a follow-up.

### 5. Frontend
- New API client: `apps/web/src/lib/api/contracts.ts`.
- New page: `apps/web/src/app/app/contracts/page.tsx`
  - Stats strip (active, expiring soon, expired, renewal due).
  - Filterable list/table of contracts with status, expiry, tags, alert badges.
  - Side-sheet detail showing terms, alerts, linked files, version timeline.
  - Actions: extract terms, edit tags/status/retention, acknowledge alerts.
- Update `nav-config.ts`:
  - Add "Contracts" under Governance or Intelligence section (suggest Governance, next to Legal).
- Update `/app/document-intelligence` to include a "Contract Registry" card/link.

### 6. Tests
- Unit tests for `ContractRegistryService` (mocked Prisma + document intelligence).
- Controller spec for `ContractRegistryController`.
- Frontend typecheck and build.
- Server `typecheck`, `test:unit --run`, and build.

### 7. Migration command
```bash
npx prisma migrate dev --name contract_registry_terms_alerts --schema packages/db/prisma/schema.prisma
```

## Success criteria
- `pnpm --filter server typecheck` ✅
- `pnpm --filter server test:unit --run` ✅
- `pnpm --filter web typecheck` ✅
- `pnpm --filter web build` ✅
- Contract CRUD, AI extraction, and alert endpoints return correct data in local smoke test.

## Open questions for the user
1. **Approach:** A (lightweight, recommended), B (canonical new domain), or C (document-centric)?
2. **Scope:** Should the first version support manual contract creation, or only AI-extracted/uploaded contracts?
3. **Alerts:** Should alerts be in-app only for now, or should we also emit notification events?
