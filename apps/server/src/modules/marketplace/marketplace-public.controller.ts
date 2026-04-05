import { Controller, Get, Param } from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';

@Controller('marketplace')
export class MarketplacePublicController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  @Get('order-status/:token')
  getPublicOrderStatus(@Param('token') token: string) {
    return this.marketplaceService.getOrderByToken(token);
  }
}
