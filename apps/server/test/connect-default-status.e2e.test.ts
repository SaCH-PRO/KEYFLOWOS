/**
 * W5-D92-RESIDUALS (owner ruling D-92): the connector contact rules and the
 * connector form mapping store only a ContactStatus.
 *
 * D-92: every stored Contact.status is one of LEAD, PROSPECT, CLIENT, LOST, and
 * "dormant" is always worked out from inactivity. W4-D92-DORMANT-AS-CLIENT left
 * three writers outside the CRM DTOs that stored an operator's configured
 * defaultStatus exactly as given (residual recorded in crm.constants.ts):
 *   - the Google Contacts sync rules (PUT connect/.../contacts/mapping-rules,
 *     applied to every contact a sync creates);
 *   - the Outlook Contacts sync rules (PUT connect/.../outlook-contacts/mapping-rules);
 *   - the connector form mapping (Typeform, Jotform, webhook forms: POST
 *     connect/.../connector-forms/:source/:externalFormId/mapping, applied on
 *     backfill to the contact a submission creates or is linked to).
 * So 'DORMANT', 'customer', 'partner' or 'ACTIVE' reached Contact.status.
 *
 * The setting now stores a status only through canonicalContactStatus (the
 * vocabulary in any case or padding as itself, the legacy CUSTOMER and DORMANT
 * as CLIENT) and answers 400 for a value with none, leaving the stored rules
 * as they were; null or a blank clears it. The apply path reads a rule stored
 * before D-92 through canonicalContactStatus too: a legacy DORMANT or customer
 * is CLIENT, and a value with no ContactStatus writes no status (the contact
 * keeps the LEAD it is created with).
 *
 * The Google Forms mapping (google-forms-mapping.service.ts) is not one of
 * them: its opportunityDefaults.defaultStatus is the status of the quote it
 * creates, and the contact it creates names no status (control case below).
 *
 * Mocked HTTP: the real ConnectController and the real connect services over
 * an in-memory Prisma stand-in; AuthGuard and BusinessGuard are overridden
 * (authority on these routes is not this packet's), the provider APIs (People
 * API, Microsoft Graph) are a stubbed fetch and the token helpers return a fake
 * token. No database, no network.
 */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectController } from '../src/modules/connect/connect.controller';
import { GoogleContactsSyncService } from '../src/modules/connect/google-contacts-sync.service';
import { OutlookContactsSyncService } from '../src/modules/connect/outlook-contacts-sync.service';
import { ConnectorFormMappingService } from '../src/modules/connect/connector-form-mapping.service';
import { GoogleFormsMappingService } from '../src/modules/connect/google-forms-mapping.service';
import { GoogleFormsService } from '../src/modules/connect/google-forms.service';
import { ContactSyncService } from '../src/modules/connect/contact-sync.service';
import { SignatureParserService } from '../src/modules/connect/signature-parser.service';
import { GoogleBusinessProfileService } from '../src/modules/connect/google-business-profile.service';
import { AuthGuard } from '../src/core/auth/auth.guard';
import { BusinessGuard } from '../src/core/auth/business.guard';
import { CONTACT_STATUSES, isContactStatus } from '../src/modules/crm/crm.constants';

type Row = Record<string, any>;

/**
 * A Prisma `where` evaluated in memory: equality, a compound unique key
 * (businessId_connectorType, ...), OR, startsWith, contains and in. Anything else throws,
 * so a query shape the stand-in does not know fails here instead of matching.
 */
function matches(row: Row, where: Row | undefined): boolean {
  return Object.entries(where ?? {}).every(([key, cond]) => {
    if (key === 'OR') return (cond as Row[]).some((w) => matches(row, w));
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      if (key.includes('_')) return matches(row, cond as Row);
      return Object.entries(cond as Row).every(([op, x]) => {
        if (op === 'startsWith') return String(row[key] ?? '').startsWith(x);
        if (op === 'in') return (x as unknown[]).includes(row[key]);
        if (op === 'contains') return String(row[key] ?? '').includes(x);
        throw new Error(`in-memory where: unsupported operator ${key}.${op}`);
      });
    }
    return (row[key] ?? null) === cond;
  });
}

function applyData(row: Row, data: Row): Row {
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      if ('set' in value) { row[key] = value.set; continue; }
      if ('increment' in value) { row[key] = (row[key] ?? 0) + value.increment; continue; }
    }
    row[key] = value;
  }
  row.updatedAt = new Date();
  return row;
}

