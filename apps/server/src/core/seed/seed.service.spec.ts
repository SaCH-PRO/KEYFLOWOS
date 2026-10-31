/**
 * R0-09-ID-HARDEN — SUPER_ADMIN promotion on boot is gated on SUPER_ADMIN_EMAIL.
 *
 * RED-BEFORE: SeedService.seedSuperAdmin promoted the hard-coded address
 * keyflowos.tt@gmail.com to SUPER_ADMIN — a role AuthGuard, BusinessGuard and
 * ModuleScopeGuard all bypass — on every onApplicationBootstrap, in every
 * environment, whenever a User row with that email existed. It created nobody,
 * and no environment variable could turn it off or point it elsewhere.
 *
 * Required (BUILD-QUEUE-001 R0-09, D-11):
 *   - SUPER_ADMIN_EMAIL unset (or blank): nobody is promoted, and no User row is
 *     even looked up — the hard-coded address included;
 *   - set: exactly that email is promoted, once; nobody else is touched; a
 *     missing row is not created.
 *
 * The variable is read through an `env` parameter (process.env by default), the
 * way R0-D6 read LISTEN_HOST, so these cases need no process-global stubbing
 * except the one that proves the boot path reads process.env.
 *
 * Pure: an in-memory User table stands in for Prisma. The real-database proof
 * is test/identity-business-config.integration.test.ts (S01-S03).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SeedService } from './seed.service';

const LEGACY_HARD_CODED = 'keyflowos.tt@gmail.com';

type Row = { id: string; email: string; role: string };

function fakeUsers(rows: Row[]) {
  const table = new Map(rows.map((r) => [r.email, { ...r }]));
  const calls: Array<{ method: string; args: unknown }> = [];
  const user = {
    findUnique: vi.fn(async (args: { where: { email?: string; id?: string } }) => {
      calls.push({ method: 'findUnique', args });
      const { email, id } = args.where;
      const row = email !== undefined ? table.get(email) : [...table.values()].find((r) => r.id === id);
      return row ? { ...row } : null;
    }),
    findFirst: vi.fn(async (args: { where: { email?: string } }) => {
      calls.push({ method: 'findFirst', args });
      const row = args.where.email !== undefined ? table.get(args.where.email) : undefined;
      return row ? { ...row } : null;
    }),
    update: vi.fn(async (args: { where: { email?: string; id?: string }; data: { role?: string } }) => {
      calls.push({ method: 'update', args });
      const { email, id } = args.where;
      const row = email !== undefined ? table.get(email) : [...table.values()].find((r) => r.id === id);
      if (!row) throw new Error('Record to update not found');
      Object.assign(row, args.data);
      return { ...row };
    }),
    create: vi.fn(async (args: unknown) => {
      calls.push({ method: 'create', args });
      throw new Error('the super admin seed must never create a user');
    }),
    upsert: vi.fn(async (args: unknown) => {
      calls.push({ method: 'upsert', args });
      throw new Error('the super admin seed must never upsert a user');
    }),
  };
  const roleOf = (email: string) => table.get(email)?.role;
  const writes = () => calls.filter((c) => !['findUnique', 'findFirst'].includes(c.method));
  return { prisma: { client: { user } }, calls, writes, roleOf };
}

function seedWith(rows: Row[]) {
  const fake = fakeUsers(rows);
  const service = new SeedService(fake.prisma as never, {} as never, {} as never);
  return { service, ...fake };
}

const ROWS: Row[] = [
  { id: 'u_legacy', email: LEGACY_HARD_CODED, role: 'USER' },
  { id: 'u_ops', email: 'ops@example.test', role: 'USER' },
  { id: 'u_other', email: 'other@example.test', role: 'USER' },
];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('SeedService.seedSuperAdmin — SUPER_ADMIN_EMAIL gate (R0-09)', () => {
  it('[R0-09-U01] RED-BEFORE: unset, nobody is promoted and no User row is looked up — the formerly hard-coded address included', async () => {
    const { service, calls, roleOf } = seedWith(ROWS);
    await service.seedSuperAdmin({});
    expect(calls).toEqual([]);
    expect(roleOf(LEGACY_HARD_CODED)).toBe('USER');
    expect(roleOf('ops@example.test')).toBe('USER');
  });

  it('[R0-09-U02] RED-BEFORE: a blank or whitespace-only value counts as unset', async () => {
    const { service, calls, roleOf } = seedWith(ROWS);
    await service.seedSuperAdmin({ SUPER_ADMIN_EMAIL: '' });
    await service.seedSuperAdmin({ SUPER_ADMIN_EMAIL: '   ' });
    expect(calls).toEqual([]);
    expect(roleOf(LEGACY_HARD_CODED)).toBe('USER');
  });

  it('[R0-09-U03] RED-BEFORE: set, exactly that email is promoted and nobody else is touched', async () => {
    const { service, writes, roleOf } = seedWith(ROWS);
    await service.seedSuperAdmin({ SUPER_ADMIN_EMAIL: 'ops@example.test' });
    expect(roleOf('ops@example.test')).toBe('SUPER_ADMIN');
    expect(roleOf(LEGACY_HARD_CODED)).toBe('USER');
    expect(roleOf('other@example.test')).toBe('USER');
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({ method: 'update', args: { data: { role: 'SUPER_ADMIN' } } });
  });

  it('[R0-09-U04] RED-BEFORE: surrounding whitespace in the value is ignored', async () => {
    const { service, roleOf } = seedWith(ROWS);
    await service.seedSuperAdmin({ SUPER_ADMIN_EMAIL: '  ops@example.test\n' });
    expect(roleOf('ops@example.test')).toBe('SUPER_ADMIN');
    expect(roleOf(LEGACY_HARD_CODED)).toBe('USER');
  });

  it('[R0-09-U05] set to the formerly hard-coded address, that address is promoted like any other: the gate is the variable, not the literal', async () => {
    const { service, roleOf } = seedWith(ROWS);
    await service.seedSuperAdmin({ SUPER_ADMIN_EMAIL: LEGACY_HARD_CODED });
    expect(roleOf(LEGACY_HARD_CODED)).toBe('SUPER_ADMIN');
    expect(roleOf('ops@example.test')).toBe('USER');
  });

  it('[R0-09-U06] set to an email with no User row, nobody is created or promoted', async () => {
    const { service, writes, roleOf } = seedWith(ROWS);
    await service.seedSuperAdmin({ SUPER_ADMIN_EMAIL: 'nobody@example.test' });
    expect(writes()).toEqual([]);
    expect(roleOf(LEGACY_HARD_CODED)).toBe('USER');
  });

  it('[R0-09-U07] a user who is already SUPER_ADMIN is not written again', async () => {
    const { service, writes } = seedWith([{ id: 'u_ops', email: 'ops@example.test', role: 'SUPER_ADMIN' }]);
    await service.seedSuperAdmin({ SUPER_ADMIN_EMAIL: 'ops@example.test' });
    expect(writes()).toEqual([]);
  });

  it('[R0-09-U08] a failed promotion is logged, not thrown, so boot continues', async () => {
    const { service, prisma } = seedWith(ROWS);
    prisma.client.user.update.mockRejectedValueOnce(new Error('db down'));
    await expect(service.seedSuperAdmin({ SUPER_ADMIN_EMAIL: 'ops@example.test' })).resolves.toBeUndefined();
  });
});

describe('SeedService.onApplicationBootstrap — the boot path reads SUPER_ADMIN_EMAIL from process.env (R0-09)', () => {
  /** Every other seeder is stubbed: only the super admin step runs against the fake table. */
  function bootable(rows: Row[]) {
    const seeded = seedWith(rows);
    for (const step of ['seedTemplates', 'seedCourses', 'seedCohorts', 'seedDocumentTaxonomy', 'seedDevUser']) {
      vi.spyOn(seeded.service as never, step as never).mockResolvedValue(undefined as never);
    }
    return seeded;
  }

  it('[R0-09-U09] RED-BEFORE: boot with SUPER_ADMIN_EMAIL unset promotes nobody, though the formerly hard-coded user exists', async () => {
    vi.stubEnv('SUPER_ADMIN_EMAIL', '');
    const { service, calls, roleOf } = bootable(ROWS);
    await service.onApplicationBootstrap();
    expect(roleOf(LEGACY_HARD_CODED)).toBe('USER');
    expect(calls).toEqual([]);
  });

  it('[R0-09-U10] RED-BEFORE: boot with SUPER_ADMIN_EMAIL set promotes exactly that user', async () => {
    vi.stubEnv('SUPER_ADMIN_EMAIL', 'ops@example.test');
    const { service, roleOf } = bootable(ROWS);
    await service.onApplicationBootstrap();
    expect(roleOf('ops@example.test')).toBe('SUPER_ADMIN');
    expect(roleOf(LEGACY_HARD_CODED)).toBe('USER');
    expect(roleOf('other@example.test')).toBe('USER');
  });
});
