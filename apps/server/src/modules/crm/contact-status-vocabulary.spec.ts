/**
 * V1-38-CT-PRIVACY-PURGE-STATUS (CF-49): Contact.status has one vocabulary.
 *
 * The CRM DTOs admit LEAD | PROSPECT | CLIENT | LOST (CONTACT_STATUSES in
 * crm.constants.ts). Writers outside the DTO spoke other dialects: the Shopify
 * adapter wrote 'CUSTOMER' (and overwrote an existing contact's status on every
 * sync), KEY's daily brief read 'CUSTOMER' and 'DORMANT', and the KEY tool
 * registry offered the model 'INACTIVE' for create, update and segment. A
 * status no DTO admits is invisible to every reader that segments on the
 * canonical values, and a status the model is offered but the API refuses is a
 * tool that fails at run time.
 *
 * This spec is the ratchet:
 *   - the packet's writers (Shopify, KEY command, KEY tool registry, the privacy
 *     service) carry no dialect literal in a status position;
 *   - every contact-status parameter the KEY tool registry offers is exactly
 *     CONTACT_STATUSES;
 *   - across apps/server/src, the files that still read a dialect are a fixed
 *     baseline that may shrink but never grow, and no new file joins it;
 *   - V1-38b (review CR-1): the readers that counted 'CUSTOMER' (lead scoring,
 *     the people health score, people-flow relationship health, the maturity
 *     assessment) count a CLIENT, and a legacy 'CUSTOMER' row the same, until
 *     it is repaired.
 *
 * Pure: reads source files, imports constants and drives the readers over
 * in-memory stand-ins for Prisma; no database, no network.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTACT_STATUSES, contactStatusForExternalCustomer, isContactStatus } from './crm.constants';
import { FLOW_TOOLS, getToolByName } from '../ai/flow-tool-registry';
import { LeadScoringScheduler } from './lead-scoring.scheduler';
import { HealthScoreService } from '../intelligence/health-score.service';
import { RelationshipHealthService } from '../people-flow/relationship-health.service';
import { MaturityAssessmentService } from '../analytics/maturity-assessment.service';

const SRC = join(__dirname, '..', '..'); // apps/server/src
const rel = (file: string) => relative(SRC, file).split(sep).join('/');
const read = (relPath: string) => readFileSync(join(SRC, relPath), 'utf8');

/** Status values seen in this codebase that no CRM DTO admits (CF-49). */
const DIALECTS = ['CUSTOMER', 'DORMANT', 'INACTIVE'] as const;

/**
 * A dialect literal in a status position: `status: 'X'`, `status === 'X'`,
 * `status !== 'X'`, `status: { not: 'X' }`, `status: cond ? 'X' : 'Y'`. The key
 * must be exactly `status` (relationshipHealth: 'DORMANT' is a different,
 * legitimate field), and the literal must sit on the same statement.
 */
const DIALECT_IN_STATUS = new RegExp(
  String.raw`\bstatus\b\s*(?::|===|!==|==|!=)[^;\n]*?['"\x60](${DIALECTS.join('|')})['"\x60]`,
  'g',
);

function dialectHits(source: string): string[] {
  return [...source.matchAll(DIALECT_IN_STATUS)].map((m) => m[1]);
}

/** The writers this packet owns. They must be clean. */
const PACKET_WRITERS = [
  'modules/shopify/shopify.service.ts',
  'modules/ai/key-command.service.ts',
  'modules/ai/flow-tool-registry.ts',
  'modules/crm/privacy/contact-privacy.service.ts',
];

/**
 * Files outside this packet's write set that still compare against a dialect,
 * at the V1-38 head. The count per file may only go down; a file not listed
 * here may not acquire one.
 *
 * These are READS of a value no canonical writer produces any more. That is a
 * regression this packet caused, not dead code (review CR-1): before V1-38 the
 * Shopify adapter wrote 'CUSTOMER', so the lead-scoring +5, the health-score
 * dormant-customer count, the relationship-health CUSTOMER signals and the
 * maturity customer count fired for every Shopify buyer. Shopify now writes
 * CLIENT (and maps an existing 'CUSTOMER' to CLIENT on its next sync), so those
 * branches no longer fire for Shopify buyers until the readers accept CLIENT.
 * V1-38b fixed those four readers (STATUS_READERS below) and dropped them from
 * this baseline.
 */
