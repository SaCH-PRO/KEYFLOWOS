import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { AiSettingsService } from './ai-settings.service';
import { EffectiveAuthorityResolver } from '../../core/authority/effective-authority.resolver';
import type { PrismaService } from '../../core/prisma/prisma.service';

/**
 * C3: the grantor is server-derived, and a USER grant is bounded by the grantor.
 *
 * Before this, `ai-settings.controller` did
 * `grantorId: body.grantorId ?? req.user?.id ?? 'system'` — the CLIENT's value won over
 * the authenticated caller, the DTO made it required so it was always sent, and
 * `createAuthorityGrant` checked nothing at all. Anyone who could reach the route could
 * mint tier-4 authority for any grantee and attribute it to anyone.
 */

const BUSINESS = 'biz_1';

function harness(opts: { membership?: any; tier?: number } = {}) {
  const created: any[] = [];
  const membership = opts.membership === undefined
    ? { id: 'mem_caller', role: 'OWNER', permissionScopes: null, maxApprovalTier: opts.tier ?? 0 }
    : opts.membership;

  const prisma = {
    client: {
      membership: {
        findUnique: vi.fn(async () => membership),
        findMany: vi.fn(async () => []),
      },
      user: { findUnique: vi.fn(async () => ({ id: 'user_caller', role: 'USER' })) },
      orgAssignment: { findMany: vi.fn(async () => []) },
      authorityGrant: {
        findMany: vi.fn(async () => []),
        create: vi.fn(async ({ data }: any) => {
          created.push(data);
          return { id: 'grant_1', ...data };
        }),
      },
      delegationRule: { findMany: vi.fn(async () => []) },
    },
  } as unknown as PrismaService;

  const service = new AiSettingsService(prisma, new EffectiveAuthorityResolver(prisma));
  return { service, created };
}

const grantInput = {
  callerUserId: 'user_caller',
  granteeType: 'USER' as const,
  granteeId: 'user_grantee',
  scope: 'tier4_financial' as const,
};

describe('C3 — grantor identity is server-derived', () => {
  it('records the caller Membership id, not anything the client could supply', async () => {
    const { service, created } = harness();
    await service.createAuthorityGrant(BUSINESS, grantInput);

    expect(created).toHaveLength(1);
    // A Membership id, which is what the column documents — never a User id, and never
    // the 'system' sentinel that resolved to no row of either kind.
    expect(created[0].grantorId).toBe('mem_caller');
    expect(created[0].grantorId).not.toBe('user_caller');
  });

  it('refuses when the caller has no Membership in this business', async () => {
    const { service, created } = harness({ membership: null });

    await expect(service.createAuthorityGrant(BUSINESS, grantInput)).rejects.toBeInstanceOf(ForbiddenException);
    // If we cannot name who granted it, we do not record that it was granted.
    expect(created).toHaveLength(0);
  });

  it('cannot be influenced by a grantorId in the payload', async () => {
    // The service signature no longer accepts one; this asserts a stray property is
    // inert rather than quietly winning, which is exactly how the original bug read.
    const { service, created } = harness();
    await service.createAuthorityGrant(BUSINESS, { ...grantInput, grantorId: 'mem_someone_else' } as any);
    expect(created[0].grantorId).toBe('mem_caller');
  });
});

describe('C3 — a USER grant cannot exceed the grantor', () => {
  it('allows a tier-4 grantor to grant a tier4 scope', async () => {
    // OWNER with no explicit map resolves to tier 4 under the frozen rule.
    const { service, created } = harness();
    await service.createAuthorityGrant(BUSINESS, grantInput);
    expect(created).toHaveLength(1);
  });

  it('refuses a grantor below tier 4', async () => {
    const { service, created } = harness({
      membership: { id: 'mem_caller', role: 'STAFF', permissionScopes: {}, maxApprovalTier: 2 },
    });

    await expect(service.createAuthorityGrant(BUSINESS, grantInput)).rejects.toThrow(/approval tier 4/);
    expect(created).toHaveLength(0);
  });

  it('refuses a STAFF grantor trying to grant themselves tier-4 authority', async () => {
    // The self-grant is the case the missing check made free.
    const { service, created } = harness({
      membership: { id: 'mem_caller', role: 'STAFF', permissionScopes: {}, maxApprovalTier: 0 },
    });

    await expect(
      service.createAuthorityGrant(BUSINESS, { ...grantInput, granteeId: 'user_caller' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(created).toHaveLength(0);
  });

  it('leaves KEY grants on their existing path, unbounded but server-attributed', async () => {
    // CG-REVIEW: KEY reader semantics are outside this cutover. The grantor is still
    // server-derived, which breaks nothing because no reader has ever read grantorId.
    const { service, created } = harness({
      membership: { id: 'mem_caller', role: 'STAFF', permissionScopes: {}, maxApprovalTier: 0 },
    });

    await service.createAuthorityGrant(BUSINESS, { ...grantInput, granteeType: 'KEY', granteeId: 'key_ai' });

    expect(created).toHaveLength(1);
    expect(created[0].grantorId).toBe('mem_caller');
  });
});
