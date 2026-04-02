import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class IdentityService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  listBusinesses(userId?: string) {
    if (userId) {
      return this.prisma.client.business.findMany({
        where: { ownerId: userId, deletedAt: null },
      });
    }
    return this.prisma.client.business.findMany({ where: { deletedAt: null } });
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

  async updateUser(userId: string, input: { firstName?: string; lastName?: string; phone?: string; name?: string }) {
    const user = await this.prisma.client.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const data: Record<string, unknown> = {};
    if (input.firstName !== undefined) data.firstName = input.firstName;
    if (input.lastName !== undefined) data.lastName = input.lastName;
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.name !== undefined) data.name = input.name;

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

  createBusiness(input: { name: string; ownerId?: string }) {
    return this.prisma.client.business.create({
      data: {
        name: input.name,
        ownerId: input.ownerId ?? '',
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
    metaData?: Record<string, any>;
    headline?: string;
    bio?: string;
    skills?: string[];
    businessStage?: string;
    interests?: string[];
  }) {
    if (input.slug) {
      const existing = await this.prisma.client.business.findFirst({
        where: { slug: input.slug, NOT: { id: businessId } },
      });
      if (existing) throw new BadRequestException('Slug is already taken');
    }
    
    const { lastHealthCheck, metaData, ...rest } = input;
    const data: Record<string, unknown> = { ...rest };
    
    if (lastHealthCheck) {
      data.lastHealthCheck = new Date(lastHealthCheck);
    }

    if (metaData) {
      const existing = await this.prisma.client.business.findUnique({
        where: { id: businessId },
        select: { metaData: true },
      });
      const existingMeta = (existing?.metaData as Record<string, any>) || {};
      data.metaData = { ...existingMeta, ...metaData };
    }
    
    const result = await this.prisma.client.business.update({
      where: { id: businessId },
      data,
    });

    await this.updateProfileCompleteness(businessId);
    return this.prisma.client.business.findUnique({ where: { id: businessId } });
  }

  private async updateProfileCompleteness(businessId: string) {
    const biz = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!biz) return;

    const fields = [
      !!biz.name,
      !!biz.logoUrl,
      !!biz.headline,
      !!biz.bio,
      !!biz.industry,
      biz.skills && biz.skills.length > 0,
      !!biz.businessStage,
      !!biz.city || !!biz.country,
      biz.interests && biz.interests.length > 0,
      !!biz.tagline || !!biz.description,
    ];
    const completeness = Math.round((fields.filter(Boolean).length / fields.length) * 100);

    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { profileCompleteness: completeness },
    });
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
    const userData: Record<string, unknown> = {};
    if (input.firstName) userData.firstName = input.firstName;
    if (input.lastName) userData.lastName = input.lastName;
    if (input.phone) userData.phone = input.phone;
    if (input.avatarUrl) userData.avatarUrl = input.avatarUrl;

    if (existingUser) {
      const updateData: Record<string, unknown> = { ...userData };
      if (desiredName && existingUser.name !== desiredName) {
        updateData.name = desiredName;
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
      user = await this.prisma.client.user.create({
        data: {
          id: input.userId,
          email: input.email,
          name: desiredName ?? input.email,
          role: 'USER',
          ...userData,
        },
      });
    }

    const existingBusiness = await this.prisma.client.business.findFirst({
      where: { ownerId: user.id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });

    const businessName = input.company || `${input.firstName || desiredName}'s Workspace`;

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
}
