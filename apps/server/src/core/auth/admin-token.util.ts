import { createHmac, timingSafeEqual } from 'crypto';

function getAdminJwtSecret(): string {
  return process.env.ADMIN_JWT_SECRET || '';
}

interface AdminTokenPayload {
  sub: string;
  email: string;
  role: string;
  iat: number;
  exp: number;
  type: string;
}

export function verifyAdminToken(token: string): { id: string; email: string; role: string } | null {
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
    return { id: payload.sub, email: payload.email, role: payload.role };
  } catch {
    return null;
  }
}
