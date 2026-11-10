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
import { GuardedBusinessId } from '../../core/auth/request-business-id';
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
 *
 * Tenant (W7-KEY-CONNECTOR-TENANT, the R0-34b pattern). The base path carries
 * no `:businessId` segment, so the request names the tenant and BusinessGuard
 * resolves and checks it from params, then body, then query
 * (core/auth/request-business-id.ts). These handlers used to read
 * `@Query('businessId')`: a member of A sending the JSON body
 * `{businessId: A}` with `?businessId=B` passed the guard for A and the
 * handler acted on B, and SUPER_ADMIN (whom the guard admits naming no
 * tenant) reached the service with `undefined`, which its Prisma reads drop
 * as a filter (every tenant's rows). Every handler now takes
 * `@GuardedBusinessId()`, the resolver the guard ran, and refuses a request
 * that named no tenant (`requireGuardedTenant`). A query businessId naming
 * another business is ignored when the body names one, and refused by the
 * guard when it is the only one named.
 * ───────────────────────────────────────────────────────────────────────
 */

@UseGuards(AuthGuard, BusinessGuard)
@Controller('key-connector')
export class KeyConnectorController {
  constructor(private readonly service: KeyConnectorService) {}

  /**
   * The tenant a handler acts on: the one BusinessGuard resolved and checked.
   * `undefined` only when no request field named one, which the guard refuses
   * for every ordinary user; SUPER_ADMIN bypasses the guard and is refused
   * here, because a tenant forwarded as `undefined` reads every tenant's rows.
   */
  private requireGuardedTenant(businessId: string | undefined): string {
    if (!businessId) throw new ForbiddenException('businessId is required');
    return businessId;
  }

  // ── Provider Discovery ──────────────────────────────────────────────

  @Get('providers')
  async getProviders(
    @GuardedBusinessId() guardedBusinessId: string | undefined,
    @Query('category') category?: string,
  ) {
    const businessId = this.requireGuardedTenant(guardedBusinessId);
    const result = await this.service.getProviders(businessId, category);
    return { success: true, data: result };
  }

  @Get('providers/:key')
  async getProviderDetail(
    @GuardedBusinessId() guardedBusinessId: string | undefined,
    @Param('key') providerKey: string,
  ) {
    const businessId = this.requireGuardedTenant(guardedBusinessId);
    const result = await this.service.getProviderDetail(
      businessId,
      providerKey,
    );
    return { success: true, data: result };
  }

  @Post('providers/:key/connect')
  @HttpCode(HttpStatus.CREATED)
  async connectProvider(
    @GuardedBusinessId() guardedBusinessId: string | undefined,
    @Param('key') providerKey: string,
    @Body() dto: ConnectProviderDto,
    @Req() req: Request & { user?: { id?: string } },
  ) {
    const businessId = this.requireGuardedTenant(guardedBusinessId);
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
    @GuardedBusinessId() guardedBusinessId: string | undefined,
    @Param('id') connectionId: string,
    @Req() req: Request & { user?: { id?: string } },
  ) {
    const businessId = this.requireGuardedTenant(guardedBusinessId);
    const userId = req.user?.id ?? '';
    await this.service.disconnectProvider(businessId, connectionId, userId);
    return { success: true, message: 'Connection removed' };
  }

  @Get('connections')
  async getConnections(@GuardedBusinessId() guardedBusinessId: string | undefined) {
    const businessId = this.requireGuardedTenant(guardedBusinessId);
    const result = await this.service.getConnections(businessId);
    return { success: true, data: result };
  }

  // ── Health ──────────────────────────────────────────────────────────

  @Get('health')
  async getHealth(@GuardedBusinessId() guardedBusinessId: string | undefined) {
    const businessId = this.requireGuardedTenant(guardedBusinessId);
    const result = await this.service.getConnectionHealth(businessId);
    return { success: true, data: result };
  }

  // ── Sync ────────────────────────────────────────────────────────────

  @Post('sync/:id/trigger')
  @HttpCode(HttpStatus.ACCEPTED)
  async triggerSync(
    @GuardedBusinessId() guardedBusinessId: string | undefined,
    @Param('id') connectionId: string,
    @Query('direction')
    direction: 'inbound' | 'outbound' | 'bidirectional' = 'bidirectional',
  ) {
    const businessId = this.requireGuardedTenant(guardedBusinessId);
    const result = await this.service.triggerSync(
      businessId,
      connectionId,
      direction,
    );
    return { success: true, data: result };
  }

  @Get('sync')
  async getSyncHistory(
    @GuardedBusinessId() guardedBusinessId: string | undefined,
    @Query('connectionId') connectionId?: string,
    @Query('limit') limit?: string,
  ) {
    const businessId = this.requireGuardedTenant(guardedBusinessId);
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
    @GuardedBusinessId() guardedBusinessId: string | undefined,
    @Body() dto: AiCommandDto,
    @Req() req: Request & { user?: { id?: string } },
  ) {
    const businessId = this.requireGuardedTenant(guardedBusinessId);
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
    @GuardedBusinessId() guardedBusinessId: string | undefined,
    @Query('limit') limit?: string,
  ) {
    const businessId = this.requireGuardedTenant(guardedBusinessId);
    const result = await this.service.getAuditLog(
      businessId,
      limit ? parseInt(limit, 10) : 100,
    );
    return { success: true, data: result };
  }

}
