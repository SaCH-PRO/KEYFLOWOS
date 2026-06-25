-- CreateTable
CREATE TABLE IF NOT EXISTS "contact_read_states" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "last_read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_read_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "contact_read_states_business_id_user_id_contact_id_key"
    ON "contact_read_states"("business_id", "user_id", "contact_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contact_read_states_business_id_user_id_idx"
    ON "contact_read_states"("business_id", "user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contact_read_states_contact_id_idx"
    ON "contact_read_states"("contact_id");
