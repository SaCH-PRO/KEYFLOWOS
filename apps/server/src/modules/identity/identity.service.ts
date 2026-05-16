import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { BlueprintService } from '../blueprint/blueprint.service';
import { computeProfileCompleteness, computeTieredCompleteness, COMPLETENESS_TIERS, PROGRESSIVE_DEEPENING_PROMPTS } from './profile-completeness.constants';

/**
 * Map a Business profile field to the onboarding-answer key that
 * `BlueprintService.inferFromOnboarding` understands. Only fields that have
 * a direct equivalent in an existing blueprint section are listed; the rest
 * are intentionally ignored so the bridge stays lossless.
 */
const BUSINESS_FIELD_TO_BLUEPRINT_ANSWER: Record<string, string> = {
  name: 'businessName',
  businessIntent: 'businessIntent',
  industry: 'industry',
  tagline: 'tagline',
  country: 'country',
  primaryColor: 'primaryColor',
  secondaryColor: 'secondaryColor',
  logoUrl: 'logoUrl',
  currency: 'currency',
  teamSize: 'teamSize',
};

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BlueprintService) private readonly blueprint: BlueprintService,
  ) {}

  listBusinesses(userId: string) {
    if (!userId) throw new UnauthorizedException('User ID is required to list businesses');
    return this.prisma.client.business.findMany({
      where: { ownerId: userId, deletedAt: null },
    });
  }

  async getBusiness(businessId: string) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
    });
    if (!business) throw new NotFoundException('Business not found');
    return business;
  }

  private static readonly PUBLIC_BUSINESS_FIELDS = {
    id: true,
    name: true,
    slug: true,
    logoUrl: true,
    tagline: true,
    description: true,
    address: true,
    city: true,
    country: true,
    phone: true,
    email: true,
    website: true,
    facebook: true,
    instagram: true,
    twitter: true,
    linkedin: true,
    tiktok: true,
    youtube: true,
    whatsapp: true,
    primaryColor: true,
    secondaryColor: true,
    defaultTaxRate: true,
    invoiceTemplate: true,
    quoteTemplate: true,
    timezone: true,
    currency: true,
    storeEnabled: true,
    businessHours: true,
  } as const;

  async getBusinessBySlug(slug: string) {
    const business = await this.prisma.client.business.findFirst({
      where: { slug, deletedAt: null },
    });
    if (!business) throw new NotFoundException('Business not found');
    return business;
  }

  async getPublicBusiness(slug: string) {
    const business = await this.prisma.client.business.findFirst({
      where: { slug, deletedAt: null },
      select: IdentityService.PUBLIC_BUSINESS_FIELDS,
    });
    if (!business) throw new NotFoundException('Business not found');
    return business;
  }

  async getPublicBusinessById(businessId: string) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: IdentityService.PUBLIC_BUSINESS_FIELDS,
    });
    if (!business) throw new NotFoundException('Business not found');
    return business;
  }

  async updateUser(userId: string, input: { firstName?: string; lastName?: string; phone?: string; name?: string; avatarUrl?: string }) {
    const user = await this.prisma.client.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const data: Record<string, unknown> = {};
    if (input.firstName !== undefined) data.firstName = input.firstName.trim();
    if (input.lastName !== undefined) data.lastName = input.lastName.trim();
    if (input.phone !== undefined) data.phone = input.phone.trim();
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.avatarUrl !== undefined) data.avatarUrl = input.avatarUrl.trim();

    return this.prisma.client.user.update({
      where: { id: userId },
      data,
      select: { id: true, email: true, name: true, firstName: true, lastName: true, phone: true, avatarUrl: true, role: true },
    });
  }

  async checkSlugAvailability(slug: string, userId?: string) {
    const existing = await this.prisma.client.business.findFirst({
      where: { slug, deletedAt: null },
    });
    if (!existing) return { available: true, slug };
    if (userId && existing.ownerId === userId) return { available: true, slug, ownedByYou: true };
    return { available: false, slug };
  }

  createBusiness(input: { name: string; ownerId: string }) {
    if (!input.ownerId) {
      throw new UnauthorizedException('Owner ID is required to create a business');
    }
    return this.prisma.client.business.create({
      data: {
        name: input.name.trim(),
        ownerId: input.ownerId,
      },
    });
  }

  async updateBusiness(businessId: string, input: {
    name?: string;
    slug?: string;
    timezone?: string;
    currency?: string;
    logoUrl?: string;
    address?: string;
    phone?: string;
    email?: string;
    website?: string;
    facebook?: string;
    instagram?: string;
    twitter?: string;
    linkedin?: string;
    tiktok?: string;
    youtube?: string;
    whatsapp?: string;
    primaryColor?: string;
    secondaryColor?: string;
    defaultTaxRate?: number;
    complianceStatus?: string;
    complianceData?: Record<string, boolean>;
    lastHealthCheck?: string;
    storeEnabled?: boolean;
    businessHours?: Record<string, { open: string; close: string; closed: boolean }>;
    onboardingComplete?: boolean;
    tagline?: string;
    description?: string;
    city?: string;
    country?: string;
    industry?: string;
    businessIntent?: string;
    metaData?: Record<string, any>;
    headline?: string;
    bio?: string;
    skills?: string[];
    businessStage?: string;
    interests?: string[];
    teamSize?: string;
    acceptingWork?: boolean;
    currentCapacity?: string;
    leadTime?: string;
    preferredProjectTypes?: string[];
    budgetFit?: string;
    positioningStatement?: string;
  }) {
    if (input.slug) {
      const existing = await this.prisma.client.business.findFirst({
        where: { slug: input.slug.trim(), NOT: { id: businessId } },
      });
      if (existing) throw new BadRequestException('Slug is already taken');
    }

    const oldBusiness = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!oldBusiness) throw new NotFoundException('Business not found');

    const {
      lastHealthCheck, metaData,
      skills, interests, preferredProjectTypes,
      acceptingWork, currentCapacity, leadTime, budgetFit, positioningStatement,
      ...rest
    } = input;

    const stringFields: (keyof typeof rest)[] = [
      'name', 'slug', 'timezone', 'currency', 'logoUrl', 'address', 'phone',
      'email', 'website', 'facebook', 'instagram', 'twitter', 'linkedin',
      'tiktok', 'youtube', 'whatsapp', 'primaryColor', 'secondaryColor',
      'complianceStatus', 'tagline', 'description', 'city', 'country',
      'industry', 'businessIntent', 'headline', 'bio', 'businessStage', 'teamSize',
    ];

    const data: Record<string, unknown> = {};
    for (const key of stringFields) {
      if (rest[key] !== undefined) {
        const val = rest[key];
        data[key] = typeof val === 'string' ? val.trim() : val;
      }
    }

    if (currentCapacity !== undefined) data.currentCapacity = currentCapacity?.trim();
    if (leadTime !== undefined) data.leadTime = leadTime?.trim();
    if (budgetFit !== undefined) data.budgetFit = budgetFit?.trim();
    if (positioningStatement !== undefined) data.positioningStatement = positioningStatement?.trim();

    const nonStringFields: (keyof typeof rest)[] = [
      'defaultTaxRate', 'complianceData', 'storeEnabled', 'businessHours', 'onboardingComplete',
    ];
    for (const key of nonStringFields) {
      if (rest[key] !== undefined) {
        data[key] = rest[key];
      }
    }

    if (acceptingWork !== undefined) {
      data.acceptingWork = acceptingWork;
    }

    if (skills !== undefined) {
      data.skills = skills.map((s) => s.trim());
    }
    if (interests !== undefined) {
      data.interests = interests.map((s) => s.trim());
    }
    if (preferredProjectTypes !== undefined) {
      data.preferredProjectTypes = preferredProjectTypes.map((s) => s.trim());
    }

    if (lastHealthCheck) {
      data.lastHealthCheck = new Date(lastHealthCheck);
    }

    if (metaData) {
      const existingMeta = (oldBusiness.metaData as Record<string, any>) || {};
      data.metaData = { ...existingMeta, ...metaData };
    }

    const getStr = (key: string): string | null => {
      const v = data[key] ?? (oldBusiness as Record<string, unknown>)[key];
      return typeof v === 'string' ? v : null;
    };
    const getStrArr = (key: string): string[] => {
      const v = data[key] ?? (oldBusiness as Record<string, unknown>)[key];
      return Array.isArray(v) ? (v as string[]) : [];
    };
    data.profileCompleteness = computeProfileCompleteness({
      name: getStr('name'),
      logoUrl: getStr('logoUrl'),
      headline: getStr('headline'),
      bio: getStr('bio'),
      industry: getStr('industry'),
      skills: getStrArr('skills'),
      businessStage: getStr('businessStage'),
      city: getStr('city'),
      country: getStr('country'),
      interests: getStrArr('interests'),
      tagline: getStr('tagline'),
      description: getStr('description'),
      positioningStatement: getStr('positioningStatement'),
      currentCapacity: getStr('currentCapacity'),
      preferredProjectTypes: getStrArr('preferredProjectTypes'),
    });

    const result = await this.prisma.client.business.update({
      where: { id: businessId },
      data,
    });

    const oldBusinessRecord = oldBusiness as Record<string, unknown>;
    const changedFields = Object.keys(rest).filter((k) => {
      const key = k as keyof typeof rest;
      if (rest[key] === undefined) return false;
      const oldVal = oldBusinessRecord[k];
      const newVal = rest[key];
      return JSON.stringify(oldVal) !== JSON.stringify(newVal);
    });

    if (changedFields.length > 0) {
      this.detectDocumentImpact(businessId, changedFields, oldBusiness.name).catch((err) =>
        this.logger.warn(`Document impact detection failed for business "${oldBusiness.name}" (${businessId}): ${err?.message ?? err}`),
      );

      // Mirror the changed Business fields into the BusinessBlueprint so KEY's
      // grounding (and every AI surface that pulls blueprint context) stays in
      // sync with day-to-day profile edits. Best-effort, non-blocking — a
      // failed mirror must never break the underlying business update.
      const mirrored: Record<string, unknown> = {};
      for (const field of changedFields) {
        const answerKey = BUSINESS_FIELD_TO_BLUEPRINT_ANSWER[field];
        if (!answerKey) continue;
        const value = (rest as Record<string, unknown>)[field];
        if (value !== undefined) mirrored[answerKey] = value;
      }
      if (Object.keys(mirrored).length > 0) {
        this.blueprint.inferFromOnboarding(businessId, mirrored).catch((err) =>
          this.logger.warn(`Blueprint mirror failed for business ${businessId}: ${(err as Error)?.message ?? err}`),
        );
      }
    }

    return result;
  }

  async getBusinessCommunityProfile(businessId: string) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        headline: true,
        bio: true,
        industry: true,
        skills: true,
        businessStage: true,
        city: true,
        country: true,
        interests: true,
        profileCompleteness: true,
        tagline: true,
        acceptingWork: true,
        currentCapacity: true,
        leadTime: true,
        preferredProjectTypes: true,
        budgetFit: true,
        positioningStatement: true,
        createdAt: true,
        products: {
          where: { isActive: true },
          select: { id: true, name: true, price: true, currency: true, category: true, imageUrl: true, description: true },
          take: 6,
          orderBy: { createdAt: 'desc' },
        },
        services: {
          select: { id: true, name: true, price: true, duration: true, description: true },
          take: 6,
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: {
            communityPosts: true,
            cohortMembers: true,
            networkConnectionsTo: true,
            endorsementsReceived: true,
          },
        },
      },
    });
    if (!business) throw new NotFoundException('Business not found');
    return business;
  }

  static readonly PERMISSION_MODULES = [
    'crm', 'revenue', 'bookings', 'projects', 'content', 'expenses', 'automations', 'storefront', 'settings', 'ai', 'team',
  ] as const;

  static readonly DEFAULT_SCOPES: Record<string, Record<string, string>> = {
    OWNER: Object.fromEntries(IdentityService.PERMISSION_MODULES.map((m) => [m, 'admin'])),
    ADMIN: Object.fromEntries(IdentityService.PERMISSION_MODULES.map((m) => [m, m === 'team' ? 'write' : 'admin'])),
    STAFF: Object.fromEntries(IdentityService.PERMISSION_MODULES.map((m) => [m, ['settings', 'team', 'ai'].includes(m) ? 'none' : 'read'])),
  };

  static readonly DEFAULT_APPROVAL_TIERS: Record<string, number> = {
    OWNER: 4,
    ADMIN: 3,
    STAFF: 0,
  };

  private resolveScopes(membership: { role: string; permissionScopes: unknown }): Record<string, string> {
    if (membership.permissionScopes && typeof membership.permissionScopes === 'object') {
      return membership.permissionScopes as Record<string, string>;
    }
    return IdentityService.DEFAULT_SCOPES[membership.role] ?? IdentityService.DEFAULT_SCOPES.STAFF;
  }

  private resolveApprovalTier(membership: { role: string; maxApprovalTier: number | null; permissionScopes?: unknown }): number {
    const hasCustomScopes = membership.permissionScopes !== null && membership.permissionScopes !== undefined;
    if (membership.maxApprovalTier !== null && membership.maxApprovalTier !== undefined) {
      if (hasCustomScopes || membership.maxApprovalTier !== 0) {
        return membership.maxApprovalTier;
      }
    }
    return IdentityService.DEFAULT_APPROVAL_TIERS[membership.role] ?? 0;
  }

  private async assertTeamAdmin(businessId: string, requesterId: string): Promise<void> {
    const requester = await this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId: requesterId, businessId } },
    });
    if (!requester) throw new ForbiddenException('You are not a member of this business');
    if (requester.role === 'OWNER') return;
    const user = await this.prisma.client.user.findUnique({ where: { id: requesterId } });
    if (user?.role === 'SUPER_ADMIN') return;
    const scopes = this.resolveScopes(requester);
    if (scopes.team !== 'admin' && scopes.team !== 'write') {
      throw new ForbiddenException('You do not have permission to manage team members');
    }
  }

  async listTeamMembers(businessId: string) {
    const members = await this.prisma.client.membership.findMany({
      where: { businessId },
      include: {
        user: { select: { id: true, email: true, name: true, firstName: true, lastName: true, avatarUrl: true } },
        orgAssignments: {
          where: { endedAt: null, isPrimary: true },
          include: { orgUnit: true, jobRole: true },
          take: 1,
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((m) => ({
      ...m,
      permissionScopes: this.resolveScopes(m),
      maxApprovalTier: this.resolveApprovalTier(m),
      orgUnit: m.orgAssignments[0]?.orgUnit?.name ?? null,
      jobRole: m.orgAssignments[0]?.jobRole?.name ?? null,
      orgUnitId: m.orgAssignments[0]?.orgUnitId ?? null,
      jobRoleId: m.orgAssignments[0]?.jobRoleId ?? null,
    }));
  }

  async inviteTeamMember(businessId: string, email: string, role: string, inviterId: string, scopes?: Record<string, string>, maxApprovalTier?: number) {
    await this.assertTeamAdmin(businessId, inviterId);
    this.validateRole(role);
    if (scopes || maxApprovalTier !== undefined) {
      this.validateScopesPayload(
        scopes ?? (IdentityService.DEFAULT_SCOPES[role] || IdentityService.DEFAULT_SCOPES.STAFF),
        maxApprovalTier ?? (IdentityService.DEFAULT_APPROVAL_TIERS[role] || 0),
      );
    }
    let user = await this.prisma.client.user.findUnique({ where: { email } });
    if (!user) {
      user = await this.prisma.client.user.create({
        data: { email, name: email.split('@')[0], role: 'USER' },
      });
    }
    const existing = await this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId: user.id, businessId } },
    });
    if (existing) throw new BadRequestException('User is already a team member');
    const membership = await this.prisma.client.membership.create({
      data: {
        userId: user.id,
        businessId,
        role,
        permissionScopes: scopes ?? (IdentityService.DEFAULT_SCOPES[role] || IdentityService.DEFAULT_SCOPES.STAFF),
        maxApprovalTier: maxApprovalTier ?? (IdentityService.DEFAULT_APPROVAL_TIERS[role] || 0),
      },
      include: { user: { select: { id: true, email: true, name: true, firstName: true, lastName: true, avatarUrl: true } } },
    });
    await this.logTeamActivity(businessId, inviterId, 'team', 'member_invited', 'membership', membership.id, `Invited ${email} as ${role}`, undefined, { invitedEmail: email, role });
    return membership;
  }

  async removeTeamMember(businessId: string, membershipId: string, requesterId: string) {
    await this.assertTeamAdmin(businessId, requesterId);
    const membership = await this.prisma.client.membership.findUnique({
      where: { id: membershipId },
      include: { user: { select: { email: true } } },
    });
    if (!membership || membership.businessId !== businessId) {
      throw new NotFoundException('Membership not found');
    }
    if (membership.role === 'OWNER') {
      throw new BadRequestException('Cannot remove the owner');
    }
    await this.prisma.client.membership.delete({ where: { id: membershipId } });
    await this.logTeamActivity(businessId, requesterId, 'team', 'member_removed', 'membership', membershipId, `Removed ${membership.user.email} from team`, undefined, { removedEmail: membership.user.email });
    return { success: true };
  }

  async updateMemberRole(businessId: string, membershipId: string, role: string, requesterId?: string) {
    this.validateRole(role);
    if (requesterId) await this.assertTeamAdmin(businessId, requesterId);
    const membership = await this.prisma.client.membership.findUnique({
      where: { id: membershipId },
    });
    if (!membership || membership.businessId !== businessId) {
      throw new NotFoundException('Membership not found');
    }
    if (membership.role === 'OWNER') {
      throw new BadRequestException('Cannot change owner role');
    }
    const updated = await this.prisma.client.membership.update({
      where: { id: membershipId },
      data: {
        role,
        permissionScopes: IdentityService.DEFAULT_SCOPES[role] || IdentityService.DEFAULT_SCOPES.STAFF,
        maxApprovalTier: IdentityService.DEFAULT_APPROVAL_TIERS[role] || 0,
      },
      include: { user: { select: { id: true, email: true, name: true, firstName: true, lastName: true, avatarUrl: true } } },
    });
    if (requesterId) {
      await this.logTeamActivity(businessId, requesterId, 'team', 'role_changed', 'membership', membershipId, `Changed ${updated.user.email} role to ${role}`, undefined, { newRole: role });
    }
    return updated;
  }

  private static readonly ASSIGNABLE_ROLES = ['ADMIN', 'STAFF'] as const;

  private validateRole(role: string): void {
    if (!(IdentityService.ASSIGNABLE_ROLES as readonly string[]).includes(role)) {
      throw new BadRequestException(`Invalid role: ${role}. Allowed roles: ${IdentityService.ASSIGNABLE_ROLES.join(', ')}`);
    }
  }

  private validateScopesPayload(scopes: Record<string, string>, tier: number): void {
    const validLevels = new Set(['none', 'read', 'write', 'admin']);
    const validModules = new Set(IdentityService.PERMISSION_MODULES as readonly string[]);
    // M7 CRM ownership sub-permissions layered on top of the per-module level.
    const crmExtraKeys: Record<string, Set<string>> = {
      crm_view: new Set(['all', 'owned']),
      crm_edit: new Set(['any', 'owned', 'none']),
      crm_reassign: new Set(['true', 'false', 'yes', 'no']),
      crm_delete: new Set(['any', 'owned', 'none']),
    };
    for (const [key, value] of Object.entries(scopes)) {
      if (validModules.has(key)) {
        if (!validLevels.has(value)) throw new BadRequestException(`Invalid permission level: ${value} for module ${key}`);
        continue;
      }
      const allowed = crmExtraKeys[key];
      if (allowed) {
        if (!allowed.has(value)) throw new BadRequestException(`Invalid value '${value}' for ${key}`);
        continue;
      }
      throw new BadRequestException(`Invalid module: ${key}`);
    }
    if (typeof tier !== 'number' || tier < 0 || tier > 4 || !Number.isInteger(tier)) {
      throw new BadRequestException('maxApprovalTier must be an integer between 0 and 4');
    }
  }

  async updateMemberPermissions(businessId: string, membershipId: string, scopes: Record<string, string>, maxApprovalTier: number, requesterId: string) {
    await this.assertTeamAdmin(businessId, requesterId);
    this.validateScopesPayload(scopes, maxApprovalTier);
    const membership = await this.prisma.client.membership.findUnique({
      where: { id: membershipId },
    });
    if (!membership || membership.businessId !== businessId) {
      throw new NotFoundException('Membership not found');
    }
    if (membership.role === 'OWNER') {
      throw new BadRequestException('Cannot modify owner permissions');
    }
    const updated = await this.prisma.client.membership.update({
      where: { id: membershipId },
      data: { permissionScopes: scopes, maxApprovalTier },
      include: { user: { select: { id: true, email: true, name: true, firstName: true, lastName: true, avatarUrl: true } } },
    });
    await this.logTeamActivity(businessId, requesterId, 'team', 'permissions_updated', 'membership', membershipId, `Updated permissions for ${updated.user.email}`, undefined, { scopes, maxApprovalTier });
    return {
      ...updated,
      permissionScopes: scopes,
    };
  }

  async logTeamActivity(businessId: string, userId: string, module: string, action: string, entityType?: string, entityId?: string, title?: string, detail?: string, meta?: Record<string, unknown>) {
    try {
      await this.prisma.client.teamActivityLog.create({
        data: {
          businessId,
          userId,
          module,
          action,
          title: title ?? action,
          ...(entityType !== undefined ? { entityType } : {}),
          ...(entityId !== undefined ? { entityId } : {}),
          ...(detail !== undefined ? { detail } : {}),
          ...(meta !== undefined ? { meta } : {}),
        },
      });
    } catch (e) {
      this.logger.warn(`Failed to log team activity: ${e instanceof Error ? e.message : e}`);
    }
  }

  async getTeamActivityFeed(businessId: string, opts: { limit?: number; offset?: number; module?: string; userId?: string }) {
    const where: Record<string, unknown> = { businessId };
    if (opts.module) where.module = opts.module;
    if (opts.userId) where.userId = opts.userId;
    const [items, total] = await Promise.all([
      this.prisma.client.teamActivityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: opts.limit || 50,
        skip: opts.offset || 0,
      }),
      this.prisma.client.teamActivityLog.count({ where }),
    ]);
    return { items, total };
  }

  async getTeamDashboard(businessId: string) {
    const members = await this.listTeamMembers(businessId);
    const [recentActivity, taskCounts] = await Promise.all([
      this.prisma.client.teamActivityLog.findMany({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.client.contactTask.groupBy({
        by: ['assigneeId'],
        where: { businessId, status: 'OPEN', deletedAt: null, assigneeId: { not: null } },
        _count: true,
      }).catch(() => []),
    ]);

    const taskCountMap = new Map<string, number>();
    for (const t of taskCounts) {
      if (t.assigneeId) taskCountMap.set(t.assigneeId, t._count);
    }

    const memberSummaries = members.map((m) => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      user: m.user,
      permissionScopes: m.permissionScopes,
      maxApprovalTier: m.maxApprovalTier,
      activeTasks: taskCountMap.get(m.userId) ?? 0,
      recentActions: recentActivity.filter((a) => a.userId === m.userId).slice(0, 3),
    }));

    return {
      members: memberSummaries,
      totalMembers: members.length,
      recentActivity: recentActivity.slice(0, 10),
      permissionModules: IdentityService.PERMISSION_MODULES,
    };
  }

  async getMemberApprovalTier(businessId: string, userId: string): Promise<number> {
    const membership = await this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId, businessId } },
    });
    if (!membership) return 0;
    return this.resolveApprovalTier(membership);
  }

  async getUser(userId: string) {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, firstName: true, lastName: true, phone: true, avatarUrl: true, role: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /**
   * Migrate an existing local User row from `oldId` to the new Supabase auth id
   * `input.userId`, in a single transaction.
   *
   * Why this exists: Supabase auth.users.id is the source of truth — every
   * subsequent authenticated request will arrive with the Supabase id, so the
   * local row's primary key must match it. We can't simply `UPDATE users SET
   * id = …` because Postgres FKs in this schema are not declared
   * `ON UPDATE CASCADE` and the unique-email constraint blocks creating a
   * second row with the same email. We therefore: (1) park the old user under
   * a placeholder email to free the unique-email slot, (2) create the new
   * user with the desired id and original email, (3) re-point all child
   * references (FK and non-FK), (4) delete the parked row.
   */
  private async reconcileUserId(
    oldId: string,
    input: {
      userId: string;
      email: string;
      username?: string;
      name?: string;
      firstName?: string;
      lastName?: string;
      phone?: string;
      avatarUrl?: string;
    },
  ) {
    const newId = input.userId;
    const desiredName = input.username ?? input.name;
    this.logger.warn(
      `Reconciling User id ${oldId} -> ${newId} for email=${input.email} (Supabase auth id changed).`,
    );

    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const placeholderEmail = `__migrated_${oldId}_${Date.now()}@local.invalid`;
        const oldUser = await tx.user.update({
          where: { id: oldId },
          data: { email: placeholderEmail },
        });

        const newUser = await tx.user.create({
          data: {
            id: newId,
            email: input.email,
            name: oldUser.name ?? desiredName?.trim() ?? input.email,
            role: oldUser.role ?? 'USER',
            firstName: oldUser.firstName ?? input.firstName?.trim() ?? null,
            lastName: oldUser.lastName ?? input.lastName?.trim() ?? null,
            phone: oldUser.phone ?? input.phone?.trim() ?? null,
            avatarUrl: oldUser.avatarUrl ?? input.avatarUrl?.trim() ?? null,
          },
        });

        // FK references to User.id (must be re-pointed before old user delete).
        // These match the relations declared in packages/db/prisma/schema.prisma:
        // Membership.userId, Session.userId, AiExecutionLog.userId,
        // AiApprovalItem.userId, AiApprovalItem.resolvedByUserId, AiPlan.userId.
        await tx.membership.updateMany({ where: { userId: oldId }, data: { userId: newId } });
        await tx.session.updateMany({ where: { userId: oldId }, data: { userId: newId } });
        await tx.aiExecutionLog.updateMany({ where: { userId: oldId }, data: { userId: newId } });
        await tx.aiApprovalItem.updateMany({ where: { userId: oldId }, data: { userId: newId } });
        await tx.aiApprovalItem.updateMany({
          where: { resolvedByUserId: oldId },
          data: { resolvedByUserId: newId },
        });
        await tx.aiPlan.updateMany({ where: { userId: oldId }, data: { userId: newId } });

        // Non-FK references (no constraint declared in schema, but data
        // integrity still matters): Business.ownerId, TeamActivityLog.userId.
        await tx.business.updateMany({ where: { ownerId: oldId }, data: { ownerId: newId } });
        await tx.teamActivityLog.updateMany({ where: { userId: oldId }, data: { userId: newId } });

        await tx.user.delete({ where: { id: oldId } });
        return newUser;
      });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'P2002') {
        this.logger.warn(
          `[bootstrap] email conflict during reconcile (userId=${input.userId})`,
        );
        throw new ConflictException({
          code: 'account_email_conflict',
          message:
            'An account with this email already exists. Please sign in with email and password instead.',
        });
      }
      throw err;
    }
  }

  async bootstrapUser(input: {
    userId: string;
    email: string;
    username?: string;
    name?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    avatarUrl?: string;
    company?: string;
  }) {
    if (input.username) {
      const usernameInUse = await this.prisma.client.user.findFirst({
        where: { name: input.username, NOT: { id: input.userId } },
        select: { id: true },
      });
      if (usernameInUse) {
        throw new BadRequestException('Username is already taken.');
      }
    }

    const desiredName = input.username ?? input.name;

    const existingUser = await this.prisma.client.user.findUnique({ where: { id: input.userId } });
    let user;

    if (existingUser) {
      const updateData: Record<string, unknown> = {};
      if (input.firstName && !existingUser.firstName) updateData.firstName = input.firstName.trim();
      if (input.lastName && !existingUser.lastName) updateData.lastName = input.lastName.trim();
      if (input.phone && !existingUser.phone) updateData.phone = input.phone.trim();
      if (input.avatarUrl && !existingUser.avatarUrl) updateData.avatarUrl = input.avatarUrl.trim();
      if (desiredName && !existingUser.name) {
        updateData.name = desiredName.trim();
      }

      if (Object.keys(updateData).length > 0) {
        user = await this.prisma.client.user.update({
          where: { id: input.userId },
          data: updateData,
        });
      } else {
        user = existingUser;
      }
    } else {
      // Look up by email before creating, to handle the case where a local User
      // row already exists under a different id (e.g. earlier email/password
      // signup, or a Supabase user that was recreated with a different id).
      // Without this, the prisma.user.create below would crash with a
      // "Unique constraint failed on (email)" 500 and the OAuth callback page
      // would render "Internal Server Error". See task #308.
      const collidingByEmail = await this.prisma.client.user.findUnique({
        where: { email: input.email },
      });

      if (collidingByEmail && collidingByEmail.id !== input.userId) {
        user = await this.reconcileUserId(collidingByEmail.id, input);
      } else {
        const userData: Record<string, unknown> = {};
        if (input.firstName) userData.firstName = input.firstName.trim();
        if (input.lastName) userData.lastName = input.lastName.trim();
        if (input.phone) userData.phone = input.phone.trim();
        if (input.avatarUrl) userData.avatarUrl = input.avatarUrl.trim();

        try {
          user = await this.prisma.client.user.create({
            data: {
              id: input.userId,
              email: input.email,
              name: desiredName?.trim() ?? input.email,
              role: 'USER',
              ...userData,
            },
          });
        } catch (err) {
          // Defence-in-depth: if a race created a colliding row between the
          // findUnique above and the create here, surface a clean 409 instead
          // of an opaque Prisma 500.
          const code = (err as { code?: string })?.code;
          if (code === 'P2002') {
            this.logger.warn(
              `[bootstrap] email conflict on user create (userId=${input.userId})`,
            );
            throw new ConflictException({
              code: 'account_email_conflict',
              message:
                'An account with this email already exists. Please sign in with email and password instead.',
            });
          }
          throw err;
        }
      }
    }

    const existingBusiness = await this.prisma.client.business.findFirst({
      where: { ownerId: user.id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });

    const businessName = (input.company || `${input.firstName || desiredName}'s Workspace`).trim();

    const business =
      existingBusiness ||
      (await this.prisma.client.business.create({
        data: {
          name: businessName,
          ownerId: user.id,
        },
      }));

    await this.prisma.client.membership.upsert({
      where: {
        userId_businessId: { userId: user.id, businessId: business.id },
      },
      create: {
        userId: user.id,
        businessId: business.id,
        role: 'OWNER',
      },
      update: {
        role: 'OWNER',
      },
    });

    return { user, business };
  }

  async getTieredCompleteness(businessId: string) {
    const [business, guidanceProfile] = await Promise.all([
      this.prisma.client.business.findUnique({ where: { id: businessId } }),
      this.prisma.client.businessGuidanceProfile.findUnique({
        where: { businessId },
        include: {
          identity: true,
          founder: true,
          offer: true,
          customer: true,
          revenue: true,
          finance: true,
          operations: true,
          compliance: true,
          growth: true,
          goals: true,
          sales: true,
          marketingStrategy: true,
          people: true,
          technology: true,
          partnerships: true,
          intellectualProperty: true,
        },
      }).catch(() => null),
    ]);

    if (!business) throw new NotFoundException('Business not found');

    const subProfiles: Record<string, unknown> = {};
    if (guidanceProfile) {
      subProfiles.identity = guidanceProfile.identity;
      subProfiles.founder = guidanceProfile.founder;
      subProfiles.offer = guidanceProfile.offer;
      subProfiles.customer = guidanceProfile.customer;
      subProfiles.revenue = guidanceProfile.revenue;
      subProfiles.finance = guidanceProfile.finance;
      subProfiles.operations = guidanceProfile.operations;
      subProfiles.compliance = guidanceProfile.compliance;
      subProfiles.growth = guidanceProfile.growth;
      subProfiles.goals = guidanceProfile.goals;
      subProfiles.sales = guidanceProfile.sales;
      subProfiles.marketingStrategy = guidanceProfile.marketingStrategy;
      subProfiles.people = guidanceProfile.people;
      subProfiles.technology = guidanceProfile.technology;
      subProfiles.partnerships = guidanceProfile.partnerships;
      subProfiles.intellectualProperty = guidanceProfile.intellectualProperty;
    }

    return computeTieredCompleteness(
      {
        name: business.name,
        logoUrl: business.logoUrl,
        headline: business.headline,
        bio: business.bio,
        industry: business.industry,
        skills: business.skills as string[] | null,
        businessStage: business.businessStage,
        city: business.city,
        country: business.country,
        interests: business.interests as string[] | null,
        tagline: business.tagline,
        description: business.description,
      },
      subProfiles as Record<string, Record<string, unknown> | null | undefined>,
    );
  }

  async getProgressivePrompts(businessId: string) {
    const guidanceProfile = await this.prisma.client.businessGuidanceProfile.findUnique({
      where: { businessId },
      include: {
        identity: true,
        founder: true,
        offer: true,
        customer: true,
        revenue: true,
        finance: true,
        operations: true,
        compliance: true,
        growth: true,
        goals: true,
        sales: true,
        marketingStrategy: true,
        people: true,
        technology: true,
        partnerships: true,
        intellectualProperty: true,
      },
    }).catch(() => null);

    const completedProfiles = new Set<string>();
    if (guidanceProfile) {
      const profileMap: Record<string, unknown> = {
        identity: guidanceProfile.identity,
        founder: guidanceProfile.founder,
        offer: guidanceProfile.offer,
        customer: guidanceProfile.customer,
        revenue: guidanceProfile.revenue,
        finance: guidanceProfile.finance,
        operations: guidanceProfile.operations,
        compliance: guidanceProfile.compliance,
        growth: guidanceProfile.growth,
        goals: guidanceProfile.goals,
        sales: guidanceProfile.sales,
        marketingStrategy: guidanceProfile.marketingStrategy,
        people: guidanceProfile.people,
        technology: guidanceProfile.technology,
        partnerships: guidanceProfile.partnerships,
        intellectualProperty: guidanceProfile.intellectualProperty,
      };

      for (const [key, value] of Object.entries(profileMap)) {
        if (value && typeof value === 'object') {
          const record = value as Record<string, unknown>;
          const skip = new Set(['id', 'guidanceProfileId', 'createdAt', 'updatedAt', 'notes']);
          const fields = Object.entries(record).filter(([k]) => !skip.has(k));
          const filled = fields.filter(([, v]) => {
            if (v == null || v === '' || v === false) return false;
            if (Array.isArray(v) && v.length === 0) return false;
            return true;
          });
          if (filled.length >= 2) completedProfiles.add(key);
        }
      }
    }

    const [invoiceCount, contactCount, bookingCount, docCount, expenseCount, memberCount, storeEnabled, campaignCount] = await Promise.all([
      this.prisma.client.invoice.count({ where: { businessId, deletedAt: null }, take: 1 }).catch(() => 0),
      this.prisma.client.contact.count({ where: { businessId, deletedAt: null }, take: 1 }).catch(() => 0),
      this.prisma.client.booking.count({ where: { businessId, deletedAt: null }, take: 1 }).catch(() => 0),
      this.prisma.client.documentInstance.count({ where: { businessId } }).catch(() => 0),
      this.prisma.client.expense.count({ where: { businessId, deletedAt: null }, take: 1 }).catch(() => 0),
      this.prisma.client.membership.count({ where: { businessId } }).catch(() => 0),
      this.prisma.client.business.findUnique({ where: { id: businessId }, select: { storeEnabled: true } }).then(b => b?.storeEnabled || false).catch(() => false),
      this.prisma.client.campaignBriefing.count({ where: { businessId } }).catch(() => 0),
    ]);

    const activeTriggers = new Set<string>();
    if (invoiceCount > 0) activeTriggers.add('first_invoice');
    if (contactCount > 0) activeTriggers.add('first_contact');
    if (bookingCount > 0) activeTriggers.add('first_booking');
    if (docCount > 0) activeTriggers.add('first_document');
    if (expenseCount > 0) activeTriggers.add('first_expense');
    if (memberCount > 1) activeTriggers.add('first_team_member');
    if (storeEnabled) activeTriggers.add('store_enabled');
    if (campaignCount > 0) activeTriggers.add('first_campaign');

    return PROGRESSIVE_DEEPENING_PROMPTS.filter(p => {
      if (!activeTriggers.has(p.trigger)) return false;
      if (completedProfiles.has(p.subProfile)) return false;
      return true;
    });
  }

  async getGuidanceSubProfile(businessId: string, subProfileName: string) {
    const guidanceProfile = await this.prisma.client.businessGuidanceProfile.findUnique({
      where: { businessId },
    });

    if (!guidanceProfile) return null;

    const validNames = [
      'identity', 'founder', 'offer', 'customer', 'revenue', 'finance',
      'operations', 'compliance', 'growth', 'goals', 'sales', 'marketingStrategy',
      'people', 'technology', 'partnerships', 'intellectualProperty',
    ];
    if (!validNames.includes(subProfileName)) {
      throw new BadRequestException(`Invalid sub-profile name: ${subProfileName}`);
    }

    const full = await this.prisma.client.businessGuidanceProfile.findUnique({
      where: { businessId },
      include: { [subProfileName]: true },
    });

    return (full as Record<string, unknown>)?.[subProfileName] || null;
  }

  async upsertGuidanceSubProfile(businessId: string, subProfileName: string, data: Record<string, unknown>) {
    const validNames = [
      'identity', 'founder', 'offer', 'customer', 'revenue', 'finance',
      'operations', 'compliance', 'growth', 'goals', 'sales', 'marketingStrategy',
      'people', 'technology', 'partnerships', 'intellectualProperty',
    ];
    if (!validNames.includes(subProfileName)) {
      throw new BadRequestException(`Invalid sub-profile name: ${subProfileName}`);
    }

    let guidanceProfile = await this.prisma.client.businessGuidanceProfile.findUnique({
      where: { businessId },
    });

    if (!guidanceProfile) {
      guidanceProfile = await this.prisma.client.businessGuidanceProfile.create({
        data: { businessId },
      });
    }

    const { id, guidanceProfileId, createdAt, updatedAt, ...rawData } = data as Record<string, unknown>;
    const cleanData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawData)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || Array.isArray(value) || value === null) {
        cleanData[key] = value;
      }
    }

    const gpId = guidanceProfile.id;
    type PrismaDelegate = {
      findUnique(args: { where: { guidanceProfileId: string } }): Promise<unknown>;
      update(args: { where: { guidanceProfileId: string }; data: Record<string, unknown> }): Promise<unknown>;
      create(args: { data: Record<string, unknown> }): Promise<unknown>;
    };
    const upsertFor = (delegate: PrismaDelegate) =>
      delegate.findUnique({ where: { guidanceProfileId: gpId } }).then((existing: unknown) =>
        existing
          ? delegate.update({ where: { guidanceProfileId: gpId }, data: cleanData })
          : delegate.create({ data: { ...cleanData, guidanceProfileId: gpId } }),
      );

    const db = this.prisma.client;
    switch (subProfileName) {
      case 'identity': return upsertFor(db.businessIdentityProfile);
      case 'founder': return upsertFor(db.founderProfile);
      case 'offer': return upsertFor(db.offerProfile);
      case 'customer': return upsertFor(db.customerProfile);
      case 'revenue': return upsertFor(db.revenueProfile);
      case 'finance': return upsertFor(db.financeProfile);
      case 'operations': return upsertFor(db.operationsProfile);
      case 'compliance': return upsertFor(db.complianceGuidanceProfile);
      case 'growth': return upsertFor(db.growthProfile);
      case 'goals': return upsertFor(db.goalsProfile);
      case 'sales': return upsertFor(db.salesProfile);
      case 'marketingStrategy': return upsertFor(db.marketingStrategyProfile);
      case 'people': return upsertFor(db.peopleProfile);
      case 'technology': return upsertFor(db.technologyProfile);
      case 'partnerships': return upsertFor(db.partnershipsProfile);
      case 'intellectualProperty': return upsertFor(db.intellectualPropertyProfile);
      default: throw new BadRequestException(`Model not found for sub-profile: ${subProfileName}`);
    }
  }

  private async detectDocumentImpact(businessId: string, changedFields: string[], businessName: string) {
    const rules = await this.prisma.client.impactRule.findMany({
      where: { profileField: { in: changedFields } },
    });
    if (rules.length === 0) return;

    const docTypeIds = [...new Set(rules.map((r) => r.documentTypeId))];
    const affected = await this.prisma.client.documentInstance.findMany({
      where: { businessId, documentTypeId: { in: docTypeIds }, status: { not: 'ARCHIVED' } },
    });

    for (const doc of affected) {
      await this.prisma.client.documentInstance.update({
        where: { id: doc.id },
        data: {
          healthStatus: 'IMPACTED',
          healthReason: `Profile field(s) changed: ${changedFields.join(', ')}`,
        },
      });
    }

    if (affected.length > 0) {
      this.logger.log(
        `Document impact: ${affected.length} document(s) affected by profile change [${changedFields.join(', ')}] for business "${businessName}" (${businessId})`,
      );
    }
  }
}
