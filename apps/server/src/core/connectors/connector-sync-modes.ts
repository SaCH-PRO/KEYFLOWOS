/**
 * Connector sync-mode classification (Functional Completeness certification).
 *
 * Every registered connector is classified by how data actually flows, so
 * functional tests validate each connector against its real mechanism rather
 * than assuming every connector performs a provider pull. This is descriptive
 * of CURRENT behavior (verified by reading each connector), not aspirational.
 *
 * KEY SYSTEMIC FINDING (see docs/audits/connectors/functional-inventory.md):
 * almost every connector's `sync()` is a STATUS_ONLY refresh that counts LOCAL
 * rows and (until the social fix) reported them as `itemsSynced` with
 * `success:true` — misrepresenting a no-op as a successful provider sync. Real
 * ingestion happens in OAuth-callback and webhook services, not `sync()`.
 * Whether `sync()` SHOULD perform a provider pull is a pending design decision.
 */
import type { ConnectorType } from './connector.interface';

export enum ConnectorSyncMode {
  /** sync() pulls records from the provider into local storage. */
  PULL_SYNC = 'PULL_SYNC',
  /** Outbound: content is published/pushed to the provider. */
  PUSH_OR_PUBLISH = 'PUSH_OR_PUBLISH',
  /** Ingestion happens on the OAuth connect callback (backfill), not in sync(). */
  CALLBACK_INGEST = 'CALLBACK_INGEST',
  /** Ingestion happens via inbound provider webhooks, not in sync(). */
  WEBHOOK_INGEST = 'WEBHOOK_INGEST',
  /** sync() only refreshes/counts local state; it makes no provider call. */
  STATUS_ONLY = 'STATUS_ONLY',
  /** The operation is explicitly not supported by this connector. */
  UNSUPPORTED = 'UNSUPPORTED',
}

export interface ConnectorSyncClassification {
  modes: ConnectorSyncMode[];
  /** Honest note on the current sync() body and real ingestion path. */
  note: string;
}

/**
 * Classification for every registered connector (see connector-initializer).
 * `modes` lists all applicable mechanisms; the first is the primary data flow.
 */
