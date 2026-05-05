import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmService } from '../crm/crm.service';
import { CrmTimelineService } from '../crm/crm-timeline.service';
import { isCanonicalContactEventType } from '@keyflow/shared';
import { randomBytes } from 'node:crypto';

export type PublicEventIdentity = {
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
};

export type TrackInput = {
  businessId: string;
  visitorId?: string | null;
  type: string;
  sourceDetail?: string | null;
  referralCode?: string | null;
  data?: Prisma.InputJsonValue;
  identity?: PublicEventIdentity | null;
};

const STOREFRONT_SOURCE = 'storefront';

@Injectable()
export class PublicEventsService {
  private readonly logger = new Logger(PublicEventsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(CrmTimelineService) private readonly timeline: CrmTimelineService,
  ) {}

  static newVisitorId(): string {
    return `v_${randomBytes(12).toString('hex')}`;
  }

  private splitName(name?: string | null) {
    const trimmed = (name ?? '').trim();
    if (!trimmed) return { firstName: null, lastName: null };
    const parts = trimmed.split(/\s+/);
    return {
      firstName: parts[0],
      lastName: parts.length > 1 ? parts.slice(1).join(' ') : null,
    };
  }

  /**
   * Resolve (or create) the contact for an identified public action,
   * tagging it with source='storefront' and the storefront slug/id.
   * Re-uses the CrmService dedup so visitor identity merges back into
   * the right contact.
   */
  async upsertStorefrontContact(input: {
    businessId: string;
    sourceDetail?: string | null;
    referralCode?: string | null;
    identity: PublicEventIdentity;
    visitorId?: string | null;
  }) {
    const id = input.identity ?? {};
    const fromName = this.splitName(id.name);
    const firstName = id.firstName ?? fromName.firstName;
    const lastName = id.lastName ?? fromName.lastName;

    if (!id.email && !id.phone && !firstName) return null;

    // Pull first-touch attribution from the visitor cookie row (S4) so
    // the contact carries the original UTM/source it arrived with.
    let firstTouch: Awaited<ReturnType<PublicEventsService['firstTouchFor']>> = null;
    if (input.visitorId) {
      firstTouch = await this.firstTouchFor(input.businessId, input.visitorId);
    }

    const custom: Record<string, unknown> = {};
    if (input.referralCode) custom.referralCode = input.referralCode;
    if (firstTouch) {
      if (firstTouch.firstSource) custom.firstSource = firstTouch.firstSource;
      if (firstTouch.firstMedium) custom.utmMedium = firstTouch.firstMedium;
      if (firstTouch.firstCampaign) custom.utmCampaign = firstTouch.firstCampaign;
      if (firstTouch.firstReferrer) custom.firstReferrer = firstTouch.firstReferrer;
      if (firstTouch.firstPath) custom.firstLandingPath = firstTouch.firstPath;
    }

    const sourceDetail = input.sourceDetail
      ?? (firstTouch?.firstSource ? `utm:${firstTouch.firstSource}` : null);

    const contact = await this.crm.findOrCreateContact(input.businessId, {
      firstName,
      lastName,
      email: id.email ?? null,
      phone: id.phone ?? null,
      companyName: id.companyName ?? null,
      source: STOREFRONT_SOURCE,
      sourceDetail,
      ...(Object.keys(custom).length > 0 ? { custom } : {}),
    });

    if (contact?.id && input.visitorId) {
      try {
        await this.prisma.client.publicVisitor.update({
          where: {
            businessId_visitorId: {
              businessId: input.businessId,
              visitorId: input.visitorId,
            },
          },
          data: { contactId: contact.id },
        });
      } catch {
        // visitor row may not exist yet; ignore.
      }
    }

    return contact;
  }

