import { Inject, Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConnectorRegistryService } from './connector-registry.service';
import {
  GmailConnector,
  GoogleCalendarConnector,
  GoogleDriveConnector,
  GoogleFormsConnector,
  GoogleContactsConnector,
  OutlookContactsConnector,
  GoogleBusinessProfileConnector,
  WhatsAppConnector,
  MetaSocialConnector,
  PayPalConnector,
  WiPayConnector,
  StripeConnector,
  QuickbooksConnector,
  XeroConnector,
  MailchimpConnector,
  KlaviyoConnector,
  LinkedInConnector,
  TikTokConnector,
  TwitterConnector,
  TypeformConnector,
  JotformConnector,
  WebhookFormConnector,
} from './implementations';

@Injectable()
export class ConnectorInitializerService implements OnModuleInit {
  private readonly logger = new Logger(ConnectorInitializerService.name);

  constructor(
    @Inject(ConnectorRegistryService) private readonly registry: ConnectorRegistryService,
    @Inject(GmailConnector) private readonly gmail: GmailConnector,
    @Inject(GoogleCalendarConnector) private readonly calendar: GoogleCalendarConnector,
    @Inject(GoogleDriveConnector) private readonly drive: GoogleDriveConnector,
    @Inject(GoogleFormsConnector) private readonly forms: GoogleFormsConnector,
    @Inject(GoogleContactsConnector) private readonly contacts: GoogleContactsConnector,
    @Inject(OutlookContactsConnector) private readonly outlookContacts: OutlookContactsConnector,
    @Inject(GoogleBusinessProfileConnector)
    private readonly businessProfile: GoogleBusinessProfileConnector,
    @Inject(WhatsAppConnector) private readonly whatsapp: WhatsAppConnector,
    @Inject(MetaSocialConnector) private readonly meta: MetaSocialConnector,
    @Inject(PayPalConnector) private readonly paypal: PayPalConnector,
    @Inject(WiPayConnector) private readonly wipay: WiPayConnector,
    @Inject(StripeConnector) private readonly stripe: StripeConnector,
    @Inject(QuickbooksConnector) private readonly quickbooks: QuickbooksConnector,
    @Inject(XeroConnector) private readonly xero: XeroConnector,
    @Inject(MailchimpConnector) private readonly mailchimp: MailchimpConnector,
    @Inject(KlaviyoConnector) private readonly klaviyo: KlaviyoConnector,
    @Inject(LinkedInConnector) private readonly linkedin: LinkedInConnector,
    @Inject(TikTokConnector) private readonly tiktok: TikTokConnector,
    @Inject(TwitterConnector) private readonly twitter: TwitterConnector,
    @Inject(TypeformConnector) private readonly typeform: TypeformConnector,
    @Inject(JotformConnector) private readonly jotform: JotformConnector,
    @Inject(WebhookFormConnector) private readonly webhookForm: WebhookFormConnector,
  ) {}

  onModuleInit() {
    const all = [
      this.gmail,
      this.calendar,
      this.drive,
      this.forms,
      this.contacts,
      this.outlookContacts,
      this.businessProfile,
      this.whatsapp,
      this.meta,
      this.paypal,
      this.wipay,
      this.stripe,
      this.quickbooks,
      this.xero,
      this.mailchimp,
      this.klaviyo,
      this.linkedin,
      this.tiktok,
      this.twitter,
      this.typeform,
      this.jotform,
      this.webhookForm,
    ];
    for (const c of all) this.registry.register(c);
    this.logger.log(`Initialized ${all.length} connectors in the registry`);
  }
}
