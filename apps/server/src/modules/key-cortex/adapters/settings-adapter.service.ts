import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConnectorCommand, ConnectorResult } from '../key-cortex-connector.types';
import { connectorOk, connectorFail } from '../key-cortex-connector.utils';
import { IdentityService } from '../../identity/identity.service';
import { IntegrationHubService } from '../../integration-hub/integration-hub.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { assertCommandActorModuleLevel } from '../../../core/auth/member-module-level';

/**
 * R0-09c review CR-1: the member a remove_team_member or update_role command
 * changes. It must be named: Prisma drops a `where` key whose value is
 * undefined, so the membership lookup below with no `parameters.userId` matched
 * whichever membership of the business Postgres read first, and the command
 * removed or re-roled a member nobody chose. Two ways reached that: the
 * executor's rollbackOnFailure compensates a failed add_team_member with
 * remove_team_member carrying the add's {email, role} (no userId), and a
 * command that leaves the userId out. Once the actor became the authenticated
 * OWNER (R0-09c), both passed IdentityService's team check. Now they are
 * refused before any lookup.
 */
function teamTarget(command: ConnectorCommand): string {
  const target = command.parameters?.userId;
  if (typeof target !== 'string' || target.length === 0) {
    throw new BadRequestException(`settings.${command.action} needs parameters.userId, the member to change`);
  }
  return target;
}

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
          await this.assertProfileOwner(command);
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
          await this.assertProfileOwner(command);
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
            userId: teamTarget(command),
            requesterId: command.userId,
          });
          return connectorOk(command, start, removed);
        }
        case 'update_role': {
          const updated = await this.updateTeamMemberRole({
            businessId: command.businessId,
            userId: teamTarget(command),
            role: command.parameters.role as string,
            requesterId: command.userId,
          });
          return connectorOk(command, start, updated);
        }
        case 'configure_integration': {
          await this.assertIntegrationAdmin(command);
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

  /**
   * R0-09c-KEY-ACTOR-BINDING (R0-09-ID-HARDEN review CR-3), owner ruling D-11:
   * editing the business profile is OWNER only, regardless of granted scopes —
   * the rule PATCH /identity/businesses/:businessId applies. These two actions
   * reached IdentityService.updateBusiness with no owner check, so a STAFF
   * command changed the name, timezone, currency and branding that route
   * refuses it.
   *
   * The rule is IdentityService.assertBusinessOwner, applied on the command's
   * actor: `command.userId` (KeyCortexController takes it from the principal
   * AuthGuard admitted, never from the request) with the role its User row
   * holds, which is the role AuthMiddleware attaches. So the OWNER membership,
   * the distinguished owner (Business.ownerId) and SUPER_ADMIN pass, as on the
   * PATCH route; a STAFF or ADMIN member, a non-member and a command with no
   * human actor ('system', KEY's own 'key_ai') do not. A refusal throws, and
   * execute() answers it as the connector failure shape.
   */
  private async assertProfileOwner(command: ConnectorCommand): Promise<void> {
    const actorId = command.userId;
    if (typeof actorId !== 'string' || actorId.length === 0) {
      throw new ForbiddenException('Only the business owner can edit the business profile');
    }
    const actor = await this.prisma.client.user.findUnique({ where: { id: actorId }, select: { role: true } });
    await this.identity.assertBusinessOwner(command.businessId, { id: actorId, role: actor?.role });
  }

  /**
   * R0-09c review ST-6: settings.configure_integration connects or disconnects an integration, which
   * the HTTP routes (POST and DELETE integration-hub/businesses/:businessId/connections/:providerKey)
   * admit only with connect:write through ModuleScopeGuard. The action checked no authority, so a
   * STAFF command (connect is 'none' for every role by default) connected and disconnected the
   * business's integrations. The rule is ModuleScopeGuard's, on the command's actor.
   *
   * SWEEP-P0-SCOPES round 1 class repair (CLASS B; found by the census call graph, CEN-10c): binding or
   * unbinding an integration (IntegrationConnection.authDataRef, the reference to its stored
   * credential) also needs settings admin, as the HTTP routes now do and as every other credential
   * binding does. Both are read as ModuleScopeGuard reads them (assertCommandActorModuleLevel: an
   * explicit map binds an ADMIN too, D-114; a JSON array names no module; SUPER_ADMIN passes); a
   * command with no human actor, a non-member and a member below either level are refused, and
   * execute() answers the connector failure shape.
   */
  private async assertIntegrationAdmin(command: ConnectorCommand): Promise<void> {
    await assertCommandActorModuleLevel(this.prisma, command.businessId, command.userId, 'connect', 'write');
    await assertCommandActorModuleLevel(this.prisma, command.businessId, command.userId, 'settings', 'admin');
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
