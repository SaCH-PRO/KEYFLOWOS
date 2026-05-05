import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { CrmModule } from '../crm/crm.module';
import { PublicEventsController } from './public-events.controller';
import { PublicEventsService } from './public-events.service';
import { AbandonedCheckoutScheduler } from './abandoned-checkout.scheduler';
import { PresenceController } from './presence.controller';
import { PresenceStatsService } from './presence-stats.service';
import { PublicEventsIngestService } from './public-events.ingest.service';
import { PresenceAggregatorScheduler } from './presence-aggregator.scheduler';

@Module({
  imports: [PrismaModule, CrmModule],
  controllers: [PublicEventsController, PresenceController],
  providers: [
    PublicEventsService,
    AbandonedCheckoutScheduler,
    PresenceStatsService,
    PublicEventsIngestService,
    PresenceAggregatorScheduler,
  ],
  exports: [PublicEventsService, PublicEventsIngestService, PresenceStatsService],
})
export class PublicEventsModule {}
