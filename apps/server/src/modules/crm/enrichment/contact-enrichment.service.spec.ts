import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContactEnrichmentService } from './contact-enrichment.service';
import type { EnrichmentProvider, EnrichmentResult } from './enrichment-provider';

/**
 * The enrichment service has one invariant above all: it can only ADD data to a
 * contact, never change or erase what's already there, and it must be inert when
 * the provider isn't configured. These tests pin exactly that, with a fake
 * provider so nothing touches the network.
 */

type ContactRow = Record<string, unknown> & { custom?: Record<string, unknown> | null };

function makeService(opts: {
  provider: EnrichmentProvider;
  contact: ContactRow | null;
}) {
  const updateContact = vi.fn().mockResolvedValue({});
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    client: {
      contact: {
        findFirst: vi.fn().mockResolvedValue(opts.contact),
        updateMany,
      },
    },
  };
  const crm = { updateContact };
  const svc = new ContactEnrichmentService(
    prisma as never,
    crm as never,
    opts.provider as never,
  );
  return { svc, updateContact, updateMany };
}

function fakeProvider(over: Partial<EnrichmentProvider> & { result?: EnrichmentResult | null }): EnrichmentProvider {
  return {
    key: over.key ?? 'apollo',
    enabled: over.enabled ?? true,
    enrich: vi.fn().mockResolvedValue(over.result ?? null),
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
    const provider = fakeProvider({ enabled: false });
    const { svc, updateContact } = makeService({ provider, contact: baseContact });

    const out = await svc.enrichContact({ businessId: 'b1', contactId: 'c1' });

    expect(out.status).toBe('not_configured');
    expect(provider.enrich).not.toHaveBeenCalled();
    expect(updateContact).not.toHaveBeenCalled();
  });

  it('fills only blank fields and never overwrites existing values', async () => {
    const provider = fakeProvider({
      result: { companyName: 'Acme Inc', jobTitle: 'CTO', industry: 'Software', city: 'Austin' },
    });
    // Contact already has a companyName — enrichment must leave it alone.
    const contact = { ...baseContact, companyName: 'Acme (user-entered)' };
    const { svc, updateContact } = makeService({ provider, contact });

    const out = await svc.enrichContact({ businessId: 'b1', contactId: 'c1', actorUserId: 'u1' });

    expect(out.status).toBe('enriched');
    expect(out.filled.sort()).toEqual(['city', 'industry', 'jobTitle'].sort());
    expect(out.filled).not.toContain('companyName');

    const patch = updateContact.mock.calls[0][0];
    expect(patch.companyName).toBeUndefined(); // untouched
    expect(patch.jobTitle).toBe('CTO');
    expect(patch.city).toBe('Austin');
    // Provenance stamped.
    expect(patch.custom.enrichment.provider).toBe('apollo');
    expect(patch.custom.enrichment.filled.sort()).toEqual(['city', 'industry', 'jobTitle'].sort());
  });

  it('returns no_new_data (and does not write fields) when everything is already filled', async () => {
    const provider = fakeProvider({ result: { companyName: 'Acme Inc', jobTitle: 'CTO' } });
    const contact = { ...baseContact, companyName: 'Acme', jobTitle: 'Founder' };
    const { svc, updateContact, updateMany } = makeService({ provider, contact });

    const out = await svc.enrichContact({ businessId: 'b1', contactId: 'c1' });

    expect(out.status).toBe('no_new_data');
    expect(updateContact).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalled(); // attempt is still stamped
  });

  it('skips a recent lookup unless forced', async () => {
    const provider = fakeProvider({ result: { jobTitle: 'CTO' } });
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

  it('returns no_match and stamps the attempt when the provider finds nothing', async () => {
    const provider = fakeProvider({ result: null });
    const { svc, updateContact, updateMany } = makeService({ provider, contact: baseContact });

    const out = await svc.enrichContact({ businessId: 'b1', contactId: 'c1' });

    expect(out.status).toBe('no_match');
    expect(updateContact).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalled();
  });
});
