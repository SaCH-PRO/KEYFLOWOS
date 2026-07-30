import { Injectable, Inject, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { createHmac, timingSafeEqual } from 'crypto';
import { IConnector, ConnectorMeta, ConnectorHealth, ConnectorSyncResult, ConnectorStatusSummary, ConnectorSmokeResult, IngestionItemInput } from '../connector.interface';

interface WhatsAppWebhookBody {
  From?: string;
  Body?: string;
  WaId?: string;
  ProfileName?: string;
  SmsMessageSid?: string;
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          id?: string;
          from?: string;
          timestamp?: string;
          text?: { body?: string };
        }>;
        contacts?: Array<{
          profile?: { name?: string };
          wa_id?: string;
        }>;
      };
    }>;
  }>;
}

@Injectable()
export class WhatsAppConnector implements IConnector {
  private readonly logger = new Logger(WhatsAppConnector.name);

  readonly meta: ConnectorMeta = {
    type: 'whatsapp',
    name: 'WhatsApp Business',
    description: 'Send template messages and media via WhatsApp Business API',
    category: 'messaging',
    group: 'messaging',
    icon: 'message-circle',
    supportsSync: false,
    supportsWebhook: true,
    authType: 'api_key',
    externalUrl: 'https://business.facebook.com/wa/manage',
  };

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(EntityResolutionService) private readonly entityResolution: EntityResolutionService,
  ) {}

  async authenticate(businessId: string): Promise<{ connected: boolean; authUrl?: string }> {
    const connected = await this.isConnected(businessId);
    return { connected };
  }

  async healthCheck(businessId: string): Promise<ConnectorHealth> {
    const stored = await this.getConnectorStatus(businessId);
    const hasBusinessConfig = stored?.status === 'connected';
    const hasGlobalToken = !!process.env.WHATSAPP_ACCESS_TOKEN;
    const realStatus = (hasBusinessConfig || hasGlobalToken) ? 'connected' : 'disconnected';

    return {
      status: realStatus,
      lastSyncAt: stored?.lastSyncAt ?? null,
      lastErrorAt: stored?.lastErrorAt ?? null,
      lastError: stored?.lastError ?? null,
      errorCount: stored?.errorCount ?? 0,
      syncCount: stored?.syncCount ?? 0,
      connectedAt: stored?.connectedAt ?? null,
      connectedAccount: stored?.connectedAccount ?? process.env.WHATSAPP_PHONE_NUMBER_ID ?? null,
    };
  }

  async getStatus(businessId: string): Promise<ConnectorStatusSummary> {
    const health = await this.healthCheck(businessId);
    return {
      type: this.meta.type,
      name: this.meta.name,
      category: this.meta.category,
      status: health.status,
      connectedAccount: health.connectedAccount,
    };
  }

  async isConnected(businessId: string): Promise<boolean> {
    const health = await this.healthCheck(businessId);
    return health.status === 'connected';
  }

  async sync(_businessId: string): Promise<ConnectorSyncResult> {
    // Provider pull sync is not yet implemented for this connector. It previously
    // counted local rows and returned success:true, misrepresenting a no-op as a
    // successful provider sync. Real pull sync is future work per connector.
    return {
      success: false,
      itemsSynced: 0,
      unsupported: true,
      code: 'PULL_SYNC_NOT_IMPLEMENTED',
      errors: ['Provider pull sync is not implemented for this connector.'],
      duration: 0,
    };
  }

  parseInbound(payload: unknown, _businessId: string): IngestionItemInput[] {
    const body = payload as WhatsAppWebhookBody;

    // Twilio format
    if (typeof body.From === 'string') {
      return [
        {
          sourceType: 'whatsapp',
          sourceConnectorType: 'whatsapp',
          externalId: body.SmsMessageSid ?? body.From,
          receivedAt: new Date(),
          from: { id: body.From, name: body.ProfileName, phone: body.From },
          subject: body.Body ?? 'WhatsApp message',
          body: body.Body ?? '',
          rawPayload: payload as Record<string, unknown>,
        },
      ];
    }

    // Meta Cloud API format
    if (Array.isArray(body.entry) && body.entry.length > 0) {
      const change = body.entry[0]?.changes?.[0];
      const value = change?.value;
      const message = value?.messages?.[0];
      const contact = value?.contacts?.[0];

      if (message && typeof message.from === 'string') {
        const receivedAt = message.timestamp ? new Date(Number(message.timestamp) * 1000) : new Date();
        return [
          {
            sourceType: 'whatsapp',
            sourceConnectorType: 'whatsapp',
            externalId: message.id ?? message.from,
            receivedAt,
            from: {
              id: message.from,
              name: contact?.profile?.name,
              phone: message.from,
            },
            subject: message.text?.body ?? 'WhatsApp message',
            body: message.text?.body ?? '',
            rawPayload: payload as Record<string, unknown>,
          },
        ];
      }
    }

    return [];
  }

  verifyWebhook(payload: unknown, signature: string | undefined, secret: string): boolean {
    if (!signature || !signature.startsWith('sha256=')) {
      return false;
    }
    let raw: Buffer;
    if (Buffer.isBuffer(payload)) {
      raw = payload;
    } else if (typeof payload === 'string') {
      raw = Buffer.from(payload, 'utf8');
    } else {
      return false;
    }
    const expected = createHmac('sha256', secret).update(raw).digest('hex');
    const provided = signature.slice('sha256='.length);
    try {
      return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
    } catch {
      return false;
    }
  }

  async smokeTest(businessId: string): Promise<ConnectorSmokeResult> {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token) return { success: false, error: 'WHATSAPP_ACCESS_TOKEN is not set' };
    if (!phoneNumberId) return { success: false, error: 'WHATSAPP_PHONE_NUMBER_ID is not set' };
    try {
      const res = await fetch(
        `https://graph.facebook.com/v17.0/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { success: false, error: `WhatsApp Graph API ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}` };
      }
      const data = (await res.json()) as { display_phone_number?: string; verified_name?: string; quality_rating?: string };
      await this.trackActivity(businessId);
      return {
        success: true,
        action: 'Fetched WhatsApp phone number profile',
        account: data.verified_name ?? data.display_phone_number ?? phoneNumberId,
        detail: `${data.display_phone_number ?? phoneNumberId}${data.quality_rating ? ` • quality: ${data.quality_rating}` : ''}`,
      };
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  async disconnect(businessId: string): Promise<void> {
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'whatsapp' } },
      create: { businessId, connectorType: 'whatsapp', status: 'disconnected' },
      update: { status: 'disconnected' },
    });
  }

  async emitMessageReceived(businessId: string, opts: { from: string; body?: string; externalId?: string; senderName?: string }) {
    await this.trackActivity(businessId);

    const resolved = await this.entityResolution.resolveContact(businessId, {
      source: 'whatsapp',
      phone: opts.from,
      firstName: opts.senderName?.split(' ')[0],
      lastName: opts.senderName?.split(' ').slice(1).join(' ') || undefined,
    });

    this.events.emit('entity.resolved', {
      businessId,
      contactId: resolved.contactId,
      source: 'whatsapp',
      matchedOn: resolved.matchedOn,
      isNew: resolved.isNew,
      merged: resolved.merged,
    });

    this.events.emit('message.received', {
      connectorType: 'whatsapp' as const,
      externalId: opts.externalId ?? null,
      businessId,
      timestamp: new Date(),
      channel: 'whatsapp',
      from: opts.from,
      body: opts.body,
      contactId: resolved.contactId,
    });

    return resolved;
  }

  async emitMessageSent(businessId: string, opts: { to: string; contactId?: string; externalId?: string }) {
    await this.trackActivity(businessId);

    this.events.emit('message.sent', {
      connectorType: 'whatsapp' as const,
      externalId: opts.externalId ?? null,
      businessId,
      timestamp: new Date(),
      channel: 'whatsapp',
      to: opts.to,
      contactId: opts.contactId,
    });
  }

  private async trackActivity(businessId: string) {
    await this.prisma.client.connectorStatus.upsert({
      where: { businessId_connectorType: { businessId, connectorType: 'whatsapp' } },
      create: { businessId, connectorType: 'whatsapp', status: 'connected', lastSyncAt: new Date(), syncCount: 1 },
      update: { lastSyncAt: new Date(), syncCount: { increment: 1 }, status: 'connected' },
    }).catch((e) => this.logger.warn(`Failed to track whatsapp activity: ${e instanceof Error ? e.message : String(e)}`));
  }

  private async getConnectorStatus(businessId: string) {
    return this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: 'whatsapp' } },
    });
  }
}
