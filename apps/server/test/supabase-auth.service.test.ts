import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SupabaseAuthService } from '../src/core/auth/supabase-auth.service';

const mockGetUser = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: mockGetUser,
    },
  })),
}));

function createJwt(payload: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

describe('SupabaseAuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  });

  it('falls back to local JWT decode when Supabase getUser throws', async () => {
    mockGetUser.mockRejectedValue(new Error('network unreachable'));
    const svc = new SupabaseAuthService();
    const token = createJwt({ sub: 'user_123', email: 'user@example.com' });

    const user = await svc.getUserFromToken(token);

    expect(user).toBeTruthy();
    expect(user?.id).toBe('user_123');
    expect(user?.email).toBe('user@example.com');
  });

  it('returns null when token missing and no fallback possible', async () => {
    const svc = new SupabaseAuthService();
    const user = await svc.getUserFromToken(undefined);
    expect(user).toBeNull();
  });
});
