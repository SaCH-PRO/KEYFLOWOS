import { BadRequestException, Injectable } from '@nestjs/common';
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

  createBusiness(input: { name: string; ownerId?: string }) {
    return this.prisma.client.business.create({
      data: {
        name: input.name,
        ownerId: input.ownerId ?? '',
      },
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
