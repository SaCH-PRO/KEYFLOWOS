-- V1-17-DM-CONTACT-PARTIAL-UNIQUE (owner ruling D-16): a soft-deleted contact
-- releases its email and phone.
--
-- The contact identity uniques were full indexes on (business_id,
-- email_normalized) and (business_id, phone_normalized) with no deleted_at
-- term. A soft-deleted contact (DELETE, the duplicate of a merge, a GDPR forget
-- in its grace period) therefore kept its email and phone reserved, and the
-- business could not add that customer again: POST answered 409 with
-- existingContactId null, because no live contact holds the value (M12).
-- No application change can free that slot while the full index exists, and
-- Prisma has no syntax for a partial unique, so the fix lives here only, like
-- bank_transactions_account_external_id_key (20260808140000).
--
-- After it, two LIVE contacts of one business still cannot share an email or
-- a phone, and the database still decides that (CrmService maps the P2002 to
-- 409 contact_email_taken / contact_phone_taken). Un-deleting a contact whose
-- email or phone a live contact now holds is refused with the same P2002.
-- NULL never collides (Postgres unique semantics), as before.
--
-- The partial indexes are created before the full ones are dropped, so there is
-- no moment without a constraint. Existing rows cannot violate them: the full
-- uniques held over every row, so they hold over live rows. The duplicate scan
-- that proves it on any database (both queries must return no rows):
--   SELECT business_id, email_normalized, count(*) FROM contacts
--    WHERE deleted_at IS NULL AND email_normalized IS NOT NULL
--    GROUP BY 1, 2 HAVING count(*) > 1;
--   SELECT business_id, phone_normalized, count(*) FROM contacts
--    WHERE deleted_at IS NULL AND phone_normalized IS NOT NULL
--    GROUP BY 1, 2 HAVING count(*) > 1;
--
-- DRIFT GUARD. schema.prisma's Contact model no longer declares
-- @@unique([businessId, emailNormalized]) or @@unique([businessId,
-- phoneNormalized]) and names these two indexes in a comment. Prisma 6
-- does not read partial indexes: `prisma migrate diff --from-migrations ...
-- --to-schema-datamodel` is silent about them rather than confirming them.
-- Never put either @@unique back (the generated migration would re-create the
-- full index and bring M12 back), and never run `prisma migrate dev` against
-- this schema without `--create-only` and a review of the generated SQL: a
-- Prisma that learns to read partial indexes would propose dropping these.
-- The MIGRATE-001 drift gate must allowlist both names.

CREATE UNIQUE INDEX "contacts_business_id_email_normalized_live_key"
  ON "contacts" ("business_id", "email_normalized")
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX "contacts_business_id_phone_normalized_live_key"
  ON "contacts" ("business_id", "phone_normalized")
  WHERE "deleted_at" IS NULL;

DROP INDEX IF EXISTS "contacts_business_id_email_normalized_key";

DROP INDEX IF EXISTS "contacts_business_id_phone_normalized_key";
