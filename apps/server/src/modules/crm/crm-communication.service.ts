import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Subject } from 'rxjs';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmTimelineService } from './crm-timeline.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

export type ConversationChannel = 'whatsapp' | 'email' | 'sms' | 'call' | 'meeting' | 'note';
export type ConversationDirection = 'in' | 'out' | 'internal';

export interface ConversationEntry {
  id: string;
  source: 'event' | 'whatsapp' | 'note';
  channel: ConversationChannel;
  direction: ConversationDirection;
  body: string;
  timestamp: string;
  status?: string | null;
  actorId?: string | null;
  actorType?: string | null;
  meta?: Record<string, unknown>;
}

export interface ListConversationParams {
  businessId: string;
  contactId: string;
  cursor?: string | null;
  limit?: number;
  channel?: ConversationChannel | null;
  direction?: ConversationDirection | null;
  since?: string | null;
  until?: string | null;
}

const COMMUNICATION_EVENT_PREFIXES = [
  'communication.',
  'email.',
  'whatsapp.',
  'sms.',
  'message.',
  'call.',
  'campaign.sent',
  'campaign.opened',
  'campaign.clicked',
  'lead_form.submitted',
  'form.submitted',
];

interface StreamEnvelope {
  data: {
    type: string;
    contactId: string;
    eventId?: string;
  };
}

