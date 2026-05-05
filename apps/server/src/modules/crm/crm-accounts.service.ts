import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';

export type AccountListFilters = {
  businessId: string;
  search?: string;
  industry?: string;
  ownerUserId?: string;
  tags?: string[];
  minDealValue?: number;
  lastActivityWithinDays?: number;
  skip?: number;
  take?: number;
};

export interface AccountSummary {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size: string | null;
  website: string | null;
  ownerUserId: string | null;
  primaryContactId: string | null;
  tags: string[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  // rollup counters (best-effort, populated by listAccounts)
  contactCount: number;
  dealCount: number;
  openDealValue: number;
  lifetimeRevenue: number;
  currency: string;
  lastActivityAt: string | null;
  nextActionAt: string | null;
}

export interface AccountInsight {
  /** Schema version for the payload shape. */
  version: number;
  computedAt: string;
  /** Human-readable rollup summary suitable for an "Account Insight" card. */
  summary: string;
  lifetimeRevenue: number;
  currency: string;
  dealCount: number;
  openDealValue: number;
  winRate: number;
  contactCount: number;
  primaryContactId: string | null;
  /** ISO of most recent communication / event across all contacts in the account. */
  lastActivityAt: string | null;
  /** Number of contact events in the last 30 days. */
  recentInteractionCount30d: number;
  /** Single suggested next action with the soonest dueDate across contacts. */
  nextAction: { contactId: string; type: string | null; dueAt: string | null; title: string | null } | null;
  tags: string[];
}

const ACCOUNT_INSIGHT_VERSION = 1;

function normalizeDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  let s = value.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '');
  s = s.split('/')[0]!.split('?')[0]!.trim();
  return s || null;
}

function domainFromEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  if (at < 0) return null;
  return normalizeDomain(email.slice(at + 1));
}

@Injectable()
export class CrmAccountsService {
  private readonly logger = new Logger(CrmAccountsService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  async createAccount(input: {
    businessId: string;
    name: string;
    domain?: string | null;
    industry?: string | null;
    size?: string | null;
    website?: string | null;
    primaryContactId?: string | null;
    ownerUserId?: string | null;
    tags?: string[];
    notes?: string | null;
  }) {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('name is required');

    const domain = normalizeDomain(input.domain ?? input.website ?? null);
    if (domain) {
      const existing = await this.db.account.findFirst({
        where: { businessId: input.businessId, domain, deletedAt: null },
      });
      if (existing) {
        throw new BadRequestException(`An account already exists for domain ${domain}`);
      }
    }

    return this.db.account.create({
      data: {
        businessId: input.businessId,
        name,
        domain,
        industry: input.industry ?? null,
        size: input.size ?? null,
        website: input.website ?? null,
        primaryContactId: input.primaryContactId ?? null,
        ownerUserId: input.ownerUserId ?? null,
        tags: input.tags ?? [],
        notes: input.notes ?? null,
      },
    });
  }

  async updateAccount(input: {
    businessId: string;
    accountId: string;
    name?: string;
    domain?: string | null;
    industry?: string | null;
    size?: string | null;
    website?: string | null;
    primaryContactId?: string | null;
    ownerUserId?: string | null;
    tags?: string[];
    notes?: string | null;
  }) {
    const account = await this.db.account.findFirst({
      where: { id: input.accountId, businessId: input.businessId, deletedAt: null },
    });
    if (!account) throw new NotFoundException('Account not found');

    const data: Prisma.AccountUpdateInput = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException('name cannot be empty');
      data.name = name;
    }
    if (input.domain !== undefined) data.domain = normalizeDomain(input.domain);
    if (input.industry !== undefined) data.industry = input.industry;
    if (input.size !== undefined) data.size = input.size;
    if (input.website !== undefined) data.website = input.website;
    if (input.primaryContactId !== undefined) data.primaryContactId = input.primaryContactId;
    if (input.ownerUserId !== undefined) data.ownerUserId = input.ownerUserId;
    if (input.tags !== undefined) data.tags = input.tags;
    if (input.notes !== undefined) data.notes = input.notes;

    return this.db.account.update({ where: { id: account.id }, data });
  }

