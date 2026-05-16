import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AdminAuthService } from './admin-auth.service';

const mockPrismaClient = {
  user: {
    findFirst: vi.fn(),
  },
};

const mockPrisma = {
  client: mockPrismaClient,
};

function createMockRedis() {
  const store = new Map<string, string>();
  return {
    get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: vi.fn((key: string, value: string, _mode?: string, _ttl?: number) => {
      store.set(key, value);
      return Promise.resolve('OK');
    }),
  };
}

function createService(redis = createMockRedis()): AdminAuthService {
  return new AdminAuthService(mockPrisma as any, redis as any);
}

describe('AdminAuthService', () => {
  let service: AdminAuthService;
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    process.env = { ...originalEnv };
    service = createService();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('isConfigured', () => {
    it('returns false when env vars are missing', () => {
      process.env.ADMIN_JWT_SECRET = '';
      process.env.ADMIN_PASSWORD_HASH = '';
      process.env.ADMIN_EMAIL = '';
      expect(service.isConfigured()).toBe(false);
    });

    it('returns true when all env vars are set', () => {
      process.env.ADMIN_JWT_SECRET = 'secret';
      process.env.ADMIN_PASSWORD_HASH = 'salt:hash';
      process.env.ADMIN_EMAIL = 'admin@example.com';
      expect(service.isConfigured()).toBe(true);
    });
  });

  describe('validateCredentials', () => {
    it('returns null for wrong email', async () => {
      process.env.ADMIN_EMAIL = 'admin@example.com';
      process.env.ADMIN_PASSWORD_HASH = 'salt:hash';
      process.env.ADMIN_JWT_SECRET = 'secret';

      const result = await service.validateCredentials('wrong@example.com', 'password');
      expect(result).toBeNull();
    });

    it('returns null for wrong password', async () => {
      process.env.ADMIN_EMAIL = 'admin@example.com';
      process.env.ADMIN_PASSWORD_HASH = 'salt:deadbeef';
      process.env.ADMIN_JWT_SECRET = 'secret';

      const result = await service.validateCredentials('admin@example.com', 'wrong');
      expect(result).toBeNull();
    });

    it('returns user when credentials are valid', async () => {
      const password = 'S@chin1997';
      const crypto = await import('crypto');
      const salt = crypto.randomBytes(16).toString('hex');
      const derived = await new Promise<Buffer>((resolve, reject) => {
        crypto.scrypt(password, salt, 64, (err, key) => {
          if (err) reject(err);
          else resolve(key);
        });
      });
      process.env.ADMIN_EMAIL = 'keyflowos.tt@gmail.com';
      process.env.ADMIN_PASSWORD_HASH = `${salt}:${derived.toString('hex')}`;
      process.env.ADMIN_JWT_SECRET = 'secret';

      mockPrismaClient.user.findFirst.mockResolvedValue({
        id: 'user-1',
        email: 'keyflowos.tt@gmail.com',
        role: 'SUPER_ADMIN',
      });

      const result = await service.validateCredentials('keyflowos.tt@gmail.com', password);
      expect(result).not.toBeNull();
      expect(result?.role).toBe('SUPER_ADMIN');
    });
  });

  describe('token round-trip', () => {
    it('generates and verifies a valid token', async () => {
      process.env.ADMIN_JWT_SECRET = 'test-secret-32-bytes-long!!!!!';

      const token = service.generateToken({ id: 'u1', email: 'a@b.com', role: 'SUPER_ADMIN' });
      const verified = await service.verifyToken(token);

      expect(verified).not.toBeNull();
      expect(verified?.sub).toBe('u1');
      expect(verified?.role).toBe('SUPER_ADMIN');
      expect(verified?.jti).toBeTruthy();
    });

    it('rejects an invalid token', async () => {
      process.env.ADMIN_JWT_SECRET = 'test-secret-32-bytes-long!!!!!';
      const verified = await service.verifyToken('invalid.token.here');
      expect(verified).toBeNull();
    });

    it('rejects a tampered token', async () => {
      process.env.ADMIN_JWT_SECRET = 'test-secret-32-bytes-long!!!!!';
      const token = service.generateToken({ id: 'u1', email: 'a@b.com', role: 'SUPER_ADMIN' });
      const tampered = token.slice(0, -5) + 'xxxxx';
      const verified = await service.verifyToken(tampered);
      expect(verified).toBeNull();
    });

    it('rejects an expired token', async () => {
      process.env.ADMIN_JWT_SECRET = 'test-secret-32-bytes-long!!!!!';
      const token = service.generateToken({ id: 'u1', email: 'a@b.com', role: 'SUPER_ADMIN' });

      // Fast-forward time by mocking Date.now
      const realNow = Date.now;
      vi.spyOn(Date, 'now').mockReturnValue(realNow() + 25 * 60 * 60 * 1000); // +25h

      const verified = await service.verifyToken(token);
      expect(verified).toBeNull();

      vi.restoreAllMocks();
    });

    it('rejects a token with wrong type claim', async () => {
      process.env.ADMIN_JWT_SECRET = 'test-secret-32-bytes-long!!!!!';
      const token = service.generateToken({ id: 'u1', email: 'a@b.com', role: 'SUPER_ADMIN' });

      // Decode, mutate type, re-sign with same secret
      const parts = token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      payload.type = 'user';
      const newBody = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const { createHmac } = await import('crypto');
      const newSig = createHmac('sha256', 'test-secret-32-bytes-long!!!!!').update(`${parts[0]}.${newBody}`).digest('base64url');
      const mutated = `${parts[0]}.${newBody}.${newSig}`;

      const verified = await service.verifyToken(mutated);
      expect(verified).toBeNull();
    });
  });

  describe('token revocation', () => {
    it('rejects a revoked jti', async () => {
      process.env.ADMIN_JWT_SECRET = 'test-secret-32-bytes-long!!!!!';
      const redis = createMockRedis();
      const svc = createService(redis);

      const token = svc.generateToken({ id: 'u1', email: 'a@b.com', role: 'SUPER_ADMIN' });
      const payload = await svc.verifyToken(token);
      expect(payload).not.toBeNull();

      await svc.revokeToken(payload!.jti);
      expect(redis.set).toHaveBeenCalledWith(`admin:jti:${payload!.jti}`, '1', 'EX', expect.any(Number));

      const afterRevoke = await svc.verifyToken(token);
      expect(afterRevoke).toBeNull();
    });

    it('rejects tokens issued before a user-wide revocation', async () => {
      process.env.ADMIN_JWT_SECRET = 'test-secret-32-bytes-long!!!!!';
      const redis = createMockRedis();
      const svc = createService(redis);

      const oldToken = svc.generateToken({ id: 'u1', email: 'a@b.com', role: 'SUPER_ADMIN' });
      await new Promise((r) => setTimeout(r, 10));
      await svc.revokeAllTokens('u1');

      const verifiedOld = await svc.verifyToken(oldToken);
      expect(verifiedOld).toBeNull();

      // A newly issued token should still be valid
      const newToken = svc.generateToken({ id: 'u1', email: 'a@b.com', role: 'SUPER_ADMIN' });
      const verifiedNew = await svc.verifyToken(newToken);
      expect(verifiedNew).not.toBeNull();
    });
  });
});
