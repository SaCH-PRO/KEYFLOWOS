import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { CrmAiController } from './crm-ai.controller';
import { CrmGoogleController } from './crm-google.controller';
import { CrmSequenceController } from './crm-sequence.controller';
import { CrmDealsController } from './crm-deals.controller';
import { CrmDealsService } from './crm-deals.service';
import { ContactPrivacyController } from './privacy/contact-privacy.controller';
import { ContactAuditService } from './privacy/contact-audit.service';
import { ContactPrivacyService } from './privacy/contact-privacy.service';
import { CrmActionsService } from './crm-actions.service';
import { CrmAiService } from './crm-ai.service';
import { CrmFlowService } from './crm-flow.service';
import { CrmGoogleService } from './crm-google.service';
import { CrmImportService } from './crm-import.service';
import { CrmJourneyService } from './crm-journey.service';
import { CrmListsService } from './crm-lists.service';
import { CrmSavedViewsService } from './crm-saved-views.service';
import { CrmPlaybookService } from './crm-playbook.service';
import { CrmRevenueService } from './crm-revenue.service';
import { CrmSequenceService } from './crm-sequence.service';
import { CrmSequenceSchedulerService } from './crm-sequence-scheduler.service';
import { CrmRelationshipHealthService } from './crm-relationship-health.service';
import { CrmRelationshipHealthSchedulerService } from './crm-relationship-health-scheduler.service';
import { CrmStatsService } from './crm-stats.service';
import { CrmDuplicateDetectionService } from './crm-duplicate-detection.service';
import { CrmTimelineService } from './crm-timeline.service';
import { CrmCommunicationService } from './crm-communication.service';
import { ConversationAiService } from './conversation-ai.service';
import { CrmService } from './crm.service';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { BestChannelService } from './best-channel.service';
import { BestChannelListener } from './best-channel.listener';
import { BestChannelSchedulerService } from './best-channel-scheduler.service';
import { CrmRateLimitGuard } from './guards/rate-limit.guard';
import { FeatureFlagGuard } from './guards/feature-flag.guard';
import { PlanLimitGuard } from '../subscriptions/plan-limit.guard';
import { AiModule } from '../ai/ai.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ConnectorModule } from '../../core/connectors/connector.module';

@Module({
  imports: [SubscriptionsModule, AiModule, ConnectorModule, WhatsAppModule],
  controllers: [
    CrmController,
    CrmAiController,
    CrmGoogleController,
    CrmSequenceController,
    CrmDealsController,
    ContactPrivacyController,
  ],
  providers: [
    CrmService,
    CrmTimelineService,
    CrmCommunicationService,
    ConversationAiService,
    CrmListsService,
    CrmSavedViewsService,
    CrmStatsService,
    CrmDuplicateDetectionService,
    CrmImportService,
    CrmPlaybookService,
    CrmGoogleService,
    CrmFlowService,
    CrmActionsService,
    CrmRevenueService,
    CrmJourneyService,
    CrmAiService,
    CrmSequenceService,
    CrmSequenceSchedulerService,
    CrmRelationshipHealthService,
    CrmRelationshipHealthSchedulerService,
    CrmDealsService,
    BestChannelService,
    BestChannelListener,
    BestChannelSchedulerService,
    CrmRateLimitGuard,
    FeatureFlagGuard,
    PlanLimitGuard,
    ContactAuditService,
    ContactPrivacyService,
  ],
  exports: [
    CrmService,
    CrmTimelineService,
    CrmCommunicationService,
    ConversationAiService,
    CrmListsService,
    CrmSavedViewsService,
    CrmStatsService,
    CrmDuplicateDetectionService,
    CrmImportService,
    CrmPlaybookService,
    CrmGoogleService,
    CrmFlowService,
    CrmActionsService,
    CrmRevenueService,
    CrmJourneyService,
    CrmAiService,
    CrmSequenceService,
    CrmSequenceSchedulerService,
    CrmRelationshipHealthService,
    CrmRelationshipHealthSchedulerService,
    CrmDealsService,
    BestChannelService,
    ContactAuditService,
    ContactPrivacyService,
  ],
})
export class CrmModule {}