const LEGACY_DIALECT_READERS: Record<string, { hits: number; why: string }> = {
  'modules/ai/key-tool-registry.service.ts': { hits: 1, why: "status: { not: 'DORMANT' } filter (no-op: no contact holds DORMANT)" },
  'modules/ai/flow-orchestrator.service.ts': { hits: 1, why: "an Automation's ACTIVE/INACTIVE, not Contact.status (scanner false positive)" },
};

/**
 * V1-38b (CR-1): the readers that counted only 'CUSTOMER' as a customer. Each
 * now reads CLIENT, the canonical status, and counts a legacy 'CUSTOMER' row
 * (written by the Shopify adapter before V1-38) the same until it is repaired.
 */
const STATUS_READERS = [
  'modules/crm/lead-scoring.scheduler.ts',
  'modules/intelligence/health-score.service.ts',
  'modules/people-flow/relationship-health.service.ts',
  'modules/analytics/maturity-assessment.service.ts',
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sourceFiles(full);
    if (!e.name.endsWith('.ts') || e.name.endsWith('.spec.ts') || e.name.endsWith('.d.ts')) return [];
    return [full];
  });
}

describe('Contact.status vocabulary (CF-49)', () => {
  it('the scanner is not vacuous: it finds each dialect shape and ignores other fields', () => {
    expect(dialectHits("status: 'CUSTOMER',")).toEqual(['CUSTOMER']);
    expect(dialectHits("status: { not: 'DORMANT' },")).toEqual(['DORMANT']);
    expect(dialectHits("status: customer.orders_count > 0 ? 'CUSTOMER' : 'LEAD',")).toEqual(['CUSTOMER']);
    expect(dialectHits("if (contact.status === 'DORMANT') x();")).toEqual(['DORMANT']);
    expect(dialectHits("status: { type: 'string', enum: ['LEAD', 'PROSPECT', 'CLIENT', 'INACTIVE'] },")).toEqual(['INACTIVE']);
    expect(dialectHits("relationshipHealth: 'DORMANT',")).toEqual([]);
    expect(dialectHits("status: 'CLIENT',")).toEqual([]);
  });

  it('CONTACT_STATUSES is exactly what the CRM create and update DTOs admit', () => {
    for (const dto of ['modules/crm/dto/create-contact.dto.ts', 'modules/crm/dto/update-contact.dto.ts']) {
      const m = read(dto).match(/@IsIn\(\[([^\]]*)\]\)\s*(?:@\w+\([^)]*\)\s*)*status\??:/);
      expect(m, `${dto}: no @IsIn on status`).not.toBeNull();
      const admitted = [...m![1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
      expect(admitted, dto).toEqual([...CONTACT_STATUSES]);
    }
  });

  it.each(PACKET_WRITERS)('%s writes and reads no status dialect', (file) => {
    expect(dialectHits(read(file)), `${file}: CUSTOMER/DORMANT/INACTIVE in a status position`).toEqual([]);
  });

  it('every contact-status parameter KEY is offered is exactly CONTACT_STATUSES', () => {
    for (const name of ['crm_create_contact', 'crm_update_contact', 'segment_contacts']) {
      const tool = getToolByName(name);
      expect(tool, `${name} is registered`).toBeTruthy();
      expect(tool!.parameters.properties.status?.enum, `${name}.status.enum`).toEqual([...CONTACT_STATUSES]);
    }
    const list = getToolByName('crm_list_contacts');
    expect(list, 'crm_list_contacts is registered').toBeTruthy();
    const desc = list!.parameters.properties.status?.description ?? '';
    for (const d of DIALECTS) expect(desc, `crm_list_contacts.status describes ${d}`).not.toContain(d);
    for (const s of CONTACT_STATUSES) expect(desc, `crm_list_contacts.status omits ${s}`).toContain(s);
    // No other crm_* contact tool offers a status enum outside the vocabulary.
    for (const tool of FLOW_TOOLS.filter((t) => /contact/.test(t.name))) {
      const e = tool.parameters.properties.status?.enum;
      if (e && !/deal/.test(tool.name)) {
        for (const v of e) expect(CONTACT_STATUSES as readonly string[], `${tool.name}.status offers ${v}`).toContain(v);
      }
    }
  });

  it('the dialect readers outside the packet are a baseline that never grows', () => {
    const grown: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const r = rel(file);
      const hits = dialectHits(readFileSync(file, 'utf8')).length;
      if (hits === 0) continue;
      const allowed = LEGACY_DIALECT_READERS[r]?.hits ?? 0;
      if (hits > allowed) grown.push(`${r}: ${hits} dialect status literal(s), baseline ${allowed}`);
    }
    expect(grown, 'a new Contact.status dialect literal: use CONTACT_STATUSES (crm.constants.ts)').toEqual([]);
    for (const w of PACKET_WRITERS) expect(LEGACY_DIALECT_READERS[w], `${w} may not be baselined`).toBeUndefined();
  });

  it.each(STATUS_READERS)(
    "CR-1 (V1-38b): %s reads CLIENT - no status dialect, out of the baseline, and its only 'CUSTOMER' is the one documented legacy constant",
    (file) => {
      const src = read(file);
      expect(dialectHits(src), `${file}: CUSTOMER/DORMANT/INACTIVE in a status position`).toEqual([]);
      expect(LEGACY_DIALECT_READERS[file], `${file} may not be baselined`).toBeUndefined();
      // Hoisting the dialect out of the status position would pass the scan
      // above, so every 'CUSTOMER' literal in a reader must be the declaration
      // that names it as the legacy spelling of CLIENT.
      const customerLiterals = src.match(/['"`]CUSTOMER['"`]/g) ?? [];
      const legacyDeclarations = src.match(/\bconst LEGACY_CLIENT_STATUS = 'CUSTOMER';/g) ?? [];
      expect(customerLiterals.length, `${file}: a 'CUSTOMER' literal other than const LEGACY_CLIENT_STATUS`).toBe(legacyDeclarations.length);
      expect(legacyDeclarations.length, `${file}: one legacy declaration at most`).toBeLessThanOrEqual(1);
      expect(src, `${file} takes CLIENT from the vocabulary (crm.constants.ts)`).toMatch(/from '\.{1,2}\/(?:crm\/)?crm\.constants'/);
    },
  );

  it('an external store buyer maps into the vocabulary: orders make a CLIENT, none a LEAD', () => {
    expect(contactStatusForExternalCustomer(3)).toBe('CLIENT');
    expect(contactStatusForExternalCustomer(1)).toBe('CLIENT');
    expect(contactStatusForExternalCustomer(0)).toBe('LEAD');
    expect(contactStatusForExternalCustomer(undefined)).toBe('LEAD');
    for (const n of [0, 1, 5, undefined, null]) expect(isContactStatus(contactStatusForExternalCustomer(n as number))).toBe(true);
    for (const d of DIALECTS) expect(isContactStatus(d)).toBe(false);
    for (const s of CONTACT_STATUSES) expect(isContactStatus(s)).toBe(true);
  });
});

/**
 * A Prisma `where` evaluated in memory: only the operators the readers below
 * use. An operator it does not know throws, so a reader that changes its query
 * shape fails here instead of matching by accident.
 */
function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Array<Record<string, unknown>>).some((w) => matchesWhere(row, w));
    const value = row[key] as any;
    if (cond === null || typeof cond !== 'object' || cond instanceof Date) return value === cond;
    return Object.entries(cond as Record<string, any>).every(([op, x]) => {
      switch (op) {
        case 'in': return (x as unknown[]).includes(value);
        case 'not': return value !== x;
        case 'lt': return value != null && value < x;
        default: throw new Error(`in-memory where: unsupported operator ${key}.${op}`);
      }
    });
  });
}

