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
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { IntegrationHubService } from './integration-hub.service';
import { PrismaService } from '../../core/prisma/prisma.service';

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
   * credential) needs settings admin, as every other credential binding does.
   *
   * SWEEP-P0-FOLLOWUP (census owner question 11, answered by default): settings admin alone. The binding had
   * needed connect write as well, and `connect` is none for every role by deliberate decision
   * (module-vocabulary.ts), so on role defaults nobody could bind an integration. OWNER and ADMIN bind on role
   * defaults now; connect write is kept for the hub's sync runs (POST sync-runs/:providerKey) and the provider
   * seed, and a member granted connect write alone still binds nothing.
   */
  @Post('connections/:providerKey')
  @RequireModuleScope('settings', 'admin')
  async connect(
    @Param('businessId') businessId: string,
    @Param('providerKey') providerKey: string,
    @Body() body: { authDataRef?: string; scopes?: string[]; settings?: Record<string, unknown> },
  ) {
    return this.hub.createConnection(businessId, providerKey, body);
  }

  // SWEEP-P0-FOLLOWUP (owner question 11): settings admin alone; see connect.
  @Delete('connections/:providerKey')
  @RequireModuleScope('settings', 'admin')
  async disconnect(
    @Param('businessId') businessId: string,
    @Param('providerKey') providerKey: string,
  ) {
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
