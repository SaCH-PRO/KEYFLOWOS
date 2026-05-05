import { Module } from '@nestjs/common';
import { CommunicationsController } from './communications.controller';
import { ChannelConnectionService } from './channel-connection.service';
import { OutboundContentService } from './outbound-content.service';
import { DeliveryQueueService } from './delivery-queue.service';
import { AdapterRegistryService } from './adapters/adapter-registry.service';
import { ContentAiService } from './content-ai.service';
import { InboundCommunicationsService } from './inbound-communications.service';
import { InboundCommunicationsController } from './inbound-communications.controller';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [AiModule],
  controllers: [CommunicationsController, InboundCommunicationsController],
  providers: [
    ChannelConnectionService,
    OutboundContentService,
    DeliveryQueueService,
    AdapterRegistryService,
    ContentAiService,
    InboundCommunicationsService,
  ],
  exports: [
    ChannelConnectionService,
    OutboundContentService,
    DeliveryQueueService,
    AdapterRegistryService,
    ContentAiService,
    InboundCommunicationsService,
  ],
})
export class CommunicationsModule {}
