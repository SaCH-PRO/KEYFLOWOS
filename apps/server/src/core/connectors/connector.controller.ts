import { Controller, Get, Post, Param, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { ConnectorRegistryService } from './connector-registry.service';
import { ConnectorActivityService } from './connector-activity.service';
import { AuthGuard } from '../auth/auth.guard';
import { BusinessGuard } from '../auth/business.guard';
import type { ConnectorType } from './connector.interface';

@Controller('connectors')
@UseGuards(AuthGuard, BusinessGuard)
export class ConnectorController {
  constructor(
    private readonly registry: ConnectorRegistryService,
    private readonly activity: ConnectorActivityService,
  ) {}

  @Get('businesses/:businessId/dashboard')
  async getDashboard(@Param('businessId') businessId: string) {
    return this.registry.getDashboard(businessId);
  }

  @Get('businesses/:businessId/list')
  listConnectors() {
    return this.registry.list();
  }

  @Get('businesses/:businessId/statuses')
  async getStatuses(@Param('businessId') businessId: string) {
    return this.registry.getStatuses(businessId);
  }

  @Get('businesses/:businessId/health/:type')
  async getHealth(
    @Param('businessId') businessId: string,
    @Param('type') type: string,
  ) {
    const health = await this.registry.getHealth(type as ConnectorType, businessId);
    if (!health) throw new BadRequestException(`Connector ${type} not found`);
    return health;
  }

  @Post('businesses/:businessId/sync/:type')
  async sync(
    @Param('businessId') businessId: string,
    @Param('type') type: string,
  ) {
    try {
      return await this.registry.syncConnector(type as ConnectorType, businessId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Sync failed';
      throw new BadRequestException(message);
    }
  }

  @Post('businesses/:businessId/disconnect/:type')
  async disconnect(
    @Param('businessId') businessId: string,
    @Param('type') type: string,
  ) {
    try {
      await this.registry.disconnectConnector(type as ConnectorType, businessId);
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Disconnect failed';
      throw new BadRequestException(message);
    }
  }

  @Post('businesses/:businessId/authenticate/:type')
  async authenticate(
    @Param('businessId') businessId: string,
    @Param('type') type: string,
  ) {
    try {
      return await this.registry.authenticateConnector(type as ConnectorType, businessId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Authentication failed';
      throw new BadRequestException(message);
    }
  }

  @Post('businesses/:businessId/reconnect/:type')
  async reconnect(
    @Param('businessId') businessId: string,
    @Param('type') type: string,
  ) {
    try {
      return await this.registry.reconnectConnector(type as ConnectorType, businessId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Reconnect failed';
      throw new BadRequestException(message);
    }
  }

  @Post('businesses/:businessId/test/:type')
  async test(
    @Param('businessId') businessId: string,
    @Param('type') type: string,
  ) {
    try {
      return await this.registry.testConnector(type as ConnectorType, businessId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Test failed';
      throw new BadRequestException(message);
    }
  }

  @Get('businesses/:businessId/activity')
  async listActivity(
    @Param('businessId') businessId: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
    @Query('since') since?: string,
  ) {
    let sinceDate: Date | undefined;
    if (since) {
      const parsed = new Date(since);
      if (!Number.isNaN(parsed.getTime())) sinceDate = parsed;
    }
    return this.activity.list(businessId, {
      connectorType: type ? (type as ConnectorType) : undefined,
      limit: limit ? Number.parseInt(limit, 10) : undefined,
      since: sinceDate,
    });
  }
}
