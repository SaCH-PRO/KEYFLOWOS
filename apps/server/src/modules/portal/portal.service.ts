import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { randomBytes } from 'crypto';

@Injectable()
export class PortalService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  private generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  async createAccess(businessId: string, contactId: string, settings?: Record<string, boolean>) {
    // PortalAccess.contactId is a bare column with no relation, so nothing
    // below would stop a grant in this business from naming another tenant's
    // contact (CF-46). Bind the contact to the tenant first, before the
    // existing-grant lookup, so a legacy foreign row is not refreshed either.
    // A missing, non-string, unknown, soft-deleted or foreign id all answer
    // the same 404.
    const contact =
      typeof contactId === 'string' && contactId.length > 0
        ? await this.prisma.client.contact.findFirst({
            where: { id: contactId, businessId },
            select: { id: true },
          })
        : null;
    if (!contact) throw new NotFoundException('Contact not found');

    const existing = await this.prisma.client.portalAccess.findFirst({
      where: { businessId, contactId },
    });
    if (existing) {
      return this.prisma.client.portalAccess.update({
        where: { id: existing.id },
        data: {
          token: this.generateToken(),
          expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
          enabled: true,
          settings: (settings ?? existing.settings) as any,
        },
      });
    }

    return this.prisma.client.portalAccess.create({
      data: {
        businessId,
        contactId,
        token: this.generateToken(),
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        enabled: true,
        settings: settings ?? {},
      },
    });
  }

  async list(businessId: string) {
    return this.prisma.client.portalAccess.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByToken(token: string) {
    const access = await this.prisma.client.portalAccess.findUnique({
      where: { token },
      include: { business: true },
    });
    if (!access || !access.enabled) return null;
    if (access.expiresAt < new Date()) return null;
    return access;
  }

  async revoke(id: string, businessId: string) {
    const access = await this.prisma.client.portalAccess.findFirst({
      where: { id, businessId },
    });
    if (!access) throw new NotFoundException('Portal access not found');
    return this.prisma.client.portalAccess.update({
      where: { id },
      data: { enabled: false },
    });
  }

  async updateSettings(id: string, businessId: string, settings: Record<string, boolean>) {
    const access = await this.prisma.client.portalAccess.findFirst({
      where: { id, businessId },
    });
    if (!access) throw new NotFoundException('Portal access not found');
    return this.prisma.client.portalAccess.update({
      where: { id },
      data: { settings },
    });
  }

  async recordAccess(token: string) {
    return this.prisma.client.portalAccess.updateMany({
      where: { token },
      data: {
        lastAccessedAt: new Date(),
        accessCount: { increment: 1 },
      },
    });
  }
}
