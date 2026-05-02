import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response } from 'express';
import { AuthMiddleware } from './auth.middleware';
import {
  KEYFLOW_DEV_BYPASS_TOKEN,
  KEYFLOW_DEV_PROFILES,
} from './keyflow-dev-auth';

function makeMiddleware(supabaseShouldReturnUser?: { id: string; email?: string }) {
  const supabaseAuth = {
    getUserFromToken: vi.fn().mockResolvedValue(supabaseShouldReturnUser ?? null),
  } as any;
  const prisma = {
    client: {
      user: {
        findUnique: vi.fn().mockResolvedValue({ role: 'USER' }),
      },
    },
  } as any;
  return new AuthMiddleware(supabaseAuth, prisma);
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    query: {},
    ...overrides,
  } as Request;
}

const next = () => {};
const res = {} as Response;

describe('AuthMiddleware dev bypass profile resolution', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    process.env.KEYFLOW_DEV_AUTH_BYPASS = 'true';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('attaches the default SUPER_ADMIN profile when no token is present', async () => {
    const mw = makeMiddleware();
    const req = makeReq();
    await mw.use(req, res, next);
    expect((req as any).user).toEqual({
      id: 'keyflowdev_user',
      email: 'dev@keyflow.os',
      role: 'SUPER_ADMIN',
    });
  });

  it('attaches the legacy SUPER_ADMIN profile for the original sentinel token', async () => {
    const mw = makeMiddleware();
    const req = makeReq({
      headers: { authorization: `Bearer ${KEYFLOW_DEV_BYPASS_TOKEN}` },
    });
    await mw.use(req, res, next);
    expect((req as any).user.role).toBe('SUPER_ADMIN');
    expect((req as any).user.id).toBe('keyflowdev_user');
  });

  it.each(KEYFLOW_DEV_PROFILES.map((p) => [p.key, p.token, p.userId, p.userRole]))(
    'attaches profile "%s" when its sentinel token is presented',
    async (_key, token, userId, userRole) => {
      const mw = makeMiddleware();
      const req = makeReq({
        headers: { authorization: `Bearer ${token}` },
      });
      await mw.use(req, res, next);
      expect((req as any).user.id).toBe(userId);
      expect((req as any).user.role).toBe(userRole);
    },
  );

  it('honors a ?as=<key> override even when the token would resolve to a different profile', async () => {
    const mw = makeMiddleware();
    const req = makeReq({
      headers: { authorization: `Bearer ${KEYFLOW_DEV_BYPASS_TOKEN}` },
      query: { as: 'staff' },
    });
    await mw.use(req, res, next);
    expect((req as any).user.id).toBe('keyflowdev_staff');
    expect((req as any).user.role).toBe('USER');
  });

  it('also honors the X-Keyflow-Dev-As header', async () => {
    const mw = makeMiddleware();
    const req = makeReq({
      headers: { 'x-keyflow-dev-as': 'admin' },
    });
    await mw.use(req, res, next);
    expect((req as any).user.id).toBe('keyflowdev_admin');
  });

  it('ignores an unknown ?as value and falls back to default profile', async () => {
    const mw = makeMiddleware();
    const req = makeReq({ query: { as: 'sysadmin' } });
    await mw.use(req, res, next);
    expect((req as any).user.id).toBe('keyflowdev_user');
  });

  it('rejects sentinel tokens entirely when bypass is disabled', async () => {
    process.env.KEYFLOW_DEV_AUTH_BYPASS = 'false';
    const mw = makeMiddleware();
    const req = makeReq({
      headers: { authorization: `Bearer keyflow-dev-bypass-token-staff` },
    });
    await mw.use(req, res, next);
    expect((req as any).user).toBeUndefined();
  });
});
