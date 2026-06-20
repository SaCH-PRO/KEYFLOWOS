export const KEY_INBOX_CHANNELS = {
  EMAIL: 'email',
  WHATSAPP: 'whatsapp',
  SMS: 'sms',
  GOOGLE_FORMS: 'google_forms',
  INSTAGRAM_DM: 'instagram_dm',
  FACEBOOK_MESSENGER: 'facebook_messenger',
  FACEBOOK_PAGE_COMMENT: 'facebook_page_comment',
  INSTAGRAM_COMMENT: 'instagram_comment',
  META_LEAD_FORM: 'meta_lead_form',
  WEBSITE_FORM: 'website_form',
  WEBSITE_CHAT: 'website_chat',
  MANUAL: 'manual',
} as const;

export type KeyInboxChannel = (typeof KEY_INBOX_CHANNELS)[keyof typeof KEY_INBOX_CHANNELS];

export const KEY_INBOX_SEND_STATUSES = {
  DRAFT: 'DRAFT',
  QUEUED: 'QUEUED',
  SENT: 'SENT',
  FAILED: 'FAILED',
  NOT_SUPPORTED: 'NOT_SUPPORTED',
} as const;

export type KeyInboxSendStatus = (typeof KEY_INBOX_SEND_STATUSES)[keyof typeof KEY_INBOX_SEND_STATUSES];

export function normalizeKeyInboxChannel(input?: string | null): KeyInboxChannel {
  const value = String(input ?? '').toLowerCase().trim();

  switch (value) {
    case 'gmail':
    case 'email':
      return KEY_INBOX_CHANNELS.EMAIL;

    case 'forms':
    case 'google_form':
    case 'google_forms':
      return KEY_INBOX_CHANNELS.GOOGLE_FORMS;

    case 'instagram':
    case 'instagram_dm':
      return KEY_INBOX_CHANNELS.INSTAGRAM_DM;

    case 'messenger':
    case 'meta_messenger':
    case 'facebook_messenger':
      return KEY_INBOX_CHANNELS.FACEBOOK_MESSENGER;

    case 'facebook':
    case 'facebook_comment':
    case 'facebook_page_comment':
      return KEY_INBOX_CHANNELS.FACEBOOK_PAGE_COMMENT;

    case 'instagram_comment':
      return KEY_INBOX_CHANNELS.INSTAGRAM_COMMENT;

    case 'meta_lead':
    case 'meta_lead_form':
      return KEY_INBOX_CHANNELS.META_LEAD_FORM;

    case 'whatsapp':
      return KEY_INBOX_CHANNELS.WHATSAPP;

    case 'sms':
      return KEY_INBOX_CHANNELS.SMS;

    case 'website_form':
      return KEY_INBOX_CHANNELS.WEBSITE_FORM;

    case 'website_chat':
      return KEY_INBOX_CHANNELS.WEBSITE_CHAT;

    default:
      return KEY_INBOX_CHANNELS.MANUAL;
  }
}
