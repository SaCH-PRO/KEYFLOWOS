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
  Inject,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { GuardedBusinessId } from '../../core/auth/request-business-id';
import { PrismaService } from '../../core/prisma/prisma.service';
import { assertMemberModuleLevel } from '../../core/auth/member-module-level';
import { KeyConnectorService } from './key-connector.service';
import { ConnectProviderDto, AiCommandDto } from './dto';
import { AiGatewayCommand } from './key-connector.types';
// W7-KEY-CONNECTOR-TENANT review SEC-W7KC-1: a connection leaves this
// controller through connectionView only, an allow-list without the stored
// credentials (authData). Moved to ./connection-view by
// W11-KEY-ORGAN-OUTPUT-REDACT so the KEY organ tools answer the same projection.
import { connectionView } from './connection-view';

/**
 * W7-KEY-CONNECTOR-TENANT review SEC-W7KC-2: the membership roles that may
 * change a business's provider connections or act through them (connect,
 * disconnect, trigger a sync, run an AI gateway command). No owner ruling
 * names this surface; the set is the one the tRPC keyConnector router already
 * enforces for the same table (assertBusinessRole(ctx, ["OWNER", "ADMIN"]),
 * packages/api/src/routers/key-connector.ts), so the two doors agree.
 */
const CONNECTOR_WRITER_ROLES: ReadonlySet<string> = new Set(['OWNER', 'ADMIN']);

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
 *
 * Review repairs (W7-KEY-CONNECTOR-TENANT, SEC-W7KC-1 and SEC-W7KC-2). No
 * route answers a connection's stored credentials (`connectionView`), and the
 * four routes that change connections or act through them (connect,
 * disconnect, sync trigger, AI command) admit OWNER or ADMIN only
 * (`requireConnectorWriter`), as the tRPC keyConnector router does; the reads
 * stay open to every member of the tenant.
 * ───────────────────────────────────────────────────────────────────────
 */

