import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { StaffPerformanceService } from './staff-performance.service';

@Module({
  imports: [PrismaModule],
  providers: [StaffPerformanceService],
  exports: [StaffPerformanceService],
})
export class StaffPerformanceModule {}
