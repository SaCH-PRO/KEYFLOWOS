/**
 * A route guard proves the CALLER belongs to the business. It cannot prove the
 * RECORD does, because the record id is a different parameter.
 *
 * Four handlers under `/ai/businesses/:businessId/ai/settings/...` took a
 * membershipId or staffId from the URL and wrote to it by bare id, without ever
 * binding the businessId sitting in their own path. BusinessGuard passes as
 * long as the caller names their OWN business, so any membership id in the
 * system was reachable from a request that looked entirely legitimate.
 *
 * Skills are not a label. A JobRole's skills sync into
 * `Membership.permissionScopes`, which is what decides the actions KEY may take
 * on that person's behalf.
 *
 * WHY MEMBERSHIP WAS THE LIVE ONE. StaffMember is in BUSINESS_ID_MODELS, so the
 * Prisma extension was already injecting businessId and refusing the write — as
 * a P2025 that reads like missing data rather than a refused breach. Membership
 * is in the ACKNOWLEDGED_UNSCOPED ledger, so nothing stood in the way at all.
 * That is the ledger's cost made concrete, and it is why these tests assert on
 * the SERVICE: the extension is inert off the HTTP path, where these methods
 * are equally callable.
 *
 * Skill itself has no businessId — a global catalogue with @@unique([name]) —
 * so the owner of the link is the only side there is to scope.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AiSettingsService } from './ai-settings.service';

const BIZ_A = 'biz_a';
const BIZ_B = 'biz_b';
const MEMBERSHIP_B = 'membership_owned_by_b';
const STAFF_B = 'staff_owned_by_b';
const SKILL = 'skill_global';

/** Honours its where-clause. A stub that did not could not test scoping. */
function makePrisma() {
  const memberships = [{ id: MEMBERSHIP_B, businessId: BIZ_B }];
  const staff = [{ id: STAFF_B, businessId: BIZ_B }];
  const match = (rows: Array<Record<string, unknown>>, where: Record<string, unknown>) =>
    rows.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v));

  return {
    client: {
      membership: {
        findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
          match(memberships, where)[0] ?? null,
        ),
        update: vi.fn(async () => ({})),
      },
      staffMember: {
        findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
          match(staff, where)[0] ?? null,
        ),
        update: vi.fn(async () => ({})),
      },
    },
  };
}

function makeService(prisma: ReturnType<typeof makePrisma>) {
  return new AiSettingsService(prisma as never);
}

describe('one business cannot change another business’s skills', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: AiSettingsService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = makeService(prisma);
  });

  it('assigning a skill to another business’s membership is refused', async () => {
    await expect(svc.assignSkillToMembership(BIZ_A, MEMBERSHIP_B, SKILL)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('and writes nothing — a refusal that still wrote would be no refusal', async () => {
    await svc.assignSkillToMembership(BIZ_A, MEMBERSHIP_B, SKILL).catch(() => undefined);
    expect(prisma.client.membership.update).not.toHaveBeenCalled();
  });

  it('removing a skill from another business’s membership is refused', async () => {
    await expect(svc.removeSkillFromMembership(BIZ_A, MEMBERSHIP_B, SKILL)).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.client.membership.update).not.toHaveBeenCalled();
  });

  it('assigning a skill to another business’s staff member is refused', async () => {
    await expect(svc.assignSkillToStaff(BIZ_A, STAFF_B, SKILL)).rejects.toThrow(NotFoundException);
    expect(prisma.client.staffMember.update).not.toHaveBeenCalled();
  });

  it('removing a skill from another business’s staff member is refused', async () => {
    await expect(svc.removeSkillFromStaff(BIZ_A, STAFF_B, SKILL)).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.client.staffMember.update).not.toHaveBeenCalled();
  });

  it('the owner can still do all four — scoping must not break the legitimate path', async () => {
    await expect(svc.assignSkillToMembership(BIZ_B, MEMBERSHIP_B, SKILL)).resolves.toEqual({
      success: true,
    });
    await expect(svc.removeSkillFromMembership(BIZ_B, MEMBERSHIP_B, SKILL)).resolves.toEqual({
      success: true,
    });
    await expect(svc.assignSkillToStaff(BIZ_B, STAFF_B, SKILL)).resolves.toEqual({ success: true });
    await expect(svc.removeSkillFromStaff(BIZ_B, STAFF_B, SKILL)).resolves.toEqual({
      success: true,
    });
    expect(prisma.client.membership.update).toHaveBeenCalledTimes(2);
    expect(prisma.client.staffMember.update).toHaveBeenCalledTimes(2);
  });

  it('the ownership check names the business, not just the record id', async () => {
    // Guards against a "fix" that looks up the row and forgets to compare
    // tenants — which is what the original code did one layer up.
    await svc.assignSkillToMembership(BIZ_B, MEMBERSHIP_B, SKILL);
    expect(prisma.client.membership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: MEMBERSHIP_B, businessId: BIZ_B } }),
    );
  });
});

