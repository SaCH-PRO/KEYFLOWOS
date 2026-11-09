import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { BlockList, isIP } from 'node:net';
import type { Prisma } from '@prisma/client';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { AiUsageService } from '../ai/ai-usage.service';
import pdfParse from 'pdf-parse';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmService } from './crm.service';
import { resolveCrmAccess, visibilityClause } from './crm-permissions.helper';
import { contactWhereBase } from './crm.helpers';
import {
  CONTACT_AGE_GROUPS,
  CONTACT_AGE_GROUP_LABELS,
  canonicalContactStatus,
  type ContactAgeGroup,
} from './crm.constants';

const AGE_GROUP_LABEL_TO_CODE: Record<string, ContactAgeGroup> = (() => {
  const map: Record<string, ContactAgeGroup> = {};
  for (const code of CONTACT_AGE_GROUPS) {
    map[code.toLowerCase()] = code;
    const label = CONTACT_AGE_GROUP_LABELS[code];
    if (label) {
      map[label.toLowerCase()] = code;
      map[label.toLowerCase().replace(/\s+/g, '')] = code;
    }
  }
  return map;
})();

/**
 * V1-38c review ST-38c-2: the address ranges import/link may not fetch when
 * its host is an IP literal. BlockList checks an IPv4-mapped IPv6 address
 * (::ffff:a.b.c.d) against the IPv4 ranges.
 */
const NON_PUBLIC_ADDRESSES: BlockList = (() => {
  const list = new BlockList();
  const ipv4: Array<[string, number]> = [
    ['0.0.0.0', 8], // this network
    ['10.0.0.0', 8],
    ['100.64.0.0', 10], // shared address space
    ['127.0.0.0', 8], // loopback
    ['169.254.0.0', 16], // link-local, the cloud metadata address
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15], // benchmarking
    ['224.0.0.0', 4], // multicast
    ['240.0.0.0', 4], // reserved, broadcast
  ];
  const ipv6: Array<[string, number]> = [
    ['::', 96], // unspecified, loopback, IPv4-compatible
    ['64:ff9b::', 96], // NAT64: an IPv4 address behind a translator
    ['64:ff9b:1::', 48], // local-use NAT64
    ['100::', 64], // discard
    ['2001::', 32], // Teredo
    ['2001:db8::', 32], // documentation
    ['2002::', 16], // 6to4
    ['fc00::', 7], // unique local
    ['fe80::', 10], // link-local
    ['fec0::', 10], // site-local
    ['ff00::', 8], // multicast
  ];
  for (const [network, prefix] of ipv4) list.addSubnet(network, prefix, 'ipv4');
  for (const [network, prefix] of ipv6) list.addSubnet(network, prefix, 'ipv6');
  return list;
})();

/** ST-38c-2: the redirects import/link follows, each target checked first. */
const MAX_IMPORT_REDIRECTS = 5;

function normalizeAgeGroupValue(raw: string): ContactAgeGroup | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const direct = AGE_GROUP_LABEL_TO_CODE[trimmed.toLowerCase()];
  if (direct) return direct;
  const collapsed = trimmed.toLowerCase().replace(/\s+/g, '');
  return AGE_GROUP_LABEL_TO_CODE[collapsed] ?? null;
}

interface ExtractedContact {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  jobTitle?: string;
  address?: string;
  website?: string;
}

type FieldMapping = {
  firstName?: string;
  lastName?: string;
  displayName?: string;
  email?: string;
  secondaryEmail?: string;
  phone?: string;
  secondaryPhone?: string;
  whatsappNumber?: string;
  status?: string;
  tags?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  timezone?: string;
  companyName?: string;
  jobTitle?: string;
  department?: string;
  industry?: string;
  segment?: string;
  preferredChannel?: string;
  language?: string;
  lifecycleStage?: string;
  marketingOptIn?: string;
  doNotContact?: string;
  notesInternal?: string;
  ageGroup?: string;
  custom?: string[];
};

type ParsedRow = Record<string, string | null>;

@Injectable()
export class CrmImportService {
  private readonly logger = new Logger(CrmImportService.name);

