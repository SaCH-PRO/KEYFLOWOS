import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { SettingsAdapterService } from './settings-adapter.service';
import { IdentityService } from '../../identity/identity.service';
import { IntegrationHubService } from '../../integration-hub/integration-hub.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ConnectorCommand } from '../key-cortex-connector.types';

const mkCmd = (action: string, parameters: Record<string, unknown> = {}): ConnectorCommand => ({
  module: 'settings',
  action,
  parameters,
  businessId: 'biz_123',
  userId: 'user_456',
  source: 'key_cortex',
  timestamp: new Date(),
  correlationId: 'corr_001',
});

describe('SettingsAdapterService', () => {
  let service: SettingsAdapterService;
  let identity: IdentityService;
  let integrations: IntegrationHubService;
  let prisma: PrismaService;

  beforeEach(() => {
    identity = {
      getBusiness: vi.fn(),
      // The command's actor (user_456) passes the D-11 owner rule in these delegation cases.
      assertBusinessOwner: vi.fn().mockResolvedValue(undefined),
      updateBusiness: vi.fn(),
      inviteTeamMember: vi.fn(),
      removeTeamMember: vi.fn(),
      updateMemberRole: vi.fn(),
    } as unknown as IdentityService;

    integrations = {
      createConnection: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as IntegrationHubService;

    prisma = {
      client: {
        // The command's actor holds connect:write, which configure_integration needs (R0-09c review ST-6).
        membership: { findFirst: vi.fn(), findUnique: vi.fn().mockResolvedValue({ role: 'ADMIN', permissionScopes: { connect: 'write' } }) },
        user: { findUnique: vi.fn().mockResolvedValue({ role: 'USER' }) },
      },
    } as unknown as PrismaService;

    service = new SettingsAdapterService(identity, integrations, prisma);
  });

  it('update_business_profile delegates to identity.updateBusiness', async () => {
    (identity.updateBusiness as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'biz_123', name: 'Acme' });
    const result = await service.execute(mkCmd('update_business_profile', { name: 'Acme', timezone: 'UTC' }));
    expect(result.success).toBe(true);
    expect(identity.updateBusiness).toHaveBeenCalledWith('biz_123', expect.objectContaining({ name: 'Acme', timezone: 'UTC' }));
  });

  it('update_branding delegates to identity.updateBusiness', async () => {
    (identity.updateBusiness as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'biz_123', primaryColor: '#000' });
    const result = await service.execute(mkCmd('update_branding', { primaryColor: '#000', logoUrl: 'https://logo.png' }));
    expect(result.success).toBe(true);
    expect(identity.updateBusiness).toHaveBeenCalledWith('biz_123', expect.objectContaining({ primaryColor: '#000', logoUrl: 'https://logo.png' }));
  });

  it('add_team_member delegates to identity.inviteTeamMember', async () => {
    (identity.inviteTeamMember as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'mem_1' });
    const result = await service.execute(mkCmd('add_team_member', { email: 'a@example.com', role: 'STAFF' }));
    expect(result.success).toBe(true);
    expect(identity.inviteTeamMember).toHaveBeenCalledWith('biz_123', 'a@example.com', 'STAFF', 'user_456');
  });

  it('remove_team_member resolves userId to membership', async () => {
    (prisma.client.membership.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'mem_1', userId: 'usr_1' });
    (identity.removeTeamMember as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
    const result = await service.execute(mkCmd('remove_team_member', { userId: 'usr_1' }));
    expect(result.success).toBe(true);
    expect(identity.removeTeamMember).toHaveBeenCalledWith('biz_123', 'mem_1', 'user_456');
  });

  it('update_role resolves userId to membership', async () => {
    (prisma.client.membership.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'mem_1', userId: 'usr_1' });
    (identity.updateMemberRole as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'mem_1', role: 'ADMIN' });
    const result = await service.execute(mkCmd('update_role', { userId: 'usr_1', role: 'ADMIN' }));
    expect(result.success).toBe(true);
    expect(identity.updateMemberRole).toHaveBeenCalledWith('biz_123', 'mem_1', 'ADMIN', 'user_456');
  });

  it('configure_integration creates a connection when enabled', async () => {
    (integrations.createConnection as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'conn_1' });
    const result = await service.execute(mkCmd('configure_integration', { integration: 'stripe', config: { key: 'x' } }));
    expect(result.success).toBe(true);
    expect(integrations.createConnection).toHaveBeenCalledWith('biz_123', 'stripe', expect.objectContaining({ settings: { key: 'x' } }));
  });

  it('configure_integration disconnects when disabled', async () => {
    (integrations.disconnect as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const result = await service.execute(mkCmd('configure_integration', { integration: 'stripe', enabled: false }));
    expect(result.success).toBe(true);
    expect(integrations.disconnect).toHaveBeenCalledWith('biz_123', 'stripe');
  });

  it('getBusinessProfile delegates to identity.getBusiness', async () => {
    (identity.getBusiness as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'biz_123' });
    const result = await service.getBusinessProfile('biz_123');
    expect(result).toEqual({ id: 'biz_123' });
  });

  it('returns connectorFail for unknown action', async () => {
    const result = await service.execute(mkCmd('nonexistent'));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown settings action');
  });
});

