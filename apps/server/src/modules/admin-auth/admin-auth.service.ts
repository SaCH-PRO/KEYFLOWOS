import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { scrypt, timingSafeEqual } from 'crypto';
import { createHmac } from 'crypto';

function getAdminJwtSecret(): string {
  return process.env.ADMIN_JWT_SECRET || '';
}

function getAdminPasswordHash(): string {
  return process.env.ADMIN_PASSWORD_HASH || '';
}

function getAdminEmail(): string {
  return process.env.ADMIN_EMAIL || '';
}

interface AdminTokenPayload {
  sub: string;
  email: string;
  role: string;
  iat: number;
  exp: number;
  type: 'admin';
}

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(private readonly prisma: PrismaService) {}

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

    // Look up the Prisma user to get the correct ID and role
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

    const now = Math.floor(Date.now() / 1000);
    const payload: AdminTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      iat: now,
      exp: now + 24 * 60 * 60, // 24 hours
      type: 'admin',
    };

    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');

    return `${header}.${body}.${signature}`;
  }

  verifyToken(token: string): AdminTokenPayload | null {
    const secret = getAdminJwtSecret();
    if (!secret) return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, body, signature] = parts;
    const expectedSignature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');

    try {
      if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
        return null;
      }
    } catch {
      return null;
    }

    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AdminTokenPayload;
      if (payload.type !== 'admin') return null;
      if (payload.exp * 1000 < Date.now()) return null;
      return payload;
    } catch {
      return null;
    }
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
