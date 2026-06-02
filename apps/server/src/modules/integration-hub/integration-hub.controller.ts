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

@Controller('integration-hub/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class IntegrationHubController {
  constructor(@Inject(IntegrationHubService) private readonly hub: IntegrationHubService) {}

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

  @Post('connections/:providerKey')
  @RequireModuleScope('connect', 'write')
  async connect(
    @Param('businessId') businessId: string,
    @Param('providerKey') providerKey: string,
    @Body() body: { authDataRef?: string; scopes?: string[]; settings?: Record<string, unknown> },
  ) {
    return this.hub.createConnection(businessId, providerKey, body);
  }

  @Delete('connections/:providerKey')
  @RequireModuleScope('connect', 'write')
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
