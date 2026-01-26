import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class IdentityService {
  constructor(private readonly prisma: PrismaService) {}

  listBusinesses(userId?: string) {
    if (userId) {
      return this.prisma.client.membership.findMany({
        where: { userId },
        include: { business: true, user: true },
      });
    }
    return this.prisma.client.business.findMany({ where: { deletedAt: null } });
  }

  async createBusiness(input: { name: string; ownerId?: string }) {
    const ownerId = input.ownerId ?? '';
    return this.prisma.client.$transaction(async (tx) => {
      const business = await tx.business.create({
        data: {
          name: input.name,
          ownerId,
        },
      });
      if (ownerId) {
        await tx.membership.create({
          data: {
            userId: ownerId,
            businessId: business.id,
            role: 'OWNER',
          },
        });
      }
      return business;
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

  async listTeam(businessId: string) {
    return this.prisma.client.membership.findMany({
      where: { businessId },
      include: { user: true },
    });
  }

  async inviteMember(input: { businessId: string; email: string; role: string }) {
    const existingUser = await this.prisma.client.user.findFirst({
      where: { email: input.email },
    });
    const user =
      existingUser ||
      (await this.prisma.client.user.create({
        data: {
          email: input.email,
          role: 'USER',
        },
      }));

    const membership = await this.prisma.client.membership.upsert({
      where: { userId_businessId: { userId: user.id, businessId: input.businessId } },
      create: {
        userId: user.id,
        businessId: input.businessId,
        role: input.role,
      },
      update: {
        role: input.role,
      },
      include: { user: true },
    });

    return membership;
  }

  async deleteMembership(input: { membershipId: string }) {
    await this.prisma.client.membership.delete({ where: { id: input.membershipId } });
    return { success: true, id: input.membershipId };
  }
}
