-- CreateTable
CREATE TABLE "booking_waitlist_entries" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "preferred_staff_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "preferred_date_from" TIMESTAMP(3),
    "preferred_date_to" TIMESTAMP(3),
    "preferred_time_of_day" TEXT,
    "notes" TEXT,
    "offered_booking_id" TEXT,
    "offered_at" TIMESTAMP(3),
    "converted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "booking_waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "booking_waitlist_entries_business_id_status_created_at_idx" ON "booking_waitlist_entries"("business_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "booking_waitlist_entries_business_id_service_id_status_idx" ON "booking_waitlist_entries"("business_id", "service_id", "status");

-- CreateIndex
CREATE INDEX "booking_waitlist_entries_business_id_contact_id_status_idx" ON "booking_waitlist_entries"("business_id", "contact_id", "status");

-- CreateIndex
CREATE INDEX "booking_waitlist_entries_business_id_preferred_staff_id_sta_idx" ON "booking_waitlist_entries"("business_id", "preferred_staff_id", "status");

-- AddForeignKey
ALTER TABLE "booking_waitlist_entries" ADD CONSTRAINT "booking_waitlist_entries_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_waitlist_entries" ADD CONSTRAINT "booking_waitlist_entries_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_waitlist_entries" ADD CONSTRAINT "booking_waitlist_entries_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_waitlist_entries" ADD CONSTRAINT "booking_waitlist_entries_preferred_staff_id_fkey" FOREIGN KEY ("preferred_staff_id") REFERENCES "staff_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_waitlist_entries" ADD CONSTRAINT "booking_waitlist_entries_offered_booking_id_fkey" FOREIGN KEY ("offered_booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
