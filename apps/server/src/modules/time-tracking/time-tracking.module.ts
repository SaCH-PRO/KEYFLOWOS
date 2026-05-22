import { Module } from '@nestjs/common';
import { TimeEntryService } from './time-entry.service';
import { TimeEntryController } from './time-entry.controller';
import { PrismaModule } from '../../core/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [TimeEntryService],
  controllers: [TimeEntryController],
  exports: [TimeEntryService],
})
export class TimeTrackingModule {}
