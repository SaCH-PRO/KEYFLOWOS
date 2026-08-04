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

@Injectable()
export class StructureService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The people directory: everyone who works here, in one shape.
   *
   * There are two distinct concepts of "person" in this schema and neither one
   * is the whole answer:
   *
   *   Membership  — a real account. Has a User, a login, an access level and an
   *                 approval tier. This is who can be TOLD to do something.
   *   StaffMember — a bookable resource. Has skills, weekly hours, services and
   *                 a calendar, and NO userId at all. This is who appears on a
   *                 booking.
   *
   * A hairdresser is usually the second and often not the first. Listing only
   * memberships would answer "who works here" with the office manager; listing
   * only staff would omit the owner. Both are returned, tagged with `kind`, and
   * a caller that needs to act on a person needs that tag to know which id
   * space it is in.
   *
   * Projected field by field, never spread. Two things are deliberately absent:
   *
   *   hourlyRate       — pay data. Chat cannot establish whether the person
   *                      asking is entitled to see a colleague's rate, and
   *                      Membership.role is an access level rather than an
   *                      answer to that question.
   *   permissionScopes — the raw permission blob, which is security
   *                      configuration and not something a model should be
   *                      reasoning about or repeating.
   */
  async listPeople(businessId: string, opts: { search?: string; limit?: number } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);

    const [memberships, staff] = await Promise.all([
      this.prisma.client.membership.findMany({
        where: { businessId },
        select: {
          id: true,
          role: true,
          maxApprovalTier: true,
          dailyCapacityHours: true,
          skills: { select: { name: true } },
          user: { select: { id: true, name: true, firstName: true, lastName: true, email: true } },
          orgAssignments: {
            // businessId as well as the membership scope. Assignments created
            // before assertAssignmentRefs existed could name a membership in
            // another business, so nesting under a scoped membership is not on
            // its own proof that the assignment belongs here.
            where: { businessId, endedAt: null },
            orderBy: { isPrimary: 'desc' },
            take: 1,
            select: {
              orgUnit: { select: { name: true, type: true } },
              jobRole: { select: { name: true, level: true } },
              reportsTo: {
                select: {
                  membership: { select: { user: { select: { name: true, email: true } } } },
                },
              },
            },
          },
        },
        take: 200,
      }),
      this.prisma.client.staffMember.findMany({
        where: { businessId, deletedAt: null },
        select: {
          id: true,
          name: true,
          maxHoursPerWeek: true,
          skills: { select: { name: true } },
        },
        take: 200,
      }),
    ]);

    const people = [
      ...memberships.map((m) => {
        const assignment = m.orgAssignments[0];
        const reportsToUser = assignment?.reportsTo?.membership?.user;
        return {
          id: m.user.id,
          kind: 'account' as const,
          name:
            m.user.name ||
            [m.user.firstName, m.user.lastName].filter(Boolean).join(' ') ||
            m.user.email ||
            m.user.id,
          email: m.user.email ?? null,
          accessLevel: m.role,
          approvalTier: m.maxApprovalTier,
          jobRole: assignment?.jobRole?.name ?? null,
          jobRoleLevel: assignment?.jobRole?.level ?? null,
          orgUnit: assignment?.orgUnit?.name ?? null,
          orgUnitType: assignment?.orgUnit?.type ?? null,
          reportsTo: reportsToUser?.name ?? reportsToUser?.email ?? null,
          weeklyCapacityHours: m.dailyCapacityHours != null ? m.dailyCapacityHours * 5 : null,
          skills: m.skills.map((s) => s.name),
        };
      }),
      ...staff.map((s) => ({
        id: s.id,
        kind: 'staff' as const,
        name: s.name,
        email: null,
        accessLevel: null,
        approvalTier: null,
        jobRole: null,
        jobRoleLevel: null,
        orgUnit: null,
        orgUnitType: null,
        reportsTo: null,
        weeklyCapacityHours: s.maxHoursPerWeek ?? null,
        skills: s.skills.map((sk) => sk.name),
      })),
    ];

    const needle = opts.search?.trim().toLowerCase();
    const filtered = needle
      ? people.filter((p) =>
          [p.name, p.email, p.jobRole, p.orgUnit, ...p.skills]
            .filter(Boolean)
            .some((field) => String(field).toLowerCase().includes(needle)),
        )
      : people;

    return {
      people: filtered.slice(0, limit),
      total: filtered.length,
      truncated: filtered.length > limit,
    };
  }

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

  /**
   * Every id in an assignment must belong to the business in the route.
   *
   * The guard chain (AuthGuard, BusinessGuard, ModuleScopeGuard with
   * team:write) proves the CALLER belongs to :businessId. It says nothing about
   * the ids in the body, and the DTO validates that they are strings — which is
   * the shape of hole that looks closed because something is clearly checking
   * something.
   *
   * What that cost here: createAssignment ends by writing
   *
   *   membership.update({ where: { id: dto.membershipId }, data: {
   *     permissionScopes: jobRole.permissions, maxApprovalTier: jobRole.defaultApprovalTier } })
   *
   * on a caller-supplied membershipId, with a jobRole the caller also names. So
   * anyone with team:write in one business could rewrite the permission scopes
   * and approval tier of ANY membership in ANY business — including their own
   * low-privilege membership elsewhere, using a job role they had every right to
   * create at tier 4 in their own org. That is cross-tenant privilege
   * escalation reached with two legitimate API calls.
   *
   * userId is checked against the membership rather than merely for presence:
   * OrgAssignment.userId is denormalised "for quick lookups", so a mismatch
   * silently attributes one person's assignment to another.
   */
  private async assertAssignmentRefs(
    businessId: string,
    refs: {
      membershipId?: string;
      userId?: string;
      orgUnitId?: string;
      jobRoleId?: string | null;
      reportsToId?: string | null;
    },
  ): Promise<void> {
    const checks: Array<Promise<void>> = [];

    if (refs.membershipId) {
      checks.push(
        (async () => {
          const membership = await this.prisma.client.membership.findFirst({
            where: { id: refs.membershipId, businessId },
            select: { userId: true },
          });
          if (!membership) throw new NotFoundException('Membership not found');
          if (refs.userId && refs.userId !== membership.userId) {
            throw new BadRequestException('userId does not belong to that membership');
          }
        })(),
      );
    }

    if (refs.orgUnitId) {
      checks.push(
        (async () => {
          const unit = await this.prisma.client.orgUnit.findFirst({
            where: { id: refs.orgUnitId, businessId },
            select: { id: true },
          });
          if (!unit) throw new NotFoundException('Org unit not found');
        })(),
      );
    }

    if (refs.jobRoleId) {
      checks.push(
        (async () => {
          const role = await this.prisma.client.jobRole.findFirst({
            where: { id: refs.jobRoleId as string, businessId },
            select: { id: true },
          });
          if (!role) throw new NotFoundException('Job role not found');
        })(),
      );
    }

    if (refs.reportsToId) {
      checks.push(
        (async () => {
          const manager = await this.prisma.client.orgAssignment.findFirst({
            where: { id: refs.reportsToId as string, businessId },
            select: { id: true },
          });
          if (!manager) throw new NotFoundException('Reporting line not found');
        })(),
      );
    }

    await Promise.all(checks);
  }

  async createAssignment(businessId: string, dto: CreateAssignmentDto) {
    await this.assertAssignmentRefs(businessId, dto);

    const assignment = await this.prisma.client.orgAssignment.create({
      data: {
        businessId,
        membershipId: dto.membershipId,
        userId: dto.userId,
        orgUnitId: dto.orgUnitId,
        jobRoleId: dto.jobRoleId,
        reportsToId: dto.reportsToId,
        isPrimary: dto.isPrimary ?? true,
      },
      include: { jobRole: true },
    });

    // Sync JobRole permissions to Membership
    if (dto.jobRoleId && assignment.jobRole) {
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
    // membershipId comes from `existing`, which getAssignment already scoped —
    // but jobRoleId, orgUnitId and reportsToId all arrive from the body and
    // reach the same permission-syncing write.
    await this.assertAssignmentRefs(businessId, dto);
    const updated = await this.prisma.client.orgAssignment.update({
      where: { id },
      data: {
        orgUnitId: dto.orgUnitId,
        jobRoleId: dto.jobRoleId,
        reportsToId: dto.reportsToId,
        isPrimary: dto.isPrimary,
        endedAt: dto.endedAt ? new Date(dto.endedAt) : undefined,
      },
      include: { jobRole: true },
    });

    // Sync JobRole permissions to Membership when role changes
    if (dto.jobRoleId && updated.jobRole) {
      await this.prisma.client.membership.update({
        where: { id: existing.membershipId },
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

  // ─── Delegation Rules ───
  async listDelegationRules(businessId: string) {
    return this.prisma.client.delegationRule.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createDelegationRule(businessId: string, dto: CreateDelegationRuleDto) {
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
