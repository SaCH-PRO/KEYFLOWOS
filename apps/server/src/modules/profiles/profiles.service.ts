import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class ProfilesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getMyProfile(userId: string, email?: string) {
    const contact = await this.prisma.client.contact.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true, email: true, createdAt: true },
    });
    if (!contact) {
      return null;
    }
    const displayName =
      [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim() || contact.email || email || null;
    return { id: contact.id, display_name: displayName, created_at: contact.createdAt };
  }

  async upsertMyProfile(userId: string, email: string, displayName: string) {
    const clean = displayName?.trim();
    if (!clean) throw new BadRequestException('displayName is required');
    const [firstName, ...rest] = clean.split(/\s+/);
    const lastName = rest.join(' ') || null;

    const contact = await this.prisma.client.contact.upsert({
      where: { id: userId },
      create: {
        id: userId,
        businessId: userId,
        firstName,
        lastName,
        email,
        status: 'CLIENT',
      },
      update: {
        firstName,
        lastName,
        ...(email ? { email } : {}),
      },
    });
    return { id: contact.id, display_name: clean, created_at: contact.createdAt };
  }
}
