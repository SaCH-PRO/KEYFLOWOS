-- Add optional age group bucket field to contacts.
-- Values are constrained at the API/UI layer (see CONTACT_AGE_GROUPS).
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "age_group" TEXT;
