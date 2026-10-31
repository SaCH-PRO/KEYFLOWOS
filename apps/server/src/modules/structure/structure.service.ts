import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CANONICAL_MODULES, MAX_APPROVAL_TIER, defaultScopesForRole, rankOf } from '../../core/authority/module-vocabulary';
import { membershipApprovalTier } from '../../core/authority/approval-tier';
import { resolveCrmAccess, type CrmAccess } from '../crm/crm-permissions.helper';
import { CreateOrgUnitDto } from './dto/create-org-unit.dto';
import { UpdateOrgUnitDto } from './dto/update-org-unit.dto';
import { CreateJobRoleDto, jobRolePermissionsProblem } from './dto/create-job-role.dto';
import { UpdateJobRoleDto } from './dto/update-job-role.dto';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { UpdateAssignmentDto } from './dto/update-assignment.dto';
import { CreateDelegationRuleDto } from './dto/create-delegation-rule.dto';
import { UpdateDelegationRuleDto } from './dto/update-delegation-rule.dto';
import { normalizePhone } from '../crm/crm-duplicate.util';

/**
 * V1-21-AUTH-JOBROLE-CEILING (CF-27; CR-1 in identity-boundary.integration.test.ts).
 *
 * An assignment copies its JobRole's permissions and defaultApprovalTier onto the
 * holder's Membership, which ModuleScopeGuard and every approval gate read, so a JobRole
 * and an assignment are grants exactly as an identity role or permissions change is. The
 * structure routes are gated on team:write only, so without a ceiling a default ADMIN
 * authored { team: admin } at tier 4 and assigned it to itself. The rule here is the
 * identity routes' K2 (IdentityService.authorityExcess / assertMayRewriteAuthority): a
 * requester other than the OWNER or a SUPER_ADMIN may not grant more than it holds, nor
 * rewrite a member (or a job role) whose authority exceeds its own; above it the write is
 * refused with 403 and nothing changes.
 *
 * The comparison below is the same rule over the same shared readers (module-vocabulary,
 * approval-tier, resolveCrmAccess). It is not imported from IdentityService because that
 * method is private and StructureModule cannot import IdentityModule (IdentityModule
 * imports AiModule, which imports StructureModule).
 */

/** The three inputs that make up a membership's authority. */
type AuthorityEnvelope = { role: string; permissionScopes: unknown; maxApprovalTier: number | null };

/** What an assignment writes onto a Membership: a JobRole's map (null: role defaults) and tier. */
type MembershipCopy = { permissionScopes: Prisma.InputJsonObject | null; maxApprovalTier: number };

/** Membership roles, weakest first; an unrecognised role ranks with STAFF (IdentityService ROLE_RANK). */
const ROLE_RANK: Readonly<Record<string, number>> = { STAFF: 0, ADMIN: 1, OWNER: 2 };
/** CRM ownership scopes, weakest first; anything unrecognised ranks lowest. */
const CRM_SCOPE_RANK: Readonly<Record<string, number>> = { none: 0, owned: 1, any: 2 };

const REFUSED_GRANT = 'You cannot grant more authority than your own';
const REFUSED_MEMBER = 'You cannot change a member whose authority exceeds your own';
const REFUSED_JOB_ROLE = 'You cannot change a job role whose authority exceeds your own';

function isPlainMap(value: unknown): value is Prisma.InputJsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The scope map ModuleScopeGuard reads: an explicit map (missing key = none), else the role defaults. */
function scopesOf(m: AuthorityEnvelope): Record<string, string> {
  return m.permissionScopes && typeof m.permissionScopes === 'object'
    ? (m.permissionScopes as Record<string, string>)
    : defaultScopesForRole(m.role);
}

/** resolveCrmAccess itself over an in-memory membership (as IdentityService crmAccessOf). */
function crmAccessOf(m: AuthorityEnvelope): Promise<CrmAccess> {
  const inMemory = {
    client: {
      user: { findUnique: async () => ({ role: 'USER' }) },
      membership: { findUnique: async () => ({ role: m.role, permissionScopes: m.permissionScopes }) },
    },
  } as unknown as PrismaService;
  return resolveCrmAccess(inMemory, '', '');
}

/**
 * The first dimension in which `subject` holds more authority than `bound`, or null: the
 * role, every canonical module level, the approval tier, CRM ownership — each read the
 * way its enforcer reads it.
 */
