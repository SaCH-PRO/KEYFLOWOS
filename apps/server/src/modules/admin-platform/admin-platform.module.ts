import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AdminUserController } from './admin-user.controller';
import { AdminBusinessController } from './admin-business.controller';
import { AdminEventController } from './admin-event.controller';
import { GdprPurgeService } from './gdpr-purge.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    AdminUserController,
    AdminBusinessController,
    AdminEventController,
  ],
  providers: [GdprPurgeService],
  exports: [GdprPurgeService],
})
export class AdminPlatformModule {}
