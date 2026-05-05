import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { contactWhereBase } from './crm.helpers';
import { normalizeEmail, normalizePhone } from './crm-duplicate.util';

export type DuplicateRule =
  | 'exact_email'
  | 'normalized_phone'
  | 'name_phone_partial'
  | 'company_email_domain'
  | 'display_name_similarity';

export type DuplicateCandidate = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  status: string | null;
  createdAt: Date;
};

export type DuplicatePair = {
  primaryId: string;
  duplicateId: string;
  rule: DuplicateRule;
  confidence: number;
  reason: string;
  primary: DuplicateCandidate;
  duplicate: DuplicateCandidate;
};

const RULE_LABELS: Record<DuplicateRule, string> = {
  exact_email: 'Same email address',
  normalized_phone: 'Same phone number',
  name_phone_partial: 'Same name with overlapping phone digits',
  company_email_domain: 'Same company and email domain',
  display_name_similarity: 'Very similar display name',
};

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const v0 = new Array(b.length + 1).fill(0).map((_, i) => i);
  const v1 = new Array(b.length + 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= b.length; j++) v0[j] = v1[j];
  }
  return v1[b.length];
}

function nameKey(c: DuplicateCandidate): string | null {
  const fn = (c.firstName ?? '').trim().toLowerCase();
  const ln = (c.lastName ?? '').trim().toLowerCase();
  if (!fn || !ln) return null;
  return `${fn}|${ln}`;
}

function displayKey(c: DuplicateCandidate): string | null {
  const dn = (c.displayName ?? `${c.firstName ?? ''} ${c.lastName ?? ''}`).trim().toLowerCase();
  return dn || null;
}

function emailDomain(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at < 0) return null;
  return email.slice(at + 1).trim().toLowerCase() || null;
}

function preferPrimary(a: DuplicateCandidate, b: DuplicateCandidate): { primary: DuplicateCandidate; duplicate: DuplicateCandidate } {
  // Older record wins as primary so newer entries are merged into the canonical row.
  if (a.createdAt.getTime() <= b.createdAt.getTime()) return { primary: a, duplicate: b };
  return { primary: b, duplicate: a };
}

@Injectable()
export class CrmDuplicateDetectionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findCandidatesScoped(params: { businessId: string; importId?: string; minConfidence?: number; limit?: number; offset?: number }): Promise<{ pairs: DuplicatePair[]; total: number }> {
    const { businessId, importId, minConfidence = 0.5, limit = 50, offset = 0 } = params;

    let scopedIds: Set<string> | null = null;
    if (importId) {
      const importRecords = await this.prisma.client.contactImportContact.findMany({
        where: { importId, contact: { businessId, deletedAt: null } },
        select: { contactId: true },
      });
      scopedIds = new Set(importRecords.map((r) => r.contactId).filter((id): id is string => Boolean(id)));
      if (scopedIds.size === 0) return { pairs: [], total: 0 };
    }

    // Cursor-paginate over the entire (non-deleted) contact set in chunks
    // so the duplicates queue is truly business-wide, not capped at 5k.
    const CHUNK = 2000;
    const select = {
      id: true,
      firstName: true,
      lastName: true,
      displayName: true,
      email: true,
      emailNormalized: true,
      phone: true,
      phoneNormalized: true,
      companyName: true,
      status: true,
      createdAt: true,
    } as const;
    type ContactRow = Prisma.ContactGetPayload<{ select: typeof select }>;
    const contacts: ContactRow[] = [];
    let cursorId: string | undefined;
    // Order by id (stable, indexed) for deterministic cursoring.
    while (true) {
      const batch = await this.prisma.client.contact.findMany({
        where: contactWhereBase(businessId),
        orderBy: { id: 'asc' },
        take: CHUNK,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
        select,
      });
      if (batch.length === 0) break;
      contacts.push(...batch);
      if (batch.length < CHUNK) break;
      cursorId = batch[batch.length - 1].id;
    }

