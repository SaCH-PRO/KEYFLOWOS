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
} from '@nestjs/common';
import { KeystoreService } from './keystore.service';
import {
  CreateOrderDto,
  SendMessageDto,
  AcceptQuoteDto,
  RateOrderDto,
} from './dto';

@Controller('keystore')
export class KeystoreController {
  constructor(private readonly keystoreService: KeystoreService) {}

  // ── Categories ──────────────────────────────────────────────────────────

  @Get('categories')
  async getCategories(@Request() req: { businessId: string }) {
    return this.keystoreService.getCategories(req.businessId);
  }

  // ── Listings ────────────────────────────────────────────────────────────

  @Get('listings')
  async getListings(
    @Request() req: { businessId: string },
    @Query('categoryId') categoryId?: string,
  ) {
    return this.keystoreService.getListings(req.businessId, categoryId);
  }

  @Get('listings/:slug')
  async getListingBySlug(
    @Request() req: { businessId: string },
    @Param('slug') slug: string,
  ) {
    return this.keystoreService.getListingBySlug(req.businessId, slug);
  }

  // ── Orders ──────────────────────────────────────────────────────────────

  @Post('orders')
  async createOrder(
    @Request() req: { businessId: string; userId: string },
    @Body() dto: CreateOrderDto,
  ) {
    return this.keystoreService.createOrder(req.businessId, req.userId, dto);
  }

  @Get('orders')
  async getMyOrders(@Request() req: { businessId: string; userId: string }) {
    return this.keystoreService.getUserOrders(req.businessId, req.userId);
  }

  @Get('orders/:id')
  async getOrder(
    @Request() req: { businessId: string; userId: string },
    @Param('id') id: string,
  ) {
    return this.keystoreService.getOrder(req.businessId, id, req.userId);
  }

  @Post('orders/:id/messages')
  async sendMessage(
    @Request() req: { businessId: string; userId: string },
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.keystoreService.sendMessage(
      req.businessId,
      id,
      req.userId,
      dto,
    );
  }

  @Post('orders/:id/accept-quote')
  async acceptQuote(
    @Request() req: { businessId: string; userId: string },
    @Param('id') id: string,
    @Body() dto: AcceptQuoteDto,
  ) {
    return this.keystoreService.acceptQuote(
      req.businessId,
      id,
      req.userId,
      dto,
    );
  }

  @Post('orders/:id/cancel')
  async cancelOrder(
    @Request() req: { businessId: string; userId: string },
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    return this.keystoreService.cancelOrder(
      req.businessId,
      id,
      req.userId,
      reason,
    );
  }

  @Post('orders/:id/rate')
  async rateOrder(
    @Request() req: { businessId: string; userId: string },
    @Param('id') id: string,
    @Body() dto: RateOrderDto,
  ) {
    return this.keystoreService.rateOrder(
      req.businessId,
      id,
      req.userId,
      dto,
    );
  }
}
