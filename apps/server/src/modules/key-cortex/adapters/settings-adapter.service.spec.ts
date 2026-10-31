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
        membership: { findFirst: vi.fn() },
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
 * an ADMIN and a STAFF member, an ownerId owner with no membership, and a
 * SUPER_ADMIN with none.
 */
describe('SettingsAdapterService — the D-11 owner rule on the command actor (R0-09c, review CR-3)', () => {
  const BIZ = 'biz_d11';
  const MEMBERSHIPS: Record<string, string> = { owner_member: 'OWNER', admin_member: 'ADMIN', staff_member: 'STAFF' };
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
          findFirst: vi.fn(async ({ where }: any) => (where.id === BIZ && where.ownerId === 'owner_by_id' ? { id: BIZ } : null)),
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

    it(`the OWNER (membership), the ownerId owner and SUPER_ADMIN pass the rule and ${action} reaches updateBusiness`, async () => {
      for (const actor of ['owner_member', 'owner_by_id', 'platform']) {
        const result = await service.execute(cmd(action, actor, parameters));
        expect(result.success, actor).toBe(true);
      }
      expect(updateBusiness).toHaveBeenCalledTimes(3);
      for (const [businessId] of updateBusiness.mock.calls) expect(businessId).toBe(BIZ);
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
