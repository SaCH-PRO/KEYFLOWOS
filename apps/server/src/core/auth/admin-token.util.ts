import { createHmac, timingSafeEqual, randomUUID } from 'crypto';
import type { Redis } from 'ioredis';

function getAdminJwtSecret(): string {
  return process.env.ADMIN_JWT_SECRET || '';
}

export interface AdminTokenPayload {
  sub: string;
  email: string;
  role: string;
  iat: number;
  exp: number;
  type: string;
  jti: string;
}

export async function verifyAdminToken(
  token: string,
  redis?: Redis,
): Promise<{ id: string; email: string; role: string } | null> {
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
    if (payload.exp < Date.now()) return null;

    if (redis && payload.jti) {
      const revoked = await redis.get(`admin:jti:${payload.jti}`);
      if (revoked) return null;

      const revokedAt = await redis.get(`admin:user:${payload.sub}:revokedAt`);
      if (revokedAt && payload.iat < parseInt(revokedAt, 10)) {
        return null;
      }
    }

    return { id: payload.sub, email: payload.email, role: payload.role };
  } catch {
    return null;
  }
}

export function buildAdminToken(user: { id: string; email: string; role: string }, secret: string): string {
  const now = Date.now();
  const payload: AdminTokenPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    iat: now,
    exp: now + 24 * 60 * 60 * 1000,
    type: 'admin',
    jti: randomUUID(),
  };

  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');

  return `${header}.${body}.${signature}`;
}
