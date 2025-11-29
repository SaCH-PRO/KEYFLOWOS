import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class CrmService {
  constructor(private readonly prisma: PrismaService) {}

  listContacts(businessId: string) {
    return this.prisma.client.contact.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  createContact(input: {
    businessId: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
  }) {
    return this.prisma.client.contact.create({
      data: {
        businessId: input.businessId,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
      },
    });
  }

  async findOrCreateContact(
    businessId: string,
    input: { firstName?: string | null; lastName?: string | null; email?: string | null; phone?: string | null },
  ) {
    if (input.email) {
      const existing = await this.prisma.client.contact.findFirst({
        where: { businessId, email: input.email, deletedAt: null },
      });
      if (existing) {
        return existing;
      }
    }
    return this.createContact({ businessId, ...input });
  }
}
