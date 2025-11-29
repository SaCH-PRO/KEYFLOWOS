import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { CommerceModule } from '../commerce/commerce.module';

@Module({
  imports: [CommerceModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
