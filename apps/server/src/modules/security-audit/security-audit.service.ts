import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

/**
 * What a check concluded. 'not_tracked' is a check the audit cannot measure because nothing records
 * the state it is about: it is listed so the owner sees the gap, and it is neither a pass nor a
 * failure (V1-63 SWP-SEC-AUDIT-TRUTH, sweep BUG-065).
 */
export type SecurityCheckStatus = 'passed' | 'failed' | 'not_tracked';

/**
 * What a check is about. 'business': the business's own state (its members, contacts and privacy
 * settings). 'platform': the server's process.env, so the whole deployment, the same answer for every
 * tenant; it is served to a platform SUPER_ADMIN only (checksVisibleTo; review SEC-AUDIT-ENV-1).
 */
export type SecurityCheckScope = 'business' | 'platform';

export interface SecurityCheck {
  id: string;
  category: 'auth' | 'data' | 'config' | 'network';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  status: SecurityCheckStatus;
  scope: SecurityCheckScope;
  /** True exactly when status is 'passed' (kept for readers of the earlier shape). */
  passed: boolean;
  recommendation?: string;
}

/** A check's conclusion when it was measured: its status follows `passed`. */
type MeasuredCheck = Omit<SecurityCheck, 'status'>;

function measured(check: MeasuredCheck): SecurityCheck {
  return { ...check, status: check.passed ? 'passed' : 'failed' };
}

/** A check the audit lists but cannot measure: no pass, no failure, no recommendation. */
function notTracked(check: Pick<SecurityCheck, 'id' | 'category' | 'title' | 'description' | 'scope'>): SecurityCheck {
  return { ...check, severity: 'info', status: 'not_tracked', passed: false };
}

/** The member a check list is served to, as AuthMiddleware attaches it (User.role read from the row). */
export type AuditViewer = { role?: string } | null | undefined;

/**
 * The checks this viewer may read (V1-63 SWP-SEC-AUDIT-TRUTH, review SEC-AUDIT-ENV-1). A platform check
 * describes the whole deployment's configuration, not the business: the settings read gate is scoped to
 * one business and every self-signup owns one (D-03), so that gate cannot protect it, and a tenant could
 * read the platform's secret-configuration posture ("SUPABASE_SERVICE_ROLE_KEY is identical to the public
 * anon key" says the key in the browser bundle is the privileged one). Only a platform SUPER_ADMIN, the
 * platform's operator, is served the platform checks; everyone else gets the business's own checks. A
 * check that does not say 'business' is withheld from a tenant (fails closed).
 */
export function checksVisibleTo(checks: SecurityCheck[], viewer: AuditViewer): SecurityCheck[] {
  if (viewer?.role === 'SUPER_ADMIN') return checks;
  return checks.filter((c) => c.scope === 'business');
}

export interface SecurityAuditSummary {
  /** Percent of the measured checks that passed; null when nothing was measured. */
  score: number | null;
  /** Measured checks that passed. */
  passed: number;
  /** Measured checks (status 'passed' or 'failed'); a not-tracked check is not counted. */
  total: number;
  /** Checks listed but not measured (status 'not_tracked'). */
  notTracked: number;
  checks: SecurityCheck[];
}

/**
 * The audit's answer. Only measured checks count toward the score, `passed` and `total`: a check the
 * audit cannot measure is reported as not tracked, never as a pass (BUG-065: "100% of team members
 * have MFA enabled" was counted as a passed check although MFA is not tracked).
 */
export function summarizeAudit(checks: SecurityCheck[]): SecurityAuditSummary {
  const scored = checks.filter((c) => c.status !== 'not_tracked');
  const passed = scored.filter((c) => c.status === 'passed').length;
  const total = scored.length;
  return {
    score: total > 0 ? Math.round((passed / total) * 100) : null,
    passed,
    total,
    notTracked: checks.length - total,
    checks,
  };
}