/**
 * R0-09c-KEY-ACTOR-BINDING (R0-09-ID-HARDEN review CR-3), owner ruling D-11:
 * editing the business profile is OWNER only, regardless of granted scopes.
 * settings.update_business_profile and settings.update_branding reached
 * IdentityService.updateBusiness with no owner check, so a STAFF command changed
 * the name, timezone, currency and branding the PATCH route refuses it. The
 * adapter applies IdentityService.assertBusinessOwner on the command's actor
 * (command.userId, with the role its User row holds, as AuthMiddleware attaches
 * it) and answers the connector failure shape when the rule refuses.
 *
 * This block runs the REAL IdentityService.assertBusinessOwner (updateBusiness
 * is a spy) over a Prisma stand-in holding one business: an OWNER membership,
 * an ADMIN and a STAFF member, the recorded owner (Business.ownerId) holding an
 * ADMIN membership (or, in one case, none), and a SUPER_ADMIN with none. The
 * stand-in honours the recorded-owner lookup's members filter, its role
 * included (owner rulings D-104, D-116).
 */
describe('SettingsAdapterService — the D-11 owner rule on the command actor (R0-09c, review CR-3)', () => {
  const BIZ = 'biz_d11';
  // Owner ruling D-116: the recorded owner (owner_by_id, Business.ownerId) holds only an ADMIN membership.
  const SEEDED_MEMBERSHIPS: Record<string, string> = { owner_member: 'OWNER', admin_member: 'ADMIN', staff_member: 'STAFF', owner_by_id: 'ADMIN' };
  let MEMBERSHIPS: Record<string, string>;
  const USERS: Record<string, string> = {
    owner_member: 'USER', admin_member: 'USER', staff_member: 'USER', owner_by_id: 'USER', outsider: 'USER', platform: 'SUPER_ADMIN',
  };
  const OWNER_ONLY = new ForbiddenException('Only the business owner can edit the business profile').message;
  let service: SettingsAdapterService;
  let identity: IdentityService;
  let updateBusiness: ReturnType<typeof vi.spyOn>;
  let prisma: any;

  const cmd = (action: string, userId: unknown, parameters: Record<string, unknown>): ConnectorCommand => ({
    module: 'settings', action, parameters, businessId: BIZ, userId: userId as string,
    source: 'key_cortex', timestamp: new Date(), correlationId: 'corr_d11',
  });
  const PROFILE = { name: 'Hijacked', timezone: 'Pacific/Kiritimati', currency: 'JPY' };
  const BRANDING = { primaryColor: '#ff0000', logoUrl: 'https://x.test/hijack.png', emailSignature: 'hijack' };

  beforeEach(() => {
    MEMBERSHIPS = { ...SEEDED_MEMBERSHIPS };
    prisma = {
      client: {
        membership: {
          findUnique: vi.fn(async ({ where }: any) => {
            const { userId, businessId } = where.userId_businessId;
            return businessId === BIZ && MEMBERSHIPS[userId] ? { role: MEMBERSHIPS[userId] } : null;
          }),
          findFirst: vi.fn(),
        },
        business: {
          // Business.ownerId is owner_by_id; the members filter is honoured, its role included (D-104, D-116).
          findFirst: vi.fn(async ({ where }: any) => {
            if (where.id !== BIZ || where.ownerId !== 'owner_by_id') return null;
            const some = where.members?.some;
            if (some && (!MEMBERSHIPS[some.userId] || (some.role !== undefined && MEMBERSHIPS[some.userId] !== some.role))) return null;
            return { id: BIZ };
          }),
        },
        user: {
          findUnique: vi.fn(async ({ where }: any) => (USERS[where.id] ? { role: USERS[where.id] } : null)),
        },
      },
    };
    identity = new IdentityService(prisma, {} as any, {} as any);
    updateBusiness = vi.spyOn(identity, 'updateBusiness').mockResolvedValue({ id: BIZ } as any);
    service = new SettingsAdapterService(identity, {} as IntegrationHubService, prisma as PrismaService);
  });

  for (const [action, parameters] of [['update_business_profile', PROFILE], ['update_branding', BRANDING]] as const) {
    it(`RED-BEFORE: a STAFF actor's ${action} is refused with the connector failure shape and never reaches updateBusiness`, async () => {
      const command = cmd(action, 'staff_member', parameters);
      const result = await service.execute(command);
      expect(result).toMatchObject({ success: false, error: OWNER_ONLY, command });
      expect(updateBusiness).not.toHaveBeenCalled();
    });

    it(`RED-BEFORE: an ADMIN actor's ${action} is refused too: owner-only, not role- or scope-gated`, async () => {
      const result = await service.execute(cmd(action, 'admin_member', parameters));
      expect(result).toMatchObject({ success: false, error: OWNER_ONLY });
      expect(updateBusiness).not.toHaveBeenCalled();
    });

    it(`RED-BEFORE: an actor with no membership of the business is refused ${action}`, async () => {
      const result = await service.execute(cmd(action, 'outsider', parameters));
      expect(result).toMatchObject({ success: false, error: OWNER_ONLY });
      expect(updateBusiness).not.toHaveBeenCalled();
    });

    it(`RED-BEFORE: a command with no human actor (missing, empty, 'system' or KEY's own 'key_ai') is refused ${action}`, async () => {
      for (const actor of [undefined, '', 'system', 'key_ai']) {
        const result = await service.execute(cmd(action, actor, parameters));
        expect(result, String(actor)).toMatchObject({ success: false, error: OWNER_ONLY });
      }
      expect(updateBusiness).not.toHaveBeenCalled();
      // A missing actor is refused before any lookup is made with it.
      for (const [args] of prisma.client.membership.findUnique.mock.calls) {
        expect(args.where.userId_businessId.userId).toEqual(expect.any(String));
        expect(args.where.userId_businessId.userId).not.toBe('');
      }
    });

    it(`the OWNER (membership) and SUPER_ADMIN pass the rule and ${action} reaches updateBusiness; the recorded owner (Business.ownerId) with no membership or only an ADMIN membership is refused and updateBusiness is not called (owner rulings D-104, D-116)`, async () => {
      for (const actor of ['owner_member', 'platform']) {
        const result = await service.execute(cmd(action, actor, parameters));
        expect(result.success, actor).toBe(true);
      }
      expect(updateBusiness).toHaveBeenCalledTimes(2);
      for (const [businessId] of updateBusiness.mock.calls) expect(businessId).toBe(BIZ);

      // Owner ruling D-116: the recorded owner holding only ADMIN is an ADMIN; with no membership row, no member.
      updateBusiness.mockClear();
      const asAdmin = await service.execute(cmd(action, 'owner_by_id', parameters));
      expect(asAdmin, 'the recorded owner holding ADMIN').toMatchObject({ success: false, error: OWNER_ONLY });
      delete MEMBERSHIPS.owner_by_id;
      const asNone = await service.execute(cmd(action, 'owner_by_id', parameters));
      expect(asNone, 'the recorded owner with no membership').toMatchObject({ success: false, error: OWNER_ONLY });
      expect(updateBusiness).not.toHaveBeenCalled();
    });
  }

  it('RED-BEFORE: the rule is IdentityService.assertBusinessOwner, applied on the command actor with its User role', async () => {
    const assertOwner = vi.spyOn(identity, 'assertBusinessOwner');
    await service.execute(cmd('update_business_profile', 'platform', PROFILE));
    await service.execute(cmd('update_branding', 'staff_member', BRANDING));
    expect(assertOwner.mock.calls).toEqual([
      [BIZ, { id: 'platform', role: 'SUPER_ADMIN' }],
      [BIZ, { id: 'staff_member', role: 'USER' }],
    ]);
  });

  it('the other settings actions keep their own authority checks and are not owner-gated here', async () => {
    const assertOwner = vi.spyOn(identity, 'assertBusinessOwner');
    const invite = vi.spyOn(identity, 'inviteTeamMember').mockResolvedValue({ id: 'mem_new' } as any);
    const result = await service.execute(cmd('add_team_member', 'admin_member', { email: 'a@example.com', role: 'STAFF' }));
    expect(result.success).toBe(true);
    expect(invite).toHaveBeenCalledWith(BIZ, 'a@example.com', 'STAFF', 'admin_member');
    expect(assertOwner).not.toHaveBeenCalled();
  });
});

