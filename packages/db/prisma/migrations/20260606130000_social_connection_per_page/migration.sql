-- Replace single (businessId, platform) unique with composite key that includes
-- platformId so multiple Facebook Pages / IG accounts can co-exist per business.

ALTER TABLE "social_connections" DROP CONSTRAINT IF EXISTS "social_connections_business_id_platform_key";

CREATE UNIQUE INDEX IF NOT EXISTS "social_connections_business_id_platform_platform_id_key"
  ON "social_connections" ("business_id", "platform", "platform_id");

CREATE INDEX IF NOT EXISTS "social_connections_business_id_platform_idx"
  ON "social_connections" ("business_id", "platform");
