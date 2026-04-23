import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SiteController } from './site.controller';
import { SiteService } from './site.service';
import { StoreOrderService } from './store-order.service';
import { PromoCodeService } from './promo-code.service';
import { IntakeService } from './intake.service';
import { QualificationService } from './qualification.service';

@Module({
  imports: [PrismaModule, AiModule, PaymentsModule, NotificationsModule],
  controllers: [SiteController],
  providers: [SiteService, StoreOrderService, PromoCodeService, IntakeService, QualificationService],
  exports: [SiteService, StoreOrderService, PromoCodeService, IntakeService, QualificationService],
})
export class SiteModule {}
