import { Injectable, NotFoundException } from '@nestjs/common';
import { ConnectorCommand, ConnectorResult } from '../key-cortex-connector.types';
import { connectorOk, connectorFail } from '../key-cortex-connector.utils';
import { IdentityService } from '../../identity/identity.service';
import { IntegrationHubService } from '../../integration-hub/integration-hub.service';
import { PrismaService } from '../../../core/prisma/prisma.service';

@Injectable()
export class SettingsAdapterService {
  constructor(
    private readonly identity: IdentityService,
    private readonly integrations: IntegrationHubService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    try {
      switch (command.action) {
        case 'update_business_profile': {
          const updated = await this.updateBusinessProfile({
            businessId: command.businessId,
            name: command.parameters.name as string | undefined,
            timezone: command.parameters.timezone as string | undefined,
            currency: command.parameters.currency as string | undefined,
            industry: command.parameters.industry as string | undefined,
          });
          return connectorOk(command, start, updated);
        }
        case 'update_branding': {
          const updated = await this.updateBranding({
            businessId: command.businessId,
            primaryColor: command.parameters.primaryColor as string | undefined,
            logoUrl: command.parameters.logoUrl as string | undefined,
            emailSignature: command.parameters.emailSignature as string | undefined,
          });
          return connectorOk(command, start, updated);
        }
        case 'add_team_member': {
          const added = await this.addTeamMember({
            businessId: command.businessId,
            email: command.parameters.email as string,
            role: command.parameters.role as string,
            inviterId: command.userId,
          });
          return connectorOk(command, start, added);
        }
        case 'remove_team_member': {
          const removed = await this.removeTeamMember({
            businessId: command.businessId,
            userId: command.parameters.userId as string,
            requesterId: command.userId,
          });
          return connectorOk(command, start, removed);
        }
        case 'update_role': {
          const updated = await this.updateTeamMemberRole({
            businessId: command.businessId,
            userId: command.parameters.userId as string,
            role: command.parameters.role as string,
            requesterId: command.userId,
          });
          return connectorOk(command, start, updated);
        }
        case 'configure_integration': {
          const configured = await this.configureIntegration({
            businessId: command.businessId,
            providerKey: command.parameters.integration as string,
            config: command.parameters.config as Record<string, unknown> | undefined,
            enabled: (command.parameters.enabled as boolean) ?? true,
          });
          return connectorOk(command, start, configured);
        }
        default:
          return connectorFail(command, start, `Unknown settings action: ${command.action}`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return connectorFail(command, start, message);
    }
  }

  async getBusinessProfile(businessId: string) {
    return this.identity.getBusiness(businessId);
  }

  private async updateBusinessProfile(input: {
    businessId: string;
    name?: string;
    timezone?: string;
    currency?: string;
    industry?: string;
  }) {
    return this.identity.updateBusiness(input.businessId, {
      name: input.name,
      timezone: input.timezone,
      currency: input.currency,
      industry: input.industry,
    });
  }

  private async updateBranding(input: {
    businessId: string;
    primaryColor?: string;
    logoUrl?: string;
    emailSignature?: string;
  }) {
    return this.identity.updateBusiness(input.businessId, {
      primaryColor: input.primaryColor,
      logoUrl: input.logoUrl,
      metaData: input.emailSignature ? { emailSignature: input.emailSignature } : undefined,
    });
  }

  private async addTeamMember(input: {
    businessId: string;
    email: string;
    role: string;
    inviterId: string;
  }) {
    return this.identity.inviteTeamMember(
      input.businessId,
      input.email,
      input.role,
      input.inviterId,
    );
  }

  private async removeTeamMember(input: {
    businessId: string;
    userId: string;
    requesterId: string;
  }) {
    const membership = await this.prisma.client.membership.findFirst({
      where: { userId: input.userId, businessId: input.businessId },
    });
    if (!membership) {
      throw new NotFoundException('Team member not found');
    }
    return this.identity.removeTeamMember(input.businessId, membership.id, input.requesterId);
  }

  private async updateTeamMemberRole(input: {
    businessId: string;
    userId: string;
    role: string;
    requesterId: string;
  }) {
    const membership = await this.prisma.client.membership.findFirst({
      where: { userId: input.userId, businessId: input.businessId },
    });
    if (!membership) {
      throw new NotFoundException('Team member not found');
    }
    return this.identity.updateMemberRole(input.businessId, membership.id, input.role, input.requesterId);
  }

  private async configureIntegration(input: {
    businessId: string;
    providerKey: string;
    config?: Record<string, unknown>;
    enabled: boolean;
  }) {
    if (!input.enabled) {
      await this.integrations.disconnect(input.businessId, input.providerKey);
      return { disconnected: true, providerKey: input.providerKey };
    }
    return this.integrations.createConnection(input.businessId, input.providerKey, {
      settings: input.config ?? {},
      scopes: [],
    });
  }
}