/**
 * The controller half. The service cannot scope what it is never told, and the
 * original defect was precisely that businessId sat in the route path and was
 * never bound to a parameter.
 */
describe('the handlers bind the businessId in their own path', () => {
  const src = (() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('node:path');
    return fs.readFileSync(path.join(__dirname, 'ai-settings.controller.ts'), 'utf8');
  })();

  it('reads the controller — this gate is not vacuous', () => {
    expect(src.length, 'ai-settings.controller.ts not read').toBeGreaterThan(500);
  });

  for (const handler of [
    'assignSkillToMembership',
    'removeSkillFromMembership',
    'assignSkillToStaff',
    'removeSkillFromStaff',
  ]) {
    it(`${handler} passes businessId through to the service`, () => {
      const at = src.indexOf(`async ${handler}(`);
      expect(at, `${handler} not found`).toBeGreaterThan(-1);
      const body = src.slice(at, src.indexOf('}', src.indexOf('return', at)));
      expect(body, 'the handler must bind businessId from the path').toContain(
        "@Param('businessId')",
      );
      // A plain substring, deliberately: the point is that businessId is the
      // FIRST thing handed over, and a regex here was its own small bug.
      expect(body, 'and actually hand it to the service').toContain(
        `aiSettings.${handler}(businessId`,
      );
    });
  }
});

/**
 * Skill is a GLOBAL catalogue reached through a per-business route, so deleting
 * one is a shared-resource question rather than a tenancy one: the row belongs
 * to everybody, and removing it detaches it from every membership and staff
 * member on the instance — in businesses the caller cannot see.
 *
 * The rule is therefore "is anyone ELSE relying on it", not "is this yours".
 */
describe('deleting from the shared skill catalogue', () => {
  const OTHER = 'biz_someone_else';

  function prismaWith(holders: { memberships: string[]; staffMembers: string[] }) {
    return {
      client: {
        skill: {
          findUnique: vi.fn(async () => ({
            id: SKILL,
            name: 'Welding',
            memberships: holders.memberships.map((businessId) => ({ businessId })),
            staffMembers: holders.staffMembers.map((businessId) => ({ businessId })),
          })),
          delete: vi.fn(async () => ({})),
        },
      },
    };
  }

  it('refuses when another business has it assigned to someone', async () => {
    const prisma = prismaWith({ memberships: [BIZ_A, OTHER], staffMembers: [] });
    const svc = new AiSettingsService(prisma as never);
    await expect(svc.deleteSkill(BIZ_A, SKILL)).rejects.toThrow(BadRequestException);
    expect(prisma.client.skill.delete).not.toHaveBeenCalled();
  });

  it('counts staff members too, not only memberships', async () => {
    // Two relations point at Skill. Checking one and forgetting the other is
    // the obvious way to half-fix this.
    const prisma = prismaWith({ memberships: [], staffMembers: [OTHER] });
    const svc = new AiSettingsService(prisma as never);
    await expect(svc.deleteSkill(BIZ_A, SKILL)).rejects.toThrow(BadRequestException);
    expect(prisma.client.skill.delete).not.toHaveBeenCalled();
  });

  it('allows it when only the caller’s own business uses it', async () => {
    const prisma = prismaWith({ memberships: [BIZ_A], staffMembers: [BIZ_A] });
    const svc = new AiSettingsService(prisma as never);
    await expect(svc.deleteSkill(BIZ_A, SKILL)).resolves.toEqual({ deleted: true });
    expect(prisma.client.skill.delete).toHaveBeenCalled();
  });

  it('allows it when nobody uses it at all', async () => {
    const prisma = prismaWith({ memberships: [], staffMembers: [] });
    const svc = new AiSettingsService(prisma as never);
    await expect(svc.deleteSkill(BIZ_A, SKILL)).resolves.toEqual({ deleted: true });
  });

  it('says who is holding it, so the message is actionable', async () => {
    const prisma = prismaWith({ memberships: [OTHER, 'biz_third'], staffMembers: [] });
    const svc = new AiSettingsService(prisma as never);
    await expect(svc.deleteSkill(BIZ_A, SKILL)).rejects.toThrow(/2 other businesses/);
  });
});
