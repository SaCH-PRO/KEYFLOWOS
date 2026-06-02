import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface ProviderSeed {
  key: string;
  name: string;
  category: string;
  description: string;
  authType: string;
  capabilities: string[];
}

const DEFAULT_PROVIDERS: ProviderSeed[] = [
  {
    key: 'google_forms',
    name: 'Google Forms',
    category: 'forms',
    description: 'Import form responses and map them to contacts and follow-ups.',
    authType: 'oauth2',
    capabilities: ['forms.read', 'contacts.write', 'automation.trigger'],
  },
  {
    key: 'google_contacts',
    name: 'Google Contacts',
    category: 'people',
    description: 'Sync contacts from Google to your KEYFLOWOS network.',
    authType: 'oauth2',
    capabilities: ['contacts.read', 'contacts.write'],
  },
  {
    key: 'google_business_profile',
    name: 'Google Business Profile',
    category: 'presence',
    description: 'Manage reviews, posts, and insights from your Google Business listing.',
    authType: 'oauth2',
    capabilities: ['reviews.read', 'reviews.reply', 'posts.create', 'insights.read'],
  },
  {
    key: 'google_calendar',
    name: 'Google Calendar',
    category: 'calendar',
    description: 'Sync bookings and events with Google Calendar.',
    authType: 'oauth2',
    capabilities: ['calendar.read', 'calendar.write'],
  },
  {
    key: 'google_drive',
    name: 'Google Drive',
    category: 'files',
    description: 'Attach and store documents from Google Drive.',
    authType: 'oauth2',
    capabilities: ['files.read', 'files.write'],
  },
  {
    key: 'outlook_contacts',
    name: 'Outlook Contacts',
    category: 'people',
    description: 'Sync contacts from Microsoft Outlook.',
    authType: 'oauth2',
    capabilities: ['contacts.read', 'contacts.write'],
  },
  {
    key: 'outlook_calendar',
    name: 'Outlook Calendar',
    category: 'calendar',
    description: 'Sync bookings and events with Outlook Calendar.',
    authType: 'oauth2',
    capabilities: ['calendar.read', 'calendar.write'],
  },
  {
    key: 'whatsapp',
    name: 'WhatsApp Business',
    category: 'messaging',
    description: 'Send and receive WhatsApp messages from KEYFLOWOS.',
    authType: 'api_key',
    capabilities: ['messages.send', 'messages.read', 'webhook.receive'],
  },
  {
    key: 'stripe',
    name: 'Stripe',
    category: 'payments',
    description: 'Accept card payments and track payouts.',
    authType: 'api_key',
    capabilities: ['payments.read', 'payments.create', 'webhook.receive'],
  },
  {
    key: 'wipay',
    name: 'WiPay',
    category: 'payments',
    description: 'Accept local Caribbean payments via WiPay.',
    authType: 'api_key',
    capabilities: ['payments.read', 'payments.create', 'webhook.receive'],
  },
  {
    key: 'typeform',
    name: 'Typeform',
    category: 'forms',
    description: 'Import Typeform responses as leads.',
    authType: 'api_key',
    capabilities: ['forms.read', 'contacts.write', 'automation.trigger'],
  },
  {
    key: 'jotform',
    name: 'Jotform',
    category: 'forms',
    description: 'Import Jotform submissions as contacts.',
    authType: 'api_key',
    capabilities: ['forms.read', 'contacts.write', 'automation.trigger'],
  },
  {
    key: 'mailchimp',
    name: 'Mailchimp',
    category: 'marketing',
    description: 'Sync audiences and send email campaigns.',
    authType: 'api_key',
    capabilities: ['contacts.read', 'contacts.write', 'messages.send'],
  },
  {
    key: 'sendgrid',
    name: 'SendGrid',
    category: 'marketing',
    description: 'Send transactional and marketing emails.',
    authType: 'api_key',
    capabilities: ['messages.send'],
  },
  {
    key: 'slack',
    name: 'Slack',
    category: 'automation',
    description: 'Send alerts and notifications to Slack channels.',
    authType: 'oauth2',
    capabilities: ['messages.send', 'automation.trigger'],
  },
  {
    key: 'zapier',
    name: 'Zapier',
    category: 'automation',
    description: 'Trigger automations and connect 5,000+ apps.',
    authType: 'api_key',
    capabilities: ['automation.trigger', 'webhook.receive'],
  },
];

