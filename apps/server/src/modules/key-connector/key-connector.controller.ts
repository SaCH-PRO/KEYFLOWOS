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
} from '@nestjs/common';
import { Request } from 'express';
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

@Controller('key-connector')
export class KeyConnectorController {
  constructor(private readonly service: KeyConnectorService) {}

  // ── Provider Discovery ──────────────────────────────────────────────

  @Get('providers')
  async getProviders(
    @Req() req: Request,
    @Query('category') category?: string,
  ) {
    const businessId = this.extractBusinessId(req);
    const result = await this.service.getProviders(businessId, category);
    return { success: true, data: result };
  }

  @Get('providers/:key')
  async getProviderDetail(
    @Req() req: Request,
    @Param('key') providerKey: string,
  ) {
    const businessId = this.extractBusinessId(req);
    const result = await this.service.getProviderDetail(
      businessId,
      providerKey,
    );
    return { success: true, data: result };
  }

  @Post('providers/:key/connect')
  @HttpCode(HttpStatus.CREATED)
  async connectProvider(
    @Req() req: Request,
    @Param('key') providerKey: string,
    @Body() dto: ConnectProviderDto,
  ) {
    const businessId = this.extractBusinessId(req);
    const userId = this.extractUserId(req);
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
    @Req() req: Request,
    @Param('id') connectionId: string,
  ) {
    const businessId = this.extractBusinessId(req);
    const userId = this.extractUserId(req);
    await this.service.disconnectProvider(businessId, connectionId, userId);
    return { success: true, message: 'Connection removed' };
  }

  @Get('connections')
  async getConnections(@Req() req: Request) {
    const businessId = this.extractBusinessId(req);
    const result = await this.service.getConnections(businessId);
    return { success: true, data: result };
  }

  // ── Health ──────────────────────────────────────────────────────────

  @Get('health')
  async getHealth(@Req() req: Request) {
    const businessId = this.extractBusinessId(req);
    const result = await this.service.getConnectionHealth(businessId);
    return { success: true, data: result };
  }

  // ── Sync ────────────────────────────────────────────────────────────

  @Post('sync/:id/trigger')
  @HttpCode(HttpStatus.ACCEPTED)
  async triggerSync(
    @Req() req: Request,
    @Param('id') connectionId: string,
    @Query('direction')
    direction: 'inbound' | 'outbound' | 'bidirectional' = 'bidirectional',
  ) {
    const businessId = this.extractBusinessId(req);
    const result = await this.service.triggerSync(
      businessId,
      connectionId,
      direction,
    );
    return { success: true, data: result };
  }

  @Get('sync')
  async getSyncHistory(
    @Req() req: Request,
    @Query('connectionId') connectionId?: string,
    @Query('limit') limit?: string,
  ) {
    const businessId = this.extractBusinessId(req);
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
    @Req() req: Request,
    @Body() dto: AiCommandDto,
  ) {
    const businessId = this.extractBusinessId(req);
    const userId = this.extractUserId(req);

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
    @Req() req: Request,
    @Query('limit') limit?: string,
  ) {
    const businessId = this.extractBusinessId(req);
    const result = await this.service.getAuditLog(
      businessId,
      limit ? parseInt(limit, 10) : 100,
    );
    return { success: true, data: result };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Request helpers
  // ═══════════════════════════════════════════════════════════════════════

  private extractBusinessId(req: Request): string {
    // In a real application the business ID is injected by an auth
    // guard or middleware and attached to the request object.
    const id =
      (req as Record<string, unknown>)['businessId'] as string | undefined;
    if (!id) {
      throw new Error('Business ID not found in request context');
    }
    return id;
  }

  private extractUserId(req: Request): string {
    const id = (req as Record<string, unknown>)['userId'] as
      | string
      | undefined;
    if (!id) {
      throw new Error('User ID not found in request context');
    }
    return id;
  }
}
