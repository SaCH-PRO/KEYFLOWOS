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

function createService(): AdminAuthService {
  return new AdminAuthService(mockPrisma as any);
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
    it('generates and verifies a valid token', () => {
      process.env.ADMIN_JWT_SECRET = 'test-secret-32-bytes-long!!!!!'; 

      const token = service.generateToken({ id: 'u1', email: 'a@b.com', role: 'SUPER_ADMIN' });
      const verified = service.verifyToken(token);

      expect(verified).not.toBeNull();
      expect(verified?.sub).toBe('u1');
      expect(verified?.role).toBe('SUPER_ADMIN');
    });

    it('rejects an invalid token', () => {
      process.env.ADMIN_JWT_SECRET = 'test-secret-32-bytes-long!!!!!';
      const verified = service.verifyToken('invalid.token.here');
      expect(verified).toBeNull();
    });

    it('rejects a tampered token', () => {
      process.env.ADMIN_JWT_SECRET = 'test-secret-32-bytes-long!!!!!';
      const token = service.generateToken({ id: 'u1', email: 'a@b.com', role: 'SUPER_ADMIN' });
      const tampered = token.slice(0, -5) + 'xxxxx';
      const verified = service.verifyToken(tampered);
      expect(verified).toBeNull();
    });
  });
});
