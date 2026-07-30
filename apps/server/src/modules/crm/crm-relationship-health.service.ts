import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  CONTACT_RELATIONSHIP_HEALTH_VALUES,
  ContactRelationshipHealth,
  DEFAULT_RELATIONSHIP_HEALTH_THRESHOLDS,
  RelationshipHealthThresholds,
  computeRelationshipHealth,
  normalizeRelationshipHealthThresholds,
} from '@keyflow/shared';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmTimelineService } from './crm-timeline.service';
import { CrmStatsService } from './crm-stats.service';
import { contactWhereBase, contactWhereWithId } from './crm.helpers';

const HEALTH_VALUES_SET: ReadonlySet<string> = new Set(CONTACT_RELATIONSHIP_HEALTH_VALUES);

const MS_PER_DAY = 86_400_000;

export interface RecomputeResult {
  scanned: number;
  updated: number;
  skipped: number;
  byHealth: Record<ContactRelationshipHealth | 'NONE', number>;
}

interface ContactCustom {
  relationshipHealthOverride?: {
    manual?: boolean;
    value?: string | null;
    at?: string;
    by?: string | null;
  };
  [k: string]: unknown;
}

/**
 * Auto-warn service that classifies CRM contacts by `relationshipHealth`
 * (HOT → WARM → COLD → DORMANT, plus AT_RISK for active clients) based on
 * days since `lastContactedAt`.
 *
 * Manual overrides set on a contact (via `setManualOverride`) are preserved:
 * the recompute pass skips any contact whose `custom.relationshipHealthOverride.manual`
 * flag is true.
 */
