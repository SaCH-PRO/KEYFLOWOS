import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

const businessSelect = {
  id: true, name: true, logoUrl: true, headline: true, industry: true, slug: true,
};

export interface NetworkActivityInput {
  actorBusinessId: string;
  type: string;
  refType?: string;
  refId?: string;
  title: string;
  body?: string;
  metadata?: any;
  visibility?: 'PUBLIC' | 'FOLLOWERS' | 'PRIVATE';
}

@Injectable()
export class NetworkActivityService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async log(input: NetworkActivityInput) {
    return this.prisma.client.networkActivity.create({
      data: {
        actorBusinessId: input.actorBusinessId,
        type: input.type,
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        title: input.title,
        body: input.body ?? null,
        metadata: input.metadata ?? undefined,
        visibility: input.visibility ?? 'PUBLIC',
      },
    });
  }

  async listFeed(filters?: {
    types?: string[];
    actorBusinessId?: string;
    followingOf?: string; // limit to actors followed by this business
    page?: number;
    limit?: number;
  }) {
    const where: any = { visibility: 'PUBLIC' };
    if (filters?.types?.length) where.type = { in: filters.types };
    if (filters?.actorBusinessId) where.actorBusinessId = filters.actorBusinessId;

    if (filters?.followingOf) {
      const conns = await this.prisma.client.networkConnection.findMany({
        where: { fromBusinessId: filters.followingOf, type: 'FOLLOW' },
        select: { toBusinessId: true },
      });
      const ids = conns.map((c) => c.toBusinessId);
      if (ids.length === 0) return { data: [], total: 0, page: 1, limit: filters?.limit ?? 25 };
      where.actorBusinessId = { in: ids };
    }

    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 25;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.client.networkActivity.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { actor: { select: businessSelect } },
        skip,
        take: limit,
      }),
      this.prisma.client.networkActivity.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async listForActor(actorBusinessId: string, limit = 25) {
    return this.prisma.client.networkActivity.findMany({
      where: { actorBusinessId, visibility: 'PUBLIC' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { actor: { select: businessSelect } },
    });
  }
}
