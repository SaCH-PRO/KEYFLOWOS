import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';

const SEO_ADMIN_EMAIL = 'keyflowos.tt@gmail.com';

@Injectable()
export class SeoAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest() as {
      user?: { id?: string; email?: string | null; role?: string };
    };
    const user = req.user;
    if (!user?.id) {
      throw new UnauthorizedException('Authentication required');
    }
    if (user.role === 'SUPER_ADMIN') {
      return true;
    }
    const email = (user.email ?? '').trim().toLowerCase();
    if (email === SEO_ADMIN_EMAIL) {
      return true;
    }
    throw new ForbiddenException('SEO module is restricted');
  }
}
