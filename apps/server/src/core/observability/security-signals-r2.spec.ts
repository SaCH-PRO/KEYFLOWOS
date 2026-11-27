/**
 * RR-SECURITY-SIGNAL-COUNTERS (P158) R2 hardening specs:
 *   - Missing/malformed webhook signature headers in InboundCommunicationsController and WebhooksController
 *     increment webhook_signature_failed without altering HTTP status or message.
 *   - Prototype-pollution labels (__proto__, constructor, prototype) map safely to OVERFLOW_LABEL.
 *   - Out-of-range finite timestamps (e.g. 1e20) never throw in record/snapshot/constructor/reset.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { SecuritySignals, securitySignals, OVERFLOW_LABEL } from './security-signals';
import { WebhooksController } from '../../modules/webhooks/webhooks.controller';
import { InboundCommunicationsController } from '../../modules/communications/inbound-communications.controller';

describe('P158 R2 hardening: missing/malformed webhook signatures & edge inputs', () => {
  const prevStripeSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const prevInboundSecret = process.env.INBOUND_WEBHOOK_SECRET;

  beforeEach(() => {
    securitySignals.reset();
  });

  afterEach(() => {
    if (prevStripeSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = prevStripeSecret;

    if (prevInboundSecret === undefined) delete process.env.INBOUND_WEBHOOK_SECRET;
    else process.env.INBOUND_WEBHOOK_SECRET = prevInboundSecret;
  });

  it('WebhooksController counts missing stripe-signature header under webhook_signature_failed (stripe) and preserves 400', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_p158_r2';
    const ctrl = new WebhooksController({ client: {} } as never, {} as never, {} as never);
    (ctrl as unknown as { stripe: Record<string, unknown> }).stripe = {};

    const req = { rawBody: Buffer.from('{}') } as unknown as Request;
    let caught: unknown;
    try {
      await ctrl.handleStripeWebhook(req, '');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as BadRequestException).message).toBe('Missing stripe-signature header');
    const snap = securitySignals.snapshot();
    expect(snap.counts.webhook_signature_failed).toBe(1);
    expect(snap.byLabel.webhook_signature_failed).toEqual({ stripe: 1 });
  });

  it('InboundCommunicationsController counts missing or unprefixed x-keyflow-signature header and preserves 403', async () => {
    process.env.INBOUND_WEBHOOK_SECRET = 'inbound-test-secret-p158-r2';
    const ctrl = new InboundCommunicationsController({ receiveEmail: async () => ({}), receiveSms: async () => ({}) } as never);

    for (const headers of [{}, { 'x-keyflow-signature': 'bogus-without-prefix' }]) {
      const req = { headers, rawBody: Buffer.from('{}') } as unknown as Request;
      let caught: unknown;
      try {
        await ctrl.email(req, {});
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ForbiddenException);
      expect((caught as ForbiddenException).message).toBe('Missing webhook signature');
    }

    const snap = securitySignals.snapshot();
    expect(snap.counts.webhook_signature_failed).toBe(2);
    expect(snap.byLabel.webhook_signature_failed).toEqual({ inbound_communications: 2 });
  });

  it('maps prototype-pollution labels to __other__ and handles out-of-range finite timestamps without throwing', () => {
    const counter = new SecuritySignals(1e20);
    counter.record('webhook_signature_failed', '__proto__', 1e20);
    counter.record('webhook_signature_failed', 'constructor', -1e20);
    counter.record('webhook_signature_failed', 'prototype');

    const snap = counter.snapshot(1e20);
    expect(snap.counts.webhook_signature_failed).toBe(3);
    expect(snap.byLabel.webhook_signature_failed).toEqual({ [OVERFLOW_LABEL]: 3 });
    expect(Object.keys(snap.byLabel.webhook_signature_failed)).toEqual([OVERFLOW_LABEL]);
    expect(() => counter.reset(1e20)).not.toThrow();
  });
});
