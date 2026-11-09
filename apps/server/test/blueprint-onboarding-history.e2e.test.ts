/**
 * PR196-GENOME — GET /blueprint/businesses/:businessId/onboarding-history
 * (mocked HTTP; the route, its guards and BlueprintOnboardingService are real).
 *
 * WHAT: the Business Genome interview's transcript is kept server-side, in the
 * onboarding service's bounded cache, keyed by the business. This route reads
 * it back, so a reload or a second device resumes the conversation without the
 * browser keeping a copy (PR #196 kept one in localStorage, never purged at
 * sign-out: OK-8B-2).
 *
 * WHO MAY READ IT, decided from our guards: any member of that business (the
 * class guards, AuthGuard and BusinessGuard). The genome lives in
 * business_blueprints, and every blueprint route (GET/PATCH
 * /blueprint/businesses/:businessId, POST onboarding-chat itself) is
 * any-member; owner ruling D-11 makes the Business row's profile fields OWNER
 * only (PATCH /identity/businesses/:id; Genesis refuses only the answers that
 * write the Business row, assertProfileAnswersOwner), not the blueprint. So the
 * transcript of the shared interview is not D-11 profile data, and a STAFF
 * member with no scopes reads it as they read the blueprint itself (R2).
 *
 * The NEGATIVE CONTROL (R3): a caller who is not a member of the business (the
 * owner of another one) gets BusinessGuard's 403, with none of the transcript;
 * and that caller's own business never shows it (R4). Unauthenticated: 401 (R5).
 *
 * R6 pins the R0-P / R0-07 rule on the chat route the history depends on: AI
 * unavailable answers the structured 503 (code provider_not_configured,
 * service ai) instead of a 200 holding a made-up reply, and the transcript the
 * history returns keeps no trace of the refused turn.
 *
 * Only identity attachment, Prisma's membership lookup and the blueprint and
 * AI-usage services are stand-ins: a test middleware attaches `{ id, role }`
 * from `x-test-user` as AuthMiddleware would after verifying a token, the
 * Prisma stub answers BusinessGuard's own predicate (userCanAccessBusiness:
 * owner or member) from seeded rows, and the model reply is scripted, so no
 * provider is called.
 */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { describe, beforeAll, afterAll, beforeEach, it, expect, vi } from 'vitest';
import { BlueprintOnboardingController } from '../src/modules/ai/blueprint-onboarding.controller';
import { BlueprintOnboardingService } from '../src/modules/ai/blueprint-onboarding.service';
import { ModelGatewayService, keyDisabledRefusal } from '../src/modules/ai/model-gateway.service';
import { AiUsageService } from '../src/modules/ai/ai-usage.service';
import { BlueprintService } from '../src/modules/blueprint/blueprint.service';
import { AuthGuard } from '../src/core/auth/auth.guard';
import { BusinessGuard } from '../src/core/auth/business.guard';
import { PrismaService } from '../src/core/prisma/prisma.service';

const BIZ_A = 'biz_genome_a';
const BIZ_B = 'biz_genome_b';
const OWNER_A = 'user_owner_a';
const STAFF_A = 'user_staff_a';
const OWNER_B = 'user_owner_b';

const SENSITIVE = 'We are three partners: Ana 50%, Ben 30%, Cy 20%, BIR not registered yet.';
const KEY_REPLY = 'Thanks. Who is your ideal customer?';

const businesses = [
  { id: BIZ_A, ownerId: OWNER_A },
  { id: BIZ_B, ownerId: OWNER_B },
];
const memberships = [
  { userId: OWNER_A, businessId: BIZ_A, role: 'OWNER' },
  { userId: STAFF_A, businessId: BIZ_A, role: 'STAFF', permissionScopes: {} },
  { userId: OWNER_B, businessId: BIZ_B, role: 'OWNER' },
];
const users: Record<string, { id: string; role: string }> = {
  [OWNER_A]: { id: OWNER_A, role: 'USER' },
  [STAFF_A]: { id: STAFF_A, role: 'USER' },
  [OWNER_B]: { id: OWNER_B, role: 'USER' },
};

