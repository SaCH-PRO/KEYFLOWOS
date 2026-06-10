-- Finance OS: Control Layer
-- Adds bank rules, recurring journals, credit notes, period close, bank feeds,
-- exchange rates, fixed asset register, expense split items, and Continental Ops.

-- Pattern-based auto-categorization for imported bank transactions.
CREATE TABLE "bank_rules" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "pattern" TEXT NOT NULL,
    "match_type" TEXT NOT NULL DEFAULT 'contains',
    "account_id" TEXT NOT NULL,
    "expense_category_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_rules_pkey" PRIMARY KEY ("id")
);

-- Scheduled double-entry journal entries.
CREATE TABLE "recurring_journal_entries" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "frequency" TEXT NOT NULL,
    "next_run_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "entries" JSONB NOT NULL,
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "last_run_date" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_journal_entries_pkey" PRIMARY KEY ("id")
);

-- Formal credit memos against invoices.
CREATE TABLE "credit_notes" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "credit_note_number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "amount" DECIMAL(18,4) NOT NULL,
    "reason" TEXT,
    "items" JSONB,
    "applied_at" TIMESTAMP(3),
    "voided_at" TIMESTAMP(3),
    "reversal_transaction_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- Formal accounting period buckets with close locking.
CREATE TABLE "accounting_periods" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMP(3),
    "closed_by_id" TEXT,
    "locked_transaction_stamp" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_periods_pkey" PRIMARY KEY ("id")
);

-- Live bank feed connections (Plaid / Yodlee / open banking).
CREATE TABLE "bank_connections" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "financial_account_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_item_id" TEXT,
    "access_token" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "last_sync_at" TIMESTAMP(3),
    "last_sync_cursor" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_connections_pkey" PRIMARY KEY ("id")
);

-- Daily FX rates for multi-currency revaluation.
CREATE TABLE "exchange_rates" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "from_currency" TEXT NOT NULL,
    "to_currency" TEXT NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "date" DATE NOT NULL,
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- Fixed asset register with depreciation tracking.
CREATE TABLE "fixed_assets" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "purchase_date" TIMESTAMP(3) NOT NULL,
    "purchase_cost" DECIMAL(18,4) NOT NULL,
    "salvage_value" DECIMAL(18,4),
    "useful_life_months" INTEGER NOT NULL,
    "depreciation_method" TEXT NOT NULL DEFAULT 'straight_line',
    "accumulated_depreciation" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "net_book_value" DECIMAL(18,4) NOT NULL,
    "disposal_date" TIMESTAMP(3),
    "disposal_proceeds" DECIMAL(18,4),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

-- Delivery Notes — authorize release of goods from inventory.
CREATE TABLE "delivery_notes" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "dn_number" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "delivered_at" TIMESTAMP(3),
    "deliverer_name" TEXT,
    "deliverer_signature" TEXT,
    "receiver_name" TEXT,
    "receiver_signature" TEXT,
    "notes" TEXT,
    "items" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_notes_pkey" PRIMARY KEY ("id")
);

-- Goods Receipts — physical receipt of inventory with qty check.
CREATE TABLE "goods_receipts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "gr_number" TEXT NOT NULL,
    "purchase_order_id" TEXT,
    "supplier_name" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_by" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "items" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- Stock Counts — physical count with variance audit.
CREATE TABLE "stock_counts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "count_number" TEXT NOT NULL,
    "count_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "counted_by" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "notes" TEXT,
    "items" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- Receipts — formal payment receipt documents.
CREATE TABLE "receipts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "payment_method" TEXT NOT NULL,
    "received_from" TEXT,
    "received_by" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