  /**
   * Link an existing Contact to a visitor cookie and back-fill first-touch
   * attribution custom fields when they are still blank. Used by flows
   * (e.g. public quote accept/reject) where the Contact already exists but
   * was created without a visitorId, so first-touch UTM/source/referrer
   * never landed on the Contact record.
   */
  async attachVisitorToContact(input: {
    businessId: string;
    contactId: string;
    visitorId: string;
    sourceDetail?: string | null;
  }): Promise<void> {
    if (!input.visitorId || !input.contactId || !input.businessId) return;

    const firstTouch = await this.firstTouchFor(input.businessId, input.visitorId);

    if (firstTouch) {
      try {
        const contact = await this.prisma.client.contact.findUnique({
          where: { id: input.contactId },
          select: { custom: true },
        });
        const existingCustom =
          contact?.custom && typeof contact.custom === 'object' && !Array.isArray(contact.custom)
            ? (contact.custom as Record<string, unknown>)
            : {};
        const merged: Record<string, unknown> = { ...existingCustom };
        const setIfBlank = (key: string, value: unknown) => {
          if (value && (merged[key] === undefined || merged[key] === null || merged[key] === '')) {
            merged[key] = value;
          }
        };
        setIfBlank('firstSource', firstTouch.firstSource);
        setIfBlank('utmMedium', firstTouch.firstMedium);
        setIfBlank('utmCampaign', firstTouch.firstCampaign);
        setIfBlank('firstReferrer', firstTouch.firstReferrer);
        setIfBlank('firstLandingPath', firstTouch.firstPath);
        if (Object.keys(merged).length !== Object.keys(existingCustom).length) {
          await this.prisma.client.contact.update({
            where: { id: input.contactId },
            data: { custom: merged as Prisma.InputJsonValue },
          });
        }
      } catch (err) {
        this.logger.warn(
          `[public-events] attach first-touch failed contact=${input.contactId}: ${(err as Error).message}`,
        );
      }
    }

    try {
      await this.prisma.client.publicVisitor.update({
        where: {
          businessId_visitorId: {
            businessId: input.businessId,
            visitorId: input.visitorId,
          },
        },
        data: { contactId: input.contactId },
      });
    } catch {
      // visitor row may not exist for this cookie yet; safe to ignore.
    }

    await this.backstitchVisitor({
      businessId: input.businessId,
      visitorId: input.visitorId,
      contactId: input.contactId,
      sourceDetail: input.sourceDetail ?? null,
    }).catch(() => undefined);
  }

  /**
   * Resolve first-touch attribution for an anonymous visitor cookie.
   * Used by storefront flows when creating a Contact, and exposed for
   * other server modules that want to enrich downstream records.
   */
  async firstTouchFor(businessId: string, visitorId: string | null | undefined) {
    if (!visitorId || !businessId) return null;
    return this.prisma.client.publicVisitor.findUnique({
      where: { businessId_visitorId: { businessId, visitorId } },
      select: {
        firstSource: true, firstMedium: true, firstCampaign: true,
        firstReferrer: true, firstPath: true,
      },
    });
  }

