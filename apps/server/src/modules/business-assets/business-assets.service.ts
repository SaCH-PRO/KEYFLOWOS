import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { BusinessAssetType } from './dto/create-business-asset.dto';

export interface CreateBusinessAssetInput {
  type: BusinessAssetType;
  name: string;
  status?: string;
  provider?: string;
  url?: string;
  identifier?: string;
  owner?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateBusinessAssetInput {
  type?: string;
  name?: string;
  status?: string;
  provider?: string;
  url?: string;
  identifier?: string;
  owner?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export interface BusinessAssetSummary {
  total: number;
  byType: Record<string, number>;
  risks: string[];
}

@Injectable()
export class BusinessAssetsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  list(businessId: string) {
    return this.prisma.client.businessAsset.findMany({
      where: { businessId, status: { not: 'ARCHIVED' } },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
  }

  async create(businessId: string, input: CreateBusinessAssetInput) {
    return this.prisma.client.businessAsset.create({
      data: {
        businessId,
        type: input.type,
        name: input.name,
        status: input.status ?? 'ACTIVE',
        provider: input.provider,
        url: input.url,
        identifier: input.identifier,
        owner: input.owner,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
        metadata: input.metadata ?? {},
      },
    });
  }

  async update(businessId: string, assetId: string, input: UpdateBusinessAssetInput) {
    const existing = await this.prisma.client.businessAsset.findFirst({
      where: { id: assetId, businessId },
    });
    if (!existing) {
      throw new NotFoundException('Asset not found');
    }

    return this.prisma.client.businessAsset.update({
      where: { id: assetId },
      data: {
        ...(input.type !== undefined && { type: input.type }),
        ...(input.name !== undefined && { name: input.name }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.provider !== undefined && { provider: input.provider }),
        ...(input.url !== undefined && { url: input.url }),
        ...(input.identifier !== undefined && { identifier: input.identifier }),
        ...(input.owner !== undefined && { owner: input.owner }),
        ...(input.expiresAt !== undefined && {
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        }),
        ...(input.metadata !== undefined && { metadata: input.metadata }),
      },
    });
  }

  async remove(businessId: string, assetId: string) {
    const existing = await this.prisma.client.businessAsset.findFirst({
      where: { id: assetId, businessId },
    });
    if (!existing) {
      throw new NotFoundException('Asset not found');
    }

    await this.prisma.client.businessAsset.delete({ where: { id: assetId } });
  }

  async summarizeForGenome(businessId: string): Promise<BusinessAssetSummary> {
    const assets = await this.list(businessId);
    const now = Date.now();
    const thirtyDays = 1000 * 60 * 60 * 24 * 30;

    const byType = assets.reduce<Record<string, number>>((acc, asset) => {
      acc[asset.type] = (acc[asset.type] ?? 0) + 1;
      return acc;
    }, {});

    const risks = assets
      .filter((a) => a.expiresAt && a.expiresAt.getTime() < now + thirtyDays)
      .map((a) => `${a.name} expires ${a.expiresAt!.toLocaleDateString()}`);

    return { total: assets.length, byType, risks };
  }
}
