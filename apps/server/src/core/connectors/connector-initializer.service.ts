import { Inject, Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConnectorRegistryService } from './connector-registry.service';
import {
  GmailConnector,
  GoogleCalendarConnector,
  GoogleDriveConnector,
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
    this.registry.register(this.whatsapp);
    this.registry.register(this.meta);
    this.registry.register(this.paypal);
    this.registry.register(this.wipay);
    this.registry.register(this.stripe);
    this.logger.log(`Initialized ${8} connectors in the registry`);
  }
}
