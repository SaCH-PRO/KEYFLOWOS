// @keyflow:dormant — UI surface gated by featureFlags (KEY-9 cleanup target).
import { Controller, Get, Param, Inject } from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';

@Controller('marketplace')
export class MarketplacePublicController {
  constructor(@Inject(MarketplaceService) private readonly marketplaceService: MarketplaceService) {}

  @Get('order-status/:token')
  getPublicOrderStatus(@Param('token') token: string) {
    return this.marketplaceService.getOrderByToken(token);
  }
}
