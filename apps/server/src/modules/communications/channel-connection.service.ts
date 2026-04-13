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

    if (!conn.token && healthState === 'Connected') {
      healthState = 'Error';
      healthMessage = 'No authentication token found. Please reconnect.';
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
            token: sc.accessToken,
            refreshToken: sc.refreshToken || undefined,
            expiresAt: sc.expiresAt || undefined,
            label: sc.accountName || existing.label,
            accountEmail: sc.email || existing.accountEmail,
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
            token: sc.accessToken,
            refreshToken: sc.refreshToken || undefined,
            expiresAt: sc.expiresAt || undefined,
            label: sc.accountName || provider,
            accountEmail: sc.email || undefined,
            healthState: 'Connected',
            healthMessage: null,
            lastCheckedAt: new Date(),
          },
        });
      }

      let destCount = 0;

      if (sc.pages && Array.isArray(sc.pages)) {
        const pages = sc.pages as Array<Record<string, unknown>>;
        for (const page of pages) {
          const pictureData = page.picture as Record<string, unknown> | undefined;
          const pictureInner = pictureData?.data as Record<string, unknown> | undefined;
          await this.upsertDestination(conn.id, businessId, {
            platform: 'FACEBOOK',
            platformId: (page.id || page.pageId) as string | undefined,
            displayName: (page.name || page.pageName || 'Facebook Page') as string,
            avatarUrl: (pictureInner?.url || page.avatarUrl) as string | undefined,
            capabilities: ['text', 'image', 'video', 'link'],
          });
          destCount++;
        }
      }

      if (sc.instagramAccounts && Array.isArray(sc.instagramAccounts)) {
        const igAccounts = sc.instagramAccounts as Array<Record<string, unknown>>;
        for (const ig of igAccounts) {
          await this.upsertDestination(conn.id, businessId, {
            platform: 'INSTAGRAM',
            platformId: (ig.id || ig.igId) as string | undefined,
            displayName: (ig.username || ig.name || 'Instagram') as string,
            avatarUrl: (ig.profilePictureUrl || ig.avatarUrl) as string | undefined,
            capabilities: ['image', 'video', 'carousel'],
          });
          destCount++;
        }
      }

      if (provider === 'GOOGLE' && sc.email) {
        await this.upsertDestination(conn.id, businessId, {
          platform: 'EMAIL',
          platformId: sc.email,
          displayName: sc.accountName || sc.email,
          capabilities: ['text', 'html', 'attachments'],
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
