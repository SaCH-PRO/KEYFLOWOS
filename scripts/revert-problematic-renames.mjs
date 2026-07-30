/**
 * Dev-only helper: revert specific identifier renames that broke TypeScript.
 *
 * NEVER run this in production.
 */
import { readFileSync, writeFileSync } from "fs";

const reverts = [
  { file: "apps/web/src/app/app/crm/pipeline/page.tsx", from: "_businessId", to: "businessId" },
  { file: "apps/web/src/app/app/expenses/components/expense-pipeline.tsx", from: "_filterCategory", to: "filterCategory" },
  { file: "apps/web/src/app/app/expenses/components/expense-pipeline.tsx", from: "_setFilterCategory", to: "setFilterCategory" },
  { file: "apps/web/src/app/app/expenses/components/expense-pipeline.tsx", from: "_filterPayment", to: "filterPayment" },
  { file: "apps/web/src/app/app/expenses/components/expense-pipeline.tsx", from: "_setFilterPayment", to: "setFilterPayment" },
  { file: "apps/web/src/app/app/expenses/components/expense-pipeline.tsx", from: "_filterStatus", to: "filterStatus" },
  { file: "apps/web/src/app/app/expenses/components/expense-pipeline.tsx", from: "_setPageSize", to: "setPageSize" },
  { file: "apps/web/src/app/app/finance/components/finance-pipeline.tsx", from: "_contacts", to: "contacts" },
  { file: "apps/web/src/app/app/finance/components/records/record-card.tsx", from: "_compact", to: "compact" },
  { file: "apps/web/src/app/app/finance/components/revenue-composer.tsx", from: "_setEditingQuoteId", to: "setEditingQuoteId" },
  { file: "apps/web/src/app/app/finance/components/revenue-composer.tsx", from: "_setEditingInvoiceId", to: "setEditingInvoiceId" },
  { file: "apps/web/src/app/app/finance/components/revenue-composer.tsx", from: "_handleNewInvoice", to: "handleNewInvoice" },
  { file: "apps/web/src/app/app/key-modes/components/key-mode-brief-panel.tsx", from: "_label", to: "label" },
  { file: "apps/web/src/app/app/profile/components/business-genome/key-genome-memory-panel.tsx", from: "_onGenomeUpdate", to: "onGenomeUpdate" },
  { file: "apps/web/src/app/app/settings/ai/page.tsx", from: "_skills", to: "skills" },
  { file: "apps/web/src/components/layout/mobile-drawer.tsx", from: "_meNav", to: "meNav" },
];

for (const { file, from, to } of reverts) {
  const content = readFileSync(file, "utf8");
  const regex = new RegExp(`\\b${from}\\b`, "g");
  const updated = content.replace(regex, to);
  if (updated !== content) {
    writeFileSync(file, updated);
    console.log(`Reverted ${from} -> ${to} in ${file}`);
  }
}
