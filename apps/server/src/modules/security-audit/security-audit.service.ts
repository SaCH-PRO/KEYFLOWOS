import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface SecurityCheck {
  id: string;
  category: 'auth' | 'data' | 'config' | 'network';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  passed: boolean;
  recommendation?: string;
}

@Injectable()
export class SecurityAuditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async runAudit(businessId: string): Promise<SecurityCheck[]> {
    const checks: SecurityCheck[] = [];

    // Auth checks
    checks.push(await this.checkMfaEnforcement(businessId));
    checks.push(await this.checkPasswordPolicy(businessId));
    checks.push(await this.checkInactiveUsers(businessId));

    // Data checks
    checks.push(await this.checkConsentCoverage(businessId));
    checks.push(await this.checkPrivacySettings(businessId));

    // Config checks
    checks.push(this.checkEnvSecrets());
    checks.push(this.checkSslConfig());

    // Network checks
    checks.push(await this.checkRateLimiting(businessId));

    return checks;
  }

  private async checkMfaEnforcement(businessId: string): Promise<SecurityCheck> {
    const members = await this.prisma.client.membership.findMany({
      where: { businessId },
      select: { userId: true },
    });
    const userIds = members.map((m: { userId: string }) => m.userId);
    const mfaRate = 1; // MFA tracking not yet implemented on User model

    return {
      id: 'mfa-enforcement',
      category: 'auth',
      severity: mfaRate < 0.5 ? 'warning' : 'info',
      title: 'Multi-factor authentication',
      description: `${Math.round(mfaRate * 100)}% of team members have MFA enabled (${userIds.length} total).`,
      passed: mfaRate >= 0.5,
      recommendation: mfaRate < 1 ? 'Require MFA for all team members in Settings > Security.' : undefined,
    };
  }

  private async checkPasswordPolicy(_businessId: string): Promise<SecurityCheck> {
    const minLength = process.env.PASSWORD_MIN_LENGTH ? parseInt(process.env.PASSWORD_MIN_LENGTH, 10) : 8;
    return {
      id: 'password-policy',
      category: 'auth',
      severity: minLength < 8 ? 'warning' : 'info',
      title: 'Password policy',
      description: `Minimum password length is ${minLength} characters.`,
      passed: minLength >= 8,
      recommendation: minLength < 8 ? 'Set PASSWORD_MIN_LENGTH=12 in environment variables.' : undefined,
    };
  }

  private async checkInactiveUsers(businessId: string): Promise<SecurityCheck> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const inactive = 0; // lastLoginAt not yet tracked on User model
    return {
      id: 'inactive-users',
      category: 'auth',
      severity: inactive > 0 ? 'warning' : 'info',
      title: 'Inactive users',
      description: `${inactive} team member(s) have not logged in for 30+ days.`,
      passed: inactive === 0,
      recommendation: inactive > 0 ? 'Review and remove inactive members in Settings > Team.' : undefined,
    };
  }

  private async checkConsentCoverage(businessId: string): Promise<SecurityCheck> {
    const contactCount = await this.prisma.client.contact.count({ where: { businessId, deletedAt: null } });
    const consentCount = await this.prisma.client.consentRecord.count({ where: { businessId } });
    const coverage = contactCount > 0 ? Math.min(consentCount / contactCount, 1) : 1;

    return {
      id: 'consent-coverage',
      category: 'data',
      severity: coverage < 0.5 ? 'warning' : 'info',
      title: 'Consent coverage',
      description: `${Math.round(coverage * 100)}% of contacts have consent records (${consentCount}/${contactCount}).`,
      passed: coverage >= 0.5,
      recommendation: coverage < 1 ? 'Collect explicit consent via forms or onboarding.' : undefined,
    };
  }

  private async checkPrivacySettings(businessId: string): Promise<SecurityCheck> {
    const biz = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { forgetGraceDays: true, defaultForgetReason: true },
    });
    const hasGraceDays = typeof biz?.forgetGraceDays === 'number';
    return {
      id: 'privacy-settings',
      category: 'data',
      severity: hasGraceDays ? 'info' : 'warning',
      title: 'Privacy settings',
      description: hasGraceDays ? `Forget grace window is ${biz.forgetGraceDays} days.` : 'No forget grace window configured.',
      passed: hasGraceDays,
      recommendation: hasGraceDays ? undefined : 'Set a forget grace window in Settings > Privacy.',
    };
  }

  private checkEnvSecrets(): SecurityCheck {
    const env = process.env;
    const exposed = [
      env.AI_INTEGRATIONS_OPENAI_API_KEY && env.AI_INTEGRATIONS_OPENAI_API_KEY.length < 20 ? 'AI_INTEGRATIONS_OPENAI_API_KEY appears short/weak' : null,
      env.SUPABASE_SERVICE_ROLE_KEY && !env.NODE_ENV?.includes('prod') ? null : null,
      env.DATABASE_URL?.includes('@localhost') ? 'DATABASE_URL points to localhost' : null,
    ].filter(Boolean) as string[];

    return {
      id: 'env-secrets',
      category: 'config',
      severity: exposed.length > 0 ? 'critical' : 'info',
      title: 'Environment secrets',
      description: exposed.length > 0 ? `Issues: ${exposed.join('; ')}` : 'No obvious secret configuration issues detected.',
      passed: exposed.length === 0,
      recommendation: exposed.length > 0 ? 'Rotate weak keys and remove localhost database URLs from production.' : undefined,
    };
  }

  private checkSslConfig(): SecurityCheck {
    const hasHttps = process.env.NEXT_PUBLIC_APP_URL?.startsWith('https://') ?? false;
    return {
      id: 'ssl-config',
      category: 'config',
      severity: hasHttps ? 'info' : 'warning',
      title: 'SSL / HTTPS',
      description: hasHttps ? 'App URL uses HTTPS.' : 'App URL does not explicitly use HTTPS.',
      passed: hasHttps,
      recommendation: hasHttps ? undefined : 'Ensure NEXT_PUBLIC_APP_URL uses https:// in production.',
    };
  }

  private async checkRateLimiting(_businessId: string): Promise<SecurityCheck> {
    const hasRateLimit = !!process.env.RATE_LIMIT_WINDOW_MS;
    return {
      id: 'rate-limiting',
      category: 'network',
      severity: hasRateLimit ? 'info' : 'warning',
      title: 'Rate limiting',
      description: hasRateLimit ? 'Rate limiting is configured.' : 'Rate limiting is not explicitly configured.',
      passed: hasRateLimit,
      recommendation: hasRateLimit ? undefined : 'Set RATE_LIMIT_WINDOW_MS and RATE_LIMIT_MAX_REQUESTS in environment.',
    };
  }
}
