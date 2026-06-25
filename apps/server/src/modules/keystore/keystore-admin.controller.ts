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
} from '@nestjs/common';
import { KeystoreService } from './keystore.service';
import {
  CreateListingDto,
  DeliverFilesDto,
  SendMessageDto,
  UpdateListingDto,
  UpdateOrderStatusDto,
} from './dto';

@Controller('keystore/admin')
export class KeystoreAdminController {
  constructor(private readonly keystoreService: KeystoreService) {}

  // ── Dashboard Stats ─────────────────────────────────────────────────────

  @Get('stats')
  async getStats(@Request() req: { businessId: string }) {
    return this.keystoreService.getOrderStats(req.businessId);
  }

  // ── Order Management ────────────────────────────────────────────────────

  @Get('orders')
  async getAllOrders(
    @Request() req: { businessId: string },
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('listingId') listingId?: string,
  ) {
    return this.keystoreService.getAllOrders(req.businessId, {
      status,
      userId,
      listingId,
    });
  }

  @Get('orders/:id')
  async getOrder(
    @Request() req: { businessId: string },
    @Param('id') id: string,
  ) {
    return this.keystoreService.getOrder(req.businessId, id);
  }

  @Patch('orders/:id/status')
  async updateOrderStatus(
    @Request() req: { businessId: string; userId: string },
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.keystoreService.adminUpdateOrderStatus(
      req.businessId,
      id,
      dto,
      req.userId,
    );
  }

  @Post('orders/:id/messages')
  async sendMessage(
    @Request() req: { businessId: string; userId: string },
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.keystoreService.adminSendMessage(
      req.businessId,
      id,
      req.userId,
      dto,
    );
  }

  @Post('orders/:id/deliver')
  async deliverFiles(
    @Request() req: { businessId: string; userId: string },
    @Param('id') id: string,
    @Body() dto: DeliverFilesDto,
  ) {
    return this.keystoreService.deliverFiles(
      req.businessId,
      id,
      req.userId,
      dto,
    );
  }

  // ── Listing Management ──────────────────────────────────────────────────

  @Post('listings')
  async createListing(
    @Request() req: { businessId: string },
    @Body() dto: CreateListingDto,
  ) {
    return this.keystoreService.createListing(req.businessId, dto);
  }

  @Patch('listings/:id')
  async updateListing(
    @Request() req: { businessId: string },
    @Param('id') id: string,
    @Body() dto: UpdateListingDto,
  ) {
    return this.keystoreService.updateListing(req.businessId, id, dto);
  }

  @Delete('listings/:id/archive')
  async archiveListing(
    @Request() req: { businessId: string },
    @Param('id') id: string,
  ) {
    return this.keystoreService.archiveListing(req.businessId, id);
  }

  @Post('listings/:id/pause')
  async pauseListing(
    @Request() req: { businessId: string },
    @Param('id') id: string,
  ) {
    return this.keystoreService.pauseListing(req.businessId, id);
  }

  @Post('listings/:id/activate')
  async activateListing(
    @Request() req: { businessId: string },
    @Param('id') id: string,
  ) {
    return this.keystoreService.activateListing(req.businessId, id);
  }
}