@Injectable()
export class IntegrationHubService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async seedProviders(): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;
    for (const p of DEFAULT_PROVIDERS) {
      const existing = await this.prisma.client.integrationProvider.findUnique({ where: { key: p.key } });
      if (existing) {
        await this.prisma.client.integrationProvider.update({
          where: { key: p.key },
          data: {
            name: p.name,
            category: p.category,
            description: p.description,
            authType: p.authType,
            capabilities: p.capabilities,
          },
        });
        updated++;
      } else {
        await this.prisma.client.integrationProvider.create({
          data: {
            key: p.key,
            name: p.name,
            category: p.category,
            description: p.description,
            authType: p.authType,
            capabilities: p.capabilities,
            scopes: [],
            status: 'ACTIVE',
          },
        });
        created++;
      }
    }
    return { created, updated };
  }

  async listProviders(category?: string) {
    const where = category ? { category, status: 'ACTIVE' } : { status: 'ACTIVE' };
    return this.prisma.client.integrationProvider.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  async getDashboard(businessId: string) {
    const [providers, connections, recentSyncs] = await Promise.all([
      this.prisma.client.integrationProvider.findMany({ where: { status: 'ACTIVE' } }),
      this.prisma.client.integrationConnection.findMany({ where: { businessId } }),
      this.prisma.client.integrationSyncRun.findMany({
        where: { businessId },
        orderBy: { startedAt: 'desc' },
        take: 20,
      }),
    ]);

    const connectionMap = new Map(connections.map((c) => [c.providerKey, c]));

    const entries = providers.map((p) => {
      const c = connectionMap.get(p.key);
      return {
        provider: p,
        connection: c ?? null,
      };
    });

    const connected = entries.filter((e) => e.connection?.status === 'CONNECTED').length;
    const needsAttention = entries.filter(
      (e) => e.connection && ['ERROR', 'NEEDS_ATTENTION'].includes(e.connection.status),
    ).length;

    return {
      entries,
      stats: {
        total: providers.length,
        connected,
        needsAttention,
        disconnected: providers.length - connected - needsAttention,
      },
      recentSyncs,
    };
  }

  async createConnection(
    businessId: string,
    providerKey: string,
    data: {
      authDataRef?: string;
      scopes?: string[];
      settings?: Record<string, unknown>;
    },
  ) {
    const provider = await this.prisma.client.integrationProvider.findUnique({ where: { key: providerKey } });
    if (!provider) throw new NotFoundException(`Provider ${providerKey} not found`);

    return this.prisma.client.integrationConnection.upsert({
      where: { businessId_providerKey: { businessId, providerKey } },
      update: {
        status: 'CONNECTED',
        authDataRef: data.authDataRef,
        scopes: data.scopes ?? [],
        settings: data.settings ?? {},
        lastError: null,
        updatedAt: new Date(),
      },
      create: {
        businessId,
        providerKey,
        status: 'CONNECTED',
        authDataRef: data.authDataRef,
        scopes: data.scopes ?? [],
        settings: data.settings ?? {},
      },
    });
  }

  async disconnect(businessId: string, providerKey: string) {
    const conn = await this.prisma.client.integrationConnection.findUnique({
      where: { businessId_providerKey: { businessId, providerKey } },
    });
    if (!conn) throw new NotFoundException('Connection not found');

    return this.prisma.client.integrationConnection.update({
      where: { id: conn.id },
      data: { status: 'DISCONNECTED', updatedAt: new Date() },
    });
  }

  async recordSyncRun(
    businessId: string,
    connectionId: string,
    providerKey: string,
    result: {
      status: string;
      recordsRead?: number;
      recordsCreated?: number;
      recordsUpdated?: number;
      error?: string;
      meta?: Record<string, unknown>;
    },
  ) {
    return this.prisma.client.integrationSyncRun.create({
      data: {
        businessId,
        connectionId,
        providerKey,
        status: result.status,
        recordsRead: result.recordsRead ?? 0,
        recordsCreated: result.recordsCreated ?? 0,
        recordsUpdated: result.recordsUpdated ?? 0,
        error: result.error ?? null,
        meta: result.meta ?? {},
        completedAt: ['SUCCESS', 'FAILED', 'PARTIAL'].includes(result.status) ? new Date() : null,
      },
    });
  }

  async updateConnectionHealth(
    businessId: string,
    providerKey: string,
    health: { status?: string; lastError?: string | null },
  ) {
    return this.prisma.client.integrationConnection.updateMany({
      where: { businessId, providerKey },
      data: {
        status: health.status,
        lastError: health.lastError ?? null,
        lastSyncAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  async listSyncRuns(businessId: string, providerKey?: string, limit = 50) {
    return this.prisma.client.integrationSyncRun.findMany({
      where: { businessId, ...(providerKey ? { providerKey } : {}) },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
  }
}
