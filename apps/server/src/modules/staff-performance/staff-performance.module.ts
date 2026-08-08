import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { StaffPerformanceController } from './staff-performance.controller';
import { StaffPerformanceService } from './staff-performance.service';

@Module({
  imports: [PrismaModule],
  controllers: [StaffPerformanceController],
  providers: [StaffPerformanceService],
  exports: [StaffPerformanceService],
})
export class StaffPerformanceModule {}
