import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class OutboundContentService {
  private readonly logger = new Logger(OutboundContentService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(businessId: string, opts?: { contentType?: string; status?: string; limit?: number }) {
    return this.prisma.client.outboundContent.findMany({
      where: {
        businessId,
        deletedAt: null,
        ...(opts?.contentType ? { contentType: opts.contentType } : {}),
        ...(opts?.status ? { status: opts.status } : {}),
      },
      include: {
        variants: true,
        _count: { select: { deliveries: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: opts?.limit ?? 50,
    });
  }

  async get(businessId: string, id: string) {
    const content = await this.prisma.client.outboundContent.findFirst({
      where: { id, businessId, deletedAt: null },
      include: {
        variants: true,
        deliveries: { include: { destination: true, events: { orderBy: { createdAt: 'desc' }, take: 5 } } },
      },
    });
    if (!content) throw new NotFoundException('Content not found');
    return content;
  }

  async create(businessId: string, data: {
    contentType?: string;
    subject?: string;
    body?: string;
    scheduledAt?: string;
    timezone?: string;
    contentMeta?: Record<string, unknown>;
    variants?: Array<{ platform: string; textBody?: string; htmlBody?: string; mediaUrls?: string[]; variantMeta?: Record<string, unknown> }>;
  }) {
    return this.prisma.client.outboundContent.create({
      data: {
        businessId,
        contentType: data.contentType ?? 'social_post',
        subject: data.subject,
        body: data.body,
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
        timezone: data.timezone ?? 'America/Port_of_Spain',
        contentMeta: data.contentMeta ?? undefined,
        variants: data.variants ? {
          create: data.variants.map(v => ({
            platform: v.platform,
            textBody: v.textBody,
            htmlBody: v.htmlBody,
            mediaUrls: v.mediaUrls ?? [],
            variantMeta: v.variantMeta ?? undefined,
          })),
        } : undefined,
      },
      include: { variants: true },
    });
  }

  async update(businessId: string, id: string, data: {
    subject?: string;
    body?: string;
    status?: string;
    scheduledAt?: string | null;
    timezone?: string;
    contentMeta?: Record<string, unknown>;
  }) {
    const existing = await this.prisma.client.outboundContent.findFirst({ where: { id, businessId, deletedAt: null } });
    if (!existing) throw new NotFoundException('Content not found');

    return this.prisma.client.outboundContent.update({
      where: { id },
      data: {
        ...(data.subject !== undefined ? { subject: data.subject } : {}),
        ...(data.body !== undefined ? { body: data.body } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.scheduledAt !== undefined ? { scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null } : {}),
        ...(data.timezone !== undefined ? { timezone: data.timezone } : {}),
        ...(data.contentMeta !== undefined ? { contentMeta: data.contentMeta } : {}),
      },
      include: { variants: true },
    });
  }

  async delete(businessId: string, id: string) {
    const existing = await this.prisma.client.outboundContent.findFirst({ where: { id, businessId, deletedAt: null } });
    if (!existing) throw new NotFoundException('Content not found');
    return this.prisma.client.outboundContent.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async upsertVariant(businessId: string, contentId: string, data: {
    platform: string;
    textBody?: string;
    htmlBody?: string;
    mediaUrls?: string[];
    variantMeta?: Record<string, unknown>;
    destinationId?: string;
  }) {
    const content = await this.prisma.client.outboundContent.findFirst({
      where: { id: contentId, businessId, deletedAt: null },
    });
    if (!content) throw new NotFoundException('Content not found for this business');

    const meta = { ...(data.variantMeta ?? {}), ...(data.destinationId ? { destinationId: data.destinationId } : {}) };

    const allVariants = await this.prisma.client.outboundVariant.findMany({
      where: { contentId, platform: data.platform },
    });
    const existing = data.destinationId
      ? allVariants.find((v) => {
          const vm = v.variantMeta as Record<string, unknown> | null;
          return vm?.destinationId === data.destinationId;
        })
      : allVariants[0] ?? null;

    if (existing) {
      return this.prisma.client.outboundVariant.update({
        where: { id: existing.id },
        data: {
          textBody: data.textBody ?? existing.textBody,
          htmlBody: data.htmlBody ?? existing.htmlBody,
          mediaUrls: data.mediaUrls ?? existing.mediaUrls,
          variantMeta: Object.keys(meta).length > 0 ? meta : existing.variantMeta,
        },
      });
    }
    return this.prisma.client.outboundVariant.create({
      data: { contentId, platform: data.platform, textBody: data.textBody, htmlBody: data.htmlBody, mediaUrls: data.mediaUrls ?? [], variantMeta: Object.keys(meta).length > 0 ? meta : undefined },
    });
  }
}
