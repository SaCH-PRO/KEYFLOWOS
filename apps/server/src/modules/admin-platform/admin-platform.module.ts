import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AdminUserController } from './admin-user.controller';
import { AdminBusinessController } from './admin-business.controller';
import { AdminEventController } from './admin-event.controller';
import { GdprPurgeService } from './gdpr-purge.service';
import { ProjectMissionControlController } from './project-mission-control.controller';
import { ProjectMissionControlService } from './project-mission-control.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    AdminUserController,
    AdminBusinessController,
    AdminEventController,
    ProjectMissionControlController,
  ],
  providers: [GdprPurgeService, ProjectMissionControlService],
  exports: [GdprPurgeService],
})
export class AdminPlatformModule {}