/**
 * R0-09c review CR-1: remove_team_member and update_role looked their target up
 * with membership.findFirst({ where: { userId: parameters.userId, businessId } }),
 * and Prisma drops a key whose value is undefined, so a command with no
 * parameters.userId matched whichever membership of the business came back
 * first. The executor's compensation for a failed add_team_member is exactly
 * such a command (remove_team_member with the add's {email, role}). Now a
 * missing or non-string target is refused before any lookup, and nothing
 * reaches IdentityService.
 */
describe('SettingsAdapterService — a team command names its target member (R0-09c review CR-1)', () => {
  let service: SettingsAdapterService;
  let identity: any;
  let prisma: any;

  const cmd = (action: string, parameters: Record<string, unknown>): ConnectorCommand => ({
    module: 'settings', action, parameters, businessId: 'biz_cr1', userId: 'owner_cr1',
    source: 'key_cortex', timestamp: new Date(), correlationId: 'corr_cr1',
  });

  beforeEach(() => {
    identity = { removeTeamMember: vi.fn().mockResolvedValue({ success: true }), updateMemberRole: vi.fn().mockResolvedValue({ id: 'mem_any' }) };
    // Like Postgres for a where clause Prisma has reduced to { businessId }, the stand-in answers some membership.
    prisma = { client: { membership: { findFirst: vi.fn().mockResolvedValue({ id: 'mem_any', userId: 'whoever' }) } } };
    service = new SettingsAdapterService(identity, {} as IntegrationHubService, prisma as PrismaService);
  });

  it("RED-BEFORE: remove_team_member and update_role with no parameters.userId (the add_team_member compensation's {email, role}) are refused and nothing is looked up, removed or re-roled", async () => {
    for (const [action, parameters] of [
      ['remove_team_member', { email: 'staff@example.com', role: 'STAFF' }],
      ['update_role', { role: 'STAFF' }],
    ] as const) {
      const result = await service.execute(cmd(action, parameters));
      expect(result, action).toMatchObject({ success: false, error: `settings.${action} needs parameters.userId, the member to change` });
    }
    expect(prisma.client.membership.findFirst).not.toHaveBeenCalled();
    expect(identity.removeTeamMember).not.toHaveBeenCalled();
    expect(identity.updateMemberRole).not.toHaveBeenCalled();
  });

  it('RED-BEFORE: an empty or non-string parameters.userId is refused the same way', async () => {
    for (const userId of ['', null, 42, { not: 'x' }, ['usr_1']]) {
      for (const action of ['remove_team_member', 'update_role']) {
        const result = await service.execute(cmd(action, { userId, role: 'STAFF' }));
        expect(result, `${action} ${JSON.stringify(userId)}`).toMatchObject({ success: false });
      }
    }
    expect(prisma.client.membership.findFirst).not.toHaveBeenCalled();
    expect(identity.removeTeamMember).not.toHaveBeenCalled();
    expect(identity.updateMemberRole).not.toHaveBeenCalled();
  });

  it('a named target is looked up by that userId in the command business, as before', async () => {
    await service.execute(cmd('remove_team_member', { userId: 'usr_target' }));
    await service.execute(cmd('update_role', { userId: 'usr_target', role: 'ADMIN' }));
    expect(prisma.client.membership.findFirst.mock.calls.map(([args]: any[]) => args.where)).toEqual([
      { userId: 'usr_target', businessId: 'biz_cr1' },
      { userId: 'usr_target', businessId: 'biz_cr1' },
    ]);
    expect(identity.removeTeamMember).toHaveBeenCalledWith('biz_cr1', 'mem_any', 'owner_cr1');
    expect(identity.updateMemberRole).toHaveBeenCalledWith('biz_cr1', 'mem_any', 'ADMIN', 'owner_cr1');
  });
});

