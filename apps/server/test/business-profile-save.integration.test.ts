/**
 * V1-63 SWP-PROFILE-TEAMSIZE — the Business Profile form's save, as the server
 * takes it (sweep BUG-006, journey A). REAL database.
 *
 * THE DEFECT: Profile > Business Profile > "Save Business Info"
 * (apps/web/src/app/app/profile/components/my-business-section.tsx) offered
 * the team sizes SOLO, SMALL_TEAM, GROWING, MEDIUM and LARGE and sent
 * teamSize "" when none was chosen, but the profile PATCH validates teamSize
 * with @IsEnum(TeamSize) (identity/dto/update-business.dto.ts: solo, small,
 * medium, large, 1, 2-5, 6-10, 11-50, 50+). Every save answered 400
 * "teamSize must be one of: ..." and nothing was written: not the name, not
 * the tagline, not the hours. The fix is the form's (no server change): it
 * offers enum values, sends no teamSize when none is chosen, and reads a
 * value the old form stored as the option it means.
 *
 * WHAT THIS PROVES, through the real route on a real row:
 *   - [V63M-C01] RED-BEFORE: each team size the form offers, read from the
 *     form's own source (its TEAM_SIZE_OPTIONS), is saved with the rest of
 *     the form's body (name, tagline, description, businessHours) and read
 *     back by GET (RED at the base: SOLO, SMALL_TEAM, ... answer 400 and
 *     write nothing);
 *   - [V63M-C02] the form's body without teamSize (no size chosen) saves the
 *     other fields and leaves the stored team size as it was;
 *   - [V63M-C03] RED-BEFORE: each stored spelling the form reads as an option
 *     (its STORED_TEAM_SIZE, from its source) is read as a value this PATCH
 *     saves, so a business the old form wrote can save again (RED at the base:
 *     the form has no such map);
 *   - [V63M-C04] the contract the form is held to, unchanged: "" and each
 *     old spelling are refused 400 naming every team size the server takes,
 *     with the row byte-identical;
 *   - [V63M-C05] RED-BEFORE: clearing a stored team size clears it: the
 *     value the form sends for a clear (its CLEARED_TEAM_SIZE, from its
 *     source) is saved with the rest of the form's body as team_size NULL
 *     and GET reads none (PTS-COR-1, review: the form left a clear out of
 *     the body, which C02 shows keeps the stored size, and still said
 *     "Business info updated"; RED at the base: the form has no clear);
 *   - [V63M-D11] owner ruling D-11 unchanged: a STAFF granted settings write
 *     and an ADMIN are refused 403 with the row byte-identical, a valid team
 *     size included, and an owner of another business is refused by
 *     BusinessGuard.
 *
 * HOW THE APP IS COMPOSED (the R0-09 model, as in
 * test/business-v1-settings.integration.test.ts): a real Nest app with the
 * real IdentityController, IdentityService, PrismaService, AuthGuard and
 * BusinessGuard against the database at DATABASE_URL. The one stand-in on
 * the authorization path is identity attachment: a test middleware reads
 * `x-test-user`, loads that seeded User row and attaches `{ id, email, role }`
 * as AuthMiddleware does after token verification. Collaborators the PATCH
 * and GET paths never authorize with are stubs. Production's global
 * ValidationPipe({ whitelist: true, transform: true }) is installed for the
 * body with UpdateBusinessDto as its expected type (vitest's esbuild emits no
 * parameter types).
 *
 * NO PROVIDER IS CALLED: nothing on these paths reaches one.
 *
 * FIXTURES: every user, business and membership id has the `v63m_` prefix
 * (registered in test/helpers/fixture-prefixes.json for V1-63
 * SWP-PROFILE-TEAMSIZE), every User.email contains it, and every row is
 * hard-deleted with LIKE ${sqlLikePrefix(P)} in beforeAll and afterAll. No
 * $transaction wraps a fixture.
 */
