import { Module } from '@nestjs/common';
import { CommunicationsController } from './communications.controller';
import { ChannelConnectionService } from './channel-connection.service';
import { OutboundContentService } from './outbound-content.service';
import { DeliveryQueueService } from './delivery-queue.service';
import { AdapterRegistryService } from './adapters/adapter-registry.service';

@Module({
  controllers: [CommunicationsController],
  providers: [
    ChannelConnectionService,
    OutboundContentService,
    DeliveryQueueService,
    AdapterRegistryService,
  ],
  exports: [
    ChannelConnectionService,
    OutboundContentService,
    DeliveryQueueService,
    AdapterRegistryService,
  ],
})
export class CommunicationsModule {}
