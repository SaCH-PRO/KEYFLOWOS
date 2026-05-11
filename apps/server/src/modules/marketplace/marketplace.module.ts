// @keyflow:dormant — UI surface gated by featureFlags (KEY-9 cleanup target).
import { Module, forwardRef } from '@nestjs/common';
import { MarketplaceController } from './marketplace.controller';
import { MarketplacePublicController } from './marketplace-public.controller';
import { MarketplaceService } from './marketplace.service';
import { FulfillmentRoutingService } from './fulfillment-routing.service';
import { CommerceIntegrationService } from './commerce-integration.service';
import { StoreOrderRoutingListener } from './store-order-routing.listener';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CrmModule } from '../crm/crm.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { FinanceModule } from '../finance/finance.module';

@Module({
  imports: [PrismaModule, NotificationsModule, forwardRef(() => CrmModule), ExpensesModule, FinanceModule],
  controllers: [MarketplaceController, MarketplacePublicController],
  providers: [MarketplaceService, FulfillmentRoutingService, CommerceIntegrationService, StoreOrderRoutingListener],
  exports: [MarketplaceService, FulfillmentRoutingService, CommerceIntegrationService],
})
export class MarketplaceModule {}
