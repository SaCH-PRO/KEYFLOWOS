import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { isAdminSignIn, type AdminRequestLike } from '../../core/auth/admin.guard';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';

const SEO_FEATURE_KEY = 'nav.workspaces.seo';

/**
 * Restricts the SEO module to either admin-signed-in super admins or users
 * explicitly allow-listed in the runtime feature-flag bypass list (managed from
 * the owner console at `/admin/feature-flags`). When the flag is not in
 * "coming soon" mode, the module is open to all authenticated users.
 *
 * D-291 (RR-ADMIN-API-SIGNIN-KIND): the SUPER_ADMIN bypass of a `comingSoon`
 * flag requires the separate admin sign-in (`authKind === 'admin'`). A
 * Supabase-session SUPER_ADMIN still passes when the flag is not `comingSoon`
 * or when their email is listed in `bypassEmails`.
 */
@Injectable()
export class SeoAdminGuard implements CanActivate {
  constructor(@Inject(FeatureFlagsService) private readonly featureFlags: FeatureFlagsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest() as AdminRequestLike & {
      user?: { id?: string; email?: string | null; role?: string };
    };
    const user = req.user;
    if (!user?.id) {
      throw new UnauthorizedException('Authentication required');
    }
    if (user.role === 'SUPER_ADMIN' && isAdminSignIn(req)) {
      return true;
    }
    const status = await this.featureFlags.hasBypass(SEO_FEATURE_KEY, user.email ?? null);
    if (!status.exists || !status.comingSoon) {
      return true;
    }
    if (status.bypass) {
      return true;
    }
    throw new ForbiddenException('SEO module is restricted');
  }
}
