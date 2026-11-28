import { Global, Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PlanLimitGuard } from '../subscriptions/plan-limit.guard';

/**
 * Shared Catalog domain (S1).
 *
 * Single owner of Product + Service CRUD across Store, Commerce, and
 * Bookings. Exported globally so any module can inject CatalogService
 * without an explicit `imports: [CatalogModule]` everywhere.
 */
@Global()
@Module({
  imports: [SubscriptionsModule],
  controllers: [CatalogController],
  providers: [CatalogService, PlanLimitGuard],
  exports: [CatalogService],
})
export class CatalogModule {}
