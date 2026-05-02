import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';

export type JourneyStage =
  | 'AWARENESS'
  | 'INTEREST'
  | 'CONSIDERATION'
  | 'CONVERSION'
  | 'RETENTION'
  | 'ADVOCACY'
  | 'CHURNED';

export type Channel =
  | 'organic'
  | 'social'
  | 'email'
  | 'paid'
  | 'referral'
  | 'direct'
  | 'form'
  | 'sms'
  | 'whatsapp'
  | 'voice'
  | 'website'
  | 'other';

export interface RecordTouchpointInput {
  businessId: string;
  contactId: string;
  channel: Channel | string;
  source: string;
  campaignId?: string;
  campaignName?: string;
  contentId?: string;
  touchpointType: string;
  stageHint?: JourneyStage;
  value?: number;
  currency?: string;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
}

const STAGE_PRIORITY: Record<JourneyStage, number> = {
  AWARENESS: 1,
  INTEREST: 2,
  CONSIDERATION: 3,
  CONVERSION: 4,
  RETENTION: 5,
  ADVOCACY: 6,
  CHURNED: 0,
};

const CONVERSION_TOUCHPOINTS = new Set(['payment', 'invoice_paid', 'booking', 'purchase', 'order_paid']);

function toNumber(val: unknown): number {
  if (typeof val === 'number') return val;
  if (val !== null && val !== undefined && typeof val === 'object' && 'toNumber' in val) {
    return (val as { toNumber: () => number }).toNumber();
  }
  return Number(val ?? 0);
}

