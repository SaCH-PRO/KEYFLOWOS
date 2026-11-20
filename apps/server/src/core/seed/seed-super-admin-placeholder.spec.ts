/**
 * FU-SEED-SUPERADMIN-PLACEHOLDER (V1-71, SEC-V63-1): the super-admin seed never
 * promotes a team-invite placeholder.
 *
 * RED-BEFORE: SeedService.seedSuperAdmin promoted any users row whose email equals
 * SUPER_ADMIN_EMAIL, the placeholder inviteTeamMember makes for an address with no
 * account included (meta_data.invitePlaceholder true). Bootstrap adopts a placeholder
 * only while its role is USER (assertAdoptableInvitePlaceholder), so the admin's first
 * sign-in got 409 account_email_in_use. Required: the seed skips a placeholder row and
 * writes nothing to it; every other row is promoted as before (R0-09, whose cases in
 * seed.service.spec.ts stay as they are); the seed's log never carries the address.
 *
 * Pure: an in-memory User table stands in for Prisma. Unlike the R0-09 fake, this one
 * honours `select`, so a promotion decided on a column the query did not read fails
 * here. The real-database proof through the HTTP routes is
 * test/seed-super-admin-placeholder.integration.test.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SeedService } from './seed.service';
import { IdentityService } from '../../modules/identity/identity.service';

const ADMIN = ['ops', '@', 'example.test'].join('');

type Row = { id: string; email: string; role: string; metaData: unknown };

function fakeUsers(rows: Row[]) {
  const table = new Map(rows.map((r) => [r.email, { ...r }]));
  const calls: Array<{ method: string; args: unknown }> = [];
  const project = (row: Row, select?: Record<string, boolean>) =>
    select ? Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k as keyof Row]])) : { ...row };
  const byWhere = (where: { email?: string; id?: string }) =>
    where.email !== undefined ? table.get(where.email) : [...table.values()].find((r) => r.id === where.id);
  const user = {
    findUnique: vi.fn(async (args: { where: { email?: string; id?: string }; select?: Record<string, boolean> }) => {
      calls.push({ method: 'findUnique', args });
      const row = byWhere(args.where);
      return row ? project(row, args.select) : null;
    }),
    findFirst: vi.fn(async (args: { where: { email?: string; id?: string }; select?: Record<string, boolean> }) => {
      calls.push({ method: 'findFirst', args });
      const row = byWhere(args.where);
      return row ? project(row, args.select) : null;
    }),
    update: vi.fn(async (args: { where: { email?: string; id?: string }; data: Partial<Row> }) => {
      calls.push({ method: 'update', args });
      const row = byWhere(args.where);
      if (!row) throw new Error('Record to update not found');
      Object.assign(row, args.data);
      return { ...row };
    }),
    updateMany: vi.fn(async (args: unknown) => {
      calls.push({ method: 'updateMany', args });
      throw new Error('not expected');
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
  const rowOf = (email: string) => table.get(email);
  const writes = () => calls.filter((c) => !['findUnique', 'findFirst'].includes(c.method));
  return { prisma: { client: { user } }, calls, writes, rowOf };
}

function seedWith(rows: Row[]) {
  const fake = fakeUsers(rows);
  const service = new SeedService(fake.prisma as never, {} as never, {} as never);
  const logged: string[] = [];
  const record = (message: unknown) => {
    logged.push(String(message));
  };
  (service as unknown as { logger: unknown }).logger = { log: record, warn: record, error: record, debug: record, verbose: record };
  return { service, logged, ...fake };
}

/** A placeholder exactly as inviteTeamMember writes it for an address with no account. */
const placeholder = (role = 'USER'): Row => ({ id: 'u_placeholder', email: ADMIN, role, metaData: { invitePlaceholder: true } });

