import { BadRequestException, Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { computeProfileCompleteness } from './profile-completeness.constants';

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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
    metaData?: Record<string, any>;
    headline?: string;
    bio?: string;
    skills?: string[];
    businessStage?: string;
    interests?: string[];
    teamSize?: string;
  }) {
    if (input.slug) {
      const existing = await this.prisma.client.business.findFirst({
        where: { slug: input.slug.trim(), NOT: { id: businessId } },
      });
      if (existing) throw new BadRequestException('Slug is already taken');
    }

    const oldBusiness = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!oldBusiness) throw new NotFoundException('Business not found');

    const { lastHealthCheck, metaData, ...rest } = input;

    const stringFields: (keyof typeof rest)[] = [
      'name', 'slug', 'timezone', 'currency', 'logoUrl', 'address', 'phone',
      'email', 'website', 'facebook', 'instagram', 'twitter', 'linkedin',
      'tiktok', 'youtube', 'whatsapp', 'primaryColor', 'secondaryColor',
      'complianceStatus', 'tagline', 'description', 'city', 'country',
      'industry', 'headline', 'bio', 'businessStage', 'teamSize',
    ];

    const data: Record<string, unknown> = {};
    for (const key of stringFields) {
      if (rest[key] !== undefined) {
        const val = rest[key];
        data[key] = typeof val === 'string' ? val.trim() : val;
      }
    }

    const nonStringFields: (keyof typeof rest)[] = [
      'defaultTaxRate', 'complianceData', 'storeEnabled', 'businessHours', 'onboardingComplete',
    ];
    for (const key of nonStringFields) {
      if (rest[key] !== undefined) {
        data[key] = rest[key];
      }
    }

    if (rest.skills !== undefined) {
      data.skills = rest.skills.map((s) => s.trim());
    }
    if (rest.interests !== undefined) {
      data.interests = rest.interests.map((s) => s.trim());
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
    }

    return result;
  }

  async getBusinessCommunityProfile(businessId: string) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        name: true,
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
        createdAt: true,
        _count: {
          select: {
            communityPosts: true,
            cohortMembers: true,
          },
        },
      },
    });
    if (!business) throw new NotFoundException('Business not found');
    return business;
  }

  async listTeamMembers(businessId: string) {
    return this.prisma.client.membership.findMany({
      where: { businessId },
      include: { user: { select: { id: true, email: true, name: true, firstName: true, lastName: true } } },
    });
  }

  async inviteTeamMember(businessId: string, email: string, role: string, inviterId: string) {
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
    return this.prisma.client.membership.create({
      data: { userId: user.id, businessId, role },
      include: { user: { select: { id: true, email: true, name: true, firstName: true, lastName: true } } },
    });
  }

  async removeTeamMember(businessId: string, membershipId: string, requesterId: string) {
    const membership = await this.prisma.client.membership.findUnique({
      where: { id: membershipId },
    });
    if (!membership || membership.businessId !== businessId) {
      throw new NotFoundException('Membership not found');
    }
    if (membership.role === 'OWNER') {
      throw new BadRequestException('Cannot remove the owner');
    }
    await this.prisma.client.membership.delete({ where: { id: membershipId } });
    return { success: true };
  }

  async updateMemberRole(businessId: string, membershipId: string, role: string) {
    const membership = await this.prisma.client.membership.findUnique({
      where: { id: membershipId },
    });
    if (!membership || membership.businessId !== businessId) {
      throw new NotFoundException('Membership not found');
    }
    if (membership.role === 'OWNER') {
      throw new BadRequestException('Cannot change owner role');
    }
    return this.prisma.client.membership.update({
      where: { id: membershipId },
      data: { role },
      include: { user: { select: { id: true, email: true, name: true, firstName: true, lastName: true } } },
    });
  }

  async getUser(userId: string) {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, firstName: true, lastName: true, phone: true, avatarUrl: true, role: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
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
      const userData: Record<string, unknown> = {};
      if (input.firstName) userData.firstName = input.firstName.trim();
      if (input.lastName) userData.lastName = input.lastName.trim();
      if (input.phone) userData.phone = input.phone.trim();
      if (input.avatarUrl) userData.avatarUrl = input.avatarUrl.trim();

      user = await this.prisma.client.user.create({
        data: {
          id: input.userId,
          email: input.email,
          name: desiredName?.trim() ?? input.email,
          role: 'USER',
          ...userData,
        },
      });
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
