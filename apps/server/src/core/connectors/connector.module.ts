import { Global, Module } from '@nestjs/common';
import { ConnectorRegistryService } from './connector-registry.service';
import { ConnectorActivityService } from './connector-activity.service';
import { EntityResolutionService } from './entity-resolution.service';
import { ConnectorController } from './connector.controller';
import { ConnectorInitializerService } from './connector-initializer.service';
import { GoogleSuiteService } from './google-suite.service';
import { GoogleSuiteController } from './google-suite.controller';
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

@Global()
@Module({
  controllers: [ConnectorController, GoogleSuiteController],
  providers: [
    ConnectorRegistryService,
    ConnectorActivityService,
    EntityResolutionService,
    ConnectorInitializerService,
    GoogleSuiteService,
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
  ],
  exports: [
    ConnectorRegistryService,
    ConnectorActivityService,
    EntityResolutionService,
    GoogleSuiteService,
  ],
})
export class ConnectorModule {}
