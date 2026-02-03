import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class IdentityService {
  constructor(private readonly prisma: PrismaService) {}

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

  createBusiness(input: { name: string; ownerId?: string }) {
    return this.prisma.client.business.create({
      data: {
        name: input.name,
        ownerId: input.ownerId ?? '',
      },
    });
  }

  async updateBusiness(businessId: string, input: { name?: string; slug?: string; timezone?: string; currency?: string }) {
    if (input.slug) {
      const existing = await this.prisma.client.business.findFirst({
        where: { slug: input.slug, NOT: { id: businessId } },
      });
      if (existing) throw new BadRequestException('Slug is already taken');
    }
    return this.prisma.client.business.update({
      where: { id: businessId },
      data: input,
    });
  }

  async listTeamMembers(businessId: string) {
    return this.prisma.client.membership.findMany({
      where: { businessId },
      include: { user: { select: { id: true, email: true, name: true } } },
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
      include: { user: { select: { id: true, email: true, name: true } } },
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
      include: { user: { select: { id: true, email: true, name: true } } },
    });
  }

  async bootstrapUser(input: { userId: string; email: string; username?: string; name?: string }) {
    // Enforce unique username (stored in User.name) when provided.
    if (input.username) {
      const usernameInUse = await this.prisma.client.user.findFirst({
        where: { name: input.username, NOT: { id: input.userId } },
        select: { id: true },
      });
      if (usernameInUse) {
        throw new BadRequestException('Username is already taken.');
      }
    }

    const desiredName = input.username ?? input.name ?? input.email;

    // Upsert user record based on Supabase user id.
    const existingUser = await this.prisma.client.user.findUnique({ where: { id: input.userId } });
    let user;
    if (existingUser) {
      if (existingUser.name !== desiredName) {
        user = await this.prisma.client.user.update({
          where: { id: input.userId },
          data: { name: desiredName },
        });
      } else {
        user = existingUser;
      }
    } else {
      user = await this.prisma.client.user.create({
        data: {
          id: input.userId,
          email: input.email,
          name: desiredName,
          role: 'USER',
        },
      });
    }

    // Ensure the user has a personal business (workspace).
    const existingBusiness = await this.prisma.client.business.findFirst({
      where: { ownerId: user.id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });

    const business =
      existingBusiness ||
      (await this.prisma.client.business.create({
        data: {
          name: `${desiredName}'s Workspace`,
          ownerId: user.id,
        },
      }));

    // Link membership (owner).
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
