// ─────────────────────────────────────────────────────────────────────────────
// KeyStore Service Marketplace — Admin Controller
// ─────────────────────────────────────────────────────────────────────────────

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { KeystoreService } from './keystore.service';
import {
  CreateListingDto,
  DeliverFilesDto,
  SendMessageDto,
  UpdateListingDto,
  UpdateOrderStatusDto,
} from './dto';

@UseGuards(AuthGuard, BusinessGuard)
@Controller('keystore/admin')
export class KeystoreAdminController {
  constructor(private readonly keystoreService: KeystoreService) {}

  // ── Dashboard Stats ─────────────────────────────────────────────────────

  @Get('stats')
  async getStats(@Query('businessId') businessId: string) {
    return this.keystoreService.getOrderStats(businessId);
  }

  // ── Order Management ────────────────────────────────────────────────────

  @Get('orders')
  async getAllOrders(
    @Query('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('listingId') listingId?: string,
  ) {
    return this.keystoreService.getAllOrders(businessId, {
      status,
      userId,
      listingId,
    });
  }

  @Get('orders/:id')
  async getOrder(
    @Query('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.keystoreService.getOrder(businessId, id);
  }

  @Patch('orders/:id/status')
  async updateOrderStatus(
    @Request() req: { user: { id: string } },
    @Body('businessId') businessId: string,
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.keystoreService.adminUpdateOrderStatus(
      businessId,
      id,
      dto,
      req.user.id,
    );
  }

  @Post('orders/:id/messages')
  async sendMessage(
    @Request() req: { user: { id: string } },
    @Body('businessId') businessId: string,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.keystoreService.adminSendMessage(
      businessId,
      id,
      req.user.id,
      dto,
    );
  }

  @Post('orders/:id/deliver')
  async deliverFiles(
    @Request() req: { user: { id: string } },
    @Body('businessId') businessId: string,
    @Param('id') id: string,
    @Body() dto: DeliverFilesDto,
  ) {
    return this.keystoreService.deliverFiles(
      businessId,
      id,
      req.user.id,
      dto,
    );
  }

  // ── Listing Management ──────────────────────────────────────────────────

  @Post('listings')
  async createListing(
    @Body('businessId') businessId: string,
    @Body() dto: CreateListingDto,
  ) {
    return this.keystoreService.createListing(businessId, dto);
  }

  @Patch('listings/:id')
  async updateListing(
    @Body('businessId') businessId: string,
    @Param('id') id: string,
    @Body() dto: UpdateListingDto,
  ) {
    return this.keystoreService.updateListing(businessId, id, dto);
  }

  @Delete('listings/:id/archive')
  async archiveListing(
    @Query('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.keystoreService.archiveListing(businessId, id);
  }

  @Post('listings/:id/pause')
  async pauseListing(
    @Body('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.keystoreService.pauseListing(businessId, id);
  }

  @Post('listings/:id/activate')
  async activateListing(
    @Body('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.keystoreService.activateListing(businessId, id);
  }
}
