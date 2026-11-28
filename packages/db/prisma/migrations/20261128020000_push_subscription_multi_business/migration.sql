-- P242 FU-PUSH-MULTI-BUSINESS (D-319 / Q45):
-- Allow one browser device endpoint to hold push subscriptions for multiple
-- businesses owned/used by the same member, instead of globally capping
-- PushSubscription.endpoint to one business (the last subscribed).
-- Existing single-endpoint rows remain valid under (business_id, endpoint).
DROP INDEX IF EXISTS "push_subscriptions_endpoint_key";
CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_business_id_endpoint_key" ON "push_subscriptions"("business_id", "endpoint");
CREATE INDEX IF NOT EXISTS "push_subscriptions_endpoint_idx" ON "push_subscriptions"("endpoint");
