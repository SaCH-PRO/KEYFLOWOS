import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { ActivityLogService } from './activity.service';

@Module({
  imports: [PrismaModule],
  providers: [ActivityLogService],
  exports: [ActivityLogService],
})
export class ActivityModule {}