import 'reflect-metadata';
import fs from 'fs';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v63m_';
const ID = {
  owner: `${P}owner`,   // OWNER membership (and Business.ownerId) of bizA
  staffW: `${P}staffW`, // STAFF of bizA, granted settings: write
  admin: `${P}admin`,   // ADMIN of bizA, role defaults
  ownerB: `${P}ownerB`, // OWNER of bizB only
  bizA: `${P}bizA`,     // the business under test
  bizB: `${P}bizB`,     // another tenant
};
const USERS = [ID.owner, ID.staffW, ID.admin, ID.ownerB];
const emailOf = (id: string) => `${id}@v63m.test.local`;

/** The Business Profile form, read as the browser runs it. */
const FORM_SOURCE = path.resolve(__dirname, '../../web/src/app/app/profile/components/my-business-section.tsx');

/** The array or object literal assigned to `const <name>` in the form's source, brackets included. */
function literalOf(source: string, name: string): string {
  const decl = new RegExp(`const ${name}\\b[^=]*=\\s*([[{])`).exec(source);
  if (!decl) throw new Error(`${name} is not in ${path.basename(FORM_SOURCE)}`);
  const opener = decl[1];
  const closer = opener === '[' ? ']' : '}';
  const open = decl.index + decl[0].length - 1;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === opener) depth++;
    else if (source[i] === closer && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error(`${name} has no end in ${path.basename(FORM_SOURCE)}`);
}

/** The team sizes the form offers: the `value` of each TEAM_SIZE_OPTIONS entry. */
function formTeamSizes(): string[] {
  const list = literalOf(fs.readFileSync(FORM_SOURCE, 'utf8'), 'TEAM_SIZE_OPTIONS');
  return [...list.matchAll(/value:\s*["']([^"']*)["']/g)].map((m) => m[1]);
}

