import { Injectable, Inject, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@keyflow/db';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { decryptToken } from '../../crypto/token-crypto';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
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

type PrismaTx = Parameters<Parameters<PrismaService['client']['$transaction']>[0]>[0];

/**
 * PR196-WHATSAPP-HEALTH review repairs (SEC-WAH-1..3, CR-PR196-1..3). What a
 * verified check vouched for, kept in connector_statuses.metadata under this
 * key, beside what other writers merge there (ConnectorCredentialsService's
 * encryptedCredentials). 'connected' with a fingerprint: a check reached the
 * provider with the business config whose fingerprint it is. 'connected'
 * without one: the platform path (no config of the business's own).
 * 'disconnected': an explicit disconnect. rev grows by one on every write;
 * those writes hold the business row lock (lockBusinessRow), so a check that
 * started before another write sees that rev moved.
 */
const VERIFICATION_KEY = 'whatsappVerification';

interface VerificationRecord {
  rev: number;
  state: 'connected' | 'disconnected';
  fingerprint?: string;
  at: string;
}

/** The fields a check depends on: WhatsAppService.saveConfig's sending identity. */
const IDENTITY_FIELDS = ['provider', 'phoneNumberId', 'fromNumber', 'accountSid', 'authToken', 'accessToken'] as const;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * A digest of the stored config's sending identity, credentials as stored
 * (ciphertext: a new credential is a new ciphertext, a kept one is the same).
 * SHA-256, written with the letters a-p (one per half byte): it holds no
 * digit, so nothing in it reads as a phone number or a phone number id. It
 * stays server-side (no route answers the row's metadata).
 */
function configFingerprint(stored: Record<string, unknown>): string {
  const values = IDENTITY_FIELDS.map((field) => {
    const v = stored[field];
    return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
  });
  const digest = createHash('sha256').update(JSON.stringify(values)).digest();
  let out = '';
  for (const byte of digest) out += String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15));
  return out;
}

/** The verification record a connector_statuses row carries, or null (none, or not one this connector wrote). */
function verificationOf(metadata: unknown): VerificationRecord | null {
  const raw = asObject(metadata)[VERIFICATION_KEY];
  const record = asObject(raw);
  if (!Number.isInteger(record.rev) || (record.state !== 'connected' && record.state !== 'disconnected')) return null;
  return {
    rev: record.rev as number,
    state: record.state,
    ...(typeof record.fingerprint === 'string' ? { fingerprint: record.fingerprint } : {}),
    at: typeof record.at === 'string' ? record.at : '',
  };
}

