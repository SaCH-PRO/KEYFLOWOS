-- KF-EXEC-TENANT-001
-- Flow-run idempotency belongs to a tenant. The previous global unique index
-- prevented two businesses from legitimately reusing the same idempotency key.
DROP INDEX IF EXISTS "flow_runs_idempotency_key_key";

CREATE UNIQUE INDEX "flow_runs_business_id_idempotency_key_key"
  ON "flow_runs"("business_id", "idempotency_key");