@Injectable()
export class SecurityAuditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Every check, the business's and the platform's (scope). The route serves each viewer what
   * checksVisibleTo allows: a tenant member gets the business checks only.
   */
  async runAudit(businessId: string): Promise<SecurityCheck[]> {
    const checks: SecurityCheck[] = [];

    // Auth checks (MFA and inactive users: the business's members; password policy: the platform)
    checks.push(this.checkMfaEnforcement());
    checks.push(await this.checkPasswordPolicy(businessId));
    checks.push(this.checkInactiveUsers());

    // Data checks (the business)
    checks.push(await this.checkConsentCoverage(businessId));
    checks.push(await this.checkPrivacySettings(businessId));

    // Config checks (the platform)
    checks.push(this.checkEnvSecrets());
    checks.push(this.checkSslConfig());

    // Network checks (the platform)
    checks.push(await this.checkRateLimiting(businessId));

    return checks;
  }

  /**
   * Not tracked (V1-63 SWP-SEC-AUDIT-TRUTH, sweep BUG-065). Nothing records whether a team member
   * uses multi-factor authentication, and v1 adds no MFA tracking, so the audit makes no claim about
   * it: no percentage, no member count and no pass. This check used to read the memberships and
   * report a hard-coded `mfaRate = 1` as "100% of team members have MFA enabled" and a passed check.
   */
  private checkMfaEnforcement(): SecurityCheck {
    return notTracked({
      id: 'mfa-enforcement',
      category: 'auth',
      scope: 'business',
      title: 'Multi-factor authentication',
      description:
        'Not tracked: KEYFLOWOS does not record whether team members use multi-factor authentication, so this audit makes no claim about it.',
    });
  }

  private async checkPasswordPolicy(_businessId: string): Promise<SecurityCheck> {
    const minLength = process.env.PASSWORD_MIN_LENGTH ? parseInt(process.env.PASSWORD_MIN_LENGTH, 10) : 8;
    return measured({
      id: 'password-policy',
      category: 'auth',
      scope: 'platform',
      severity: minLength < 8 ? 'warning' : 'info',
      title: 'Password policy',
      description: `Minimum password length is ${minLength} characters.`,
      passed: minLength >= 8,
      recommendation: minLength < 8 ? 'Set PASSWORD_MIN_LENGTH=12 in environment variables.' : undefined,
    });
  }

  /**
   * Not tracked, as the MFA check (the same claim class, sweep BUG-065): no last sign-in is recorded
   * for a user, so the audit cannot tell an inactive member. This check used to hard-code
   * `inactive = 0` and report "0 team member(s) have not logged in for 30+ days" as a passed check.
   */
  private checkInactiveUsers(): SecurityCheck {
    return notTracked({
      id: 'inactive-users',
      category: 'auth',
      scope: 'business',
      title: 'Inactive users',
      description:
        'Not tracked: KEYFLOWOS does not record when a team member last signed in, so this audit makes no claim about inactive members.',
    });
  }

  private async checkConsentCoverage(businessId: string): Promise<SecurityCheck> {
    const contactCount = await this.prisma.client.contact.count({ where: { businessId, deletedAt: null } });
    const consentCount = await this.prisma.client.consentRecord.count({ where: { businessId } });
    const coverage = contactCount > 0 ? Math.min(consentCount / contactCount, 1) : 1;

    return measured({
      id: 'consent-coverage',
      category: 'data',
      scope: 'business',
      severity: coverage < 0.5 ? 'warning' : 'info',
      title: 'Consent coverage',
      description: `${Math.round(coverage * 100)}% of contacts have consent records (${consentCount}/${contactCount}).`,
      passed: coverage >= 0.5,
      recommendation: coverage < 1 ? 'Collect explicit consent via forms or onboarding.' : undefined,
    });
  }

  private async checkPrivacySettings(businessId: string): Promise<SecurityCheck> {
    const biz = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { forgetGraceDays: true, defaultForgetReason: true },
    });
    const hasGraceDays = typeof biz?.forgetGraceDays === 'number';
    return measured({
      id: 'privacy-settings',
      category: 'data',
      scope: 'business',
      severity: hasGraceDays ? 'info' : 'warning',
      title: 'Privacy settings',
      description: hasGraceDays ? `Forget grace window is ${biz.forgetGraceDays} days.` : 'No forget grace window configured.',
      passed: hasGraceDays,
      recommendation: hasGraceDays ? undefined : 'Set a forget grace window in Settings > Privacy.',
    });
  }

  private checkEnvSecrets(): SecurityCheck {
    const env = process.env;
    const isProd = (env.NODE_ENV ?? '').includes('prod');
    const serviceRoleKey = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
    const anonKey = (env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();

    // The Supabase entry here used to read:
    //
    //   env.SUPABASE_SERVICE_ROLE_KEY && !env.NODE_ENV?.includes('prod') ? null : null
    //
    // Both branches are `null`, so this check could never contribute a finding
    // however the environment was configured. It reported "no obvious secret
    // configuration issues detected" unconditionally — a green light that
    // could not turn red, which is worse than no check because it is trusted.
    //
    // What it must NOT do is flag the mere presence of the key outside
    // production: main.ts requires SUPABASE_SERVICE_ROLE_KEY for signup in
    // every environment, so that would fire on every developer machine and the
    // whole audit would be ignored. These three conditions are things that are
    // actually wrong.
    const exposed = [
      env.AI_INTEGRATIONS_OPENAI_API_KEY && env.AI_INTEGRATIONS_OPENAI_API_KEY.length < 20 ? 'AI_INTEGRATIONS_OPENAI_API_KEY appears short/weak' : null,
      // A real service-role key is a JWT and is far longer than this; anything
      // shorter is truncated or a placeholder.
      serviceRoleKey && serviceRoleKey.length < 40 ? 'SUPABASE_SERVICE_ROLE_KEY appears short/weak' : null,
      // Copy-paste error: either the server has no elevated access, or the key
      // shipped to browsers is the privileged one.
      serviceRoleKey && anonKey && serviceRoleKey === anonKey ? 'SUPABASE_SERVICE_ROLE_KEY is identical to the public anon key' : null,
      isProd && !serviceRoleKey ? 'SUPABASE_SERVICE_ROLE_KEY is not set in production' : null,
      env.DATABASE_URL?.includes('@localhost') ? 'DATABASE_URL points to localhost' : null,
    ].filter(Boolean) as string[];

    return measured({
      id: 'env-secrets',
      category: 'config',
      scope: 'platform',
      severity: exposed.length > 0 ? 'critical' : 'info',
      title: 'Environment secrets',
      description: exposed.length > 0 ? `Issues: ${exposed.join('; ')}` : 'No obvious secret configuration issues detected.',
      passed: exposed.length === 0,
      recommendation: exposed.length > 0 ? 'Rotate weak keys and remove localhost database URLs from production.' : undefined,
    });
  }

  private checkSslConfig(): SecurityCheck {
    const hasHttps = process.env.NEXT_PUBLIC_APP_URL?.startsWith('https://') ?? false;
    return measured({
      id: 'ssl-config',
      category: 'config',
      scope: 'platform',
      severity: hasHttps ? 'info' : 'warning',
      title: 'SSL / HTTPS',
      description: hasHttps ? 'App URL uses HTTPS.' : 'App URL does not explicitly use HTTPS.',
      passed: hasHttps,
      recommendation: hasHttps ? undefined : 'Ensure NEXT_PUBLIC_APP_URL uses https:// in production.',
    });
  }

  private async checkRateLimiting(_businessId: string): Promise<SecurityCheck> {
    const hasRateLimit = !!process.env.RATE_LIMIT_WINDOW_MS;
    return measured({
      id: 'rate-limiting',
      category: 'network',
      scope: 'platform',
      severity: hasRateLimit ? 'info' : 'warning',
      title: 'Rate limiting',
      description: hasRateLimit ? 'Rate limiting is configured.' : 'Rate limiting is not explicitly configured.',
      passed: hasRateLimit,
      recommendation: hasRateLimit ? undefined : 'Set RATE_LIMIT_WINDOW_MS and RATE_LIMIT_MAX_REQUESTS in environment.',
    });
  }
}
