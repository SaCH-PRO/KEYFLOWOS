import { Module } from '@nestjs/common';
import { CommunicationsController } from './communications.controller';
import { CommunicationsService } from './communications.service';
import { ChannelConnectionService } from './channel-connection.service';
import { OutboundContentService } from './outbound-content.service';
import { DeliveryQueueService } from './delivery-queue.service';
import { AdapterRegistryService } from './adapters/adapter-registry.service';
import { ContentAiService } from './content-ai.service';
import { InboundCommunicationsService } from './inbound-communications.service';
import { InboundCommunicationsController } from './inbound-communications.controller';
import { InteractionClassifierService } from './interaction-classifier.service';
import { ProfitTrajectoryService } from './profit-trajectory.service';
import { ResponseDraftService } from './response-draft.service';
import { ConsentService } from './consent.service';
import { TriggerDefinitionService } from './trigger-definition.service';
import { OmnichannelController } from './omnichannel.controller';
import { OmnichannelProcessorService } from './omnichannel-processor.service';
import { MessageIntakeController } from './message-intake.controller';
import { MessageIntakeOrchestrator } from './message-intake-orchestrator.service';
import { MessageIntakeListener } from './message-intake.listener';
import { AiModule } from '../ai/ai.module';
import { CommandModule } from '../command/command.module';
import { CrmModule } from '../crm/crm.module';
import { TaskAssignmentModule } from '../task-assignments/task-assignment.module';
import { TimelineModule } from '../timeline/timeline.module';
import { KeyInboxModule } from '../key-inbox/key-inbox.module';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { StructureModule } from '../structure/structure.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [AiModule, CommandModule, CrmModule, TaskAssignmentModule, TimelineModule, KeyInboxModule, PrismaModule, StructureModule, WhatsAppModule],
  controllers: [
    CommunicationsController,
    InboundCommunicationsController,
    OmnichannelController,
    MessageIntakeController,
  ],
  providers: [
    ChannelConnectionService,
    OutboundContentService,
    DeliveryQueueService,
    AdapterRegistryService,
    ContentAiService,
    InboundCommunicationsService,
    InteractionClassifierService,
    ProfitTrajectoryService,
    ResponseDraftService,
    ConsentService,
    TriggerDefinitionService,
    OmnichannelProcessorService,
    MessageIntakeOrchestrator,
    MessageIntakeListener,
    CommunicationsService,
  ],
  exports: [
    ChannelConnectionService,
    OutboundContentService,
    DeliveryQueueService,
    AdapterRegistryService,
    ContentAiService,
    InboundCommunicationsService,
    InteractionClassifierService,
    ProfitTrajectoryService,
    ResponseDraftService,
    ConsentService,
    TriggerDefinitionService,
    OmnichannelProcessorService,
    MessageIntakeOrchestrator,
    CommunicationsService,
  ],
})
export class CommunicationsModule {}
