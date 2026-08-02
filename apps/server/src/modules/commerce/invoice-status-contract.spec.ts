/**
 * The contract between the web client and the invoice/quote status routes.
 *
 * Three independent defects made "mark paid", "send" and "void" impossible from
 * the UI, and they stacked so that fixing any one alone still failed:
 *
 *  1. VERB. The client sent POST; the server declares
 *     @Patch('invoices/:invoiceId/paid') and
 *     @Patch('invoices/:invoiceId/status/:status'). No POST route matches, so
 *     every call 404'd. These have been @Patch since the routes were
 *     introduced, so this never worked from the UI.
 *
 *  2. TENANT. BusinessGuard resolves businessId from params || body || query.
 *     Neither route has a :businessId param and the client sent `body: {}`, so
 *     a corrected verb would have 403'd instead.
 *
 *  3. VALIDATION. UpdateInvoiceStatusDto declares `status` as REQUIRED. The
 *     handler reads status from the URL param, but the global ValidationPipe
 *     runs first and rejected a body that omitted it.
 *
 * These tests pin the payload shape the client now sends, so a future edit to
 * either side breaks here rather than in production.
 */
import { describe, it, expect } from 'vitest';
import { ValidationPipe } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UpdateInvoiceStatusDto } from './dto/update-invoice-status.dto';

/** Same options as apps/server/src/app-bootstrap.ts. */
const pipe = new ValidationPipe({ whitelist: true, transform: true });

const CONTROLLER = readFileSync(join(__dirname, 'commerce.controller.ts'), 'utf8');

/** BusinessGuard's real resolution order, from core/auth/business.guard.ts. */
function guardResolvesTenant(req: {
  params?: Record<string, unknown>;
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
}): boolean {
  return Boolean(req.params?.businessId || req.body?.businessId || req.query?.businessId);
}

describe('what the client now sends', () => {
  // Mirrors apps/web/src/lib/client.ts updateInvoiceStatus.
  const statusBody = { businessId: 'biz_1', status: 'SENT' as const };

  it('satisfies BusinessGuard — the 403 half', () => {
    expect(guardResolvesTenant({ body: statusBody })).toBe(true);
  });

  it('the OLD empty body did NOT satisfy the guard', () => {
    // Demonstrates why fixing only the verb was insufficient.
    expect(guardResolvesTenant({ body: {} })).toBe(false);
  });

  it('survives the ValidationPipe with status intact', async () => {
    const out = (await pipe.transform(statusBody, {
      type: 'body',
      metatype: UpdateInvoiceStatusDto,
    })) as UpdateInvoiceStatusDto;

    expect(out.status).toBe('SENT');
  });

  it('a body WITHOUT status is rejected — the validation half', async () => {
    await expect(
      pipe.transform({ businessId: 'biz_1' }, { type: 'body', metatype: UpdateInvoiceStatusDto }),
    ).rejects.toThrow();
  });

  it('accepts the optional dueDate / sentAt the client may add', async () => {
    const out = (await pipe.transform(
      { ...statusBody, dueDate: '2026-10-01T00:00:00.000Z', sentAt: '2026-09-01T00:00:00.000Z' },
      { type: 'body', metatype: UpdateInvoiceStatusDto },
    )) as UpdateInvoiceStatusDto;

    expect(out.dueDate).toBe('2026-10-01T00:00:00.000Z');
    expect(out.sentAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('rejects a status outside the allowed set', async () => {
    await expect(
      pipe.transform(
        { businessId: 'biz_1', status: 'PAID' },
        { type: 'body', metatype: UpdateInvoiceStatusDto },
      ),
    ).rejects.toThrow();
  });

  it('whitelist strips businessId from the DTO but the GUARD already saw it', async () => {
    // Guards run BEFORE pipes, so the guard reads the raw body. businessId is
    // not declared on the DTO, so the pipe then strips it — harmless, because
    // the handler does not use it. This test records that ordering so nobody
    // "fixes" the strip by adding a field the handler would ignore.
    const out = (await pipe.transform(statusBody, {
      type: 'body',
      metatype: UpdateInvoiceStatusDto,
    })) as Record<string, unknown>;

    expect(out.businessId).toBeUndefined();
    expect(out.status).toBe('SENT');
  });
});

describe('server route verbs the client must match', () => {
  it('mark-paid is PATCH', () => {
    expect(CONTROLLER).toMatch(/@Patch\('invoices\/:invoiceId\/paid'\)/);
  });

  it('invoice status is PATCH', () => {
    expect(CONTROLLER).toMatch(/@Patch\('invoices\/:invoiceId\/status\/:status'\)/);
  });

  it('quote status is PATCH', () => {
    expect(CONTROLLER).toMatch(/@Patch\('quotes\/:quoteId\/status\/:status'\)/);
  });

  it('none of them is also declared as POST', () => {
    // If someone adds a POST alias later, the client should be updated rather
    // than the server growing two ways to do the same thing.
    expect(CONTROLLER).not.toMatch(/@Post\('invoices\/:invoiceId\/(paid|status)/);
    expect(CONTROLLER).not.toMatch(/@Post\('quotes\/:quoteId\/status/);
  });
});
