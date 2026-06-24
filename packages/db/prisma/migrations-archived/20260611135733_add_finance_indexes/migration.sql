-- Financial Flow performance indexes
-- Improves overview, aging, reconciliation, and tax aggregation queries.

CREATE INDEX IF NOT EXISTS "Invoice_businessId_status_paidAt_idx"
  ON "Invoice"("business_id", "status", "paid_at");

CREATE INDEX IF NOT EXISTS "Invoice_businessId_status_dueDate_idx"
  ON "Invoice"("business_id", "status", "due_date");

CREATE INDEX IF NOT EXISTS "Payment_businessId_status_createdAt_idx"
  ON "Payment"("business_id", "status", "created_at");

CREATE INDEX IF NOT EXISTS "Expense_businessId_date_status_idx"
  ON "Expense"("business_id", "date", "status");

CREATE INDEX IF NOT EXISTS "Expense_businessId_categoryId_date_idx"
  ON "Expense"("business_id", "category_id", "date");

CREATE INDEX IF NOT EXISTS "BankTransaction_matchedTransactionId_idx"
  ON "BankTransaction"("matched_transaction_id");

CREATE INDEX IF NOT EXISTS "TaxLiability_businessId_type_periodStart_periodEnd_non_amendment_idx"
  ON "TaxLiability"("business_id", "type", "period_start", "period_end")
  WHERE "is_amendment" = false;
