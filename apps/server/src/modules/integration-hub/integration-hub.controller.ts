import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Inject,
  Req,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { IntegrationHubService } from './integration-hub.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { assertMemberModuleLevel } from '../../core/auth/member-module-level';

/** The member a route acts for (AuthMiddleware attaches it; AuthGuard requires it). */
type HubActorRequest = { user?: { id?: string; role?: string } };

@Controller('integration-hub/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class IntegrationHubController {
  constructor(
    @Inject(IntegrationHubService) private readonly hub: IntegrationHubService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get('providers')
  @RequireModuleScope('connect', 'read')
  async listProviders(@Query('category') category?: string) {
    return this.hub.listProviders(category);
  }

  @Post('providers/seed')
  @RequireModuleScope('connect', 'write')
  async seedProviders() {
    return this.hub.seedProviders();
  }

  @Get('dashboard')
  @RequireModuleScope('connect', 'read')
  async getDashboard(@Param('businessId') businessId: string) {
    return this.hub.getDashboard(businessId);
  }

  /**
   * SWEEP-P0-SCOPES round 1 class repair (CLASS B; found by the census call graph, CEN-10b): binding
   * and unbinding an integration (IntegrationConnection.authDataRef, the reference to its stored
   * credential) also needs settings admin, as every other credential binding does. Connect write
   * (ModuleScopeGuard) stays: `connect` is none for every role by deliberate decision
   * (module-vocabulary.ts) and reachable only through an explicit grant, so the binding now needs
   * both; a STAFF member granted connect write alone no longer binds the business's integration.
   */
  @Post('connections/:providerKey')
  @RequireModuleScope('connect', 'write')
  async connect(
    @Param('businessId') businessId: string,
    @Param('providerKey') providerKey: string,
    @Body() body: { authDataRef?: string; scopes?: string[]; settings?: Record<string, unknown> },
    @Req() req?: HubActorRequest,
  ) {
    await assertMemberModuleLevel(this.prisma, businessId, req?.user, 'settings', 'admin');
    return this.hub.createConnection(businessId, providerKey, body);
  }

  @Delete('connections/:providerKey')
  @RequireModuleScope('connect', 'write')
  async disconnect(
    @Param('businessId') businessId: string,
    @Param('providerKey') providerKey: string,
    @Req() req?: HubActorRequest,
  ) {
    await assertMemberModuleLevel(this.prisma, businessId, req?.user, 'settings', 'admin');
    return this.hub.disconnect(businessId, providerKey);
  }

  @Get('sync-runs')
  @RequireModuleScope('connect', 'read')
  async listSyncRuns(
    @Param('businessId') businessId: string,
    @Query('providerKey') providerKey?: string,
    @Query('limit') limit?: string,
  ) {
    return this.hub.listSyncRuns(businessId, providerKey, limit ? parseInt(limit, 10) : 50);
  }

  @Post('sync-runs/:providerKey')
  @RequireModuleScope('connect', 'write')
  async recordSync(
    @Param('businessId') businessId: string,
    @Param('providerKey') providerKey: string,
    @Body()
    body: {
      connectionId: string;
      status: string;
      recordsRead?: number;
      recordsCreated?: number;
      recordsUpdated?: number;
      error?: string;
      meta?: Record<string, unknown>;
    },
  ) {
    return this.hub.recordSyncRun(businessId, body.connectionId, providerKey, body);
  }
}
