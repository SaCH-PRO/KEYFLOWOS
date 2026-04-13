import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class ChannelConnectionService {
  private readonly logger = new Logger(ChannelConnectionService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(businessId: string) {
    return this.prisma.client.channelConnection.findMany({
      where: { businessId },
      include: { destinations: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(businessId: string, id: string) {
    return this.prisma.client.channelConnection.findFirst({
      where: { id, businessId },
      include: { destinations: true },
    });
  }

  async create(businessId: string, data: {
    provider: string;
    label?: string;
    accountEmail?: string;
    token?: string;
    refreshToken?: string;
    expiresAt?: Date;
    scopes?: string;
    providerMeta?: Record<string, unknown>;
  }) {
    return this.prisma.client.channelConnection.create({
      data: { businessId, ...data },
      include: { destinations: true },
    });
  }

  async update(businessId: string, id: string, data: {
    label?: string;
    token?: string;
    refreshToken?: string;
    expiresAt?: Date;
    scopes?: string;
    healthState?: string;
    healthMessage?: string;
    lastCheckedAt?: Date;
    providerMeta?: Record<string, unknown>;
  }) {
    const existing = await this.prisma.client.channelConnection.findFirst({ where: { id, businessId } });
    if (!existing) return null;
    return this.prisma.client.channelConnection.update({
      where: { id },
      data,
    });
  }

  async delete(businessId: string, id: string) {
    const conn = await this.prisma.client.channelConnection.findFirst({ where: { id, businessId } });
    if (!conn) return { deleted: false };
    await this.prisma.client.channelConnection.delete({ where: { id } });
    return { deleted: true };
  }

  async upsertDestination(connectionId: string, businessId: string, data: {
    platform: string;
    platformId?: string;
    displayName?: string;
    avatarUrl?: string;
    capabilities?: string[];
    destinationMeta?: Record<string, unknown>;
  }) {
    const connection = await this.prisma.client.channelConnection.findFirst({
      where: { id: connectionId, businessId },
    });
    if (!connection) throw new NotFoundException('Connection not found for this business');

    const existing = await this.prisma.client.channelDestination.findFirst({
      where: { connectionId, platform: data.platform, platformId: data.platformId ?? undefined },
    });

    if (existing) {
      return this.prisma.client.channelDestination.update({
        where: { id: existing.id },
        data: {
          displayName: data.displayName ?? existing.displayName,
          avatarUrl: data.avatarUrl ?? existing.avatarUrl,
          capabilities: data.capabilities ?? existing.capabilities,
          destinationMeta: data.destinationMeta ?? existing.destinationMeta,
        },
      });
    }

    return this.prisma.client.channelDestination.create({
      data: { connectionId, businessId, ...data },
    });
  }

  async listDestinations(businessId: string, opts?: { platform?: string; activeOnly?: boolean }) {
    const where: any = { businessId };
    if (opts?.platform) where.platform = opts.platform;
    if (opts?.activeOnly) where.isActive = true;
    return this.prisma.client.channelDestination.findMany({
      where,
      include: { connection: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDestination(id: string) {
    return this.prisma.client.channelDestination.findUnique({
      where: { id },
      include: { connection: true },
    });
  }

  async updateHealthState(id: string, healthState: string, healthMessage?: string) {
    return this.prisma.client.channelConnection.update({
      where: { id },
      data: { healthState, healthMessage, lastCheckedAt: new Date() },
    });
  }
}
