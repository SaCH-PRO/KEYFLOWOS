import { Module } from '@nestjs/common';
import { ChangeOrderService } from './change-order.service';
import { ChangeOrderController } from './change-order.controller';

@Module({
  providers: [ChangeOrderService],
  controllers: [ChangeOrderController],
  exports: [ChangeOrderService],
})
export class ChangeOrderModule {}
