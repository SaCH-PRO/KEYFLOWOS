import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface CreateAssetInput {
  businessId: string;
  name: string;
  type: string;
  url: string;
  storageKey: string;
  mimeType?: string;
  sizeBytes?: number;
  tags?: string[];
  folder?: string;
  permissions?: string;
  uploadedBy: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateAssetInput {
  name?: string;
  type?: string;
  tags?: string[];
  folder?: string;
  permissions?: string;
  usageCount?: number;
}

export interface ListAssetsFilter {
  type?: string;
  folder?: string;
  tag?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface TrackUsageInput {
  usedInType: string;
  usedInId: string;
}

@Injectable()
export class AssetService {
  private readonly logger = new Logger(AssetService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly emitter: EventEmitter2,
  ) {}

  async createAsset(input: CreateAssetInput) {
    const asset = await this.prisma.client.asset.create({
      data: {
        businessId: input.businessId,
        name: input.name,
        type: input.type,
        url: input.url,
        storageKey: input.storageKey,
        mimeType: input.mimeType ?? null,
        sizeBytes: input.sizeBytes ?? null,
        tags: input.tags ?? [],
        folder: input.folder ?? 'uncategorized',
        permissions: input.permissions ?? 'team',
        uploadedBy: input.uploadedBy,
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
    });

    this.emitter.emit('asset.created', {
      businessId: input.businessId,
      assetId: asset.id,
      type: asset.type,
    });

    return asset;
  }

  async getAsset(id: string) {
    const asset = await this.prisma.client.asset.findUnique({
      where: { id },
    });
    if (!asset) {
      throw new NotFoundException('Asset not found');
    }
    return asset;
  }

  async listAssets(businessId: string, filters?: ListAssetsFilter) {
    const where: any = { businessId };

    if (filters?.type) {
      where.type = filters.type;
    }
    if (filters?.folder) {
      where.folder = filters.folder;
    }
    if (filters?.tag) {
      where.tags = { has: filters.tag };
    }
    if (filters?.search) {
      where.name = { contains: filters.search, mode: 'insensitive' };
    }

    const [items, total] = await Promise.all([
      this.prisma.client.asset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filters?.offset ?? 0,
        take: filters?.limit ?? 50,
      }),
      this.prisma.client.asset.count({ where }),
    ]);

    return { items, total, offset: filters?.offset ?? 0, limit: filters?.limit ?? 50 };
  }

  async updateAsset(id: string, input: UpdateAssetInput) {
    const existing = await this.getAsset(id);

    const updated = await this.prisma.client.asset.update({
      where: { id },
      data: {
        name: input.name ?? existing.name,
        type: input.type ?? existing.type,
        tags: input.tags ?? existing.tags,
        folder: input.folder ?? existing.folder,
        permissions: input.permissions ?? existing.permissions,
        usageCount: input.usageCount ?? existing.usageCount,
      },
    });

    this.emitter.emit('asset.updated', {
      businessId: existing.businessId,
      assetId: id,
    });

    return updated;
  }

  async tagAsset(id: string, tags: string[]) {
    const existing = await this.getAsset(id);

    const updatedTags = Array.from(new Set([...existing.tags, ...tags]));

    const updated = await this.prisma.client.asset.update({
      where: { id },
      data: { tags: updatedTags },
    });

    this.emitter.emit('asset.tagged', {
      businessId: existing.businessId,
      assetId: id,
      tags: updatedTags,
    });

    return updated;
  }

  async untagAsset(id: string, tags: string[]) {
    const existing = await this.getAsset(id);

    const updatedTags = existing.tags.filter((t: string) => !tags.includes(t));

    const updated = await this.prisma.client.asset.update({
      where: { id },
      data: { tags: updatedTags },
    });

    return updated;
  }

  async trackUsage(id: string, input: TrackUsageInput) {
    const existing = await this.getAsset(id);

    const updated = await this.prisma.client.asset.update({
      where: { id },
      data: {
        usageCount: { increment: 1 },
        metadata: {
          ...((existing.metadata ?? {}) as Record<string, unknown>),
          lastUsedAt: new Date().toISOString(),
          lastUsedIn: { type: input.usedInType, id: input.usedInId },
        },
      },
    });

    this.emitter.emit('asset.used', {
      businessId: existing.businessId,
      assetId: id,
      usedInType: input.usedInType,
      usedInId: input.usedInId,
    });

    return updated;
  }

  async deleteAsset(id: string) {
    const existing = await this.getAsset(id);

    await this.prisma.client.asset.delete({ where: { id } });

    this.emitter.emit('asset.deleted', {
      businessId: existing.businessId,
      assetId: id,
    });

    return { success: true };
  }

  async getFolders(businessId: string) {
    const assets = await this.prisma.client.asset.findMany({
      where: { businessId },
      select: { folder: true },
      distinct: ['folder'],
    });

    return assets.map((a) => a.folder);
  }
}