  async deleteAccount(input: { businessId: string; accountId: string }) {
    const account = await this.db.account.findFirst({
      where: { id: input.accountId, businessId: input.businessId, deletedAt: null },
    });
    if (!account) throw new NotFoundException('Account not found');
    await this.db.account.update({
      where: { id: account.id },
      data: { deletedAt: new Date() },
    });
    // Detach contacts and deals; companyName fallback is preserved on each row.
    await this.db.contact.updateMany({
      where: { businessId: input.businessId, accountId: account.id },
      data: { accountId: null },
    });
    await this.db.deal.updateMany({
      where: { businessId: input.businessId, accountId: account.id },
      data: { accountId: null },
    });
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // List with rollup counters
  // ---------------------------------------------------------------------------

  async listAccounts(filters: AccountListFilters): Promise<{ accounts: AccountSummary[]; total: number }> {
    const where: Prisma.AccountWhereInput = {
      businessId: filters.businessId,
      deletedAt: null,
    };
    if (filters.industry) where.industry = filters.industry;
    if (filters.ownerUserId) where.ownerUserId = filters.ownerUserId;
    if (filters.tags && filters.tags.length > 0) where.tags = { hasSome: filters.tags };
    if (filters.search) {
      const s = filters.search.trim();
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { domain: { contains: s, mode: 'insensitive' } },
        { website: { contains: s, mode: 'insensitive' } },
      ];
    }

    const take = Math.min(filters.take ?? 50, 200);
    const skip = filters.skip ?? 0;

    const [items, total] = await Promise.all([
      this.db.account.findMany({ where, orderBy: [{ name: 'asc' }], skip, take }),
      this.db.account.count({ where }),
    ]);

    if (items.length === 0) return { accounts: [], total };

    const ids = items.map((a) => a.id);

    const [contactCounts, deals, latestEvents, nextActions] = await Promise.all([
      this.db.contact.groupBy({
        by: ['accountId'],
        where: { businessId: filters.businessId, accountId: { in: ids }, deletedAt: null },
        _count: { _all: true },
      }),
      this.db.deal.findMany({
        where: { businessId: filters.businessId, accountId: { in: ids }, deletedAt: null },
        select: { accountId: true, status: true, value: true, currency: true },
      }),
      this.db.contactEvent.findMany({
        where: {
          businessId: filters.businessId,
          contact: { accountId: { in: ids }, deletedAt: null },
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, contact: { select: { accountId: true } } },
        take: 1000,
      }),
      this.db.contact.findMany({
        where: {
          businessId: filters.businessId,
          accountId: { in: ids },
          deletedAt: null,
          nextActionAt: { not: null },
        },
        orderBy: [{ nextActionAt: 'asc' }],
        select: { accountId: true, nextActionAt: true },
        take: 1000,
      }),
    ]);

    const contactCountByAccount = new Map<string, number>();
    for (const row of contactCounts) {
      if (row.accountId) contactCountByAccount.set(row.accountId, row._count._all);
    }

    const dealAgg = new Map<string, { count: number; openValue: number; lifetimeRevenue: number; currency: string }>();
    for (const d of deals) {
      if (!d.accountId) continue;
      const cur = dealAgg.get(d.accountId) ?? { count: 0, openValue: 0, lifetimeRevenue: 0, currency: d.currency };
      cur.count += 1;
      if (d.status === 'OPEN') cur.openValue += Number(d.value ?? 0);
      if (d.status === 'WON') cur.lifetimeRevenue += Number(d.value ?? 0);
      cur.currency = d.currency;
      dealAgg.set(d.accountId, cur);
    }

    const lastActivity = new Map<string, Date>();
    for (const e of latestEvents) {
      const accId = e.contact.accountId;
      if (!accId) continue;
      const prev = lastActivity.get(accId);
      if (!prev || prev < e.createdAt) lastActivity.set(accId, e.createdAt);
    }

    const nextActionByAccount = new Map<string, Date>();
    for (const c of nextActions) {
      const accId = c.accountId;
      if (!accId || !c.nextActionAt) continue;
      const prev = nextActionByAccount.get(accId);
      if (!prev || prev > c.nextActionAt) nextActionByAccount.set(accId, c.nextActionAt);
    }

    let summaries: AccountSummary[] = items.map((a) => {
      const dealStats = dealAgg.get(a.id);
      return {
        id: a.id,
        name: a.name,
        domain: a.domain,
        industry: a.industry,
        size: a.size,
        website: a.website,
        ownerUserId: a.ownerUserId,
        primaryContactId: a.primaryContactId,
        tags: a.tags,
        notes: a.notes,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
        contactCount: contactCountByAccount.get(a.id) ?? 0,
        dealCount: dealStats?.count ?? 0,
        openDealValue: dealStats?.openValue ?? 0,
        lifetimeRevenue: dealStats?.lifetimeRevenue ?? 0,
        currency: dealStats?.currency ?? 'TTD',
        lastActivityAt: lastActivity.get(a.id)?.toISOString() ?? null,
        nextActionAt: nextActionByAccount.get(a.id)?.toISOString() ?? null,
      };
    });

    if (filters.minDealValue != null) {
      summaries = summaries.filter((s) => s.openDealValue + s.lifetimeRevenue >= filters.minDealValue!);
    }
    if (filters.lastActivityWithinDays != null) {
      const cutoff = Date.now() - filters.lastActivityWithinDays * 86_400_000;
      summaries = summaries.filter((s) => s.lastActivityAt != null && new Date(s.lastActivityAt).getTime() >= cutoff);
    }

    return { accounts: summaries, total };
  }

