import { Module } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { CrmModule } from '../crm/crm.module';
import { CommerceModule } from '../commerce/commerce.module';

@Module({
  imports: [CrmModule, CommerceModule],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
