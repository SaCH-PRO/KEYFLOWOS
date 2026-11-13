import { Controller, Get, Post, Delete, Param, Body, Inject, Req, UseGuards } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';

/**
 * SWEEP-P0-SCOPES (browser sweep BUG-013): API keys are settings admin territory. Every route here
 * ran AuthGuard and BusinessGuard only, so a STAFF member whose scope map said settings 'none'
 * created API keys (the raw kf_ key in the answer) and revoked the owner's key. Now every route runs
 * ModuleScopeGuard after BusinessGuard: listing needs settings read (the list carries no key
 * material: name, prefix, scopes, dates), creating needs settings admin (OWNER and ADMIN by role
 * default; an explicit map binds every role, D-114 / D-140). Revoking needs settings admin AND the
 * owner-level right (ApiKeysService.assertMayRevoke: an OWNER membership, D-116 / D-125): a key
 * records no creator (ApiKey has no such column, and this packet makes no schema change), so any
 * key may be the owner's or another member's, and no one below the owner revokes it.
 */
@Controller('api/businesses/:businessId/api-keys')
export class ApiKeysController {
  constructor(@Inject(ApiKeysService) private readonly apiKeysService: ApiKeysService) {}

  @Get()
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('settings', 'read')
  async list(@Param('businessId') businessId: string) {
    const keys = await this.apiKeysService.listKeys(businessId);
    return { keys };
  }

  @Post()
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('settings', 'admin')
  async create(
    @Param('businessId') businessId: string,
    @Body() body: { name: string; scopes: string[] },
  ) {
    return this.apiKeysService.createKey(businessId, body.name, body.scopes ?? []);
  }

  @Delete(':keyId')
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('settings', 'admin')
  async revoke(
    @Param('businessId') businessId: string,
    @Param('keyId') keyId: string,
    @Req() req: { user?: { id?: string; role?: string } },
  ) {
    await this.apiKeysService.assertMayRevoke(businessId, req?.user);
    await this.apiKeysService.revokeKey(businessId, keyId);
    return { success: true };
  }
}
