import { Controller, Get, Post, Delete, Param, Body, Inject, UseGuards } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';

/**
 * SWEEP-P0-SCOPES (browser sweep BUG-013): API keys are settings admin territory. Every route here
 * ran AuthGuard and BusinessGuard only, so a STAFF member whose scope map said settings 'none'
 * created API keys (the raw kf_ key in the answer) and revoked the owner's key. Now every route runs
 * ModuleScopeGuard after BusinessGuard: listing needs settings read (the list carries no key
 * material: name, prefix, scopes, dates), creating and revoking need settings admin (OWNER and
 * ADMIN by role default; an explicit map binds every role, D-114 / D-140).
 *
 * Review repair CR-3: revoking was also held to an OWNER membership, which no ruling asks (D-11 is
 * the business profile; D-116 / D-125 say who the owner is, not which actions are the owner's), and
 * which left an ADMIN able to create a key but never to revoke one, a leaked one included. Settings
 * admin alone closes BUG-013 (a STAFF member with settings none revoking the owner's key). Whether
 * revoking should be owner-only (a key records no creator) stays an owner question in the census.
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
  ) {
    await this.apiKeysService.revokeKey(businessId, keyId);
    return { success: true };
  }
}
