import { Module } from '@nestjs/common';
import { CommerceController } from './commerce.controller';
import { CommerceService } from './commerce.service';
import { ReceiptService } from './receipt.service';

@Module({
  controllers: [CommerceController],
  providers: [CommerceService, ReceiptService],
  exports: [CommerceService],
})
export class CommerceModule {}
