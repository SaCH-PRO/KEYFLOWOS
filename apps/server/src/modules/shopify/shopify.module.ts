import { Module } from '@nestjs/common';
import { ShopifyService } from './shopify.service';
import { ShopifyController } from './shopify.controller';
import { ConnectorCredentialsService } from '../../core/connectors/connector-credentials.service';

@Module({
  controllers: [ShopifyController],
  providers: [ShopifyService, ConnectorCredentialsService],
  exports: [ShopifyService],
})
export class ShopifyModule {}
