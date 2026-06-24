-- FIN3 — Expense ledger integration: bills, recurring expenses,
-- purchase-order payment status.

-- AlterTable: Expense -> bill lifecycle + recurring link
ALTER TABLE "expenses" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PAID';
ALTER TABLE "expenses" ADD COLUMN "due_date" TIMESTAMP(3);
ALTER TABLE "expenses" ADD COLUMN "paid_at" TIMESTAMP(3);
ALTER TABLE "expenses" ADD COLUMN "recurring_expense_id" TEXT;

-- Backfill: existing rows are already paid (preserves prior behaviour).
UPDATE "expenses" SET "paid_at" = "date" WHERE "paid_at" IS NULL;

CREATE INDEX "expenses_business_id_status_due_date_idx" ON "expenses"("business_id", "status", "due_date");
CREATE INDEX "expenses_business_id_recurring_expense_id_idx" ON "expenses"("business_id", "recurring_expense_id");

-- AlterTable: PurchaseOrder -> payment lifecycle
ALTER TABLE "purchase_orders" ADD COLUMN "payment_status" TEXT NOT NULL DEFAULT 'UNPAID';
ALTER TABLE "purchase_orders" ADD COLUMN "po_paid_at" TIMESTAMP(3);

-- CreateTable: RecurringExpense (mirrors RecurringInvoice)
CREATE TABLE "recurring_expenses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "next_run_date" TIMESTAMP(3) NOT NULL,
    "last_run_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "last_failure_at" TIMESTAMP(3),
    "last_error" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "vendor" TEXT,
    "payment_method" TEXT,
    "notes" TEXT,
    "creates_bill" BOOLEAN NOT NULL DEFAULT false,
    "due_offset_days" INTEGER,
    "category_id" TEXT,
    "project_id" TEXT,
    "contact_id" TEXT,
    "service_id" TEXT,
    "business_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "recurring_expenses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "recurring_expenses_business_id_is_active_idx" ON "recurring_expenses"("business_id", "is_active");
CREATE INDEX "recurring_expenses_business_id_next_run_date_idx" ON "recurring_expenses"("business_id", "next_run_date");

-- AddForeignKey: Expense.recurring_expense_id -> recurring_expenses
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recurring_expense_id_fkey"
    FOREIGN KEY ("recurring_expense_id") REFERENCES "recurring_expenses"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: RecurringExpense -> Business / ExpenseCategory
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "expense_categories"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- One-shot ExpenseCategory → ChartOfAccounts mapping for every existing
-- row, mirroring ChartOfAccountsSeederService.EXPENSE_CATEGORY_NAME_MAP.
-- This guarantees every category is linked up-front so PostingService
-- doesn't have to fall back to lazy ensureDefaults() on first hit.
--
-- Pattern order matches the TS map: first match wins. We write each
-- update separately and AND on `chart_of_accounts_id IS NULL` so later
-- patterns never overwrite earlier ones, and re-running the migration
-- (e.g. via `prisma migrate resolve`) is a no-op.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  pattern RECORD;
BEGIN
  -- Skip silently when the column doesn't exist yet (older branches
  -- that haven't introduced ExpenseCategory.chart_of_accounts_id).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'expense_categories' AND column_name = 'chart_of_account_id'
  ) THEN
    RETURN;
  END IF;

  FOR pattern IN
    SELECT * FROM (VALUES
      ('market|advert|ads|promo|seo|content',                 'EXPENSE_MARKETING'),
      ('software|subscription|saas|license|tool',             'EXPENSE_SOFTWARE'),
      ('rent|utility|utilities|electric|water|internet|phone','EXPENSE_RENT'),
      ('payroll|salary|salaries|wage|contractor|freelanc',    'EXPENSE_PAYROLL'),
      ('office|supply|supplies|equipment|stationery',         'EXPENSE_OFFICE'),
      ('travel|transport|fuel|gas|mileage|flight|hotel',      'EXPENSE_TRAVEL'),
      ('professional|legal|accountant|consult',               'EXPENSE_PROFESSIONAL'),
      ('bank|fee|charge|processor|interchange',               'EXPENSE_BANK_FEES')
    ) AS t(re, system_key)
  LOOP
    EXECUTE format($f$
      UPDATE "expense_categories" ec
         SET "chart_of_account_id" = coa."id"
        FROM "chart_of_accounts" coa
       WHERE ec."chart_of_account_id" IS NULL
         AND coa."business_id" = ec."business_id"
         AND coa."system_key"  = %L
         AND ec."name" ~* %L
    $f$, pattern.system_key, pattern.re);
  END LOOP;

  -- Fallback: anything still unmapped goes to EXPENSE_GENERAL so the
  -- "every row mapped" guarantee holds for the whole table.
  UPDATE "expense_categories" ec
     SET "chart_of_account_id" = coa."id"
    FROM "chart_of_accounts" coa
   WHERE ec."chart_of_account_id" IS NULL
     AND coa."business_id" = ec."business_id"
     AND coa."system_key"  = 'EXPENSE_GENERAL';
END
$$;
