import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';

export type BestChannel = 'email' | 'whatsapp' | 'sms' | 'call';

const CHANNELS: BestChannel[] = ['email', 'whatsapp', 'sms', 'call'];

export interface BestTimeWindow {
  dayOfWeek: number;
  hourStart: number;
  hourEnd: number;
  tz: string;
  label: string;
  sampleCount: number;
}

export interface BestChannelExplanation {
  channel: BestChannel | null;
  confidence: number;
  perChannel: Array<{
    channel: BestChannel;
    sentCount: number;
    replyCount: number;
    openCount: number;
    responseRate: number;
    lastReplyAt: string | null;
    score: number;
  }>;
  timeWindow: BestTimeWindow | null;
  updatedAt: string | null;
}

const DEFAULT_TZ = 'America/Port_of_Spain';
const RECENCY_HALFLIFE_DAYS = 14;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PLURAL_DAY = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

interface ChannelEvent {
  channel: BestChannel;
  kind: 'sent' | 'reply' | 'open';
  at: Date;
}

function classifyEvent(type: string, data: unknown): ChannelEvent['kind'] extends never ? never : { channel: BestChannel; kind: 'sent' | 'reply' | 'open' } | null {
  const dataChannel = (() => {
    if (data && typeof data === 'object' && data !== null) {
      const c = (data as Record<string, unknown>).channel;
      if (typeof c === 'string') {
        const lc = c.toLowerCase();
        if (CHANNELS.includes(lc as BestChannel)) return lc as BestChannel;
      }
    }
    return null;
  })();
  switch (type) {
    case 'email.sent':
      return { channel: 'email', kind: 'sent' };
    case 'whatsapp.sent':
      return { channel: 'whatsapp', kind: 'sent' };
    case 'sms.sent':
      return { channel: 'sms', kind: 'sent' };
    case 'communication.email':
      return { channel: 'email', kind: 'reply' };
    case 'communication.whatsapp':
      return { channel: 'whatsapp', kind: 'reply' };
    case 'communication.sms':
      return { channel: 'sms', kind: 'reply' };
    case 'communication.call':
      return { channel: 'call', kind: 'reply' };
    case 'campaign.sent':
      return { channel: dataChannel ?? 'email', kind: 'sent' };
    case 'campaign.opened':
      return { channel: dataChannel ?? 'email', kind: 'open' };
    default:
      return null;
  }
}

