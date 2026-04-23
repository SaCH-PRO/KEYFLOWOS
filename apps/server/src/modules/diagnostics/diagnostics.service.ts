import { Injectable, Logger, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  latencyMs: number;
  checkedAt: string;
  message?: string;
  detail?: string;
}

export interface CategoryResult {
  category: string;
  checks: CheckResult[];
  overallStatus: CheckStatus;
}

export interface DiagnosticsReport {
  runAt: string;
  durationMs: number;
  overallStatus: CheckStatus;
  healthScore: number;
  categories: CategoryResult[];
}

function worstStatus(statuses: CheckStatus[]): CheckStatus {
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('warn')) return 'warn';
  return 'pass';
}

@Injectable()
export class DiagnosticsService {
  private readonly logger = new Logger(DiagnosticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─────────────────────────────────────────────────────────
  // Infrastructure
  // ─────────────────────────────────────────────────────────

  async checkDatabase(): Promise<CheckResult> {
    const start = Date.now();
    try {
      await this.prisma.client.$queryRaw`SELECT 1`;
      return {
        name: 'PostgreSQL / Prisma',
        status: 'pass',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: 'Database connection healthy',
      };
    } catch (err: any) {
      return {
        name: 'PostgreSQL / Prisma',
        status: 'fail',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: 'Database connection failed',
        detail: err.message,
      };
    }
  }

  async checkSupabase(): Promise<CheckResult> {
    const start = Date.now();
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
      return {
        name: 'Supabase Auth',
        status: 'warn',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: 'Supabase env vars not configured',
        detail: 'SUPABASE_URL and SUPABASE_ANON_KEY are required',
      };
    }

    try {
      const res = await fetch(`${url}/auth/v1/health`, {
        headers: { apikey: anonKey },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        return {
          name: 'Supabase Auth',
          status: 'pass',
          latencyMs: Date.now() - start,
          checkedAt: new Date().toISOString(),
          message: 'Supabase auth service reachable',
        };
      }
      return {
        name: 'Supabase Auth',
        status: 'warn',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: `Supabase returned HTTP ${res.status}`,
      };
    } catch (err: any) {
      return {
        name: 'Supabase Auth',
        status: 'fail',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: 'Supabase auth service unreachable',
        detail: err.message,
      };
    }
  }

  async checkObjectStorage(): Promise<CheckResult> {
    const start = Date.now();
    const privateDir = process.env.PRIVATE_OBJECT_DIR;
    const publicPaths = process.env.PUBLIC_OBJECT_SEARCH_PATHS;

    if (!privateDir || !publicPaths) {
      return {
        name: 'Object Storage',
        status: 'warn',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: 'Object Storage not fully configured',
        detail: `Missing: ${!privateDir ? 'PRIVATE_OBJECT_DIR ' : ''}${!publicPaths ? 'PUBLIC_OBJECT_SEARCH_PATHS' : ''}`,
      };
    }

    try {
      const res = await fetch('http://127.0.0.1:1106/credential', {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        return {
          name: 'Object Storage',
          status: 'pass',
          latencyMs: Date.now() - start,
          checkedAt: new Date().toISOString(),
          message: 'Object Storage sidecar reachable',
        };
      }
      return {
        name: 'Object Storage',
        status: 'warn',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: `Object Storage sidecar returned HTTP ${res.status}`,
      };
    } catch (err: any) {
      return {
        name: 'Object Storage',
        status: 'warn',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: 'Object Storage sidecar not reachable (may be normal outside Replit)',
        detail: err.message,
      };
    }
  }

  async checkServerUptime(): Promise<CheckResult> {
    const uptimeSec = process.uptime();
    const memUsage = process.memoryUsage();
    const heapUsedMb = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMb = Math.round(memUsage.heapTotal / 1024 / 1024);
    const heapPct = Math.round((heapUsedMb / heapTotalMb) * 100);

    const status: CheckStatus = heapPct > 90 ? 'warn' : 'pass';

    return {
      name: 'Server Uptime & Memory',
      status,
      latencyMs: 0,
      checkedAt: new Date().toISOString(),
      message: `Uptime: ${Math.floor(uptimeSec / 60)}m ${Math.floor(uptimeSec % 60)}s — Heap: ${heapUsedMb}/${heapTotalMb} MB (${heapPct}%)`,
    };
  }

  async checkInfrastructure(): Promise<CategoryResult> {
    const [db, supabase, storage, uptime] = await Promise.all([
      this.checkDatabase(),
      this.checkSupabase(),
      this.checkObjectStorage(),
      this.checkServerUptime(),
    ]);
    const checks = [db, supabase, storage, uptime];
    return {
      category: 'Infrastructure',
      checks,
      overallStatus: worstStatus(checks.map((c) => c.status)),
    };
  }

  // ─────────────────────────────────────────────────────────
  // Modules
  // ─────────────────────────────────────────────────────────

  private async checkModuleDb(name: string, countFn: () => Promise<number>): Promise<CheckResult> {
    const start = Date.now();
    try {
      const count = await countFn();
      return {
        name,
        status: 'pass',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: `Service layer responsive (${count} records accessible)`,
      };
    } catch (err: any) {
      return {
        name,
        status: 'fail',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: `Service layer error`,
        detail: err.message,
      };
    }
  }

  async checkModules(): Promise<CategoryResult> {
    const checks = await Promise.all([
      this.checkModuleDb('CRM Module', () =>
        this.prisma.client.contact.count({ where: { deletedAt: null } })),
      this.checkModuleDb('Commerce Module', () =>
        this.prisma.client.invoice.count({ where: { deletedAt: null } })),
      this.checkModuleDb('Bookings Module', () =>
        this.prisma.client.booking.count({ where: { deletedAt: null } })),
      this.checkModuleDb('Identity Module', () =>
        this.prisma.client.business.count()),
      this.checkModuleDb('AI Module', () =>
        this.prisma.client.aiUsageLog.count()),
      this.checkModuleDb('Automation Module', () =>
        this.prisma.client.automation.count()),
      this.checkModuleDb('Payments Module', () =>
        this.prisma.client.payment.count()),
      this.checkModuleDb('Notifications Module', () =>
        this.prisma.client.notification.count({ where: { read: false } })),
      this.checkModuleDb('Reports Module', () =>
        this.prisma.client.contact.count()),
      this.checkModuleDb('Marketing Module', () =>
        this.prisma.client.emailCampaign.count()),
    ]);

    return {
      category: 'Modules',
      checks,
      overallStatus: worstStatus(checks.map((c) => c.status)),
    };
  }

  // ─────────────────────────────────────────────────────────
  // Integrations
  // ─────────────────────────────────────────────────────────

  async checkOpenAI(): Promise<CheckResult> {
    const start = Date.now();
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

    if (!apiKey) {
      return {
        name: 'OpenAI API',
        status: 'warn',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: 'AI_INTEGRATIONS_OPENAI_API_KEY not configured',
      };
    }

    const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || 'https://api.openai.com';
    try {
      const res = await fetch(`${baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        return {
          name: 'OpenAI API',
          status: 'pass',
          latencyMs: Date.now() - start,
          checkedAt: new Date().toISOString(),
          message: 'OpenAI API reachable and key valid',
        };
      }
      if (res.status === 401) {
        return {
          name: 'OpenAI API',
          status: 'fail',
          latencyMs: Date.now() - start,
          checkedAt: new Date().toISOString(),
          message: 'OpenAI API key is invalid (401 Unauthorized)',
        };
      }
      return {
        name: 'OpenAI API',
        status: 'warn',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: `OpenAI API returned HTTP ${res.status}`,
      };
    } catch (err: any) {
      return {
        name: 'OpenAI API',
        status: 'fail',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: 'OpenAI API unreachable',
        detail: err.message,
      };
    }
  }

  async checkGoogleOAuth(): Promise<CheckResult> {
    const start = Date.now();
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return {
        name: 'Google OAuth',
        status: 'warn',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: 'Google OAuth credentials not configured',
        detail: `Missing: ${!clientId ? 'GOOGLE_CLIENT_ID ' : ''}${!clientSecret ? 'GOOGLE_CLIENT_SECRET' : ''}`,
      };
    }

    try {
      const res = await fetch('https://accounts.google.com/.well-known/openid-configuration', {
        signal: AbortSignal.timeout(5000),
      });
      return {
        name: 'Google OAuth',
        status: res.ok ? 'pass' : 'warn',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: res.ok
          ? 'Google OAuth credentials present; discovery endpoint reachable'
          : `Google OAuth credentials present but discovery returned HTTP ${res.status}`,
      };
    } catch (err: any) {
      return {
        name: 'Google OAuth',
        status: 'warn',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: 'Google OAuth credentials present but discovery unreachable',
        detail: err.message,
      };
    }
  }

  async checkPayPal(): Promise<CheckResult> {
    const start = Date.now();
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return {
        name: 'PayPal Gateway',
        status: 'warn',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: 'PayPal credentials not configured',
      };
    }

    try {
      const isProduction = process.env.PAYPAL_ENVIRONMENT === 'production';
      const baseUrl = isProduction
        ? 'https://api-m.paypal.com'
        : 'https://api-m.sandbox.paypal.com';
      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

      const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok) {
        return {
          name: 'PayPal Gateway',
          status: 'pass',
          latencyMs: Date.now() - start,
          checkedAt: new Date().toISOString(),
          message: `PayPal ${isProduction ? 'production' : 'sandbox'} credentials valid`,
        };
      }
      return {
        name: 'PayPal Gateway',
        status: 'fail',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: `PayPal auth failed (HTTP ${res.status})`,
      };
    } catch (err: any) {
      return {
        name: 'PayPal Gateway',
        status: 'fail',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: 'PayPal API unreachable',
        detail: err.message,
      };
    }
  }

  async checkWiPay(): Promise<CheckResult> {
    const start = Date.now();
    const apiKey = process.env.WIPAY_API_KEY;
    const accountNumber = process.env.WIPAY_ACCOUNT_NUMBER;

    if (!apiKey && !accountNumber) {
      return {
        name: 'WiPay Gateway',
        status: 'warn',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: 'WiPay not configured (WIPAY_API_KEY / WIPAY_ACCOUNT_NUMBER)',
      };
    }

    try {
      const res = await fetch('https://sandbox.wipayfinancial.com/v1/gateway', {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      });
      return {
        name: 'WiPay Gateway',
        status: 'pass',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: `WiPay credentials present; gateway reachable (HTTP ${res.status})`,
      };
    } catch (err: any) {
      return {
        name: 'WiPay Gateway',
        status: 'warn',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: 'WiPay credentials present but gateway unreachable',
        detail: err.message,
      };
    }
  }

  async checkStripe(): Promise<CheckResult> {
    const start = Date.now();
    const secretKey = process.env.STRIPE_SECRET_KEY;

    if (!secretKey) {
      return {
        name: 'Stripe Gateway',
        status: 'warn',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: 'STRIPE_SECRET_KEY not configured',
      };
    }

    try {
      const res = await fetch('https://api.stripe.com/v1/balance', {
        headers: {
          Authorization: `Bearer ${secretKey}`,
        },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        return {
          name: 'Stripe Gateway',
          status: 'pass',
          latencyMs: Date.now() - start,
          checkedAt: new Date().toISOString(),
          message: 'Stripe API reachable and key valid',
        };
      }
      if (res.status === 401) {
        return {
          name: 'Stripe Gateway',
          status: 'fail',
          latencyMs: Date.now() - start,
          checkedAt: new Date().toISOString(),
          message: 'Stripe API key is invalid (401 Unauthorized)',
        };
      }
      return {
        name: 'Stripe Gateway',
        status: 'warn',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: `Stripe API returned HTTP ${res.status}`,
      };
    } catch (err: any) {
      return {
        name: 'Stripe Gateway',
        status: 'fail',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: 'Stripe API unreachable',
        detail: err.message,
      };
    }
  }

  private async checkSocialPlatformConnections(platform: string): Promise<CheckResult> {
    const start = Date.now();
    const platformKey = platform.toUpperCase();

    try {
      const connectedCount = await this.prisma.client.socialConnection.count({
        where: { platform: platformKey, status: 'CONNECTED' },
      });
      const expiredCount = await this.prisma.client.socialConnection.count({
        where: { platform: platformKey, status: 'EXPIRED' },
      });
      const total = connectedCount + expiredCount;

      if (total === 0) {
        return {
          name: `${platform} Integration`,
          status: 'warn',
          latencyMs: Date.now() - start,
          checkedAt: new Date().toISOString(),
          message: `No ${platform} accounts connected by any business`,
        };
      }

      const status: CheckStatus = expiredCount > 0 && connectedCount === 0 ? 'warn' : 'pass';
      return {
        name: `${platform} Integration`,
        status,
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: `${platform}: ${connectedCount} connected, ${expiredCount} expired`,
      };
    } catch (err: any) {
      return {
        name: `${platform} Integration`,
        status: 'fail',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: `Failed to query ${platform} connection status`,
        detail: err.message,
      };
    }
  }

  async checkIntegrations(): Promise<CategoryResult> {
    const [openai, google, paypal, wipay, stripe, fb, ig, li, tw, tt] = await Promise.all([
      this.checkOpenAI(),
      this.checkGoogleOAuth(),
      this.checkPayPal(),
      this.checkWiPay(),
      this.checkStripe(),
      this.checkSocialPlatformConnections('Facebook'),
      this.checkSocialPlatformConnections('Instagram'),
      this.checkSocialPlatformConnections('LinkedIn'),
      this.checkSocialPlatformConnections('Twitter'),
      this.checkSocialPlatformConnections('TikTok'),
    ]);

    const allChecks = [openai, google, paypal, wipay, stripe, fb, ig, li, tw, tt];
    return {
      category: 'Integrations',
      checks: allChecks,
      overallStatus: worstStatus(allChecks.map((c) => c.status)),
    };
  }

  // ─────────────────────────────────────────────────────────
  // Cross-Module Flows
  // ─────────────────────────────────────────────────────────

  async checkCrossModuleFlows(): Promise<CategoryResult> {
    const checks = await Promise.all([
      this.checkContactTimeline(),
      this.checkInvoiceContactLink(),
      this.checkBookingServiceLink(),
      this.checkEventBusDispatch(),
    ]);

    return {
      category: 'Cross-Module Flows',
      checks,
      overallStatus: worstStatus(checks.map((c) => c.status)),
    };
  }

  private async checkContactTimeline(): Promise<CheckResult> {
    const start = Date.now();
    try {
      const contact = await this.prisma.client.contact.findFirst({
        where: { deletedAt: null },
        select: { id: true, businessId: true },
      });

      if (!contact) {
        return {
          name: 'Contact → Timeline Link',
          status: 'warn',
          latencyMs: Date.now() - start,
          checkedAt: new Date().toISOString(),
          message: 'No contacts found to verify timeline linkage',
        };
      }

      const eventsCount = await this.prisma.client.contactEvent.count({
        where: { contactId: contact.id },
      });

      return {
        name: 'Contact → Timeline Link',
        status: 'pass',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: `Contact-to-timeline linkage verified (${eventsCount} events for sample contact)`,
      };
    } catch (err: any) {
      return {
        name: 'Contact → Timeline Link',
        status: 'fail',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: 'Failed to verify contact-timeline linkage',
        detail: err.message,
      };
    }
  }

  private async checkInvoiceContactLink(): Promise<CheckResult> {
    const start = Date.now();
    try {
      const invoice = await this.prisma.client.invoice.findFirst({
        where: { deletedAt: null },
        select: { id: true, contactId: true },
      });

      if (!invoice || !invoice.contactId) {
        return {
          name: 'Invoice → CRM Contact Link',
          status: 'warn',
          latencyMs: Date.now() - start,
          checkedAt: new Date().toISOString(),
          message: 'No invoices with contact links found to verify',
        };
      }

      const contact = await this.prisma.client.contact.findFirst({
        where: { id: invoice.contactId, deletedAt: null },
        select: { id: true },
      });

      return {
        name: 'Invoice → CRM Contact Link',
        status: contact ? 'pass' : 'fail',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: contact
          ? 'Invoice-to-contact linkage verified'
          : 'Invoice references a deleted or missing contact',
      };
    } catch (err: any) {
      return {
        name: 'Invoice → CRM Contact Link',
        status: 'fail',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: 'Failed to verify invoice-contact linkage',
        detail: err.message,
      };
    }
  }

  private async checkBookingServiceLink(): Promise<CheckResult> {
    const start = Date.now();
    try {
      const booking = await this.prisma.client.booking.findFirst({
        where: { deletedAt: null },
        select: { id: true, serviceId: true },
      });

      if (!booking) {
        return {
          name: 'Booking → Service Link',
          status: 'warn',
          latencyMs: Date.now() - start,
          checkedAt: new Date().toISOString(),
          message: 'No bookings found to verify service linkage',
        };
      }

      const service = await this.prisma.client.service.findFirst({
        where: { id: booking.serviceId },
        select: { id: true },
      });

      return {
        name: 'Booking → Service Link',
        status: service ? 'pass' : 'fail',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: service
          ? 'Booking-to-service linkage verified'
          : 'Booking references a missing or deleted service',
      };
    } catch (err: any) {
      return {
        name: 'Booking → Service Link',
        status: 'fail',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: 'Failed to verify booking-service linkage',
        detail: err.message,
      };
    }
  }

  private async checkEventBusDispatch(): Promise<CheckResult> {
    const start = Date.now();
    try {
      const probeEvent = `diagnostics.probe.${Date.now()}`;
      let received = false;

      const listener = () => { received = true; };
      this.eventEmitter.once(probeEvent, listener);

      await this.eventEmitter.emitAsync(probeEvent, { source: 'diagnostics' });

      this.eventEmitter.removeListener(probeEvent, listener);

      return {
        name: 'EventBus Dispatch & Receive',
        status: received ? 'pass' : 'warn',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: received
          ? 'EventBus emit→receive round-trip confirmed (in-process)'
          : 'EventBus emit completed but no listener confirmed receipt',
      };
    } catch (err: any) {
      return {
        name: 'EventBus Dispatch & Receive',
        status: 'fail',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: 'EventBus dispatch failed',
        detail: err.message,
      };
    }
  }

  // ─────────────────────────────────────────────────────────
  // Environment Variables
  // ─────────────────────────────────────────────────────────

  async checkEnvVars(): Promise<CategoryResult> {
    const required: Array<{ key: string; label: string; format?: RegExp }> = [
      { key: 'DATABASE_URL', label: 'Database URL', format: /^postgresql:\/\// },
      { key: 'SUPABASE_URL', label: 'Supabase URL', format: /^https?:\/\// },
      { key: 'SUPABASE_ANON_KEY', label: 'Supabase Anon Key' },
      { key: 'AI_INTEGRATIONS_OPENAI_API_KEY', label: 'OpenAI API Key', format: /^sk-/ },
      { key: 'GOOGLE_CLIENT_ID', label: 'Google Client ID' },
      { key: 'GOOGLE_CLIENT_SECRET', label: 'Google Client Secret' },
      { key: 'GOOGLE_STATE_SECRET', label: 'Google State Secret' },
    ];

    const optional: Array<{ key: string; label: string }> = [
      { key: 'STRIPE_SECRET_KEY', label: 'Stripe Secret Key' },
      { key: 'PAYPAL_CLIENT_ID', label: 'PayPal Client ID' },
      { key: 'PAYPAL_CLIENT_SECRET', label: 'PayPal Client Secret' },
      { key: 'WIPAY_API_KEY', label: 'WiPay API Key' },
      { key: 'WIPAY_ACCOUNT_NUMBER', label: 'WiPay Account Number' },
      { key: 'FACEBOOK_APP_ID', label: 'Facebook App ID' },
      { key: 'FACEBOOK_APP_SECRET', label: 'Facebook App Secret' },
      { key: 'LINKEDIN_CLIENT_ID', label: 'LinkedIn Client ID' },
      { key: 'LINKEDIN_CLIENT_SECRET', label: 'LinkedIn Client Secret' },
      { key: 'TWITTER_CLIENT_ID', label: 'Twitter Client ID' },
      { key: 'TWITTER_CLIENT_SECRET', label: 'Twitter Client Secret' },
      { key: 'TIKTOK_CLIENT_KEY', label: 'TikTok Client Key' },
      { key: 'TIKTOK_CLIENT_SECRET', label: 'TikTok Client Secret' },
      { key: 'PRIVATE_OBJECT_DIR', label: 'Object Storage Private Dir' },
      { key: 'PUBLIC_OBJECT_SEARCH_PATHS', label: 'Object Storage Public Paths' },
    ];

    const checks: CheckResult[] = [];

    for (const r of required) {
      const val = process.env[r.key];
      const present = !!val;
      const formatOk = !r.format || (present && r.format.test(val!));
      let status: CheckStatus = 'pass';
      let message = `${r.label}: present`;

      if (!present) {
        status = 'fail';
        message = `${r.label}: MISSING — set ${r.key}`;
      } else if (!formatOk) {
        status = 'warn';
        message = `${r.label}: present but unexpected format`;
      }

      checks.push({
        name: r.key,
        status,
        latencyMs: 0,
        checkedAt: new Date().toISOString(),
        message,
      });
    }

    for (const o of optional) {
      const val = process.env[o.key];
      checks.push({
        name: o.key,
        status: val ? 'pass' : 'warn',
        latencyMs: 0,
        checkedAt: new Date().toISOString(),
        message: val ? `${o.label}: present` : `${o.label}: not set (optional)`,
      });
    }

    return {
      category: 'Environment Variables',
      checks,
      overallStatus: worstStatus(checks.map((c) => c.status)),
    };
  }

  // ─────────────────────────────────────────────────────────
  // Individual check by name
  // ─────────────────────────────────────────────────────────

  async runSingleCheck(checkName: string): Promise<CheckResult | null> {
    const checkMap: Record<string, () => Promise<CheckResult>> = {
      'PostgreSQL / Prisma': () => this.checkDatabase(),
      'Supabase Auth': () => this.checkSupabase(),
      'Object Storage': () => this.checkObjectStorage(),
      'Server Uptime & Memory': () => this.checkServerUptime(),
      'OpenAI API': () => this.checkOpenAI(),
      'Google OAuth': () => this.checkGoogleOAuth(),
      'PayPal Gateway': () => this.checkPayPal(),
      'WiPay Gateway': () => this.checkWiPay(),
      'Stripe Gateway': () => this.checkStripe(),
      'EventBus Dispatch & Receive': () => this.checkEventBusDispatch(),
      'Contact → Timeline Link': () => this.checkContactTimeline(),
      'Invoice → CRM Contact Link': () => this.checkInvoiceContactLink(),
      'Booking → Service Link': () => this.checkBookingServiceLink(),
    };

    const fn = checkMap[checkName];
    if (fn) return fn();

    if (checkName.endsWith(' Module')) {
      return this.runModuleCheck(checkName);
    }

    if (checkName.endsWith(' Integration')) {
      const platform = checkName.replace(' Integration', '');
      return this.checkSocialPlatformConnections(platform);
    }

    // env-var checks: the name is the env key itself
    const envKey = checkName;
    if (process.env[envKey] !== undefined || this.isKnownEnvKey(envKey)) {
      return this.runEnvVarCheck(envKey);
    }

    return null;
  }

  private isKnownEnvKey(key: string): boolean {
    const known = new Set([
      'DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY',
      'AI_INTEGRATIONS_OPENAI_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
      'GOOGLE_STATE_SECRET', 'STRIPE_SECRET_KEY', 'PAYPAL_CLIENT_ID',
      'PAYPAL_CLIENT_SECRET', 'WIPAY_API_KEY', 'WIPAY_ACCOUNT_NUMBER',
      'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET', 'LINKEDIN_CLIENT_ID',
      'LINKEDIN_CLIENT_SECRET', 'TWITTER_CLIENT_ID', 'TWITTER_CLIENT_SECRET',
      'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET',
      'PRIVATE_OBJECT_DIR', 'PUBLIC_OBJECT_SEARCH_PATHS',
    ]);
    return known.has(key);
  }

  private runEnvVarCheck(key: string): CheckResult {
    const val = process.env[key];
    const formatMap: Record<string, RegExp> = {
      DATABASE_URL: /^postgresql:\/\//,
      SUPABASE_URL: /^https?:\/\//,
      AI_INTEGRATIONS_OPENAI_API_KEY: /^sk-/,
    };
    const format = formatMap[key];
    const required = new Set([
      'DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY',
      'AI_INTEGRATIONS_OPENAI_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
      'GOOGLE_STATE_SECRET',
    ]);

    const isRequired = required.has(key);
    let status: CheckStatus;
    let message: string;

    if (!val) {
      status = isRequired ? 'fail' : 'warn';
      message = isRequired ? `${key}: MISSING — required` : `${key}: not set (optional)`;
    } else if (format && !format.test(val)) {
      status = 'warn';
      message = `${key}: present but unexpected format`;
    } else {
      status = 'pass';
      message = `${key}: present`;
    }

    return { name: key, status, latencyMs: 0, checkedAt: new Date().toISOString(), message };
  }

  private async runModuleCheck(name: string): Promise<CheckResult> {
    const moduleMap: Record<string, () => Promise<number>> = {
      'CRM Module': () => this.prisma.client.contact.count({ where: { deletedAt: null } }),
      'Commerce Module': () => this.prisma.client.invoice.count({ where: { deletedAt: null } }),
      'Bookings Module': () => this.prisma.client.booking.count({ where: { deletedAt: null } }),
      'Identity Module': () => this.prisma.client.business.count(),
      'AI Module': () => this.prisma.client.aiUsageLog.count(),
      'Automation Module': () => this.prisma.client.automation.count(),
      'Payments Module': () => this.prisma.client.payment.count(),
      'Notifications Module': () => this.prisma.client.notification.count({ where: { read: false } }),
      'Reports Module': () => this.prisma.client.contact.count(),
      'Marketing Module': () => this.prisma.client.emailCampaign.count(),
    };
    const fn = moduleMap[name];
    if (!fn) {
      return {
        name,
        status: 'warn',
        latencyMs: 0,
        checkedAt: new Date().toISOString(),
        message: `No check registered for "${name}"`,
      };
    }
    return this.checkModuleDb(name, fn);
  }

  // ─────────────────────────────────────────────────────────
  // Full Diagnostic Sweep
  // ─────────────────────────────────────────────────────────

  async runFullDiagnostics(): Promise<DiagnosticsReport> {
    const start = Date.now();

    const [infrastructure, modules, integrations, crossModule, envVars] = await Promise.all([
      this.checkInfrastructure(),
      this.checkModules(),
      this.checkIntegrations(),
      this.checkCrossModuleFlows(),
      this.checkEnvVars(),
    ]);

    const categories = [infrastructure, modules, integrations, crossModule, envVars];
    const allChecks = categories.flatMap((c) => c.checks);
    const passCount = allChecks.filter((c) => c.status === 'pass').length;
    const healthScore = Math.round((passCount / allChecks.length) * 100);
    const overallStatus = worstStatus(categories.map((c) => c.overallStatus));

    return {
      runAt: new Date().toISOString(),
      durationMs: Date.now() - start,
      overallStatus,
      healthScore,
      categories,
    };
  }
}
