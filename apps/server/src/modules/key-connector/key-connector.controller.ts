import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { KeyConnectorService } from './key-connector.service';
import { ConnectProviderDto, AiCommandDto } from './dto';
import {
  AiGatewayCommand,
  ConnectionStatus,
} from './key-connector.types';

/**
 * ── Key Connector Controller ───────────────────────────────────────────
 * REST API surface for the universal connector module.
 *
 * Base path: /key-connector
 *
 * Endpoints:
 *   GET    /providers                  — List providers with connection status
 *   GET    /providers/:key             — Single provider detail
 *   POST   /providers/:key/connect     — Create a connection
 *   DELETE /connections/:id            — Remove a connection
 *   GET    /connections                — List connections
 *   GET    /health                     — Health check all connections
 *   POST   /sync/:id/trigger           — Trigger a sync
 *   GET    /sync                       — Sync history
 *   POST   /ai/command                 — Execute an AI command
 *   GET    /audit                      — Audit log
 * ───────────────────────────────────────────────────────────────────────
 */

@UseGuards(AuthGuard, BusinessGuard)
@Controller('key-connector')
export class KeyConnectorController {
  constructor(private readonly service: KeyConnectorService) {}

  // ── Provider Discovery ──────────────────────────────────────────────

  @Get('providers')
  async getProviders(
    @Query('businessId') businessId: string,
    @Query('category') category?: string,
  ) {
    const result = await this.service.getProviders(businessId, category);
    return { success: true, data: result };
  }

  @Get('providers/:key')
  async getProviderDetail(
    @Query('businessId') businessId: string,
    @Param('key') providerKey: string,
  ) {
    const result = await this.service.getProviderDetail(
      businessId,
      providerKey,
    );
    return { success: true, data: result };
  }

  @Post('providers/:key/connect')
  @HttpCode(HttpStatus.CREATED)
  async connectProvider(
    @Query('businessId') businessId: string,
    @Param('key') providerKey: string,
    @Body() dto: ConnectProviderDto,
    @Req() req: Request & { user?: { id?: string } },
  ) {
    const userId = req.user?.id ?? '';
    const result = await this.service.connectProvider(
      businessId,
      userId,
      providerKey,
      dto.authData ?? {},
      dto.settings,
      dto.displayName,
    );
    return { success: true, data: result };
  }

  // ── Connection Management ───────────────────────────────────────────

  @Delete('connections/:id')
  @HttpCode(HttpStatus.OK)
  async disconnectProvider(
    @Query('businessId') businessId: string,
    @Param('id') connectionId: string,
    @Req() req: Request & { user?: { id?: string } },
  ) {
    const userId = req.user?.id ?? '';
    await this.service.disconnectProvider(businessId, connectionId, userId);
    return { success: true, message: 'Connection removed' };
  }

  @Get('connections')
  async getConnections(@Query('businessId') businessId: string,
  ) {
    const result = await this.service.getConnections(businessId);
    return { success: true, data: result };
  }

  // ── Health ──────────────────────────────────────────────────────────

  @Get('health')
  async getHealth(@Query('businessId') businessId: string,
  ) {
    const result = await this.service.getConnectionHealth(businessId);
    return { success: true, data: result };
  }

  // ── Sync ────────────────────────────────────────────────────────────

  @Post('sync/:id/trigger')
  @HttpCode(HttpStatus.ACCEPTED)
  async triggerSync(
    @Query('businessId') businessId: string,
    @Param('id') connectionId: string,
    @Query('direction')
    direction: 'inbound' | 'outbound' | 'bidirectional' = 'bidirectional',
  ) {
    const result = await this.service.triggerSync(
      businessId,
      connectionId,
      direction,
    );
    return { success: true, data: result };
  }

  @Get('sync')
  async getSyncHistory(
    @Query('businessId') businessId: string,
    @Query('connectionId') connectionId?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.service.getSyncHistory(
      businessId,
      connectionId,
      limit ? parseInt(limit, 10) : 50,
    );
    return { success: true, data: result };
  }

  // ── AI Gateway ──────────────────────────────────────────────────────

  @Post('ai/command')
  @HttpCode(HttpStatus.OK)
  async executeAiCommand(
    @Query('businessId') businessId: string,
    @Body() dto: AiCommandDto,
    @Req() req: Request & { user?: { id?: string } },
  ) {
    const userId = req.user?.id ?? '';

    const command: AiGatewayCommand = {
      intent: dto.command,
      parameters: {
        originalText: dto.command,
        ...(dto.context ?? {}),
      },
      businessId,
      userId,
    };

    const result = await this.service.processAiCommand(
      businessId,
      userId,
      command,
    );
    return { success: result.success, data: result.data, error: result.error };
  }

  // ── Audit ───────────────────────────────────────────────────────────

  @Get('audit')
  async getAuditLog(
    @Query('businessId') businessId: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.service.getAuditLog(
      businessId,
      limit ? parseInt(limit, 10) : 100,
    );
    return { success: true, data: result };
  }

}
