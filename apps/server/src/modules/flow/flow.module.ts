import { Module, forwardRef } from '@nestjs/common';
import { FlowController } from './flow.controller';
import { FlowListener } from './flow.listener';
import { FlowService } from './flow.service';
import { ActivityService } from './activity.service';
import { AutomationExecutorService } from './automation-executor.service';
import { BookingsModule } from '../bookings/bookings.module';
import { CrmModule } from '../crm/crm.module';

@Module({
  imports: [BookingsModule, forwardRef(() => CrmModule)],
  controllers: [FlowController],
  providers: [FlowListener, FlowService, ActivityService, AutomationExecutorService],
  exports: [FlowService, ActivityService],
})
export class FlowModule {}
