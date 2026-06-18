import { Global, Module } from '@nestjs/common';
import { ConnectorRegistryService } from './connector-registry.service';
import { ConnectorActivityService } from './connector-activity.service';
import { ConnectorHealthMonitorService } from './connector-health-monitor.service';
import { ConnectorSyncSchedulerService } from './connector-sync-scheduler.service';
import { ConnectorCredentialsService } from './connector-credentials.service';
import { EntityResolutionService } from './entity-resolution.service';
import { ConnectorController } from './connector.controller';
import { ConnectorInitializerService } from './connector-initializer.service';
import { GoogleSuiteService } from './google-suite.service';
import { GoogleSuiteController } from './google-suite.controller';
import { FormWebhookController } from './form-webhook.controller';
import { NotificationsModule } from '../../modules/notifications/notifications.module';
import { KeyInboxModule } from '../../modules/key-inbox/key-inbox.module';
import {
  GmailConnector,
  GmailIngestionService,
  GoogleCalendarConnector,
  GoogleDriveConnector,
  GoogleFormsIngestionService,
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

@Global()
@Module({
  imports: [NotificationsModule, KeyInboxModule],
  controllers: [ConnectorController, GoogleSuiteController, FormWebhookController],
  providers: [
    ConnectorRegistryService,
    ConnectorActivityService,
    ConnectorHealthMonitorService,
    ConnectorSyncSchedulerService,
    ConnectorCredentialsService,
    EntityResolutionService,
    ConnectorInitializerService,
    GoogleSuiteService,
    GmailConnector,
    GmailIngestionService,
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
    GoogleFormsIngestionService,
    LinkedInConnector,
    TikTokConnector,
    TwitterConnector,
    TypeformConnector,
    JotformConnector,
    WebhookFormConnector,
  ],
  exports: [
    ConnectorRegistryService,
    ConnectorActivityService,
    ConnectorHealthMonitorService,
    ConnectorSyncSchedulerService,
    ConnectorCredentialsService,
    EntityResolutionService,
    GoogleSuiteService,
    GmailIngestionService,
    StripeConnector,
    PayPalConnector,
    WiPayConnector,
    QuickbooksConnector,
    XeroConnector,
    MailchimpConnector,
    KlaviyoConnector,
    GoogleFormsIngestionService,
    LinkedInConnector,
    TikTokConnector,
    TwitterConnector,
    TypeformConnector,
    JotformConnector,
    WebhookFormConnector,
  ],
})
export class ConnectorModule {}
