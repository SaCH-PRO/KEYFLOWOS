import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ContactEnrichmentService } from './contact-enrichment.service';
import type { EnrichmentProvider, ProviderOutcome } from './enrichment-provider';
import { CrmService } from '../crm.service';
import { resolveCrmAccess } from '../crm-permissions.helper';

// The member's access is stubbed; the visibility clause built from it is the real one.
vi.mock('../crm-permissions.helper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../crm-permissions.helper')>()),
  resolveCrmAccess: vi.fn(),
}));

/**
 * The enrichment service has one invariant above all: it can only ADD data to a
 * contact, never change or erase what's already there, it must be inert when the
 * provider isn't configured, and it must not cool a contact down after a
 * transient provider failure. These tests pin exactly that, with a fake provider
 * so nothing touches the network.
 */

type ContactRow = Record<string, unknown> & { custom?: Record<string, unknown> | null };

function makeService(opts: {
  provider: EnrichmentProvider;
  /** Row(s) returned by findFirst, in call order. A single value repeats. */
  contact: ContactRow | null | Array<ContactRow | null>;
}) {
  const updateContact = vi.fn().mockResolvedValue({});
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const findFirst = vi.fn();
  if (Array.isArray(opts.contact)) {
    for (const row of opts.contact) findFirst.mockResolvedValueOnce(row);
  } else {
    findFirst.mockResolvedValue(opts.contact);
  }
  const prisma = { client: { contact: { findFirst, updateMany } } };
  // A CrmService carrying only what its contact edit check reads (prisma), so
  // the enrichment service runs the real CrmService rule; updateContact is a spy.
  const crm = Object.assign(Object.create(CrmService.prototype), { prisma, updateContact });
  const svc = new ContactEnrichmentService(prisma as never, crm as never, opts.provider as never);
  return { svc, updateContact, updateMany, findFirst, crm };
}

function fakeProvider(outcome: ProviderOutcome | null, enabled = true): EnrichmentProvider {
  return {
    key: 'apollo',
    enabled,
    enrich: vi.fn().mockResolvedValue(outcome ?? { status: 'no_match' }),
  };
}

const baseContact: ContactRow = {
  id: 'c1',
  email: 'jane@acme.com',
  firstName: 'Jane',
  lastName: 'Doe',
  companyName: null,
  jobTitle: null,
  department: null,
  industry: null,
  city: null,
  state: null,
  country: null,
  custom: {},
};

