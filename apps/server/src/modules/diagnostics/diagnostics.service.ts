import { Injectable, Logger, Inject } from '@nestjs/common';
import { skipTenantIsolation } from '@keyflow/db';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { tokenEncryptionKeySource } from '@keyflow/db';
import { PrismaService } from '../../core/prisma/prisma.service';
import { QueueService } from '../ai/queue.service';
import { BusinessEventQueueService } from '../business-events/business-event.queue';
import { keyDisabled } from '../../core/config/env';

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

// ---------------------------------------------------------------------------
// Object-storage posture (RR-OBJECT-STORAGE-POSTURE-CHECK): pure, so the
// verdict is testable without a client.

/** One read-only bucket call, as it came back. */
export type PostureProbe =
  | { call: string; ok: true; value: unknown }
  | { call: string; ok: false; kind: 'absent' | 'denied' | 'not-implemented' | 'error'; code: string; message: string; http?: number };

/** 400-class codes that mean the credentials, not the call, were refused. */
const POSTURE_CREDENTIAL_CODES = new Set([
  'ExpiredToken',
  'InvalidToken',
  'TokenRefreshRequired',
  'InvalidAccessKeyId',
  'SignatureDoesNotMatch',
]);

/** Error codes that mean "the bucket has none of this", not "the call is unsupported". */
const POSTURE_ABSENT_CODES = new Set([
  'NoSuchPublicAccessBlockConfiguration',
  'NoSuchBucketPolicy',
  'ServerSideEncryptionConfigurationNotFoundError',
]);

/**
 * Sorts an SDK error into what it says about the provider: the configuration
 * is absent (a 404 with one of the known codes), the credentials may not read
 * it (access denied), the provider does not implement the call
 * (NotImplemented, 501, or any other 4xx), or something else went wrong.
 */
export function classifyPostureError(err: unknown): {
  kind: 'absent' | 'denied' | 'not-implemented' | 'error';
  code: string;
  message: string;
  http?: number;
} {
  const e = (err ?? {}) as { name?: unknown; Code?: unknown; message?: unknown; $metadata?: { httpStatusCode?: unknown } };
  const code = String(e.name || e.Code || 'Error');
  const message = typeof e.message === 'string' && e.message ? e.message : code;
  const http = typeof e.$metadata?.httpStatusCode === 'number' ? e.$metadata.httpStatusCode : undefined;
  if (POSTURE_ABSENT_CODES.has(code)) return { kind: 'absent', code, message };
  if (code === 'AccessDenied' || POSTURE_CREDENTIAL_CODES.has(code) || http === 403) {
    return { kind: 'denied', code, message };
  }
  if (code === 'NoSuchBucket') return { kind: 'error', code, message };
  if (code === 'NotImplemented' || http === 501 || (http !== undefined && http >= 400 && http < 500)) {
    return { kind: 'not-implemented', code, message, http };
  }
  return { kind: 'error', code, message };
}

/** The IAM action behind each read-only call, for the access-denied hint. */
const POSTURE_IAM_ACTION: Record<string, string> = {
  GetPublicAccessBlock: 's3:GetBucketPublicAccessBlock',
  GetBucketPolicyStatus: 's3:GetBucketPolicyStatus',
  GetBucketEncryption: 's3:GetEncryptionConfiguration',
};

const PUBLIC_ACCESS_BLOCK_FLAGS = ['BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets'] as const;

/**
 * The verdict: 'fail' when the bucket policy makes the bucket public; 'pass'
 * only when public access is fully blocked, the policy is not public (or
 * there is none) and default encryption is on; otherwise 'warn', with one
 * line per probe saying what was found or why it could not be judged.
 */
