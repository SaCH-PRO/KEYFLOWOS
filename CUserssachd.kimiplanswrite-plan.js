const fs = require('fs');
const path = 'C:\Users\sachd\.kimi\plans\speed-liberty-belle-kid-flash.md';
const content = `# KeyflowOS Monorepo — Core Systems Read-Only Audit Report

**Branch:** \`develop\`  
**Commit:** \`e256d216\` (Wave 7: Frontend Polish — Contact Header)  
**Auditor:** Code Exploration Agent  
**Date:** 2026-05-12

---

## 1. Business Blueprint
**Paths:** \`apps/server/src/modules/blueprint/\`, \`apps/web/src/app/app/blueprint/\`

### COMPLETE
- **All 10 sections fully editable and persisted**
  - Frontend: \`apps/web/src/app/app/blueprint/page.tsx\` (lines 206-811) — renders editable forms for all 10 sections: identity, operatingModel, goals, constraints, brand, customerModel, financials, intelligence, workflowModel, aiPreferences.
  - Backend: \`apps/server/src/modules/blueprint/blueprint.service.ts\` (lines 21-32) defines SECTION_KEYS with all 10 sections; updateBlueprint() (lines 94-141) shallow-merges and persists each section via Prisma.
  - Types: \`apps/server/src/modules/blueprint/blueprint.types.ts\` (lines 16-157) defines full type contract for all sections.

- **Recommended setup steps link correctly**
  - \`blueprint.service.ts:345-408\` generates RecommendedSetupStep with href: /app/blueprint#{key}.
  - \`page.tsx:361-363\` renders anchor links that jump to <section id="{key}"> targets.

### PARTIAL
- **inferFromEvents is NOT comprehensive**
  - \`blueprint.service.ts:224-297\` is explicitly documented as a "Stub for infer from events — full inference lands once the timeline ledger is in place."
  - Currently only infers: topProductCategories (from products), monthlyRevenue (from paid invoices), bookingCount, projectCount (from open tasks — bug: uses contactTask instead of project), ecommerceOrders (from invoice count), walkInCount (hardcoded 0), retainerInvoices, topChannels (from Activity module groupBy), activityCount.
  - Missing: expense patterns, booking no-show rates, quote conversion rates, marketing campaign performance, seasonal revenue patterns, customer segment drift.

---

## 2. Commerce Engine
**Paths:** \`apps/server/src/modules/commerce/\`, \`apps/web/src/app/app/commerce/\`

### COMPLETE
- **Cost profile API (backend)**
  - \`commerce.controller.ts:128-230\` — GET /cost-profile computes grossMargin, marginBand, landedCost. PATCH /cost-profile upserts ProductCostProfile and creates MarginSnapshot history.

- **Document template API (backend)**
  - \`commerce.controller.ts:369-405\` — GET /document-templates returns classic/modern/minimal for invoices/quotes. PATCH persists selection to Business row.

### PARTIAL
- **Document template picker NOT wired to commerce flows**
  - \`apps/web/src/app/app/commerce/components/invoice-templates/template-picker.tsx\` exists but is only used in the standalone /app/commerce/templates page. It is NOT integrated into the invoice creation flow (commerce/page.tsx or billing panels) — users cannot pick a template when creating/sending an invoice.

### MISSING
- **Cost profile UI for editing**
  - \`apps/web/src/app/app/commerce/products/product-detail-panel.tsx:462-485\` only displays gross margin and landed cost as read-only StatCards. There is NO form to edit sourceCost, shippingEstimate, dutiesEstimate, packagingCost, or transactionCost.
  - The updateProductCostProfile client helper exists in lib/client.ts:12892 but is never invoked from any UI component.

- **Gross margin NOT shown in product lists**
  - products-panel.tsx (list/grid views) and product-card.tsx show price, category, SKU, and duration — but no margin indicator, margin band badge, or landed cost.

---

## 3. Advanced Contacts
**Paths:** \`apps/server/src/modules/crm/\`, \`apps/web/src/app/app/crm/contacts/\`

### COMPLETE
- **All 9 tabs exist with real functionality**
  - \`apps/web/src/app/app/crm/contacts/[contactId]/layout.tsx:18-28\` defines: Overview, Timeline, Money, Bookings, Quotes & Invoices, Tasks, Notes, AI Insights, Recommendations.
  - Each tab has its own page.tsx with live data fetching and interactive features (add/delete tasks, add/delete notes, view invoices/quotes, view bookings, view timeline events, view AI insights, view recommendations).

### PARTIAL
- **Contact filter controls for revenue/risk/opportunity**
  - Backend filters exist in \`apps/server/src/modules/crm/contact-filters.helper.ts\` and \`crm.service.ts:42-88\` (ContactListOptions includes hasUnpaidInvoices, hasUpcomingBookings, hasOpenDeals, staleDays, relationshipHealth, bestChannels, etc.).
  - However, the frontend pipeline UI (apps/web/src/app/app/crm/pipeline/page.tsx and contacts-database.tsx) does NOT expose UI controls for revenue-based filtering (e.g., "lifetime value > $X"), risk-based filtering (e.g., "churn risk > 50%"), or opportunity-based filtering (e.g., "has open quotes"). Only basic text search, status, tags, and owner filters are visible.

- **14 intelligence fields not all displayed**
  - \`contact-insight.service.ts:34-59\` defines the ContactInsightPayload with ~12 fields: relationshipSummary, bestChannel, bestChannelConfidence, bestTimeWindow, dominantTopics, lifetimeValue, currency, openDeals, churnRisk, churnRiskReason, suggestedAction, lastInteractionAt, tags.
  - The Overview tab (overview/page.tsx:44-51) only displays 6 cards: Lifetime Value, Avg Spend, Payment Reliability, Bookings, Cancellation Rate, Conversion Probability.
  - Missing from Overview: bestChannel, bestTimeWindow, dominantTopics, openDeals count/value, churnRisk, suggestedAction, relationshipSummary. Some of these appear in the AI Insights tab, but not all 14 are visible across both tabs.

---

## 4. Timeline / Event Ledger
**Paths:** \`apps/server/src/modules/timeline/\`, \`apps/web/src/components/timeline/\`

### COMPLETE
- **Activity querying exposed via API**
  - \`timeline.controller.ts:13-22\` — GET /timeline/businesses/:businessId/events with QueryTimelineDto filters (category, contactId, entityType, actorType, date range, etc.).
  - \`timeline.controller.ts:24-29\` — day summary endpoint.
  - \`timeline.controller.ts:31-36\` — upcoming actions endpoint.

- **BusinessTimeline component used on cockpit/dashboard**
  - \`apps/web/src/app/app/keyflow-command/page.tsx:342-344\` — <BusinessTimeline businessId={d.businessId} compact limit={30} /> is rendered inside a card.
  - Component source: \`apps/web/src/components/timeline/business-timeline.tsx\` (full implementation with module filters, grouping, relative time, expand/collapse).

### PARTIAL
- **Not all modules log events consistently**
  - Log consistently: CRM (crm.service.ts, crm-timeline.service.ts), Commerce (commerce.service.ts emits contact events + invoice/quote state changes), Bookings (bookings.service.ts), Procurement (procurement.service.ts:46-62, 100-117, 136-152), AI (key-command.service.ts:198-214), Public Events (public-events.service.ts).
  - Missing or incomplete: Projects module, Expenses module, Finance module (revenue-posting), and Marketing/Sequences do NOT appear to call TimelineService.recordEvent() directly. They may emit domain events that listeners catch, but direct timeline integration is not visible.

---

## 5. KEY AI Orchestrator
**Paths:** \`apps/server/src/modules/ai/\`, \`apps/web/src/app/app/control-tower/\`

### COMPLETE
- **4 modes exist in backend**
  - \`apps/server/src/modules/ai/key-command.service.ts:6-11\` defines KeyMode enum: ASK, DO, PLAN, AUTO.
  - \`apps/server/src/modules/ai/ai.controller.ts:942-975\` — POST /key/command accepts mode parameter and routes: do/auto -> generateDoItForMe, plan -> returns plan without executing, ask -> executes low-risk plans.

- **DoItForMePanel shows real data from generateDoItForMe**
  - \`apps/web/src/app/app/control-tower/components/do-it-for-me-panel.tsx:50-68\` calls POST /ai/businesses/{id}/key/command with rawInput.
  - \`key-command.service.ts:221-435\` — generateDoItForMe() queries real Prisma data: stale contacts, overdue invoices, pending bookings, sent quotes, recent customers, open tasks. Returns actual findings and suggested actions with contact names and expected values.

- **Approval queue resol
