import { Module } from '@nestjs/common';
import { CommunicationsController } from './communications.controller';
import { ChannelConnectionService } from './channel-connection.service';
import { OutboundContentService } from './outbound-content.service';
import { DeliveryQueueService } from './delivery-queue.service';
import { AdapterRegistryService } from './adapters/adapter-registry.service';
import { ContentAiService } from './content-ai.service';

@Module({
  controllers: [CommunicationsController],
  providers: [
    ChannelConnectionService,
    OutboundContentService,
    DeliveryQueueService,
    AdapterRegistryService,
    ContentAiService,
  ],
  exports: [
    ChannelConnectionService,
    OutboundContentService,
    DeliveryQueueService,
    AdapterRegistryService,
    ContentAiService,
  ],
})
export class CommunicationsModule {}
