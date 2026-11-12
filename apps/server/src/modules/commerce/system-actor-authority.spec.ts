/**
 * KEY had a made-up identity card.
 *
 * It passed the string `'key_ai'` as an actor id at 25 call sites, and no
 * `User` or `Membership` with that id is created anywhere in this codebase.
 * `markInvoicePaid` looks the actor up in `Membership` and throws
 * "Not authorized to update this invoice" when it finds nothing — so
 * `commerce_mark_invoice_paid` failed on 100% of calls from the day it shipped,
 * while the suite stayed green because nothing exercised it end to end.
 *
 * The dangerous fix is the obvious one. Simply skipping the membership check
 * for KEY would have turned a tool that always failed into a cross-tenant
 * write: markInvoicePaid takes an invoiceId and NO businessId, looks it up by
 * primary key, and derives the tenant from the row it found. On that path the
 * membership lookup was the only thing standing between a caller and any
 * invoice in any business.
 *
 * So the contract is: a system actor's authority is the tenant scope its caller
 * established, which means the scope must actually be supplied and enforced.
 * KEY is recognised ONLY where businessId is present and checked. Recognition
 * without proof is refused — and that refusal is the assertion worth having.
 */
import { describe, it, expect, vi } from 'vitest';
import { CommerceService } from './commerce.service';
import { KEY_SYSTEM_ACTOR_ID, isSystemActor } from '../../core/auth/system-actor';

const MINE = 'biz_mine';
const THEIRS = 'biz_theirs';

function makeService(invoiceBusinessId = MINE) {
  const transition = vi.fn(async () => ({
    id: 'inv_1',
    businessId: invoiceBusinessId,
    contactId: null,
    status: 'PAID',
  }));
  // R0-PL-04 (G2): mark-paid records the remaining balance through
  // recordPayment (payment row, posting and PAID in one transaction) instead
  // of transition + a synthetic payment row. recordPayment is the write here;
  // its own behaviour is proven against the real database elsewhere
  // (test/payments-mark-paid.integration.test.ts).
  // R0-PL-04 review (ST-PL04-1 / CR-PL04-2): mark-paid answers only for an
  // invoice that is PAID after the write, so the stand-in write settles it.
  let status = 'SENT';
  const recordPayment = vi.fn(async () => {
    status = 'PAID';
    return {};
  });

  const service = Object.assign(Object.create(CommerceService.prototype), {
    prisma: {
      client: {
        invoice: {
          findUnique: vi.fn(async () => ({
            businessId: invoiceBusinessId,
            status,
            total: 100,
            currency: 'TTD',
          })),
        },
        // Nobody is a member of anything here — which is exactly the state KEY
        // is always in.
        membership: { findFirst: vi.fn(async () => null) },
        payment: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []), create: vi.fn(async () => ({})) },
      },
    },
    invoiceWorkflow: { transition },
    recordPayment,
    crm: { logContactEvent: vi.fn(async () => undefined) },
    events: { emit: vi.fn() },
    logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });

  return { service, transition, recordPayment };
}

describe('the identity is explicit rather than invented', () => {
  it('recognises KEY, and only KEY', () => {
    expect(isSystemActor(KEY_SYSTEM_ACTOR_ID)).toBe(true);
    expect(isSystemActor('user_ada')).toBe(false);
    expect(isSystemActor(null)).toBe(false);
    expect(isSystemActor(undefined)).toBe(false);
  });

  it('does not treat an empty actor as the system actor', () => {
    // `if (actorId)` guards elsewhere skip validation entirely on a falsy
    // actor. That must not silently become "KEY did it".
    expect(isSystemActor('')).toBe(false);
  });
});

describe('KEY can do the thing it was always advertised as doing', () => {
  it('marks an invoice paid in its own business', async () => {
    // The whole tool, working, for the first time.
    const { service, recordPayment } = makeService(MINE);

    await service.markInvoicePaid('inv_1', KEY_SYSTEM_ACTOR_ID, MINE);

    // R0-PL-04: the write is the remaining balance, recorded by KEY in KEY's tenant.
    expect(recordPayment).toHaveBeenCalledTimes(1);
    expect(recordPayment).toHaveBeenCalledWith(
      'inv_1',
      MINE,
      expect.objectContaining({ amount: 100 }),
      expect.objectContaining({ actorId: KEY_SYSTEM_ACTOR_ID }),
    );
  });

  it('no longer needs a Membership that never existed', async () => {
    const { service } = makeService(MINE);

    await expect(
      service.markInvoicePaid('inv_1', KEY_SYSTEM_ACTOR_ID, MINE),
    ).resolves.toBeDefined();
  });
});

