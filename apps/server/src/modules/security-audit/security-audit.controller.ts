import { Controller, Get, Param, UseGuards, Inject } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { SecurityAuditService, summarizeAudit, type SecurityAuditSummary } from './security-audit.service';

@Controller('security/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class SecurityAuditController {
  constructor(@Inject(SecurityAuditService) private readonly audit: SecurityAuditService) {}

  /**
   * The workspace's security audit (Settings > Security). It describes the business's configuration
   * and privacy settings, so it is a settings read (V1-63 SWP-SEC-AUDIT-TRUTH, sweep BUG-065: a
   * STAFF member with settings 'none' could run it). ModuleScopeGuard refuses before the audit reads
   * anything. Only measured checks count toward the score (summarizeAudit).
   */
  @Get('audit')
  @RequireModuleScope('settings', 'read')
  async runAudit(@Param('businessId') businessId: string): Promise<SecurityAuditSummary> {
    return summarizeAudit(await this.audit.runAudit(businessId));
  }
}