/** Why a passed check was not recorded: the state it checked is gone. */
const CHANGED_WHILE_CHECKING = "This business's WhatsApp configuration changed while it was being checked; run the check again.";
const DISCONNECTED_WHILE_CHECKING = 'WhatsApp was disconnected while the check ran; nothing was marked connected.';

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

  /**
   * The dashboard's Connect and Reconnect (ConnectorRegistryService
   * .reconnectConnector: disconnect, then this) and POST authenticate.
   * Review CR-PR196-1: since an explicit disconnect wins, answering
   * isConnected alone left every Reconnect disconnected for good. Already
   * connected answers so with no provider call. A business with a config of
   * its own is checked now, as smokeTest checks it (a user's action, the same
   * provider call POST smoke makes), and is connected only if that check
   * passes. The platform path (no config of its own) needs no check, as
   * before: with WHATSAPP_ACCESS_TOKEN set, this lifts an explicit disconnect.
   */
  async authenticate(businessId: string): Promise<{ connected: boolean; authUrl?: string }> {
    if (await this.isConnected(businessId)) return { connected: true };
    const { current, rev } = await this.readState(businessId);
    if (current) return { connected: (await this.smokeTest(businessId)).success };
    if (!process.env.WHATSAPP_ACCESS_TOKEN) return { connected: false };
    const recorded = await this.recordConnected(businessId, { rev, fingerprint: null });
    return { connected: recorded === null && (await this.isConnected(businessId)) };
  }

  /**
   * PR196-WHATSAPP-HEALTH. A business with a config of its own
   * (Business.metaData.whatsapp) reads 'connected' only when a verified check
   * of THIS config passed: the row says 'connected' and its verification
   * record carries the fingerprint of the config stored now (see smokeTest
   * and recordConnected), and the config holds the credentials its provider
   * needs (4-D2, 4-D3, 4-D4). Review SEC-WAH-1/3, CR-PR196-2/3: the status
   * column alone proves nothing, since other writers set it 'connected'
   * without a check (a smoke test's late write after a config change, the
   * pre-packet platform-token smoke, GET webhook-info through
   * ConnectorCredentialsService.setCredentials). A config saved since the
   * check, a disconnect (its record has no fingerprint) or a row no check
   * wrote reads 'disconnected'. The platform token never stands in for the
   * business's own credentials.
   *
   * connectedAccount is the business's sending number (fromNumber) or null:
   * never the phoneNumberId the shared webhook routes inbound by, nor any
   * credential (4-D1, R0-SEC2/SEC2b): GET health, statuses and the dashboard
   * answer every member, and only the config owner reads the phoneNumberId
   * (GET whatsapp/.../config). The row's own connectedAccount is not read
   * for such a business: an earlier writer may have stored the id there.
   *
   * A business with no config of its own keeps the platform path
   * (WHATSAPP_ACCESS_TOKEN), except that an explicit disconnect (this
   * connector's disconnect record) wins until Connect, Reconnect or a passed
   * smoke test, and the platform WHATSAPP_PHONE_NUMBER_ID is never shown as
   * the account.
   */
  async healthCheck(businessId: string): Promise<ConnectorHealth> {
    const { stored, record, current } = await this.readState(businessId);
    let realStatus: 'connected' | 'disconnected';
    let connectedAccount: string | null;
    if (current) {
      const verified =
        stored?.status === 'connected' &&
        record?.state === 'connected' &&
        !!record.fingerprint &&
        record.fingerprint === current.fingerprint;
      realStatus = verified && hasProviderCredentials(current.config) ? 'connected' : 'disconnected';
      connectedAccount = current.config.fromNumber || null;
    } else {
      const hasGlobalToken = !!process.env.WHATSAPP_ACCESS_TOKEN;
      const disconnected = record?.state === 'disconnected';
      realStatus = !disconnected && (stored?.status === 'connected' || hasGlobalToken) ? 'connected' : 'disconnected';
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
   * nothing, so there is nothing to check (4-D3).
   *
   * A passed check is recorded only if what it checked still stands (review
   * SEC-WAH-1/2, CR-PR196-3, recordConnected): the config stored now is the
   * one checked (no save in between, and for the platform path still no
   * config of the business's own), and no disconnect committed meanwhile.
   * Otherwise the check reports failure, so the registry writes nothing
   * either. Only a recorded check reports success.
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
    const { current, rev } = await this.readState(businessId);
    const result = await this.checkWithProvider(current?.config ?? null);
    if (!result.success) return result;
    const refused = await this.recordConnected(businessId, {
      rev,
      fingerprint: current?.fingerprint ?? null,
      account: current ? current.config.fromNumber || null : undefined,
    });
    return refused ? { success: false, error: refused } : result;
  }

  /** The provider check itself; nothing is written. */
  private async checkWithProvider(config: BusinessWhatsAppConfig | null): Promise<ConnectorSmokeResult> {
    if (!config) {
      const token = process.env.WHATSAPP_ACCESS_TOKEN;
      const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      if (!token) return { success: false, error: 'WHATSAPP_ACCESS_TOKEN is not set' };
      if (!phoneNumberId) return { success: false, error: 'WHATSAPP_PHONE_NUMBER_ID is not set' };
      return this.verifyMeta(token, phoneNumberId, (data) => data.verified_name ?? data.display_phone_number);
    }

    switch (config.provider) {
      case 'meta':
        if (!hasProviderCredentials(config)) {
          return { success: false, error: "This business's WhatsApp (Meta) configuration is incomplete: it needs a phone number id and an access token." };
        }
        return this.verifyMeta(config.accessToken!, config.phoneNumberId!, () => config.fromNumber || undefined);
      case 'twilio':
        if (!hasProviderCredentials(config)) {
          return { success: false, error: "This business's WhatsApp (Twilio) configuration is incomplete: it needs an account SID, an auth token and a sending number." };
        }
        return this.verifyTwilio(config);
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

  private async verifyTwilio(config: BusinessWhatsAppConfig): Promise<ConnectorSmokeResult> {
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

  /**
   * Review SEC-WAH-1/2, CR-PR196-3: records a passed check as 'connected', in
   * one transaction that first takes the business row lock (lockBusinessRow)
   * and then re-reads the config and the row, and only while what the check
   * started from still stands: the config fingerprint (null: the platform
   * path, still no config of the business's own) is the current one, and the
   * verification record's rev is the one read before the provider call (or
   * a later check already recorded the same config: two checks in flight
   * agree). A save of the config or a disconnect that committed meanwhile is
   * seen, and nothing is written; one that starts later waits for this write
   * and then undoes it. Returns null when recorded, else why not.
   */
  private async recordConnected(
    businessId: string,
    started: { rev: number; fingerprint: string | null; account?: string | null },
  ): Promise<string | null> {
    return this.prisma.client.$transaction(async (tx) => {
      await this.lockBusinessRow(tx, businessId);
      const current = await this.readBusinessConfig(businessId, tx);
      if ((current?.fingerprint ?? null) !== started.fingerprint) return CHANGED_WHILE_CHECKING;
      const row = await tx.connectorStatus.findUnique({
        where: { businessId_connectorType: { businessId, connectorType: 'whatsapp' } },
        select: { status: true, connectedAt: true, metadata: true },
      });
      const record = verificationOf(row?.metadata);
      const sameCheck = record?.state === 'connected' && (record.fingerprint ?? null) === started.fingerprint;
      if ((record?.rev ?? 0) !== started.rev && !sameCheck) return DISCONNECTED_WHILE_CHECKING;

      const now = new Date();
      const next: VerificationRecord = {
        rev: (record?.rev ?? 0) + 1,
        state: 'connected',
        ...(started.fingerprint ? { fingerprint: started.fingerprint } : {}),
        at: now.toISOString(),
      };
      const metadata = { ...asObject(row?.metadata), [VERIFICATION_KEY]: next } as unknown as Prisma.InputJsonValue;
      await tx.connectorStatus.upsert({
        where: { businessId_connectorType: { businessId, connectorType: 'whatsapp' } },
        create: {
          businessId,
          connectorType: 'whatsapp',
          status: 'connected',
          connectedAt: now,
          lastSyncAt: now,
          syncCount: 1,
          connectedAccount: started.account ?? null,
          metadata,
        },
        update: {
          status: 'connected',
          lastSyncAt: now,
          syncCount: { increment: 1 },
          metadata,
          ...(row?.status === 'connected' && row.connectedAt ? {} : { connectedAt: now }),
          ...(started.account !== undefined ? { connectedAccount: started.account } : {}),
        },
      });
      return null;
    });
  }

  /**
   * An explicit disconnect: the row reads 'disconnected' and its verification
   * record becomes a disconnect record (no fingerprint, rev moved on), so no
   * later 'connected' write by another writer (GET webhook-info's
   * setCredentials, a smoke test's registry write) makes it read connected
   * again, and a check in flight cannot record (review SEC-WAH-2,
   * CR-PR196-2). Written under the business row lock, as recordConnected.
   */
  async disconnect(businessId: string): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      await this.lockBusinessRow(tx, businessId);
      const row = await tx.connectorStatus.findUnique({
        where: { businessId_connectorType: { businessId, connectorType: 'whatsapp' } },
        select: { metadata: true },
      });
      const record = verificationOf(row?.metadata);
      const next: VerificationRecord = { rev: (record?.rev ?? 0) + 1, state: 'disconnected', at: new Date().toISOString() };
      const metadata = { ...asObject(row?.metadata), [VERIFICATION_KEY]: next } as unknown as Prisma.InputJsonValue;
      await tx.connectorStatus.upsert({
        where: { businessId_connectorType: { businessId, connectorType: 'whatsapp' } },
        create: { businessId, connectorType: 'whatsapp', status: 'disconnected', metadata },
        update: { status: 'disconnected', metadata },
      });
    });
  }

  /**
   * FOR NO KEY UPDATE on the business row: the lock GmailService and
   * IdentityService.updateBusiness take, and the one WhatsAppService.saveConfig's
   * UPDATE of the config takes. saveConfig writes its status reset after that
   * UPDATE, so every writer here takes the business row before the status row.
   */
  private async lockBusinessRow(tx: PrismaTx, businessId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM businesses WHERE id = ${businessId} FOR NO KEY UPDATE`;
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

  /** The row, its verification record and the business's own config, as one read for health, smoke and authenticate. */
  private async readState(businessId: string) {
    const [stored, current] = await Promise.all([this.getConnectorStatus(businessId), this.readBusinessConfig(businessId)]);
    const record = verificationOf(stored?.metadata);
    return { stored, record, current, rev: record?.rev ?? 0 };
  }

  /**
   * The business's own config, read by its id only and decrypted as
   * WhatsAppService.getConfig decrypts it, with the fingerprint of its stored
   * form (configFingerprint); null when it has none. A credential that cannot
   * be decrypted throws (the registry reports the check as an error) rather
   * than reading as absent.
   */
  private async readBusinessConfig(
    businessId: string,
    db: Pick<PrismaTx, 'business'> = this.prisma.client,
  ): Promise<{ config: BusinessWhatsAppConfig; fingerprint: string } | null> {
    const business = await db.business.findUnique({
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
    return { config, fingerprint: configFingerprint(raw as Record<string, unknown>) };
  }
}
