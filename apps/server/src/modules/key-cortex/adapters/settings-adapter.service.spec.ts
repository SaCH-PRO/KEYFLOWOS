import { describe, it, expect, vi, beforeEach } from 'vitest';
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