  /**
   * Records a public visitor event. If `identity` is provided we upsert a
   * Contact (storefront source), back-stitch any earlier anonymous events
   * for that visitor, and emit the canonical ContactEvent through the
   * timeline service. Anonymous events are stored as PublicVisitorEvent
   * rows and replayed on first identification.
   */
  async track(input: TrackInput): Promise<{ visitorId: string; contactId: string | null; eventId: string }> {
    const visitorId = input.visitorId?.trim() || PublicEventsService.newVisitorId();
    const data: Prisma.InputJsonValue = (input.data ?? {}) as Prisma.InputJsonValue;

    let contactId: string | null = null;
    if (input.identity && (input.identity.email || input.identity.phone || input.identity.name)) {
      try {
        const contact = await this.upsertStorefrontContact({
          businessId: input.businessId,
          sourceDetail: input.sourceDetail,
          referralCode: input.referralCode,
          identity: input.identity,
          visitorId,
        });
        contactId = contact?.id ?? null;
      } catch (err) {
        this.logger.warn(`[public-events] contact upsert failed: ${(err as Error).message}`);
      }
    }

    if (!contactId) {
      const existing = await this.prisma.client.publicVisitorEvent.findFirst({
        where: { businessId: input.businessId, visitorId, contactId: { not: null } },
        select: { contactId: true },
      });
      contactId = existing?.contactId ?? null;
    }

    const stored = await this.prisma.client.publicVisitorEvent.create({
      data: {
        businessId: input.businessId,
        visitorId,
        type: input.type,
        sourceDetail: input.sourceDetail ?? null,
        referralCode: input.referralCode ?? null,
        data,
        contactId,
        identifiedAt: contactId ? new Date() : null,
      },
    });

    if (contactId) {
      await this.backstitchVisitor({
        businessId: input.businessId,
        visitorId,
        contactId,
        sourceDetail: input.sourceDetail ?? null,
      });
      const baseData =
        data && typeof data === 'object' && !Array.isArray(data)
          ? (data as Record<string, unknown>)
          : {};
      await this.safeLog(input.businessId, contactId, input.type, {
        ...baseData,
        visitorId,
        sourceDetail: input.sourceDetail ?? null,
        referralCode: input.referralCode ?? null,
      });
    }

    return { visitorId, contactId, eventId: stored.id };
  }

  /**
   * Attaches all previously-anonymous events for a visitor to the now-known
   * contact and replays each as a canonical ContactEvent. Idempotent.
   */
  async backstitchVisitor(input: {
    businessId: string;
    visitorId: string;
    contactId: string;
    sourceDetail?: string | null;
  }) {
    const orphans = await this.prisma.client.publicVisitorEvent.findMany({
      where: {
        businessId: input.businessId,
        visitorId: input.visitorId,
        contactId: null,
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    if (orphans.length === 0) return { backstitched: 0 };

    const now = new Date();
    await this.prisma.client.publicVisitorEvent.updateMany({
      where: { id: { in: orphans.map((o) => o.id) } },
      data: { contactId: input.contactId, identifiedAt: now },
    });

    let logged = 0;
    for (const evt of orphans) {
      const data =
        evt.data && typeof evt.data === 'object' && !Array.isArray(evt.data)
          ? (evt.data as Record<string, unknown>)
          : {};
      const ok = await this.safeLog(input.businessId, input.contactId, evt.type, {
        ...data,
        visitorId: input.visitorId,
        sourceDetail: evt.sourceDetail ?? input.sourceDetail ?? null,
        referralCode: evt.referralCode ?? null,
        backstitched: true,
        originalAt: evt.createdAt.toISOString(),
      });
      if (ok) logged++;
    }
    return { backstitched: orphans.length, logged };
  }

  /**
   * Public helper used by other server modules (intake, store-order,
   * bookings) to log a canonical contact event with a consistent
   * 'storefront' source attribution. Silently no-ops on unknown types so
   * we never crash a public flow on a typo.
   */
  async logStorefrontEvent(input: {
    businessId: string;
    contactId: string;
    type: string;
    sourceDetail?: string | null;
    data?: Record<string, unknown>;
  }) {
    return this.safeLog(input.businessId, input.contactId, input.type, {
      ...(input.data ?? {}),
      sourceDetail: input.sourceDetail ?? null,
    });
  }

  private async safeLog(
    businessId: string,
    contactId: string,
    type: string,
    data: Record<string, unknown>,
  ): Promise<boolean> {
    if (!isCanonicalContactEventType(type)) {
      this.logger.debug?.(`[public-events] skipping non-canonical type=${type}`);
      return false;
    }
    try {
      await this.timeline.logContactEvent({
        businessId,
        contactId,
        type,
        data,
        actorType: 'PUBLIC',
        source: STOREFRONT_SOURCE,
      });
      return true;
    } catch (err) {
      this.logger.warn(
        `[public-events] timeline log failed type=${type} contact=${contactId}: ${(err as Error).message}`,
      );
      return false;
    }
  }
}