@Injectable()
export class CrmRelationshipHealthService {
  private readonly logger = new Logger(CrmRelationshipHealthService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CrmTimelineService) private readonly timeline: CrmTimelineService,
    @Inject(CrmStatsService) private readonly stats: CrmStatsService,
  ) {}

  private get db() {
    return this.prisma.client as any;
  }

  /** Read effective thresholds for a business. Falls back to defaults. */
  async getThresholdsFor(businessId: string): Promise<RelationshipHealthThresholds> {
    const business = await this.db.business.findUnique({
      where: { id: businessId },
      select: { crmHealthThresholds: true },
    });
    if (!business) throw new NotFoundException('Business not found');
    return normalizeRelationshipHealthThresholds(
      (business.crmHealthThresholds as Partial<RelationshipHealthThresholds> | null) ?? null,
    );
  }

  async setThresholdsFor(
    businessId: string,
    input: Partial<RelationshipHealthThresholds> | null,
  ): Promise<RelationshipHealthThresholds> {
    const value = input ? normalizeRelationshipHealthThresholds(input) : null;
    await this.db.business.update({
      where: { id: businessId },
      data: { crmHealthThresholds: value },
    });
    return value ?? DEFAULT_RELATIONSHIP_HEALTH_THRESHOLDS;
  }

  /** Returns true if the contact has a manual override that the scheduler must respect. */
  static hasManualOverride(custom: unknown): boolean {
    if (!custom || typeof custom !== 'object') return false;
    const c = custom as ContactCustom;
    return c.relationshipHealthOverride?.manual === true;
  }

  /**
   * Mark/clear a manual override on a contact.
   * - When `value` is a valid health value, sets `relationshipHealth` to it and
   *   stamps `custom.relationshipHealthOverride = { manual: true, ... }`.
   * - When `value` is `null`, clears the override flag and recomputes the
   *   contact's auto health immediately.
   */
  async setManualOverride(input: {
    businessId: string;
    contactId: string;
    value: ContactRelationshipHealth | null;
    actorId?: string | null;
  }) {
    const contact = await this.db.contact.findFirst({
      where: contactWhereWithId(input.businessId, input.contactId),
    });
    if (!contact) throw new NotFoundException('Contact not found');

    const customBase: ContactCustom = (contact.custom as ContactCustom | null) ?? {};
    const previousHealth: string | null = contact.relationshipHealth ?? null;

    if (input.value === null) {
      // clear override + recompute auto value
      const { relationshipHealthOverride: _omit, ...rest } = customBase;
      const thresholds = await this.getThresholdsFor(input.businessId);
      const auto = this.healthFor(contact, thresholds);
      const updated = await this.db.contact.update({
        where: { id: input.contactId },
        data: {
          custom: rest as any,
          relationshipHealth: auto,
        },
      });
      if (auto !== previousHealth) {
        await this.logChange(
          input.businessId,
          input.contactId,
          previousHealth,
          auto,
          'override_cleared',
          input.actorId,
        );
      }
      this.stats.invalidateCache(input.businessId);
      return updated;
    }

    if (!HEALTH_VALUES_SET.has(input.value)) {
      throw new NotFoundException('Invalid relationship health value');
    }
    const newCustom: ContactCustom = {
      ...customBase,
      relationshipHealthOverride: {
        manual: true,
        value: input.value,
        at: new Date().toISOString(),
        by: input.actorId ?? null,
      },
    };
    const updated = await this.db.contact.update({
      where: { id: input.contactId },
      data: {
        custom: newCustom as any,
        relationshipHealth: input.value,
      },
    });
    if (input.value !== previousHealth) {
      await this.logChange(
        input.businessId,
        input.contactId,
        previousHealth,
        input.value,
        'manual_override',
        input.actorId,
      );
    }
    this.stats.invalidateCache(input.businessId);
    return updated;
  }

  /** Recompute relationship health for all non-archived contacts in a business. */
  async recomputeForBusiness(
    businessId: string,
    options: { dryRun?: boolean; actorId?: string | null } = {},
  ): Promise<RecomputeResult> {
    const thresholds = await this.getThresholdsFor(businessId);
    const contacts = await this.db.contact.findMany({
      where: contactWhereBase(businessId),
      select: {
        id: true,
        status: true,
        relationshipHealth: true,
        lastContactedAt: true,
        createdAt: true,
        custom: true,
      },
    });

    const result: RecomputeResult = {
      scanned: contacts.length,
      updated: 0,
      skipped: 0,
      byHealth: { HOT: 0, WARM: 0, COLD: 0, DORMANT: 0, AT_RISK: 0, NONE: 0 },
    };

    for (const c of contacts) {
      if (CrmRelationshipHealthService.hasManualOverride(c.custom)) {
        result.skipped += 1;
        continue;
      }
      const next = this.healthFor(c, thresholds);
      if (next) {
        result.byHealth[next] += 1;
      } else {
        result.byHealth.NONE += 1;
      }
      if (next !== c.relationshipHealth) {
        if (!options.dryRun) {
          await this.db.contact.update({
            where: { id: c.id },
            data: { relationshipHealth: next },
          });
          await this.logChange(
            businessId,
            c.id,
            c.relationshipHealth ?? null,
            next,
            'auto',
            options.actorId,
          );
        }
        result.updated += 1;
      }
    }
    if (!options.dryRun && result.updated > 0) {
      this.stats.invalidateCache(businessId);
    }
    this.logger.log(
      `[CRM-Health] business=${businessId} scanned=${result.scanned} updated=${result.updated} skipped=${result.skipped}`,
    );
    return result;
  }

  /** Iterate over every business and recompute. Used by the daily scheduler. */
  async recomputeAll(): Promise<{ businesses: number; totalUpdated: number; totalSkipped: number }> {
    const businesses = await this.db.business.findMany({ select: { id: true } });
    let totalUpdated = 0;
    let totalSkipped = 0;
    for (const b of businesses) {
      try {
        const r = await this.recomputeForBusiness(b.id);
        totalUpdated += r.updated;
        totalSkipped += r.skipped;
      } catch (err: any) {
        this.logger.warn(
          `[CRM-Health] recompute failed for business=${b.id}: ${(err as Error).message}`,
        );
      }
    }
    return { businesses: businesses.length, totalUpdated, totalSkipped };
  }

  /** Lightweight summary used by the dashboard ("AT_RISK" actionable list). */
  async listAtRisk(businessId: string, opts: { limit?: number } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
    const contacts = await this.db.contact.findMany({
      where: {
        ...contactWhereBase(businessId),
        relationshipHealth: { in: ['AT_RISK', 'DORMANT'] as string[] },
      },
      orderBy: [{ lastContactedAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        status: true,
        relationshipHealth: true,
        lastContactedAt: true,
        priority: true,
      },
    });
    const now = Date.now();
    return contacts.map((c: any) => ({
      ...c,
      daysSinceLastContact: c.lastContactedAt
        ? Math.floor((now - new Date(c.lastContactedAt).getTime()) / MS_PER_DAY)
        : null,
    }));
  }

  // -- helpers -----------------------------------------------------------

  private healthFor(
    contact: { status: string | null; lastContactedAt: Date | null; createdAt: Date },
    thresholds: RelationshipHealthThresholds,
  ): ContactRelationshipHealth | null {
    const reference = contact.lastContactedAt ?? contact.createdAt;
    if (!reference) return null;
    const days = Math.floor((Date.now() - new Date(reference).getTime()) / MS_PER_DAY);
    return computeRelationshipHealth(days, contact.status, thresholds);
  }

  private async logChange(
    businessId: string,
    contactId: string,
    from: string | null,
    to: string | null,
    reason: 'auto' | 'manual_override' | 'override_cleared',
    actorId?: string | null,
  ) {
    try {
      await this.timeline.logEvent(
        businessId,
        contactId,
        'relationship_health.changed',
        { from, to, reason },
        {
          actorType: reason === 'auto' ? 'system' : 'USER',
          actorId: actorId ?? undefined,
          source: reason === 'auto' ? 'health_scheduler' : 'crm',
        },
      );
    } catch (err: any) {
      this.logger.warn(
        `[CRM-Health] failed to log change for contact=${contactId}: ${(err as Error).message}`,
      );
    }
  }
}