async function authorityExcess(subject: AuthorityEnvelope, bound: AuthorityEnvelope): Promise<string | null> {
  if ((ROLE_RANK[subject.role] ?? 0) > (ROLE_RANK[bound.role] ?? 0)) return 'role';
  const s = scopesOf(subject);
  const b = scopesOf(bound);
  for (const module of CANONICAL_MODULES) {
    if (rankOf(s[module]) > rankOf(b[module])) return module;
  }
  if (membershipApprovalTier(subject) > membershipApprovalTier(bound)) return 'maxApprovalTier';
  const [sc, bc] = await Promise.all([crmAccessOf(subject), crmAccessOf(bound)]);
  if (rankOf(sc.level) > rankOf(bc.level)) return 'crm';
  if (sc.viewAll && !bc.viewAll) return 'crm_view';
  if ((CRM_SCOPE_RANK[sc.editScope] ?? 0) > (CRM_SCOPE_RANK[bc.editScope] ?? 0)) return 'crm_edit';
  if (sc.reassign && !bc.reassign) return 'crm_reassign';
  if ((CRM_SCOPE_RANK[sc.deleteScope] ?? 0) > (CRM_SCOPE_RANK[bc.deleteScope] ?? 0)) return 'crm_delete';
  return null;
}

/**
 * A JobRole on its own, as an envelope: its map is explicit (a missing key grants none)
 * and it carries no role, so it is read at the lowest one. What it confers on a holder is
 * checked again, against the holder's role, when it is assigned.
 */
function jobRoleEnvelope(permissions: unknown, tier: number): AuthorityEnvelope {
  return { role: 'STAFF', permissionScopes: isPlainMap(permissions) ? permissions : {}, maxApprovalTier: tier };
}

/** What assigning `role` writes onto a membership. A role without a map leaves the role defaults. */
function copyOf(role: { permissions: unknown; defaultApprovalTier: number }): MembershipCopy {
  return { permissionScopes: isPlainMap(role.permissions) ? role.permissions : null, maxApprovalTier: role.defaultApprovalTier };
}