/** IdentityService's own test for the invite marker (private): the seed must agree with it. */
const identityCallsItAPlaceholder = (metaData: unknown): boolean =>
  (IdentityService as unknown as { isMarkedInvitePlaceholder: (m: unknown) => boolean }).isMarkedInvitePlaceholder(metaData);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SeedService.seedSuperAdmin — an invite placeholder is never promoted (V1-71 FU-SEED-SUPERADMIN-PLACEHOLDER)', () => {
  it('[V71C-U01] RED-BEFORE: the row SUPER_ADMIN_EMAIL names is an invite placeholder: it stays a USER and nothing is written', async () => {
    const { service, writes, rowOf } = seedWith([placeholder()]);
    await service.seedSuperAdmin({ SUPER_ADMIN_EMAIL: ADMIN });
    expect(writes()).toEqual([]);
    expect(rowOf(ADMIN)).toEqual(placeholder());
  });

  it('[V71C-U02] RED-BEFORE: on every boot: three runs, still a USER, no write', async () => {
    const { service, writes, rowOf } = seedWith([placeholder()]);
    for (let boot = 0; boot < 3; boot++) await service.seedSuperAdmin({ SUPER_ADMIN_EMAIL: ` ${ADMIN} ` });
    expect(writes()).toEqual([]);
    expect(rowOf(ADMIN)?.role).toBe('USER');
  });

  it('[V71C-U03] once a sign-in has adopted it (the row under the address has no marker), the next run promotes it as today', async () => {
    const { service, writes, rowOf } = seedWith([{ id: 'u_admin_sub', email: ADMIN, role: 'USER', metaData: null }]);
    await service.seedSuperAdmin({ SUPER_ADMIN_EMAIL: ADMIN });
    expect(rowOf(ADMIN)?.role).toBe('SUPER_ADMIN');
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({ method: 'update', args: { where: { id: 'u_admin_sub' }, data: { role: 'SUPER_ADMIN' } } });
  });

  it('[V71C-U04] RED-BEFORE: the seed and IdentityService agree on what a placeholder is: exactly the rows bootstrap would adopt are skipped', async () => {
    const metaDatas: unknown[] = [
      { invitePlaceholder: true },
      { invitePlaceholder: true, note: 'x' },
      { invitePlaceholder: false },
      { invitePlaceholder: 'true' },
      { invitePlaceholder: 1 },
      { other: true },
      {},
      null,
      undefined,
      [],
      'invitePlaceholder',
    ];
    for (const metaData of metaDatas) {
      const { service, rowOf } = seedWith([{ id: 'u_row', email: ADMIN, role: 'USER', metaData }]);
      await service.seedSuperAdmin({ SUPER_ADMIN_EMAIL: ADMIN });
      const expected = identityCallsItAPlaceholder(metaData) ? 'USER' : 'SUPER_ADMIN';
      expect(rowOf(ADMIN)?.role, `metaData ${JSON.stringify(metaData)}`).toBe(expected);
    }
  });

  it('[V71C-U05] a placeholder an earlier seed already promoted is not written either: the seed only ever promotes', async () => {
    const { service, writes, rowOf } = seedWith([placeholder('SUPER_ADMIN')]);
    await service.seedSuperAdmin({ SUPER_ADMIN_EMAIL: ADMIN });
    expect(writes()).toEqual([]);
    expect(rowOf(ADMIN)?.role).toBe('SUPER_ADMIN');
  });

  it('[V71C-U06] RED-BEFORE: what the seed logs says why it skipped, and never carries the address in any letter case', async () => {
    for (const row of [placeholder(), placeholder('SUPER_ADMIN'), { id: 'u_admin_sub', email: ADMIN, role: 'USER', metaData: null }]) {
      const { service, logged } = seedWith([row]);
      await service.seedSuperAdmin({ SUPER_ADMIN_EMAIL: ADMIN });
      expect(logged.length).toBeGreaterThan(0);
      expect(logged.filter((line) => line.toLowerCase().includes(ADMIN))).toEqual([]);
    }
    const { service, logged } = seedWith([placeholder()]);
    await service.seedSuperAdmin({ SUPER_ADMIN_EMAIL: ADMIN });
    expect(logged.join('\n')).toMatch(/invit/i);
  });

  it('[V71C-U07] the address is still matched exactly as R0-09 matches it: a placeholder under another address is not looked at', async () => {
    const { service, writes, calls } = seedWith([placeholder(), { id: 'u_other', email: 'other@example.test', role: 'USER', metaData: null }]);
    await service.seedSuperAdmin({ SUPER_ADMIN_EMAIL: 'other@example.test' });
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({ method: 'update', args: { where: { id: 'u_other' } } });
    expect(calls.filter((c) => c.method === 'findUnique').map((c) => (c.args as { where: unknown }).where)).toEqual([{ email: 'other@example.test' }]);
  });
});