@UseGuards(AuthGuard, BusinessGuard)
@Controller('key-connector')
export class KeyConnectorController {
  constructor(
    private readonly service: KeyConnectorService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

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

  /**
   * W7-KEY-CONNECTOR-TENANT review SEC-W7KC-2: the caller may change the
   * tenant's connections or act through them (CONNECTOR_WRITER_ROLES). An
   * OWNER or ADMIN membership, or the business's distinguished owner
   * (Business.ownerId, the arm BusinessGuard also admits an owner by) while it
   * holds an OWNER membership (owner rulings D-116, D-125: a recorded owner
   * holding STAFF is a STAFF member and is refused; holding ADMIN it is
   * admitted as an ADMIN, D-111);
   * SUPER_ADMIN keeps the platform bypass BusinessGuard grants (and has named a
   * tenant, requireGuardedTenant). Anyone else, a STAFF member with any scopes
   * included, is refused before a service is reached. A failed lookup refuses,
   * as BusinessGuard does.
   */
  private async requireConnectorWriter(
    businessId: string,
    user: { id?: string; role?: string } | undefined,
  ): Promise<void> {
    if (!user?.id) throw new ForbiddenException('Authentication required');
    if (user.role === 'SUPER_ADMIN') return;
    let allowed: boolean;
    try {
      // Membership is not tenant-scoped by the Prisma extension: the compound
      // key's businessId is what keeps this read inside the tenant.
      const membership = await this.prisma.client.membership.findUnique({
        where: { userId_businessId: { userId: user.id, businessId } },
        select: { role: true },
      });
      allowed = !!membership && CONNECTOR_WRITER_ROLES.has(membership.role);
      if (!allowed) {
        const owned = await this.prisma.client.business.findFirst({
          // Owner ruling D-104 (W10-OWNER-MEMBERSHIP): the ownerId arm counts only with a Membership row;
          // owner rulings D-116, D-125 (W11-D116-CONNECTION-OWNER): only with an OWNER one (holding
          // ADMIN or STAFF, the recorded owner is that role).
          where: { id: businessId, ownerId: user.id, members: { some: { userId: user.id, role: 'OWNER' } } },
          select: { id: true },
        });
        allowed = !!owned;
      }
    } catch {
      throw new ForbiddenException('Unable to verify connector authority');
    }
    if (!allowed) {
      throw new ForbiddenException(
        'Only the business owner or an admin can change provider connections or act through them',
      );
    }
  }

  /**
   * SWEEP-P0-SCOPES round 1 class repair (CLASS B; owner rulings D-111 and D-114): binding or removing
   * a provider connection (its stored credentials, IntegrationConnection.authData) needs what D-111
   * names, an OWNER or ADMIN membership (requireConnectorWriter), and settings admin as
   * ModuleScopeGuard reads it: an explicit permission map binds an ADMIN too (D-114), so an ADMIN whose
   * map says settings 'none' is refused, as the SEC-1 credential routes refuse them. The sync trigger
   * and the AI command keep D-111 alone (they act through a connection, they do not bind one).
   */
  private async requireConnectorAdmin(
    businessId: string,
    user: { id?: string; role?: string } | undefined,
  ): Promise<void> {
    await this.requireConnectorWriter(businessId, user);
    await assertMemberModuleLevel(this.prisma, businessId, user, 'settings', 'admin');
  }

  // ── Provider Discovery ──────────────────────────────────────────────

  @Get('providers')
  async getProviders(
    @GuardedBusinessId() guardedBusinessId: string | undefined,
    @Query('category') category?: string,
  ) {
    const businessId = this.requireGuardedTenant(guardedBusinessId);
    const result = await this.service.getProviders(businessId, category);
    return {
      success: true,
      data: result.map((entry) => ({
        provider: entry.provider,
        connection: entry.connection ? connectionView(entry.connection) : undefined,
      })),
    };
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
    return {
      success: true,
      data: {
        provider: result.provider,
        connection: result.connection ? connectionView(result.connection) : undefined,
      },
    };
  }

  @Post('providers/:key/connect')
  @HttpCode(HttpStatus.CREATED)
  async connectProvider(
    @GuardedBusinessId() guardedBusinessId: string | undefined,
    @Param('key') providerKey: string,
    @Body() dto: ConnectProviderDto,
    @Req() req: Request & { user?: { id?: string; role?: string } },
  ) {
    const businessId = this.requireGuardedTenant(guardedBusinessId);
    await this.requireConnectorAdmin(businessId, req.user);
    const userId = req.user?.id ?? '';
    const result = await this.service.connectProvider(
      businessId,
      userId,
      providerKey,
      dto.authData ?? {},
      dto.settings,
      dto.displayName,
    );
    return { success: true, data: connectionView(result) };
  }

  // ── Connection Management ───────────────────────────────────────────

  @Delete('connections/:id')
  @HttpCode(HttpStatus.OK)
  async disconnectProvider(
    @GuardedBusinessId() guardedBusinessId: string | undefined,
    @Param('id') connectionId: string,
    @Req() req: Request & { user?: { id?: string; role?: string } },
  ) {
    const businessId = this.requireGuardedTenant(guardedBusinessId);
    await this.requireConnectorAdmin(businessId, req.user);
    const userId = req.user?.id ?? '';
    await this.service.disconnectProvider(businessId, connectionId, userId);
    return { success: true, message: 'Connection removed' };
  }

  @Get('connections')
  async getConnections(@GuardedBusinessId() guardedBusinessId: string | undefined) {
    const businessId = this.requireGuardedTenant(guardedBusinessId);
    const result = await this.service.getConnections(businessId);
    return { success: true, data: result.map(connectionView) };
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
    @Req() req: Request & { user?: { id?: string; role?: string } },
  ) {
    const businessId = this.requireGuardedTenant(guardedBusinessId);
    await this.requireConnectorWriter(businessId, req.user);
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
    @Req() req: Request & { user?: { id?: string; role?: string } },
  ) {
    const businessId = this.requireGuardedTenant(guardedBusinessId);
    await this.requireConnectorWriter(businessId, req.user);
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
