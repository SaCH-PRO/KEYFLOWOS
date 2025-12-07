import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { read, utils } from 'xlsx';
import pdfParse from 'pdf-parse';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmService } from './crm.service';

type FieldMapping = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  status?: string;
  tags?: string;
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
    email: 'email',
    e_mail: 'email',
    mail: 'email',
    phone: 'phone',
    mobile: 'phone',
    telephone: 'phone',
    tel: 'phone',
    status: 'status',
    stage: 'status',
    pipeline_stage: 'status',
    tags: 'tags',
    labels: 'tags',
    group: 'tags',
  };

  constructor(private readonly prisma: PrismaService, private readonly crm: CrmService) {}

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
    const keys: Array<keyof Omit<FieldMapping, 'custom'>> = ['firstName', 'lastName', 'email', 'phone', 'status', 'tags'];
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
    sourceType: 'csv' | 'xlsx' | 'pdf' | 'image';
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
    return this.prisma.client.contactImport.create({
      data: {
        businessId: params.businessId,
        sourceType: 'link',
        sourceUrl: params.sourceUrl,
      },
    });
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

    const contactInput = this.buildContactInput(parsedRow, mapping);
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
    for (const header of headers) {
      const normalized = header.toLowerCase().replace(/[^a-z0-9]/g, '_');
      const match = this.synonymMap[normalized];
      if (match) {
        switch (match) {
          case 'tags':
            mapping.tags = header;
            break;
          case 'firstName':
            mapping.firstName = header;
            break;
          case 'lastName':
            mapping.lastName = header;
            break;
          case 'email':
            mapping.email = header;
            break;
          case 'phone':
            mapping.phone = header;
            break;
          case 'status':
            mapping.status = header;
            break;
          default:
            break;
        }
      } else {
        mapping.custom?.push(header);
      }
    }
    return mapping;
  }

  private buildContactInput(row: ParsedRow, mapping: FieldMapping) {
    const contact: Record<string, unknown> = {};
    if (mapping.firstName && typeof row[mapping.firstName] === 'string' && row[mapping.firstName]) {
      contact.firstName = row[mapping.firstName];
    }
    if (mapping.lastName && typeof row[mapping.lastName] === 'string' && row[mapping.lastName]) {
      contact.lastName = row[mapping.lastName];
    }
    if (mapping.email && typeof row[mapping.email] === 'string' && row[mapping.email]) {
      contact.email = row[mapping.email];
    }
    if (mapping.phone && typeof row[mapping.phone] === 'string' && row[mapping.phone]) {
      contact.phone = row[mapping.phone];
    }
    if (mapping.status && typeof row[mapping.status] === 'string' && row[mapping.status]) {
      contact.status = row[mapping.status];
    }
    const tagsValue = mapping.tags ? row[mapping.tags] : null;
    if (typeof tagsValue === 'string' && tagsValue) {
      contact.tags = tagsValue
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
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

  private async extractRows(type: 'csv' | 'xlsx' | 'pdf' | 'image', buffer?: Buffer, ocrText?: string): Promise<ParsedRow[]> {
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
      const workbook = read(buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      return utils.sheet_to_json(sheet, { defval: null }) as ParsedRow[];
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
    return [];
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
