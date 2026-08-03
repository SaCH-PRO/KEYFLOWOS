-- CreateTable
CREATE TABLE "business_autonomy_profiles" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "global_kill_switch" BOOLEAN NOT NULL DEFAULT false,
    "max_daily_auto_actions" INTEGER NOT NULL DEFAULT 10,
    "max_daily_spend_ttd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notify_on_block" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_autonomy_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_autonomy_profiles_business_id_key" ON "business_autonomy_profiles"("business_id");

-- CreateIndex
CREATE INDEX "business_autonomy_profiles_business_id_idx" ON "business_autonomy_profiles"("business_id");

-- AddForeignKey
ALTER TABLE "business_autonomy_profiles" ADD CONSTRAINT "business_autonomy_profiles_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "autonomy_daily_spends" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount_ttd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TTD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "autonomy_daily_spends_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "autonomy_daily_spends_business_id_date_currency_key" ON "autonomy_daily_spends"("business_id", "date", "currency");

-- CreateIndex
CREATE INDEX "autonomy_daily_spends_business_id_date_idx" ON "autonomy_daily_spends"("business_id", "date");

-- AddForeignKey
ALTER TABLE "autonomy_daily_spends" ADD CONSTRAINT "autonomy_daily_spends_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "autonomy_daily_action_counts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "action_type" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "autonomy_daily_action_counts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "autonomy_daily_action_counts_business_id_date_action_type_key" ON "autonomy_daily_action_counts"("business_id", "date", "action_type");

-- CreateIndex
CREATE INDEX "autonomy_daily_action_counts_business_id_date_idx" ON "autonomy_daily_action_counts"("business_id", "date");

-- AddForeignKey
ALTER TABLE "autonomy_daily_action_counts" ADD CONSTRAINT "autonomy_daily_action_counts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
