import { Module, forwardRef } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { TransactionalEmailService } from './transactional-email.service';
import { SystemEmailService } from './system-email.service';
import { NotificationsRevenueListener } from './notifications-revenue.listener';
import { OwnerAlertsListener } from './owner-alerts.listener';
import { PushNotificationModule } from '../push-notifications/push-notification.module';
// CommerceModule is intentionally NOT statically imported here. The dependency
// chain notifications -> commerce -> crm -> connector -> notifications is a
// circular cycle, and a static `import { CommerceModule }` triggers eager
// evaluation of the entire chain at load time, producing a TDZ
// "Cannot access 'NotificationsModule' before initialization" error under
// SWC/tsx. A type-only import keeps the type alias for forwardRef while
// erasing the runtime side effect, and `require()` lazily resolves the real
// module inside the deferred forwardRef callback.
import type { CommerceModule as CommerceModuleType } from '../commerce/commerce.module';

@Module({
  imports: [
    PushNotificationModule,
    forwardRef(
      async () =>
        (await import('../commerce/commerce.module')).CommerceModule,
    ),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, TransactionalEmailService, SystemEmailService, NotificationsRevenueListener, OwnerAlertsListener],
  exports: [NotificationsService, TransactionalEmailService, SystemEmailService],
})
export class NotificationsModule {}
