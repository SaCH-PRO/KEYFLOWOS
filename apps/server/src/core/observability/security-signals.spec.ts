import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BadRequestException, ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  SecuritySignals,
  securitySignals,
  MAX_LABELS_PER_SIGNAL,
  OVERFLOW_LABEL,
  MAX_HOURLY_BUCKETS,
  type SecuritySignalType,
} from './security-signals';
import { BusinessGuard } from '../auth/business.guard';
import { ModuleScopeGuard } from '../auth/module-scope.guard';
import { BusinessMemberGuard } from '../auth/business-member.guard';
import { AuthMiddleware } from '../auth/auth.middleware';
import { WebhooksController } from '../../modules/webhooks/webhooks.controller';
import { PaymentsService } from '../../modules/payments/payments.service';
import { FormWebhookController } from '../connectors/form-webhook.controller';
import { InboundCommunicationsController } from '../../modules/communications/inbound-communications.controller';
import { DiagnosticsController } from '../../modules/diagnostics/diagnostics.controller';

function makeHttpContext(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
    getHandler: () => function handler() {},
  } as unknown as ExecutionContext;
}

function collectObjectKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectObjectKeys(item, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.push(k);
      collectObjectKeys(v, out);
    }
  }
  return out;
}

describe('SecuritySignals counter invariants (P158 / RR-SECURITY-SIGNAL-COUNTERS)', () => {
  let counter: SecuritySignals;

  beforeEach(() => {
    counter = new SecuritySignals();
  });

  it('starts empty with zero counts, empty byLabel maps, empty hourly buckets, and an ISO startedAt', () => {
    const snap = counter.snapshot();
    expect(snap.counts).toEqual({
      bearer_verification_failed: 0,
      cross_business_refusal: 0,
      webhook_signature_failed: 0,
      authority_shadow_mismatch: 0,
    });
    expect(snap.byLabel).toEqual({
      bearer_verification_failed: {},
      cross_business_refusal: {},
      webhook_signature_failed: {},
      authority_shadow_mismatch: {},
    });
    expect(snap.hourly).toEqual([]);
    expect(Number.isNaN(Date.parse(snap.startedAt))).toBe(false);
  });

  it('holds the fixed key cap under 10,000 distinct labels while keeping exact totals and rolling overflow into __other__', () => {
    for (let i = 0; i < 10_000; i++) {
      counter.record('webhook_signature_failed', `provider_${i}`);
    }

    const snap = counter.snapshot();
    const labelMap = snap.byLabel.webhook_signature_failed;
    const keys = Object.keys(labelMap);

    expect(keys.length).toBeLessThanOrEqual(MAX_LABELS_PER_SIGNAL);
    expect(labelMap[OVERFLOW_LABEL]).toBeGreaterThan(0);
    expect(snap.counts.webhook_signature_failed).toBe(10_000);

    const sumOfLabels = Object.values(labelMap).reduce((acc, n) => acc + n, 0);
    expect(sumOfLabels).toBe(10_000);
  });

  it('holds no user id, business id, IP, email, or token fields anywhere in the snapshot shape', () => {
    counter.record('bearer_verification_failed', 'auth_middleware');
    counter.record('cross_business_refusal', 'business_guard');
    counter.record('webhook_signature_failed', 'stripe');

    const snap = counter.snapshot();
    expect(Object.keys(snap).sort()).toEqual(['byLabel', 'counts', 'hourly', 'startedAt']);

    const forbiddenKeys = new Set([
      'userId',
      'user_id',
      'businessId',
      'business_id',
      'ip',
      'ipAddress',
      'ip_address',
      'token',
      'email',
      'authorization',
      'headers',
      'payload',
    ]);
    const allKeys = collectObjectKeys(snap);
    for (const key of allKeys) {
      expect(forbiddenKeys.has(key), `unexpected PII/ID key "${key}" in SecuritySignals snapshot`).toBe(false);
    }
  });

  it('maintains a rolling 24-hour window in hourly buckets and drops buckets older than 24h while keeping totals since boot', () => {
    const HOUR_MS = 3_600_000;
    const baseMs = Date.UTC(2026, 10, 27, 0, 0, 0);

    for (let h = 0; h < 30; h++) {
      counter.record('cross_business_refusal', 'business_guard', baseMs + h * HOUR_MS + 15_000);
    }

    const atHour29 = counter.snapshot(baseMs + 29 * HOUR_MS + 30_000);
    expect(atHour29.counts.cross_business_refusal).toBe(30);
    expect(atHour29.hourly).toHaveLength(MAX_HOURLY_BUCKETS);
    expect(atHour29.hourly[0].hour).toBe(new Date(baseMs + 6 * HOUR_MS).toISOString());
    expect(atHour29.hourly[MAX_HOURLY_BUCKETS - 1].hour).toBe(new Date(baseMs + 29 * HOUR_MS).toISOString());
    for (const bucket of atHour29.hourly) {
      expect(bucket.counts.cross_business_refusal).toBe(1);
    }

    // After 25+ quiet hours, the rolling hourly window is empty while counts since boot remain intact.
    const later = counter.snapshot(baseMs + 60 * HOUR_MS);
    expect(later.hourly).toEqual([]);
    expect(later.counts.cross_business_refusal).toBe(30);
  });

  it('never throws on malformed or adversarial inputs', () => {
    const throwingLabel = new Proxy(
      {},
      {
        get() {
          throw new Error('boom');
        },
      },
    );
    expect(() =>
      counter.record('bearer_verification_failed', null as unknown as string),
    ).not.toThrow();
    expect(() =>
      counter.record('bearer_verification_failed', undefined as unknown as string),
    ).not.toThrow();
    expect(() =>
      counter.record('bearer_verification_failed', throwingLabel as unknown as string),
    ).not.toThrow();
    expect(() =>
      counter.record('not_a_real_signal' as unknown as SecuritySignalType, 'x'),
    ).not.toThrow();
    expect(() =>
      counter.record('cross_business_refusal', 'business_guard', Number.NaN),
    ).not.toThrow();
  });

  it('clears counts, labels, and hourly buckets on reset()', () => {
    counter.record('bearer_verification_failed', 'auth_middleware');
    counter.record('cross_business_refusal', 'business_guard');
    counter.record('webhook_signature_failed', 'stripe');
    counter.record('authority_shadow_mismatch', 'operations:explicit_deny');

    counter.reset();
    const snap = counter.snapshot();
    expect(snap.counts).toEqual({
      bearer_verification_failed: 0,
      cross_business_refusal: 0,
      webhook_signature_failed: 0,
      authority_shadow_mismatch: 0,
    });
    expect(snap.byLabel).toEqual({
      bearer_verification_failed: {},
      cross_business_refusal: {},
      webhook_signature_failed: {},
      authority_shadow_mismatch: {},
    });
    expect(snap.hourly).toEqual([]);
  });

  it('exposes a process-wide singleton', () => {
    expect(securitySignals).toBeInstanceOf(SecuritySignals);
  });
});

