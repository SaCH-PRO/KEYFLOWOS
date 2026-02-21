import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [PrismaModule, AiModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