    const candidates: DuplicateCandidate[] = contacts.map((c) => ({
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      displayName: c.displayName,
      email: c.emailNormalized || (c.email ? normalizeEmail(c.email) : null) || c.email,
      phone: c.phoneNormalized || (c.phone ? normalizePhone(c.phone) : null) || c.phone,
      companyName: c.companyName,
      status: c.status,
      createdAt: c.createdAt,
    }));

    const byId = new Map(candidates.map((c) => [c.id, c] as const));
    const pairs = new Map<string, DuplicatePair>();

    const consider = (a: DuplicateCandidate, b: DuplicateCandidate, rule: DuplicateRule, confidence: number) => {
      if (a.id === b.id) return;
      if (scopedIds && !(scopedIds.has(a.id) || scopedIds.has(b.id))) return;
      const key = a.id < b.id ? `${a.id}::${b.id}` : `${b.id}::${a.id}`;
      const existing = pairs.get(key);
      if (existing && existing.confidence >= confidence) return;
      const ordered = preferPrimary(a, b);
      pairs.set(key, {
        primaryId: ordered.primary.id,
        duplicateId: ordered.duplicate.id,
        rule,
        confidence,
        reason: RULE_LABELS[rule],
        primary: ordered.primary,
        duplicate: ordered.duplicate,
      });
    };

