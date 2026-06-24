-- Remove the legacy Google Maps API key column on businesses (the
-- google_maps connector has been removed entirely).
ALTER TABLE "businesses" DROP COLUMN IF EXISTS "google_maps_api_key";

-- Clear any stored connector status / encrypted credentials for the
-- now-defunct google_maps connector type.
DELETE FROM "connector_statuses" WHERE "connector_type" = 'google_maps';
DELETE FROM "connector_activity_logs" WHERE "connector_type" = 'google_maps';
