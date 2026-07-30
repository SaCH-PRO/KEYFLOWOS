import { Module } from '@nestjs/common';
import { TimelineModule } from '../timeline/timeline.module';
import { CrmController } from './crm.controller';
import { CrmAiController } from './crm-ai.controller';
import { CrmGoogleController } from './crm-google.controller';
import { CrmSequenceController } from './crm-sequence.controller';
import { CrmDealsController } from './crm-deals.controller';
import { CrmDealsService } from './crm-deals.service';
import { DealForecastService } from './deal-forecast.service';
import { DealVelocityService } from './deal-velocity.service';
import { DealHealthService } from './deal-health.service';
import { DealIntelligenceSchedulerService } from './deal-intelligence-scheduler.service';
import { WonLostReasonService } from './won-lost-reason.service';
import { AutopilotModule } from '../autopilot/autopilot.module';
import { forwardRef } from '@nestjs/common';
import { CrmAccountsController } from './crm-accounts.controller';
import { CrmAccountsService } from './crm-accounts.service';
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
import { CrmNetworkService } from './crm-network.service';
import { CrmPlaybookService } from './crm-playbook.service';
import { CrmRevenueService } from './crm-revenue.service';
import { CrmSequenceService } from './crm-sequence.service';
import { CrmSequenceSchedulerService } from './crm-sequence-scheduler.service';
import { CrmSequenceAnalyticsService } from './crm-sequence-analytics.service';
import { SequenceAttributionListener } from './sequence-attribution.listener';
import { CrmRelationshipHealthService } from './crm-relationship-health.service';
import { CrmRelationshipHealthSchedulerService } from './crm-relationship-health-scheduler.service';
import { CrmStatsService } from './crm-stats.service';
import { CrmCacheService } from './crm-cache.service';
import { CrmDuplicateDetectionService } from './crm-duplicate-detection.service';
import { CrmDataQualityService } from './crm-data-quality.service';
import { CrmDataQualityScheduler } from './crm-data-quality.scheduler';
import { CrmTimelineService } from './crm-timeline.service';
import { CrmCommunicationService } from './crm-communication.service';
import { ConversationAiService } from './conversation-ai.service';
import { CrmService } from './crm.service';
import { CustomFieldDefinitionService } from './custom-field-definition.service';
import { ContactCustomFieldValueService } from './contact-custom-field-value.service';
import { CrmCustomFieldsController } from './crm-custom-fields.controller';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { BestChannelService } from './best-channel.service';
import { BestChannelListener } from './best-channel.listener';
import { BestChannelSchedulerService } from './best-channel-scheduler.service';
import { ContactInsightService } from './contact-insight.service';
import { ContactInsightListener } from './contact-insight.listener';
import { LeadScoringScheduler } from './lead-scoring.scheduler';
import { RevenueEventListener } from './revenue-event.listener';
import { CrmRateLimitGuard } from './guards/rate-limit.guard';
import { FeatureFlagGuard } from './guards/feature-flag.guard';
import { PlanLimitGuard } from '../subscriptions/plan-limit.guard';
import { AiModule } from '../ai/ai.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ConnectorModule } from '../../core/connectors/connector.module';
import { CommunityModule } from '../community/community.module';
import { EvidenceModule } from '../evidence/evidence.module';
import { TaskAssignmentModule } from '../task-assignments/task-assignment.module';

@Module({
  imports: [SubscriptionsModule, forwardRef(() => AiModule), ConnectorModule, WhatsAppModule, CommunityModule, TimelineModule, EvidenceModule, TaskAssignmentModule, forwardRef(() => AutopilotModule)],
  controllers: [
    CrmController,
    CrmCustomFieldsController,
    CrmAiController,
    CrmGoogleController,
    CrmSequenceController,
    CrmDealsController,
    CrmAccountsController,
    ContactPrivacyController,
  ],
  providers: [
    CrmService,
    CustomFieldDefinitionService,
    ContactCustomFieldValueService,
    CrmTimelineService,
    CrmCommunicationService,
    ConversationAiService,
    CrmListsService,
    CrmSavedViewsService,
    CrmStatsService,
    CrmCacheService,
    CrmDuplicateDetectionService,
    CrmDataQualityService,
    CrmDataQualityScheduler,
    CrmImportService,
    CrmPlaybookService,
    CrmGoogleService,
    CrmFlowService,
    CrmActionsService,
    CrmRevenueService,
    CrmJourneyService,
    CrmNetworkService,
    CrmAiService,
    CrmSequenceService,
    CrmSequenceSchedulerService,
    CrmSequenceAnalyticsService,
    SequenceAttributionListener,
    CrmRelationshipHealthService,
    CrmRelationshipHealthSchedulerService,
    CrmDealsService,
    DealForecastService,
    DealVelocityService,
    DealHealthService,
    DealIntelligenceSchedulerService,
    WonLostReasonService,
    CrmAccountsService,
    BestChannelService,
    BestChannelListener,
    BestChannelSchedulerService,
    ContactInsightService,
    ContactInsightListener,
    LeadScoringScheduler,
    RevenueEventListener,
    CrmRateLimitGuard,
    FeatureFlagGuard,
    PlanLimitGuard,
    ContactAuditService,
    ContactPrivacyService,
  ],
  exports: [
    CrmService,
    CustomFieldDefinitionService,
    ContactCustomFieldValueService,
    CrmTimelineService,
    CrmCommunicationService,
    ConversationAiService,
    CrmListsService,
    CrmSavedViewsService,
    CrmStatsService,
    CrmCacheService,
    CrmDuplicateDetectionService,
    CrmDataQualityService,
    CrmImportService,
    CrmPlaybookService,
    CrmGoogleService,
    CrmFlowService,
    CrmActionsService,
    CrmRevenueService,
    CrmJourneyService,
    CrmNetworkService,
    CrmAiService,
    CrmSequenceService,
    CrmSequenceSchedulerService,
    CrmSequenceAnalyticsService,
    CrmRelationshipHealthService,
    CrmRelationshipHealthSchedulerService,
    CrmDealsService,
    CrmAccountsService,
    BestChannelService,
    ContactInsightService,
    ContactAuditService,
    ContactPrivacyService,
  ],
})
export class CrmModule {}