export const CONNECTOR_SYNC_MODES: Record<ConnectorType, ConnectorSyncClassification> = {
  // ── Google OAuth ──────────────────────────────────────────────────────────
  gmail: { modes: [ConnectorSyncMode.CALLBACK_INGEST, ConnectorSyncMode.STATUS_ONLY], note: 'Ingest via gmail-ingestion.service on connect; sync() refreshes status only.' },
  google_calendar: { modes: [ConnectorSyncMode.PUSH_OR_PUBLISH, ConnectorSyncMode.STATUS_ONLY], note: 'Push bookings to Calendar in a dedicated method; sync() counts local bookings only.' },
  google_drive: { modes: [ConnectorSyncMode.CALLBACK_INGEST, ConnectorSyncMode.STATUS_ONLY], note: 'sync() counts local documentInstance rows; no provider pull.' },
  google_forms: { modes: [ConnectorSyncMode.WEBHOOK_INGEST, ConnectorSyncMode.CALLBACK_INGEST], note: 'Ingest via google-forms-ingestion; sync() refreshes status only.' },
  google_contacts: { modes: [ConnectorSyncMode.CALLBACK_INGEST, ConnectorSyncMode.STATUS_ONLY], note: 'sync() counts local google_contacts rows; no provider pull.' },
  google_business_profile: { modes: [ConnectorSyncMode.STATUS_ONLY], note: 'sync() returns itemsSynced:0; status refresh only.' },

  // ── Microsoft OAuth ───────────────────────────────────────────────────────
  outlook_contacts: { modes: [ConnectorSyncMode.CALLBACK_INGEST, ConnectorSyncMode.STATUS_ONLY], note: 'sync() counts local outlook_contacts rows; no provider pull.' },

  // ── Social (shared SocialPlatformConnector) ───────────────────────────────
  meta_social: { modes: [ConnectorSyncMode.WEBHOOK_INGEST, ConnectorSyncMode.PUSH_OR_PUBLISH, ConnectorSyncMode.UNSUPPORTED], note: 'Inbound via Meta webhook; outbound published; pull sync UNSUPPORTED (fixed).' },
  linkedin: { modes: [ConnectorSyncMode.PUSH_OR_PUBLISH, ConnectorSyncMode.UNSUPPORTED], note: 'Publish outbound; pull sync UNSUPPORTED via shared base (fixed).' },
  twitter: { modes: [ConnectorSyncMode.PUSH_OR_PUBLISH, ConnectorSyncMode.UNSUPPORTED], note: 'Publish outbound; pull sync UNSUPPORTED via shared base (fixed).' },
  tiktok: { modes: [ConnectorSyncMode.PUSH_OR_PUBLISH, ConnectorSyncMode.UNSUPPORTED], note: 'Publish outbound; pull sync UNSUPPORTED via shared base (fixed).' },

  // ── Webhook-form (shared FormPlatformConnector) ───────────────────────────
  typeform: { modes: [ConnectorSyncMode.WEBHOOK_INGEST], note: 'Per-business webhook secret; no sync() method.' },
  jotform: { modes: [ConnectorSyncMode.WEBHOOK_INGEST], note: 'Per-business webhook secret; no sync() method.' },
  webhook_form: { modes: [ConnectorSyncMode.WEBHOOK_INGEST], note: 'Generic inbound webhook; no sync() method.' },

  // ── Messaging ─────────────────────────────────────────────────────────────
  whatsapp: { modes: [ConnectorSyncMode.WEBHOOK_INGEST, ConnectorSyncMode.PUSH_OR_PUBLISH, ConnectorSyncMode.STATUS_ONLY], note: 'Inbound via WhatsApp webhook (idempotent); outbound send; sync() returns itemsSynced:0.' },

  // ── Commerce / Accounting / Marketing ─────────────────────────────────────
  // These have real provider clients but sync() currently counts local rows and
  // returned success:true (silent success). Pull sync is NOT IMPLEMENTED.
  stripe: { modes: [ConnectorSyncMode.STATUS_ONLY], note: 'sync() counts local payments; provider pull NOT IMPLEMENTED — fixed, now returns PULL_SYNC_NOT_IMPLEMENTED.' },
  paypal: { modes: [ConnectorSyncMode.STATUS_ONLY], note: 'sync() counts local payments; provider pull NOT IMPLEMENTED — fixed, now returns PULL_SYNC_NOT_IMPLEMENTED.' },
  wipay: { modes: [ConnectorSyncMode.STATUS_ONLY], note: 'sync() counts local payments; provider pull NOT IMPLEMENTED — fixed, now returns PULL_SYNC_NOT_IMPLEMENTED.' },
  quickbooks: { modes: [ConnectorSyncMode.STATUS_ONLY], note: 'sync() counts local invoices/payments/expenses; provider pull NOT IMPLEMENTED — fixed, now returns PULL_SYNC_NOT_IMPLEMENTED.' },
  xero: { modes: [ConnectorSyncMode.STATUS_ONLY], note: 'sync() counts local invoices/payments/expenses; provider pull NOT IMPLEMENTED — fixed, now returns PULL_SYNC_NOT_IMPLEMENTED.' },
  mailchimp: { modes: [ConnectorSyncMode.STATUS_ONLY], note: 'sync() counts local campaigns; provider pull NOT IMPLEMENTED — fixed, now returns PULL_SYNC_NOT_IMPLEMENTED.' },
  klaviyo: { modes: [ConnectorSyncMode.STATUS_ONLY], note: 'sync() counts local campaigns; provider pull NOT IMPLEMENTED — fixed, now returns PULL_SYNC_NOT_IMPLEMENTED.' },
} as Record<ConnectorType, ConnectorSyncClassification>;

/** The connectors registered by ConnectorInitializerService (source of truth for completeness). */
export const REGISTERED_CONNECTOR_TYPES: ConnectorType[] = [
  'gmail', 'google_calendar', 'google_drive', 'google_forms', 'google_contacts',
  'outlook_contacts', 'google_business_profile', 'whatsapp', 'meta_social',
  'paypal', 'wipay', 'stripe', 'quickbooks', 'xero', 'mailchimp', 'klaviyo',
  'linkedin', 'tiktok', 'twitter', 'typeform', 'jotform', 'webhook_form',
] as ConnectorType[];

export function getSyncModes(type: ConnectorType): ConnectorSyncMode[] {
  return CONNECTOR_SYNC_MODES[type]?.modes ?? [];
}
