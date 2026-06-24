-- WebhookEvent dedup table: stores (provider, providerEventId) for every
-- payment-provider webhook we accept, so re-deliveries (Stripe retries,
-- PayPal repeats, WiPay duplicate callbacks) are silently ignored at the
-- ingestion layer instead of relying on per-row payment uniqueness.
CREATE TABLE IF NOT EXISTS "webhook_events" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "provider_event_id" TEXT NOT NULL,
  "event_type" TEXT,
  "business_id" TEXT,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "webhook_events_provider_provider_event_id_key"
  ON "webhook_events"("provider", "provider_event_id");

CREATE INDEX IF NOT EXISTS "webhook_events_business_id_received_at_idx"
  ON "webhook_events"("business_id", "received_at");
