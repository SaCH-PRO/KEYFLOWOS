import { Global, Module } from '@nestjs/common';
import { ConnectorRegistryService } from './connector-registry.service';
import { EntityResolutionService } from './entity-resolution.service';
import { ConnectorController } from './connector.controller';
import { ConnectorInitializerService } from './connector-initializer.service';
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

@Global()
@Module({
  controllers: [ConnectorController],
  providers: [
    ConnectorRegistryService,
    EntityResolutionService,
    ConnectorInitializerService,
    GmailConnector,
    GoogleCalendarConnector,
    GoogleDriveConnector,
    WhatsAppConnector,
    MetaSocialConnector,
    PayPalConnector,
    WiPayConnector,
    StripeConnector,
  ],
  exports: [ConnectorRegistryService, EntityResolutionService],
})
export class ConnectorModule {}
