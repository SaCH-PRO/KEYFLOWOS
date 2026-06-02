import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { PushNotificationController } from './push-notification.controller';
import { PushNotificationService } from './push-notification.service';

@Module({
  imports: [PrismaModule],
  controllers: [PushNotificationController],
  providers: [PushNotificationService],
  exports: [PushNotificationService],
})
export class PushNotificationModule {}
