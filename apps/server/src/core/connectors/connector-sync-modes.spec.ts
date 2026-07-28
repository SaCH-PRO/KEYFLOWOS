import { describe, it, expect } from 'vitest';
import {
  CONNECTOR_SYNC_MODES,
  REGISTERED_CONNECTOR_TYPES,
  getSyncModes,
  ConnectorSyncMode,
} from './connector-sync-modes';

describe('connector sync-mode classification', () => {
  it('classifies every registered connector with at least one mode + a note', () => {
    for (const t of REGISTERED_CONNECTOR_TYPES) {
      const c = CONNECTOR_SYNC_MODES[t];
      expect(c, `missing classification for ${t}`).toBeDefined();
      expect(c.modes.length, `no modes for ${t}`).toBeGreaterThan(0);
      expect(c.note.length).toBeGreaterThan(0);
    }
  });

  it('classifies exactly the 22 registered connectors (no gaps, no extras)', () => {
    expect(REGISTERED_CONNECTOR_TYPES.length).toBe(22);
    expect(Object.keys(CONNECTOR_SYNC_MODES).sort()).toEqual([...REGISTERED_CONNECTOR_TYPES].sort());
  });

  it('social connectors classify pull sync as UNSUPPORTED', () => {
    for (const t of ['meta_social', 'linkedin', 'twitter', 'tiktok'] as const) {
      expect(getSyncModes(t)).toContain(ConnectorSyncMode.UNSUPPORTED);
    }
  });

  it('flags the commerce/accounting/marketing silent-success family (pull NOT IMPLEMENTED)', () => {
    for (const t of ['stripe', 'paypal', 'wipay', 'quickbooks', 'xero', 'mailchimp', 'klaviyo'] as const) {
      expect(getSyncModes(t)).toEqual([ConnectorSyncMode.STATUS_ONLY]);
      expect(CONNECTOR_SYNC_MODES[t].note).toMatch(/NOT IMPLEMENTED/);
    }
  });

  it('webhook-form connectors are WEBHOOK_INGEST only', () => {
    for (const t of ['typeform', 'jotform', 'webhook_form'] as const) {
      expect(getSyncModes(t)).toEqual([ConnectorSyncMode.WEBHOOK_INGEST]);
    }
  });
});
