import { Injectable } from '@nestjs/common';
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
}
