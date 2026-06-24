import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AuthModule } from '../../core/auth/auth.module';
import { DeliveryNoteService } from './delivery-note.service';
import { DeliveryNoteController } from './delivery-note.controller';
import { PaymentReceiptService } from './payment-receipt.service';
import { ReceiptController } from './receipt.controller';
import { GoodsReceiptService } from './goods-receipt.service';
import { GoodsReceiptController } from './goods-receipt.controller';
import { StockCountService } from './stock-count.service';
import { StockCountController } from './stock-count.controller';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [
    DeliveryNoteController,
    ReceiptController,
    GoodsReceiptController,
    StockCountController,
  ],
  providers: [
    DeliveryNoteService,
    PaymentReceiptService,
    GoodsReceiptService,
    StockCountService,
  ],
  exports: [
    DeliveryNoteService,
    PaymentReceiptService,
    GoodsReceiptService,
    StockCountService,
  ],
})
export class ContinentalOpsModule {}
