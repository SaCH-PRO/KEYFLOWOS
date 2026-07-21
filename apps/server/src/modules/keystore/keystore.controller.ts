// ─────────────────────────────────────────────────────────────────────────────
// KeyStore Service Marketplace — Public & User Controller
// ─────────────────────────────────────────────────────────────────────────────

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { KeystoreService } from './keystore.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import {
  CreateOrderDto,
  SendMessageDto,
  AcceptQuoteDto,
  RateOrderDto,
} from './dto';

function requireBusinessId(businessId?: string): string {
  if (!businessId) {
    throw new BadRequestException('businessId query parameter is required');
  }
  return businessId;
}

@Controller('keystore')
export class KeystoreController {
  constructor(private readonly keystoreService: KeystoreService) {}

  // ── Categories ──────────────────────────────────────────────────────────

  @Get('categories')
  async getCategories(@Query('businessId') businessId?: string) {
    return this.keystoreService.getCategories(requireBusinessId(businessId));
  }

  // ── Listings ────────────────────────────────────────────────────────────

  @Get('listings')
  async getListings(
    @Query('businessId') businessId?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.keystoreService.getListings(requireBusinessId(businessId), categoryId);
  }

  @Get('listings/:slug')
  async getListingBySlug(
    @Param('slug') slug: string,
    @Query('businessId') businessId?: string,
  ) {
    return this.keystoreService.getListingBySlug(requireBusinessId(businessId), slug);
  }

  // ── Orders ──────────────────────────────────────────────────────────────

  @Post('orders')
  @UseGuards(AuthGuard)
  async createOrder(
    @Request() req: { user: { id: string } },
    @Body() dto: CreateOrderDto,
    @Query('businessId') businessId?: string,
  ) {
    return this.keystoreService.createOrder(requireBusinessId(businessId), req.user.id, dto);
  }

  @Get('orders')
  @UseGuards(AuthGuard)
  async getMyOrders(
    @Request() req: { user: { id: string } },
    @Query('businessId') businessId?: string,
  ) {
    return this.keystoreService.getUserOrders(requireBusinessId(businessId), req.user.id);
  }

  @Get('orders/:id')
  @UseGuards(AuthGuard)
  async getOrder(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Query('businessId') businessId?: string,
  ) {
    return this.keystoreService.getOrder(requireBusinessId(businessId), id, req.user.id);
  }

  @Post('orders/:id/messages')
  @UseGuards(AuthGuard)
  async sendMessage(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
    @Query('businessId') businessId?: string,
  ) {
    return this.keystoreService.sendMessage(
      requireBusinessId(businessId),
      id,
      req.user.id,
      dto,
    );
  }

  @Post('orders/:id/accept-quote')
  @UseGuards(AuthGuard)
  async acceptQuote(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() dto: AcceptQuoteDto,
    @Query('businessId') businessId?: string,
  ) {
    return this.keystoreService.acceptQuote(
      requireBusinessId(businessId),
      id,
      req.user.id,
      dto,
    );
  }

  @Post('orders/:id/cancel')
  @UseGuards(AuthGuard)
  async cancelOrder(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body('reason') reason?: string,
    @Query('businessId') businessId?: string,
  ) {
    return this.keystoreService.cancelOrder(
      requireBusinessId(businessId),
      id,
      req.user.id,
      reason,
    );
  }

  @Post('orders/:id/rate')
  @UseGuards(AuthGuard)
  async rateOrder(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() dto: RateOrderDto,
    @Query('businessId') businessId?: string,
  ) {
    return this.keystoreService.rateOrder(
      requireBusinessId(businessId),
      id,
      req.user.id,
      dto,
    );
  }
}
