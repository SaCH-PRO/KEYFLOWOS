import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export type AuthKind = 'supabase' | 'admin';

export interface AuthenticatedUser {
  id: string;
  email?: string;
  role?: string;
  /**
   * D-291 (RR-ADMIN-API-SIGNIN-KIND): cryptographic verifier that authenticated
   * this request ('supabase' vs separate local HMAC 'admin' sign-in). Set
   * exclusively by AuthMiddleware (non-enumerable on req.user so existing JSON
   * serializers and `{ id, email, role }` equality assertions stay intact).
   */
  readonly authKind?: AuthKind;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as AuthenticatedUser | undefined;
  },
);