  // ---------------------------------------------------------------------------
  // Detail rollup
  // ---------------------------------------------------------------------------

  async getAccountDetail(input: { businessId: string; accountId: string }) {
    const account = await this.db.account.findFirst({
      where: { id: input.accountId, businessId: input.businessId, deletedAt: null },
    });
    if (!account) throw new NotFoundException('Account not found');

    const [contacts, deals, recentEvents] = await Promise.all([
      this.db.contact.findMany({
        where: { businessId: input.businessId, accountId: account.id, deletedAt: null },
        orderBy: [{ lastInteractionAt: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true, firstName: true, lastName: true, displayName: true,
          email: true, phone: true, jobTitle: true, lifecycleStage: true,
          relationshipHealth: true, ownerId: true, lastInteractionAt: true,
          nextActionAt: true, nextActionType: true, leadScore: true,
        },
      }),
      this.db.deal.findMany({
        where: { businessId: input.businessId, accountId: account.id, deletedAt: null },
        orderBy: [{ updatedAt: 'desc' }],
        include: { stage: true, contact: { select: { id: true, firstName: true, lastName: true, displayName: true } } },
      }),
      this.db.contactEvent.findMany({
        where: { businessId: input.businessId, contact: { accountId: account.id, deletedAt: null } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true, createdAt: true, type: true, data: true, source: true,
          contact: { select: { id: true, firstName: true, lastName: true, displayName: true } },
        },
      }),
    ]);

    const wonDeals = deals.filter((d) => d.status === 'WON');
    const lostDeals = deals.filter((d) => d.status === 'LOST');
    const openDeals = deals.filter((d) => d.status === 'OPEN');
    const closed = wonDeals.length + lostDeals.length;
    const winRate = closed > 0 ? Math.round((wonDeals.length / closed) * 100) : 0;
    const lifetimeRevenue = wonDeals.reduce((sum, d) => sum + Number(d.value ?? 0), 0);
    const openDealValue = openDeals.reduce((sum, d) => sum + Number(d.value ?? 0), 0);
    const currency = deals[0]?.currency ?? 'TTD';

    // Communication frequency: events per month over last 90 days.
    const sinceMs = Date.now() - 90 * 86_400_000;
    const recent90 = recentEvents.filter((e) => e.createdAt.getTime() >= sinceMs);
    const monthsSpan = 3;
    const eventsPerMonth = recent90.length / monthsSpan;

    const lastActivityAt = recentEvents[0]?.createdAt ?? null;

    // Account-level next-action: pick the soonest non-null nextActionAt across contacts.
    const nextActionContact = contacts
      .filter((c) => c.nextActionAt)
      .sort((a, b) => (a.nextActionAt!.getTime() - b.nextActionAt!.getTime()))[0];
    const nextAction = nextActionContact
      ? {
          contactId: nextActionContact.id,
          dueAt: nextActionContact.nextActionAt!.toISOString(),
          type: nextActionContact.nextActionType ?? null,
          contactName:
            nextActionContact.displayName ||
            [nextActionContact.firstName, nextActionContact.lastName].filter(Boolean).join(' ') ||
            null,
        }
      : null;

    return {
      account: {
        ...account,
        createdAt: account.createdAt.toISOString(),
        updatedAt: account.updatedAt.toISOString(),
      },
      contacts,
      deals,
      recentEvents,
      rollup: {
        contactCount: contacts.length,
        dealCount: deals.length,
        openDealCount: openDeals.length,
        wonDealCount: wonDeals.length,
        lostDealCount: lostDeals.length,
        openDealValue,
        lifetimeRevenue,
        currency,
        winRate,
        eventsPerMonth: Math.round(eventsPerMonth * 10) / 10,
        lastActivityAt: lastActivityAt?.toISOString() ?? null,
        nextAction,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Account Insight (reuses InsightSnapshot-style payload shape)
  // ---------------------------------------------------------------------------

  async getAccountInsight(businessId: string, accountId: string): Promise<AccountInsight> {
    const detail = await this.getAccountDetail({ businessId, accountId });
    const { account, contacts, deals, rollup } = detail;

    const recentInteractionCount30d = await this.db.contactEvent.count({
      where: {
        businessId,
        contact: { accountId, deletedAt: null },
        createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) },
      },
    });

    const tags: string[] = [];
    if (rollup.lifetimeRevenue >= 10_000) tags.push('high-value');
    if (rollup.openDealValue > 0) tags.push(`${rollup.openDealCount} open ${rollup.openDealCount === 1 ? 'deal' : 'deals'}`);
    if (rollup.winRate >= 60) tags.push('reliable-buyer');
    if (recentInteractionCount30d === 0 && rollup.dealCount > 0) tags.push('cooling-off');

    const summaryParts: string[] = [];
    summaryParts.push(`${account.name} has ${rollup.contactCount} contact${rollup.contactCount === 1 ? '' : 's'} and ${rollup.dealCount} deal${rollup.dealCount === 1 ? '' : 's'} on file.`);
    if (rollup.lifetimeRevenue > 0) {
      summaryParts.push(`Lifetime revenue is ${rollup.currency} ${rollup.lifetimeRevenue.toFixed(0)} (win rate ${rollup.winRate}%).`);
    } else if (rollup.openDealValue > 0) {
      summaryParts.push(`No closed-won revenue yet but ${rollup.currency} ${rollup.openDealValue.toFixed(0)} sits in the open pipeline.`);
    }
    if (recentInteractionCount30d > 0) {
      summaryParts.push(`${recentInteractionCount30d} interaction${recentInteractionCount30d === 1 ? '' : 's'} in the last 30 days.`);
    } else {
      summaryParts.push('No interactions logged in the last 30 days.');
    }

    const primary = contacts.find((c) => c.id === account.primaryContactId) ?? contacts[0] ?? null;

    return {
      version: ACCOUNT_INSIGHT_VERSION,
      computedAt: new Date().toISOString(),
      summary: summaryParts.join(' '),
      lifetimeRevenue: rollup.lifetimeRevenue,
      currency: rollup.currency,
      dealCount: rollup.dealCount,
      openDealValue: rollup.openDealValue,
      winRate: rollup.winRate,
      contactCount: rollup.contactCount,
      primaryContactId: primary?.id ?? null,
      lastActivityAt: rollup.lastActivityAt,
      recentInteractionCount30d,
      nextAction: rollup.nextAction
        ? {
            contactId: rollup.nextAction.contactId,
            type: rollup.nextAction.type,
            dueAt: rollup.nextAction.dueAt,
            title: rollup.nextAction.contactName,
          }
        : null,
      tags,
    };
  }

  // ---------------------------------------------------------------------------
  // Suggest account for a given contact (used when creating a deal).
  // ---------------------------------------------------------------------------

  async suggestForContact(businessId: string, contactId: string) {
    const contact = await this.db.contact.findFirst({
      where: { id: contactId, businessId, deletedAt: null },
      select: { accountId: true, companyName: true, email: true },
    });
    if (!contact) throw new NotFoundException('Contact not found');

    if (contact.accountId) {
      const account = await this.db.account.findFirst({
        where: { id: contact.accountId, businessId, deletedAt: null },
      });
      if (account) return { account, reason: 'linked' as const };
    }

    const domain = domainFromEmail(contact.email);
    if (domain) {
      const byDomain = await this.db.account.findFirst({
        where: { businessId, domain, deletedAt: null },
      });
      if (byDomain) return { account: byDomain, reason: 'email_domain' as const };
    }

    if (contact.companyName) {
      const byName = await this.db.account.findFirst({
        where: {
          businessId,
          deletedAt: null,
          name: { equals: contact.companyName, mode: 'insensitive' },
        },
      });
      if (byName) return { account: byName, reason: 'company_name' as const };
    }

    return { account: null, reason: 'none' as const };
  }

  // ---------------------------------------------------------------------------
  // Merge job: enumerate distinct companyName values and propose Accounts.
  // ---------------------------------------------------------------------------

  async previewMerge(businessId: string) {
    const rows = await this.db.contact.groupBy({
      by: ['companyName'],
      where: {
        businessId,
        deletedAt: null,
        accountId: null,
        companyName: { not: null },
      },
      _count: { _all: true },
    });

    const proposals: Array<{
      companyName: string;
      contactCount: number;
      existingAccountId: string | null;
      suggestedDomain: string | null;
    }> = [];

    for (const row of rows) {
      const name = (row.companyName ?? '').trim();
      if (!name) continue;

      const existing = await this.db.account.findFirst({
        where: {
          businessId,
          deletedAt: null,
          name: { equals: name, mode: 'insensitive' },
        },
        select: { id: true },
      });

      // Try to derive a domain from contacts' emails.
      const sampleContact = await this.db.contact.findFirst({
        where: { businessId, deletedAt: null, companyName: name, accountId: null, email: { not: null } },
        select: { email: true },
      });
      const suggestedDomain = domainFromEmail(sampleContact?.email);

      proposals.push({
        companyName: name,
        contactCount: row._count._all,
        existingAccountId: existing?.id ?? null,
        suggestedDomain,
      });
    }

    return { proposals: proposals.sort((a, b) => b.contactCount - a.contactCount) };
  }

  /**
   * Apply the merge: for each provided companyName, create an Account (or use
   * the supplied existingAccountId) and link all matching contacts and their
   * deals to it. Idempotent — contacts already linked are left alone.
   */
  async applyMerge(input: {
    businessId: string;
    items: Array<{ companyName: string; useExistingAccountId?: string | null; createWithDomain?: string | null }>;
  }) {
    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new BadRequestException('No merge items provided');
    }

    const results: Array<{
      companyName: string;
      accountId: string;
      contactsLinked: number;
      dealsLinked: number;
      created: boolean;
    }> = [];

    for (const item of input.items) {
      const name = item.companyName?.trim();
      if (!name) continue;

      let accountId = item.useExistingAccountId ?? null;
      let created = false;

      if (!accountId) {
        // Try existing first (case-insensitive).
        const existing = await this.db.account.findFirst({
          where: { businessId: input.businessId, deletedAt: null, name: { equals: name, mode: 'insensitive' } },
        });
        if (existing) {
          accountId = existing.id;
        } else {
          const domain = normalizeDomain(item.createWithDomain ?? null);
          // Honour the unique (businessId, domain) constraint by reusing if needed.
          if (domain) {
            const byDomain = await this.db.account.findFirst({
              where: { businessId: input.businessId, deletedAt: null, domain },
            });
            if (byDomain) {
              accountId = byDomain.id;
            }
          }
          if (!accountId) {
            const created_ = await this.db.account.create({
              data: {
                businessId: input.businessId,
                name,
                domain,
              },
            });
            accountId = created_.id;
            created = true;
          }
        }
      }

      if (!accountId) continue;

      const contactsLinked = await this.db.contact.updateMany({
        where: {
          businessId: input.businessId,
          deletedAt: null,
          accountId: null,
          companyName: { equals: name, mode: 'insensitive' },
        },
        data: { accountId },
      });

      // Link deals where the underlying contact is now part of this account.
      const dealsLinked = await this.db.deal.updateMany({
        where: {
          businessId: input.businessId,
          deletedAt: null,
          accountId: null,
          contact: { accountId },
        },
        data: { accountId },
      });

      results.push({
        companyName: name,
        accountId,
        contactsLinked: contactsLinked.count,
        dealsLinked: dealsLinked.count,
        created,
      });
    }

    return { results };
  }

  // ---------------------------------------------------------------------------
  // Pivots used by the dashboard / lifecycle reports.
  // ---------------------------------------------------------------------------

  /**
   * Group deals by account for the "Account" pivot on the deals dashboard.
   * Returns one row per account with rollup counters; deals without an account
   * are grouped under a synthetic "Unassigned" bucket using companyName fallback.
   */
  async dealsByAccount(businessId: string) {
    const deals = await this.db.deal.findMany({
      where: { businessId, deletedAt: null },
      select: { accountId: true, status: true, value: true, currency: true, companyName: true },
    });

    type Bucket = {
      accountId: string | null;
      label: string;
      count: number;
      openValue: number;
      wonValue: number;
      currency: string;
    };
    const buckets = new Map<string, Bucket>();
    const accountIds = new Set<string>();
    for (const d of deals) {
      const key = d.accountId ?? `unassigned:${(d.companyName ?? '').toLowerCase().trim()}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          accountId: d.accountId,
          label: d.companyName ?? 'Unassigned',
          count: 0,
          openValue: 0,
          wonValue: 0,
          currency: d.currency,
        };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      if (d.status === 'OPEN') bucket.openValue += Number(d.value ?? 0);
      if (d.status === 'WON') bucket.wonValue += Number(d.value ?? 0);
      bucket.currency = d.currency;
      if (d.accountId) accountIds.add(d.accountId);
    }

    if (accountIds.size > 0) {
      const accounts = await this.db.account.findMany({
        where: { businessId, id: { in: [...accountIds] } },
        select: { id: true, name: true },
      });
      const nameById = new Map(accounts.map((a) => [a.id, a.name]));
      for (const bucket of buckets.values()) {
        if (bucket.accountId) bucket.label = nameById.get(bucket.accountId) ?? bucket.label;
      }
    }

    return {
      buckets: [...buckets.values()].sort((a, b) => b.openValue + b.wonValue - (a.openValue + a.wonValue)),
    };
  }

  /**
   * Lifecycle pivot: counts how contacts in each lifecycleStage roll up per
   * account. Returns one row per account with stage counts plus an "Unassigned"
   * bucket. Used by the m4 lifecycle report's "Account" pivot toggle.
   */
  async lifecycleByAccount(businessId: string) {
    const contacts = await this.db.contact.findMany({
      where: { businessId, deletedAt: null },
      select: { accountId: true, lifecycleStage: true, companyName: true },
    });

    type Row = {
      accountId: string | null;
      label: string;
      total: number;
      stages: Record<string, number>;
    };
    const map = new Map<string, Row>();
    const accountIds = new Set<string>();
    for (const c of contacts) {
      const key = c.accountId ?? `unassigned:${(c.companyName ?? '').toLowerCase().trim()}`;
      let row = map.get(key);
      if (!row) {
        row = {
          accountId: c.accountId,
          label: c.companyName ?? 'Unassigned',
          total: 0,
          stages: {},
        };
        map.set(key, row);
      }
      const stage = c.lifecycleStage ?? 'unknown';
      row.stages[stage] = (row.stages[stage] ?? 0) + 1;
      row.total += 1;
      if (c.accountId) accountIds.add(c.accountId);
    }

    if (accountIds.size > 0) {
      const accounts = await this.db.account.findMany({
        where: { businessId, id: { in: [...accountIds] } },
        select: { id: true, name: true },
      });
      const nameById = new Map(accounts.map((a) => [a.id, a.name]));
      for (const row of map.values()) {
        if (row.accountId) row.label = nameById.get(row.accountId) ?? row.label;
      }
    }

    return { rows: [...map.values()].sort((a, b) => b.total - a.total) };
  }
}
