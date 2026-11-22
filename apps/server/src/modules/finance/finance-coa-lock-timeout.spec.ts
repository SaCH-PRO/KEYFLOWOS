/**
 * V1-63 SWP-COA-UNIQUE-CODE, acceptance-review closure (correctness MINOR-1): the account-code transaction
 * states its own wait and run limits, in line with the repo's other lock-holding transactions, and a writer
 * that cannot get the lock or a connection in time (Prisma P2028: the transaction could not start, or expired
 * while it waited) is answered 503 with a generic message, not a 500, and writes no account.
 *
 * Unit level on purpose: forcing a real P2028 means holding the lock past the timeout, which is slow and
 * timing-sensitive; the real-DB behaviour of the lock itself is pinned in
 * test/coa-unique-code.integration.test.ts (CUC-07, 07b, 07c).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, HttpException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FinanceCoaService } from './finance-coa.service';

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`Transaction API error (${code})`, {
    code,
    clientVersion: 'test',
  });
}

const BIZ = 'biz-lock-timeout';
const ACCOUNT = { id: 'acct-1', businessId: BIZ, code: '7100', isActive: true, isSystem: false };

function harness(transactionImpl: (fn: unknown, opts: unknown) => Promise<unknown>) {
  const create = vi.fn();
  const update = vi.fn();
  const $transaction = vi.fn(transactionImpl);
  const client = {
    chartOfAccount: {
      create,
      update,
      findFirst: vi.fn(async () => ACCOUNT),
    },
    $transaction,
  };
  const seeder = { ensureDefaults: vi.fn(async () => undefined) };
  const service = new FinanceCoaService({ client } as never, seeder as never);
  return { service, create, update, $transaction };
}

async function statusOf(p: Promise<unknown>): Promise<{ err: unknown; status: number | null }> {
  try {
    await p;
    return { err: null, status: null };
  } catch (err) {
    return { err, status: err instanceof HttpException ? err.getStatus() : null };
  }
}

describe('V1-63 the account-code transaction: explicit limits, and a lock or pool timeout is 503 (review MINOR-1)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('CUL-01: the transaction states READ COMMITTED, maxWait 5 s and timeout 10 s', async () => {
    const h = harness(async () => ({ id: 'new' }));
    await h.service.create(BIZ, { name: 'Ads', type: 'EXPENSE', code: '6105' });
    await h.service.update(BIZ, ACCOUNT.id, { code: '6106' });
    expect(h.$transaction).toHaveBeenCalledTimes(2);
    for (const call of h.$transaction.mock.calls) {
      expect(call[1]).toEqual({ isolationLevel: 'ReadCommitted', maxWait: 5_000, timeout: 10_000 });
    }
  });

  it('CUL-02: a create with a code that meets P2028 answers 503 with a generic message and writes no account', async () => {
    const h = harness(async () => { throw prismaError('P2028'); });
    const { err, status } = await statusOf(h.service.create(BIZ, { name: 'Ads', type: 'EXPENSE', code: '6105' }));
    expect(status).toBe(503);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    const body = JSON.stringify((err as HttpException).getResponse());
    expect(body).not.toMatch(/6105|Ads|acct-1/);
    expect(h.create).not.toHaveBeenCalled();
  });

  it('CUL-03: a code change or a return from the archive that meets P2028 answers 503 and writes nothing', async () => {
    const h = harness(async () => { throw prismaError('P2028'); });
    const a = await statusOf(h.service.update(BIZ, ACCOUNT.id, { code: '6106' }));
    const b = await statusOf(h.service.update(BIZ, ACCOUNT.id, { isActive: true }));
    expect([a.status, b.status]).toEqual([503, 503]);
    expect(h.update).not.toHaveBeenCalled();
  });

  it('CUL-04 control: a 409 from the check and any other Prisma error pass through unchanged', async () => {
    const conflict = new ConflictException({ code: 'COA_CODE_TAKEN', message: 'taken' });
    const p2002 = prismaError('P2002');
    const h1 = harness(async () => { throw conflict; });
    expect((await statusOf(h1.service.create(BIZ, { name: 'Ads', type: 'EXPENSE', code: '6105' }))).err).toBe(conflict);
    const h2 = harness(async () => { throw p2002; });
    expect((await statusOf(h2.service.update(BIZ, ACCOUNT.id, { code: '6106' }))).err).toBe(p2002);
  });
});