@Injectable()
export class CustomerJourneyService {
  private readonly logger = new Logger(CustomerJourneyService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  /**
   * Records a single touchpoint, upserts the customer's CustomerJourney aggregate, and
   * recomputes attribution weights across all touchpoints (so first/last/linear models stay
   * consistent without needing a heavy nightly job).
   */
  async recordTouchpoint(input: RecordTouchpointInput) {
    const occurredAt = input.occurredAt ?? new Date();

    const journey = await this.db.customerJourney.upsert({
      where: { contactId: input.contactId },
      create: {
        businessId: input.businessId,
        contactId: input.contactId,
        stage: input.stageHint ?? 'AWARENESS',
        firstTouchAt: occurredAt,
        lastTouchAt: occurredAt,
        firstTouchChannel: input.channel,
        firstTouchSource: input.source,
        firstTouchCampaign: input.campaignName ?? input.campaignId ?? null,
        lastTouchChannel: input.channel,
        lastTouchSource: input.source,
        lastTouchCampaign: input.campaignName ?? input.campaignId ?? null,
        touchpointCount: 0,
        channels: [input.channel],
      },
      update: {},
    });

    await this.db.journeyTouchpoint.create({
      data: {
        businessId: input.businessId,
        contactId: input.contactId,
        journeyId: journey.id,
        channel: input.channel,
        source: input.source,
        campaignId: input.campaignId ?? null,
        campaignName: input.campaignName ?? null,
        contentId: input.contentId ?? null,
        touchpointType: input.touchpointType,
        stageHint: input.stageHint ?? null,
        value: input.value !== undefined ? input.value : null,
        currency: input.currency ?? 'TTD',
        metadata: (input.metadata ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        occurredAt,
      },
    });

    await this.recomputeJourney(journey.id);
    return journey.id;
  }

  /**
   * Recomputes aggregates + attribution weights for one journey. Called after every new
   * touchpoint so reads from the dashboard are always fresh.
   */
  async recomputeJourney(journeyId: string) {
    const touchpoints = await this.db.journeyTouchpoint.findMany({
      where: { journeyId },
      orderBy: { occurredAt: 'asc' },
    });
    if (touchpoints.length === 0) return;

    const journey = await this.db.customerJourney.findUnique({ where: { id: journeyId } });
    if (!journey) return;

    const first = touchpoints[0];
    const last = touchpoints[touchpoints.length - 1];

    const linearWeight = 1 / touchpoints.length;
    for (let i = 0; i < touchpoints.length; i++) {
      const tp = touchpoints[i];
      await this.db.journeyTouchpoint.update({
        where: { id: tp.id },
        data: {
          firstTouchWeight: i === 0 ? 1 : 0,
          lastTouchWeight: i === touchpoints.length - 1 ? 1 : 0,
          linearWeight,
        },
      });
    }

    const channels = Array.from(new Set(touchpoints.map(t => t.channel)));
    const totalRevenue = touchpoints
      .filter(t => CONVERSION_TOUCHPOINTS.has(t.touchpointType))
      .reduce((sum, t) => sum + toNumber(t.value), 0);
    const conversion = touchpoints.find(t => CONVERSION_TOUCHPOINTS.has(t.touchpointType));

    const stageHints = touchpoints
      .map(t => t.stageHint as JourneyStage | null)
      .filter((s): s is JourneyStage => Boolean(s));
    let stage: JourneyStage = 'AWARENESS';
    for (const hint of stageHints) {
      if (STAGE_PRIORITY[hint] > STAGE_PRIORITY[stage]) stage = hint;
    }
    if (conversion && STAGE_PRIORITY[stage] < STAGE_PRIORITY.CONVERSION) stage = 'CONVERSION';
    // Promote to RETENTION if multiple conversions
    const conversionCount = touchpoints.filter(t => CONVERSION_TOUCHPOINTS.has(t.touchpointType)).length;
    if (conversionCount >= 2 && STAGE_PRIORITY[stage] < STAGE_PRIORITY.RETENTION) stage = 'RETENTION';

    const daysToConversion = conversion && first
      ? Math.max(0, Math.round((conversion.occurredAt.getTime() - first.occurredAt.getTime()) / (1000 * 60 * 60 * 24)))
      : null;

    const lastTouchAge = (Date.now() - last.occurredAt.getTime()) / (1000 * 60 * 60 * 24);
    const riskLevel = lastTouchAge > 90 ? 'high' : lastTouchAge > 45 ? 'medium' : lastTouchAge > 21 ? 'low' : 'none';
    const recencyScore = lastTouchAge <= 7 ? 30 : lastTouchAge <= 30 ? 20 : lastTouchAge <= 60 ? 10 : 0;
    const breadthScore = Math.min(20, channels.length * 7);
    const conversionScore = conversionCount > 0 ? 30 : 0;
    const valueScore = totalRevenue > 0 ? Math.min(20, Math.log10(totalRevenue + 1) * 5) : 0;
    const healthScore = Math.round(Math.max(0, Math.min(100, recencyScore + breadthScore + conversionScore + valueScore)));
    const momentum = Math.round(Math.min(100, touchpoints.length * 5 + recencyScore));

    await this.db.customerJourney.update({
      where: { id: journeyId },
      data: {
        stage,
        firstTouchAt: first.occurredAt,
        lastTouchAt: last.occurredAt,
        firstTouchChannel: first.channel,
        firstTouchSource: first.source,
        firstTouchCampaign: first.campaignName ?? first.campaignId ?? null,
        lastTouchChannel: last.channel,
        lastTouchSource: last.source,
        lastTouchCampaign: last.campaignName ?? last.campaignId ?? null,
        touchpointCount: touchpoints.length,
        channels,
        totalRevenue,
        conversionValue: totalRevenue,
        convertedAt: conversion?.occurredAt ?? null,
        daysToConversion,
        momentum,
        healthScore,
        riskLevel,
      },
    });
  }

  async getJourney(businessId: string, contactId: string) {
    const journey = await this.db.customerJourney.findFirst({
      where: { businessId, contactId },
      include: { touchpoints: { orderBy: { occurredAt: 'asc' } } },
    });
    if (!journey) return null;
    return {
      id: journey.id,
      contactId: journey.contactId,
      stage: journey.stage,
      firstTouchAt: journey.firstTouchAt?.toISOString() ?? null,
      lastTouchAt: journey.lastTouchAt?.toISOString() ?? null,
      convertedAt: journey.convertedAt?.toISOString() ?? null,
      firstTouch: { channel: journey.firstTouchChannel, source: journey.firstTouchSource, campaign: journey.firstTouchCampaign },
      lastTouch: { channel: journey.lastTouchChannel, source: journey.lastTouchSource, campaign: journey.lastTouchCampaign },
      touchpointCount: journey.touchpointCount,
      channels: journey.channels,
      totalRevenue: toNumber(journey.totalRevenue),
      daysToConversion: journey.daysToConversion,
      momentum: journey.momentum,
      healthScore: journey.healthScore,
      riskLevel: journey.riskLevel,
      touchpoints: journey.touchpoints.map(tp => ({
        id: tp.id,
        channel: tp.channel,
        source: tp.source,
        campaignId: tp.campaignId,
        campaignName: tp.campaignName,
        touchpointType: tp.touchpointType,
        stageHint: tp.stageHint,
        value: tp.value ? toNumber(tp.value) : 0,
        currency: tp.currency,
        firstTouchWeight: tp.firstTouchWeight,
        lastTouchWeight: tp.lastTouchWeight,
        linearWeight: tp.linearWeight,
        occurredAt: tp.occurredAt.toISOString(),
        metadata: tp.metadata,
      })),
    };
  }

  async listJourneys(businessId: string, opts: { stage?: JourneyStage; limit?: number } = {}) {
    const journeys = await this.db.customerJourney.findMany({
      where: {
        businessId,
        ...(opts.stage ? { stage: opts.stage } : {}),
      },
      include: { contact: { select: { id: true, firstName: true, lastName: true, email: true, status: true } } },
      orderBy: { lastTouchAt: 'desc' },
      take: opts.limit ?? 50,
    });
    return journeys.map(j => ({
      id: j.id,
      contactId: j.contactId,
      contactName: `${j.contact.firstName ?? ''} ${j.contact.lastName ?? ''}`.trim() || j.contact.email || 'Unknown',
      stage: j.stage,
      firstTouchChannel: j.firstTouchChannel,
      lastTouchChannel: j.lastTouchChannel,
      touchpointCount: j.touchpointCount,
      channels: j.channels,
      totalRevenue: toNumber(j.totalRevenue),
      momentum: j.momentum,
      healthScore: j.healthScore,
      riskLevel: j.riskLevel,
      lastTouchAt: j.lastTouchAt?.toISOString() ?? null,
      convertedAt: j.convertedAt?.toISOString() ?? null,
    }));
  }

  async getStageBreakdown(businessId: string) {
    const grouped = await this.db.customerJourney.groupBy({
      by: ['stage'],
      where: { businessId },
      _count: true,
      _sum: { totalRevenue: true },
    });
    return grouped.map(g => ({
      stage: g.stage,
      count: g._count,
      totalRevenue: toNumber(g._sum.totalRevenue ?? 0),
    }));
  }

  /**
   * Backfills journeys & touchpoints from existing CRM events / invoices / bookings / forms.
   * Idempotent — can be safely run on demand from the dashboard.
   */
  async backfillBusiness(businessId: string) {
    const contacts = await this.db.contact.findMany({
      where: { businessId, deletedAt: null },
      select: { id: true, createdAt: true, source: true },
    });

    let recorded = 0;
    for (const contact of contacts) {
      const sourceChannel = inferChannelFromSource(contact.source);

      const [events, invoices, bookings, formSubs] = await Promise.all([
        this.db.contactEvent.findMany({
          where: { businessId, contactId: contact.id },
          orderBy: { createdAt: 'asc' },
        }),
        this.db.invoice.findMany({
          where: { businessId, contactId: contact.id, deletedAt: null },
          select: { id: true, total: true, status: true, paidAt: true, createdAt: true, currency: true },
          orderBy: { createdAt: 'asc' },
        }),
        this.db.booking.findMany({
          where: { businessId, contactId: contact.id, deletedAt: null },
          select: { id: true, startTime: true, status: true },
          orderBy: { startTime: 'asc' },
        }),
        this.db.leadFormSubmission.findMany({
          where: { businessId, contactId: contact.id },
          orderBy: { createdAt: 'asc' },
        }),
      ]);

      // Reset journey before backfill so we don't double count
      await this.db.journeyTouchpoint.deleteMany({ where: { contactId: contact.id, businessId } });

      // First touch: contact creation
      await this.recordTouchpoint({
        businessId,
        contactId: contact.id,
        channel: sourceChannel,
        source: contact.source ?? 'crm',
        touchpointType: 'first_contact',
        stageHint: 'AWARENESS',
        occurredAt: contact.createdAt,
      });
      recorded++;

      for (const sub of formSubs) {
        await this.recordTouchpoint({
          businessId,
          contactId: contact.id,
          channel: 'form',
          source: sub.source ?? 'lead_form',
          touchpointType: 'form_submit',
          stageHint: 'INTEREST',
          occurredAt: sub.createdAt,
          metadata: { submissionId: sub.id },
        });
        recorded++;
      }

      for (const ev of events) {
        const mapped = mapEventToTouchpoint(ev.type);
        if (!mapped) continue;
        await this.recordTouchpoint({
          businessId,
          contactId: contact.id,
          channel: mapped.channel,
          source: ev.source ?? mapped.source,
          touchpointType: mapped.touchpointType,
          stageHint: mapped.stageHint,
          occurredAt: ev.createdAt,
          metadata: ev.data as Record<string, unknown> | null ?? undefined,
        });
        recorded++;
      }

      for (const bk of bookings) {
        await this.recordTouchpoint({
          businessId,
          contactId: contact.id,
          channel: 'direct',
          source: 'bookings',
          touchpointType: 'booking',
          stageHint: 'CONSIDERATION',
          occurredAt: bk.startTime,
          metadata: { bookingId: bk.id, status: bk.status },
        });
        recorded++;
      }

      for (const inv of invoices) {
        if (inv.status === 'PAID' && inv.paidAt) {
          await this.recordTouchpoint({
            businessId,
            contactId: contact.id,
            channel: 'direct',
            source: 'commerce',
            touchpointType: 'payment',
            stageHint: 'CONVERSION',
            value: toNumber(inv.total),
            currency: inv.currency ?? 'TTD',
            occurredAt: inv.paidAt,
            metadata: { invoiceId: inv.id },
          });
          recorded++;
        }
      }
    }
    return { contactsProcessed: contacts.length, touchpointsRecorded: recorded };
  }

}

function inferChannelFromSource(src: string | null | undefined): Channel {
  if (!src) return 'direct';
  const s = src.toLowerCase();
  if (s.includes('mail') || s.includes('email') || s.includes('klaviyo') || s.includes('mailchimp')) return 'email';
  if (s.includes('insta') || s.includes('facebook') || s.includes('linkedin') || s.includes('tiktok') || s.includes('twitter')) return 'social';
  if (s.includes('whatsapp')) return 'whatsapp';
  if (s.includes('form') || s.includes('typeform') || s.includes('jotform') || s.includes('webhook')) return 'form';
  if (s.includes('referral')) return 'referral';
  if (s.includes('organic') || s.includes('google') || s.includes('seo')) return 'organic';
  if (s.includes('paid') || s.includes('ad')) return 'paid';
  return 'direct';
}

function mapEventToTouchpoint(eventType: string): { channel: Channel; source: string; touchpointType: string; stageHint: JourneyStage } | null {
  const t = eventType.toLowerCase();
  if (t.startsWith('campaign.') || t.startsWith('email.')) {
    return { channel: 'email', source: 'campaign', touchpointType: t.includes('open') ? 'email_open' : t.includes('click') ? 'email_click' : 'email_send', stageHint: 'INTEREST' };
  }
  if (t.startsWith('lead_form.') || t.startsWith('form.')) {
    return { channel: 'form', source: 'lead_form', touchpointType: 'form_submit', stageHint: 'INTEREST' };
  }
  if (t.startsWith('quote.')) {
    return { channel: 'direct', source: 'commerce', touchpointType: 'quote', stageHint: 'CONSIDERATION' };
  }
  if (t === 'invoice.paid' || t === 'payment.received') {
    return { channel: 'direct', source: 'commerce', touchpointType: 'payment', stageHint: 'CONVERSION' };
  }
  if (t.startsWith('booking.')) {
    return { channel: 'direct', source: 'bookings', touchpointType: 'booking', stageHint: 'CONSIDERATION' };
  }
  if (t.startsWith('whatsapp.') || t === 'communication.whatsapp') {
    return { channel: 'whatsapp', source: 'whatsapp', touchpointType: 'message', stageHint: 'INTEREST' };
  }
  if (t.startsWith('communication.')) {
    return { channel: 'direct', source: 'communication', touchpointType: 'message', stageHint: 'INTEREST' };
  }
  if (t.includes('social') || t.includes('post.')) {
    return { channel: 'social', source: 'social', touchpointType: 'social_engagement', stageHint: 'AWARENESS' };
  }
  return null;
}
