import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AuthModule } from '../../core/auth/auth.module';
import { CommandModule } from '../command/command.module';
import { FlowController } from './flow.controller';
import { FlowListener } from './flow.listener';
import { FlowService } from './flow.service';
import { ActivityService } from './activity.service';
import { ActivityEventListener } from './activity-event.listener';
import { AutomationExecutorService } from './automation-executor.service';
import { CrossModuleAgentService } from './cross-module-agent.service';
import { FlowEngineService } from './flow-engine.service';
import { FlowRunnerService } from './flow-runner.service';
import { FlowTemplateService } from './flow-template.service';
import { FlowActionRegistry } from './flow-action.registry';
import { BookingsModule } from '../bookings/bookings.module';
import { CrmModule } from '../crm/crm.module';
import { CommerceModule } from '../commerce/commerce.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CommunicationsModule } from '../communications/communications.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    CommandModule,
    BookingsModule,
    forwardRef(() => CrmModule),
    forwardRef(() => CommerceModule),
    NotificationsModule,
    CommunicationsModule,
  ],
  controllers: [FlowController],
  providers: [
    FlowListener,
    FlowService,
    ActivityService,
    ActivityEventListener,
    AutomationExecutorService,
    CrossModuleAgentService,
    FlowEngineService,
    FlowRunnerService,
    FlowTemplateService,
    FlowActionRegistry,
  ],
  exports: [
    FlowService,
    ActivityService,
    CrossModuleAgentService,
    AutomationExecutorService,
    FlowEngineService,
    FlowRunnerService,
    FlowTemplateService,
    FlowActionRegistry,
  ],
})
export class FlowModule {}