/** The stored spellings the form reads as one of its options: STORED_TEAM_SIZE's entries. */
function formStoredSpellings(): Array<[string, string]> {
  const map = literalOf(fs.readFileSync(FORM_SOURCE, 'utf8'), 'STORED_TEAM_SIZE');
  return [...map.matchAll(/["']?([\w+-]+)["']?\s*:\s*["']([^"']*)["']/g)].map((m) => [m[1], m[2]]);
}

/**
 * What the form sends as teamSize when the owner clears a stored team size: the value of its CLEARED_TEAM_SIZE (a
 * null, string or number literal), read from its source.
 */
function formClearedTeamSize(): unknown {
  const source = fs.readFileSync(FORM_SOURCE, 'utf8');
  const decl = /const CLEARED_TEAM_SIZE\b[^=]*=\s*(null|"[^"\n]*"|'[^'\n]*'|-?\d+)\s*;/.exec(source);
  if (!decl) throw new Error(`CLEARED_TEAM_SIZE is not in ${path.basename(FORM_SOURCE)}`);
  const literal = decl[1].startsWith("'") ? `"${decl[1].slice(1, -1)}"` : decl[1];
  return JSON.parse(literal);
}

/** The Business Profile form's body (handleSave), with or without a team size. */
function formBody(fields: { name: string; tagline: string; description: string; teamSize?: string }) {
  return {
    name: fields.name,
    tagline: fields.tagline,
    description: fields.description,
    ...(fields.teamSize ? { teamSize: fields.teamSize } : {}),
    businessHours: HOURS,
  };
}

const HOURS = Object.fromEntries(
  ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => [
    d,
    { open: '08:00', close: '16:00', closed: d === 'sunday' },
  ]),
);

/** The old form's team sizes: what BUG-006's saves sent. */
const OLD_FORM_SIZES = ['SOLO', 'SMALL_TEAM', 'GROWING', 'MEDIUM', 'LARGE'];

let db: any;
let app: any;
let TeamSizeEnum: Record<string, string>;

async function cleanup() {
  for (const sql of [
    `DELETE FROM business_blueprints WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)} OR owner_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort: cascades cover most of these */ }
  }
}

/** The Business row exactly as Postgres stores it, so "unchanged" means byte-identical. */
async function businessRowText(id: string): Promise<string> {
  const rows = await db.$queryRawUnsafe('SELECT row_to_json(b)::text AS j FROM businesses b WHERE b.id = $1', id);
  expect(rows.length, `business ${id} exists`).toBe(1);
  return rows[0].j as string;
}

/** Put bizA back to what the old form left: the profile fields and a stored team size. */
async function resetBizA(teamSize: string | null = null) {
  await db.$executeRawUnsafe(
    'UPDATE businesses SET name = $1, tagline = NULL, description = NULL, team_size = $2, business_hours = NULL WHERE id = $3',
    `${P}bizA-name`,
    teamSize,
    ID.bizA,
  );
}

function patch(actor: string, businessId: string, body: Record<string, unknown>) {
  return request(app.getHttpServer()).patch(`/identity/businesses/${businessId}`).set('x-test-user', actor).send(body);
}

function get(actor: string, businessId: string) {
  return request(app.getHttpServer()).get(`/identity/businesses/${businessId}`).set('x-test-user', actor);
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const common = await import('@nestjs/common');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { OptionalAuthGuard } = await import('../src/core/auth/optional-auth.guard');
  const { SupabaseAdminService } = await import('../src/core/auth/supabase-admin.service');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { IdentityController } = await import('../src/modules/identity/identity.controller');
  const { IdentityService } = await import('../src/modules/identity/identity.service');
  const { IdentitySignupService } = await import('../src/modules/identity/identity-signup.service');
  const { BusinessContextService } = await import('../src/modules/identity/business-context.service');
  const { AuthSecurityService } = await import('../src/modules/identity/auth-security.service');
  const { IdentityPasswordService } = await import('../src/modules/identity/identity-password.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { BlueprintService } = await import('../src/modules/blueprint/blueprint.service');
  const { DefaultTriggersService } = await import('../src/modules/ai/default-triggers.service');
  const dto = await import('../src/modules/identity/dto/update-business.dto');
  TeamSizeEnum = dto.TeamSize as unknown as Record<string, string>;

  const moduleRef = await Test.createTestingModule({
    controllers: [IdentityController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      OptionalAuthGuard,
      IdentityService,
      { provide: BlueprintService, useValue: { inferFromOnboarding: async () => null } },
      { provide: DefaultTriggersService, useValue: {} },
      // Not on the PATCH or GET business path.
      { provide: IdentitySignupService, useValue: {} },
      { provide: BusinessContextService, useValue: {} },
      { provide: AiUsageService, useValue: {} },
      { provide: AuthSecurityService, useValue: {} },
      { provide: IdentityPasswordService, useValue: {} },
      { provide: SupabaseAdminService, useValue: {} },
      { provide: REDIS_CLIENT, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  // The production body pipe options, with the route's declared body type (see the header).
  const bodyPipe = new common.ValidationPipe({ whitelist: true, transform: true, expectedType: dto.UpdateBusinessDto });
  app.useGlobalPipes({
    transform: (value: unknown, metadata: { type: string }) => (metadata.type === 'body' ? bodyPipe.transform(value, metadata as any) : value),
  });
  // Identity attachment only, as AuthMiddleware attaches it from the User row. No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  await app.init();

  await cleanup(); // in case a prior run aborted

  for (const id of USERS) {
    await db.user.create({ data: { id, email: emailOf(id), name: id, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: `${P}bizA-name`, ownerId: ID.owner, currency: 'TTD', timezone: 'America/Port_of_Spain' } });
  await db.business.create({ data: { id: ID.bizB, name: `${P}bizB-name`, ownerId: ID.ownerB } });
  const memberships: Array<{ userId: string; businessId: string; role: string; permissionScopes?: Record<string, string> }> = [
    { userId: ID.owner, businessId: ID.bizA, role: 'OWNER' },
    { userId: ID.staffW, businessId: ID.bizA, role: 'STAFF', permissionScopes: { settings: 'write' } },
    { userId: ID.admin, businessId: ID.bizA, role: 'ADMIN' },
    { userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
  ];
  for (const m of memberships) {
    await db.membership.create({ data: { id: `${P}m_${m.userId.slice(P.length)}_${m.businessId.slice(P.length)}`, ...m } });
  }
}, 60_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
}, 60_000);

describe('V1-63 SWP-PROFILE-TEAMSIZE fixture sanity (real rows)', () => {
  it('[V63M-X01] seeded two tenants, four users and four memberships; the form source and the TeamSize enum are read', async () => {
    expect(await db.business.count({ where: { id: { startsWith: P } } })).toBe(2);
    expect(await db.user.count({ where: { id: { startsWith: P } } })).toBe(4);
    expect(await db.membership.count({ where: { id: { startsWith: P } } })).toBe(4);
    expect(fs.existsSync(FORM_SOURCE), FORM_SOURCE).toBe(true);
    expect(Object.values(TeamSizeEnum)).toEqual(expect.arrayContaining(['solo', '2-5', '6-10', '11-50', '50+']));
  });
});

describe('V1-63 SWP-PROFILE-TEAMSIZE: the form\'s save is the PATCH\'s contract (BUG-006)', () => {
  it('[V63M-C01] RED-BEFORE: each team size the form offers is saved with the rest of the form and read back', async () => {
    const offered = formTeamSizes();
    expect(offered.length, 'the form offers team sizes').toBeGreaterThanOrEqual(4);
    const refused: string[] = [];
    for (const [i, teamSize] of offered.entries()) {
      await resetBizA();
      const body = formBody({ name: `${P}Pastries ${i}`, tagline: `Fresh ${i}`, description: `Bakery ${i}`, teamSize });
      const res = await patch(ID.owner, ID.bizA, body);
      if (res.status !== 200) {
        refused.push(`'${teamSize}': ${res.status} ${JSON.stringify(res.body?.message)}`);
        continue;
      }
      const stored = await db.business.findUnique({ where: { id: ID.bizA }, select: { name: true, tagline: true, description: true, teamSize: true, businessHours: true } });
      expect(stored).toEqual({ name: body.name, tagline: body.tagline, description: body.description, teamSize, businessHours: HOURS });
      const read = await get(ID.owner, ID.bizA);
      expect(read.status).toBe(200);
      expect({ name: read.body.name, tagline: read.body.tagline, description: read.body.description, teamSize: read.body.teamSize, businessHours: read.body.businessHours })
        .toEqual({ name: body.name, tagline: body.tagline, description: body.description, teamSize, businessHours: HOURS });
    }
    expect(refused, 'every team size the form offers is saved').toEqual([]);
  });

  it('[V63M-C02] the form\'s body with no team size saves the other fields and leaves the stored team size as it was', async () => {
    await resetBizA('2-5');
    const body = formBody({ name: `${P}Point Fortin Pastries & Bakes`, tagline: 'Fresh from the oven daily', description: 'Family bakery in Point Fortin.' });
    expect(body).not.toHaveProperty('teamSize');
    const res = await patch(ID.owner, ID.bizA, body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const stored = await db.business.findUnique({ where: { id: ID.bizA }, select: { name: true, tagline: true, description: true, teamSize: true, businessHours: true } });
    expect(stored).toEqual({ name: body.name, tagline: body.tagline, description: body.description, teamSize: '2-5', businessHours: HOURS });

    await resetBizA(null);
    expect((await patch(ID.owner, ID.bizA, body)).status).toBe(200);
    expect((await db.business.findUnique({ where: { id: ID.bizA }, select: { teamSize: true } }))?.teamSize).toBeNull();
  });

  it('[V63M-C03] RED-BEFORE: each stored spelling the form reads as an option is read as a team size this PATCH saves', async () => {
    const spellings = formStoredSpellings();
    const offered = formTeamSizes();
    // The old form's own values, at least, are read (BUG-006's businesses).
    expect(spellings.map(([from]) => from)).toEqual(expect.arrayContaining(OLD_FORM_SIZES));
    const refused: string[] = [];
    for (const [from, to] of spellings) {
      expect(offered, `'${from}' is read as '${to}', an option the form offers`).toContain(to);
      await resetBizA(from);
      const res = await patch(ID.owner, ID.bizA, formBody({ name: `${P}bizA-name`, tagline: 'Fresh daily', description: 'Bakery', teamSize: to }));
      if (res.status !== 200) refused.push(`'${from}' -> '${to}': ${res.status}`);
      else expect((await db.business.findUnique({ where: { id: ID.bizA }, select: { teamSize: true } }))?.teamSize).toBe(to);
    }
    expect(refused).toEqual([]);
  });

  it('[V63M-C04] the contract is unchanged: "" and each old spelling are refused 400 naming every team size, and nothing is written', async () => {
    const named = `teamSize must be one of: ${Object.values(TeamSizeEnum).join(', ')}`;
    for (const teamSize of ['', ...OLD_FORM_SIZES]) {
      await resetBizA();
      const before = await businessRowText(ID.bizA);
      const res = await patch(ID.owner, ID.bizA, { ...formBody({ name: `${P}not-written`, tagline: 'not written', description: 'not written' }), teamSize });
      expect(res.status, `teamSize '${teamSize}'`).toBe(400);
      expect(JSON.stringify(res.body?.message)).toContain(named);
      expect(await businessRowText(ID.bizA), `teamSize '${teamSize}' writes nothing`).toBe(before);
    }
  });

  it('[V63M-C05] RED-BEFORE: clearing a stored team size (the form\'s clear, read from its source) clears it, and saves the rest', async () => {
    const cleared = formClearedTeamSize();
    // A size the form offers, and one the old form stored (shown by the form as the option it means).
    for (const [i, stored] of ['2-5', 'SMALL_TEAM'].entries()) {
      await resetBizA(stored);
      const body = { ...formBody({ name: `${P}Cleared ${i}`, tagline: `Fresh ${i}`, description: `Bakery ${i}` }), teamSize: cleared };
      const res = await patch(ID.owner, ID.bizA, body);
      expect(res.status, `clear of '${stored}' with teamSize ${JSON.stringify(cleared)}: ${JSON.stringify(res.body)}`).toBe(200);
      const row = await db.business.findUnique({ where: { id: ID.bizA }, select: { name: true, tagline: true, description: true, teamSize: true, businessHours: true } });
      expect(row, `'${stored}' is cleared`).toEqual({ name: body.name, tagline: body.tagline, description: body.description, teamSize: null, businessHours: HOURS });
      const nulls = await db.$queryRawUnsafe('SELECT team_size IS NULL AS cleared FROM businesses WHERE id = $1', ID.bizA);
      expect(nulls[0].cleared, 'team_size is NULL').toBe(true);
      const read = await get(ID.owner, ID.bizA);
      expect(read.status).toBe(200);
      expect(read.body, 'GET reads no team size').toHaveProperty('teamSize', null);
      expect(read.body.name).toBe(body.name);
    }
  });
});

describe('V1-63 SWP-PROFILE-TEAMSIZE: owner ruling D-11 is unchanged (the profile is the owner\'s)', () => {
  it('[V63M-D11] a STAFF with settings write and an ADMIN are refused 403 with the row unchanged; another tenant\'s owner is refused by BusinessGuard', async () => {
    await resetBizA('solo');
    const before = await businessRowText(ID.bizA);
    const body = formBody({ name: `${P}taken-over`, tagline: 'not mine', description: 'not mine', teamSize: '11-50' });
    for (const actor of [ID.staffW, ID.admin]) {
      const res = await patch(actor, ID.bizA, body);
      expect(res.status, actor).toBe(403);
      expect(res.body?.message).toBe('Only the business owner can edit the business profile');
      expect(await businessRowText(ID.bizA), `${actor} writes nothing`).toBe(before);
    }
    const other = await patch(ID.ownerB, ID.bizA, body);
    expect(other.status).toBe(403);
    expect(other.body?.message).not.toBe('Only the business owner can edit the business profile');
    expect(await businessRowText(ID.bizA)).toBe(before);

    const own = await patch(ID.owner, ID.bizA, body);
    expect(own.status).toBe(200);
    expect((await db.business.findUnique({ where: { id: ID.bizA }, select: { teamSize: true } }))?.teamSize).toBe('11-50');
  });
});
