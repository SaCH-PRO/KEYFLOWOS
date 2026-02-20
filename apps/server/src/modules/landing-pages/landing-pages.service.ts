import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class LandingPagesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async listPages(businessId: string) {
    return this.prisma.client.landingPage.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPage(businessId: string, id: string) {
    return this.prisma.client.landingPage.findFirst({
      where: { id, businessId, deletedAt: null },
    });
  }

  async getPublicPage(businessId: string, slug: string) {
    return this.prisma.client.landingPage.findFirst({
      where: { businessId, slug, isPublished: true, deletedAt: null },
    });
  }

  async createPage(input: {
    businessId: string;
    title: string;
    slug: string;
    template?: string;
    sections: any;
    settings?: any;
  }) {
    return this.prisma.client.landingPage.create({
      data: {
        businessId: input.businessId,
        title: input.title,
        slug: input.slug,
        template: input.template ?? 'default',
        sections: input.sections,
        settings: input.settings ?? null,
      },
    });
  }

  async updatePage(input: {
    businessId: string;
    id: string;
    title?: string;
    slug?: string;
    template?: string;
    sections?: any;
    settings?: any;
  }) {
    return this.prisma.client.landingPage.update({
      where: { id: input.id, businessId: input.businessId },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.slug !== undefined && { slug: input.slug }),
        ...(input.template !== undefined && { template: input.template }),
        ...(input.sections !== undefined && { sections: input.sections }),
        ...(input.settings !== undefined && { settings: input.settings }),
      },
    });
  }

  async deletePage(businessId: string, id: string) {
    return this.prisma.client.landingPage.update({
      where: { id, businessId },
      data: { deletedAt: new Date() },
    });
  }

  async togglePublish(businessId: string, id: string) {
    const page = await this.prisma.client.landingPage.findFirst({
      where: { id, businessId, deletedAt: null },
    });
    if (!page) return null;

    return this.prisma.client.landingPage.update({
      where: { id },
      data: { isPublished: !page.isPublished },
    });
  }
}
