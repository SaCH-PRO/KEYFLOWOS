import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, UseGuards, Inject,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { RateLimit } from '../../core/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../../core/guards/rate-limit.guard';
import { PortalService } from './portal.service';

@Controller('portal')
export class PortalController {
  constructor(
    @Inject(PortalService) private readonly service: PortalService,
  ) {}

  @Post('businesses/:businessId/access')
  @UseGuards(AuthGuard, BusinessGuard, RateLimitGuard)
  @RateLimit(20, 60_000)
  async createAccess(
    @Param('businessId') businessId: string,
    @Body() body: { contactId: string; settings?: Record<string, boolean> },
  ) {
    return this.service.createAccess(businessId, body.contactId, body.settings);
  }

  @Get('businesses/:businessId/access')
  @UseGuards(AuthGuard, BusinessGuard, RateLimitGuard)
  @RateLimit(60, 60_000)
  async listAccess(@Param('businessId') businessId: string) {
    return this.service.list(businessId);
  }

  @Patch('businesses/:businessId/access/:id')
  @UseGuards(AuthGuard, BusinessGuard, RateLimitGuard)
  @RateLimit(20, 60_000)
  async updateSettings(
    @Param('id') id: string,
    @Param('businessId') businessId: string,
    @Body() body: { settings: Record<string, boolean> },
  ) {
    return this.service.updateSettings(id, businessId, body.settings);
  }

  @Delete('businesses/:businessId/access/:id')
  @UseGuards(AuthGuard, BusinessGuard, RateLimitGuard)
  @RateLimit(20, 60_000)
  async revokeAccess(
    @Param('id') id: string,
    @Param('businessId') businessId: string,
  ) {
    return this.service.revoke(id, businessId);
  }

  @Get('validate')
  @RateLimit(60, 60_000)
  async validateToken(@Query('token') token: string) {
    const access = await this.service.findByToken(token);
    if (!access) return { valid: false };
    await this.service.recordAccess(token);
    return { valid: true, businessId: access.businessId, contactId: access.contactId, settings: access.settings };
  }
}
