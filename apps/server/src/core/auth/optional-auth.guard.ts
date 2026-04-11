import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

/**
 * Optional authentication guard — allows both authenticated and unauthenticated requests.
 * If a valid token is provided via AuthMiddleware, req.user will be populated.
 * If no token is provided, req.user will be undefined and the request still proceeds.
 * Use this on endpoints that provide additional functionality when authenticated,
 * but are publicly accessible without a token.
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}
