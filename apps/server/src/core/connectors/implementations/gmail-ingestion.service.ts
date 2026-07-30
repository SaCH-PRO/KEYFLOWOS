import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityResolutionService } from '../entity-resolution.service';
import { GoogleTokenHelper } from '../../../modules/connect/google-token.helper';
import { KeyInboxService } from '../../../modules/key-inbox/key-inbox.service';
import type { ConnectorSyncResult, IngestionItemInput } from '../connector.interface';
import type { CreateInboxMessageInput } from '../../../modules/key-inbox/key-inbox.types';
import { KEY_INBOX_CHANNELS } from '../../../modules/key-inbox/key-inbox.constants';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const INBOX_LABEL = 'INBOX';

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailMessagePartBody {
  attachmentId?: string;
  size?: number;
  data?: string;
}

interface GmailMessagePart {
  partId?: string;
  mimeType: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: GmailMessagePartBody;
  parts?: GmailMessagePart[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate?: string;
  snippet?: string;
  payload?: GmailMessagePart;
}

interface GmailHistoryRecord {
  messagesAdded?: Array<{ message: { id: string; threadId: string } }>;
}

interface GmailHistoryResponse {
  history?: GmailHistoryRecord[];
  nextPageToken?: string;
  historyId?: string;
}

interface GmailMessageListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

interface GmailProfile {
  emailAddress?: string;
  historyId?: string;
}

interface MessageRef {
  id: string;
  threadId: string;
}

@Injectable()
export class GmailIngestionService {
  private readonly logger = new Logger(GmailIngestionService.name);
  private readonly tokenHelper: GoogleTokenHelper;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EntityResolutionService) private readonly entityResolution: EntityResolutionService,
    @Inject(KeyInboxService) private readonly keyInbox: KeyInboxService,
  ) {
    this.tokenHelper = new GoogleTokenHelper(this.prisma);
  }

  async syncInbox(businessId: string): Promise<ConnectorSyncResult> {
    const start = Date.now();

    try {
      const accessToken = await this.tokenHelper.getValidAccessToken(businessId, {
        access: 'gmailAccessToken',
        refresh: 'gmailRefreshToken',
        expiry: 'gmailTokenExpiry',
      }, 'Gmail');

      const profile = await this.fetchProfile(accessToken);
      const connectedAccount = profile.emailAddress?.toLowerCase() ?? null;

      const status = await this.prisma.client.connectorStatus.findUnique({
        where: { businessId_connectorType: { businessId, connectorType: 'gmail' } },
      });
      const metadata = (status?.metadata as Record<string, unknown> | null) ?? {};
      const lastHistoryId = typeof metadata.lastHistoryId === 'string' ? metadata.lastHistoryId : undefined;

      const { refs, historyId } = await this.resolveMessageRefs(accessToken, lastHistoryId);

      let ingested = 0;
      const errors: string[] = [];

      for (const ref of refs) {
        try {
          const alreadyExists = await this.prisma.client.keyInboxMessage.findFirst({
            where: {
              businessId,
              channel: KEY_INBOX_CHANNELS.EMAIL,
              externalMessageId: ref.id,
            },
          });
          if (alreadyExists) continue;

          const message = await this.fetchMessage(accessToken, ref.id);
          const parsed = this.parseMessage(message);

          // Skip messages sent from the connected account itself (e.g. smoke tests).
          if (connectedAccount && parsed.fromEmail?.toLowerCase() === connectedAccount) {
            continue;
          }

          const resolved = parsed.fromEmail
            ? await this.entityResolution.resolveContact(businessId, {
                source: 'gmail',
                email: parsed.fromEmail,
                firstName: parsed.fromName?.split(' ')[0],
                lastName: parsed.fromName?.split(' ').slice(1).join(' ') || undefined,
              })
            : { contactId: '' };

          const thread = await this.keyInbox.upsertThread({
            businessId,
            channel: KEY_INBOX_CHANNELS.EMAIL,
            externalThreadId: message.threadId,
            contactId: resolved.contactId || null,
            subject: parsed.subject || null,
            status: 'OPEN',
            priority: 'NORMAL',
            metadata: {
              source: 'gmail',
              gmailThreadId: message.threadId,
              connectedAccount,
            },
          });

          const messageInput: CreateInboxMessageInput = {
            businessId,
            threadId: thread.id,
            channel: KEY_INBOX_CHANNELS.EMAIL,
            direction: 'INBOUND',
            senderName: parsed.fromName || null,
            senderHandle: parsed.fromEmail || null,
            senderEmail: parsed.fromEmail || null,
            senderPhone: null,
            contentText: parsed.text || null,
            contentHtml: parsed.html || null,
            attachments: parsed.attachments as unknown as Record<string, unknown>[],
            externalMessageId: message.id,
            receivedAt: parsed.receivedAt,
            sentAt: null,
            metadata: {
              source: 'gmail',
              gmailThreadId: message.threadId,
              gmailMessageId: message.id,
              labels: message.labelIds ?? [],
              snippet: message.snippet ?? null,
            },
          };

          await this.keyInbox.addMessage(messageInput);
          ingested += 1;
        } catch (err: any) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Failed to ingest Gmail message ${ref.id} for ${businessId}: ${message}`);
          errors.push(`${ref.id}: ${message}`);
        }
      }

      // Persist sync cursor and health regardless of per-message errors.
      await this.prisma.client.connectorStatus.upsert({
        where: { businessId_connectorType: { businessId, connectorType: 'gmail' } },
        create: {
          businessId,
          connectorType: 'gmail',
          status: 'connected',
          lastSyncAt: new Date(),
          syncCount: 1,
          connectedAccount,
          intakeEnabled: true,
          metadata: { ...(metadata || {}), lastHistoryId: historyId },
        },
        update: {
          status: 'connected',
          lastSyncAt: new Date(),
          syncCount: { increment: 1 },
          connectedAccount,
          intakeEnabled: true,
          metadata: { ...(metadata || {}), lastHistoryId: historyId },
          lastError: errors.length > 0 ? errors.slice(0, 3).join('; ') : null,
          lastErrorAt: errors.length > 0 ? new Date() : undefined,
        },
      });

      return {
        success: errors.length === 0,
        itemsSynced: ingested,
        errors,
        duration: Date.now() - start,
      };
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Gmail ingestion failed for ${businessId}: ${message}`);

      await this.prisma.client.connectorStatus.upsert({
        where: { businessId_connectorType: { businessId, connectorType: 'gmail' } },
        create: {
          businessId,
          connectorType: 'gmail',
          status: 'error',
          lastError: message,
          lastErrorAt: new Date(),
          errorCount: 1,
        },
        update: {
          status: 'error',
          lastError: message,
          lastErrorAt: new Date(),
          errorCount: { increment: 1 },
        },
      });

      return {
        success: false,
        itemsSynced: 0,
        errors: [message],
        duration: Date.now() - start,
      };
    }
  }

  /**
   * Fetch Gmail inbox messages and return them as normalized IngestionItemInputs.
   * Used by the connector's syncToIngestion hook so the canonical ingestion
   * pipeline can decide how to route/deduplicate them.
   */
  async collectInboxInputs(businessId: string): Promise<IngestionItemInput[]> {
    const accessToken = await this.tokenHelper.getValidAccessToken(businessId, {
      access: 'gmailAccessToken',
      refresh: 'gmailRefreshToken',
      expiry: 'gmailTokenExpiry',
    }, 'Gmail');

    const profile = await this.fetchProfile(accessToken);
    const connectedAccount = profile.emailAddress?.toLowerCase() ?? null;

    const status = await this.prisma.client.connectorStatus.findUnique({
      where: { businessId_connectorType: { businessId, connectorType: 'gmail' } },
    });
    const metadata = (status?.metadata as Record<string, unknown> | null) ?? {};
    const lastHistoryId = typeof metadata.lastHistoryId === 'string' ? metadata.lastHistoryId : undefined;

    const { refs } = await this.resolveMessageRefs(accessToken, lastHistoryId);
    const inputs: IngestionItemInput[] = [];

    for (const ref of refs) {
      try {
        const message = await this.fetchMessage(accessToken, ref.id);
        const parsed = this.parseMessage(message);

        if (connectedAccount && parsed.fromEmail?.toLowerCase() === connectedAccount) {
          continue;
        }

        inputs.push({
          sourceType: 'email',
          sourceConnectorType: 'gmail',
          externalId: message.id,
          receivedAt: parsed.receivedAt,
          from: {
            id: message.threadId,
            name: parsed.fromName,
            email: parsed.fromEmail,
          },
          subject: parsed.subject,
          body: parsed.text,
          rawPayload: { ...message, connectedAccount, gmailThreadId: message.threadId },
          attachments: parsed.attachments as unknown as IngestionItemInput['attachments'],
        });
      } catch (err: any) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Failed to parse Gmail message ${ref.id} for ingestion input: ${message}`);
      }
    }

    return inputs;
  }

  private async resolveMessageRefs(
    accessToken: string,
    lastHistoryId?: string,
  ): Promise<{ refs: MessageRef[]; historyId: string }> {
    const profile = await this.fetchProfile(accessToken);
    const currentHistoryId = profile.historyId;
    if (!currentHistoryId) {
      throw new Error('Gmail profile did not return a historyId');
    }

    if (!lastHistoryId) {
      const refs = await this.listInboxMessages(accessToken, {
        backfillDays: this.getFirstSyncBackfillDays(),
      });
      return { refs, historyId: currentHistoryId };
    }

    try {
      const refs = await this.listHistoryMessages(accessToken, lastHistoryId);
      return { refs, historyId: currentHistoryId };
    } catch (err: any) {
      this.logger.warn(
        `Gmail history sync failed, falling back to message list: ${err instanceof Error ? err.message : String(err)}`,
      );
      const refs = await this.listInboxMessages(accessToken);
      return { refs, historyId: currentHistoryId };
    }
  }

  private getFirstSyncBackfillDays(): number {
    const env = process.env.GMAIL_INGESTION_BACKFILL_DAYS;
    const parsed = env ? Number(env) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
  }

  private async fetchProfile(accessToken: string): Promise<GmailProfile> {
    const res = await fetch(`${GMAIL_API_BASE}/profile?fields=emailAddress,historyId`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Gmail profile ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
    }
    return (await res.json()) as GmailProfile;
  }

  private async listInboxMessages(
    accessToken: string,
    opts?: { backfillDays?: number },
  ): Promise<MessageRef[]> {
    const refs: MessageRef[] = [];
    let pageToken: string | undefined;
    const maxResults = 50;
    const backfillDays = opts?.backfillDays ?? 1;
    const query = `newer_than:${backfillDays}d`;

    do {
      const params = new URLSearchParams({
        labelIds: INBOX_LABEL,
        maxResults: String(maxResults),
        q: query,
        ...(pageToken ? { pageToken } : {}),
      });
      const res = await fetch(`${GMAIL_API_BASE}/messages?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Gmail messages list ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
      }
      const data = (await res.json()) as GmailMessageListResponse;
      for (const m of data.messages ?? []) {
        refs.push(m);
      }
      pageToken = data.nextPageToken;
    } while (pageToken);

    return refs;
  }

  private async listHistoryMessages(accessToken: string, startHistoryId: string): Promise<MessageRef[]> {
    const refs: MessageRef[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        startHistoryId,
        labelId: INBOX_LABEL,
        maxResults: '100',
        ...(pageToken ? { pageToken } : {}),
      });
      const res = await fetch(`${GMAIL_API_BASE}/history?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Gmail history ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
      }
      const data = (await res.json()) as GmailHistoryResponse;
      for (const record of data.history ?? []) {
        for (const added of record.messagesAdded ?? []) {
          if (added.message) refs.push(added.message);
        }
      }
      pageToken = data.nextPageToken;
    } while (pageToken);

    return refs;
  }

  private async fetchMessage(accessToken: string, messageId: string): Promise<GmailMessage> {
    const res = await fetch(`${GMAIL_API_BASE}/messages/${encodeURIComponent(messageId)}?format=full`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Gmail message ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
    }
    return (await res.json()) as GmailMessage;
  }

  private parseMessage(message: GmailMessage): {
    fromName?: string;
    fromEmail?: string;
    subject?: string;
    receivedAt: Date;
    text?: string;
    html?: string;
    attachments: Array<Record<string, unknown>>;
  } {
    const headers = message.payload?.headers ?? [];
    const fromValue = this.findHeader(headers, 'From') ?? '';
    const { name, email } = this.parseFrom(fromValue);
    const subject = this.findHeader(headers, 'Subject') ?? '';
    const dateHeader = this.findHeader(headers, 'Date');
    const receivedAt = dateHeader ? new Date(dateHeader) : new Date(Number(message.internalDate ?? Date.now()));

    const bodies = this.extractBodies(message.payload);
    const attachments = this.extractAttachments(message.payload, message.id);

    return {
      fromName: name,
      fromEmail: email,
      subject,
      receivedAt: Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt,
      text: bodies.text || this.stripHtml(bodies.html),
      html: bodies.html,
      attachments,
    };
  }

  private findHeader(headers: GmailHeader[], name: string): string | undefined {
    const header = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
    return header?.value;
  }

  private parseFrom(value: string): { name?: string; email?: string } {
    const match = value.match(/^(.*?)\s*<([^>]+)>$/);
    if (match) {
      const name = match[1].trim().replace(/^["']|["']$/g, '');
      return { name: name || undefined, email: match[2].trim() };
    }
    const emailMatch = value.match(/[^\s<>]+@[^\s<>]+/);
    return { email: (emailMatch?.[0] ?? value.trim()) || undefined };
  }

  private extractBodies(part?: GmailMessagePart): { text?: string; html?: string } {
    const result: { text?: string; html?: string } = {};
    if (!part) return result;

    const walk = (p: GmailMessagePart) => {
      if (p.parts) {
        p.parts.forEach(walk);
        return;
      }
      if (!p.body?.data) return;
      const decoded = this.base64UrlDecode(p.body.data);
      if (p.mimeType === 'text/plain' && !result.text) {
        result.text = decoded;
      } else if (p.mimeType === 'text/html' && !result.html) {
        result.html = decoded;
      }
    };

    walk(part);

    // If no text/plain but html exists, the caller will strip tags for text.
    return result;
  }

  private extractAttachments(part: GmailMessagePart | undefined, messageId: string): Array<Record<string, unknown>> {
    const attachments: Array<Record<string, unknown>> = [];
    if (!part) return attachments;

    const walk = (p: GmailMessagePart) => {
      if (p.parts) {
        p.parts.forEach(walk);
        return;
      }
      if (p.filename && p.body) {
        attachments.push({
          name: p.filename,
          mimeType: p.mimeType,
          sizeBytes: p.body.size ?? null,
          externalId: p.body.attachmentId ?? null,
          messageId,
        });
      }
    };

    walk(part);
    return attachments;
  }

  private base64UrlDecode(input: string): string {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    return Buffer.from(padded, 'base64').toString('utf8');
  }

  private stripHtml(html?: string): string | undefined {
    if (!html) return undefined;
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