/** BusinessGuard's predicate (userCanAccessBusiness) answered from the seeded rows. */
const prismaMock = {
  client: {
    business: {
      findFirst: vi.fn(async ({ where }: any) => {
        const userId = where?.OR?.[0]?.ownerId;
        const biz = businesses.find((b) => b.id === where.id);
        if (!biz) return null;
        const member = memberships.some((m) => m.businessId === biz.id && m.userId === userId);
        return biz.ownerId === userId || member ? biz : null;
      }),
    },
  },
};

function emptyBlueprint() {
  return {
    schemaVersion: 1,
    identity: {},
    operatingModel: {},
    goals: {},
    constraints: {},
    brand: {},
    customerModel: {},
    financials: {},
    intelligence: {},
    workflowModel: {},
    aiPreferences: {},
    confidenceScores: {},
    completeness: 0,
    updatedAt: '2026-11-09T00:00:00.000Z',
  };
}

const blueprintMock = {
  getBlueprint: vi.fn(async () => emptyBlueprint()),
  updateBlueprint: vi.fn(async () => emptyBlueprint()),
  checkThreePillarMinimum: vi.fn(() => false),
};

let modelReply: () => Promise<{ content: string }> = async () => ({ content: KEY_REPLY });
const aiUsageMock = {
  trackAndComplete: vi.fn(async () => modelReply()),
};

let app: INestApplication;

function history(actor: string | null, businessId: string) {
  const req = request(app.getHttpServer()).get(`/blueprint/businesses/${businessId}/onboarding-history`);
  return actor ? req.set('x-test-user', actor) : req;
}

function chat(actor: string, businessId: string, message: string) {
  return request(app.getHttpServer())
    .post(`/blueprint/businesses/${businessId}/onboarding-chat`)
    .set('x-test-user', actor)
    .send({ message, history: [] });
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [BlueprintOnboardingController],
    providers: [
      BlueprintOnboardingService,
      AuthGuard,
      BusinessGuard,
      { provide: PrismaService, useValue: prismaMock },
      { provide: BlueprintService, useValue: blueprintMock },
      { provide: ModelGatewayService, useValue: {} },
      { provide: AiUsageService, useValue: aiUsageMock },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.use((req: any, _res: any, next: any) => {
    const id = req.headers['x-test-user'];
    if (typeof id === 'string' && users[id]) req.user = { ...users[id] };
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  // The owner of A tells KEY about the partners and the BIR status.
  const res = await chat(OWNER_A, BIZ_A, SENSITIVE);
  expect(res.status).toBe(201);
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  modelReply = async () => ({ content: KEY_REPLY });
});

describe('PR196-GENOME: GET onboarding-history', () => {
  it('R1 the owner reads the business transcript back from the server', async () => {
    const res = await history(OWNER_A, BIZ_A);
    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([
      { role: 'user', content: SENSITIVE },
      { role: 'assistant', content: KEY_REPLY },
    ]);
    expect(res.body).toHaveProperty('nextSection');
  });

  it('R2 a STAFF member with no scopes reads it too: the genome is business-level, not D-11 profile data', async () => {
    const res = await history(STAFF_A, BIZ_A);
    expect(res.status).toBe(200);
    expect(res.body.messages.map((m: { content: string }) => m.content)).toEqual([SENSITIVE, KEY_REPLY]);
  });

  it('R3 NEGATIVE CONTROL: a non-member (the owner of another business) gets 403 and none of the transcript', async () => {
    const res = await history(OWNER_B, BIZ_A);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('partners');
    expect(res.body).not.toHaveProperty('messages');
  });

  it("R4 the transcript is bound to its business: another business's history never shows it", async () => {
    const res = await history(OWNER_B, BIZ_B);
    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain('partners');
  });

  it('R5 unauthenticated: 401, no transcript', async () => {
    const res = await history(null, BIZ_A);
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain('partners');
  });

  it('R6 AI unavailable: the chat answers the R0-P 503 and the history keeps no trace of the refused turn', async () => {
    modelReply = async () => {
      throw keyDisabledRefusal();
    };
    const refused = await chat(OWNER_A, BIZ_A, 'We also sell gift cards.');
    expect(refused.status).toBe(503);
    expect(refused.body).toMatchObject({ code: 'provider_not_configured', service: 'ai' });

    const res = await history(OWNER_A, BIZ_A);
    expect(res.status).toBe(200);
    expect(res.body.messages.map((m: { content: string }) => m.content)).toEqual([SENSITIVE, KEY_REPLY]);
  });
});
