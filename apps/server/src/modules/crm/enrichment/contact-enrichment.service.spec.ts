import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { ContactEnrichmentService } from './contact-enrichment.service';
import type { EnrichmentProvider, ProviderOutcome } from './enrichment-provider';
import { resolveCrmAccess } from '../crm-permissions.helper';

vi.mock('../crm-permissions.helper', () => ({ resolveCrmAccess: vi.fn() }));

/**
 * The enrichment service has one invariant above all: it can only ADD data to a
 * contact, never change or erase what's already there, it must be inert when the
 * provider isn't configured, and it must not cool a contact down after a
 * transient provider failure. These tests pin exactly that, with a fake provider
 * so nothing touches the network.
 */

type ContactRow = Record<string, unknown> & { custom?: Record<string, unknown> | null };

function makeService(opts: {
  /** Selected as the paid provider (Apollo). */
  provider: EnrichmentProvider;
  /** Free fallback provider; defaults to the same fake so existing cases are unaffected. */
  publicProvider?: EnrichmentProvider;
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
  const crm = { updateContact };
  const svc = new ContactEnrichmentService(
    prisma as never,
    crm as never,
    opts.provider as never,
    (opts.publicProvider ?? opts.provider) as never,
  );
  return { svc, updateContact, updateMany, findFirst };
}

function fakeProvider(outcome: ProviderOutcome | null, enabled = true, key = 'apollo'): EnrichmentProvider {
  return {
    key,
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

  it('falls back to the free public-data provider when Apollo is not configured', async () => {
    const apollo = fakeProvider(null, false); // paid provider off
    const publicProvider = fakeProvider({ status: 'match', result: { companyName: 'Acme Inc' } }, true, 'public-data');
    const { svc, updateContact } = makeService({ provider: apollo, publicProvider, contact: baseContact });

    const out = await svc.enrichContact({ businessId: 'b1', contactId: 'c1' });

    expect(out.status).toBe('enriched');
    expect(out.provider).toBe('public-data'); // the FREE provider ran, not Apollo
    expect(publicProvider.enrich).toHaveBeenCalledTimes(1);
    expect(apollo.enrich).not.toHaveBeenCalled();
    expect(updateContact.mock.calls[0][0].companyName).toBe('Acme Inc');
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
});
