import { Module, forwardRef } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { TransactionalEmailService } from './transactional-email.service';
import { SystemEmailService } from './system-email.service';
import { CommerceModule } from '../commerce/commerce.module';

@Module({
  imports: [forwardRef(() => CommerceModule)],
  controllers: [NotificationsController],
  providers: [NotificationsService, TransactionalEmailService, SystemEmailService],
  exports: [NotificationsService, TransactionalEmailService, SystemEmailService],
})
export class NotificationsModule {}
