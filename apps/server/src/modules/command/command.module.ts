import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AuthModule } from '../../core/auth/auth.module';
import { TimelineModule } from '../timeline/timeline.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CommandController } from './command.controller';
import { CommandService } from './command.service';
import { CommandGeneratorService } from './command-generator.service';
import { CommandSchedulerService } from './command-scheduler.service';

@Module({
  imports: [PrismaModule, AuthModule, TimelineModule, NotificationsModule],
  controllers: [CommandController],
  providers: [CommandService, CommandGeneratorService, CommandSchedulerService],
  exports: [CommandService, CommandGeneratorService, CommandSchedulerService],
})
export class CommandModule {}
