import { Module, forwardRef } from '@nestjs/common';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';
import { CrmModule } from '../crm/crm.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PlanLimitGuard } from '../subscriptions/plan-limit.guard';

@Module({
  imports: [forwardRef(() => CrmModule), SubscriptionsModule],
  controllers: [AutomationController],
  providers: [AutomationService, PlanLimitGuard],
  exports: [AutomationService],
})
export class AutomationModule {}