class Table {
  rows: Row[] = [];
  private seq = 0;
  constructor(private readonly name: string) {}

  insert(data: Row): Row {
    this.seq += 1;
    const row = { id: `${this.name}-${this.seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
    this.rows.push(row);
    return row;
  }

  private one(where: Row): Row {
    const row = this.rows.find((r) => matches(r, where));
    if (!row) throw new Error(`${this.name}: no row for ${JSON.stringify(where)}`);
    return row;
  }

  model() {
    return {
      findUnique: async ({ where }: Row) => this.rows.find((r) => matches(r, where)) ?? null,
      findFirst: async ({ where }: Row) => this.rows.find((r) => matches(r, where)) ?? null,
      findMany: async ({ where }: Row = {}) => this.rows.filter((r) => matches(r, where)),
      count: async ({ where }: Row = {}) => this.rows.filter((r) => matches(r, where)).length,
      create: async ({ data }: Row) => this.insert(data),
      update: async ({ where, data }: Row) => applyData(this.one(where), data),
      delete: async ({ where }: Row) => {
        const row = this.one(where);
        this.rows = this.rows.filter((r) => r !== row);
        return row;
      },
      upsert: async ({ where, create, update }: Row) => {
        const row = this.rows.find((r) => matches(r, where));
        return row ? applyData(row, update) : this.insert(create);
      },
    };
  }
}

const TABLES = [
  'business',
  'connectorStatus',
  'contact',
  'contactExternalMapping',
  'contactSyncAudit',
  'leadForm',
  'leadFormSubmission',
  'googleFormMapping',
  'quote',
] as const;
type TableName = (typeof TABLES)[number];

const db = {} as Record<TableName, Table>;
const prisma = { client: {} as Record<string, unknown> };
function resetDb() {
  for (const name of TABLES) {
    db[name] = new Table(name);
    prisma.client[name] = db[name].model();
  }
}
resetDb();

/** CrmService.createContact as the connect services use it: the contact is created with the status it is given, LEAD by default. */
const crmCreated: Row[] = [];
const crm = {
  createContact: vi.fn(async (input: Row) => {
    crmCreated.push(input);
    return db.contact.insert({ ...input, status: input.status ?? 'LEAD', tags: input.tags ?? [], deletedAt: null });
  }),
};

const formResponses: Row[] = [];
const googleForms = {
  listResponses: vi.fn(async () => ({ responses: formResponses })),
};

const google = new GoogleContactsSyncService(prisma as any);
const outlook = new OutlookContactsSyncService(prisma as any);
const connectorForms = new ConnectorFormMappingService(prisma as any, crm as any);
const formsMapping = new GoogleFormsMappingService(prisma as any, googleForms as any, crm as any);
// The token helpers read and refresh OAuth tokens on the business row; the
// sync under test only needs a token to send to the stubbed provider API.
(google as any).tokens = { getValidAccessToken: async () => 'fake-access-token' };
(outlook as any).tokens = { getValidAccessToken: async () => 'fake-access-token' };

/** The provider API page the stubbed fetch answers with, per host. */
let peopleConnections: Row[] = [];
let graphContacts: Row[] = [];
const fetchStub = vi.fn(async (url: string) => {
  const body = String(url).includes('people.googleapis.com')
    ? { connections: peopleConnections }
    : String(url).includes('graph.microsoft.com')
      ? { value: graphContacts }
      : null;
  if (!body) throw new Error(`unexpected outbound request: ${url}`);
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
});

/** Statuses the setting reads as a ContactStatus (D-92): [as set, as stored]. */
const CANONICAL: Array<[string, string]> = [
  ['DORMANT', 'CLIENT'],
  ['dormant', 'CLIENT'],
  ['customer', 'CLIENT'],
  ['CUSTOMER', 'CLIENT'],
  [' Lead ', 'LEAD'],
  ['prospect', 'PROSPECT'],
  ['CLIENT', 'CLIENT'],
  ['LOST', 'LOST'],
];
/** Values with no ContactStatus: the setting answers 400 and stores nothing. */
const REFUSED: unknown[] = ['partner', 'churned', 'ACTIVE', 'INACTIVE', 'ARCHIVED', 'VIP', 7, true];

describe('W5-D92-RESIDUALS (D-92): connector contact rules and form mapping store only a ContactStatus', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ConnectController],
      providers: [
        { provide: GoogleContactsSyncService, useValue: google },
        { provide: OutlookContactsSyncService, useValue: outlook },
        { provide: ConnectorFormMappingService, useValue: connectorForms },
        { provide: GoogleFormsMappingService, useValue: formsMapping },
        { provide: GoogleFormsService, useValue: googleForms },
        { provide: ContactSyncService, useValue: {} },
        { provide: SignatureParserService, useValue: {} },
        { provide: GoogleBusinessProfileService, useValue: {} },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(BusinessGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    vi.stubGlobal('fetch', fetchStub);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await app?.close();
  });

  beforeEach(() => {
    resetDb();
    crmCreated.length = 0;
    formResponses.length = 0;
    peopleConnections = [];
    graphContacts = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const agent = () => request(app.getHttpServer());

  function storedRules(businessId: string, connectorType: string) {
    const row = db.connectorStatus.rows.find((r) => r.businessId === businessId && r.connectorType === connectorType);
    return row?.metadata?.mappingRules ?? null;
  }

  /** A rule written before D-92 (the setting stored it as given). */
  function seedLegacyRules(businessId: string, connectorType: string, defaultStatus: unknown) {
    db.business.insert({ id: businessId });
    db.connectorStatus.insert({
      businessId,
      connectorType,
      status: 'connected',
      metadata: { mappingRules: { defaultTags: ['synced'], defaultStatus, defaultOwnerId: null, defaultLifecycleStage: null } },
    });
  }

  describe.each([
    ['Google Contacts', 'contacts', 'google_contacts'],
    ['Outlook Contacts', 'outlook-contacts', 'outlook_contacts'],
  ])('%s sync rules', (_label, route, connectorType) => {
    const url = (businessId: string) => `/connect/businesses/${businessId}/${route}/mapping-rules`;

    it('D-92: the setting stores DORMANT and customer in any case as CLIENT and a canonical status in any case or padding as itself, and answers with the stored status', async () => {
      for (const [given, stored] of CANONICAL) {
        const businessId = `biz-${connectorType}-set-${CANONICAL.findIndex(([g]) => g === given)}`;
        const res = await agent().put(url(businessId)).send({ defaultStatus: given, defaultTags: ['web'] });
        expect(res.status, given).toBe(200);
        expect(res.body.defaultStatus, given).toBe(stored);
        expect(storedRules(businessId, connectorType)?.defaultStatus, given).toBe(stored);
        const read = await agent().get(url(businessId));
        expect(read.body.defaultStatus, given).toBe(stored);
      }
    });

    it('D-92: the setting answers 400 for partner, churned, ACTIVE, INACTIVE, ARCHIVED, an unknown word or a non-string status, and the stored rules stay as they were', async () => {
      const businessId = `biz-${connectorType}-refuse`;
      const seeded = await agent().put(url(businessId)).send({ defaultStatus: 'PROSPECT', defaultTags: ['vip'] });
      expect(seeded.status).toBe(200);
      for (const given of REFUSED) {
        const res = await agent().put(url(businessId)).send({ defaultStatus: given, defaultTags: ['changed'] });
        expect(res.status, String(given)).toBe(400);
        expect(JSON.stringify(res.body), String(given)).toContain(CONTACT_STATUSES.join(', '));
        expect(storedRules(businessId, connectorType), String(given)).toEqual(
          expect.objectContaining({ defaultStatus: 'PROSPECT', defaultTags: ['vip'] }),
        );
      }
    });

    it('D-92: null or a blank status clears the rule, and a save that names no status keeps the stored one', async () => {
      const businessId = `biz-${connectorType}-clear`;
      await agent().put(url(businessId)).send({ defaultStatus: 'lost' }).expect(200);
      const kept = await agent().put(url(businessId)).send({ defaultTags: ['a'] });
      expect(kept.status).toBe(200);
      expect(kept.body).toEqual(expect.objectContaining({ defaultStatus: 'LOST', defaultTags: ['a'] }));
      for (const cleared of [null, '', '   ']) {
        await agent().put(url(businessId)).send({ defaultStatus: 'CLIENT' }).expect(200);
        const res = await agent().put(url(businessId)).send({ defaultStatus: cleared });
        expect(res.status, String(cleared)).toBe(200);
        expect(res.body.defaultStatus, String(cleared)).toBeNull();
        expect(storedRules(businessId, connectorType)?.defaultStatus, String(cleared)).toBeNull();
      }
    });

    it('D-92: a sync applies a rule stored before D-92 through canonicalContactStatus: a legacy DORMANT or customer creates a CLIENT, and partner, churned or ACTIVE writes no status (the contact stays a LEAD)', async () => {
      const LEGACY: Array<[string, string]> = [
        ['DORMANT', 'CLIENT'],
        ['dormant', 'CLIENT'],
        ['customer', 'CLIENT'],
        ['prospect', 'PROSPECT'],
        ['partner', 'LEAD'],
        ['churned', 'LEAD'],
        ['ACTIVE', 'LEAD'],
      ];
      for (const [legacy, stored] of LEGACY) {
        resetDb();
        const businessId = `biz-${connectorType}-apply`;
        seedLegacyRules(businessId, connectorType, legacy);
        // What the rule reports is what a sync applies.
        const read = await agent().get(url(businessId));
        expect(read.body.defaultStatus, legacy).toBe(stored === 'LEAD' ? null : stored);
        const handle = `person.${legacy.toLowerCase()}@example.test`;
        peopleConnections = [{ resourceName: 'people/c1', names: [{ givenName: 'Ada' }], emailAddresses: [{ value: handle }] }];
        graphContacts = [{ id: 'graph-c1', givenName: 'Ada', emailAddresses: [{ address: handle }] }];
        const sync = await agent().post(`/connect/businesses/${businessId}/${route}/sync`);
        expect(sync.status, `${legacy}: ${JSON.stringify(sync.body)}`).toBe(201);
        expect(sync.body.imported, legacy).toBe(1);
        const created = db.contact.rows.filter((r) => r.businessId === businessId);
        expect(created, legacy).toHaveLength(1);
        expect(created[0].status, legacy).toBe(stored);
        expect(isContactStatus(created[0].status), legacy).toBe(true);
        // The other defaults of the rule still apply.
        expect(created[0].tags, legacy).toEqual(['synced']);
      }
    });
  });

  describe('connector form mapping (Typeform, Jotform, webhook forms)', () => {
    const mappingUrl = (businessId: string) => `/connect/businesses/${businessId}/connector-forms/typeform/form-ext/mapping`;
    const fieldMappings = [{ questionId: 'q-email', crmField: 'email' }];

    it('D-92: the setting stores DORMANT and customer in any case as CLIENT and a canonical status in any case or padding as itself, and answers with the stored status', async () => {
      for (const [given, stored] of CANONICAL) {
        const businessId = `biz-form-set-${CANONICAL.findIndex(([g]) => g === given)}`;
        const res = await agent().post(mappingUrl(businessId)).send({ fieldMappings, defaultStatus: given });
        expect(res.status, given).toBe(201);
        expect(res.body.defaultStatus, given).toBe(stored);
        const read = await agent().get(mappingUrl(businessId));
        expect(read.body.defaultStatus, given).toBe(stored);
      }
    });

    it('D-92: the setting answers 400 for partner, churned, ACTIVE, INACTIVE, ARCHIVED, an unknown word or a non-string status, and the stored mapping stays as it was', async () => {
      const businessId = 'biz-form-refuse';
      await agent().post(mappingUrl(businessId)).send({ fieldMappings, defaultStatus: 'PROSPECT', defaultTags: ['vip'] }).expect(201);
      const before = JSON.stringify(db.connectorStatus.rows.map((r) => r.metadata));
      for (const given of REFUSED) {
        const res = await agent().post(mappingUrl(businessId)).send({ fieldMappings: [], defaultStatus: given, defaultTags: ['changed'] });
        expect(res.status, String(given)).toBe(400);
        expect(JSON.stringify(res.body), String(given)).toContain(CONTACT_STATUSES.join(', '));
      }
      expect(JSON.stringify(db.connectorStatus.rows.map((r) => r.metadata))).toBe(before);
      const read = await agent().get(mappingUrl(businessId));
      expect(read.body).toEqual(expect.objectContaining({ defaultStatus: 'PROSPECT', defaultTags: ['vip'] }));
    });

    it('D-92: null or a blank status clears the mapping default, and a save that names no status keeps the stored one', async () => {
      const businessId = 'biz-form-clear';
      await agent().post(mappingUrl(businessId)).send({ fieldMappings, defaultStatus: 'lost' }).expect(201);
      const kept = await agent().post(mappingUrl(businessId)).send({ fieldMappings, defaultTags: ['a'] });
      expect(kept.body).toEqual(expect.objectContaining({ defaultStatus: 'LOST', defaultTags: ['a'] }));
      for (const cleared of [null, '', '   ']) {
        await agent().post(mappingUrl(businessId)).send({ fieldMappings, defaultStatus: 'CLIENT' }).expect(201);
        const res = await agent().post(mappingUrl(businessId)).send({ fieldMappings, defaultStatus: cleared });
        expect(res.status, String(cleared)).toBe(201);
        expect(res.body.defaultStatus, String(cleared)).toBeNull();
      }
    });

    it('D-92: a backfill applies a mapping stored before D-92 through canonicalContactStatus, to the contact a submission creates and the one it is linked to: a legacy DORMANT or customer is CLIENT, and partner, churned or ACTIVE writes no status', async () => {
      const LEGACY: Array<[string, string | null]> = [
        ['DORMANT', 'CLIENT'],
        ['dormant', 'CLIENT'],
        ['customer', 'CLIENT'],
        ['prospect', 'PROSPECT'],
        ['partner', null],
        ['churned', null],
        ['ACTIVE', null],
      ];
      for (const [legacy, stored] of LEGACY) {
        resetDb();
        const businessId = 'biz-form-apply';
        db.business.insert({ id: businessId });
        const form = db.leadForm.insert({ businessId, name: 'Intake', embedCode: 'typeform:form-ext', deletedAt: null });
        db.connectorStatus.insert({
          businessId,
          connectorType: 'typeform',
          status: 'connected',
          metadata: {
            formMappings: {
              'form-ext': { formId: 'form-ext', fieldMappings, defaultTags: ['web'], defaultStatus: legacy, autoCreate: true },
            },
          },
        });
        const linked = db.contact.insert({ businessId, status: 'LOST', tags: ['old'], deletedAt: null });
        db.leadFormSubmission.insert({ businessId, formId: form.id, data: { 'q-email': 'new.person@example.test' }, contactId: null });
        db.leadFormSubmission.insert({ businessId, formId: form.id, data: { 'q-email': 'linked@example.test' }, contactId: linked.id });

        const res = await agent().post(`/connect/businesses/${businessId}/connector-forms/typeform/${form.id}/backfill`);
        expect(res.status, `${legacy}: ${JSON.stringify(res.body)}`).toBe(201);
        expect(res.body.contactsCreated, legacy).toBe(1);
        const created = db.contact.rows.find((r) => r.id !== linked.id)!;
        expect(created.status, legacy).toBe(stored ?? 'LEAD');
        expect(linked.status, legacy).toBe(stored ?? 'LOST');
        for (const row of db.contact.rows) expect(isContactStatus(row.status), `${legacy}: ${row.id}`).toBe(true);
        expect(linked.tags, legacy).toEqual(['old', 'web']);
      }
    });
  });

  it('D-92 control: the Google Forms mapping writes no Contact.status: its opportunityDefaults.defaultStatus is the status of the quote it creates, and the contact it creates names no status (LEAD)', async () => {
    const businessId = 'biz-gforms';
    db.business.insert({ id: businessId });
    const saved = await agent()
      .post(`/connect/businesses/${businessId}/forms/gform-1/mapping`)
      .send({
        formTitle: 'Quote request',
        fieldMappings: [{ questionId: 'q-email', crmField: 'email' }],
        opportunityDefaults: { enabled: true, defaultStatus: 'SENT' },
      });
    expect(saved.status).toBe(201);
    formResponses.push({
      responseId: 'resp-1',
      answers: { 'q-email': { questionId: 'q-email', textAnswers: { answers: [{ value: 'form.person@example.test' }] } } },
    });
    const res = await agent().post(`/connect/businesses/${businessId}/forms/gform-1/backfill`);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ contactsCreated: 1, opportunitiesCreated: 1 }));
    expect(crmCreated).toHaveLength(1);
    expect(crmCreated[0], 'the Google Forms contact names a status').not.toHaveProperty('status');
    expect(db.contact.rows.map((r) => r.status)).toEqual(['LEAD']);
    expect(db.quote.rows.map((r) => r.status)).toEqual(['SENT']);
  });
});
