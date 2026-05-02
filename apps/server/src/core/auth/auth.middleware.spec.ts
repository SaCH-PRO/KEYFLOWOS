import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { AuthMiddleware } from './auth.middleware';

function makeMiddleware(supabaseUser?: { id: string; email?: string } | null, role = 'USER') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
  const supabaseAuth: any = {
    getUserFromToken: vi.fn().mockResolvedValue(supabaseUser ?? null),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
  const prisma: any = {
    client: {
      user: {
        findUnique: vi.fn().mockResolvedValue({ role }),
      },
    },
  };
  return { mw: new AuthMiddleware(supabaseAuth, prisma), supabaseAuth, prisma };
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

describe('AuthMiddleware (post-bypass-removal)', () => {
  it('does not attach a user when no Authorization header is present', async () => {
    const { mw, supabaseAuth } = makeMiddleware();
    const req = makeReq();
    await mw.use(req, res, next);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspecting augmented Request
    expect((req as any).user).toBeUndefined();
    expect(supabaseAuth.getUserFromToken).not.toHaveBeenCalled();
  });

  it('attaches user with DB role when Supabase verifies a real token', async () => {
    const { mw, supabaseAuth, prisma } = makeMiddleware(
      { id: 'user_real', email: 'real@example.com' },
      'OWNER',
    );
    const req = makeReq({ headers: { authorization: 'Bearer real-jwt-here' } });
    await mw.use(req, res, next);
    expect(supabaseAuth.getUserFromToken).toHaveBeenCalledWith('real-jwt-here');
    expect(prisma.client.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user_real' },
      select: { role: true },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspecting augmented Request
    expect((req as any).user).toEqual({
      id: 'user_real',
      email: 'real@example.com',
      role: 'OWNER',
    });
  });

  it('does not attach a user when Supabase rejects the token', async () => {
    const { mw } = makeMiddleware(null);
    const req = makeReq({ headers: { authorization: 'Bearer invalid-token' } });
    await mw.use(req, res, next);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspecting augmented Request
    expect((req as any).user).toBeUndefined();
  });

  it('does not attach a user when Supabase verification throws', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
    const supabaseAuth: any = {
      getUserFromToken: vi.fn().mockRejectedValue(new Error('network down')),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
    const prisma: any = { client: { user: { findUnique: vi.fn() } } };
    const mw = new AuthMiddleware(supabaseAuth, prisma);
    const req = makeReq({ headers: { authorization: 'Bearer x' } });
    await mw.use(req, res, next);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspecting augmented Request
    expect((req as any).user).toBeUndefined();
  });

  it('falls back to role=USER if the Prisma lookup fails', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
    const supabaseAuth: any = {
      getUserFromToken: vi.fn().mockResolvedValue({ id: 'u1', email: 'a@b.com' }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
    const prisma: any = {
      client: {
        user: { findUnique: vi.fn().mockRejectedValue(new Error('db down')) },
      },
    };
    const mw = new AuthMiddleware(supabaseAuth, prisma);
    const req = makeReq({ headers: { authorization: 'Bearer t' } });
    await mw.use(req, res, next);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspecting augmented Request
    expect((req as any).user).toEqual({ id: 'u1', email: 'a@b.com', role: 'USER' });
  });

  it('ignores legacy dev sentinel tokens (no special handling)', async () => {
    // The middleware just forwards the token to Supabase; sentinel tokens
    // will fail Supabase verification and result in no user attached.
    const { mw } = makeMiddleware(null);
    const req = makeReq({
      headers: { authorization: 'Bearer keyflow-dev-bypass-token' },
    });
    await mw.use(req, res, next);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspecting augmented Request
    expect((req as any).user).toBeUndefined();
  });
});