/** No position left to copy from: no explicit map and tier 0, which membershipApprovalTier reads as the role defaults. */
const ROLE_DEFAULTS_COPY: MembershipCopy = { permissionScopes: null, maxApprovalTier: 0 };

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

  /**
   * V1-21: the permissions map must be in the canonical vocabulary and the tier 0..4
   * (400, for every author), and a bounded author may not create a role above its own
   * authority (403). `requesterId` is the authenticated caller.
   */
  async createJobRole(businessId: string, dto: CreateJobRoleDto, requesterId: string) {
    const permissions = this.validJobRolePermissions(dto.permissions);
    const tier = this.validApprovalTier(dto.defaultApprovalTier) ?? 0;
    const bound = await this.grantBound(businessId, requesterId);
    if (bound && (await authorityExcess(jobRoleEnvelope(permissions, tier), bound))) {
      throw new ForbiddenException(REFUSED_GRANT);
    }
    return this.prisma.client.jobRole.create({
      data: {
        businessId,
        name: dto.name,
        description: dto.description,
        level: dto.level ?? 0,
        permissions,
        defaultApprovalTier: tier,
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

  /**
   * V1-21: validated as on create. When the edit touches the permissions or the tier, a
   * bounded editor may not change a role whose current authority exceeds its own, nor
   * leave it above its own (403, row unchanged). A cosmetic edit grants nothing.
   * Existing holders keep their copy until their position next syncs (unchanged here).
   */
  async updateJobRole(businessId: string, id: string, dto: UpdateJobRoleDto, requesterId: string) {
    const current = await this.getJobRole(businessId, id);
    const permissions = this.validJobRolePermissions(dto.permissions);
    const tier = this.validApprovalTier(dto.defaultApprovalTier);
    if (permissions !== undefined || tier !== undefined) {
      const bound = await this.grantBound(businessId, requesterId);
      if (bound) {
        if (await authorityExcess(jobRoleEnvelope(current.permissions, current.defaultApprovalTier), bound)) {
          throw new ForbiddenException(REFUSED_JOB_ROLE);
        }
        const next = jobRoleEnvelope(permissions ?? current.permissions, tier ?? current.defaultApprovalTier);
        if (await authorityExcess(next, bound)) throw new ForbiddenException(REFUSED_GRANT);
      }
    }
    return this.prisma.client.jobRole.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        level: dto.level,
        permissions,
        defaultApprovalTier: tier,
        color: dto.color,
      },
    });
  }

  /** A JobRole permissions map from a request: undefined when absent, 400 outside the vocabulary. */
  private validJobRolePermissions(value: unknown): Prisma.InputJsonObject | undefined {
    if (value === undefined || value === null) return undefined;
    const problem = jobRolePermissionsProblem(value);
    if (problem) throw new BadRequestException(problem);
    return value as Prisma.InputJsonObject;
  }

  private validApprovalTier(value: unknown): number | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_APPROVAL_TIER) {
      throw new BadRequestException(`defaultApprovalTier must be an integer between 0 and ${MAX_APPROVAL_TIER}`);
    }
    return value;
  }

  /**
   * The authority `requesterId` may grant in this business: its membership, or null when
   * it is not bounded (the OWNER, a SUPER_ADMIN) — as IdentityService.assertTeamAdmin.
   * No requester is never read as unbounded.
   */
  private async grantBound(businessId: string, requesterId: string): Promise<AuthorityEnvelope | null> {
    if (!requesterId) throw new ForbiddenException('Authentication required');
    const requester = await this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId: requesterId, businessId } },
      select: { role: true, permissionScopes: true, maxApprovalTier: true },
    });
    if (requester?.role === 'OWNER') return null;
    const user = await this.prisma.client.user.findUnique({ where: { id: requesterId }, select: { role: true } });
    if (user?.role === 'SUPER_ADMIN') return null;
    if (!requester) throw new ForbiddenException('You are not a member of this business');
    return requester;
  }

  /**
   * K2 for a write that replaces a membership's copied authority with `copy`: a bounded
   * requester may not rewrite a member whose CURRENT authority exceeds its own (the
   * identity routes' ST-F5), nor leave it above its own. Returns the copy to write, or
   * null when the membership is not in this business (a legacy row): it is never written.
   */
  private async assertMayCopy(
    businessId: string,
    requesterId: string,
    membershipId: string,
    copy: MembershipCopy,
  ): Promise<MembershipCopy | null> {
    const target = await this.prisma.client.membership.findFirst({
      where: { id: membershipId, businessId },
      select: { role: true, permissionScopes: true, maxApprovalTier: true },
    });
    if (!target) return null;
    const bound = await this.grantBound(businessId, requesterId);
    if (!bound) return copy;
    if (await authorityExcess(target, bound)) throw new ForbiddenException(REFUSED_MEMBER);
    if (await authorityExcess({ role: target.role, ...copy }, bound)) throw new ForbiddenException(REFUSED_GRANT);
    return copy;
  }

  /** The copy assigning `jobRoleId` writes, 400 when its stored map is outside the vocabulary. */
  private async jobRoleCopy(businessId: string, jobRoleId: string): Promise<MembershipCopy> {
    const role = await this.prisma.client.jobRole.findFirst({
      where: { id: jobRoleId, businessId },
      select: { permissions: true, defaultApprovalTier: true },
    });
    if (!role) throw new NotFoundException('Job role not found');
    const problem = role.permissions == null ? null : jobRolePermissionsProblem(role.permissions);
    if (problem) {
      throw new BadRequestException(`This job role's permissions are outside the module vocabulary (${problem}); edit the job role before assigning it`);
    }
    return copyOf(role);
  }

  /**
   * What a membership's copy becomes when position `endingId` ends or is deleted: the
   * job role of its remaining active positions (primary first, then the latest), or the
   * role defaults when none is left. A remaining role outside the vocabulary is skipped.
   */
  private async recomputedCopy(businessId: string, membershipId: string, endingId: string): Promise<MembershipCopy> {
    const remaining = await this.prisma.client.orgAssignment.findMany({
      where: { businessId, membershipId, endedAt: null, id: { not: endingId }, jobRoleId: { not: null } },
      orderBy: [{ isPrimary: 'desc' }, { updatedAt: 'desc' }],
      select: { jobRole: { select: { permissions: true, defaultApprovalTier: true } } },
      take: 50,
    });
    const next = remaining.find(
      (a) => a.jobRole && (a.jobRole.permissions == null || jobRolePermissionsProblem(a.jobRole.permissions) === null),
    );
    return next?.jobRole ? copyOf(next.jobRole) : ROLE_DEFAULTS_COPY;
  }

  private async writeCopy(membershipId: string, copy: MembershipCopy): Promise<void> {
    await this.prisma.client.membership.update({
      where: { id: membershipId },
      data: { permissionScopes: copy.permissionScopes ?? Prisma.DbNull, maxApprovalTier: copy.maxApprovalTier },
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

  /**
   * V1-21: the job role's copy is checked BEFORE anything is written — its stored map
   * must be in the vocabulary (400) and the copy may not rewrite a member above the
   * requester nor leave it above the requester, the requester's own membership included
   * (403). The copy written is the one checked.
   *
   * `requesterId` is optional for one reason: the pure unit spec
   * assignment-refs-tenant-scope.spec.ts (outside this packet's write set) predates the
   * ceiling and calls this with (businessId, dto) over a two-method Prisma fake. Without a
   * requester the copy is the legacy one, read off the created row. Every HTTP call passes
   * the authenticated caller (StructureController requesterOf), so no request reaches
   * that path.
   */
  async createAssignment(businessId: string, dto: CreateAssignmentDto, requesterId?: string) {
    // UNION, not a choice. Two branches inserted at the same point doing
    // different jobs: the contact-only branch decides whether membershipId is
    // even set, and assertAssignmentRefs scopes every id arriving from the body
    // to businessId. Shape first, then ownership — assertAssignmentRefs treats
    // every ref as optional, so it composes with membershipId: null.
    //
    // Picking a side here is the trap. assertAssignmentRefs is DEFINED above via
    // a clean auto-merge, so taking integration's side alone leaves a fully
    // written security method that nothing calls, and silently reopens the
    // cross-tenant privilege escalation it exists to close.
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

    await this.assertAssignmentRefs(businessId, dto);

    const syncs = !isContactOnly && !!dto.jobRoleId;
    const checked =
      requesterId && syncs
        ? await this.assertMayCopy(businessId, requesterId, dto.membershipId!, await this.jobRoleCopy(businessId, dto.jobRoleId!))
        : undefined;

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
    if (syncs && assignment.jobRole) {
      const copy = checked === undefined ? copyOf(assignment.jobRole) : checked;
      if (copy) await this.writeCopy(dto.membershipId!, copy);
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

  /**
   * V1-21: on an active membership-backed position, ending it (endedAt) recomputes the
   * member's copy from its remaining positions (recomputedCopy) instead of leaving the
   * ended role's map in place; otherwise a new jobRoleId copies that role, as before. An
   * ended position syncs nothing. Either copy is bounded by the requester as on create
   * (assertMayCopy) before the assignment is written: a restricted member cannot lift its
   * own restriction by ending its position.
   */
  async updateAssignment(businessId: string, id: string, dto: UpdateAssignmentDto, requesterId: string) {
    const existing = await this.getAssignment(businessId, id);
    // UNION — same reasoning as createAssignment above.
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

    // membershipId comes from `existing`, which getAssignment already scoped —
    // but jobRoleId, orgUnitId and reportsToId all arrive from the body and
    // reach the same permission-syncing write.
    await this.assertAssignmentRefs(businessId, dto);

    const membershipId = !existing.isContactOnly ? existing.membershipId : null;
    const active = existing.endedAt === null;
    const recomputes = !!membershipId && active && !!dto.endedAt && !!existing.jobRoleId;
    const syncs = !!membershipId && active && !dto.endedAt && !!dto.jobRoleId;
    let checked: MembershipCopy | null = null;
    if (membershipId && (recomputes || syncs)) {
      const copy = recomputes
        ? await this.recomputedCopy(businessId, membershipId, id)
        : await this.jobRoleCopy(businessId, dto.jobRoleId!);
      checked = await this.assertMayCopy(businessId, requesterId, membershipId, copy);
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

    // Sync the member's copy (membership-backed only): recomputed when the position ends,
    // the new JobRole's when the role changes on an active position — the copy checked above.
    if (membershipId && checked) await this.writeCopy(membershipId, checked);

    return updated;
  }

  /** V1-21: deleting an active position recomputes the member's copy, bounded as ending it is. */
  async deleteAssignment(businessId: string, id: string, requesterId: string) {
    const existing = await this.getAssignment(businessId, id);
    const membershipId =
      !existing.isContactOnly && existing.endedAt === null && existing.jobRoleId ? existing.membershipId : null;
    const checked = membershipId
      ? await this.assertMayCopy(businessId, requesterId, membershipId, await this.recomputedCopy(businessId, membershipId, id))
      : null;
    const deleted = await this.prisma.client.orgAssignment.delete({ where: { id } });
    if (membershipId && checked) await this.writeCopy(membershipId, checked);
    return deleted;
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
