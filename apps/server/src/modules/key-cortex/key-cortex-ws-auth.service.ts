/**
 * KEY Cortex WebSocket authentication & authorization.
 *
 * Transport-specific glue. Authentication is the HTTP gate itself: the
 * socket's bearer token is put through {@link AuthMiddleware.use}, so a socket
 * gets exactly the decision an HTTP request with the same token gets —
 * Supabase verification then the admin HMAC-JWT fallback, the local-user
 * checks (User.deletedAt, User.bannedAt, a missing row for an admin token),
 * the role from the User row, the logout cutoff and the admin revocation
 * cutoff, and the same fail-closed / Redis-outage rules. Business membership
 * mirrors {@link BusinessGuard}, tenant-id resolution included.
 *
 * Both decisions are taken at connect only. The gateway keeps the connect-time
 * identity for the socket's lifetime and nothing disconnects a socket when its
 * user is demoted, banned, deleted or logged out (review finding ST-WS-R1,
 * pre-existing; the fix is in key-cortex.gateway.ts and the revocation writers,
 * outside R0-ID-F6's write set — see the it.todo in
 * test/identity-boundary.integration.test.ts).
 *
 * Until R0-ID-F6-WS-ADMIN-TOKEN (ST-2-WS) this service verified the token
 * itself and attached an admin token's own claims with none of those checks,
 * so a demoted, deleted or banned SUPER_ADMIN still opened any tenant's socket
 * through verifyBusinessMembership's SUPER_ADMIN bypass.
 *
 * Identity (userId/role) is ALWAYS derived from the validated token and the
 * User row, never from client-controlled handshake query parameters.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Socket } from 'socket.io';
import type { Redis } from 'ioredis';
import { SupabaseAuthService } from '../../core/auth/supabase-auth.service';
import { AuthMiddleware } from '../../core/auth/auth.middleware';
import { resolveRequestBusinessId } from '../../core/auth/request-business-id';
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
  /** The HTTP authentication gate, over the same collaborators (see the file comment). */
  private readonly httpAuth: AuthMiddleware;

  constructor(
    @Inject(SupabaseAuthService) supabaseAuth: SupabaseAuthService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) redis: Redis,
  ) {
    this.httpAuth = new AuthMiddleware(supabaseAuth, prisma, redis);
  }

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
   *
   * The decision is AuthMiddleware's for an HTTP request carrying the same
   * `Authorization: Bearer <token>`: it attaches `req.user` ({ id, email, role
   * from the User row }) or leaves it unset, and so every refusal it makes —
   * missing, malformed, expired or revoked token; deleted, banned or (for an
   * admin token) missing User row; a Postgres failure — is null here too.
   * The synthetic request carries nothing but that header, which is all the
   * middleware reads.
   */
  async authenticateSocket(client: Socket): Promise<WsIdentity | null> {
    const token = this.extractToken(client);
    if (!token) return null;

    const req = { headers: { authorization: `Bearer ${token}` } } as unknown as Request & {
      user?: { id: string; email?: string | null; role: string };
    };
    await this.httpAuth.use(req, {} as Response, () => undefined);
    const user = req.user;
    if (!user?.id) return null;
    return { userId: user.id, email: user.email ?? null, role: user.role };
  }

  /**
   * Verify the authenticated user may access the requested business.
   * SUPER_ADMIN bypasses the check. Otherwise membership is required (owner or
   * member). The `business.findFirst` lookup is soft-delete filtered, so a
   * disabled (soft-deleted) business yields no match and is rejected.
   *
   * `businessId` is whatever JSON the client put in the handshake, so it is
   * read through {@link resolveRequestBusinessId}, the resolver BusinessGuard
   * uses: only a non-empty string names a tenant. Before the R0-ID-F6 review
   * repair (ST-WS-R2) any truthy value reached `findFirst` as `id`, where an
   * object is a Prisma filter — `{ in: [ownBiz, foreignBiz] }` was authorized
   * for any member of ownBiz, and the gateway then stored that object as the
   * socket's tenant. Unlike BusinessGuard the socket always needs a tenant, so
   * this holds for SUPER_ADMIN too (as the empty-id refusal always has).
   */
  async verifyBusinessMembership(userId: string, role: string, businessId: unknown): Promise<boolean> {
    const id = resolveRequestBusinessId({ query: { businessId } });
    if (!id) return false;
    if (role === 'SUPER_ADMIN') return true;

    try {
      const business = await this.prisma.client.business.findFirst({
        where: {
          id,
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