  private readonly synonymMap: Record<string, string> = {
    firstname: 'firstName',
    fname: 'firstName',
    given_name: 'firstName',
    first_name: 'firstName',
    lastname: 'lastName',
    lname: 'lastName',
    family_name: 'lastName',
    surname: 'lastName',
    last_name: 'lastName',
    displayname: 'displayName',
    display_name: 'displayName',
    full_name: 'displayName',
    fullname: 'displayName',
    email: 'email',
    e_mail: 'email',
    mail: 'email',
    email_address: 'email',
    secondaryemail: 'secondaryEmail',
    secondary_email: 'secondaryEmail',
    email2: 'secondaryEmail',
    alternate_email: 'secondaryEmail',
    phone: 'phone',
    mobile: 'phone',
    telephone: 'phone',
    tel: 'phone',
    phone_number: 'phone',
    secondaryphone: 'secondaryPhone',
    secondary_phone: 'secondaryPhone',
    phone2: 'secondaryPhone',
    alternate_phone: 'secondaryPhone',
    home_phone: 'secondaryPhone',
    whatsappnumber: 'whatsappNumber',
    whatsapp_number: 'whatsappNumber',
    whatsapp: 'whatsappNumber',
    wa_number: 'whatsappNumber',
    status: 'status',
    stage: 'status',
    pipeline_stage: 'status',
    tags: 'tags',
    labels: 'tags',
    group: 'tags',
    address: 'addressLine1',
    address_line_1: 'addressLine1',
    addressline1: 'addressLine1',
    street: 'addressLine1',
    street_address: 'addressLine1',
    address_1: 'addressLine1',
    addressline2: 'addressLine2',
    address_line_2: 'addressLine2',
    address_2: 'addressLine2',
    apt: 'addressLine2',
    suite: 'addressLine2',
    city: 'city',
    town: 'city',
    state: 'state',
    province: 'state',
    region: 'state',
    postalcode: 'postalCode',
    postal_code: 'postalCode',
    zip: 'postalCode',
    zip_code: 'postalCode',
    zipcode: 'postalCode',
    country: 'country',
    timezone: 'timezone',
    time_zone: 'timezone',
    tz: 'timezone',
    company: 'companyName',
    company_name: 'companyName',
    companyname: 'companyName',
    organization: 'companyName',
    org: 'companyName',
    jobtitle: 'jobTitle',
    job_title: 'jobTitle',
    title: 'jobTitle',
    position: 'jobTitle',
    role: 'jobTitle',
    department: 'department',
    dept: 'department',
    industry: 'industry',
    sector: 'industry',
    segment: 'segment',
    preferredchannel: 'preferredChannel',
    preferred_channel: 'preferredChannel',
    contact_method: 'preferredChannel',
    language: 'language',
    lang: 'language',
    locale: 'language',
    lifecyclestage: 'lifecycleStage',
    lifecycle_stage: 'lifecycleStage',
    lifecycle: 'lifecycleStage',
    marketingoptin: 'marketingOptIn',
    marketing_opt_in: 'marketingOptIn',
    marketing: 'marketingOptIn',
    opted_in: 'marketingOptIn',
    donotcontact: 'doNotContact',
    do_not_contact: 'doNotContact',
    dnc: 'doNotContact',
    opt_out: 'doNotContact',
    notesinternal: 'notesInternal',
    notes_internal: 'notesInternal',
    notes: 'notesInternal',
    internal_notes: 'notesInternal',
    agegroup: 'ageGroup',
    age_group: 'ageGroup',
    age: 'ageGroup',
    age_range: 'ageGroup',
    agerange: 'ageGroup',
    age_bracket: 'ageGroup',
  };

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
  ) {}

  private toParsedRow(raw: unknown): ParsedRow {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const entries = Object.entries(raw as Record<string, unknown>).map(([key, value]) => [
        key,
        value === null || value === undefined ? null : String(value),
      ]);
      return Object.fromEntries(entries) as ParsedRow;
    }
    return {};
  }

  private normalizeFieldMapping(mapping: unknown): FieldMapping | null {
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return null;
    const record = mapping as Record<string, unknown>;
    const normalized: FieldMapping = { custom: [] };
    const keys: Array<keyof Omit<FieldMapping, 'custom'>> = [
      'firstName', 'lastName', 'displayName', 'email', 'secondaryEmail',
      'phone', 'secondaryPhone', 'whatsappNumber', 'status', 'tags',
      'addressLine1', 'addressLine2', 'city', 'state', 'postalCode',
      'country', 'timezone', 'companyName', 'jobTitle', 'department',
      'industry', 'segment', 'preferredChannel', 'language',
      'lifecycleStage', 'marketingOptIn', 'doNotContact', 'notesInternal',
      'ageGroup',
    ];
    for (const key of keys) {
      if (typeof record[key] === 'string') {
        normalized[key] = record[key] as string;
      }
    }
    if (Array.isArray(record.custom)) {
      normalized.custom = (record.custom as unknown[]).filter((item): item is string => typeof item === 'string');
    }
    return normalized;
  }

  /**
   * Every import entry point takes `actorUserId`, the requesting member. With
   * it, a member who may not create contacts is refused 403 before an import
   * job is opened, a link fetched or the vision model called, and each row goes
   * through findOrCreateContact with that actor (merged only into contacts the
   * member may edit; a collision answers the visibility-bounded 409).
   */
  private async assertImportAllowed(businessId: string, actorUserId?: string) {
    if (actorUserId) await this.crm.assertCanCreateContacts(businessId, actorUserId);
  }

  async createFileImport(params: {
    businessId: string;
    sourceType: 'csv' | 'xlsx' | 'pdf' | 'image' | 'vcf';
    originalName?: string;
    sourceUrl?: string;
    fileBuffer?: Buffer;
    ocrText?: string;
    actorUserId?: string;
  }) {
    await this.assertImportAllowed(params.businessId, params.actorUserId);
    const importJob = await this.prisma.client.contactImport.create({
      data: {
        businessId: params.businessId,
        sourceType: params.sourceType,
        sourceUrl: params.sourceUrl,
        originalName: params.originalName,
        status: 'PROCESSING',
        totalRows: 0,
        processedRows: 0,
      },
    });
    this.logger.log(`Starting import ${importJob.id} (${params.sourceType}) for ${params.businessId}`);

    try {
      const rows = await this.extractRows(params.sourceType, params.fileBuffer, params.ocrText);
      await this.prisma.client.contactImport.update({
        where: { id: importJob.id },
        data: { totalRows: rows.length },
      });

      let processed = 0;
      for (const row of rows) {
        const record = await this.prisma.client.contactImportContact.create({
          data: {
            importId: importJob.id,
            rawData: row,
          },
        });
        try {
          await this.processImportRecord({
            businessId: params.businessId,
            importId: importJob.id,
            recordId: record.id,
            actorUserId: params.actorUserId,
          });
          processed += 1;
        } catch (error: any) {
          await this.prisma.client.contactImportContact.update({
            where: { id: record.id },
            data: {
              status: 'FAILED',
              error: (error as Error)?.message,
            },
          });
        }
      }

      await this.prisma.client.contactImport.update({
        where: { id: importJob.id },
        data: {
          status: processed === rows.length ? 'COMPLETED' : 'FAILED',
          processedRows: processed,
          completedAt: new Date(),
        },
      });
      this.logger.log(
        `Import ${importJob.id} completed: ${processed}/${rows.length} processed, status ${
          processed === rows.length ? 'COMPLETED' : 'FAILED'
        }`,
      );

      return this.prisma.client.contactImport.findUnique({ where: { id: importJob.id } });
    } catch (err: any) {
      await this.prisma.client.contactImport.update({
        where: { id: importJob.id },
        data: {
          status: 'FAILED',
          error: (err as Error).message,
        },
      });
      throw err;
    }
  }

  /**
   * V1-38c review ST-38c-2 (pre-existing): import/link fetches only a public
   * address. WHATWG URL gives an IPv6 host in brackets and keeps a trailing
   * dot, so the old literal list missed [::ffff:127.0.0.1], the IPv4-mapped
   * metadata address and [fd00::1]; it also missed 127.0.0.0/8 beyond
   * 127.0.0.1. An IP literal is now checked against NON_PUBLIC_ADDRESSES (an
   * IPv4-mapped IPv6 address against the IPv4 ranges). A DNS name is checked
   * by name only: one that resolves to a private address (127.0.0.1.nip.io)
   * is not caught here, which needs the resolved address pinned for the fetch
   * (follow-up packet).
   */
  private validateImportUrl(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('Invalid URL');
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new BadRequestException('URL must use http or https');
    }

    const hostname = parsed.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '');

    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
      throw new BadRequestException('Private addresses are not allowed');
    }

    const family = isIP(hostname);
    if (family !== 0 && NON_PUBLIC_ADDRESSES.check(hostname, family === 6 ? 'ipv6' : 'ipv4')) {
      throw new BadRequestException('Private IP ranges are not allowed');
    }
  }

  /**
   * ST-38c-2: fetch the link without letting fetch follow a redirect on its
   * own. Each redirect target passes validateImportUrl before it is fetched,
   * and at most MAX_IMPORT_REDIRECTS are followed.
   */
  private async fetchImportLink(sourceUrl: string): Promise<Response> {
    let url = sourceUrl;
    for (let hops = 0; ; hops++) {
      const response = await fetch(url, { redirect: 'manual' });
      const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
      if (!location) return response;
      await response.body?.cancel().catch(() => undefined);
      if (hops >= MAX_IMPORT_REDIRECTS) {
        throw new BadRequestException('Too many redirects');
      }
      let next: string;
      try {
        next = new URL(location, url).toString();
      } catch {
        throw new BadRequestException('Invalid redirect URL');
      }
      this.validateImportUrl(next);
      url = next;
    }
  }

  async createLinkImport(params: { businessId: string; sourceUrl: string; actorUserId?: string }) {
    await this.assertImportAllowed(params.businessId, params.actorUserId);
    this.validateImportUrl(params.sourceUrl);

    const importRecord = await this.prisma.client.contactImport.create({
      data: {
        businessId: params.businessId,
        sourceType: 'link',
        sourceUrl: params.sourceUrl,
        status: 'PROCESSING',
      },
    });

    try {
      const response = await this.fetchImportLink(params.sourceUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
      }
      
      const contentType = response.headers.get('content-type') || '';
      const text = await response.text();
      
      let rows: ParsedRow[] = [];
      
      try {
        rows = parse(text, { columns: true, skip_empty_lines: true, relax_column_count: true }) as ParsedRow[];
      } catch {
        rows = [];
      }

      if (rows.length === 0) {
        await this.prisma.client.contactImport.update({
          where: { id: importRecord.id },
          data: { status: 'FAILED', error: 'No valid rows found in the file' },
        });
        return importRecord;
      }

      const rawHeaders = Object.keys(rows[0] || {});
      const mapping = this.inferFieldMapping(rawHeaders);

      await this.prisma.client.contactImport.update({
        where: { id: importRecord.id },
        data: {
          totalRows: rows.length,
          headerMapping: mapping,
        },
      });

      // Each row is settled on its own, as import/file does: a row that is
      // refused (a 409 from a contact the member may not edit, a 403) or fails
      // is marked FAILED with its error and the import goes on with the next
      // row; a row that resolves to a contact is marked CREATED with its id.
      let created = 0;
      let failed = 0;
      for (const row of rows) {
        const builtInput = this.buildContactInput(row, mapping);
        const contactInput = {
          ...builtInput,
          source: 'import',
          sourceDetail: 'link',
        };

        if (!builtInput.firstName && !builtInput.lastName && !builtInput.email && !builtInput.phone) {
          continue;
        }

        const record = await this.prisma.client.contactImportContact.create({
          data: {
            importId: importRecord.id,
            rawData: row as Record<string, unknown>,
            status: 'PENDING',
          },
        });

        try {
          const contact = await this.crm.findOrCreateContact(params.businessId, contactInput, params.actorUserId);
          if (contact) {
            created++;
            await this.prisma.client.contactImportContact.update({
              where: { id: record.id },
              data: { status: 'CREATED', contactId: contact.id },
            });
          }
        } catch (error: unknown) {
          failed++;
          await this.prisma.client.contactImportContact.update({
            where: { id: record.id },
            data: { status: 'FAILED', error: (error as Error)?.message },
          });
        }
      }

      await this.prisma.client.contactImport.update({
        where: { id: importRecord.id },
        data: {
          status: failed === 0 ? 'COMPLETED' : 'FAILED',
          processedRows: created,
          completedAt: new Date(),
        },
      });

      return this.prisma.client.contactImport.findUnique({ where: { id: importRecord.id } });
    } catch (err: any) {
      await this.prisma.client.contactImport.update({
        where: { id: importRecord.id },
        data: {
          status: 'FAILED',
          error: (err as Error).message || 'Unknown error',
        },
      });
      throw err;
    }
  }

  async processImportRecord(params: {
    businessId: string;
    importId: string;
    recordId: string;
    actorUserId?: string;
  }) {
    const record = await this.prisma.client.contactImportContact.findUnique({
      where: { id: params.recordId },
      include: { import: true },
    });
    if (!record) {
      throw new BadRequestException('Import record not found');
    }

    const parsedRow = this.toParsedRow(record.rawData);
    const rawHeaders = Object.keys(parsedRow);
    const mapping =
      this.normalizeFieldMapping(record.import.headerMapping) ??
      this.inferFieldMapping(rawHeaders);
    if (!record.import.headerMapping) {
      await this.prisma.client.contactImport.update({
        where: { id: record.importId },
        data: { headerMapping: mapping },
      });
    }

    const contactInput = {
      ...this.buildContactInput(parsedRow, mapping),
      source: 'import',
      sourceDetail: record.import.sourceType,
    };
    const contact = await this.crm.findOrCreateContact(record.import.businessId, contactInput, params.actorUserId);
    if (!contact) {
      throw new BadRequestException('Failed to create contact from import record');
    }

    await this.prisma.client.contactImportContact.update({
      where: { id: record.id },
      data: { status: 'CREATED', contactId: contact.id },
    });

    await this.crm.logContactEvent({
      businessId: record.import.businessId,
      contactId: contact.id,
      type: 'contact.imported',
      data: { importId: record.importId, recordId: record.id },
      source: 'import',
      // The importing member, when there is one (the import routes).
      ...(params.actorUserId ? { actorType: 'USER', actorId: params.actorUserId } : { actorType: 'SYSTEM' }),
    });

    return record;
  }

  async extractContactFromImage(businessId: string, imageBase64: string): Promise<ExtractedContact> {
    try {
      const imageUrl = imageBase64.startsWith('data:')
        ? imageBase64
        : `data:image/jpeg;base64,${imageBase64}`;

      const response = await this.aiUsage.trackVision(
        businessId,
        undefined,
        'vision_contact',
        [
          {
            role: 'system',
            content: `You are a contact information extractor. Analyze the image (likely a business card or contact info) and extract any contact details you can find. Return a JSON object with these fields (use null for missing fields):
- firstName: string or null
- lastName: string or null
- email: string or null
- phone: string or null (include country code if visible)
- companyName: string or null
- jobTitle: string or null
- address: string or null
- website: string or null

Only return the JSON object, no markdown or explanation.`,
          },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: imageUrl, detail: 'high' },
              },
              { type: 'text', text: 'Extract contact information from this image.' },
            ],
          },
        ],
        500,
        0.2,
        'gpt-4o',
      );

      const content = response.content || '{}';
      const cleanJson = content.replace(/```json\n?|\n?```/g, '').trim();
      const parsed = JSON.parse(cleanJson);
      return {
        firstName: parsed.firstName || undefined,
        lastName: parsed.lastName || undefined,
        email: parsed.email || undefined,
        phone: parsed.phone || undefined,
        companyName: parsed.companyName || undefined,
        jobTitle: parsed.jobTitle || undefined,
        address: parsed.address || undefined,
        website: parsed.website || undefined,
      };
    } catch (error: any) {
      this.logger.error('Failed to extract contact from image', error as Error);
      throw error;
    }
  }

  async scanContactImage(businessId: string, buffer: Buffer, mimetype?: string, actorUserId?: string) {
    await this.assertImportAllowed(businessId, actorUserId);
    const base64 = `data:${mimetype || 'image/jpeg'};base64,${buffer.toString('base64')}`;
    const extracted = await this.extractContactFromImage(businessId, base64);
    if (!extracted.firstName && !extracted.lastName && !extracted.email && !extracted.phone) {
      throw new BadRequestException('Could not extract any contact information from this image. Try a clearer photo.');
    }
    const contact = await this.crm.findOrCreateContact(businessId, {
      firstName: extracted.firstName,
      lastName: extracted.lastName,
      email: extracted.email,
      phone: extracted.phone,
      companyName: extracted.companyName,
      source: 'scan',
      sourceDetail: 'business_card',
    }, actorUserId);
    return { contact, extracted };
  }

  async createContactFromOcr(params: {
    businessId: string;
    ocrText: string;
    mediaUrl?: string;
    type?: string;
    actorUserId?: string;
  }) {
    const mapped = this.parseOcrText(params.ocrText);
    const contact = await this.crm.findOrCreateContact(params.businessId, {
      firstName: mapped.firstName,
      lastName: mapped.lastName,
      email: mapped.email,
      phone: mapped.phone,
      source: 'ocr',
      sourceDetail: params.type ?? 'business_card',
    }, params.actorUserId);
    if (!contact) {
      throw new BadRequestException('Failed to create contact from OCR text');
    }

    const media = await this.prisma.client.contactMedia.create({
      data: {
        businessId: params.businessId,
        contactId: contact.id,
        type: params.type ?? 'business_card',
        url: params.mediaUrl ?? '',
        ocrText: params.ocrText,
      },
    });

    await this.crm.logContactEvent({
      businessId: params.businessId,
      contactId: contact.id,
      type: 'contact.imported_from_media',
      data: { mediaId: media.id },
      source: 'ocr',
      // The importing member, when there is one (the import route).
      ...(params.actorUserId ? { actorType: 'USER', actorId: params.actorUserId } : { actorType: 'SYSTEM' }),
    });

    return { contact, media };
  }

  async listImports(businessId: string) {
    return this.prisma.client.contactImport.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  /**
   * The rows of one import. With `actorUserId` (the route passes the requesting
   * member), a row linked to a contact is listed only when that member may open
   * the contact, under the same M7 visibility clause the contact list and
   * detail apply (a live contact of this tenant): its raw data and contact id
   * would otherwise disclose a PRIVATE or unshared contact. A row linked to no
   * contact (FAILED, PENDING) is listed as before. OWNER and SUPER_ADMIN see
   * every row.
   */
  async listImportRecords(businessId: string, importId: string, actorUserId?: string) {
    const importJob = await this.prisma.client.contactImport.findUnique({
      where: { id: importId },
    });
    if (!importJob || importJob.businessId !== businessId) {
      throw new BadRequestException('Import not found');
    }
    const where: Prisma.ContactImportContactWhereInput = { importId };
    if (actorUserId) {
      const access = await resolveCrmAccess(this.prisma, businessId, actorUserId);
      const visClause = visibilityClause(access, actorUserId) as Prisma.ContactWhereInput | null;
      if (visClause) {
        where.OR = [{ contactId: null }, { contact: { is: { ...contactWhereBase(businessId), ...visClause } } }];
      }
    }
    return this.prisma.client.contactImportContact.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  private inferFieldMapping(headers: string[]): FieldMapping {
    const mapping: FieldMapping = { custom: [] };
    const knownFields: (keyof Omit<FieldMapping, 'custom'>)[] = [
      'firstName', 'lastName', 'displayName', 'email', 'secondaryEmail',
      'phone', 'secondaryPhone', 'whatsappNumber', 'status', 'tags',
      'addressLine1', 'addressLine2', 'city', 'state', 'postalCode',
      'country', 'timezone', 'companyName', 'jobTitle', 'department',
      'industry', 'segment', 'preferredChannel', 'language',
      'lifecycleStage', 'marketingOptIn', 'doNotContact', 'notesInternal',
      'ageGroup',
    ];
    for (const header of headers) {
      const normalized = header.toLowerCase().replace(/[^a-z0-9]/g, '_');
      const match = this.synonymMap[normalized];
      if (match && knownFields.includes(match as any)) {
        (mapping as any)[match] = header;
      } else if (!match) {
        mapping.custom?.push(header);
      }
    }
    return mapping;
  }

  private buildContactInput(row: ParsedRow, mapping: FieldMapping) {
    const contact: Record<string, unknown> = {};
    // 'status' is not copied verbatim: it is normalised below (V1-38c).
    const stringFields: (keyof Omit<FieldMapping, 'custom' | 'tags' | 'marketingOptIn' | 'doNotContact' | 'status'>)[] = [
      'firstName', 'lastName', 'displayName', 'email', 'secondaryEmail',
      'phone', 'secondaryPhone', 'whatsappNumber',
      'addressLine1', 'addressLine2', 'city', 'state', 'postalCode',
      'country', 'timezone', 'companyName', 'jobTitle', 'department',
      'industry', 'segment', 'preferredChannel', 'language',
      'lifecycleStage', 'notesInternal',
    ];
    for (const field of stringFields) {
      const header = mapping[field];
      if (header && typeof row[header] === 'string' && row[header]) {
        contact[field] = row[header];
      }
    }
    const tagsValue = mapping.tags ? row[mapping.tags] : null;
    if (typeof tagsValue === 'string' && tagsValue) {
      contact.tags = tagsValue
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    }
    const parseBool = (val: string | null | undefined): boolean | null => {
      if (!val) return null;
      const lower = val.toLowerCase().trim();
      if (['yes', 'true', '1', 'y'].includes(lower)) return true;
      if (['no', 'false', '0', 'n'].includes(lower)) return false;
      return null;
    };
    if (mapping.marketingOptIn && row[mapping.marketingOptIn] !== undefined) {
      const val = parseBool(row[mapping.marketingOptIn]);
      if (val !== null) contact.marketingOptIn = val;
    }
    if (mapping.doNotContact && row[mapping.doNotContact] !== undefined) {
      const val = parseBool(row[mapping.doNotContact]);
      if (val !== null) contact.doNotContact = val;
    }
    if (mapping.ageGroup) {
      const raw = row[mapping.ageGroup];
      if (typeof raw === 'string' && raw.trim()) {
        const code = normalizeAgeGroupValue(raw);
        if (code) contact.ageGroup = code;
      }
    }
    // V1-38c (CF-49), D-92: the status, stage or pipeline_stage column is never
    // stored verbatim (crm.constants.ts canonicalContactStatus): the
    // vocabulary in any case, and the legacy CUSTOMER and DORMANT in any case
    // as CLIENT, the mapping the status readers use. D-92: dormancy is worked
    // out from inactivity, never stored (before D-92 a DORMANT cell kept the
    // legacy DORMANT, review CR-V38c-1). Any other cell (INACTIVE, an unknown
    // stage) is dropped, as an unrecognised age group or flag is, so a new
    // contact takes createContact's LEAD default.
    if (mapping.status) {
      const status = canonicalContactStatus(row[mapping.status]);
      if (status) contact.status = status;
    }
    if (mapping.custom?.length) {
      const custom: Record<string, string | null> = {};
      for (const column of mapping.custom) {
        if (row[column] !== undefined) {
          custom[column] = row[column];
        }
      }
      if (Object.keys(custom).length) {
        contact.custom = custom;
      }
    }
    return contact;
  }

  private cellValueToString(value: ExcelJS.CellValue): string | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') {
      if ('result' in value && (value as { result?: unknown }).result !== undefined) {
        return this.cellValueToString((value as { result: ExcelJS.CellValue }).result);
      }
      if ('richText' in value && Array.isArray((value as { richText?: unknown }).richText)) {
        return (value as { richText: Array<{ text?: string }> }).richText
          .map((rt) => rt.text ?? '')
          .join('');
      }
      if ('text' in value && (value as { text?: unknown }).text !== undefined) {
        const text = (value as { text: unknown }).text;
        return typeof text === 'string' ? text : String(text);
      }
      if ('error' in value) return null;
      return String(value);
    }
    return String(value);
  }

  private async parseXlsxBuffer(buffer: Buffer): Promise<ParsedRow[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return [];

    const headers: string[] = [];
    const headerRow = sheet.getRow(1);
    headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const headerText = this.cellValueToString(cell.value);
      headers[colNumber - 1] = headerText ?? '';
    });

    const rows: ParsedRow[] = [];
    const lastRow = sheet.actualRowCount > 0 ? sheet.rowCount : 0;
    for (let rowNumber = 2; rowNumber <= lastRow; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const record: ParsedRow = {};
      let hasValue = false;
      for (let col = 0; col < headers.length; col++) {
        const header = headers[col];
        if (!header) continue;
        const value = this.cellValueToString(row.getCell(col + 1).value);
        record[header] = value;
        if (value !== null && value !== '') hasValue = true;
      }
      if (hasValue) rows.push(record);
    }
    return rows;
  }

  private async extractRows(type: 'csv' | 'xlsx' | 'pdf' | 'image' | 'vcf', buffer?: Buffer, ocrText?: string): Promise<ParsedRow[]> {
    if (type === 'csv') {
      if (!buffer) throw new BadRequestException('File buffer required');
      return parse(buffer.toString('utf-8'), {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as ParsedRow[];
    }
    if (type === 'xlsx') {
      if (!buffer) throw new BadRequestException('File buffer required');
      return this.parseXlsxBuffer(buffer);
    }
    if (type === 'pdf') {
      if (!buffer) throw new BadRequestException('File buffer required');
      const data = await pdfParse(buffer);
      return [this.extractTextAsRecord(data.text)];
    }
    if (type === 'image') {
      if (!ocrText) return [];
      return [this.extractTextAsRecord(ocrText)];
    }
    if (type === 'vcf') {
      if (!buffer) throw new BadRequestException('File buffer required');
      return this.parseVCard(buffer.toString('utf-8'));
    }
    return [];
  }

  private unfoldVCardLines(content: string): string[] {
    const rawLines = content.split(/\r?\n/);
    const unfolded: string[] = [];
    
    for (const line of rawLines) {
      if (line.startsWith(' ') || line.startsWith('\t')) {
        if (unfolded.length > 0) {
          unfolded[unfolded.length - 1] += line.substring(1);
        }
      } else {
        unfolded.push(line);
      }
    }
    
    return unfolded;
  }

  private decodeVCardValue(value: string): string {
    return value
      .replace(/\\n/gi, '\n')
      .replace(/\\,/g, ',')
      .replace(/\\;/g, ';')
      .replace(/\\\\/g, '\\');
  }

  private parseVCard(vcfContent: string): ParsedRow[] {
    const contacts: ParsedRow[] = [];
    const vcards = vcfContent.split(/(?=BEGIN:VCARD)/i).filter(v => v.trim());
    
    for (const vcard of vcards) {
      const contact: ParsedRow = {};
      const lines = this.unfoldVCardLines(vcard);
      
      let hasN = false;
      const emails: string[] = [];
      const phones: string[] = [];
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('BEGIN:') || trimmed.startsWith('END:') || trimmed.startsWith('VERSION:')) continue;
        
        const colonIndex = trimmed.indexOf(':');
        if (colonIndex === -1) continue;
        
        const keyPart = trimmed.substring(0, colonIndex).toUpperCase();
        const key = keyPart.split(';')[0];
        const rawValue = trimmed.substring(colonIndex + 1).trim();
        const value = this.decodeVCardValue(rawValue);
        
        if (key === 'N') {
          const parts = value.split(';');
          contact.lastName = parts[0] || null;
          contact.firstName = parts[1] || null;
          hasN = true;
        } else if (key === 'FN' && !hasN) {
          const parts = value.split(' ');
          contact.firstName = parts[0] || null;
          contact.lastName = parts.slice(1).join(' ') || null;
        } else if (key === 'EMAIL') {
          if (!contact.email && value) {
            contact.email = value;
          }
          emails.push(value);
        } else if (key === 'TEL') {
          if (!contact.phone && value) {
            contact.phone = value;
          }
          phones.push(value);
        } else if (key === 'ORG') {
          contact.companyName = value.split(';')[0] || null;
        } else if (key === 'TITLE') {
          contact.jobTitle = value || null;
        } else if (key === 'ADR') {
          const adrParts = value.split(';');
          contact.addressLine1 = adrParts[2] || null;
          contact.city = adrParts[3] || null;
          contact.state = adrParts[4] || null;
          contact.postalCode = adrParts[5] || null;
          contact.country = adrParts[6] || null;
        } else if (key === 'NOTE') {
          contact.notes = value || null;
        } else if (key === 'URL') {
          contact.website = value || null;
        }
      }
      
      if (contact.firstName || contact.lastName || contact.email || contact.phone) {
        contacts.push(contact);
      }
    }
    
    return contacts;
  }

  private extractTextAsRecord(text: string): ParsedRow {
    const rows: ParsedRow = {};
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const [key, ...rest] = line.split(':');
        if (!key) return;
        rows[key.trim()] = rest.join(':').trim();
      });
    return rows;
  }

  private parseOcrText(text: string) {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const nameLine = lines[0] ?? '';
    const [firstName, ...rest] = nameLine.split(' ');
    const lastName = rest.join(' ');
    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const phoneMatch = text.match(/(?:\+?\d[\d -]{8,}\d)/);
    return {
      firstName,
      lastName: lastName || undefined,
      email: emailMatch?.[0],
      phone: phoneMatch?.[0],
    };
  }
}
