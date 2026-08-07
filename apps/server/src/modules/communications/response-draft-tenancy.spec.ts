/**
 * A guard that checked the URL and a handler that threw the answer away.
 *
 *   POST /api/communications/businesses/:businessId/drafts/:id/approve
 *
 *   @UseGuards(BusinessGuard, ModuleScopeGuard)     <- validates :businessId
 *   async approveDraft(
 *     @Param('businessId') _businessId: string,     <- and then discards it
 *     @Param('id') id: string,
 *   ) { return this.drafts.approveDraft(id, approvedById); }
 *
 *   // service
 *   responseDraft.update({ where: { id: draftId } })   <- no tenant anywhere
 *
 * BusinessGuard does its job: it proves the caller belongs to the business named
 * in the URL. It cannot prove the *record* belongs to it, because the record id
 * is a different parameter. So an authenticated user of business A passed their
 * OWN businessId — guard satisfied — with business B's draft id, and could
 * approve, reject, edit, mark-sent, or SEND B's message to B's customer.
 *
 * ResponseDraft carries a businessId column and is not in BUSINESS_ID_MODELS,
 * so the Prisma extension was not a backstop either. Six methods, one route
 * file, no layer.
 *
 * This is the second instance in two days. The first was
 * POST /cortex/goals/:goalId/plans, where the goal id came from the URL and was
 * resolved with findUnique against every business. Same shape: a guarded route,
 * a caller-supplied record id, and a service that never asked whose it was.
 *
 * The lesson is narrow and worth stating: **a tenant guard on the route does not
 * scope a lookup by id.** Any service method that takes a record id from a
 * request must also take the tenant and put it in the WHERE.
 *
 * Writes use updateMany rather than update. update({ where: { id, businessId } })
 * would compile and — verified empirically against Prisma 6.19 — be ACCEPTED,
 * throwing P2025 on a mismatch. P2025 reads as "record not found", so a tenant
 * violation would be triaged as missing data. updateMany returns a count, and a
 * count of zero is unambiguous.
 */
import { describe, it, expect, vi } from 'vitest';
import { ResponseDraftService } from './response-draft.service';

function makeService() {
  const rows = [
    { id: 'draft_A', businessId: 'biz_A', status: 'PENDING_APPROVAL', body: 'A private message', channel: 'email', contactId: 'c_A', threadId: null },
    { id: 'draft_B', businessId: 'biz_B', status: 'APPROVED', body: 'B private message', channel: 'email', contactId: 'c_B', threadId: null },
  ];

  const match = (where: any, r: any) =>
    (where.id === undefined || where.id === r.id) &&
    (where.businessId === undefined || where.businessId === r.businessId);

  const client = {
    responseDraft: {
      updateMany: vi.fn(async ({ where, data }: any) => {
        const hit = rows.filter((r) => match(where, r));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const r = rows.find((x) => x.id === where.id);
        if (!r) throw new Error('P2025');
        Object.assign(r, data);
        return r;
      }),
      findFirst: vi.fn(async ({ where }: any) => rows.find((r) => match(where, r)) ?? null),
      findUnique: vi.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
      findMany: vi.fn(async () => rows),
      count: vi.fn(async () => rows.length),
      create: vi.fn(async ({ data }: any) => ({ id: 'new', ...data })),
    },
    keyInboxThread: { findUnique: vi.fn(async () => null) },
    interactionIntent: { findUnique: vi.fn(async () => null) },
  };

  const sender = { sendMessage: vi.fn(async () => ({ success: true })) };
  const service = new ResponseDraftService({ client } as never, sender as never);
  return { service, rows, sender, client };
}

describe('a draft belongs to one business', () => {
  it('approving another tenant\'s draft is refused', async () => {
    const { service, rows } = makeService();

    await expect(service.approveDraft('biz_A', 'draft_B', 'user_A')).rejects.toThrow(/not found/i);
    expect(rows.find((r) => r.id === 'draft_B')!.status, 'B was modified by A').toBe('APPROVED');
  });

  it('rejecting another tenant\'s draft is refused', async () => {
    const { service, rows } = makeService();

    await expect(service.rejectDraft('biz_A', 'draft_B', 'spite')).rejects.toThrow(/not found/i);
    expect(rows.find((r) => r.id === 'draft_B')!.status).toBe('APPROVED');
  });

  it('SENDING another tenant\'s draft is refused, and no message leaves', async () => {
    // The one that reaches a customer. draft_B is APPROVED, so status is not
    // what stops this — only the tenant check is.
    const { service, sender } = makeService();

    await expect(service.sendDraft('biz_A', 'draft_B', 'user_A')).rejects.toThrow();
    expect(sender.sendMessage, 'a message was sent on another tenant behalf').not.toHaveBeenCalled();
  });

  it('editing another tenant\'s draft body is refused', async () => {
    const { service, rows } = makeService();

    await expect(service.updateDraftBody('biz_A', 'draft_B', 'edited', 'user_A')).rejects.toThrow(/not found/i);
    expect(rows.find((r) => r.id === 'draft_B')!.body).toBe('B private message');
  });

  it('reading another tenant\'s draft returns nothing', async () => {
    const { service } = makeService();

    expect(await service.getDraftById('biz_A', 'draft_B')).toBeNull();
  });

  it('marking another tenant\'s draft sent is refused', async () => {
    const { service, rows } = makeService();

    await expect(service.markSent('biz_A', 'draft_B')).rejects.toThrow(/not found/i);
    expect(rows.find((r) => r.id === 'draft_B')!.status).toBe('APPROVED');
  });

  it('the owner can still do all of it', async () => {
    // The other half of a scoping fix: it has to not break the legitimate path.
    const { service, rows } = makeService();

    await service.approveDraft('biz_A', 'draft_A', 'user_A');
    expect(rows.find((r) => r.id === 'draft_A')!.status).toBe('APPROVED');

    await service.updateDraftBody('biz_A', 'draft_A', 'revised', 'user_A');
    expect(rows.find((r) => r.id === 'draft_A')!.body).toBe('revised');

    expect(await service.getDraftById('biz_A', 'draft_A')).not.toBeNull();
  });

  it('the writes scope in the WHERE rather than trusting a P2025', async () => {
    const { service, client } = makeService();
    await service.approveDraft('biz_A', 'draft_A', 'user_A');

    const call = (client.responseDraft.updateMany as any).mock.calls[0][0];
    expect(call.where.businessId, 'businessId must be in the where clause').toBe('biz_A');
  });
});

describe('the route stops throwing the tenant away', () => {
  it('no draft handler discards its businessId parameter', () => {
    // The literal shape of the bug: `@Param('businessId') _businessId`. The
    // underscore was the author telling the linter it was unused, which was
    // true and was the vulnerability.
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, 'omnichannel.controller.ts'),
      'utf8',
    ) as string;

    const drafts = src.slice(src.indexOf("@Post('drafts/"));
    expect(
      /_businessId/.test(drafts),
      'a draft route is taking businessId and discarding it again',
    ).toBe(false);
  });
});
