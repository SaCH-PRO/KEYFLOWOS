import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

type ConnectionRecord = Awaited<ReturnType<PrismaService['client']['channelConnection']['findFirst']>>;

function stripSecrets(conn: NonNullable<ConnectionRecord>) {
  const { token, refreshToken, ...safe } = conn;
  return safe;
}

function stripSecretsFromDestination(dest: Record<string, unknown>) {
  if (dest.connection && typeof dest.connection === 'object' && dest.connection !== null) {
    const { token, refreshToken, ...safeConn } = dest.connection as Record<string, unknown>;
    return { ...dest, connection: safeConn };
  }
  return dest;
}

@Injectable()
export class ChannelConnectionService {
  private readonly logger = new Logger(ChannelConnectionService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(businessId: string) {
    const connections = await this.prisma.client.channelConnection.findMany({
      where: { businessId },
      include: { destinations: true },
      orderBy: { createdAt: 'desc' },
    });
    return connections.map((c) => stripSecrets(c));
  }

  async get(businessId: string, id: string) {
    const conn = await this.prisma.client.channelConnection.findFirst({
      where: { id, businessId },
      include: { destinations: true },
    });
    return conn ? stripSecrets(conn) : null;
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
    const conn = await this.prisma.client.channelConnection.create({
      data: { businessId, ...data },
      include: { destinations: true },
    });

    if (data.provider?.toUpperCase() === 'EMAIL' && data.accountEmail) {
      await this.upsertDestination(conn.id, businessId, {
        platform: 'EMAIL',
        platformId: data.accountEmail,
        displayName: data.label || data.accountEmail,
        capabilities: ['text', 'html', 'attachments'],
      });
    }

    return stripSecrets(conn);
  }

  async update(businessId: string, id: string, data: {
    label?: string;
    accountEmail?: string;
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
    const updated = await this.prisma.client.channelConnection.update({
      where: { id },
      data,
    });

    if (existing.provider?.toUpperCase() === 'EMAIL' && data.accountEmail) {
      await this.upsertDestination(id, businessId, {
        platform: 'EMAIL',
        platformId: data.accountEmail,
        displayName: data.label || data.accountEmail,
        capabilities: ['text', 'html', 'attachments'],
      });
    }

    return stripSecrets(updated);
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
    const where: { businessId: string; platform?: string; isActive?: boolean } = { businessId };
    if (opts?.platform) where.platform = opts.platform;
    if (opts?.activeOnly) where.isActive = true;
    const destinations = await this.prisma.client.channelDestination.findMany({
      where,
      include: { connection: true },
      orderBy: { createdAt: 'desc' },
    });
    return destinations.map((d) => stripSecretsFromDestination(d as unknown as Record<string, unknown>));
  }

  async getDestination(id: string) {
    const dest = await this.prisma.client.channelDestination.findUnique({
      where: { id },
      include: { connection: true },
    });
    if (!dest) return null;
    return stripSecretsFromDestination(dest as unknown as Record<string, unknown>);
  }

  async updateHealthState(id: string, healthState: string, healthMessage?: string) {
    return this.prisma.client.channelConnection.update({
      where: { id },
      data: { healthState, healthMessage, lastCheckedAt: new Date() },
    });
  }

  async getHealthSummary(businessId: string) {
    const connections = await this.prisma.client.channelConnection.findMany({
      where: { businessId },
      include: { destinations: true },
    });

    const total = connections.length;
    const healthy = connections.filter(c => c.healthState === 'Connected').length;
    const needsAttention = connections.filter(c => ['NeedsRefresh', 'DestinationMissing', 'Disabled'].includes(c.healthState)).length;
    const expired = connections.filter(c => ['Expired', 'MissingPermission', 'Error'].includes(c.healthState)).length;
    const totalDestinations = connections.reduce((sum, c) => sum + c.destinations.length, 0);
    const activeDestinations = connections.reduce((sum, c) => sum + c.destinations.filter(d => d.isActive).length, 0);

    return {
      total,
      healthy,
      needsAttention,
      expired,
      totalDestinations,
      activeDestinations,
      connections: connections.map(c => ({
        id: c.id,
        provider: c.provider,
        label: c.label,
        healthState: c.healthState,
        healthMessage: c.healthMessage,
        lastCheckedAt: c.lastCheckedAt,
        destinationCount: c.destinations.length,
        activeDestinationCount: c.destinations.filter(d => d.isActive).length,
      })),
    };
  }

  async runHealthCheck(businessId: string, id: string) {
    const conn = await this.prisma.client.channelConnection.findFirst({
      where: { id, businessId },
      include: { destinations: true },
    });
    if (!conn) throw new NotFoundException('Connection not found');

    let healthState = 'Connected';
    let healthMessage: string | null = null;

    if (conn.expiresAt && new Date(conn.expiresAt) < new Date()) {
      healthState = 'Expired';
      healthMessage = 'Token has expired. Please reconnect to refresh your credentials.';
    } else if (conn.expiresAt) {
      const hoursUntilExpiry = (new Date(conn.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursUntilExpiry < 24) {
        healthState = 'NeedsRefresh';
        healthMessage = `Token expires in ${Math.round(hoursUntilExpiry)} hours. Consider reconnecting soon.`;
      }
    }

    const isEmail = conn.provider?.toUpperCase() === 'EMAIL';
    if (!isEmail && !conn.token && healthState === 'Connected') {
      healthState = 'Error';
      healthMessage = 'No authentication token found. Please reconnect.';
    }
    if (isEmail && !conn.accountEmail && healthState === 'Connected') {
      healthState = 'Error';
      healthMessage = 'No sender email configured. Update your email sender settings.';
    }

    if (conn.destinations.length === 0 && healthState === 'Connected') {
      healthState = 'DestinationMissing';
      healthMessage = 'No destinations configured. Add a page, account, or email address.';
    }

    const updated = await this.prisma.client.channelConnection.update({
      where: { id },
      data: { healthState, healthMessage, lastCheckedAt: new Date() },
      include: { destinations: true },
    });

    return {
      id: updated.id,
      healthState: updated.healthState,
      healthMessage: updated.healthMessage,
      lastCheckedAt: updated.lastCheckedAt,
      destinations: updated.destinations,
    };
  }

  async syncFromSocial(businessId: string) {
    const socialConnections = await this.prisma.client.socialConnection.findMany({
      where: { businessId },
    });

    const results: { provider: string; connectionId: string; destinations: number }[] = [];

    for (const sc of socialConnections) {
      const provider = (sc.platform || '').toUpperCase();
      if (!provider) continue;

      const existing = await this.prisma.client.channelConnection.findFirst({
        where: { businessId, provider },
      });

      let conn: { id: string };
      if (existing) {
        conn = await this.prisma.client.channelConnection.update({
          where: { id: existing.id },
          data: {
            token: sc.token,
            refreshToken: sc.refreshToken || undefined,
            expiresAt: sc.expiresAt || undefined,
            label: sc.accountName || existing.label,
            healthState: 'Connected',
            healthMessage: null,
            lastCheckedAt: new Date(),
          },
        });
      } else {
        conn = await this.prisma.client.channelConnection.create({
          data: {
            businessId,
            provider,
            token: sc.token,
            refreshToken: sc.refreshToken || undefined,
            expiresAt: sc.expiresAt || undefined,
            label: sc.accountName || provider,
            healthState: 'Connected',
            healthMessage: null,
            lastCheckedAt: new Date(),
          },
        });
      }

      let destCount = 0;

      if (provider === 'FACEBOOK' && sc.platformId) {
        await this.upsertDestination(conn.id, businessId, {
          platform: 'FACEBOOK',
          platformId: sc.platformId,
          displayName: sc.accountName || 'Facebook Page',
          avatarUrl: sc.profilePicture || undefined,
          capabilities: ['text', 'image', 'video', 'link'],
        });
        destCount++;
      }

      if (provider === 'INSTAGRAM' && sc.platformId) {
        await this.upsertDestination(conn.id, businessId, {
          platform: 'INSTAGRAM',
          platformId: sc.platformId,
          displayName: sc.accountName || 'Instagram',
          avatarUrl: sc.profilePicture || undefined,
          capabilities: ['image', 'video', 'carousel'],
        });
        destCount++;
      }

      if (['LINKEDIN', 'TWITTER', 'TIKTOK'].includes(provider) && sc.platformId) {
        await this.upsertDestination(conn.id, businessId, {
          platform: provider,
          platformId: sc.platformId,
          displayName: sc.accountName || provider,
          avatarUrl: sc.profilePicture || undefined,
          capabilities: ['text', 'image', 'video'],
        });
        destCount++;
      }

      results.push({ provider, connectionId: conn.id, destinations: destCount });
      this.logger.log(`Synced social connection ${provider} for business ${businessId}: ${destCount} destinations`);
    }

    return { synced: results.length, results };
  }

  async toggleDestination(businessId: string, destId: string, isActive: boolean) {
    const dest = await this.prisma.client.channelDestination.findFirst({
      where: { id: destId, businessId },
    });
    if (!dest) throw new NotFoundException('Destination not found');

    return this.prisma.client.channelDestination.update({
      where: { id: destId },
      data: { isActive },
    });
  }
}
