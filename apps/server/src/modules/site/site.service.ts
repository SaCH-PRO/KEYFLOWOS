import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class SiteService {
  constructor(private readonly prisma: PrismaService) {}

  async getByBusiness(businessId: string) {
    return this.prisma.client.site.findFirst({
      where: { businessId },
    });
  }

  async upsertSite(input: { businessId: string; subdomain: string; siteData?: any }) {
    return this.prisma.client.site.upsert({
      where: { businessId: input.businessId },
      create: {
        businessId: input.businessId,
        subdomain: input.subdomain,
        siteData: input.siteData ?? {},
      },
      update: {
        subdomain: input.subdomain,
        siteData: input.siteData ?? {},
      },
    });
  }

  async getBySubdomain(subdomain: string) {
    const site = await this.prisma.client.site.findFirst({
      where: { subdomain },
      include: { business: true },
    });
    if (!site) throw new NotFoundException('Site not found');
    return site;
  }
}
