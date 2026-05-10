import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
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

    if (data.provider?.toUpperCase() === 'WHATSAPP') {
      await this.discoverWhatsAppDestinations(conn.id, businessId, data.token, data.providerMeta);
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
          destinationMeta: (data.destinationMeta ?? existing.destinationMeta) ?? undefined,
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
          destinationMeta: { accessToken: sc.token },
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
          destinationMeta: { accessToken: sc.token },
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

  async validateEmailSend(businessId: string, input: {
    subject?: string;
    destinationIds?: string[];
    segmentTags?: string[];
    ageGroups?: string[];
  }) {
    const warnings: { field: string; message: string; severity: 'error' | 'warning' }[] = [];

    if (!input.subject?.trim()) {
      warnings.push({ field: 'subject', message: 'Subject line is required for email campaigns', severity: 'error' });
    } else if (input.subject.length > 150) {
      warnings.push({ field: 'subject', message: 'Subject line is too long (max 150 chars)', severity: 'warning' });
    }

    const emailConnections = await this.prisma.client.channelConnection.findMany({
      where: { businessId, provider: { in: ['EMAIL', 'GOOGLE'] } },
      select: { id: true, accountEmail: true, label: true, healthState: true },
    });

    if (input.destinationIds && input.destinationIds.length > 0) {
      const selectedDestinations = await this.prisma.client.channelDestination.findMany({
        where: { id: { in: input.destinationIds }, connection: { businessId } },
        include: { connection: { select: { provider: true, accountEmail: true, healthState: true } } },
      });

      const emailDestinations = selectedDestinations.filter(
        d => d.connection.provider === 'EMAIL' || d.connection.provider === 'GOOGLE',
      );

      if (emailDestinations.length === 0) {
        warnings.push({ field: 'destination', message: 'No email-capable destinations selected', severity: 'warning' });
      }

      const unhealthyDest = emailDestinations.find(d => d.connection.healthState !== 'Connected');
      if (unhealthyDest) {
        warnings.push({ field: 'destination', message: `Selected sender health: ${unhealthyDest.connection.healthState}. Reconnect in Studio.`, severity: 'warning' });
      }
    }

    const hasSender = emailConnections.some(c => c.accountEmail);
    if (!hasSender) {
      warnings.push({ field: 'sender', message: 'No email sender configured. Set up your sender identity in Content Studio.', severity: 'error' });
    }

    const unhealthySender = emailConnections.find(c => c.accountEmail && c.healthState !== 'Connected');
    if (unhealthySender) {
      warnings.push({ field: 'sender', message: `Sender "${unhealthySender.label || unhealthySender.accountEmail}" health: ${unhealthySender.healthState}`, severity: 'warning' });
    }

    const contactWhere: Record<string, unknown> = { businessId, deletedAt: null, email: { not: null } };
    if (input.segmentTags && input.segmentTags.length > 0) {
      contactWhere.tags = { hasSome: input.segmentTags };
    }
    if (input.ageGroups && input.ageGroups.length > 0) {
      contactWhere.ageGroup = { in: input.ageGroups };
    }

    const [totalAudience, suppressedCount] = await Promise.all([
      this.prisma.client.contact.count({ where: contactWhere }),
      this.prisma.client.contact.count({
        where: {
          ...contactWhere,
          OR: [{ doNotContact: true }, { marketingOptIn: false }],
        },
      }),
    ]);

    const eligibleCount = totalAudience - suppressedCount;

    if (totalAudience === 0) {
      warnings.push({ field: 'audience', message: 'No contacts match this audience segment', severity: 'error' });
    } else if (eligibleCount === 0) {
      warnings.push({ field: 'audience', message: 'All matching contacts are suppressed or opted out', severity: 'error' });
    }

    if (suppressedCount > 0 && eligibleCount > 0) {
      warnings.push({ field: 'audience', message: `${suppressedCount} contact(s) will be excluded (unsubscribed/opted out)`, severity: 'warning' });
    }

    return {
      valid: warnings.every(w => w.severity !== 'error'),
      warnings,
      audienceSummary: {
        totalMatching: totalAudience,
        suppressed: suppressedCount,
        eligible: eligibleCount,
      },
      senderConfigured: hasSender,
    };
  }

  async expandAudience(businessId: string, input: {
    segmentTags?: string[];
    ageGroups?: string[];
    limit?: number;
    channel?: string;
  }) {
    const contactWhere: Record<string, unknown> = {
      businessId,
      deletedAt: null,
      doNotContact: { not: true },
      marketingOptIn: { not: false },
    };

    if (input.channel === 'whatsapp') {
      contactWhere.phone = { not: null };
    } else if (input.channel === 'email') {
      contactWhere.email = { not: null };
    } else {
      contactWhere.OR = [{ email: { not: null } }, { phone: { not: null } }];
    }

    if (input.segmentTags && input.segmentTags.length > 0) {
      contactWhere.tags = { hasSome: input.segmentTags };
    }
    if (input.ageGroups && input.ageGroups.length > 0) {
      contactWhere.ageGroup = { in: input.ageGroups };
    }

    const contacts = await this.prisma.client.contact.findMany({
      where: contactWhere,
      select: { id: true, email: true, phone: true, firstName: true, lastName: true, tags: true, ageGroup: true },
      take: input.limit ?? 500,
      orderBy: { createdAt: 'desc' },
    });

    const suppressedCount = await this.prisma.client.contact.count({
      where: {
        businessId,
        deletedAt: null,
        OR: [{ doNotContact: true }, { marketingOptIn: false }],
        ...(input.segmentTags && input.segmentTags.length > 0 ? { tags: { hasSome: input.segmentTags } } : {}),
        ...(input.ageGroups && input.ageGroups.length > 0 ? { ageGroup: { in: input.ageGroups } } : {}),
      },
    });

    const allTags = new Set<string>();
    contacts.forEach(c => c.tags?.forEach((t: string) => allTags.add(t)));

    const withEmail = contacts.filter(c => c.email).length;
    const withPhone = contacts.filter(c => c.phone).length;

    return {
      contacts,
      total: contacts.length,
      withEmail,
      withPhone,
      suppressed: suppressedCount,
      availableTags: Array.from(allTags).sort(),
    };
  }

  async getAudienceHealth(businessId: string) {
    const [totalContacts, withEmail, suppressed, optedIn, tagCounts] = await Promise.all([
      this.prisma.client.contact.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.contact.count({ where: { businessId, deletedAt: null, email: { not: null } } }),
      this.prisma.client.contact.count({
        where: { businessId, deletedAt: null, OR: [{ doNotContact: true }, { marketingOptIn: false }] },
      }),
      this.prisma.client.contact.count({
        where: { businessId, deletedAt: null, email: { not: null }, doNotContact: { not: true }, marketingOptIn: { not: false } },
      }),
      this.prisma.client.contact.findMany({
        where: { businessId, deletedAt: null },
        select: { tags: true, ageGroup: true },
      }),
    ]);

    const segments: Record<string, number> = {};
    const ageGroupCounts: Record<string, number> = {};
    tagCounts.forEach(c => {
      if (c.tags && Array.isArray(c.tags)) {
        (c.tags as string[]).forEach(t => { segments[t] = (segments[t] || 0) + 1; });
      }
      const ag = (c as { ageGroup?: string | null }).ageGroup ?? 'UNKNOWN';
      ageGroupCounts[ag] = (ageGroupCounts[ag] || 0) + 1;
    });

    const sortedSegments = Object.entries(segments)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);

    const sortedAgeGroups = Object.entries(ageGroupCounts)
      .map(([ageGroup, count]) => ({ ageGroup, count }))
      .sort((a, b) => b.count - a.count);

    const emailCoverage = totalContacts > 0 ? Math.round((withEmail / totalContacts) * 100) : 0;
    const deliverabilityRate = withEmail > 0 ? Math.round((optedIn / withEmail) * 100) : 0;

    return {
      totalContacts,
      withEmail,
      suppressed,
      optedIn,
      emailCoverage,
      deliverabilityRate,
      segments: sortedSegments,
      ageGroups: sortedAgeGroups,
    };
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

  async connectWhatsApp(businessId: string, input: {
    accessToken: string;
    waBusinessAccountId: string;
    label?: string;
  }) {
    const { WhatsAppAdapter } = await import('./adapters/whatsapp-adapter');
    const adapter = new WhatsAppAdapter();

    const validation = await adapter.validateConnection({ token: input.accessToken });
    if (!validation.valid) {
      throw new BadRequestException(`WhatsApp connection validation failed: ${validation.error}`);
    }

    const phones = await adapter.listPhoneNumbers(input.accessToken, input.waBusinessAccountId);
    if (phones.length === 0) {
      throw new BadRequestException('No phone numbers found for this WhatsApp Business Account');
    }

    const conn = await this.create(businessId, {
      provider: 'WHATSAPP',
      label: input.label || `WhatsApp (${phones[0].verifiedName})`,
      token: input.accessToken,
      providerMeta: { wabaId: input.waBusinessAccountId },
    });

    return {
      connection: conn,
      phoneNumbers: phones,
    };
  }

  private async discoverWhatsAppDestinations(
    connectionId: string,
    businessId: string,
    token?: string,
    providerMeta?: Record<string, unknown>,
  ) {
    const wabaId = providerMeta?.wabaId as string | undefined;

    if (!token || !wabaId) {
      const phoneNumber = providerMeta?.phoneNumber as string | undefined;
      const phoneNumberId = providerMeta?.phoneNumberId as string | undefined;
      if (phoneNumber && phoneNumberId) {
        await this.upsertDestination(connectionId, businessId, {
          platform: 'WHATSAPP',
          platformId: phoneNumberId,
          displayName: phoneNumber,
          capabilities: ['text', 'template', 'media'],
          destinationMeta: { phoneNumber, phoneNumberId },
        });
      }
      return;
    }

    try {
      const url = `https://graph.facebook.com/v19.0/${wabaId}/phone_numbers`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        this.logger.warn(`WhatsApp phone number discovery failed: ${res.status} ${res.statusText}`);
        return;
      }

      const body = (await res.json()) as {
        data: Array<{
          id: string;
          display_phone_number: string;
          verified_name: string;
          quality_rating: string;
          code_verification_status: string;
        }>;
      };
      const phoneNumbers = body.data ?? [];

      for (const pn of phoneNumbers) {
        await this.upsertDestination(connectionId, businessId, {
          platform: 'WHATSAPP',
          platformId: pn.id,
          displayName: `${pn.verified_name} (${pn.display_phone_number})`,
          capabilities: ['text', 'template', 'media'],
          destinationMeta: {
            phoneNumber: pn.display_phone_number,
            phoneNumberId: pn.id,
            verifiedName: pn.verified_name,
            qualityRating: pn.quality_rating,
          },
        });
      }

      this.logger.log(`Discovered ${phoneNumbers.length} WhatsApp phone number(s) for connection ${connectionId}`);
    } catch (err) {
      this.logger.warn(`WhatsApp destination discovery error: ${(err as Error).message}`);
    }
  }
}
