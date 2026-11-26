import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import type { AuthKind } from '../decorators/current-user.decorator';

export type AdminRequestLike = {
  authKind?: AuthKind;
  user?: { id?: string; role?: string; authKind?: AuthKind };
};

/**
 * D-291 (RR-ADMIN-API-SIGNIN-KIND): returns true ONLY when the request was
 * authenticated via the separate local HMAC admin sign-in (`authKind === 'admin'`).
 *
 * When `req.authKind` is set (every request processed by AuthMiddleware), it is
 * authoritative so a mismatched or tampered `user.authKind` can never override it.
 * When `req.authKind` is absent (e.g. a unit test invoking a guard/handler
 * directly with `{ user }`), falls back to `req.user?.authKind === 'admin'`.
 * Anything else (`'supabase'`, `undefined`, unknown) fails closed (`false`).
 */
export function isAdminSignIn(req: AdminRequestLike | undefined): boolean {
  if (!req) return false;
  if (req.authKind !== undefined) {
    return req.authKind === 'admin';
  }
  return req.user?.authKind === 'admin';
}

/**
 * Owner Console / platform-admin guard (D-291).
 *
 * Requires BOTH:
 *   1. `user.role === 'SUPER_ADMIN'` (read from the Prisma User row by AuthMiddleware), AND
 *   2. `authKind === 'admin'` (separate local HMAC admin sign-in minted by `/api/admin/auth/login`).
 *
 * A Supabase-authenticated SUPER_ADMIN is refused with 403 Forbidden.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AdminRequestLike>();
    const user = req.user;
    if (!user?.id) {
      throw new ForbiddenException('Authentication required');
    }
    if (user.role !== 'SUPER_ADMIN' || !isAdminSignIn(req)) {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
}