describe('and cannot reach past its own tenant to do it', () => {
  it('refuses an invoice belonging to another business', async () => {
    // The lookup is by primary key. Without this assertion a hallucinated or
    // hostile invoice id would be obeyed.
    const { service, transition, recordPayment } = makeService(THEIRS);

    await expect(
      service.markInvoicePaid('inv_1', KEY_SYSTEM_ACTOR_ID, MINE),
    ).rejects.toThrow(/Invoice not found/);
    expect(transition).not.toHaveBeenCalled();
    expect(recordPayment).not.toHaveBeenCalled();
  });

  it('says "not found" rather than "not yours"', async () => {
    // A distinct error for "exists but is not yours" confirms the id belongs to
    // someone, which is a probe an attacker can run.
    const { service } = makeService(THEIRS);

    await expect(
      service.markInvoicePaid('inv_1', KEY_SYSTEM_ACTOR_ID, MINE),
    ).rejects.toThrow(/Invoice not found/);
  });

  it('REFUSES KEY entirely when no tenant scope was supplied', async () => {
    // The load-bearing assertion. Recognising the system actor is only sound
    // because the caller proved the tenant; with no businessId there is nothing
    // to prove it with, and accepting the actor on its own word would make
    // every invoice in the database reachable.
    const { service, transition, recordPayment } = makeService(MINE);

    await expect(service.markInvoicePaid('inv_1', KEY_SYSTEM_ACTOR_ID)).rejects.toThrow(
      /Not authorized/,
    );
    expect(transition).not.toHaveBeenCalled();
    expect(recordPayment).not.toHaveBeenCalled();
  });

  it('still refuses a human with no membership', async () => {
    // The original check has to survive. This is the case it was written for.
    const { service } = makeService(MINE);

    await expect(service.markInvoicePaid('inv_1', 'user_stranger', MINE)).rejects.toThrow(
      /Not authorized/,
    );
  });

  it('leaves the unauthenticated internal path alone', async () => {
    // Callers that pass no actor at all are trusted internals behind a guard.
    // Changing their behaviour was not the point of this fix.
    // W10-MARKPAID-ACTOR-REQUIRED (D-05; RA-G16-01 service half): such a
    // caller names the tenant its guard established (every production caller
    // does, RA-G16-01 census); one naming neither is refused (pinned below).
    const { service, recordPayment } = makeService(MINE);

    await service.markInvoicePaid('inv_1', undefined, MINE);

    // R0-PL-04: the same write as every other caller, with no actor invented.
    expect(recordPayment).toHaveBeenCalledTimes(1);
    expect(recordPayment).toHaveBeenCalledWith(
      'inv_1',
      MINE,
      expect.objectContaining({ amount: 100 }),
      expect.objectContaining({ actorId: null }),
    );
  });

  it('W10-MARKPAID-ACTOR-REQUIRED (D-05, RA-G16-01 service half): refuses a call that names neither an actor nor a tenant, before the invoice is read', async () => {
    // No actor to check and no tenant to bind the lookup to: nothing would
    // stand between the caller and any invoice in any business.
    type Call = (s: CommerceService) => Promise<unknown>;
    const calls: Call[] = [
      (s) => s.markInvoicePaid('inv_1'),
      (s) => s.markInvoicePaid('inv_1', undefined, undefined),
      (s) => s.markInvoicePaid('inv_1', null, undefined),
      (s) => s.markInvoicePaid('inv_1', '', ''),
    ];
    for (const call of calls) {
      const { service, transition, recordPayment } = makeService(MINE);
      const { findUnique } = (service as unknown as { prisma: { client: { invoice: { findUnique: ReturnType<typeof vi.fn> } } } })
        .prisma.client.invoice;

      await expect(call(service)).rejects.toThrow(/Not authorized/);
      expect(findUnique).not.toHaveBeenCalled();
      expect(transition).not.toHaveBeenCalled();
      expect(recordPayment).not.toHaveBeenCalled();
    }
  });
});