@Injectable()
export class CrmCommunicationService {
  private readonly logger = new Logger(CrmCommunicationService.name);
  private readonly streams = new Map<string, Set<Subject<StreamEnvelope>>>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(CrmTimelineService) private readonly timeline: CrmTimelineService,
    @Inject(WhatsAppService) private readonly whatsapp: WhatsAppService,
  ) {
    this.events.on('crm.contact_event.logged', (payload: { businessId: string; contactId: string; type: string; eventId?: string }) => {
      this.broadcast(payload.businessId, payload.contactId, {
        type: payload.type,
        contactId: payload.contactId,
        eventId: payload.eventId,
      });
    });
  }

  // ---------- Aggregation ----------

  private classifyEventChannel(type: string): { channel: ConversationChannel; direction: ConversationDirection } | null {
    if (type.startsWith('communication.')) {
      const sub = type.split('.')[1] ?? '';
      if (sub === 'email') return { channel: 'email', direction: 'out' };
      if (sub === 'whatsapp') return { channel: 'whatsapp', direction: 'out' };
      if (sub === 'sms') return { channel: 'sms', direction: 'out' };
      if (sub === 'call') return { channel: 'call', direction: 'out' };
      if (sub === 'meeting') return { channel: 'meeting', direction: 'out' };
      return { channel: 'call', direction: 'out' };
    }
    if (type === 'email.sent') return { channel: 'email', direction: 'out' };
    if (type === 'whatsapp.sent') return { channel: 'whatsapp', direction: 'out' };
    if (type === 'sms.sent') return { channel: 'sms', direction: 'out' };
    if (type === 'message.copied') return { channel: 'whatsapp', direction: 'out' };
    if (type.startsWith('campaign.')) return { channel: 'email', direction: 'out' };
    if (type === 'lead_form.submitted' || type === 'form.submitted') return { channel: 'email', direction: 'in' };
    return null;
  }

  private extractEventBody(type: string, data: unknown): string {
    if (!data || typeof data !== 'object') return '';
    const d = data as Record<string, unknown>;
    return (
      (typeof d.body === 'string' && d.body) ||
      (typeof d.message === 'string' && d.message) ||
      (typeof d.notes === 'string' && d.notes) ||
      (typeof d.subject === 'string' && d.subject) ||
      (typeof d.content === 'string' && d.content) ||
      (typeof d.snippet === 'string' && d.snippet) ||
      (typeof d.summary === 'string' && d.summary) ||
      ''
    );
  }

  async list(params: ListConversationParams) {
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
    const since = params.since ? new Date(params.since) : null;
    const until = params.until ? new Date(params.until) : null;
    const cursorDate = params.cursor ? new Date(params.cursor) : null;
    const cap = cursorDate && !Number.isNaN(cursorDate.getTime()) ? cursorDate : (until && !Number.isNaN(until.getTime()) ? until : null);

    // Pull a generous batch from each source then merge & cap.
    const fetchTake = limit * 2;

    const [events, notes, whatsappContact] = await Promise.all([
      this.prisma.client.contactEvent.findMany({
        where: {
          businessId: params.businessId,
          contactId: params.contactId,
          ...(cap ? { createdAt: { lt: cap } } : {}),
          ...(since ? { createdAt: { gte: since, ...(cap ? { lt: cap } : {}) } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: fetchTake,
      }),
      this.prisma.client.contactNote.findMany({
        where: {
          businessId: params.businessId,
          contactId: params.contactId,
          ...(cap ? { createdAt: { lt: cap } } : {}),
          ...(since ? { createdAt: { gte: since, ...(cap ? { lt: cap } : {}) } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: fetchTake,
      }),
      this.prisma.client.whatsAppContact.findFirst({
        where: { businessId: params.businessId, contactId: params.contactId },
        select: { id: true },
      }),
    ]);

    const waMessages = whatsappContact
      ? await this.prisma.client.whatsAppMessage.findMany({
          where: {
            businessId: params.businessId,
            whatsappContactId: whatsappContact.id,
            ...(cap ? { createdAt: { lt: cap } } : {}),
            ...(since ? { createdAt: { gte: since, ...(cap ? { lt: cap } : {}) } } : {}),
          },
          orderBy: { createdAt: 'desc' },
          take: fetchTake,
        })
      : [];

    const entries: ConversationEntry[] = [];

    for (const ev of events) {
      const isComm = COMMUNICATION_EVENT_PREFIXES.some((p) => ev.type.startsWith(p));
      if (!isComm) continue;
      const cls = this.classifyEventChannel(ev.type);
      if (!cls) continue;
      const body = this.extractEventBody(ev.type, ev.data);
      const data = (ev.data && typeof ev.data === 'object' ? (ev.data as Record<string, unknown>) : {});
      entries.push({
        id: `event:${ev.id}`,
        source: 'event',
        channel: cls.channel,
        direction: (data.direction === 'in' || data.direction === 'INBOUND') ? 'in' : cls.direction,
        body,
        timestamp: ev.createdAt.toISOString(),
        status: typeof data.outcome === 'string' ? (data.outcome as string) : null,
        actorId: ev.actorId,
        actorType: ev.actorType,
        meta: { type: ev.type, source: ev.source, ...data },
      });
    }

    for (const m of waMessages) {
      entries.push({
        id: `wa:${m.id}`,
        source: 'whatsapp',
        channel: 'whatsapp',
        direction: m.direction === 'INBOUND' ? 'in' : 'out',
        body: m.body ?? (m.templateName ? `[template:${m.templateName}]` : ''),
        timestamp: m.createdAt.toISOString(),
        status: m.status,
        meta: {
          templateName: m.templateName,
          templateParams: m.templateParams,
          mediaUrls: m.mediaUrls,
          wamid: m.wamid,
          errorMessage: m.errorMessage,
        },
      });
    }

    for (const n of notes) {
      entries.push({
        id: `note:${n.id}`,
        source: 'note',
        channel: 'note',
        direction: 'internal',
        body: n.body,
        timestamp: n.createdAt.toISOString(),
        actorId: n.authorId,
        actorType: 'USER',
        meta: { source: n.source },
      });
    }

    // Apply filters
    let filtered = entries;
    if (params.channel) filtered = filtered.filter((e) => e.channel === params.channel);
    if (params.direction) filtered = filtered.filter((e) => e.direction === params.direction);

    filtered.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    const sliced = filtered.slice(0, limit);
    const nextCursor = filtered.length > limit ? sliced[sliced.length - 1].timestamp : null;

    return {
      entries: sliced,
      nextCursor,
      hasMore: filtered.length > limit,
    };
  }

  // ---------- Unread tracking ----------

  async getReadState(businessId: string, userId: string, contactId: string) {
    return this.prisma.client.contactReadState.findUnique({
      where: { businessId_userId_contactId: { businessId, userId, contactId } },
    });
  }

  async markRead(businessId: string, userId: string, contactId: string) {
    const now = new Date();
    return this.prisma.client.contactReadState.upsert({
      where: { businessId_userId_contactId: { businessId, userId, contactId } },
      update: { lastReadAt: now },
      create: { businessId, userId, contactId, lastReadAt: now },
    });
  }

  /**
   * Returns map of contactId -> unread count for the user.
   * Inbound = WhatsApp INBOUND messages OR ContactEvent direction=in (form submissions).
   * Outbound notes/sends are NOT counted as "unread for user".
   */
  async unreadCounts(businessId: string, userId: string): Promise<Record<string, number>> {
    const states = await this.prisma.client.contactReadState.findMany({
      where: { businessId, userId },
      select: { contactId: true, lastReadAt: true },
    });
    const stateMap = new Map(states.map((s) => [s.contactId, s.lastReadAt]));

    const waContacts = await this.prisma.client.whatsAppContact.findMany({
      where: { businessId, contactId: { not: null } },
      select: { id: true, contactId: true, lastMessageAt: true },
    });

    const result: Record<string, number> = {};

    // Group whatsapp contacts by contactId
    const waByContact = new Map<string, string[]>();
    for (const wc of waContacts) {
      if (!wc.contactId) continue;
      const arr = waByContact.get(wc.contactId) ?? [];
      arr.push(wc.id);
      waByContact.set(wc.contactId, arr);
    }

    // Count WhatsApp inbound messages per contact
    for (const [contactId, waIds] of waByContact.entries()) {
      const lastReadAt = stateMap.get(contactId);
      const where: Record<string, unknown> = {
        businessId,
        whatsappContactId: { in: waIds },
        direction: 'INBOUND',
      };
      if (lastReadAt) where.createdAt = { gt: lastReadAt };
      const count = await this.prisma.client.whatsAppMessage.count({ where });
      if (count > 0) result[contactId] = (result[contactId] ?? 0) + count;
    }

    // Count inbound form submissions and similar inbound communication events.
    const allContacts = new Set<string>([
      ...waByContact.keys(),
      ...stateMap.keys(),
    ]);
    // Also pull contacts with recent inbound events (form/lead) regardless of read state
    const inboundEvents = await this.prisma.client.contactEvent.groupBy({
      by: ['contactId'],
      where: {
        businessId,
        type: { in: ['lead_form.submitted', 'form.submitted'] },
      },
      _max: { createdAt: true },
    });
    for (const row of inboundEvents) {
      const contactId = row.contactId;
      if (!contactId) continue;
      allContacts.add(contactId);
      const lastReadAt = stateMap.get(contactId);
      const ts = row._max.createdAt;
      if (!ts) continue;
      if (!lastReadAt || ts > lastReadAt) {
        const c = await this.prisma.client.contactEvent.count({
          where: {
            businessId,
            contactId,
            type: { in: ['lead_form.submitted', 'form.submitted'] },
            ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
          },
        });
        if (c > 0) result[contactId] = (result[contactId] ?? 0) + c;
      }
    }

    return result;
  }

  // ---------- Reply (composer) ----------

  bestChannelFor(contact: { preferredChannel?: string | null; whatsappNumber?: string | null; phone?: string | null; email?: string | null }): ConversationChannel {
    const pref = (contact.preferredChannel ?? '').toLowerCase();
    if (pref.includes('whatsapp') && (contact.whatsappNumber || contact.phone)) return 'whatsapp';
    if (pref.includes('email') && contact.email) return 'email';
    if (pref.includes('sms') && contact.phone) return 'sms';
    if (pref.includes('call') || pref.includes('phone')) return 'call';
    if (contact.whatsappNumber || contact.phone) return 'whatsapp';
    if (contact.email) return 'email';
    return 'note';
  }

  async reply(input: {
    businessId: string;
    contactId: string;
    channel: ConversationChannel;
    body: string;
    actorId?: string | null;
  }) {
    const contact = await this.prisma.client.contact.findFirst({
      where: { id: input.contactId, businessId: input.businessId, deletedAt: null },
      select: { id: true, phone: true, whatsappNumber: true, email: true, preferredChannel: true },
    });
    if (!contact) throw new NotFoundException('Contact not found');

    const body = (input.body ?? '').trim();
    if (!body) throw new BadRequestException('body is required');
    const channel = input.channel;

    if (channel === 'whatsapp') {
      const phone = contact.whatsappNumber || contact.phone;
      if (!phone) throw new BadRequestException('Contact has no WhatsApp/phone number');
      try {
        const message = await this.whatsapp.sendMessage(input.businessId, {
          to: phone,
          body,
        });
        return { ok: true, channel, message };
      } catch (err: any) {
        // Fall back to logging it as a copy-to-send event so the thread still records intent.
        const event = await this.timeline.logContactEvent({
          businessId: input.businessId,
          contactId: input.contactId,
          type: 'message.copied',
          data: { channel: 'whatsapp', body, error: (err as Error).message },
          actorType: 'USER',
          actorId: input.actorId ?? undefined,
          source: 'inbox-composer',
        });
        return { ok: false, channel, fallback: 'logged', event, error: (err as Error).message };
      }
    }

    if (channel === 'note') {
      const note = await this.prisma.client.contactNote.create({
        data: {
          businessId: input.businessId,
          contactId: input.contactId,
          body,
          authorId: input.actorId ?? null,
          source: 'inbox-composer',
        },
      });
      // Emit a synthetic event so the live stream picks it up.
      this.events.emit('crm.contact_event.logged', {
        businessId: input.businessId,
        contactId: input.contactId,
        type: 'note.added',
        eventId: `note:${note.id}`,
        source: 'inbox-composer',
      });
      return { ok: true, channel, note };
    }

    // For email / sms / call: log a communication event (no adapter exists yet per task scope).
    const channelType = channel === 'meeting' ? 'meeting' : channel;
    const result = await this.timeline.logCommunication({
      businessId: input.businessId,
      contactId: input.contactId,
      channelType,
      outcome: 'sent',
      notes: body,
      actorId: input.actorId ?? undefined,
    });
    return { ok: true, channel, ...result };
  }

  // ---------- SSE ----------

  subscribe(businessId: string, contactId: string): { observable: Subject<StreamEnvelope>; cleanup: () => void } {
    const key = `${businessId}:${contactId}`;
    const subject = new Subject<StreamEnvelope>();
    const set = this.streams.get(key) ?? new Set();
    set.add(subject);
    this.streams.set(key, set);
    const cleanup = () => {
      const s = this.streams.get(key);
      if (s) {
        s.delete(subject);
        if (s.size === 0) this.streams.delete(key);
      }
      subject.complete();
    };
    return { observable: subject, cleanup };
  }

  private broadcast(businessId: string, contactId: string, payload: StreamEnvelope['data']) {
    const key = `${businessId}:${contactId}`;
    const set = this.streams.get(key);
    if (!set || set.size === 0) return;
    for (const s of set) {
      try {
        s.next({ data: payload });
      } catch (err: any) {
        this.logger.warn(`[crm-comm] sse broadcast failed: ${(err as Error).message}`);
      }
    }
  }
}
