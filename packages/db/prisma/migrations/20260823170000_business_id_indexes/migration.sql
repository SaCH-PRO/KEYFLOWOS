-- Three models carried `businessId` with no index able to serve a lookup on it.
--
-- The other seven models that a naive "has businessId but no @@index" scan
-- reports are already covered and are deliberately NOT touched here:
--   MarketStrategy, DriveSyncCursor, Site  -- businessId is inline @unique
--   GenomeOutcomeLearningWindow, BusinessTemplateUsage, BotConversationState
--                                          -- @@unique whose LEADING column is businessId
--   Cohort                                 -- platform-global; no query filters it by businessId
-- Adding redundant indexes there would cost write throughput on every insert
-- and update while serving no read.

-- CourseEnrollment: @@unique([courseId, businessId]) leads with courseId, so it
-- cannot serve education.service.ts `findMany({ where: { businessId } })`.
CREATE INDEX "course_enrollments_business_id_idx" ON "course_enrollments"("business_id");

-- CohortMember: @@unique([cohortId, businessId]) leads with cohortId, so it
-- cannot serve community.service.ts `findMany({ where: { businessId } })`.
CREATE INDEX "cohort_members_business_id_idx" ON "cohort_members"("business_id");

-- Webhook: had no index of any kind, and webhook-dispatcher.service.ts runs
-- `where { businessId, isActive, events }` once per outbound event.
CREATE INDEX "webhooks_business_id_is_active_idx" ON "webhooks"("business_id", "is_active");
