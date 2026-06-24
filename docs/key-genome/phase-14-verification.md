# Phase 14 Customer / Sales / Revenue Genome Verification

Status: Complete

## Implemented

- Customer segment model (`GenomeCustomerSegment`) and service (`GenomeCustomerSegmentService`)
- Sales motion model (`GenomeSalesMotion`) and service (`GenomeSalesMotionService`)
- Customer/sales snapshot model (`GenomeCustomerSalesSnapshot`) and service (`CustomerSalesGenomeService`)
- Snapshot computation with revenue quality score, LTV/CAC ratio, churn/retention, conversion, and revenue concentration risks
- Customer/sales signal generation via existing `GenomeSignalService`
- Customer/sales recommendation generation via existing `GenomeRecommendationService`
- Memory events written through `GenomeMemoryService`
- Department recomputes for `SALES`, `CUSTOMER_SUCCESS`, `PRODUCT_SERVICE`, `CMO_MARKETING`, and `CFO_FINANCE`
- Controller endpoints under `/business-genome/businesses/:businessId/key-genome/customer-sales`
- Frontend API methods in `apps/web/src/lib/api/business-genome.ts`
- `KeyGenomeCustomerSalesPanel` with snapshot summary, segments/motions lists, add/delete forms, signals/recommendations actions
- `Customer & Sales` sub-tab in `BusinessGenomeTab`

## Verified

| Check | Command | Result |
|---|---|---|
| Server build | `pnpm --filter server build` | ✅ Pass |
| Customer/Sales service tests | `pnpm --filter server test customer-sales` | ✅ 8 passed |
| Customer segment service tests | `pnpm --filter server test genome-customer-segment` | ✅ 5 passed |
| Sales motion service tests | `pnpm --filter server test genome-sales-motion` | ✅ 4 passed |
| Controller tests | `pnpm --filter server test key-genome.controller` | ✅ 20 passed |
| Full server test suite | `pnpm --filter server test:ci` | ✅ 13 smoke tests passed |
| Web typecheck | `cd apps/web && npx tsc --noEmit` | ✅ Pass |
| Web build | `pnpm --filter web build` | ✅ 218 pages generated |
| Web lint | `pnpm --filter web lint` | ⚠️ Fails due to pre-existing unrelated lint debt; Phase 14 introduced no new lint errors |

## Notes

- Frontend delete routes use `apiDelete` and the import is `import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";`.
- UI uses native `<input>`, `<select>`, and `<label>` controls to avoid missing shadcn component dependencies.
- Phase 14 is strictly brain/intelligence: no outreach automation, email sending, CRM external sync, or autonomous sales execution.