describe('SecuritySignals instrumentation sites (outcome unchanged)', () => {
  const prevStripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const prevInboundWebhookSecret = process.env.INBOUND_WEBHOOK_SECRET;

  beforeEach(() => {
    securitySignals.reset();
  });

  afterEach(() => {
    if (prevStripeWebhookSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = prevStripeWebhookSecret;

    if (prevInboundWebhookSecret === undefined) delete process.env.INBOUND_WEBHOOK_SECRET;
    else process.env.INBOUND_WEBHOOK_SECRET = prevInboundWebhookSecret;
  });

  it('BusinessGuard increments cross_business_refusal with label business_guard and preserves 403 body', async () => {
    const prisma = {
      client: {
        business: { findFirst: vi.fn().mockResolvedValue(null) },
      },
    };
    const guard = new BusinessGuard(prisma as never);
    const ctx = makeHttpContext({
      user: { id: 'user-outsider-1', role: 'USER' },
      params: { businessId: 'biz-victim-99' },
    });

    let caught: unknown;
    try {
      await guard.canActivate(ctx);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ForbiddenException);
    const ex = caught as ForbiddenException;
    expect(ex.getStatus()).toBe(403);
    expect(ex.getResponse()).toEqual({
      message: 'No access to this business',
      error: 'Forbidden',
      statusCode: 403,
    });

    const snap = securitySignals.snapshot();
    expect(snap.counts.cross_business_refusal).toBe(1);
    expect(snap.byLabel.cross_business_refusal).toEqual({ business_guard: 1 });
    const serialized = JSON.stringify(snap);
    expect(serialized).not.toContain('user-outsider-1');
    expect(serialized).not.toContain('biz-victim-99');
  });

  it('ModuleScopeGuard increments cross_business_refusal with label module_scope_guard and preserves 403 body', async () => {
    const prisma = {
      client: {
        membership: { findUnique: vi.fn().mockResolvedValue(null) },
      },
    };
    const reflector = {
      get: vi.fn().mockReturnValue({ module: 'revenue', minLevel: 'read' }),
    };
    const guard = new ModuleScopeGuard(prisma as never, reflector as never);
    const ctx = makeHttpContext({
      user: { id: 'user-outsider-2', role: 'USER' },
      params: { businessId: 'biz-victim-99' },
    });

    let caught: unknown;
    try {
      await guard.canActivate(ctx);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ForbiddenException);
    const ex = caught as ForbiddenException;
    expect(ex.getStatus()).toBe(403);
    expect(ex.getResponse()).toEqual({
      message: 'Not a member of this business',
      error: 'Forbidden',
      statusCode: 403,
    });

    const snap = securitySignals.snapshot();
    expect(snap.counts.cross_business_refusal).toBe(1);
    expect(snap.byLabel.cross_business_refusal).toEqual({ module_scope_guard: 1 });
  });

  it('BusinessMemberGuard increments cross_business_refusal with label business_member_guard and preserves 403 body', async () => {
    const prisma = {
      client: {
        membership: { findUnique: vi.fn().mockResolvedValue(null) },
      },
    };
    const guard = new BusinessMemberGuard(prisma as never);
    const ctx = makeHttpContext({
      user: { id: 'super-non-member', role: 'SUPER_ADMIN' },
      params: { businessId: 'biz-victim-99' },
    });

    let caught: unknown;
    try {
      await guard.canActivate(ctx);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ForbiddenException);
    const ex = caught as ForbiddenException;
    expect(ex.getStatus()).toBe(403);
    expect(ex.getResponse()).toEqual({
      message: 'No access to this business',
      error: 'Forbidden',
      statusCode: 403,
    });

    const snap = securitySignals.snapshot();
    expect(snap.counts.cross_business_refusal).toBe(1);
    expect(snap.byLabel.cross_business_refusal).toEqual({ business_member_guard: 1 });
  });

  it('AuthMiddleware increments bearer_verification_failed and leaves req.user unset on bad bearer token', async () => {
    const supabaseAuth = { getUserFromToken: vi.fn().mockResolvedValue(null) };
    const prisma = { client: {} };
    const redis = { get: vi.fn().mockResolvedValue(null) };
    const mw = new AuthMiddleware(supabaseAuth as never, prisma as never, redis as never);

    const req = {
      headers: { authorization: 'Bearer forged.jwt.secret-token-p158' },
    } as unknown as Request;
    const res = {} as Response;
    const next = vi.fn();

    await mw.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((req as unknown as { user?: unknown }).user).toBeUndefined();
    expect((req as unknown as { authKind?: unknown }).authKind).toBeUndefined();

    const snap = securitySignals.snapshot();
    expect(snap.counts.bearer_verification_failed).toBe(1);
    expect(snap.byLabel.bearer_verification_failed).toEqual({ auth_middleware: 1 });
    expect(JSON.stringify(snap)).not.toContain('secret-token-p158');
  });

  it('WebhooksController increments webhook_signature_failed with label stripe on bad signature (stubbed verifier, no network)', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_p158';
    const ctrl = new WebhooksController({ client: {} } as never, {} as never, {} as never);
    (ctrl as unknown as { stripe: { webhooks: { constructEvent: ReturnType<typeof vi.fn> } } }).stripe = {
      webhooks: {
        constructEvent: vi.fn(() => {
          throw new Error('No signatures found matching the expected signature for payload');
        }),
      },
    };

    const req = {
      rawBody: Buffer.from(JSON.stringify({ id: 'evt_bad_sig', type: 'payment_intent.succeeded' })),
    } as unknown as Request;

    let caught: unknown;
    try {
      await ctrl.handleStripeWebhook(req, 't=1700000000,v1=deadbeef');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    const ex = caught as BadRequestException;
    expect(ex.getStatus()).toBe(400);
    expect(ex.message).toContain('Webhook signature verification failed');

    const snap = securitySignals.snapshot();
    expect(snap.counts.webhook_signature_failed).toBe(1);
    expect(snap.byLabel.webhook_signature_failed).toEqual({ stripe: 1 });
  });

  it('PaymentsService increments webhook_signature_failed for Stripe, PayPal, and WiPay bad signatures (no network)', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_p158';
    const prisma = {
      client: {
        invoice: { findUnique: vi.fn().mockResolvedValue(null) },
        marketplaceOrder: { findUnique: vi.fn().mockResolvedValue(null) },
        webhookEvent: { findMany: vi.fn().mockResolvedValue([]) },
      },
    };
    const svc = new PaymentsService(prisma as never, {} as never, {} as never, {} as never);

    // 1. Stripe
    let stripeErr: unknown;
    try {
      await svc.handleStripeWebhook(
        JSON.stringify({ id: 'evt_pay_1', type: 'payment_intent.succeeded', data: { object: {} } }),
        't=1700000000,v1=0000000000000000000000000000000000000000000000000000000000000000',
      );
    } catch (err) {
      stripeErr = err;
    }
    expect(stripeErr).toBeInstanceOf(BadRequestException);
    expect((stripeErr as BadRequestException).getStatus()).toBe(400);
    expect((stripeErr as BadRequestException).message).toBe('Invalid Stripe webhook signature');

    // 2. PayPal (missing signature headers -> local refusal, zero network)
    let paypalErr: unknown;
    try {
      await svc.handlePaypalWebhook(
        JSON.stringify({ id: 'WH-BAD-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: {} }),
        {},
      );
    } catch (err) {
      paypalErr = err;
    }
    expect(paypalErr).toBeInstanceOf(BadRequestException);
    expect((paypalErr as BadRequestException).getStatus()).toBe(400);
    expect((paypalErr as BadRequestException).message).toBe('Invalid PayPal webhook signature');

    // 3. WiPay (bad keyed hash -> local refusal, zero network)
    prisma.client.invoice.findUnique.mockResolvedValueOnce({
      id: 'inv-wipay-1',
      businessId: 'biz-wipay-1',
      currency: 'TTD',
      total: 100,
      business: { metaData: { wipayApiKey: 'real_business_wipay_key_987654' } },
    });
    let wipayErr: unknown;
    try {
      await svc.handleWipayCallback({
        order_id: 'inv-wipay-1',
        status: 'success',
        transaction_id: 'tx-wipay-1',
        hash: 'forged_md5_hash',
      });
    } catch (err) {
      wipayErr = err;
    }
    expect(wipayErr).toBeInstanceOf(BadRequestException);
    expect((wipayErr as BadRequestException).getStatus()).toBe(400);
    expect((wipayErr as BadRequestException).message).toBe('Invalid WiPay callback signature');

    const snap = securitySignals.snapshot();
    expect(snap.counts.webhook_signature_failed).toBe(3);
    expect(snap.byLabel.webhook_signature_failed).toEqual({
      stripe: 1,
      paypal: 1,
      wipay: 1,
    });
  });

  it('FormWebhookController increments webhook_signature_failed with connector type label and preserves 403 body', async () => {
    const registry = { get: vi.fn().mockReturnValue({}) };
    const credentials = { getCredentials: vi.fn().mockResolvedValue({ webhookSecret: 'expected-form-secret' }) };
    const webhookLogger = { log: vi.fn().mockResolvedValue(undefined) };
    const ctrl = new FormWebhookController(registry as never, credentials as never, webhookLogger as never);

    let caught: unknown;
    try {
      await ctrl.ingest('biz-form-1', 'typeform', 'wrong-signature', { formId: 'f1' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ForbiddenException);
    const ex = caught as ForbiddenException;
    expect(ex.getStatus()).toBe(403);
    expect(ex.getResponse()).toEqual({
      message: 'Invalid webhook signature',
      error: 'Forbidden',
      statusCode: 403,
    });

    const snap = securitySignals.snapshot();
    expect(snap.counts.webhook_signature_failed).toBe(1);
    expect(snap.byLabel.webhook_signature_failed).toEqual({ typeform: 1 });
  });

  it('InboundCommunicationsController increments webhook_signature_failed with label inbound_communications and preserves 403 body', async () => {
    process.env.INBOUND_WEBHOOK_SECRET = 'inbound-test-secret-p158';
    const inbound = { receiveEmail: vi.fn(), receiveSms: vi.fn() };
    const ctrl = new InboundCommunicationsController(inbound as never);

    const req = {
      headers: { 'x-keyflow-signature': `sha256=${'00'.repeat(32)}` },
      rawBody: Buffer.from(JSON.stringify({ from: 'sender@example.com' })),
    } as unknown as Request;

    let caught: unknown;
    try {
      await ctrl.email(req, { from: 'sender@example.com' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ForbiddenException);
    const ex = caught as ForbiddenException;
    expect(ex.getStatus()).toBe(403);
    expect(ex.getResponse()).toEqual({
      message: 'Invalid webhook signature',
      error: 'Forbidden',
      statusCode: 403,
    });

    const snap = securitySignals.snapshot();
    expect(snap.counts.webhook_signature_failed).toBe(1);
    expect(snap.byLabel.webhook_signature_failed).toEqual({ inbound_communications: 1 });
  });
});

describe('DiagnosticsController.getSecuritySignals (super-admin gated)', () => {
  beforeEach(() => {
    securitySignals.reset();
  });

  it('refuses non-super-admin, unauthenticated, and Supabase-signed SUPER_ADMIN with 403, and returns snapshot to admin-signed SUPER_ADMIN', () => {
    const ctrl = new DiagnosticsController({} as never);
    securitySignals.record('cross_business_refusal', 'business_guard');

    const regularUserReq = {
      authKind: 'supabase',
      user: { id: 'u-member', role: 'USER', authKind: 'supabase' },
    } as unknown as Request;

    const unauthReq = {} as unknown as Request;

    const supabaseSuperReq = {
      authKind: 'supabase',
      user: { id: 'u-super', role: 'SUPER_ADMIN', authKind: 'supabase' },
    } as unknown as Request;

    const adminSuperReq = {
      authKind: 'admin',
      user: { id: 'u-admin', role: 'SUPER_ADMIN', authKind: 'admin' },
    } as unknown as Request;

    for (const denied of [regularUserReq, unauthReq, supabaseSuperReq]) {
      let caught: unknown;
      try {
        ctrl.getSecuritySignals(denied);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ForbiddenException);
      expect((caught as ForbiddenException).getStatus()).toBe(403);
    }

    const snap = ctrl.getSecuritySignals(adminSuperReq);
    expect(snap.counts.cross_business_refusal).toBe(1);
    expect(snap.byLabel.cross_business_refusal).toEqual({ business_guard: 1 });
  });
});
