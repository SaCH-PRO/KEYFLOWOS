import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { PayrollService } from './payroll.service';

@Module({
  imports: [PrismaModule],
  providers: [PayrollService],
  exports: [PayrollService],
})
export class PayrollModule {}
