import { Module } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppNotificationsListener } from './whatsapp-notifications.listener';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EntityResolutionService } from '../../core/connectors/entity-resolution.service';

@Module({
  providers: [WhatsAppService, WhatsAppNotificationsListener, PrismaService, EntityResolutionService],
  controllers: [WhatsAppController],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
