import { Injectable, Inject, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { decryptToken } from '../../crypto/token-crypto';
import { createHmac, timingSafeEqual } from 'crypto';
import { IConnector, ConnectorMeta, ConnectorHealth, ConnectorSyncResult, ConnectorStatusSummary, ConnectorSmokeResult, IngestionItemInput } from '../connector.interface';

/**
 * The credential fields WhatsAppService.saveConfig encrypts at rest (its
 * SENSITIVE_FIELDS), decrypted here exactly as WhatsAppService.getConfig
 * decrypts them (decryptConfig). WhatsAppModule is not imported by the
 * connector module, so the reader is restated rather than injected.
 */
const CREDENTIAL_FIELDS = ['authToken', 'accessToken', 'accountSid'] as const;

/**
 * The business's own WhatsApp config (Business.metaData.whatsapp, written only
 * by WhatsAppService.saveConfig), credentials decrypted. Server-side only:
 * nothing read from it leaves this connector except the sending number
 * (fromNumber), which every member already sees (GET whatsapp/.../config).
 */
interface BusinessWhatsAppConfig {
  provider?: string;
  accountSid?: string;
  authToken?: string;
  accessToken?: string;
  phoneNumberId?: string;
  fromNumber?: string;
}

/** Whether the config holds what its provider needs for a check (the mock sends nothing, so there is nothing to verify). */
function hasProviderCredentials(config: BusinessWhatsAppConfig): boolean {
  if (config.provider === 'meta') return !!(config.accessToken && config.phoneNumberId);
  if (config.provider === 'twilio') return !!(config.accountSid && config.authToken && config.fromNumber);
  return false;
}

/**
 * The provider's error, as a smoke result may carry it: the HTTP status, plus
 * the provider's numeric error code and (Graph) its error type name. Never the
 * provider's message text: Graph echoes the phone number id it was asked
 * about, and Twilio the account SID in the resource path.
 */
async function providerError(provider: string, res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { code?: unknown; error?: { code?: unknown; type?: unknown } } | null;
  const code = body?.error?.code ?? body?.code;
  const type = body?.error?.type;
  const parts = [
    typeof type === 'string' && /^[A-Za-z]{1,64}$/.test(type) ? type : null,
    typeof code === 'number' && Number.isFinite(code) ? `code ${code}` : null,
  ].filter(Boolean);
  return `${provider} ${res.status}${parts.length ? ` (${parts.join(' ')})` : ''}`;
}

/** Replace each credential or identifier value in `text` (an error message, a provider field) with a marker. */
function redact(text: string, values: Array<string | undefined>): string {
  let out = text;
  for (const v of values) {
    if (v && v.length >= 4) out = out.split(v).join('[redacted]');
  }
  return out;
}

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

  /**
   * PR196-WHATSAPP-HEALTH. A business with a config of its own
   * (Business.metaData.whatsapp) reads 'connected' only when a verified check
   * passed (the connector_statuses row says 'connected': a smoke test reached
   * the provider with these credentials, see smokeTest) and the config still
   * holds the credentials its provider needs; WhatsAppService.saveConfig
   * resets that row when the sending identity changes, and a disconnect
   * writes 'disconnected', which wins (4-D2, 4-D3, 4-D4). The platform token
   * never stands in for the business's own credentials.
   *
   * connectedAccount is the business's sending number (fromNumber) or null:
   * never the phoneNumberId the shared webhook routes inbound by, nor any
   * credential (4-D1, R0-SEC2/SEC2b): GET health, statuses and the dashboard
   * answer every member, and only the config owner reads the phoneNumberId
   * (GET whatsapp/.../config). The row's own connectedAccount is not read
   * for such a business: an earlier writer may have stored the id there.
   *
   * A business with no config of its own keeps the platform path
   * (WHATSAPP_ACCESS_TOKEN), except that an explicit disconnect wins and the
   * platform WHATSAPP_PHONE_NUMBER_ID is never shown as the account.
   */
  async healthCheck(businessId: string): Promise<ConnectorHealth> {
    const [stored, config] = await Promise.all([
      this.getConnectorStatus(businessId),
      this.readBusinessConfig(businessId),
    ]);
    const verified = stored?.status === 'connected';
    let realStatus: 'connected' | 'disconnected';
    let connectedAccount: string | null;
    if (config) {
      realStatus = verified && hasProviderCredentials(config) ? 'connected' : 'disconnected';
      connectedAccount = config.fromNumber || null;
    } else {
      const hasGlobalToken = !!process.env.WHATSAPP_ACCESS_TOKEN;
      realStatus = stored?.status !== 'disconnected' && (verified || hasGlobalToken) ? 'connected' : 'disconnected';
      const account = stored?.connectedAccount ?? null;
      connectedAccount = account && account === process.env.WHATSAPP_PHONE_NUMBER_ID ? null : account;
    }

    return {
      status: realStatus,
      lastSyncAt: stored?.lastSyncAt ?? null,
      lastErrorAt: stored?.lastErrorAt ?? null,
      lastError: stored?.lastError ?? null,
      errorCount: stored?.errorCount ?? 0,
      syncCount: stored?.syncCount ?? 0,
      connectedAt: stored?.connectedAt ?? null,
      connectedAccount,
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

  /**
   * PR196-WHATSAPP-HEALTH. A business with a config of its own is checked
   * with ITS credentials against ITS provider, decrypted server-side only:
   * Meta asks the Graph API for the phone number, Twilio for the account
   * (GET Accounts/{sid}.json, the provider WhatsAppService sends through) and
   * requires it to be active (4-D2). A config missing what its provider needs
   * is refused without a call; the platform token is never paired with it
   * (4-D5). The mock provider is configured but never verified: it sends
   * nothing, so there is nothing to check (4-D3). Only a passed check reports
   * success, and the registry then marks the row 'connected'.
   *
   * POST smoke answers every member, so the result carries the sending number
   * (fromNumber) as the account and nothing of the phoneNumberId, the SID or
   * a token (4-D1): provider errors are reduced to their status and code.
   *
   * A business with no config of its own keeps the platform path
   * (WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID), with the same answer
   * rules.
   */
  async smokeTest(businessId: string): Promise<ConnectorSmokeResult> {
    const config = await this.readBusinessConfig(businessId);
    if (!config) {
      const token = process.env.WHATSAPP_ACCESS_TOKEN;
      const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      if (!token) return { success: false, error: 'WHATSAPP_ACCESS_TOKEN is not set' };
      if (!phoneNumberId) return { success: false, error: 'WHATSAPP_PHONE_NUMBER_ID is not set' };
      return this.verifyMeta(businessId, token, phoneNumberId, (data) => data.verified_name ?? data.display_phone_number);
    }

    switch (config.provider) {
      case 'meta':
        if (!hasProviderCredentials(config)) {
          return { success: false, error: "This business's WhatsApp (Meta) configuration is incomplete: it needs a phone number id and an access token." };
        }
        return this.verifyMeta(businessId, config.accessToken!, config.phoneNumberId!, () => config.fromNumber || undefined);
      case 'twilio':
        if (!hasProviderCredentials(config)) {
          return { success: false, error: "This business's WhatsApp (Twilio) configuration is incomplete: it needs an account SID, an auth token and a sending number." };
        }
        return this.verifyTwilio(businessId, config);
      case 'mock':
        return {
          success: false,
          error: 'Configured with the mock WhatsApp provider, not verified: the mock sends nothing, so there is no provider to check.',
        };
      default:
        return { success: false, error: "This business's WhatsApp provider is not one that can be verified." };
    }
  }

  private async verifyMeta(
    businessId: string,
    token: string,
    phoneNumberId: string,
    accountOf: (data: { display_phone_number?: string; verified_name?: string }) => string | undefined,
  ): Promise<ConnectorSmokeResult> {
    const hidden = [token, phoneNumberId];
    try {
      const res = await fetch(
        `https://graph.facebook.com/v17.0/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) return { success: false, error: await providerError('WhatsApp Graph API', res) };
      // A parse error quotes the body it failed on, so it is not passed on.
      const data = (await res.json().catch(() => null)) as { display_phone_number?: string; verified_name?: string; quality_rating?: string } | null;
      if (!data) return { success: false, error: 'WhatsApp Graph API returned an unreadable answer' };
      await this.trackActivity(businessId);
      const account = accountOf(data);
      const quality = data.quality_rating ? ` • quality: ${data.quality_rating}` : '';
      return {
        success: true,
        action: 'Fetched WhatsApp phone number profile',
        account: account ? redact(account, hidden) : undefined,
        detail: redact(`${data.display_phone_number ?? 'Phone number verified'}${quality}`, hidden),
      };
    } catch (err: unknown) {
      return { success: false, error: redact(err instanceof Error ? err.message : 'Network error', hidden) };
    }
  }

  private async verifyTwilio(businessId: string, config: BusinessWhatsAppConfig): Promise<ConnectorSmokeResult> {
    const accountSid = config.accountSid!;
    const authToken = config.authToken!;
    const hidden = [accountSid, authToken, config.phoneNumberId];
    try {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}.json`, {
        method: 'GET',
        headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}` },
      });
      if (!res.ok) return { success: false, error: await providerError('Twilio API', res) };
      const data = (await res.json().catch(() => ({}))) as { status?: unknown };
      if (data.status !== 'active') {
        const state = typeof data.status === 'string' && /^[a-z-]{1,32}$/.test(data.status) ? data.status : 'not active';
        return { success: false, error: `The Twilio account is ${state}.` };
      }
      await this.trackActivity(businessId);
      return {
        success: true,
        action: 'Verified the Twilio account credentials',
        account: config.fromNumber,
        detail: 'Twilio account active',
      };
    } catch (err: unknown) {
      return { success: false, error: redact(err instanceof Error ? err.message : 'Network error', hidden) };
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

  /**
   * The business's own config, read by its id only and decrypted as
   * WhatsAppService.getConfig decrypts it; null when it has none. A credential
   * that cannot be decrypted throws (the registry reports the check as an
   * error) rather than reading as absent.
   */
  private async readBusinessConfig(businessId: string): Promise<BusinessWhatsAppConfig | null> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });
    const raw = (business?.metaData as Record<string, unknown> | null | undefined)?.whatsapp;
    if (!raw || typeof raw !== 'object') return null;
    const config = { ...(raw as BusinessWhatsAppConfig) };
    for (const field of CREDENTIAL_FIELDS) {
      const value = config[field];
      config[field] = typeof value === 'string' && value ? (decryptToken(value) ?? undefined) : undefined;
    }
    return config;
  }
}
