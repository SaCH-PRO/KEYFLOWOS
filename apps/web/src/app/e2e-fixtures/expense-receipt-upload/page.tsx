"use client";

import { useState } from "react";
import { notFound } from "next/navigation";
import { ExpenseFormModal } from "@/app/app/expenses/components/expense-form-modal";

/**
 * Test-only fixture for the receipt-upload flow inside `ExpenseFormModal`.
 *
 * The modal re-implements the presigned-PUT handshake against
 * `/businesses/:id/uploads/request-url` (note: a *different* presign route
 * shape than the rest of the app — `{uploadUrl, publicUrl}` instead of
 * `{uploadURL, objectPath}`) and reads the resulting public URL into the
 * form's `receiptUrl` field. This fixture mounts the real modal so the
 * Playwright spec can drive the receipt input end-to-end.
 *
 * Only available outside production builds.
 */
export const TEST_BUSINESS_ID = "biz_e2e_expense_fixture";

export default function E2EExpenseReceiptUploadFixturePage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

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
      <ExpenseFormModal
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
