-- CreateTable
CREATE TABLE "user_identities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_subject" TEXT NOT NULL,
    "email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risc_events" (
    "id" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "provider_subject" TEXT NOT NULL,
    "user_id" TEXT,
    "action_taken" TEXT NOT NULL,
    "payload" JSONB,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "risc_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_identities_user_id_idx" ON "user_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_provider_provider_subject_key" ON "user_identities"("provider", "provider_subject");

-- CreateIndex
CREATE UNIQUE INDEX "risc_events_jti_key" ON "risc_events"("jti");

-- CreateIndex
CREATE INDEX "risc_events_received_at_idx" ON "risc_events"("received_at");

-- CreateIndex
CREATE INDEX "risc_events_provider_subject_idx" ON "risc_events"("provider_subject");

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
