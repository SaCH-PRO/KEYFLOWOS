import { Module } from '@nestjs/common';
import { MarketplaceController } from './marketplace.controller';
import { MarketplacePublicController } from './marketplace-public.controller';
import { MarketplaceService } from './marketplace.service';
import { FulfillmentRoutingService } from './fulfillment-routing.service';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [MarketplaceController, MarketplacePublicController],
  providers: [MarketplaceService, FulfillmentRoutingService],
  exports: [MarketplaceService, FulfillmentRoutingService],
})
export class MarketplaceModule {}