describe('updateInvoice passes the scope it already had', () => {
  it('forwards businessId when changing status to PAID', async () => {
    // input.businessId was in scope and was never passed, so both callees saw a
    // system actor with no tenant proof and refused. commerce_update_invoice
    // failed on 100% of status changes from the day it shipped — before the
    // system-actor contract existed it failed on the Membership lookup instead,
    // so it has never once worked.
    const markInvoicePaid = vi.fn(async () => ({ id: 'inv_1', status: 'PAID' }));
    const service = Object.assign(Object.create(CommerceService.prototype), {
      prisma: {
        client: {
          invoice: { findFirst: vi.fn(async () => ({ id: 'inv_1', status: 'SENT', items: [] })) },
        },
      },
      validateTaxAndDiscount: vi.fn(),
      markInvoicePaid,
      logger: { log: vi.fn(), warn: vi.fn() },
    });

    // W7-INVOICE-ACTOR-RULES (SEC-CMF1-3, D-88): KEY's commerce_update_invoice names
    // KEY_SYSTEM_ACTOR_ID explicitly; an omitted actor is refused (payments-actor PA-16n).
    await service.updateInvoice({ invoiceId: 'inv_1', businessId: MINE, status: 'PAID' }, KEY_SYSTEM_ACTOR_ID);

    expect(markInvoicePaid).toHaveBeenCalledWith('inv_1', KEY_SYSTEM_ACTOR_ID, MINE);
  });

  it('forwards businessId when changing status to SENT', async () => {
    const updateInvoiceStatus = vi.fn(async () => ({ id: 'inv_1', status: 'SENT' }));
    const service = Object.assign(Object.create(CommerceService.prototype), {
      prisma: {
        client: {
          invoice: { findFirst: vi.fn(async () => ({ id: 'inv_1', status: 'DRAFT', items: [] })) },
        },
      },
      validateTaxAndDiscount: vi.fn(),
      updateInvoiceStatus,
      logger: { log: vi.fn(), warn: vi.fn() },
    });

    // W7-INVOICE-ACTOR-RULES (D-88): KEY's tool call shape (KEY named explicitly).
    await service.updateInvoice({ invoiceId: 'inv_1', businessId: MINE, status: 'SENT' }, KEY_SYSTEM_ACTOR_ID);

    expect(updateInvoiceStatus.mock.calls[0][0]).toMatchObject({
      actorId: KEY_SYSTEM_ACTOR_ID,
      businessId: MINE,
    });
  });
});

describe('the same contract on updateInvoiceStatus', () => {
  function statusService(invoiceBusinessId = MINE) {
    const transition = vi.fn(async () => ({ id: 'inv_1', businessId: invoiceBusinessId, contactId: null }));
    const service = Object.assign(Object.create(CommerceService.prototype), {
      prisma: {
        client: {
          invoice: { findUnique: vi.fn(async () => ({ businessId: invoiceBusinessId })) },
          membership: { findFirst: vi.fn(async () => null) },
        },
      },
      invoiceWorkflow: { transition },
      crm: { logContactEvent: vi.fn(async () => undefined) },
      events: { emit: vi.fn() },
      statsCache: { invalidateCache: vi.fn() },
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    return { service, transition };
  }

  it('lets KEY send an invoice in its own business', async () => {
    const { service, transition } = statusService(MINE);

    await service.updateInvoiceStatus({
      invoiceId: 'inv_1',
      status: 'SENT',
      actorId: KEY_SYSTEM_ACTOR_ID,
      businessId: MINE,
    });

    expect(transition).toHaveBeenCalledTimes(1);
  });

  it('refuses KEY with no tenant scope', async () => {
    const { service } = statusService(MINE);

    await expect(
      service.updateInvoiceStatus({ invoiceId: 'inv_1', status: 'SENT', actorId: KEY_SYSTEM_ACTOR_ID }),
    ).rejects.toThrow(/Not authorized/);
  });
});
