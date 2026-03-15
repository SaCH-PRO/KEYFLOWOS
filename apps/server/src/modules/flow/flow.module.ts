import { Module, forwardRef } from '@nestjs/common';
import { FlowController } from './flow.controller';
import { FlowListener } from './flow.listener';
import { FlowService } from './flow.service';
import { ActivityService } from './activity.service';
import { AutomationExecutorService } from './automation-executor.service';
import { CrossModuleAgentService } from './cross-module-agent.service';
import { BookingsModule } from '../bookings/bookings.module';
import { CrmModule } from '../crm/crm.module';
import { CommerceModule } from '../commerce/commerce.module';

@Module({
  imports: [BookingsModule, forwardRef(() => CrmModule), forwardRef(() => CommerceModule)],
  controllers: [FlowController],
  providers: [FlowListener, FlowService, ActivityService, AutomationExecutorService, CrossModuleAgentService],
  exports: [FlowService, ActivityService, CrossModuleAgentService],
})
export class FlowModule {}
