"use client";

import { useState } from "react";
import { setStoredBusinessId } from "@/lib/workspace";
import { notFound } from "next/navigation";
import { ExpenseFormSideSheet } from "@/app/app/expenses/components/expense-form-sidesheet";

/**
 * Test-only fixture for the receipt-upload flow inside `ExpenseFormSideSheet`, the expense form production mounts
 * (the Expenses page and the expense detail page). EXPENSES-HUB-3 R22: it mounted `ExpenseFormModal`, which had no
 * production mount and is retired.
 *
 * The sheet uploads through `useUpload` (presign, then PUT) and writes the resulting path into the form's
 * `receiptUrl` field. This fixture mounts the real sheet so the Playwright spec can drive the receipt input end to
 * end. The sheet offers two file inputs: Take photo (camera capture) and Upload file.
 *
 * Only available outside production builds.
 */
export const TEST_BUSINESS_ID = "biz_e2e_expense_fixture";

export default function E2EExpenseReceiptUploadFixturePage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  // EXPENSES-HUB-3 R18-3: the form writes and uploads only for the business the workspace has chosen: this one.
  useState(() => {
    setStoredBusinessId(TEST_BUSINESS_ID);
    return true;
  });
  const [closed, setClosed] = useState(false);
  const [saved, setSaved] = useState(false);

  if (closed) {
    return (
      <main style={{ padding: 24 }}>
        <p data-testid="modal-closed">closed</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 24 }}>
      <h1 data-testid="fixture-title">__e2e: expense receipt fixture</h1>
      <p data-testid="business-id">{TEST_BUSINESS_ID}</p>
      <p data-testid="saved-flag">{saved ? "saved" : "(not saved)"}</p>
      <ExpenseFormSideSheet
        businessId={TEST_BUSINESS_ID}
        categories={[]}
        editingExpense={null}
        projects={[]}
        contacts={[]}
        services={[]}
        onClose={() => setClosed(true)}
        onSaved={() => setSaved(true)}
      />
    </main>
  );
}
