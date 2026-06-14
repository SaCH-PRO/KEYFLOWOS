import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { scrypt, timingSafeEqual } from 'crypto';
import { buildAdminToken, verifyAdminToken } from '../../core/auth/admin-token.util';
import type { Redis } from 'ioredis';
import { Inject } from '@nestjs/common';
import { REDIS_CLIENT } from '../../core/redis/redis.constants';

function getAdminJwtSecret(): string {
  return process.env.ADMIN_JWT_SECRET || '';
}

function getAdminPasswordHash(): string {
  return process.env.ADMIN_PASSWORD_HASH || '';
}

function getAdminEmail(): string {
  return process.env.ADMIN_EMAIL || '';
}

export interface AdminTokenPayload {
  sub: string;
  email: string;
  role: string;
  iat: number;
  exp: number;
  type: 'admin';
  jti: string;
}

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  isConfigured(): boolean {
    return Boolean(getAdminJwtSecret() && getAdminPasswordHash() && getAdminEmail());
  }

  async validateCredentials(email: string, password: string): Promise<{ id: string; email: string; role: string } | null> {
    if (!this.isConfigured()) {
      this.logger.warn('Admin local auth not configured — set ADMIN_JWT_SECRET, ADMIN_PASSWORD_HASH, and ADMIN_EMAIL');
      return null;
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail !== getAdminEmail().toLowerCase()) {
      return null;
    }

    const valid = await this.verifyPassword(password, getAdminPasswordHash());
    if (!valid) {
      return null;
    }

    const dbUser = await this.prisma.client.user.findFirst({
      where: { email: { equals: getAdminEmail(), mode: 'insensitive' } },
      select: { id: true, email: true, role: true },
    });

    if (!dbUser) {
      this.logger.warn(`Admin email ${getAdminEmail()} validated but no Prisma user found`);
      return null;
    }

    return {
      id: dbUser.id,
      email: dbUser.email,
      role: dbUser.role,
    };
  }

  generateToken(user: { id: string; email: string; role: string }): string {
    const secret = getAdminJwtSecret();
    if (!secret) {
      throw new Error('ADMIN_JWT_SECRET not configured');
    }
    return buildAdminToken(user, secret);
  }

  async verifyToken(token: string): Promise<AdminTokenPayload | null> {
    const verified = await verifyAdminToken(token, this.redis);
    if (!verified) return null;

    const secret = getAdminJwtSecret();
    if (!secret) return null;

    const parts = token.split('.');
    const body = parts[1];
    try {
      return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AdminTokenPayload;
    } catch {
      return null;
    }
  }

  async revokeToken(jti: string): Promise<void> {
    const ttl = 24 * 60 * 60; // 24 hours
    await this.redis.set(`admin:jti:${jti}`, '1', 'EX', ttl);
  }

  async revokeAllTokens(userId: string): Promise<void> {
    await this.redis.set(`admin:user:${userId}:revokedAt`, String(Date.now()));
  }

  private verifyPassword(password: string, hash: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const [salt, key] = hash.split(':');
      if (!salt || !key) {
        resolve(false);
        return;
      }
      scrypt(password, salt, 64, (err, derivedKey) => {
        if (err) {
          reject(err);
          return;
        }
        try {
          resolve(timingSafeEqual(derivedKey, Buffer.from(key, 'hex')));
        } catch {
          resolve(false);
        }
      });
    });
  }
}