    // Rule 1: exact email
    const emailGroups = new Map<string, DuplicateCandidate[]>();
    for (const c of candidates) {
      if (!c.email) continue;
      const key = c.email.toLowerCase();
      const list = emailGroups.get(key) ?? [];
      list.push(c);
      emailGroups.set(key, list);
    }
    for (const list of emailGroups.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) consider(list[i], list[j], 'exact_email', 1.0);
      }
    }

    // Rule 2: normalized phone
    const phoneGroups = new Map<string, DuplicateCandidate[]>();
    for (const c of candidates) {
      if (!c.phone) continue;
      const list = phoneGroups.get(c.phone) ?? [];
      list.push(c);
      phoneGroups.set(c.phone, list);
    }
    for (const list of phoneGroups.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) consider(list[i], list[j], 'normalized_phone', 0.95);
      }
    }

    // Rule 3: fuzzy name match (per-component) + partial phone overlap.
    // Uses Levenshtein on first/last names so e.g. "Cathrine"/"Catherine" match
    // and "Jon"/"John" match, while still requiring overlapping phone digits.
    const named3 = candidates.filter((c) => nameKey(c));
    const nameSim = (x: string, y: string) => {
      if (!x || !y) return 0;
      const longer = Math.max(x.length, y.length);
      if (longer === 0) return 0;
      return 1 - levenshtein(x, y) / longer;
    };
    for (let i = 0; i < named3.length; i++) {
      for (let j = i + 1; j < named3.length; j++) {
        const a = named3[i];
        const b = named3[j];
        const aFn = (a.firstName ?? '').trim().toLowerCase();
        const aLn = (a.lastName ?? '').trim().toLowerCase();
        const bFn = (b.firstName ?? '').trim().toLowerCase();
        const bLn = (b.lastName ?? '').trim().toLowerCase();
        const fnSim = nameSim(aFn, bFn);
        const lnSim = nameSim(aLn, bLn);
        // Require strong last-name match + decent first-name match (handles nicknames/typos).
        if (lnSim < 0.85 || fnSim < 0.7) continue;
        const aDigits = (a.phone ?? '').replace(/\D/g, '');
        const bDigits = (b.phone ?? '').replace(/\D/g, '');
        if (aDigits.length < 7 || bDigits.length < 7) continue;
        if (aDigits.slice(-7) !== bDigits.slice(-7)) continue;
        // Confidence scales with name similarity within [0.75, 0.85].
        const conf = 0.75 + Math.min(0.1, (fnSim + lnSim - 1.55) / 2);
        consider(a, b, 'name_phone_partial', Math.max(0.75, Math.min(0.85, conf)));
      }
    }

    // Rule 4: same company + same email domain
    const companyDomainGroups = new Map<string, DuplicateCandidate[]>();
    for (const c of candidates) {
      const company = (c.companyName ?? '').trim().toLowerCase();
      const domain = emailDomain(c.email);
      if (!company || !domain) continue;
      const key = `${company}|${domain}`;
      const list = companyDomainGroups.get(key) ?? [];
      list.push(c);
      companyDomainGroups.set(key, list);
    }
    for (const list of companyDomainGroups.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          // Only apply when names look similar to avoid grouping all coworkers.
          const aName = displayKey(a) ?? '';
          const bName = displayKey(b) ?? '';
          if (!aName || !bName) continue;
          const dist = levenshtein(aName, bName);
          const longer = Math.max(aName.length, bName.length);
          const similarity = longer === 0 ? 0 : 1 - dist / longer;
          if (similarity >= 0.6) consider(a, b, 'company_email_domain', 0.7);
        }
      }
    }

    // Rule 5: display name similarity (tiebreaker)
    const named = candidates.filter((c) => displayKey(c));
    for (let i = 0; i < named.length; i++) {
      for (let j = i + 1; j < named.length; j++) {
        const a = named[i];
        const b = named[j];
        const an = displayKey(a)!;
        const bn = displayKey(b)!;
        if (Math.abs(an.length - bn.length) > 4) continue;
        const dist = levenshtein(an, bn);
        const longer = Math.max(an.length, bn.length);
        const similarity = longer === 0 ? 0 : 1 - dist / longer;
        if (similarity >= 0.85 && dist <= 2) consider(a, b, 'display_name_similarity', 0.5 + (similarity - 0.85));
      }
    }

    const result = Array.from(pairs.values())
      .filter((p) => p.confidence >= minConfidence && byId.has(p.primaryId) && byId.has(p.duplicateId))
      .sort((a, b) => b.confidence - a.confidence);
    return { pairs: result.slice(offset, offset + limit), total: result.length };
  }

  async preview(params: { businessId: string; primaryId: string; duplicateId: string }) {
    const { businessId, primaryId, duplicateId } = params;
    const [primary, duplicate] = await Promise.all([
      this.prisma.client.contact.findFirst({ where: { id: primaryId, businessId, deletedAt: null } }),
      this.prisma.client.contact.findFirst({ where: { id: duplicateId, businessId, deletedAt: null } }),
    ]);
    if (!primary || !duplicate) {
      return null;
    }

    const fields: Array<{ key: string; label: string; primaryValue: unknown; duplicateValue: unknown; conflict: boolean; recommended: 'primary' | 'duplicate' }>= [];
    const fieldDefs: Array<{ key: keyof typeof primary; label: string }> = [
      { key: 'firstName', label: 'First name' },
      { key: 'lastName', label: 'Last name' },
      { key: 'displayName', label: 'Display name' },
      { key: 'email', label: 'Email' },
      { key: 'secondaryEmail', label: 'Secondary email' },
      { key: 'phone', label: 'Phone' },
      { key: 'secondaryPhone', label: 'Secondary phone' },
      { key: 'whatsappNumber', label: 'WhatsApp' },
      { key: 'preferredChannel', label: 'Preferred channel' },
      { key: 'addressLine1', label: 'Address line 1' },
      { key: 'addressLine2', label: 'Address line 2' },
      { key: 'city', label: 'City' },
      { key: 'state', label: 'State' },
      { key: 'postalCode', label: 'Postal code' },
      { key: 'country', label: 'Country' },
      { key: 'timezone', label: 'Timezone' },
      { key: 'companyName', label: 'Company' },
      { key: 'jobTitle', label: 'Job title' },
      { key: 'department', label: 'Department' },
      { key: 'industry', label: 'Industry' },
      { key: 'segment', label: 'Segment' },
      { key: 'language', label: 'Language' },
      { key: 'notesInternal', label: 'Internal notes' },
    ];

    const primaryRecord = primary as unknown as Record<string, unknown>;
    const duplicateRecord = duplicate as unknown as Record<string, unknown>;
    for (const def of fieldDefs) {
      const a = primaryRecord[String(def.key)] ?? null;
      const b = duplicateRecord[String(def.key)] ?? null;
      const aEmpty = a === null || a === '' || a === undefined;
      const bEmpty = b === null || b === '' || b === undefined;
      if (aEmpty && bEmpty) continue;
      const conflict = !aEmpty && !bEmpty && a !== b;
      const recommended: 'primary' | 'duplicate' = aEmpty ? 'duplicate' : 'primary';
      fields.push({ key: String(def.key), label: def.label, primaryValue: a, duplicateValue: b, conflict, recommended });
    }

    const mergedTags = Array.from(new Set([...(primary.tags ?? []), ...(duplicate.tags ?? [])]));

    // Per-key custom field comparison: union by default, surface conflicts.
    const primaryCustom = (primary.custom && typeof primary.custom === 'object' && !Array.isArray(primary.custom))
      ? (primary.custom as Record<string, unknown>)
      : {};
    const duplicateCustom = (duplicate.custom && typeof duplicate.custom === 'object' && !Array.isArray(duplicate.custom))
      ? (duplicate.custom as Record<string, unknown>)
      : {};
    const customKeys = Array.from(new Set([...Object.keys(primaryCustom), ...Object.keys(duplicateCustom)])).sort();
    const customFields = customKeys.map((k) => {
      const a = primaryCustom[k] ?? null;
      const b = duplicateCustom[k] ?? null;
      const aEmpty = a === null || a === undefined || a === '';
      const bEmpty = b === null || b === undefined || b === '';
      const conflict = !aEmpty && !bEmpty && JSON.stringify(a) !== JSON.stringify(b);
      const recommended: 'primary' | 'duplicate' = aEmpty ? 'duplicate' : 'primary';
      return { key: k, label: k, primaryValue: a, duplicateValue: b, conflict, recommended };
    });
    const mergedCustom: Record<string, unknown> = { ...duplicateCustom, ...primaryCustom };

    const counts = await this.relatedCounts(businessId, duplicateId);

    return {
      primary,
      duplicate,
      fields,
      customFields,
      mergedTags,
      mergedCustom,
      relatedRecords: counts,
    };
  }

  private async relatedCounts(businessId: string, contactId: string) {
    const c = this.prisma.client;
    const [
      events, notes, tasks, quotes, invoices, bookings,
      enrollments, media, playbooks, listMembers,
      momentum, momentumSnapshots, recommendations,
      mappings, journeys, touchpoints, whatsapp, recurring, importRecords,
    ] = await Promise.all([
      c.contactEvent.count({ where: { businessId, contactId } }),
      c.contactNote.count({ where: { businessId, contactId } }),
      c.contactTask.count({ where: { businessId, contactId } }),
      c.quote.count({ where: { businessId, contactId } }),
      c.invoice.count({ where: { businessId, contactId } }),
      c.booking.count({ where: { businessId, contactId } }),
      c.crmSequenceEnrollment.count({ where: { contactId } }),
      c.contactMedia.count({ where: { businessId, contactId } }),
      c.contactPlaybook.count({ where: { businessId, contactId } }),
      c.contactListMember.count({ where: { contactId } }),
      c.contactMomentum.count({ where: { businessId, contactId } }),
      c.contactMomentumSnapshot.count({ where: { businessId, contactId } }),
      c.momentumRecommendation.count({ where: { businessId, contactId } }),
      c.contactExternalMapping.count({ where: { contactId } }),
      c.customerJourney.count({ where: { businessId, contactId } }),
      c.journeyTouchpoint.count({ where: { businessId, contactId } }),
      c.whatsAppContact.count({ where: { businessId, contactId } }),
      c.recurringInvoice.count({ where: { businessId, contactId } }),
      c.contactImportContact.count({ where: { contactId } }),
    ]);
    return {
      events, notes, tasks, quotes, invoices, bookings,
      enrollments, media, playbooks, listMembers,
      momentum, momentumSnapshots, recommendations,
      mappings, journeys, touchpoints, whatsapp, recurring, importRecords,
    };
  }
}
