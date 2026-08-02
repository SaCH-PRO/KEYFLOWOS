/**
 * Connectors whose provider pull sync is not implemented must return an explicit
 * PULL_SYNC_NOT_IMPLEMENTED result — never success:true with a local row count.
 *
 * The new sync() bodies do not touch `this`, so we can assert the contract via
 * the prototype without constructing each connector's dependency graph.
 */
import { describe, it, expect } from 'vitest';
import { StripeConnector } from './implementations/stripe.connector';
import { PayPalConnector } from './implementations/paypal.connector';
import { WiPayConnector } from './implementations/wipay.connector';
import { QuickbooksConnector } from './implementations/quickbooks.connector';
import { XeroConnector } from './implementations/xero.connector';
import { MailchimpConnector } from './implementations/mailchimp.connector';
import { KlaviyoConnector } from './implementations/klaviyo.connector';
import { GoogleDriveConnector } from './implementations/google-drive.connector';
import { GoogleContactsConnector } from './implementations/google-contacts.connector';
import { GoogleCalendarConnector } from './implementations/google-calendar.connector';
import { GoogleBusinessProfileConnector } from './implementations/google-business-profile.connector';
import { OutlookContactsConnector } from './implementations/outlook-contacts.connector';
import { WhatsAppConnector } from './implementations/whatsapp.connector';
import { GmailConnector } from './implementations/gmail.connector';
import { GoogleFormsConnector } from './implementations/google-forms.connector';
import { TypeformConnector } from './implementations/typeform.connector';
import { JotformConnector } from './implementations/jotform.connector';
import { WebhookFormConnector } from './implementations/webhook-form.connector';

const NOT_IMPLEMENTED: Array<[string, { prototype: { sync: (b: string) => Promise<any> } }]> = [
  ['StripeConnector', StripeConnector as any],
  ['PayPalConnector', PayPalConnector as any],
  ['WiPayConnector', WiPayConnector as any],
  ['QuickbooksConnector', QuickbooksConnector as any],
  ['XeroConnector', XeroConnector as any],
  ['MailchimpConnector', MailchimpConnector as any],
  ['KlaviyoConnector', KlaviyoConnector as any],
  ['GoogleDriveConnector', GoogleDriveConnector as any],
  ['GoogleContactsConnector', GoogleContactsConnector as any],
  ['GoogleCalendarConnector', GoogleCalendarConnector as any],
  ['GoogleBusinessProfileConnector', GoogleBusinessProfileConnector as any],
  ['OutlookContactsConnector', OutlookContactsConnector as any],
  ['WhatsAppConnector', WhatsAppConnector as any],
  // Form platforms inherit sync() from FormPlatformConnectorBase, so a
  // hasOwnProperty check would miss them — Cls.prototype.sync resolves through
  // the prototype chain, which is what this list relies on. All three used to
  // COUNT LOCAL leadFormSubmission ROWS and report that as itemsSynced with
  // success: true, without contacting the provider at all.
  ['TypeformConnector', TypeformConnector as any],
  ['JotformConnector', JotformConnector as any],
  ['WebhookFormConnector', WebhookFormConnector as any],
];

describe('connector sync() — pull not implemented', () => {
  for (const [name, Cls] of NOT_IMPLEMENTED) {
    it(`${name}.sync() returns PULL_SYNC_NOT_IMPLEMENTED (never fakes success)`, async () => {
      const r = await Cls.prototype.sync.call({}, 'any-business');
      expect(r.success).toBe(false);
      expect(r.itemsSynced).toBe(0);
      expect(r.unsupported).toBe(true);
      expect(r.code).toBe('PULL_SYNC_NOT_IMPLEMENTED');
    });
  }

  it('gmail and google-forms are NOT stubbed (they delegate to real ingestion)', () => {
    // These have genuine pull sync via their ingestion services, so their sync()
    // is not the shared not-implemented body.
    const src = (fn: (...a: any[]) => any) => fn.toString();
    expect(src(GmailConnector.prototype.sync)).not.toContain('PULL_SYNC_NOT_IMPLEMENTED');
    expect(src(GoogleFormsConnector.prototype.sync)).not.toContain('PULL_SYNC_NOT_IMPLEMENTED');
    expect(src(GmailConnector.prototype.sync)).toContain('ingestion');
    expect(src(GoogleFormsConnector.prototype.sync)).toContain('ingestion');
  });
});
