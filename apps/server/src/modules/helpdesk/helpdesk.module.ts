import { Module } from '@nestjs/common';
import { HelpdeskController } from './helpdesk.controller';
import { HelpdeskService } from './helpdesk.service';

@Module({
  controllers: [HelpdeskController],
  providers: [HelpdeskService],
  exports: [HelpdeskService],
})
export class HelpdeskModule {}