CREATE UNIQUE INDEX "bank_rules_business_id_key" ON "bank_rules"("business_id", "name");
CREATE UNIQUE INDEX "credit_notes_business_id_credit_note_number_key" ON "credit_notes"("business_id", "credit_note_number");
CREATE UNIQUE INDEX "accounting_periods_business_id_year_month_key" ON "accounting_periods"("business_id", "year", "month");
CREATE UNIQUE INDEX "exchange_rates_business_id_from_currency_to_currency_date_key" ON "exchange_rates"("business_id", "from_currency", "to_currency", "date");
CREATE UNIQUE INDEX "delivery_notes_business_id_dn_number_key" ON "delivery_notes"("business_id", "dn_number");
CREATE UNIQUE INDEX "goods_receipts_business_id_gr_number_key" ON "goods_receipts"("business_id", "gr_number");
CREATE UNIQUE INDEX "stock_counts_business_id_count_number_key" ON "stock_counts"("business_id", "count_number");
CREATE UNIQUE INDEX "receipts_business_id_receipt_number_key" ON "receipts"("business_id", "receipt_number");

-- Indexes
CREATE INDEX "bank_rules_business_id_idx" ON "bank_rules"("business_id");
CREATE INDEX "bank_rules_business_id_is_active_idx" ON "bank_rules"("business_id", "is_active");
CREATE INDEX "bank_rules_business_id_priority_idx" ON "bank_rules"("business_id", "priority");

CREATE INDEX "recurring_journal_entries_business_id_idx" ON "recurring_journal_entries"("business_id");
CREATE INDEX "recurring_journal_entries_business_id_is_active_idx" ON "recurring_journal_entries"("business_id", "is_active");
CREATE INDEX "recurring_journal_entries_business_id_next_run_date_idx" ON "recurring_journal_entries"("business_id", "next_run_date");

CREATE INDEX "credit_notes_business_id_idx" ON "credit_notes"("business_id");
CREATE INDEX "credit_notes_business_id_invoice_id_idx" ON "credit_notes"("business_id", "invoice_id");
CREATE INDEX "credit_notes_business_id_status_idx" ON "credit_notes"("business_id", "status");

CREATE INDEX "accounting_periods_business_id_status_idx" ON "accounting_periods"("business_id", "status");

CREATE INDEX "bank_connections_business_id_idx" ON "bank_connections"("business_id");
CREATE INDEX "bank_connections_business_id_status_idx" ON "bank_connections"("business_id", "status");
CREATE INDEX "bank_connections_business_id_financial_account_id_idx" ON "bank_connections"("business_id", "financial_account_id");

CREATE INDEX "exchange_rates_business_id_from_currency_to_currency_idx" ON "exchange_rates"("business_id", "from_currency", "to_currency");

CREATE INDEX "fixed_assets_business_id_idx" ON "fixed_assets"("business_id");
CREATE INDEX "fixed_assets_business_id_status_idx" ON "fixed_assets"("business_id", "status");

CREATE INDEX "delivery_notes_business_id_idx" ON "delivery_notes"("business_id");
CREATE INDEX "delivery_notes_business_id_invoice_id_idx" ON "delivery_notes"("business_id", "invoice_id");
CREATE INDEX "delivery_notes_business_id_status_idx" ON "delivery_notes"("business_id", "status");

CREATE INDEX "goods_receipts_business_id_idx" ON "goods_receipts"("business_id");
CREATE INDEX "goods_receipts_business_id_purchase_order_id_idx" ON "goods_receipts"("business_id", "purchase_order_id");
CREATE INDEX "goods_receipts_business_id_status_idx" ON "goods_receipts"("business_id", "status");

CREATE INDEX "stock_counts_business_id_idx" ON "stock_counts"("business_id");
CREATE INDEX "stock_counts_business_id_status_idx" ON "stock_counts"("business_id", "status");

CREATE INDEX "receipts_business_id_idx" ON "receipts"("business_id");
CREATE INDEX "receipts_business_id_invoice_id_idx" ON "receipts"("business_id", "invoice_id");

-- Foreign keys
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "chart_of_accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_expense_category_id_fkey" FOREIGN KEY ("expense_category_id") REFERENCES "expense_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "recurring_journal_entries" ADD CONSTRAINT "recurring_journal_entries_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_financial_account_id_fkey" FOREIGN KEY ("financial_account_id") REFERENCES "financial_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "receipts" ADD CONSTRAINT "receipts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Expense split items support
ALTER TABLE "expenses" ADD COLUMN "items" JSONB;
