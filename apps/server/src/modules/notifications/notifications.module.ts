import { Module, forwardRef } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { TransactionalEmailService } from './transactional-email.service';
import { CommerceModule } from '../commerce/commerce.module';

@Module({
  imports: [forwardRef(() => CommerceModule)],
  controllers: [NotificationsController],
  providers: [NotificationsService, TransactionalEmailService],
  exports: [NotificationsService, TransactionalEmailService],
})
export class NotificationsModule {}
