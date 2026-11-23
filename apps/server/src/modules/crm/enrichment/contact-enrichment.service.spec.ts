import { afterAll, describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ContactEnrichmentService } from './contact-enrichment.service';
import type { EnrichmentProvider, ProviderOutcome } from './enrichment-provider';
import { CrmService } from '../crm.service';
import { resolveCrmAccess } from '../crm-permissions.helper';

/**
 * FU-UNIT-MOCK-ISOLATION (vitest.unit.config.ts, isolate:false): this file's
 * vi.mock must reach a module that other spec files also import. Without a
 * registry reset, a copy evaluated by an earlier file in the worker is reused,
 * bound to the real dependency, and the mock never applies (seen under
 * --sequence.seed=12345 once FU-VITEST-DECORATOR-METADATA's swc transform kept
 * constructor-type imports as runtime values, and on main at that seed for
 * some of these files). Reset before this file's imports (hoisted with the
 * mocks) and after its last test.
 */
vi.hoisted(() => {
  vi.resetModules();
});
afterAll(() => {
  vi.resetModules();
});

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
  /** TOF-WEBSITE-ENRICHMENT: the website source; absent in the cases written before it. */
  website?: EnrichmentProvider & { appliesTo: (query: unknown) => boolean };
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
  const svc = opts.website
    ? new ContactEnrichmentService(prisma as never, crm as never, opts.provider as never, opts.website as never)
    : new ContactEnrichmentService(prisma as never, crm as never, opts.provider as never);
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

/**
 * TOF-WEBSITE-ENRICHMENT (V1-63; #63; owner ruling D-188 'enrichment'): the
 * website source. It runs only on the explicit enrich action of a member who
 * may edit the contact (the edit check comes first, as for Apollo), only when
 * Apollo is not configured, and it counts as configured only when its flag is
 * on and the contact has a business website (Release 0 register: the required
 * case 'is a no-op when the provider is not configured' still holds). A match
 * is written through CrmService.updateContact like any other provider's.
 */