export function evaluateStoragePosture(probes: {
  publicAccessBlock: PostureProbe;
  policyStatus: PostureProbe;
  encryption: PostureProbe;
}): { status: CheckStatus; summary: string; lines: string[] } {
  const lines: string[] = [];
  let isPublic = false;
  let blocked = false;
  let encrypted = false;

  const unjudged = (p: Extract<PostureProbe, { ok: false }>): string => {
    switch (p.kind) {
      case 'denied':
        return `${p.call}: access denied (${p.code}; grant the diagnostics credentials ${POSTURE_IAM_ACTION[p.call] ?? p.call})`;
      case 'not-implemented':
        return p.code === 'NotImplemented' || p.http === 501
          ? `${p.call}: not implemented by this provider (${p.code}); verify in the provider console`
          : `${p.call}: rejected (${p.code}, HTTP ${p.http}): possibly not implemented by this provider; verify in the provider console`;
      default:
        return `${p.call}: ${p.code}: ${p.message}`;
    }
  };

  const pab = probes.publicAccessBlock;
  if (pab.ok) {
    const cfg = ((pab.value as { PublicAccessBlockConfiguration?: Record<string, unknown> } | undefined)?.PublicAccessBlockConfiguration ?? {});
    const off = PUBLIC_ACCESS_BLOCK_FLAGS.filter((flag) => cfg[flag] !== true);
    if (off.length === 0) {
      blocked = true;
      lines.push('GetPublicAccessBlock: public access blocked');
    } else {
      lines.push(`GetPublicAccessBlock: public access not fully blocked (${off.join(', ')} off)`);
    }
  } else if (pab.kind === 'absent') {
    lines.push('GetPublicAccessBlock: no public access block configured');
  } else {
    lines.push(unjudged(pab));
  }

  const policy = probes.policyStatus;
  let policyKnownNotPublic = false;
  if (policy.ok) {
    const reported = (policy.value as { PolicyStatus?: { IsPublic?: unknown } } | undefined)?.PolicyStatus?.IsPublic;
    if (reported === true) {
      isPublic = true;
      lines.push('GetBucketPolicyStatus: the bucket policy makes the bucket PUBLIC');
    } else if (reported === false) {
      policyKnownNotPublic = true;
      lines.push('GetBucketPolicyStatus: bucket policy is not public');
    } else {
      // A 200 with no boolean is a provider stub, not a verdict.
      lines.push('GetBucketPolicyStatus: policy status not reported by this provider; verify in the provider console');
    }
  } else if (policy.kind === 'absent') {
    policyKnownNotPublic = true;
    lines.push('GetBucketPolicyStatus: no bucket policy');
  } else {
    lines.push(unjudged(policy));
  }

  const enc = probes.encryption;
  if (enc.ok) {
    const rules = (enc.value as { ServerSideEncryptionConfiguration?: { Rules?: unknown } } | undefined)
      ?.ServerSideEncryptionConfiguration?.Rules;
    const algo = Array.isArray(rules)
      ? rules
          .map(
            (r) =>
              (r as { ApplyServerSideEncryptionByDefault?: { SSEAlgorithm?: unknown } } | undefined)
                ?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm,
          )
          .find((a) => typeof a === 'string' && a.length > 0)
      : undefined;
    if (algo) {
      encrypted = true;
      lines.push(`GetBucketEncryption: default encryption on (${algo})`);
    } else if (Array.isArray(rules) && rules.length > 0) {
      lines.push('GetBucketEncryption: rule present but no default algorithm; verify in the provider console');
    } else {
      lines.push('GetBucketEncryption: no default encryption rule');
    }
  } else if (enc.kind === 'absent') {
    lines.push('GetBucketEncryption: no default encryption configured');
  } else {
    lines.push(unjudged(enc));
  }

  if (isPublic) return { status: 'fail', summary: 'bucket is PUBLIC', lines };
  if (blocked && policyKnownNotPublic && encrypted) {
    return { status: 'pass', summary: 'public access blocked, default encryption on', lines };
  }
  return { status: 'warn', summary: 'not verified as private and encrypted (see detail)', lines };
}

