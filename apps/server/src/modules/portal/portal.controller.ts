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

  /**
   * Public, unauthenticated portal token check (CF-46 / M38, V1-14).
   *
   * This carried @RateLimit(60, 60_000) with no RateLimitGuard. The decorator
   * only writes metadata, and RateLimitGuard is not an APP_GUARD, so nothing
   * read it: anyone could test portal tokens at any rate, and every hit on a
   * live one wrote lastAccessedAt / accessCount. The guard now runs, keyed on
   * caller IP and this handler, before the token is looked up.
   *
   * `token` is whatever the query string held: missing, an array for a
   * repeated key, or an object for `token[x]=`. Only a non-empty string is a
   * token; anything else answers { valid: false } like an unknown one, instead
   * of reaching Prisma and surfacing as a 500.
   */
  @Get('validate')
  @UseGuards(RateLimitGuard)
  @RateLimit(60, 60_000)
  async validateToken(@Query('token') token: unknown) {
    if (typeof token !== 'string' || token.length === 0) return { valid: false };
    const access = await this.service.findByToken(token);
    if (!access) return { valid: false };
    await this.service.recordAccess(token);
    return { valid: true, businessId: access.businessId, contactId: access.contactId, settings: access.settings };
  }
}
