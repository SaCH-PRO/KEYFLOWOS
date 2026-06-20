import { describe, expect, it } from 'vitest';
import { KEY_INBOX_CHANNELS, normalizeKeyInboxChannel } from './key-inbox.constants';

describe('key-inbox constants', () => {
  it('normalizes email aliases', () => {
    expect(normalizeKeyInboxChannel('gmail')).toBe(KEY_INBOX_CHANNELS.EMAIL);
    expect(normalizeKeyInboxChannel('email')).toBe(KEY_INBOX_CHANNELS.EMAIL);
  });

  it('normalizes google forms aliases', () => {
    expect(normalizeKeyInboxChannel('forms')).toBe(KEY_INBOX_CHANNELS.GOOGLE_FORMS);
    expect(normalizeKeyInboxChannel('google_forms')).toBe(KEY_INBOX_CHANNELS.GOOGLE_FORMS);
  });

  it('normalizes instagram to instagram_dm', () => {
    expect(normalizeKeyInboxChannel('instagram')).toBe(KEY_INBOX_CHANNELS.INSTAGRAM_DM);
  });

  it('normalizes messenger aliases to facebook_messenger', () => {
    expect(normalizeKeyInboxChannel('messenger')).toBe(KEY_INBOX_CHANNELS.FACEBOOK_MESSENGER);
    expect(normalizeKeyInboxChannel('meta_messenger')).toBe(KEY_INBOX_CHANNELS.FACEBOOK_MESSENGER);
  });

  it('normalizes unknown channels to manual', () => {
    expect(normalizeKeyInboxChannel('carrier_pigeon')).toBe(KEY_INBOX_CHANNELS.MANUAL);
    expect(normalizeKeyInboxChannel(null)).toBe(KEY_INBOX_CHANNELS.MANUAL);
  });

  it('preserves canonical channels', () => {
    expect(normalizeKeyInboxChannel('whatsapp')).toBe(KEY_INBOX_CHANNELS.WHATSAPP);
    expect(normalizeKeyInboxChannel('sms')).toBe(KEY_INBOX_CHANNELS.SMS);
  });
});
