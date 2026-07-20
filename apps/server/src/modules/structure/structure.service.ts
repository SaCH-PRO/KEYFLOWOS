import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CreateOrgUnitDto } from './dto/create-org-unit.dto';
import { UpdateOrgUnitDto } from './dto/update-org-unit.dto';
import { CreateJobRoleDto } from './dto/create-job-role.dto';
import { UpdateJobRoleDto } from './dto/update-job-role.dto';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { UpdateAssignmentDto } from './dto/update-assignment.dto';
import { CreateDelegationRuleDto } from './dto/create-delegation-rule.dto';
import { UpdateDelegationRuleDto } from './dto/update-delegation-rule.dto';
import { normalizePhone } from '../crm/crm-duplicate.util';

@Injectable()
export class StructureService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Org Units ───
  async listOrgUnits(businessId: string) {
    return this.prisma.client.orgUnit.findMany({
      where: { businessId },
      include: { children: true, assignments: { where: { endedAt: null } } },
      orderBy: { name: 'asc' },
    });
  }

  async createOrgUnit(businessId: string, dto: CreateOrgUnitDto) {
    return this.prisma.client.orgUnit.create({
      data: {
        businessId,
        name: dto.name,
        type: dto.type ?? 'DEPARTMENT',
        address: dto.address,
        city: dto.city,
        country: dto.country,
        phone: dto.phone,
        email: dto.email,
        managerId: dto.managerId,
        parentId: dto.parentId,
      },
    });
  }

  async getOrgUnit(businessId: string, id: string) {
    const unit = await this.prisma.client.orgUnit.findFirst({
      where: { id, businessId },
      include: {
        children: true,
        assignments: {
          where: { endedAt: null },
          include: { jobRole: true },
        },
      },
    });
    if (!unit) throw new NotFoundException('Org unit not found');
    return unit;
  }

  async updateOrgUnit(businessId: string, id: string, dto: UpdateOrgUnitDto) {
    await this.getOrgUnit(businessId, id);
    return this.prisma.client.orgUnit.update({
      where: { id },
      data: {
        name: dto.name,
        type: dto.type,
        address: dto.address,
        city: dto.city,
        country: dto.country,
        phone: dto.phone,
        email: dto.email,
        managerId: dto.managerId,
        parentId: dto.parentId,
      },
    });
  }

  async deleteOrgUnit(businessId: string, id: string) {
    await this.getOrgUnit(businessId, id);
    return this.prisma.client.orgUnit.delete({ where: { id } });
  }

  // ─── Job Roles ───
  async listJobRoles(businessId: string) {
    return this.prisma.client.jobRole.findMany({
      where: { businessId },
      orderBy: { level: 'asc' },
    });
  }

  async createJobRole(businessId: string, dto: CreateJobRoleDto) {
    return this.prisma.client.jobRole.create({
      data: {
        businessId,
        name: dto.name,
        description: dto.description,
        level: dto.level ?? 0,
        permissions: dto.permissions ? (dto.permissions as any) : undefined,
        defaultApprovalTier: dto.defaultApprovalTier ?? 0,
        color: dto.color,
      },
    });
  }

  async getJobRole(businessId: string, id: string) {
    const role = await this.prisma.client.jobRole.findFirst({
      where: { id, businessId },
    });
    if (!role) throw new NotFoundException('Job role not found');
    return role;
  }

  async updateJobRole(businessId: string, id: string, dto: UpdateJobRoleDto) {
    await this.getJobRole(businessId, id);
    return this.prisma.client.jobRole.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        level: dto.level,
        permissions: dto.permissions ? (dto.permissions as any) : undefined,
        defaultApprovalTier: dto.defaultApprovalTier,
        color: dto.color,
      },
    });
  }

  async deleteJobRole(businessId: string, id: string) {
    await this.getJobRole(businessId, id);
    return this.prisma.client.jobRole.delete({ where: { id } });
  }

  // ─── Assignments ───
  async listAssignments(businessId: string) {
    return this.prisma.client.orgAssignment.findMany({
      where: { businessId, endedAt: null },
      include: {
        orgUnit: true,
        jobRole: true,
        reportsTo: true,
        membership: { include: { user: { select: { id: true, email: true, name: true, firstName: true, lastName: true, avatarUrl: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createAssignment(businessId: string, dto: CreateAssignmentDto) {
    const isContactOnly = dto.isContactOnly ?? !dto.membershipId;
    if (isContactOnly) {
      if (!dto.contactName || !dto.contactPhone) {
        throw new BadRequestException('Contact-only positions require contactName and contactPhone');
      }
    } else if (!dto.membershipId) {
      throw new BadRequestException('Provide membershipId, or set isContactOnly with contactName + contactPhone');
    }

    const normalizedPhone = normalizePhone(dto.contactPhone);
    if (normalizedPhone) {
      const existing = await this.prisma.client.orgAssignment.findFirst({
        where: { businessId, contactPhone: normalizedPhone, endedAt: null },
      });
      if (existing) {
        throw new BadRequestException('Another active position already uses this phone number');
      }
    }

    const assignment = await this.prisma.client.orgAssignment.create({
      data: {
        businessId,
        membershipId: isContactOnly ? null : dto.membershipId,
        userId: isContactOnly ? null : dto.userId,
        isContactOnly,
        contactName: dto.contactName,
        contactEmail: dto.contactEmail,
        contactPhone: normalizedPhone,
        preferredChannel: dto.preferredChannel ?? 'whatsapp',
        autoApprovalViaReply: dto.autoApprovalViaReply ?? false,
        orgUnitId: dto.orgUnitId,
        jobRoleId: dto.jobRoleId,
        reportsToId: dto.reportsToId,
        isPrimary: dto.isPrimary ?? true,
      },
      include: { jobRole: true },
    });

    // Sync JobRole permissions to Membership (membership-backed positions only —
    // contact-only staff have no Membership row to sync onto; their tool/approval
    // scope is enforced via the JobRole lookup directly wherever they're delegated to)
    if (!isContactOnly && dto.jobRoleId && assignment.jobRole) {
      await this.prisma.client.membership.update({
        where: { id: dto.membershipId },
        data: {
          permissionScopes: assignment.jobRole.permissions as any,
          maxApprovalTier: assignment.jobRole.defaultApprovalTier,
        },
      });
    }

    return assignment;
  }

  /**
   * Resolve an inbound WhatsApp/SMS phone number to the staff position it belongs
   * to, so a message from that number can be routed to KEY as a staff command
   * instead of the customer-contact intake pipeline. Returns null for unmatched
   * numbers (the normal case — most inbound messages are from customers).
   */
  async resolveStaffByPhone(businessId: string, phone: string) {
    const normalized = normalizePhone(phone);
    if (!normalized) return null;
    return this.prisma.client.orgAssignment.findFirst({
      where: { businessId, contactPhone: normalized, endedAt: null },
      include: { jobRole: true, orgUnit: true },
    });
  }

  /** Persist the KEY chat session id for a position's WhatsApp/SMS conversation. */
  async setActiveFlowSession(assignmentId: string, sessionId: string | null) {
    await this.prisma.client.orgAssignment.update({
      where: { id: assignmentId },
      data: { activeFlowSessionId: sessionId },
    });
  }

  async getAssignment(businessId: string, id: string) {
    const a = await this.prisma.client.orgAssignment.findFirst({
      where: { id, businessId },
      include: {
        orgUnit: true,
        jobRole: true,
        reportsTo: true,
        membership: { include: { user: { select: { id: true, email: true, name: true, firstName: true, lastName: true, avatarUrl: true } } } },
      },
    });
    if (!a) throw new NotFoundException('Assignment not found');
    return a;
  }

  async updateAssignment(businessId: string, id: string, dto: UpdateAssignmentDto) {
    const existing = await this.getAssignment(businessId, id);

    let normalizedPhone: string | null | undefined;
    if (dto.contactPhone !== undefined) {
      normalizedPhone = normalizePhone(dto.contactPhone);
      if (normalizedPhone) {
        const clash = await this.prisma.client.orgAssignment.findFirst({
          where: { businessId, contactPhone: normalizedPhone, endedAt: null, id: { not: id } },
        });
        if (clash) throw new BadRequestException('Another active position already uses this phone number');
      }
    }

    const updated = await this.prisma.client.orgAssignment.update({
      where: { id },
      data: {
        orgUnitId: dto.orgUnitId,
        jobRoleId: dto.jobRoleId,
        reportsToId: dto.reportsToId,
        isPrimary: dto.isPrimary,
        endedAt: dto.endedAt ? new Date(dto.endedAt) : undefined,
        contactName: dto.contactName,
        contactEmail: dto.contactEmail,
        contactPhone: normalizedPhone,
        preferredChannel: dto.preferredChannel,
        autoApprovalViaReply: dto.autoApprovalViaReply,
      },
      include: { jobRole: true },
    });

    // Sync JobRole permissions to Membership when role changes (membership-backed only)
    if (!existing.isContactOnly && dto.jobRoleId && updated.jobRole) {
      await this.prisma.client.membership.update({
        where: { id: existing.membershipId! },
        data: {
          permissionScopes: updated.jobRole.permissions as any,
          maxApprovalTier: updated.jobRole.defaultApprovalTier,
        },
      });
    }

    return updated;
  }

  async deleteAssignment(businessId: string, id: string) {
    await this.getAssignment(businessId, id);
    return this.prisma.client.orgAssignment.delete({ where: { id } });
  }

  /**
   * Find who holds a position, works in an org unit, or matches a name —
   * powers KEY's "who's the bookkeeper?" / "who does Maria report to?" queries.
   */
  async findPeople(businessId: string, filters: { jobRoleName?: string; orgUnitName?: string; personName?: string }) {
    if (!filters.jobRoleName && !filters.orgUnitName && !filters.personName) {
      throw new BadRequestException('Provide at least one of jobRoleName, orgUnitName, or personName');
    }
    return this.prisma.client.orgAssignment.findMany({
      where: {
        businessId,
        endedAt: null,
        ...(filters.jobRoleName ? { jobRole: { name: { contains: filters.jobRoleName, mode: 'insensitive' } } } : {}),
        ...(filters.orgUnitName ? { orgUnit: { name: { contains: filters.orgUnitName, mode: 'insensitive' } } } : {}),
        ...(filters.personName ? {
          OR: [
            { contactName: { contains: filters.personName, mode: 'insensitive' } },
            { membership: { user: { OR: [
              { name: { contains: filters.personName, mode: 'insensitive' } },
              { firstName: { contains: filters.personName, mode: 'insensitive' } },
              { lastName: { contains: filters.personName, mode: 'insensitive' } },
            ] } } },
          ],
        } : {}),
      },
      include: {
        orgUnit: true,
        jobRole: true,
        reportsTo: { include: { jobRole: true, membership: { include: { user: { select: { id: true, name: true, email: true } } } } } },
        directReports: { include: { jobRole: true } },
        membership: { include: { user: { select: { id: true, email: true, name: true, firstName: true, lastName: true, avatarUrl: true } } } },
      },
    });
  }

  // ─── Delegation Rules ───
  async listDelegationRules(businessId: string) {
    return this.prisma.client.delegationRule.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * DelegationRule.delegatorId/delegateId are opaque strings (not FK-enforced,
   * matching the model's own comment). Now that KEY can call
   * createDelegationRule/updateDelegationRule directly, a hallucinated or
   * mistyped id would otherwise create a dangling, silently-ineffective rule —
   * validate both ids resolve to active assignments in this business first.
   */
  private async assertActiveAssignment(businessId: string, id: string, label: string): Promise<void> {
    const found = await this.prisma.client.orgAssignment.findFirst({
      where: { id, businessId, endedAt: null },
      select: { id: true },
    });
    if (!found) throw new BadRequestException(`${label} "${id}" is not an active position in this business`);
  }

  async createDelegationRule(businessId: string, dto: CreateDelegationRuleDto) {
    await Promise.all([
      this.assertActiveAssignment(businessId, dto.delegatorId, 'delegatorId'),
      this.assertActiveAssignment(businessId, dto.delegateId, 'delegateId'),
    ]);
    return this.prisma.client.delegationRule.create({
      data: {
        businessId,
        delegatorId: dto.delegatorId,
        delegateId: dto.delegateId,
        scope: dto.scope,
        maxTier: dto.maxTier,
        activeUntil: dto.activeUntil ? new Date(dto.activeUntil) : undefined,
        reason: dto.reason,
      },
    });
  }

  async getDelegationRule(businessId: string, id: string) {
    const r = await this.prisma.client.delegationRule.findFirst({
      where: { id, businessId },
    });
    if (!r) throw new NotFoundException('Delegation rule not found');
    return r;
  }

  async updateDelegationRule(businessId: string, id: string, dto: UpdateDelegationRuleDto) {
    await this.getDelegationRule(businessId, id);
    await Promise.all([
      dto.delegatorId ? this.assertActiveAssignment(businessId, dto.delegatorId, 'delegatorId') : Promise.resolve(),
      dto.delegateId ? this.assertActiveAssignment(businessId, dto.delegateId, 'delegateId') : Promise.resolve(),
    ]);
    return this.prisma.client.delegationRule.update({
      where: { id },
      data: {
        delegatorId: dto.delegatorId,
        delegateId: dto.delegateId,
        scope: dto.scope,
        maxTier: dto.maxTier,
        activeUntil: dto.activeUntil ? new Date(dto.activeUntil) : undefined,
        reason: dto.reason,
        isActive: dto.isActive,
      },
    });
  }

  async deleteDelegationRule(businessId: string, id: string) {
    await this.getDelegationRule(businessId, id);
    return this.prisma.client.delegationRule.delete({ where: { id } });
  }

  // ─── Org Chart / Tree ───
  async getOrgTree(businessId: string) {
    const units = await this.prisma.client.orgUnit.findMany({
      where: { businessId },
      include: {
        children: true,
        assignments: {
          where: { endedAt: null },
          include: { jobRole: true },
        },
      },
      orderBy: { name: 'asc' },
    });
    const rootUnits = units.filter((u) => !u.parentId);
    return { units, rootUnits };
  }

  // ─── Stats ───
  async getStats(businessId: string) {
    const [unitCount, roleCount, assignmentCount, delegationCount] = await Promise.all([
      this.prisma.client.orgUnit.count({ where: { businessId } }),
      this.prisma.client.jobRole.count({ where: { businessId } }),
      this.prisma.client.orgAssignment.count({ where: { businessId, endedAt: null } }),
      this.prisma.client.delegationRule.count({ where: { businessId, isActive: true } }),
    ]);
    return { unitCount, roleCount, assignmentCount, delegationCount };
  }
}