describe('ContactEnrichmentService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is a no-op when the provider is not configured', async () => {
    const provider = fakeProvider(null, false);
    const { svc, updateContact } = makeService({ provider, contact: baseContact });

    const out = await svc.enrichContact({ businessId: 'b1', contactId: 'c1' });

    expect(out.status).toBe('not_configured');
    expect(provider.enrich).not.toHaveBeenCalled();
    expect(updateContact).not.toHaveBeenCalled();
  });

  it('fills only blank fields and never overwrites existing values', async () => {
    const provider = fakeProvider({
      status: 'match',
      result: { companyName: 'Acme Inc', jobTitle: 'CTO', industry: 'Software', city: 'Austin' },
    });
    const contact = { ...baseContact, companyName: 'Acme (user-entered)' };
    const { svc, updateContact } = makeService({ provider, contact });

    const out = await svc.enrichContact({ businessId: 'b1', contactId: 'c1' });

    expect(out.status).toBe('enriched');
    expect(out.filled.sort()).toEqual(['city', 'industry', 'jobTitle'].sort());
    expect(out.filled).not.toContain('companyName');

    const patch = updateContact.mock.calls[0][0];
    expect(patch.companyName).toBeUndefined();
    expect(patch.jobTitle).toBe('CTO');
    expect(patch.city).toBe('Austin');
    expect(patch.custom.enrichment.provider).toBe('apollo');
  });

  it('does not overwrite a field filled DURING the provider call (race)', async () => {
    const provider = fakeProvider({ status: 'match', result: { companyName: 'Acme Inc', jobTitle: 'CTO' } });
    // Initial read: companyName blank. Re-read after the lookup: a concurrent
    // write has filled companyName. Enrichment must respect the fresh value.
    const initial = { ...baseContact };
    const fresh = { ...baseContact, companyName: 'Acme (just set by user)' };
    const { svc, updateContact, findFirst } = makeService({ provider, contact: [initial, fresh] });

    const out = await svc.enrichContact({ businessId: 'b1', contactId: 'c1' });

    expect(findFirst).toHaveBeenCalledTimes(2); // initial + re-read
    expect(out.filled).toEqual(['jobTitle']);
    const patch = updateContact.mock.calls[0][0];
    expect(patch.companyName).toBeUndefined(); // the concurrent value wins
    expect(patch.jobTitle).toBe('CTO');
  });

  it('returns no_new_data when everything is already filled', async () => {
    const provider = fakeProvider({ status: 'match', result: { companyName: 'Acme Inc', jobTitle: 'CTO' } });
    const contact = { ...baseContact, companyName: 'Acme', jobTitle: 'Founder' };
    const { svc, updateContact, updateMany } = makeService({ provider, contact });

    const out = await svc.enrichContact({ businessId: 'b1', contactId: 'c1' });

    expect(out.status).toBe('no_new_data');
    expect(updateContact).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalled(); // attempt stamped
  });

  it('skips a recent lookup unless forced', async () => {
    const provider = fakeProvider({ status: 'match', result: { jobTitle: 'CTO' } });
    const recent = new Date(Date.now() - 60_000).toISOString();
    const contact = { ...baseContact, custom: { enrichment: { lastRunAt: recent } } };
    const { svc } = makeService({ provider, contact });

    const skipped = await svc.enrichContact({ businessId: 'b1', contactId: 'c1' });
    expect(skipped.status).toBe('skipped_recent');
    expect(provider.enrich).not.toHaveBeenCalled();

    const forced = await svc.enrichContact({ businessId: 'b1', contactId: 'c1', force: true });
    expect(forced.status).toBe('enriched');
    expect(provider.enrich).toHaveBeenCalledTimes(1);
  });

  it('stamps a genuine miss but NOT a provider error (so an outage does not cool contacts down)', async () => {
    const missProvider = fakeProvider({ status: 'no_match' });
    const miss = makeService({ provider: missProvider, contact: baseContact });
    const missOut = await miss.svc.enrichContact({ businessId: 'b1', contactId: 'c1' });
    expect(missOut.status).toBe('no_match');
    expect(miss.updateMany).toHaveBeenCalled(); // cooled down — legitimate miss

    const errProvider = fakeProvider({ status: 'error' });
    const err = makeService({ provider: errProvider, contact: baseContact });
    const errOut = await err.svc.enrichContact({ businessId: 'b1', contactId: 'c1' });
    expect(errOut.status).toBe('provider_error');
    expect(err.updateContact).not.toHaveBeenCalled();
    expect(err.updateMany).not.toHaveBeenCalled(); // NOT cooled down — retryable
  });

  it('denies a member without contact edit permission before any lookup', async () => {
    (resolveCrmAccess as Mock).mockResolvedValue({ isOwner: false, isSuperAdmin: false, editScope: 'none' });
    const provider = fakeProvider({ status: 'match', result: { jobTitle: 'CTO' } });
    const { svc, updateContact } = makeService({ provider, contact: baseContact });

    await expect(
      svc.enrichContact({ businessId: 'b1', contactId: 'c1', actorUserId: 'member-1' }),
    ).rejects.toThrow(/permission/i);

    expect(provider.enrich).not.toHaveBeenCalled(); // no paid lookup
    expect(updateContact).not.toHaveBeenCalled();
  });

  // R0-13d-CT-BULK-ENRICH-VISIBILITY (R0-13c review ST-R3 / CR-1).
  it('refuses a contact the member cannot see (outside the GET visibility clause) with the 404 an unknown id gets, before any lookup or stamp', async () => {
    (resolveCrmAccess as Mock).mockResolvedValue({
      isOwner: false, isSuperAdmin: false, viewAll: true, editScope: 'any', reassign: false, deleteScope: 'owned', level: 'write',
    });
    const provider = fakeProvider({ status: 'no_match' });
    const { svc, findFirst, updateContact, updateMany } = makeService({ provider, contact: baseContact });
    // c1 is a live row of the tenant, but not one the member's visibility clause reaches.
    findFirst.mockImplementation(async (args: { where?: Record<string, unknown> }) => {
      const where = args?.where ?? {};
      return where.id === 'c1' && !JSON.stringify(where).includes('visibility') ? baseContact : null;
    });

    const hidden = await svc.enrichContact({ businessId: 'b1', contactId: 'c1', actorUserId: 'member-1' }).catch((err: unknown) => err);
    const unknown = await svc.enrichContact({ businessId: 'b1', contactId: 'c-unknown', actorUserId: 'member-1' }).catch((err: unknown) => err);

    expect(hidden).toBeInstanceOf(NotFoundException);
    expect(unknown).toBeInstanceOf(NotFoundException);
    expect((hidden as NotFoundException).getResponse()).toEqual((unknown as NotFoundException).getResponse());
    expect(provider.enrich).not.toHaveBeenCalled(); // the hidden contact's email and name never leave
    expect(updateMany).not.toHaveBeenCalled(); // no custom.enrichment stamp
    expect(updateContact).not.toHaveBeenCalled();
  });

  it("takes the edit decision from CrmService.assertCanEditContact, the check updateContact applies (CR-1): its refusal ends the call before any read, lookup or stamp, and the row it reaches is the row read", async () => {
    const provider = fakeProvider({ status: 'match', result: { jobTitle: 'CTO' } });
    const { svc, crm, findFirst, updateContact, updateMany } = makeService({ provider, contact: baseContact });

    crm.assertCanEditContact = vi.fn().mockRejectedValue(new ForbiddenException('You can only edit contacts you own'));
    await expect(svc.enrichContact({ businessId: 'b1', contactId: 'c1', actorUserId: 'member-1' }))
      .rejects.toThrow('You can only edit contacts you own');
    expect(crm.assertCanEditContact).toHaveBeenCalledWith('b1', 'c1', 'member-1');
    expect(findFirst).not.toHaveBeenCalled();
    expect(provider.enrich).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(updateContact).not.toHaveBeenCalled();

    const reachableWhere = { id: 'c1', businessId: 'b1', deletedAt: null, AND: [{ OR: [{ ownerId: 'member-1' }] }] };
    crm.assertCanEditContact = vi.fn().mockResolvedValue({ access: null, reachableWhere });
    const out = await svc.enrichContact({ businessId: 'b1', contactId: 'c1', actorUserId: 'member-1' });
    expect(out.status).toBe('enriched');
    expect(findFirst).toHaveBeenCalledTimes(2); // initial read + re-read, both bounded by the check
    for (const call of findFirst.mock.calls) expect(call[0]).toEqual({ where: reachableWhere });
    expect(updateContact.mock.calls[0][0]).toMatchObject({ contactId: 'c1', actorUserId: 'member-1', jobTitle: 'CTO' });
  });
});
