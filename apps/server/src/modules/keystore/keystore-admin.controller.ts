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
import { KeystoreService } from './keystore.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import {
  CreateListingDto,
  DeliverFilesDto,
  SendMessageDto,
  UpdateListingDto,
  UpdateOrderStatusDto,
} from './dto';

@Controller('keystore/admin')
@UseGuards(AuthGuard)
export class KeystoreAdminController {
  constructor(private readonly keystoreService: KeystoreService) {}

  // ── Dashboard Stats ─────────────────────────────────────────────────────

  @Get('stats')
  async getStats(@Request() req: { user: { id: string } }) {
    const businessId = await this.keystoreService.businessIdForUser(req.user.id);
    return this.keystoreService.getOrderStats(businessId);
  }

  // ── Order Management ────────────────────────────────────────────────────

  @Get('orders')
  async getAllOrders(
    @Request() req: { user: { id: string } },
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('listingId') listingId?: string,
  ) {
    const businessId = await this.keystoreService.businessIdForUser(req.user.id);
    return this.keystoreService.getAllOrders(businessId, {
      status,
      userId,
      listingId,
    });
  }

  @Get('orders/:id')
  async getOrder(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    const businessId = await this.keystoreService.businessIdForUser(req.user.id);
    return this.keystoreService.getOrder(businessId, id);
  }

  @Patch('orders/:id/status')
  async updateOrderStatus(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    const businessId = await this.keystoreService.businessIdForUser(req.user.id);
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
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ) {
    const businessId = await this.keystoreService.businessIdForUser(req.user.id);
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
    @Param('id') id: string,
    @Body() dto: DeliverFilesDto,
  ) {
    const businessId = await this.keystoreService.businessIdForUser(req.user.id);
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
    @Request() req: { user: { id: string } },
    @Body() dto: CreateListingDto,
  ) {
    const businessId = await this.keystoreService.businessIdForUser(req.user.id);
    return this.keystoreService.createListing(businessId, dto);
  }

  @Patch('listings/:id')
  async updateListing(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() dto: UpdateListingDto,
  ) {
    const businessId = await this.keystoreService.businessIdForUser(req.user.id);
    return this.keystoreService.updateListing(businessId, id, dto);
  }

  @Delete('listings/:id/archive')
  async archiveListing(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    const businessId = await this.keystoreService.businessIdForUser(req.user.id);
    return this.keystoreService.archiveListing(businessId, id);
  }

  @Post('listings/:id/pause')
  async pauseListing(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    const businessId = await this.keystoreService.businessIdForUser(req.user.id);
    return this.keystoreService.pauseListing(businessId, id);
  }

  @Post('listings/:id/activate')
  async activateListing(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    const businessId = await this.keystoreService.businessIdForUser(req.user.id);
    return this.keystoreService.activateListing(businessId, id);
  }
}
