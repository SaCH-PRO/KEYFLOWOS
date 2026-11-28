import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AdminUserController } from './admin-user.controller';
import { AdminBusinessController } from './admin-business.controller';
import { AdminEventController } from './admin-event.controller';
import { AdminOpsConsoleController } from './admin-ops-console.controller';
import { AdminOpsConsoleService } from './admin-ops-console.service';
import { GdprPurgeService } from './gdpr-purge.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    AdminUserController,
    AdminBusinessController,
    AdminEventController,
    AdminOpsConsoleController,
  ],
  providers: [GdprPurgeService, AdminOpsConsoleService],
  exports: [GdprPurgeService],
})
export class AdminPlatformModule {}
