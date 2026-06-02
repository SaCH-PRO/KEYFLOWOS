import { CanActivate, ExecutionContext, Inject, Injectable, ForbiddenException, Logger, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';

export const MODULE_SCOPE_KEY = 'module_scope';

export interface ModuleScopeRequirement {
  module: string;
  minLevel: 'read' | 'write' | 'admin';
}

export const RequireModuleScope = (module: string, minLevel: 'read' | 'write' | 'admin' = 'read') =>
  SetMetadata(MODULE_SCOPE_KEY, { module, minLevel } as ModuleScopeRequirement);

const LEVEL_HIERARCHY: Record<string, number> = {
  none: 0,
  read: 1,
  write: 2,
  admin: 3,
};

const DEFAULT_SCOPES: Record<string, Record<string, string>> = {
  OWNER: Object.fromEntries([
    'crm', 'revenue', 'bookings', 'projects', 'content', 'expenses',
    'automations', 'storefront', 'settings', 'ai', 'team', 'analytics',
  ].map((m) => [m, 'admin'])),
  ADMIN: Object.fromEntries([
    'crm', 'revenue', 'bookings', 'projects', 'content', 'expenses',
    'automations', 'storefront', 'settings', 'ai', 'team', 'analytics',
  ].map((m) => [m, m === 'team' ? 'write' : 'admin'])),
  STAFF: Object.fromEntries([
    'crm', 'revenue', 'bookings', 'projects', 'content', 'expenses',
    'automations', 'storefront', 'settings', 'ai', 'team', 'analytics',
  ].map((m) => [m, ['settings', 'team', 'ai'].includes(m) ? 'none' : 'read'])),
};

@Injectable()
export class ModuleScopeGuard implements CanActivate {
  private readonly logger = new Logger(ModuleScopeGuard.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.get<ModuleScopeRequirement>(MODULE_SCOPE_KEY, context.getHandler());
    if (!requirement) return true;

    const req = context.switchToHttp().getRequest<{ user?: { id?: string; role?: string }; params?: Record<string, string>; body?: Record<string, string> }>();
    const user = req.user;
    if (!user?.id) throw new ForbiddenException('Authentication required');

    if (user.role === 'SUPER_ADMIN') return true;

    const businessId = req.params?.businessId || req.body?.businessId;
    if (!businessId) throw new ForbiddenException('businessId is required');

    const membership = await this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId: user.id, businessId } },
    });

    if (!membership) throw new ForbiddenException('Not a member of this business');

    let scopes: Record<string, string>;
    if (membership.permissionScopes && typeof membership.permissionScopes === 'object') {
      scopes = membership.permissionScopes as Record<string, string>;
    } else {
      scopes = DEFAULT_SCOPES[membership.role] ?? DEFAULT_SCOPES.STAFF;
    }

    const memberLevel = scopes[requirement.module] || 'none';
    const memberRank = LEVEL_HIERARCHY[memberLevel] ?? 0;
    const requiredRank = LEVEL_HIERARCHY[requirement.minLevel] ?? 1;

    if (memberRank < requiredRank) {
      throw new ForbiddenException(
        `Insufficient permissions: ${requirement.module} requires ${requirement.minLevel} access (you have ${memberLevel})`,
      );
    }

    return true;
  }
}
