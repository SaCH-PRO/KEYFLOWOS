import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CrmModule } from '../crm/crm.module';
import { PublicEventsModule } from '../public-events/public-events.module';
import { SiteController } from './site.controller';
import { SiteService } from './site.service';
import { StoreOrderService } from './store-order.service';
import { PromoCodeService } from './promo-code.service';
import { IntakeService } from './intake.service';
import { QualificationService } from './qualification.service';
import { PresenceController } from './presence/presence.controller';
import { PresenceService } from './presence/presence.service';

@Module({
  imports: [
    PrismaModule,
    AiModule,
    PaymentsModule,
    NotificationsModule,
    CrmModule,
    forwardRef(() => PublicEventsModule),
  ],
  controllers: [SiteController, PresenceController],
  providers: [SiteService, StoreOrderService, PromoCodeService, IntakeService, QualificationService, PresenceService],
  exports: [SiteService, StoreOrderService, PromoCodeService, IntakeService, QualificationService, PresenceService],
})
export class SiteModule {}
