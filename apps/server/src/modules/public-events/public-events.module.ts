import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { CrmModule } from '../crm/crm.module';
import { PublicEventsController } from './public-events.controller';
import { PublicEventsService } from './public-events.service';
import { AbandonedCheckoutScheduler } from './abandoned-checkout.scheduler';

@Module({
  imports: [PrismaModule, CrmModule],
  controllers: [PublicEventsController],
  providers: [PublicEventsService, AbandonedCheckoutScheduler],
  exports: [PublicEventsService],
})
export class PublicEventsModule {}
