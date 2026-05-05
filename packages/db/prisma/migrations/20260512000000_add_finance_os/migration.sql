Loaded Prisma config from prisma.config.ts.

-- AlterTable
ALTER TABLE "expense_categories" ADD COLUMN     "chart_of_account_id" TEXT;

-- CreateTable
CREATE TABLE "financial_accounts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "chart_of_account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subtype" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "opening_balance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "current_balance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "institution" TEXT,
    "account_last4" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chart_of_accounts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subtype" TEXT,
    "system_key" TEXT,
    "parent_id" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chart_of_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_transactions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "contact_id" TEXT,
    "source_type" TEXT,
    "source_id" TEXT,
    "external_ref" TEXT,
    "reversal_of_id" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "posted_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "debit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "date" TIMESTAMP(3) NOT NULL,
    "memo" TEXT,
    "locked_by_reconciliation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "reference" TEXT,
    "matched_transaction_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNMATCHED',
    "rawData" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliations" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "statement_balance" DECIMAL(18,4) NOT NULL,
    "system_balance" DECIMAL(18,4) NOT NULL,
    "difference" DECIMAL(18,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "completed_at" TIMESTAMP(3),
    "completed_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_liabilities" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "taxable_sales" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax_collected" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax_paid" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amount_due" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "due_date" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_liabilities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "financial_accounts_business_id_idx" ON "financial_accounts"("business_id");

-- CreateIndex
CREATE INDEX "financial_accounts_business_id_type_idx" ON "financial_accounts"("business_id", "type");

-- CreateIndex
CREATE INDEX "financial_accounts_business_id_is_active_idx" ON "financial_accounts"("business_id", "is_active");

-- CreateIndex
CREATE INDEX "financial_accounts_business_id_chart_of_account_id_idx" ON "financial_accounts"("business_id", "chart_of_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_accounts_business_id_name_key" ON "financial_accounts"("business_id", "name");

-- CreateIndex
CREATE INDEX "chart_of_accounts_business_id_idx" ON "chart_of_accounts"("business_id");

-- CreateIndex
CREATE INDEX "chart_of_accounts_business_id_type_idx" ON "chart_of_accounts"("business_id", "type");

-- CreateIndex
CREATE INDEX "chart_of_accounts_business_id_parent_id_idx" ON "chart_of_accounts"("business_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "chart_of_accounts_business_id_system_key_key" ON "chart_of_accounts"("business_id", "system_key");

-- CreateIndex
CREATE UNIQUE INDEX "financial_transactions_reversal_of_id_key" ON "financial_transactions"("reversal_of_id");

-- CreateIndex
CREATE INDEX "financial_transactions_business_id_date_idx" ON "financial_transactions"("business_id", "date");

-- CreateIndex
CREATE INDEX "financial_transactions_business_id_source_type_source_id_idx" ON "financial_transactions"("business_id", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "financial_transactions_business_id_type_idx" ON "financial_transactions"("business_id", "type");

-- CreateIndex
CREATE INDEX "financial_transactions_business_id_contact_id_idx" ON "financial_transactions"("business_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_transactions_business_id_external_ref_key" ON "financial_transactions"("business_id", "external_ref");

-- CreateIndex
CREATE INDEX "ledger_entries_business_id_date_idx" ON "ledger_entries"("business_id", "date");

-- CreateIndex
CREATE INDEX "ledger_entries_business_id_account_id_date_idx" ON "ledger_entries"("business_id", "account_id", "date");

-- CreateIndex
CREATE INDEX "ledger_entries_transaction_id_idx" ON "ledger_entries"("transaction_id");

-- CreateIndex
CREATE INDEX "ledger_entries_locked_by_reconciliation_id_idx" ON "ledger_entries"("locked_by_reconciliation_id");

-- CreateIndex
CREATE INDEX "bank_transactions_business_id_account_id_date_idx" ON "bank_transactions"("business_id", "account_id", "date");

-- CreateIndex
CREATE INDEX "bank_transactions_business_id_status_idx" ON "bank_transactions"("business_id", "status");

-- CreateIndex
CREATE INDEX "bank_transactions_business_id_account_id_status_idx" ON "bank_transactions"("business_id", "account_id", "status");

-- CreateIndex
CREATE INDEX "reconciliations_business_id_account_id_period_end_idx" ON "reconciliations"("business_id", "account_id", "period_end");

-- CreateIndex
CREATE INDEX "reconciliations_business_id_status_idx" ON "reconciliations"("business_id", "status");

-- CreateIndex
CREATE INDEX "tax_liabilities_business_id_status_idx" ON "tax_liabilities"("business_id", "status");

-- CreateIndex
CREATE INDEX "tax_liabilities_business_id_type_period_end_idx" ON "tax_liabilities"("business_id", "type", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "tax_liabilities_business_id_type_period_start_period_end_key" ON "tax_liabilities"("business_id", "type", "period_start", "period_end");

-- CreateIndex
CREATE INDEX "expense_categories_business_id_chart_of_account_id_idx" ON "expense_categories"("business_id", "chart_of_account_id");

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_chart_of_account_id_fkey" FOREIGN KEY ("chart_of_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_chart_of_account_id_fkey" FOREIGN KEY ("chart_of_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "chart_of_accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "financial_transactions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "financial_transactions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "chart_of_accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_liabilities" ADD CONSTRAINT "tax_liabilities_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

