import { Module, forwardRef } from '@nestjs/common';
import { MarketplaceController } from './marketplace.controller';
import { MarketplacePublicController } from './marketplace-public.controller';
import { MarketplaceService } from './marketplace.service';
import { FulfillmentRoutingService } from './fulfillment-routing.service';
import { CommerceIntegrationService } from './commerce-integration.service';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CrmModule } from '../crm/crm.module';
import { ExpensesModule } from '../expenses/expenses.module';

@Module({
  imports: [PrismaModule, NotificationsModule, forwardRef(() => CrmModule), ExpensesModule],
  controllers: [MarketplaceController, MarketplacePublicController],
  providers: [MarketplaceService, FulfillmentRoutingService, CommerceIntegrationService],
  exports: [MarketplaceService, FulfillmentRoutingService, CommerceIntegrationService],
})
export class MarketplaceModule {}
