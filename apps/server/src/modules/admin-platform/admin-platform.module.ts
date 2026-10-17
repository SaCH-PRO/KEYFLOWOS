import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AdminUserController } from './admin-user.controller';
import { AdminBusinessController } from './admin-business.controller';
import { AdminEventController } from './admin-event.controller';
import { GdprPurgeService } from './gdpr-purge.service';
import { HandoffMonitorController } from './handoff-monitor.controller';
import { HandoffMonitorService } from './handoff-monitor.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    AdminUserController,
    AdminBusinessController,
    AdminEventController,
    HandoffMonitorController,
  ],
  providers: [
    GdprPurgeService,
    { provide: HandoffMonitorService, useFactory: () => new HandoffMonitorService(process.env) },
  ],
  exports: [GdprPurgeService],
})
export class AdminPlatformModule {}
