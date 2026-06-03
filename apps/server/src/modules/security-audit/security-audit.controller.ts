import { Controller, Get, Param, UseGuards, Inject } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { SecurityAuditService } from './security-audit.service';

@Controller('security/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class SecurityAuditController {
  constructor(@Inject(SecurityAuditService) private readonly audit: SecurityAuditService) {}

  @Get('audit')
  async runAudit(@Param('businessId') businessId: string) {
    const checks = await this.audit.runAudit(businessId);
    const passed = checks.filter((c) => c.passed).length;
    const total = checks.length;
    return {
      score: total > 0 ? Math.round((passed / total) * 100) : 100,
      passed,
      total,
      checks,
    };
  }
}