describe("V1-38b (CR-1): the status readers count a CLIENT as a customer, and a legacy 'CUSTOMER' row the same until it is repaired", () => {
  const DAY = 86_400_000;
  const ago = (days: number) => new Date(Date.now() - days * DAY);

  it('lead scoring: a CLIENT earns the +5 customer bonus over a PROSPECT; a legacy CUSTOMER scores as a CLIENT; LOST keeps its -10', async () => {
    const statuses = ['PROSPECT', 'CLIENT', 'CUSTOMER', 'LOST'];
    const scores = new Map<string, number>();
    const db = {
      business: { findMany: async () => [{ id: 'biz' }] },
      contact: {
        // Identical inputs but the status, so the status term is the only difference.
        findMany: async () =>
          statuses.map((status) => ({ id: status, relationshipHealth: null, lastInteractionAt: null, lastContactedAt: null, status })),
        update: async ({ where, data }: { where: { id: string }; data: { leadScore: number } }) => {
          scores.set(where.id, data.leadScore);
        },
      },
      deal: { groupBy: async () => [] },
      invoice: { groupBy: async () => [] },
      contactEvent: { groupBy: async () => [] },
    };
    const scheduler = new LeadScoringScheduler({ client: db } as any);
    expect(await scheduler.tick(new Date('2026-11-09T23:00:00Z'))).toEqual({ ran: true, updated: 4 });
    expect(scores.get('CLIENT'), 'CLIENT vs PROSPECT').toBe(scores.get('PROSPECT')! + 5);
    expect(scores.get('CUSTOMER'), 'legacy CUSTOMER vs CLIENT').toBe(scores.get('CLIENT'));
    expect(scores.get('LOST'), 'LOST vs PROSPECT').toBe(scores.get('PROSPECT')! - 10);
  });

  it('people health score: a CLIENT untouched for 60+ days is a dormant customer; a legacy CUSTOMER row counts the same; fresh, other-status, deleted and other-tenant rows do not', async () => {
    const row = (id: string, status: string, updatedDaysAgo: number, extra: Record<string, unknown> = {}) => ({
      id, businessId: 'biz', deletedAt: null, status, updatedAt: ago(updatedDaysAgo), email: `${id}@example.test`, phone: '+18685550100', ...extra,
    });
    const contacts = [
      row('client-stale', 'CLIENT', 90),
      row('legacy-stale', 'CUSTOMER', 90),
      row('client-fresh', 'CLIENT', 5),
      row('prospect-stale', 'PROSPECT', 90),
      row('client-deleted', 'CLIENT', 90, { deletedAt: ago(1) }),
      row('client-other-tenant', 'CLIENT', 90, { businessId: 'other' }),
    ];
    const count = async ({ where }: { where: Record<string, unknown> }) => contacts.filter((c) => matchesWhere(c, where)).length;
    const health: any = new HealthScoreService({ client: { contact: { count } } } as any);
    const people = await health.calculatePeopleHealth('biz');
    expect(people.metrics.dormantCustomers).toBe(2);
    expect(people.reasons).toContain('2 dormant customers');
    expect(people.metrics.totalContacts).toBe(4);
  });

  it('people-flow segments: a recently active CLIENT is a High-Value Customer and a legacy CUSTOMER the same; a PROSPECT is not', async () => {
    const contact = (id: string, status: string, daysSilent: number) => ({
      id, firstName: id, lastName: null, email: null, status, lastInteractionAt: ago(daysSilent), leadScore: 60,
    });
    const contacts = [contact('client', 'CLIENT', 3), contact('legacy', 'CUSTOMER', 3), contact('prospect', 'PROSPECT', 3)];
    const svc = new RelationshipHealthService({ client: { contact: { findMany: async () => contacts } } } as any);
    const highValue = (await svc.listSegments('biz')).find((s) => s.id === 'high-value');
    expect(highValue?.contacts.map((c) => c.id).sort()).toEqual(['client', 'legacy']);
    expect(highValue?.criteria).toContain('CLIENT');
    expect(highValue?.criteria).not.toContain('CUSTOMER');
  });

  it('people-flow segments: dormancy is not a Contact.status (CF-49), so silence alone places a canonical contact in At Risk and Dormant, as before', async () => {
    const contact = (id: string, status: string, daysSilent: number) => ({
      id, firstName: id, lastName: null, email: null, status, lastInteractionAt: ago(daysSilent), leadScore: 40,
    });
    const contacts = [contact('client-silent', 'CLIENT', 100), contact('lead-quiet', 'LEAD', 20)];
    const svc = new RelationshipHealthService({ client: { contact: { findMany: async () => contacts } } } as any);
    const segments = await svc.listSegments('biz');
    const ids = (id: string) => segments.find((s) => s.id === id)?.contacts.map((c) => c.id) ?? [];
    expect(ids('stale-leads')).toEqual(['lead-quiet']);
    expect(ids('at-risk')).toEqual(['client-silent']);
    expect(ids('dormant')).toEqual(['client-silent']);
    expect(segments.find((s) => s.id === 'dormant')?.criteria, 'the criteria names no status the CRM cannot hold').not.toMatch(/DORMANT/);
  });

  it('relationship health signals: a CLIENT with no bookings in 90 days is flagged, a legacy CUSTOMER the same, a PROSPECT is not', async () => {
    // The stand-in row carries businessId. The real findUnique selects none, so
    // computeHealth answers null for every contact today (characterized in
    // test/contact-reads-noncrm-visibility.integration.test.ts; not this packet).
    const signalsFor = async (status: string) => {
      const prisma = {
        client: {
          contact: {
            findUnique: async () => ({
              id: 'c1', businessId: 'biz', firstName: 'Ada', lastName: null, email: null, status, lastInteractionAt: ago(3), createdAt: ago(400),
            }),
          },
          invoice: { findMany: async () => [] },
          booking: { findMany: async () => [] },
          contactTask: { findMany: async () => [] },
          contactNote: { findMany: async () => [] },
          deal: { findMany: async () => [] },
        },
      };
      const health = await new RelationshipHealthService(prisma as any).computeHealth('biz', 'c1');
      expect(health, `computeHealth(${status})`).not.toBeNull();
      return health!.signals;
    };
    expect(await signalsFor('CLIENT')).toContain('No bookings in 90 days');
    expect(await signalsFor('CUSTOMER')).toContain('No bookings in 90 days');
    expect(await signalsFor('PROSPECT')).not.toContain('No bookings in 90 days');
  });

  it('maturity assessment: CLIENT contacts are the customers of the Customer dimension; legacy CUSTOMER rows count the same', async () => {
    const customerMaturity = async (statuses: string[]) => {
      const business = {
        invoices: [], bookings: [], products: [], services: [],
        members: [{ id: 'm1', role: 'OWNER' }],
        channelConnections: [],
        contacts: statuses.map((status) => ({ status, createdAt: ago(10) })),
        _count: { invoices: 0, contacts: statuses.length, bookings: 0, products: 0, services: 0 },
      };
      const prisma = {
        client: {
          business: { findUnique: async () => business },
          maturityScore: { findMany: async () => [], create: async ({ data }: { data: Record<string, unknown> }) => data },
        },
      };
      const { assessment } = await new MaturityAssessmentService(prisma as any).assessBusiness('biz');
      return (assessment as any).customerMaturity as number;
    };
    const eleven = (status: string) => Array.from({ length: 11 }, () => status);
    // 11 contacts score 10 on their own; more than 10 customers add 10.
    expect(await customerMaturity(eleven('PROSPECT'))).toBe(10);
    expect(await customerMaturity(eleven('CLIENT'))).toBe(20);
    expect(await customerMaturity([...Array.from({ length: 6 }, () => 'CLIENT'), ...Array.from({ length: 5 }, () => 'CUSTOMER')])).toBe(20);
  });
});
