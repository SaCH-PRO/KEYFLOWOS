import { Inject, Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConnectorRegistryService } from './connector-registry.service';
import {
  GmailConnector,
  GoogleCalendarConnector,
  GoogleDriveConnector,
  GoogleFormsConnector,
  GoogleContactsConnector,
  GoogleBusinessProfileConnector,
  GoogleMapsConnector,
  WhatsAppConnector,
  MetaSocialConnector,
  PayPalConnector,
  WiPayConnector,
  StripeConnector,
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
    @Inject(GoogleBusinessProfileConnector)
    private readonly businessProfile: GoogleBusinessProfileConnector,
    @Inject(GoogleMapsConnector) private readonly maps: GoogleMapsConnector,
    @Inject(WhatsAppConnector) private readonly whatsapp: WhatsAppConnector,
    @Inject(MetaSocialConnector) private readonly meta: MetaSocialConnector,
    @Inject(PayPalConnector) private readonly paypal: PayPalConnector,
    @Inject(WiPayConnector) private readonly wipay: WiPayConnector,
    @Inject(StripeConnector) private readonly stripe: StripeConnector,
  ) {}

  onModuleInit() {
    this.registry.register(this.gmail);
    this.registry.register(this.calendar);
    this.registry.register(this.drive);
    this.registry.register(this.forms);
    this.registry.register(this.contacts);
    this.registry.register(this.businessProfile);
    this.registry.register(this.maps);
    this.registry.register(this.whatsapp);
    this.registry.register(this.meta);
    this.registry.register(this.paypal);
    this.registry.register(this.wipay);
    this.registry.register(this.stripe);
    this.logger.log(`Initialized ${12} connectors in the registry`);
  }
}