@Injectable()
export class BestChannelService {
  private readonly logger = new Logger(BestChannelService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Apply a single event to the rollup and recompute the contact's signals.
   * Idempotent enough to be safely called from listener after-create.
   */
  async recordEvent(input: {
    businessId: string;
    contactId: string;
    type: string;
    data?: unknown;
    at?: Date;
  }): Promise<void> {
    const cls = classifyEvent(input.type, input.data);
    if (!cls) return;
    const at = input.at ?? new Date();
    await this.upsertStat(input.businessId, input.contactId, cls.channel, cls.kind, at);
    await this.recompute(input.businessId, input.contactId);
  }

  private async upsertStat(
    businessId: string,
    contactId: string,
    channel: BestChannel,
    kind: 'sent' | 'reply' | 'open',
    at: Date,
  ): Promise<void> {
    const tz = await this.contactTz(contactId);
    const bucketKey = this.bucketKey(at, tz);
    const existing = await this.prisma.client.contactChannelStat.findUnique({
      where: { contactId_channel: { contactId, channel } },
    });
    const buckets = (existing?.hourBucketsJson as Record<string, number> | null) ?? {};
    if (kind === 'reply') {
      buckets[bucketKey] = (buckets[bucketKey] ?? 0) + 1;
    }
    if (existing) {
      await this.prisma.client.contactChannelStat.update({
        where: { id: existing.id },
        data: {
          sentCount: kind === 'sent' ? existing.sentCount + 1 : existing.sentCount,
          replyCount: kind === 'reply' ? existing.replyCount + 1 : existing.replyCount,
          openCount: kind === 'open' ? existing.openCount + 1 : existing.openCount,
          lastReplyAt: kind === 'reply' ? at : existing.lastReplyAt,
          lastSentAt: kind === 'sent' ? at : existing.lastSentAt,
          hourBucketsJson: buckets,
        },
      });
    } else {
      await this.prisma.client.contactChannelStat.create({
        data: {
          businessId,
          contactId,
          channel,
          sentCount: kind === 'sent' ? 1 : 0,
          replyCount: kind === 'reply' ? 1 : 0,
          openCount: kind === 'open' ? 1 : 0,
          lastReplyAt: kind === 'reply' ? at : null,
          lastSentAt: kind === 'sent' ? at : null,
          hourBucketsJson: buckets,
        },
      });
    }
  }

  /**
   * Read the rollup, score channels and time window, persist to Contact.
   */
  async recompute(businessId: string, contactId: string): Promise<void> {
    const stats = await this.prisma.client.contactChannelStat.findMany({
      where: { businessId, contactId },
    });
    if (stats.length === 0) {
      await this.prisma.client.contact.update({
        where: { id: contactId },
        data: {
          bestChannel: null,
          bestChannelConfidence: null,
          bestTimeWindowJson: undefined as unknown as never,
          bestSignalUpdatedAt: new Date(),
        },
      }).catch(() => {});
      return;
    }

    const now = Date.now();
    const scored = stats.map((s) => {
      const responseRate = s.sentCount > 0 ? s.replyCount / s.sentCount : s.replyCount > 0 ? 1 : 0;
      const openRate = s.sentCount > 0 ? s.openCount / s.sentCount : 0;
      const lastTouch = s.lastReplyAt ?? s.lastSentAt;
      const days = lastTouch ? Math.max(0, (now - lastTouch.getTime()) / 86_400_000) : 365;
      const recency = Math.exp(-Math.LN2 * (days / RECENCY_HALFLIFE_DAYS));
      const volume = Math.log(1 + s.sentCount + s.replyCount + s.openCount);
      const score = (responseRate * 0.7 + openRate * 0.3) * recency * volume + recency * 0.05;
      return { stat: s, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const top = scored[0];
    const totalScore = scored.reduce((sum, s) => sum + Math.max(s.score, 0), 0) || 1;
    const confidence = Math.min(1, Math.max(0, top.score / totalScore));

    const tz = await this.contactTz(contactId);
    const allBuckets: Record<string, number> = {};
    for (const s of stats) {
      const b = (s.hourBucketsJson as Record<string, number> | null) ?? {};
      for (const [k, v] of Object.entries(b)) {
        allBuckets[k] = (allBuckets[k] ?? 0) + (typeof v === 'number' ? v : 0);
      }
    }
    const window = this.computeBestWindow(allBuckets, tz);

    await this.prisma.client.contact.update({
      where: { id: contactId },
      data: {
        bestChannel: top.score > 0 ? (top.stat.channel as BestChannel) : null,
        bestChannelConfidence: top.score > 0 ? Number(confidence.toFixed(3)) : null,
        bestTimeWindowJson: window ? (window as unknown as never) : (undefined as unknown as never),
        bestSignalUpdatedAt: new Date(),
      },
    });
  }

  /**
   * Replay a contact's full event history into the rollup. Used for backfill
   * or whenever stats are suspected to be stale.
   */
  async rebuildFromHistory(businessId: string, contactId: string): Promise<void> {
    const events = await this.prisma.client.contactEvent.findMany({
      where: { businessId, contactId },
      orderBy: { createdAt: 'asc' },
      take: 5_000,
    });
    await this.prisma.client.contactChannelStat.deleteMany({ where: { contactId } });
    const tz = await this.contactTz(contactId);
    const acc: Record<BestChannel, {
      sent: number; reply: number; open: number;
      lastSent: Date | null; lastReply: Date | null;
      buckets: Record<string, number>;
    }> = {
      email: { sent: 0, reply: 0, open: 0, lastSent: null, lastReply: null, buckets: {} },
      whatsapp: { sent: 0, reply: 0, open: 0, lastSent: null, lastReply: null, buckets: {} },
      sms: { sent: 0, reply: 0, open: 0, lastSent: null, lastReply: null, buckets: {} },
      call: { sent: 0, reply: 0, open: 0, lastSent: null, lastReply: null, buckets: {} },
    };
    for (const ev of events) {
      const cls = classifyEvent(ev.type, ev.data);
      if (!cls) continue;
      const slot = acc[cls.channel];
      if (cls.kind === 'sent') { slot.sent += 1; slot.lastSent = ev.createdAt; }
      else if (cls.kind === 'reply') {
        slot.reply += 1; slot.lastReply = ev.createdAt;
        const k = this.bucketKey(ev.createdAt, tz);
        slot.buckets[k] = (slot.buckets[k] ?? 0) + 1;
      } else if (cls.kind === 'open') slot.open += 1;
    }
    for (const ch of CHANNELS) {
      const a = acc[ch];
      if (a.sent + a.reply + a.open === 0) continue;
      await this.prisma.client.contactChannelStat.create({
        data: {
          businessId, contactId, channel: ch,
          sentCount: a.sent, replyCount: a.reply, openCount: a.open,
          lastReplyAt: a.lastReply, lastSentAt: a.lastSent,
          hourBucketsJson: a.buckets,
        },
      });
    }
    await this.recompute(businessId, contactId);
  }

  /**
   * Recompute (without rebuilding from history) every contact in a business
   * that has channel stats. Used by the nightly scheduler.
   */
  async recomputeAllForBusiness(businessId: string): Promise<{ processed: number; failed: number }> {
    const contactIds = await this.prisma.client.contactChannelStat.findMany({
      where: { businessId },
      select: { contactId: true },
      distinct: ['contactId'],
      take: 100_000,
    });
    let processed = 0;
    let failed = 0;
    for (const row of contactIds) {
      try {
        await this.recompute(businessId, row.contactId);
        processed += 1;
      } catch (err) {
        failed += 1;
        this.logger.warn(
          `Best-channel recompute failed for contact=${row.contactId}: ${(err as Error).message}`,
        );
      }
    }
    return { processed, failed };
  }

  /**
   * Build a tooltip-friendly explanation for a contact.
   */
  async explain(businessId: string, contactId: string): Promise<BestChannelExplanation> {
    const [contact, stats] = await Promise.all([
      this.prisma.client.contact.findFirst({
        where: { id: contactId, businessId },
        select: {
          bestChannel: true,
          bestChannelConfidence: true,
          bestTimeWindowJson: true,
          bestSignalUpdatedAt: true,
        },
      }),
      this.prisma.client.contactChannelStat.findMany({
        where: { businessId, contactId },
      }),
    ]);
    return {
      channel: (contact?.bestChannel as BestChannel | null) ?? null,
      confidence: contact?.bestChannelConfidence ?? 0,
      perChannel: stats.map((s) => ({
        channel: s.channel as BestChannel,
        sentCount: s.sentCount,
        replyCount: s.replyCount,
        openCount: s.openCount,
        responseRate: s.sentCount > 0 ? s.replyCount / s.sentCount : 0,
        lastReplyAt: s.lastReplyAt ? s.lastReplyAt.toISOString() : null,
        score: 0,
      })),
      timeWindow: (contact?.bestTimeWindowJson as BestTimeWindow | null) ?? null,
      updatedAt: contact?.bestSignalUpdatedAt ? contact.bestSignalUpdatedAt.toISOString() : null,
    };
  }

  /**
   * Find contacts whose best-time window contains the current local hour-of-week.
   * Returns only contact ids; caller is expected to intersect with its own filters.
   */
  async findContactsBestTimeNow(businessId: string, opts?: { windowMinutes?: number }): Promise<string[]> {
    const minutes = opts?.windowMinutes ?? 60;
    const now = new Date();
    const candidates = await this.prisma.client.contact.findMany({
      where: { businessId, deletedAt: null, NOT: { bestTimeWindowJson: { equals: Prisma.JsonNull } } },
      select: { id: true, bestTimeWindowJson: true, timezone: true },
      take: 50_000,
    });
    const out: string[] = [];
    for (const c of candidates) {
      const w = c.bestTimeWindowJson as BestTimeWindow | null;
      if (!w || typeof w.dayOfWeek !== 'number') continue;
      const tz = w.tz || c.timezone || DEFAULT_TZ;
      const local = this.toLocalParts(now, tz);
      const localPlus = this.toLocalParts(new Date(now.getTime() + minutes * 60_000), tz);
      const inWindow = (lp: { dayOfWeek: number; hour: number }) =>
        lp.dayOfWeek === w.dayOfWeek && lp.hour >= w.hourStart && lp.hour < w.hourEnd;
      if (inWindow(local) || inWindow(localPlus)) out.push(c.id);
    }
    return out;
  }

  private async contactTz(contactId: string): Promise<string> {
    const c = await this.prisma.client.contact.findUnique({
      where: { id: contactId },
      select: { timezone: true },
    });
    return c?.timezone || DEFAULT_TZ;
  }

  private bucketKey(at: Date, tz: string): string {
    const lp = this.toLocalParts(at, tz);
    return `${lp.dayOfWeek}-${lp.hour}`;
  }

  private toLocalParts(date: Date, tz: string): { dayOfWeek: number; hour: number } {
    try {
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        weekday: 'short',
        hour: 'numeric',
        hour12: false,
      });
      const parts = fmt.formatToParts(date);
      const wkRaw = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
      const hourRaw = parts.find((p) => p.type === 'hour')?.value ?? '0';
      const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const hour = Math.max(0, Math.min(23, parseInt(hourRaw, 10) % 24));
      return { dayOfWeek: dayMap[wkRaw] ?? 0, hour };
    } catch {
      return { dayOfWeek: date.getUTCDay(), hour: date.getUTCHours() };
    }
  }

  private computeBestWindow(buckets: Record<string, number>, tz: string): BestTimeWindow | null {
    const totalSamples = Object.values(buckets).reduce((s, v) => s + v, 0);
    if (totalSamples < 2) return null;
    let best: { dow: number; start: number; end: number; count: number } | null = null;
    const WINDOW_HOURS = 3;
    for (let dow = 0; dow < 7; dow += 1) {
      for (let hStart = 0; hStart < 24; hStart += 1) {
        let count = 0;
        for (let h = 0; h < WINDOW_HOURS; h += 1) {
          const hour = (hStart + h) % 24;
          count += buckets[`${dow}-${hour}`] ?? 0;
        }
        if (!best || count > best.count) {
          best = { dow, start: hStart, end: (hStart + WINDOW_HOURS) % 24 || 24, count };
        }
      }
    }
    if (!best || best.count === 0) return null;
    const endHour = (best.start + WINDOW_HOURS) % 24;
    return {
      dayOfWeek: best.dow,
      hourStart: best.start,
      hourEnd: endHour === 0 ? 24 : endHour,
      tz,
      label: this.formatLabel(best.dow, best.start, WINDOW_HOURS, tz),
      sampleCount: best.count,
    };
  }

  private formatLabel(dow: number, start: number, span: number, tz: string): string {
    const fmt = (h: number) => {
      const hh = ((h % 24) + 24) % 24;
      const am = hh < 12;
      const display = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
      return `${display}${am ? 'am' : 'pm'}`;
    };
    let abbr = tz;
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
        .formatToParts(new Date());
      abbr = parts.find((p) => p.type === 'timeZoneName')?.value || tz;
    } catch (err) {
        this.logger.warn(`Silent catch: ${err instanceof Error ? err.message : err}`);
      }
    return `${PLURAL_DAY[dow] ?? DAY_NAMES[dow]} ${fmt(start)}–${fmt(start + span)} ${abbr}`;
  }
}