describe('ContactEnrichmentService: the website source (TOF-WEBSITE-ENRICHMENT, D-188)', () => {
  beforeEach(() => vi.clearAllMocks());

  function websiteSource(outcome: ProviderOutcome, opts: { enabled?: boolean; applies?: boolean } = {}) {
    return {
      key: 'website',
      enabled: opts.enabled ?? true,
      appliesTo: vi.fn().mockReturnValue(opts.applies ?? true),
      enrich: vi.fn().mockResolvedValue(outcome),
    };
  }

  const WEBSITE_MATCH: ProviderOutcome = {
    status: 'match',
    result: { companyName: 'Acme Bakery', city: 'San Fernando', raw: { source: 'website', website: 'https://acme.example/' } },
  };

  it('with Apollo not configured and the website flag on, the website source enriches: the blank fields are filled through CrmService.updateContact and the provenance names the website', async () => {
    const apollo = fakeProvider(null, false);
    const website = websiteSource(WEBSITE_MATCH);
    const { svc, updateContact } = makeService({ provider: apollo, website, contact: baseContact });

    const out = await svc.enrichContact({ businessId: 'b1', contactId: 'c1', actorUserId: undefined });

    expect(out).toEqual({ status: 'enriched', provider: 'website', filled: ['companyName', 'city'] });
    expect(apollo.enrich).not.toHaveBeenCalled();
    expect(website.appliesTo).toHaveBeenCalledWith(expect.objectContaining({ email: 'jane@acme.com', domain: 'acme.com' }));
    expect(website.enrich).toHaveBeenCalledTimes(1);
    const patch = updateContact.mock.calls[0][0];
    expect(patch).toMatchObject({ businessId: 'b1', contactId: 'c1', companyName: 'Acme Bakery', city: 'San Fernando' });
    expect(patch.custom.enrichment).toMatchObject({ provider: 'website', filled: ['companyName', 'city'], raw: { source: 'website', website: 'https://acme.example/' } });
  });

  it('the website source never overwrites: a company name the member typed is kept and only blank fields are filled', async () => {
    const website = websiteSource(WEBSITE_MATCH);
    const { svc, updateContact } = makeService({ provider: fakeProvider(null, false), website, contact: { ...baseContact, companyName: 'Typed by member' } });

    const out = await svc.enrichContact({ businessId: 'b1', contactId: 'c1' });

    expect(out).toEqual({ status: 'enriched', provider: 'website', filled: ['city'] });
    expect(updateContact.mock.calls[0][0].companyName).toBeUndefined();
  });

  it("counts as configured for a contact only when the contact has a business website: none answers not_configured after the member's edit check, with no lookup and no stamp", async () => {
    const website = websiteSource(WEBSITE_MATCH, { applies: false });
    const { svc, crm, updateContact, updateMany, findFirst } = makeService({ provider: fakeProvider(null, false), website, contact: baseContact });
    crm.assertCanEditContact = vi.fn().mockResolvedValue({ access: null, reachableWhere: { id: 'c1', businessId: 'b1', deletedAt: null } });

    const out = await svc.enrichContact({ businessId: 'b1', contactId: 'c1', actorUserId: 'member-1' });

    expect(out).toEqual({ status: 'not_configured', provider: 'website', filled: [] });
    expect(crm.assertCanEditContact).toHaveBeenCalledWith('b1', 'c1', 'member-1');
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(website.enrich).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(updateContact).not.toHaveBeenCalled();
  });

  it('with the website flag off and Apollo not configured, enrich is the same no-op as before: not_configured, nothing read, nothing asked', async () => {
    const apollo = fakeProvider(null, false);
    const website = websiteSource(WEBSITE_MATCH, { enabled: false });
    const { svc, findFirst, updateContact, updateMany } = makeService({ provider: apollo, website, contact: baseContact });

    const out = await svc.enrichContact({ businessId: 'b1', contactId: 'c1' });

    expect(out).toEqual({ status: 'not_configured', provider: 'apollo', filled: [] });
    expect(findFirst).not.toHaveBeenCalled();
    expect(apollo.enrich).not.toHaveBeenCalled();
    expect(website.appliesTo).not.toHaveBeenCalled();
    expect(website.enrich).not.toHaveBeenCalled();
    expect(updateContact).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('Apollo, when configured, stays the provider: the website source is never asked', async () => {
    const apollo = fakeProvider({ status: 'match', result: { jobTitle: 'CTO' } });
    const website = websiteSource(WEBSITE_MATCH);
    const { svc } = makeService({ provider: apollo, website, contact: baseContact });

    const out = await svc.enrichContact({ businessId: 'b1', contactId: 'c1' });

    expect(out).toEqual({ status: 'enriched', provider: 'apollo', filled: ['jobTitle'] });
    expect(website.appliesTo).not.toHaveBeenCalled();
    expect(website.enrich).not.toHaveBeenCalled();
  });

  it('a member refused by the edit check triggers no website lookup and no read', async () => {
    const website = websiteSource(WEBSITE_MATCH);
    const { svc, crm, findFirst, updateContact, updateMany } = makeService({ provider: fakeProvider(null, false), website, contact: baseContact });
    crm.assertCanEditContact = vi.fn().mockRejectedValue(new ForbiddenException('You can only edit contacts you own'));

    await expect(svc.enrichContact({ businessId: 'b1', contactId: 'c1', actorUserId: 'member-1' })).rejects.toThrow('You can only edit contacts you own');
    expect(findFirst).not.toHaveBeenCalled();
    expect(website.appliesTo).not.toHaveBeenCalled();
    expect(website.enrich).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(updateContact).not.toHaveBeenCalled();
  });

  it('a website miss is stamped (the recent guard spares the next tap) and a transient website failure is not', async () => {
    const miss = makeService({ provider: fakeProvider(null, false), website: websiteSource({ status: 'no_match' }), contact: baseContact });
    expect(await miss.svc.enrichContact({ businessId: 'b1', contactId: 'c1' })).toEqual({ status: 'no_match', provider: 'website', filled: [] });
    expect(miss.updateMany).toHaveBeenCalledTimes(1);
    expect(miss.updateMany.mock.calls[0][0].data.custom.enrichment).toMatchObject({ provider: 'website', filled: [] });

    const failed = makeService({ provider: fakeProvider(null, false), website: websiteSource({ status: 'error' }), contact: baseContact });
    expect(await failed.svc.enrichContact({ businessId: 'b1', contactId: 'c1' })).toEqual({ status: 'provider_error', provider: 'website', filled: [] });
    expect(failed.updateMany).not.toHaveBeenCalled();
    expect(failed.updateContact).not.toHaveBeenCalled();
  });
});
