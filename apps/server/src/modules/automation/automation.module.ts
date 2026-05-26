import { Module, forwardRef } from '@nestjs/common';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';
import { CrmModule } from '../crm/crm.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PlanLimitGuard } from '../subscriptions/plan-limit.guard';
import { ActivityService } from '../flow/activity.service';
import { AiModule } from '../ai/ai.module';
import { FlowModule } from '../flow/flow.module';

@Module({
  imports: [forwardRef(() => CrmModule), SubscriptionsModule, AiModule, FlowModule],
  controllers: [AutomationController],
  providers: [AutomationService, PlanLimitGuard, ActivityService],
  exports: [AutomationService],
})
export class AutomationModule {}
