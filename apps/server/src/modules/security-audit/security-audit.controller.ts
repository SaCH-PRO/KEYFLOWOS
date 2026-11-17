import { Controller, Get, Param, UseGuards, Inject } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { CurrentUser, type AuthenticatedUser } from '../../core/decorators/current-user.decorator';
import { SecurityAuditService, checksVisibleTo, summarizeAudit, type SecurityAuditSummary } from './security-audit.service';

@Controller('security/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class SecurityAuditController {
  constructor(@Inject(SecurityAuditService) private readonly audit: SecurityAuditService) {}

  /**
   * The workspace's security audit (Settings > Security). It describes the business's configuration
   * and privacy settings, so it is a settings read (V1-63 SWP-SEC-AUDIT-TRUTH, sweep BUG-065: a
   * STAFF member with settings 'none' could run it). ModuleScopeGuard refuses before the audit reads
   * anything. Only measured checks count toward the score (summarizeAudit).
   *
   * The checks that read the server's environment describe the whole deployment, not this business,
   * so a tenant member is served the business's own checks only and a platform SUPER_ADMIN the
   * platform checks too (checksVisibleTo, review SEC-AUDIT-ENV-1). The summary counts what the
   * viewer is served.
   */
  @Get('audit')
  @RequireModuleScope('settings', 'read')
  async runAudit(
    @Param('businessId') businessId: string,
    @CurrentUser() viewer: AuthenticatedUser | undefined,
  ): Promise<SecurityAuditSummary> {
    return summarizeAudit(checksVisibleTo(await this.audit.runAudit(businessId), viewer));
  }
}
