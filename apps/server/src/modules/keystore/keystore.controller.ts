// ─────────────────────────────────────────────────────────────────────────────
// KeyStore Service Marketplace — Public & User Controller
// ─────────────────────────────────────────────────────────────────────────────

import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { KeystoreService } from './keystore.service';
import {
  CreateOrderDto,
  SendMessageDto,
  AcceptQuoteDto,
  RateOrderDto,
} from './dto';

@UseGuards(AuthGuard, BusinessGuard)
@Controller('keystore')
export class KeystoreController {
  constructor(private readonly keystoreService: KeystoreService) {}

  // ── Categories ──────────────────────────────────────────────────────────

  @Get('categories')
  async getCategories(@Query('businessId') businessId: string) {
    return this.keystoreService.getCategories(businessId);
  }

  // ── Listings ────────────────────────────────────────────────────────────

  @Get('listings')
  async getListings(
    @Query('businessId') businessId: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.keystoreService.getListings(businessId, categoryId);
  }

  @Get('listings/:slug')
  async getListingBySlug(
    @Query('businessId') businessId: string,
    @Param('slug') slug: string,
  ) {
    return this.keystoreService.getListingBySlug(businessId, slug);
  }

  // ── Orders ──────────────────────────────────────────────────────────────

  @Post('orders')
  async createOrder(
    @Request() req: { user: { id: string } },
    @Body('businessId') businessId: string,
    @Body() dto: CreateOrderDto,
  ) {
    return this.keystoreService.createOrder(businessId, req.user.id, dto);
  }

  @Get('orders')
  async getMyOrders(
    @Request() req: { user: { id: string } },
    @Query('businessId') businessId: string,
  ) {
    return this.keystoreService.getUserOrders(businessId, req.user.id);
  }

  @Get('orders/:id')
  async getOrder(
    @Request() req: { user: { id: string } },
    @Query('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.keystoreService.getOrder(businessId, id, req.user.id);
  }

  @Post('orders/:id/messages')
  async sendMessage(
    @Request() req: { user: { id: string } },
    @Body('businessId') businessId: string,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.keystoreService.sendMessage(
      businessId,
      id,
      req.user.id,
      dto,
    );
  }

  @Post('orders/:id/accept-quote')
  async acceptQuote(
    @Request() req: { user: { id: string } },
    @Body('businessId') businessId: string,
    @Param('id') id: string,
    @Body() dto: AcceptQuoteDto,
  ) {
    return this.keystoreService.acceptQuote(
      businessId,
      id,
      req.user.id,
      dto,
    );
  }

  @Post('orders/:id/cancel')
  async cancelOrder(
    @Request() req: { user: { id: string } },
    @Body('businessId') businessId: string,
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    return this.keystoreService.cancelOrder(
      businessId,
      id,
      req.user.id,
      reason,
    );
  }

  @Post('orders/:id/rate')
  async rateOrder(
    @Request() req: { user: { id: string } },
    @Body('businessId') businessId: string,
    @Param('id') id: string,
    @Body() dto: RateOrderDto,
  ) {
    return this.keystoreService.rateOrder(
      businessId,
      id,
      req.user.id,
      dto,
    );
  }
}
