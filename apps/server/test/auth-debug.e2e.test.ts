import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { describe, beforeAll, afterAll, it, expect, vi } from 'vitest';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { SupabaseAuthService } from '../src/core/auth/supabase-auth.service';
import { AuthMiddleware } from '../src/core/auth/auth.middleware';
import { PrismaService } from '../src/core/prisma/prisma.service';

describe('Auth debug endpoint', () => {
  let app: INestApplication;
  const getUserFromToken = vi.fn();
  const inspectToken = vi.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        { provide: AppService, useValue: { getHello: () => 'ok' } },
        {
          provide: PrismaService,
          useValue: {
            client: {
              user: {
                findUnique: vi.fn().mockResolvedValue(null),
              },
            },
          },
        },
        {
          provide: SupabaseAuthService,
          useValue: {
            getUserFromToken,
            inspectAuthEnv: vi.fn().mockResolvedValue({
              hasSupabaseUrl: true,
              hasSupabasePublishableKey: true,
            }),
            inspectToken,
          },
        },
        AuthMiddleware,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(moduleRef.get(AuthMiddleware).use.bind(moduleRef.get(AuthMiddleware)));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns no-bearer-token when authorization header is missing', async () => {
    inspectToken.mockReturnValue({ hasToken: false });
    getUserFromToken.mockResolvedValue(null);

    const res = await request(app.getHttpServer())
      .get('/auth-debug')
      .expect(200);

    expect(res.body.ok).toBe(false);
    expect(res.body.reason).toBe('no-bearer-token');
  });

  it('returns authenticated details when token resolves user', async () => {
    inspectToken.mockReturnValue({
      hasToken: true,
      hasSupabaseClient: true,
      supabaseError: null,
      decoded: { hasPayload: true, hasUserId: true, hasEmail: true },
      source: 'supabase',
    });
    getUserFromToken.mockResolvedValue({ id: 'user_1', email: 'keyflowos.tt@gmail.com' });

    const res = await request(app.getHttpServer())
      .get('/auth-debug')
      .set('Authorization', 'Bearer abc.def.ghi')
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.user.id).toBe('user_1');
    expect(res.body.inspection.source).toBe('supabase');
  });
});
