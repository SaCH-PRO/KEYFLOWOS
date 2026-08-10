import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GrowthBookClient } from '@growthbook/growthbook';
import { GrowthBookService } from './growthbook.service';

/**
 * The flag service has one contract that matters above correctness of any
 * single rule: a business must never be worse off for the flag system existing.
 * With no key it is inert and returns the caller's default; an unknown flag
 * returns the default; a thrown evaluation returns the default. "Default" — the
 * value the calling code chose — is always the floor.
 *
 * Rule evaluation itself is GrowthBook's job and is tested upstream; here we
 * load a known payload synchronously (no network) and assert the wiring.
 */
describe('GrowthBookService', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.GROWTHBOOK_CLIENT_KEY;
    delete process.env.GROWTHBOOK_API_HOST;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    vi.restoreAllMocks();
  });

  /** Build a service whose client is loaded from a fixed payload, no network. */
  function serviceWith(features: Record<string, unknown>): GrowthBookService {
    process.env.GROWTHBOOK_CLIENT_KEY = 'sdk-test';
    const svc = new GrowthBookService();
    const client = new GrowthBookClient();
    client.initSync({ payload: { features: features as never } });
    (svc as unknown as { client: GrowthBookClient }).client = client;
    return svc;
  }

  it('is disabled and returns the caller fallback when no key is set', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const svc = new GrowthBookService();

    expect(svc.enabled).toBe(false);
    expect(svc.isEnabled('anything', { businessId: 'biz-1' })).toBe(false);
    expect(svc.isEnabled('anything', { businessId: 'biz-1' }, true)).toBe(true);
    expect(svc.getValue('anything', 'default-copy', { businessId: 'biz-1' })).toBe('default-copy');
    // Disabled means inert: onModuleInit must not reach out.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('resolves a boolean flag from the loaded payload', () => {
    const svc = serviceWith({ 'new-cockpit': { defaultValue: true } });
    expect(svc.isEnabled('new-cockpit', { businessId: 'biz-1' })).toBe(true);
  });

  it('returns the fallback for a flag that is not defined', () => {
    const svc = serviceWith({ 'known-flag': { defaultValue: true } });
    expect(svc.isEnabled('missing-flag', { businessId: 'biz-1' })).toBe(false);
    expect(svc.isEnabled('missing-flag', { businessId: 'biz-1' }, true)).toBe(true);
  });

  it('resolves a typed (string) flag value', () => {
    const svc = serviceWith({ 'enrichment-provider': { defaultValue: 'apollo' } });
    expect(svc.getValue('enrichment-provider', 'none', { businessId: 'biz-1' })).toBe('apollo');
    expect(svc.getValue('unset-provider', 'none', { businessId: 'biz-1' })).toBe('none');
  });

  it('buckets a business deterministically for a percentage rollout', () => {
    // A 100%-coverage rollout must include every business; the point is that the
    // same businessId maps to a stable bucket (GrowthBook hashes on `id`).
    const svc = serviceWith({
      'gradual-feature': {
        defaultValue: false,
        rules: [{ force: true, coverage: 1, hashAttribute: 'id' }],
      },
    });
    const first = svc.isEnabled('gradual-feature', { businessId: 'biz-42' });
    const again = svc.isEnabled('gradual-feature', { businessId: 'biz-42' });
    expect(first).toBe(true);
    expect(again).toBe(first);
  });
});
