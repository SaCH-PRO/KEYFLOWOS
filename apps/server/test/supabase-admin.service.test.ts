import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupabaseAdminService } from '../src/core/auth/supabase-admin.service';

/**
 * Unit tests for SupabaseAdminService.findUserByEmail pagination.
 *
 * The Supabase admin API does not expose a direct `getUserByEmail`, so we
 * paginate through `listUsers`. These tests confirm the service walks
 * past the first page when looking up a user — a previous regression
 * only checked page 1, causing resend-verification to silently fail for
 * any user beyond the first 200 entries.
 */
describe('SupabaseAdminService.findUserByEmail pagination', () => {
  function makeUser(email: string, id: string) {
    return { id, email } as { id: string; email: string };
  }

  function buildService(pages: Array<{ users: ReturnType<typeof makeUser>[]; error?: { message: string } }>) {
    const listUsers = vi.fn(async ({ page }: { page: number; perPage: number }) => {
      const idx = page - 1;
      const slice = pages[idx];
      if (!slice) return { data: { users: [] }, error: null };
      if (slice.error) return { data: null, error: slice.error };
      return { data: { users: slice.users }, error: null };
    });
    const svc = new SupabaseAdminService();
    (svc as unknown as { client: unknown }).client = {
      auth: { admin: { listUsers } },
    };
    return { svc, listUsers };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('finds a user on the first page without paginating further', async () => {
    const target = makeUser('found@example.com', 'u-1');
    const { svc, listUsers } = buildService([
      { users: [target, makeUser('other@example.com', 'u-2')] },
    ]);
    const result = await svc.findUserByEmail('found@example.com');
    expect(result?.id).toBe('u-1');
    expect(listUsers).toHaveBeenCalledTimes(1);
  });

  it('continues paginating when the first page is full and finds the user on a later page', async () => {
    const fullFirstPage = Array.from({ length: 200 }, (_, i) => makeUser(`user${i}@example.com`, `u-${i}`));
    const target = makeUser('late@example.com', 'u-late');
    const { svc, listUsers } = buildService([
      { users: fullFirstPage },
      { users: [target] },
    ]);
    const result = await svc.findUserByEmail('late@example.com');
    expect(result?.id).toBe('u-late');
    expect(listUsers).toHaveBeenCalledTimes(2);
  });

  it('stops paginating once a page returns fewer than perPage results', async () => {
    const fullFirstPage = Array.from({ length: 200 }, (_, i) => makeUser(`user${i}@example.com`, `u-${i}`));
    const partialSecondPage = Array.from({ length: 5 }, (_, i) => makeUser(`extra${i}@example.com`, `e-${i}`));
    const { svc, listUsers } = buildService([
      { users: fullFirstPage },
      { users: partialSecondPage },
    ]);
    const result = await svc.findUserByEmail('does-not-exist@example.com');
    expect(result).toBeNull();
    expect(listUsers).toHaveBeenCalledTimes(2);
  });

  it('returns null and stops paginating on an API error', async () => {
    const { svc, listUsers } = buildService([
      { users: [], error: { message: 'rate limited' } },
    ]);
    const result = await svc.findUserByEmail('whoever@example.com');
    expect(result).toBeNull();
    expect(listUsers).toHaveBeenCalledTimes(1);
  });

  it('matches emails case-insensitively', async () => {
    const target = makeUser('Mixed.Case@Example.com', 'u-mixed');
    const { svc } = buildService([{ users: [target] }]);
    const result = await svc.findUserByEmail('  MIXED.case@example.COM  ');
    expect(result?.id).toBe('u-mixed');
  });
});
