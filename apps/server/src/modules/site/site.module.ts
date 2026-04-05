import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { PaymentsModule } from '../payments/payments.module';
import { SiteController } from './site.controller';
import { SiteService } from './site.service';
import { StoreOrderService } from './store-order.service';
import { PromoCodeService } from './promo-code.service';

@Module({
  imports: [PrismaModule, AiModule, PaymentsModule],
  controllers: [SiteController],
  providers: [SiteService, StoreOrderService, PromoCodeService],
  exports: [SiteService, StoreOrderService, PromoCodeService],
})
export class SiteModule {}
