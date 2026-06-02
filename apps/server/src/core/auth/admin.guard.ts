import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      user?: { id?: string; role?: string };
    }>();
    const user = req.user;
    if (!user?.id) {
      throw new ForbiddenException('Authentication required');
    }
    if (user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
}
