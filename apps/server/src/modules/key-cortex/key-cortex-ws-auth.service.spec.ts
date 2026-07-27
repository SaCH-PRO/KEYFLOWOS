import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KeyCortexWsAuthService, isAllowedWsOrigin } from './key-cortex-ws-auth.service';
import { buildAdminToken } from '../../core/auth/admin-token.util';

/** Build a minimal fake Socket with a controllable handshake. */
function fakeSocket(opts: {
  authToken?: string;
  header?: string;
  queryUserId?: string;
}): any {
  return {
    id: 'sock_1',
    handshake: {
      auth: opts.authToken ? { token: opts.authToken } : {},
      headers: opts.header ? { authorization: opts.header } : {},
      query: opts.queryUserId ? { userId: opts.queryUserId } : {},
    },
  };
}

describe('KeyCortexWsAuthService', () => {
  let supabaseAuth: { getUserFromToken: ReturnType<typeof vi.fn> };
  let prisma: any;
  let service: KeyCortexWsAuthService;

  beforeEach(() => {
    supabaseAuth = { getUserFromToken: vi.fn() };
    prisma = {
      client: {
        user: { findUnique: vi.fn().mockResolvedValue({ role: 'USER' }) },
        business: { findFirst: vi.fn() },
      },
    };
    // redis undefined is fine — admin-token util treats it as "no revocation store".
    service = new KeyCortexWsAuthService(supabaseAuth as any, prisma as any, undefined as any);
  });

  describe('authenticateSocket', () => {
    it('accepts a valid Supabase JWT and derives identity from the token', async () => {
      supabaseAuth.getUserFromToken.mockResolvedValue({ id: 'u1', email: 'a@b.co' });
      const result = await service.authenticateSocket(fakeSocket({ authToken: 'valid.jwt' }));
      expect(result).toEqual({ userId: 'u1', email: 'a@b.co', role: 'USER' });
      expect(supabaseAuth.getUserFromToken).toHaveBeenCalledWith('valid.jwt');
    });

    it('resolves role from the database, not the token', async () => {
      supabaseAuth.getUserFromToken.mockResolvedValue({ id: 'u1', email: 'a@b.co' });
      prisma.client.user.findUnique.mockResolvedValue({ role: 'SUPER_ADMIN' });
      const result = await service.authenticateSocket(fakeSocket({ authToken: 'valid.jwt' }));
      expect(result?.role).toBe('SUPER_ADMIN');
    });

    it('returns null when no token is present (missing JWT)', async () => {
      const result = await service.authenticateSocket(fakeSocket({}));
      expect(result).toBeNull();
      expect(supabaseAuth.getUserFromToken).not.toHaveBeenCalled();
    });

    it('returns null for a malformed / invalid / expired token (getUserFromToken → null, no admin fallback)', async () => {
      supabaseAuth.getUserFromToken.mockResolvedValue(null);
      const result = await service.authenticateSocket(fakeSocket({ authToken: 'garbage' }));
      expect(result).toBeNull();
    });

    it('reads the token from the Authorization header as a fallback', async () => {
      supabaseAuth.getUserFromToken.mockResolvedValue({ id: 'u2', email: null });
      const result = await service.authenticateSocket(fakeSocket({ header: 'Bearer hdr.jwt' }));
      expect(result?.userId).toBe('u2');
      expect(supabaseAuth.getUserFromToken).toHaveBeenCalledWith('hdr.jwt');
    });

    it('NEVER derives identity from a client-supplied query userId (forged userId ignored)', async () => {
      supabaseAuth.getUserFromToken.mockResolvedValue({ id: 'real-user', email: null });
      const result = await service.authenticateSocket(
        fakeSocket({ authToken: 'valid.jwt', queryUserId: 'attacker' }),
      );
      expect(result?.userId).toBe('real-user');
      expect(result?.userId).not.toBe('attacker');
    });

    describe('admin HMAC-JWT fallback', () => {
      const OLD = process.env.ADMIN_JWT_SECRET;
      beforeEach(() => {
        process.env.ADMIN_JWT_SECRET = 'test-admin-secret';
      });
      afterEach(() => {
        if (OLD === undefined) delete process.env.ADMIN_JWT_SECRET;
        else process.env.ADMIN_JWT_SECRET = OLD;
      });

      it('falls back to a valid admin token when Supabase verification fails', async () => {
        supabaseAuth.getUserFromToken.mockResolvedValue(null);
        const token = buildAdminToken(
          { id: 'admin1', email: 'admin@keyflow.io', role: 'SUPER_ADMIN' },
          'test-admin-secret',
        );
        const result = await service.authenticateSocket(fakeSocket({ authToken: token }));
        expect(result).toEqual({ userId: 'admin1', email: 'admin@keyflow.io', role: 'SUPER_ADMIN' });
      });

      it('rejects an admin token signed with the wrong secret', async () => {
        supabaseAuth.getUserFromToken.mockResolvedValue(null);
        const token = buildAdminToken(
          { id: 'admin1', email: 'admin@keyflow.io', role: 'SUPER_ADMIN' },
          'a-different-secret',
        );
        const result = await service.authenticateSocket(fakeSocket({ authToken: token }));
        expect(result).toBeNull();
      });
    });
  });

  describe('verifyBusinessMembership', () => {
    it('allows the business owner', async () => {
      prisma.client.business.findFirst.mockResolvedValue({ id: 'b1' });
      await expect(service.verifyBusinessMembership('u1', 'USER', 'b1')).resolves.toBe(true);
    });

    it('allows a member', async () => {
      prisma.client.business.findFirst.mockResolvedValue({ id: 'b1' });
      await expect(service.verifyBusinessMembership('member1', 'USER', 'b1')).resolves.toBe(true);
    });

    it('rejects a non-member', async () => {
      prisma.client.business.findFirst.mockResolvedValue(null);
      await expect(service.verifyBusinessMembership('outsider', 'USER', 'b1')).resolves.toBe(false);
    });

    it('rejects a disabled (soft-deleted) business — findFirst returns null', async () => {
      // The soft-delete extension filters deletedAt IS NOT NULL out of findFirst,
      // so a disabled business is indistinguishable from "no membership": null → reject.
      prisma.client.business.findFirst.mockResolvedValue(null);
      await expect(service.verifyBusinessMembership('u1', 'USER', 'b-disabled')).resolves.toBe(false);
    });

    it('bypasses the membership check for SUPER_ADMIN', async () => {
      await expect(service.verifyBusinessMembership('admin', 'SUPER_ADMIN', 'b1')).resolves.toBe(true);
      expect(prisma.client.business.findFirst).not.toHaveBeenCalled();
    });

    it('rejects when businessId is empty', async () => {
      await expect(service.verifyBusinessMembership('u1', 'USER', '')).resolves.toBe(false);
    });

    it('fails closed if the membership query throws', async () => {
      prisma.client.business.findFirst.mockRejectedValue(new Error('db down'));
      await expect(service.verifyBusinessMembership('u1', 'USER', 'b1')).resolves.toBe(false);
    });
  });

  describe('isAllowedWsOrigin', () => {
    const OLD = process.env.APP_URL;
    beforeEach(() => {
      process.env.APP_URL = 'https://app.keyflow.io';
    });
    afterEach(() => {
      if (OLD === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = OLD;
    });

    it('allows a configured origin', () => {
      expect(isAllowedWsOrigin('https://app.keyflow.io')).toBe(true);
    });

    it('allows a configured origin with a trailing slash', () => {
      expect(isAllowedWsOrigin('https://app.keyflow.io/')).toBe(true);
    });

    it('allows the localhost dev fallback', () => {
      expect(isAllowedWsOrigin('http://localhost:5000')).toBe(true);
    });

    it('rejects an unknown cross-origin', () => {
      expect(isAllowedWsOrigin('https://evil.example.com')).toBe(false);
    });

    it('allows requests without an Origin header (native/server/test clients)', () => {
      expect(isAllowedWsOrigin(undefined)).toBe(true);
    });
  });
});
