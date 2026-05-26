import { Module, forwardRef } from '@nestjs/common';
import { FlowController } from './flow.controller';
import { FlowListener } from './flow.listener';
import { FlowService } from './flow.service';
import { ActivityService } from './activity.service';
import { ActivityEventListener } from './activity-event.listener';
import { AutomationExecutorService } from './automation-executor.service';
import { CrossModuleAgentService } from './cross-module-agent.service';
import { BookingsModule } from '../bookings/bookings.module';
import { CrmModule } from '../crm/crm.module';
import { CommerceModule } from '../commerce/commerce.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CommunicationsModule } from '../communications/communications.module';

@Module({
  imports: [BookingsModule, forwardRef(() => CrmModule), forwardRef(() => CommerceModule), NotificationsModule, CommunicationsModule],
  controllers: [FlowController],
  providers: [FlowListener, FlowService, ActivityService, ActivityEventListener, AutomationExecutorService, CrossModuleAgentService],
  exports: [FlowService, ActivityService, CrossModuleAgentService, AutomationExecutorService],
})
export class FlowModule {}