/**
 * R0-09c review ST-6: settings.configure_integration connected and disconnected
 * integrations with no authority check, while the HTTP routes admit only
 * connect:write (ModuleScopeGuard; connect is 'none' for every role by
 * default). The adapter applies ModuleScopeGuard's rule on the command actor.
 */
describe('SettingsAdapterService — configure_integration needs connect:write, as the HTTP route does (R0-09c review ST-6)', () => {
  const BIZ = 'biz_st6';
  const MEMBERSHIPS: Record<string, { role: string; permissionScopes: unknown }> = {
    owner_default: { role: 'OWNER', permissionScopes: null },
    admin_default: { role: 'ADMIN', permissionScopes: null },
    staff_default: { role: 'STAFF', permissionScopes: null },
    admin_settings_write: { role: 'ADMIN', permissionScopes: { settings: 'write' } },
    staff_connect_read: { role: 'STAFF', permissionScopes: { connect: 'read' } },
    staff_connect_write: { role: 'STAFF', permissionScopes: { connect: 'write' } },
    admin_connect_admin: { role: 'ADMIN', permissionScopes: { connect: 'admin' } },
  };
  const USERS: Record<string, string> = {
    ...Object.fromEntries(Object.keys(MEMBERSHIPS).map((id) => [id, 'USER'])),
    outsider: 'USER',
    platform: 'SUPER_ADMIN',
  };
  let service: SettingsAdapterService;
  let integrations: any;
  let prisma: any;

  const cmd = (userId: unknown, parameters: Record<string, unknown>): ConnectorCommand => ({
    module: 'settings', action: 'configure_integration', parameters, businessId: BIZ, userId: userId as string,
    source: 'key_cortex', timestamp: new Date(), correlationId: 'corr_st6',
  });
  const CONNECT = { integration: 'stripe', config: { key: 'x' } };
  const DISCONNECT = { integration: 'stripe', enabled: false };

  beforeEach(() => {
    prisma = {
      client: {
        membership: {
          findUnique: vi.fn(async ({ where }: any) => {
            const { userId, businessId } = where.userId_businessId;
            return businessId === BIZ ? MEMBERSHIPS[userId] ?? null : null;
          }),
        },
        user: { findUnique: vi.fn(async ({ where }: any) => (USERS[where.id] ? { role: USERS[where.id] } : null)) },
      },
    };
    integrations = { createConnection: vi.fn().mockResolvedValue({ id: 'conn_1' }), disconnect: vi.fn().mockResolvedValue(undefined) };
    service = new SettingsAdapterService({} as IdentityService, integrations, prisma as PrismaService);
  });

  it('RED-BEFORE: a member below connect:write (every role default, an explicit map without connect, connect:read) is refused both connect and disconnect, and the integration hub is never called', async () => {
    for (const actor of ['staff_default', 'admin_default', 'owner_default', 'admin_settings_write', 'staff_connect_read']) {
      for (const parameters of [CONNECT, DISCONNECT]) {
        const result = await service.execute(cmd(actor, parameters));
        expect(result, `${actor} ${JSON.stringify(parameters)}`).toMatchObject({ success: false });
        expect(String(result.error)).toMatch(/^Insufficient permissions: connect requires write access \(you have (none|read)\)$/);
      }
    }
    expect(integrations.createConnection).not.toHaveBeenCalled();
    expect(integrations.disconnect).not.toHaveBeenCalled();
  });

  it("RED-BEFORE: a non-member and a command with no human actor (missing, empty, 'system', 'key_ai') are refused", async () => {
    for (const actor of ['outsider', undefined, '', 'system', 'key_ai']) {
      const result = await service.execute(cmd(actor, DISCONNECT));
      expect(result, String(actor)).toMatchObject({ success: false });
    }
    expect(integrations.disconnect).not.toHaveBeenCalled();
  });

  it('a member granted connect write or admin, and SUPER_ADMIN, connect and disconnect', async () => {
    for (const actor of ['staff_connect_write', 'admin_connect_admin', 'platform']) {
      expect((await service.execute(cmd(actor, CONNECT))).success, actor).toBe(true);
      expect((await service.execute(cmd(actor, DISCONNECT))).success, actor).toBe(true);
    }
    expect(integrations.createConnection).toHaveBeenCalledTimes(3);
    expect(integrations.disconnect).toHaveBeenCalledTimes(3);
    for (const [businessId, providerKey] of integrations.disconnect.mock.calls) expect([businessId, providerKey]).toEqual([BIZ, 'stripe']);
  });
});
