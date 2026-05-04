import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import OpenAI from 'openai';
import pdfParse from 'pdf-parse';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmService } from './crm.service';
import {
  CONTACT_AGE_GROUPS,
  CONTACT_AGE_GROUP_LABELS,
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
  private _openai: OpenAI | null = null;
  private get openai(): OpenAI {
    if (!this._openai) {
      this._openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });
    }
    return this._openai;
  }
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

  async createFileImport(params: {
    businessId: string;
    sourceType: 'csv' | 'xlsx' | 'pdf' | 'image' | 'vcf';
    originalName?: string;
    sourceUrl?: string;
    fileBuffer?: Buffer;
    ocrText?: string;
  }) {
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
          });
          processed += 1;
        } catch (error) {
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
    } catch (err) {
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

  async createLinkImport(params: { businessId: string; sourceUrl: string }) {
    const importRecord = await this.prisma.client.contactImport.create({
      data: {
        businessId: params.businessId,
        sourceType: 'link',
        sourceUrl: params.sourceUrl,
        status: 'PROCESSING',
      },
    });

    try {
      const response = await fetch(params.sourceUrl);
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

      let created = 0;
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

        await this.prisma.client.contactImportContact.create({
          data: {
            importId: importRecord.id,
            rawData: row as Record<string, unknown>,
            status: 'PENDING',
          },
        });

        const contact = await this.crm.findOrCreateContact(params.businessId, contactInput);
        if (contact) {
          created++;
        }
      }

      await this.prisma.client.contactImport.update({
        where: { id: importRecord.id },
        data: {
          status: 'COMPLETED',
          processedRows: created,
          completedAt: new Date(),
        },
      });

      return this.prisma.client.contactImport.findUnique({ where: { id: importRecord.id } });
    } catch (err) {
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
    const contact = await this.crm.findOrCreateContact(record.import.businessId, contactInput);
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
      actorType: 'SYSTEM',
    });

    return record;
  }

  async extractContactFromImage(imageBase64: string): Promise<ExtractedContact> {
    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
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
                image_url: {
                  url: imageBase64.startsWith('data:')
                    ? imageBase64
                    : `data:image/jpeg;base64,${imageBase64}`,
                },
              },
              { type: 'text', text: 'Extract contact information from this image.' },
            ],
          },
        ],
        max_tokens: 500,
      });

      const content = response.choices[0]?.message?.content || '{}';
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
    } catch (error) {
      this.logger.error('Failed to extract contact from image', error as Error);
      throw error;
    }
  }

  async scanContactImage(businessId: string, buffer: Buffer, mimetype?: string) {
    const base64 = `data:${mimetype || 'image/jpeg'};base64,${buffer.toString('base64')}`;
    const extracted = await this.extractContactFromImage(base64);
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
    });
    return { contact, extracted };
  }

  async createContactFromOcr(params: {
    businessId: string;
    ocrText: string;
    mediaUrl?: string;
    type?: string;
  }) {
    const mapped = this.parseOcrText(params.ocrText);
    const contact = await this.crm.findOrCreateContact(params.businessId, {
      firstName: mapped.firstName,
      lastName: mapped.lastName,
      email: mapped.email,
      phone: mapped.phone,
      source: 'ocr',
      sourceDetail: params.type ?? 'business_card',
    });
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
      actorType: 'SYSTEM',
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

  async listImportRecords(businessId: string, importId: string) {
    const importJob = await this.prisma.client.contactImport.findUnique({
      where: { id: importId },
    });
    if (!importJob || importJob.businessId !== businessId) {
      throw new BadRequestException('Import not found');
    }
    return this.prisma.client.contactImportContact.findMany({
      where: { importId },
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
    const stringFields: (keyof Omit<FieldMapping, 'custom' | 'tags' | 'marketingOptIn' | 'doNotContact'>)[] = [
      'firstName', 'lastName', 'displayName', 'email', 'secondaryEmail',
      'phone', 'secondaryPhone', 'whatsappNumber', 'status',
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