@Injectable()
export class DiagnosticsService {
  private readonly logger = new Logger(DiagnosticsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly eventEmitter: EventEmitter2,
    @Inject(QueueService) private readonly aiQueue: QueueService,
    @Inject(BusinessEventQueueService) private readonly eventQueue: BusinessEventQueueService,
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
    const checkedAt = () => new Date().toISOString();
    const elapsed = () => Date.now() - start;

    const s3Bucket = process.env.S3_BUCKET?.trim();
    const s3Endpoint = process.env.S3_ENDPOINT?.trim();
    const s3Region = process.env.S3_REGION?.trim() || 'us-east-1';
    const s3AccessKey =
      process.env.S3_ACCESS_KEY_ID?.trim() ||
      process.env.AWS_ACCESS_KEY_ID?.trim();
    const s3SecretKey =
      process.env.S3_SECRET_ACCESS_KEY?.trim() ||
      process.env.AWS_SECRET_ACCESS_KEY?.trim();

    // Preferred path: generic S3-compatible storage (AWS, R2, MinIO,
    // Supabase Storage, Wasabi, etc.). Verifies real connectivity.
    if (s3Bucket) {
      try {
        const {
          S3Client,
          HeadBucketCommand,
          GetPublicAccessBlockCommand,
          GetBucketPolicyStatusCommand,
          GetBucketEncryptionCommand,
        } = await import('@aws-sdk/client-s3');
        const client = new S3Client({
          region: s3Region,
          endpoint: s3Endpoint,
          forcePathStyle:
            (process.env.S3_FORCE_PATH_STYLE || '').toLowerCase() === 'true' ||
            Boolean(s3Endpoint && !s3Endpoint.includes('amazonaws.com')),
          credentials:
            s3AccessKey && s3SecretKey
              ? { accessKeyId: s3AccessKey, secretAccessKey: s3SecretKey }
              : undefined,
        });
        await client.send(new HeadBucketCommand({ Bucket: s3Bucket }));

        // RR-OBJECT-STORAGE-POSTURE-CHECK: reachable is not the same as safe.
        // Three read-only bucket-level calls say whether the bucket is public
        // and whether default encryption is on; each is judged on its own, so
        // a provider that lacks one (R2, MinIO, Supabase Storage) gets a warn
        // naming it, never a false pass and never a false fail. No object is
        // written or read here; PutObject headers are a later slice.
        const probe = async (call: string, send: () => Promise<unknown>): Promise<PostureProbe> => {
          try {
            return { call, ok: true, value: await send() };
          } catch (err: unknown) {
            return { call, ok: false, ...classifyPostureError(err) };
          }
        };
        const posture = evaluateStoragePosture({
          publicAccessBlock: await probe('GetPublicAccessBlock', () =>
            client.send(new GetPublicAccessBlockCommand({ Bucket: s3Bucket })),
          ),
          policyStatus: await probe('GetBucketPolicyStatus', () =>
            client.send(new GetBucketPolicyStatusCommand({ Bucket: s3Bucket })),
          ),
          encryption: await probe('GetBucketEncryption', () =>
            client.send(new GetBucketEncryptionCommand({ Bucket: s3Bucket })),
          ),
        });
        return {
          name: 'Object Storage',
          status: posture.status,
          latencyMs: elapsed(),
          checkedAt: checkedAt(),
          message: `S3 bucket "${s3Bucket}" reachable; posture: ${posture.summary}`,
          detail: posture.lines.join('; '),
        };
      } catch (err: any) {
        return {
          name: 'Object Storage',
          status: 'fail',
          latencyMs: elapsed(),
          checkedAt: checkedAt(),
          message: `S3 bucket "${s3Bucket}" not reachable`,
          detail: err?.message ?? String(err),
        };
      }
    }

    // Nothing configured. Surface this as a warning so operators know
    // file uploads will fail until they wire up a backend.
    return {
      name: 'Object Storage',
      status: 'warn',
      latencyMs: elapsed(),
      checkedAt: checkedAt(),
      message: 'Object Storage not configured',
      detail:
        'Set S3_BUCKET (+ S3_ENDPOINT / S3_REGION / credentials) for any S3-compatible backend.',
    };
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

  async checkQueues(): Promise<CheckResult> {
    const start = Date.now();
    try {
      const [planCounts, cronCounts, eventCounts] = await Promise.all([
        this.aiQueue.planQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
        this.aiQueue.cronQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
        this.eventQueue.queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
      ]);
      const failed = (planCounts.failed ?? 0) + (cronCounts.failed ?? 0) + (eventCounts.failed ?? 0);
      const waiting = (planCounts.waiting ?? 0) + (cronCounts.waiting ?? 0) + (eventCounts.waiting ?? 0);
      const status: CheckStatus = failed > 10 ? 'fail' : failed > 0 ? 'warn' : 'pass';
      return {
        name: 'Background Job Queues',
        status,
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: `Plan: ${planCounts.waiting} waiting / ${planCounts.failed} failed | Cron: ${cronCounts.waiting} waiting / ${cronCounts.failed} failed | Events: ${eventCounts.waiting} waiting / ${eventCounts.failed} failed`,
        detail: `Total waiting: ${waiting}, total failed: ${failed}`,
      };
    } catch (err: any) {
      return {
        name: 'Background Job Queues',
        status: 'fail',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: 'Failed to query BullMQ queue counts',
        detail: err.message,
      };
    }
  }

  /**
   * Which key is packages/db token-encryption actually deriving from?
   *
   * It is the only enc:v1: implementation with no production guard: with none
   * of CONNECTOR_CREDENTIALS_KEY / CREDENTIALS_ENCRYPTION_KEY / JWT_SECRET
   * set, it silently scrypts a literal that lives in this repository. The
   * planned guard (a boot-time throw) is DELIBERATELY gated on this check
   * reporting 'pass' in production first — if any prod row was ever encrypted
   * under the fallback, landing the throw makes it undecryptable with no
   * error naming the cause. Evidence first, then the guard.
   */
  async checkTokenEncryptionKeySource(): Promise<CheckResult> {
    const start = Date.now();
    // Ask the encryption layer which key it actually derives from — never a
    // second copy of the precedence chain. A witness that could name a
    // different variable than getDerivedKey() consults would greenlight the
    // production guard on false evidence, the exact failure the sequencing
    // exists to avoid.
    const source = tokenEncryptionKeySource();
    const prod = process.env.NODE_ENV === 'production';
    return {
      name: 'Token Encryption Key Source',
      status: source ? 'pass' : prod ? 'fail' : 'warn',
      latencyMs: Date.now() - start,
      checkedAt: new Date().toISOString(),
      message: source
        ? `packages/db token-encryption derives from ${source}`
        : 'packages/db token-encryption is running on the IN-REPO DEV FALLBACK key',
      detail: source
        ? 'This pass confirms the active key-source half only; also run apps/server/scripts/token-encryption-key-census.ts (the stored-row half) and confirm zero fallback or core-chain rows before landing the production key guard.'
        : 'Do NOT land the boot-time production key guard while this is the state: rows encrypted under the fallback become undecryptable. Run apps/server/scripts/token-encryption-key-census.ts to audit stored rows before landing the guard.',
    };
  }

  async checkInfrastructure(): Promise<CategoryResult> {
    const [db, supabase, storage, uptime, queues, keySource] = await Promise.all([
      this.checkDatabase(),
      this.checkSupabase(),
      this.checkObjectStorage(),
      this.checkServerUptime(),
      this.checkQueues(),
      this.checkTokenEncryptionKeySource(),
    ]);
    const checks = [db, supabase, storage, uptime, queues, keySource];
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
    // V1-24b (SEC-V124-1): with KEY switched off the check sends nothing to OpenAI.
    if (keyDisabled()) {
      return {
        name: 'OpenAI API',
        status: 'warn',
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
        message: 'KEY is switched off on this server (KEY_DISABLED): OpenAI not checked',
      };
    }
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
      // Every business, deliberately: this is a PLATFORM health check, and a
      // count scoped to one tenant would answer a different question while
      // looking like the same one. SocialConnection became tenant-scoped on
      // 2026-08-30; `api/diagnostics` carries no :businessId today so nothing
      // would be injected, but saying so beats depending on that.
      const connectedCount = await this.prisma.client.socialConnection.count(
        skipTenantIsolation({ where: { platform: platformKey, status: 'CONNECTED' } }),
      );
      const expiredCount = await this.prisma.client.socialConnection.count(
        skipTenantIsolation({ where: { platform: platformKey, status: 'EXPIRED' } }),
      );
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
      'Token Encryption Key Source': () => this.checkTokenEncryptionKeySource(),
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
