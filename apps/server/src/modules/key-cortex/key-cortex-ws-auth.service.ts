/**
 * KEY Cortex WebSocket authentication & authorization.
 *
 * Transport-specific glue that reuses the SAME auth primitives the HTTP
 * `AuthMiddleware` relies on — it does not re-implement token verification:
 *   - Supabase JWT verification via {@link SupabaseAuthService.getUserFromToken}
 *   - Admin HMAC-JWT fallback via {@link verifyAdminToken}
 *   - Business membership shape mirrors {@link BusinessGuard}
 *
 * Identity (userId/role) is ALWAYS derived from the validated token, never
 * from client-controlled handshake query parameters.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Socket } from 'socket.io';
import type { Redis } from 'ioredis';
import { SupabaseAuthService } from '../../core/auth/supabase-auth.service';
import { verifyAdminToken } from '../../core/auth/admin-token.util';
import { PrismaService } from '../../core/prisma/prisma.service';
import { REDIS_CLIENT } from '../../core/redis/redis.constants';
import { allowedCorsOrigins } from '../../core/config/runtime-urls';

/** Verified identity resolved from a socket's bearer token. */
export interface WsIdentity {
  userId: string;
  email: string | null;
  role: string;
}

/**
 * Decide whether a browser Origin may open a WebSocket connection.
 *
 * Reuses the centralized {@link allowedCorsOrigins} allow-list (same source of
 * truth as HTTP CORS). Requests without an Origin header (native clients,
 * server-to-server, tests) are allowed — browsers always send one, so this only
 * ever rejects cross-origin browser connections.
 */
export function isAllowedWsOrigin(origin?: string | null): boolean {
  if (!origin) return true;
  const normalized = origin.replace(/\/+$/, '');
  return allowedCorsOrigins().includes(normalized);
}

@Injectable()
export class KeyCortexWsAuthService {
  private readonly logger = new Logger(KeyCortexWsAuthService.name);

  constructor(
    @Inject(SupabaseAuthService) private readonly supabaseAuth: SupabaseAuthService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Extract the bearer token from the handshake.
   * Primary location: `handshake.auth.token` (socket.io `auth` option).
   * Fallback: `Authorization: Bearer <token>` header.
   * NEVER read from query parameters (client-controlled, spoofable).
   */
  private extractToken(client: Socket): string | undefined {
    const authToken = client.handshake?.auth?.token;
    if (typeof authToken === 'string' && authToken.length > 0) {
      return authToken.startsWith('Bearer ') ? authToken.slice(7).trim() : authToken.trim();
    }
    const header = client.handshake?.headers?.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return header.slice(7).trim();
    }
    return undefined;
  }

  /**
   * Authenticate a socket. Returns the verified identity or null.
   * Handles missing, malformed, expired, revoked and invalid tokens (all → null).
   */
  async authenticateSocket(client: Socket): Promise<WsIdentity | null> {
    const token = this.extractToken(client);
    if (!token) return null;

    // Primary: Supabase JWT (local HMAC verification or getUser fallback).
    const user = await this.supabaseAuth.getUserFromToken(token);
    if (user?.id) {
      const role = await this.resolveRole(user.id);
      return { userId: user.id, email: user.email ?? null, role };
    }

    // Fallback: admin HMAC-JWT (with Redis JTI/global revocation checks).
    const admin = await verifyAdminToken(token, this.redis);
    if (admin) {
      return { userId: admin.id, email: admin.email ?? null, role: admin.role };
    }

    return null;
  }

  /**
   * Resolve the user's role from the database (not the JWT), so role changes
   * take effect immediately. Mirrors AuthMiddleware.attachRole().
   */
  private async resolveRole(userId: string): Promise<string> {
    try {
      const dbUser = await this.prisma.client.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      return dbUser?.role ?? 'USER';
    } catch (err) {
      this.logger.debug(`Role lookup failed: ${(err as Error).message}`);
      return 'USER';
    }
  }

  /**
   * Verify the authenticated user may access the requested business.
   * SUPER_ADMIN bypasses the check. Otherwise membership is required (owner or
   * member). The `business.findFirst` lookup is soft-delete filtered, so a
   * disabled (soft-deleted) business yields no match and is rejected.
   */
  async verifyBusinessMembership(userId: string, role: string, businessId: string): Promise<boolean> {
    if (!businessId) return false;
    if (role === 'SUPER_ADMIN') return true;

    try {
      const business = await this.prisma.client.business.findFirst({
        where: {
          id: businessId,
          OR: [{ ownerId: userId }, { members: { some: { userId } } }],
        },
        select: { id: true },
      });
      return !!business;
    } catch (err) {
      this.logger.error(`Business membership check failed: ${(err as Error).message}`);
      return false;
    }
  }
}
