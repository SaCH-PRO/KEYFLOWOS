import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AuthModule } from '../../core/auth/auth.module';
import { TimelineModule } from '../timeline/timeline.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CommandController } from './command.controller';
import { CommandService } from './command.service';
import { CommandGeneratorService } from './command-generator.service';
import { CommandSchedulerService } from './command-scheduler.service';
import { ObligationListener } from './obligation.listener';

/**
 * CommandModule owns `command_items`.
 *
 * `ObligationListener` is registered as a provider and nothing else imports it:
 * it is reached only through the @Global event bus, so producers in twelve
 * other modules raise obligations without importing this one and without a
 * forwardRef. That is the property worth protecting — the server needed 68
 * forwardRef deferrals to boot, and every one of them started as a service
 * being imported rather than an event being emitted.
 */
@Module({
  imports: [PrismaModule, AuthModule, TimelineModule, NotificationsModule],
  controllers: [CommandController],
  providers: [CommandService, CommandGeneratorService, CommandSchedulerService, ObligationListener],
  exports: [CommandService, CommandGeneratorService, CommandSchedulerService],
})
export class CommandModule {}
