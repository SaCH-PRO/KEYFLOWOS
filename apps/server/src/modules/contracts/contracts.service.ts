import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { ContractStatus, ContractAlertType, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { DocumentIntelligenceService, DocumentExtractionResult } from '../ai/document-intelligence.service';
import type { CreateContractDto } from './dto/create-contract.dto';
import type { UpdateContractDto } from './dto/update-contract.dto';
import type { ExtractContractTermsDto } from './dto/extract-contract-terms.dto';

export interface ContractListFilters {
  status?: ContractStatus;
  search?: string;
  tagIds?: string[];
  expiringWithinDays?: number;
  sourceType?: 'asset' | 'business_asset' | 'document_instance' | 'drive';
  cursor?: string;
  limit?: number;
}

export interface ContractStats {
  total: number;
  byStatus: Record<string, number>;
  expiringSoon: number;
  renewalDue: number;
  expired: number;
  alertCount: number;
}

@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(DocumentIntelligenceService) private readonly docIntel: DocumentIntelligenceService,
  ) {}

  async listContracts(businessId: string, filters: ContractListFilters = {}) {
    const take = Math.min(filters.limit ?? 50, 200);
    const where: Prisma.ContractWhereInput = { businessId };

    if (filters.status) where.status = filters.status;
    if (filters.search) {
      where.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { notes: { contains: filters.search, mode: 'insensitive' } },
        { parties: { some: { name: { contains: filters.search, mode: 'insensitive' } } } },
      ];
    }
    if (filters.tagIds?.length) {
      where.tags = { some: { tagId: { in: filters.tagIds } } };
    }
    if (filters.expiringWithinDays !== undefined) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + filters.expiringWithinDays);
      where.expiryDate = { lte: cutoff, gte: new Date() };
    }
    if (filters.sourceType) {
      switch (filters.sourceType) {
        case 'asset':
          where.sourceAssetId = { not: null };
          break;
        case 'business_asset':
          where.sourceBusinessAssetId = { not: null };
          break;
        case 'document_instance':
          where.sourceDocumentInstanceId = { not: null };
          break;
        case 'drive':
          where.sourceDriveFileId = { not: null };
          break;
      }
    }

    const items = await this.prisma.client.contract.findMany({
      where,
      take,
      skip: filters.cursor ? 1 : 0,
      cursor: filters.cursor ? { id: filters.cursor } : undefined,
      orderBy: { updatedAt: 'desc' },
      include: {
        parties: { orderBy: { createdAt: 'asc' } },
        tags: { include: { tag: true } },
        _count: { select: { alerts: { where: { acknowledgedAt: null } }, terms: true, versions: true } },
      },
    });

    const nextCursor = items.length === take ? items[items.length - 1].id : undefined;
    return { items, nextCursor, total: items.length };
  }

  async getContract(businessId: string, contractId: string) {
    const contract = await this.prisma.client.contract.findFirst({
      where: { id: contractId, businessId },
      include: {
        parties: { orderBy: { createdAt: 'asc' } },
        terms: { orderBy: { extractedAt: 'desc' } },
        versions: { orderBy: { versionNumber: 'desc' } },
        alerts: { orderBy: { dueDate: 'asc' } },
        tags: { include: { tag: true } },
      },
    });
    if (!contract) throw new NotFoundException('Contract not found');
    return contract;
  }

  async createContract(businessId: string, dto: CreateContractDto, userId?: string) {
    const contract = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.contract.create({
        data: {
          businessId,
          title: dto.title,
          contractType: dto.contractType,
          status: dto.status ?? 'DRAFT',
          effectiveDate: dto.effectiveDate ? new Date(dto.effectiveDate) : undefined,
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
          renewalDate: dto.renewalDate ? new Date(dto.renewalDate) : undefined,
          renewalType: dto.renewalType,
          renewalNoticeDays: dto.renewalNoticeDays,
          contractValue: dto.contractValue,
          currency: dto.currency,
          jurisdiction: dto.jurisdiction,
          retentionPolicy: dto.retentionPolicy,
          retentionUntil: dto.retentionUntil ? new Date(dto.retentionUntil) : undefined,
          notes: dto.notes,
          sourceAssetId: dto.sourceAssetId,
          sourceBusinessAssetId: dto.sourceBusinessAssetId,
          sourceDocumentInstanceId: dto.sourceDocumentInstanceId,
          sourceDriveFileId: dto.sourceDriveFileId,
          parties: {
            create: (dto.parties ?? []).map((p) => ({
              businessId,
              role: p.role,
              name: p.name,
              email: p.email,
              phone: p.phone,
              address: p.address,
              notes: p.notes,
              contactId: p.contactId,
            })),
          },
          tags: dto.tagIds?.length
            ? { create: dto.tagIds.map((tagId) => ({ tag: { connect: { id: tagId } } })) }
            : undefined,
        },
        include: { parties: true, tags: { include: { tag: true } } },
      });

      await tx.contractVersion.create({
        data: {
          businessId,
          contractId: created.id,
          versionNumber: 1,
          changeSummary: 'Contract created',
          createdBy: userId,
        },
      });

      return created;
    });

    await this.regenerateAlerts(businessId, contract.id);
    return this.getContract(businessId, contract.id);
  }

  async updateContract(businessId: string, contractId: string, dto: UpdateContractDto) {
    const existing = await this.prisma.client.contract.findFirst({
      where: { id: contractId, businessId },
      include: { parties: true, tags: { select: { tagId: true } } },
    });
    if (!existing) throw new NotFoundException('Contract not found');

    const updated = await this.prisma.client.$transaction(async (tx) => {
      // Replace parties if supplied
      if (dto.parties) {
        await tx.contractParty.deleteMany({ where: { contractId } });
      }

      // Replace tag mapping if supplied
      if (dto.tagIds !== undefined) {
        await tx.contractTagOnContract.deleteMany({ where: { contractId } });
      }

      const data: Prisma.ContractUpdateInput = {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.contractType !== undefined && { contractType: dto.contractType }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.effectiveDate !== undefined && {
          effectiveDate: dto.effectiveDate ? new Date(dto.effectiveDate) : null,
        }),
        ...(dto.expiryDate !== undefined && {
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        }),
        ...(dto.renewalDate !== undefined && {
          renewalDate: dto.renewalDate ? new Date(dto.renewalDate) : null,
        }),
        ...(dto.renewalType !== undefined && { renewalType: dto.renewalType }),
        ...(dto.renewalNoticeDays !== undefined && { renewalNoticeDays: dto.renewalNoticeDays }),
        ...(dto.contractValue !== undefined && { contractValue: dto.contractValue }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        ...(dto.jurisdiction !== undefined && { jurisdiction: dto.jurisdiction }),
        ...(dto.retentionPolicy !== undefined && { retentionPolicy: dto.retentionPolicy }),
        ...(dto.retentionUntil !== undefined && {
          retentionUntil: dto.retentionUntil ? new Date(dto.retentionUntil) : null,
        }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.sourceAssetId !== undefined && { sourceAssetId: dto.sourceAssetId }),
        ...(dto.sourceBusinessAssetId !== undefined && {
          sourceBusinessAssetId: dto.sourceBusinessAssetId,
        }),
        ...(dto.sourceDocumentInstanceId !== undefined && {
          sourceDocumentInstanceId: dto.sourceDocumentInstanceId,
        }),
        ...(dto.sourceDriveFileId !== undefined && { sourceDriveFileId: dto.sourceDriveFileId }),
        ...(dto.parties && {
          parties: {
            create: dto.parties.map((p) => ({
              businessId,
              role: p.role,
              name: p.name,
              email: p.email,
              phone: p.phone,
              address: p.address,
              notes: p.notes,
              contactId: p.contactId,
            })),
          },
        }),
        ...(dto.tagIds?.length && {
          tags: { create: dto.tagIds.map((tagId) => ({ tag: { connect: { id: tagId } } })) },
        }),
      };

      return tx.contract.update({
        where: { id: contractId },
        data,
        include: { parties: true, tags: { include: { tag: true } } },
      });
    });

    await this.regenerateAlerts(businessId, contractId);
    return this.getContract(businessId, updated.id);
  }

  async deleteContract(businessId: string, contractId: string) {
    const existing = await this.prisma.client.contract.findFirst({ where: { id: contractId, businessId } });
    if (!existing) throw new NotFoundException('Contract not found');
    await this.prisma.client.contract.delete({ where: { id: contractId } });
    return { deleted: true };
  }

  async extractTermsFromDocument(
    businessId: string,
    contractId: string,
    dto: ExtractContractTermsDto,
    userId?: string,
  ) {
    const contract = await this.getContract(businessId, contractId);

    const request = await this.buildExtractionRequest(businessId, dto);
    const result = await this.docIntel.extractFromDocument(request);

    if (result.documentType !== 'contract' || !result.contractData) {
      throw new BadRequestException('Document does not appear to be a contract or extraction failed');
    }

    await this.applyExtractionResult(businessId, contract.id, result, userId);
    return this.getContract(businessId, contract.id);
  }

  private async buildExtractionRequest(
    businessId: string,
    dto: ExtractContractTermsDto,
  ): Promise<Parameters<DocumentIntelligenceService['extractFromDocument']>[0]> {
    if (dto.url || dto.base64Content) {
      if (!dto.mimeType || !dto.filename) {
        throw new BadRequestException('mimeType and filename are required when providing raw document content');
      }
      return {
        businessId,
        source: 'contract_registry',
        mimeType: dto.mimeType,
        filename: dto.filename,
        url: dto.url,
        base64Content: dto.base64Content,
      };
    }

    if (dto.sourceAssetId) {
      const asset = await this.prisma.client.asset.findFirst({ where: { id: dto.sourceAssetId, businessId } });
      if (!asset) throw new NotFoundException('Source asset not found');
      return {
        businessId,
        source: 'asset',
        mimeType: asset.mimeType ?? 'application/octet-stream',
        filename: asset.name,
        url: asset.url,
      };
    }

    if (dto.sourceDocumentInstanceId) {
      const instance = await this.prisma.client.documentInstance.findFirst({
        where: { id: dto.sourceDocumentInstanceId, businessId },
      });
      if (!instance) throw new NotFoundException('Source document instance not found');
      return {
        businessId,
        source: 'document_instance',
        mimeType: 'application/pdf',
        filename: instance.title,
      };
    }

    if (dto.sourceDriveFileId) {
      const file = await this.prisma.client.driveIntakeFile.findFirst({
        where: { driveFileId: dto.sourceDriveFileId, businessId },
      });
      if (!file) throw new NotFoundException('Source drive file not found');
      return {
        businessId,
        source: 'google_drive',
        mimeType: file.mimeType ?? 'application/pdf',
        filename: file.name,
        url: file.webViewLink ?? undefined,
      };
    }

    throw new BadRequestException('No document source provided');
  }

  async applyExtractionResult(
    businessId: string,
    contractId: string,
    result: DocumentExtractionResult,
    userId?: string,
  ) {
    const data = result.contractData;
    if (!data) return;

    const contract = await this.prisma.client.contract.findFirst({
      where: { id: contractId, businessId },
      include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
    });
    if (!contract) throw new NotFoundException('Contract not found');

    const nextVersion = (contract.versions[0]?.versionNumber ?? 0) + 1;

    await this.prisma.client.$transaction(async (tx) => {
      await tx.contract.update({
        where: { id: contractId },
        data: {
          ...(data.contractType && { contractType: data.contractType }),
          ...(data.effectiveDate && { effectiveDate: new Date(data.effectiveDate) }),
          ...(data.expiryDate && { expiryDate: new Date(data.expiryDate) }),
          ...(data.renewalDate && { renewalDate: new Date(data.renewalDate) }),
          ...(data.renewalType && { renewalType: data.renewalType }),
          ...(data.renewalNoticeDays !== undefined && { renewalNoticeDays: data.renewalNoticeDays }),
          ...(data.contractValue !== undefined && { contractValue: data.contractValue }),
          ...(data.currency && { currency: data.currency }),
          ...(data.jurisdiction && { jurisdiction: data.jurisdiction }),
        },
      });

      // Replace extracted terms
      await tx.contractTerm.deleteMany({ where: { contractId } });
      const terms: Array<{ termKey: string; termValue: string; sourceText?: string; confidence: number }> = [];
      if (data.termLength) terms.push({ termKey: 'term_length', termValue: data.termLength, confidence: data.confidence });
      if (data.renewalClause) terms.push({ termKey: 'renewal_clause', termValue: data.renewalClause, confidence: data.confidence });
      if (data.terminationClause) terms.push({ termKey: 'termination_clause', termValue: data.terminationClause, confidence: data.confidence });
      if (data.paymentTerms) terms.push({ termKey: 'payment_terms', termValue: data.paymentTerms, confidence: data.confidence });
      if (data.liabilityCap) terms.push({ termKey: 'liability_cap', termValue: data.liabilityCap, confidence: data.confidence });
      if (data.governingLaw) terms.push({ termKey: 'governing_law', termValue: data.governingLaw, confidence: data.confidence });
      if (data.keyClauses?.length) {
        terms.push({
          termKey: 'key_clauses',
          termValue: data.keyClauses.join('\n'),
          sourceText: data.rawText?.slice(0, 2000),
          confidence: data.confidence,
        });
      }
      for (const custom of data.customTerms ?? []) {
        terms.push({
          termKey: custom.key,
          termValue: custom.value,
          sourceText: custom.sourceText,
          confidence: custom.confidence ?? data.confidence,
        });
      }

      if (terms.length) {
        await tx.contractTerm.createMany({
          data: terms.map((t) => ({
            businessId,
            contractId,
            termKey: t.termKey,
            termValue: t.termValue,
            sourceText: t.sourceText ?? data.rawText?.slice(0, 2000) ?? null,
            confidence: t.confidence,
          })),
        });
      }

      // Sync parties from extraction
      if (data.parties?.length) {
        await tx.contractParty.deleteMany({ where: { contractId } });
        await tx.contractParty.createMany({
          data: data.parties.map((p) => ({
            businessId,
            contractId,
            role: p.role ?? 'other',
            name: p.name,
            email: p.email,
            phone: p.phone,
            address: p.address,
            notes: p.notes,
            contactId: p.contactId,
          })),
        });
      }

      await tx.contractVersion.create({
        data: {
          businessId,
          contractId,
          versionNumber: nextVersion,
          changeSummary: `AI extraction: ${terms.length} term(s), ${data.parties?.length ?? 0} party(s)`,
          fileName: result.filename,
          createdBy: userId,
        },
      });
    });

    await this.regenerateAlerts(businessId, contractId);
  }

  @OnEvent('document.extracted')
  async handleDocumentExtracted(payload: {
    businessId: string;
    source: string;
    filename: string;
    result: DocumentExtractionResult;
  }) {
    if (payload.result.documentType !== 'contract' || !payload.result.contractData) return;

    // Auto-create a contract record if none is linked by source.
    const sourceId = payload.result.sourceId;
    if (!sourceId) return;

    const existing = await this.prisma.client.contract.findFirst({
      where: {
        businessId: payload.businessId,
        OR: [
          { sourceAssetId: sourceId },
          { sourceDocumentInstanceId: sourceId },
          { sourceDriveFileId: sourceId },
        ],
      },
    });
    if (existing) {
      await this.applyExtractionResult(payload.businessId, existing.id, payload.result);
      return;
    }

    const contract = await this.prisma.client.contract.create({
      data: {
        businessId: payload.businessId,
        title: payload.filename,
        status: 'DRAFT',
        ...(payload.result.contractData.sourceAssetId && { sourceAssetId: payload.result.contractData.sourceAssetId }),
        ...(payload.result.contractData.sourceDocumentInstanceId && {
          sourceDocumentInstanceId: payload.result.contractData.sourceDocumentInstanceId,
        }),
        ...(payload.result.contractData.sourceDriveFileId && {
          sourceDriveFileId: payload.result.contractData.sourceDriveFileId,
        }),
      },
    });

    await this.applyExtractionResult(payload.businessId, contract.id, payload.result);
  }

  async regenerateAlerts(businessId: string, contractId: string) {
    const contract = await this.prisma.client.contract.findFirst({
      where: { id: contractId, businessId },
      include: { alerts: true },
    });
    if (!contract) return;

    const now = new Date();
    const alerts: Array<{ alertType: ContractAlertType; dueDate: Date }> = [];

    if (contract.expiryDate) {
      const expiry = new Date(contract.expiryDate);
      const days = Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (days < 0) {
        alerts.push({ alertType: 'EXPIRED', dueDate: expiry });
      } else {
        if (days <= 30) alerts.push({ alertType: 'EXPIRY_30', dueDate: expiry });
        if (days <= 7) alerts.push({ alertType: 'EXPIRY_7', dueDate: expiry });
        if (days <= 1) alerts.push({ alertType: 'EXPIRY_1', dueDate: expiry });
      }
    }

    if (contract.renewalDate) {
      const renewal = new Date(contract.renewalDate);
      if (renewal > now) {
        alerts.push({ alertType: 'RENEWAL_DUE', dueDate: renewal });
      }
    }

    await this.prisma.client.$transaction(async (tx) => {
      await tx.contractAlert.deleteMany({ where: { contractId } });
      if (alerts.length) {
        await tx.contractAlert.createMany({
          data: alerts.map((a) => ({ businessId, contractId, alertType: a.alertType, dueDate: a.dueDate })),
        });
      }
    });
  }

  async acknowledgeAlert(businessId: string, alertId: string, userId?: string) {
    const alert = await this.prisma.client.contractAlert.findFirst({ where: { id: alertId, businessId } });
    if (!alert) throw new NotFoundException('Alert not found');
    return this.prisma.client.contractAlert.update({
      where: { id: alertId },
      data: { acknowledgedAt: new Date(), acknowledgedBy: userId },
    });
  }

  async getStats(businessId: string): Promise<ContractStats> {
    const [counts, expiringSoon, renewalDue, expired, alertCount] = await Promise.all([
      this.prisma.client.contract.groupBy({ by: ['status'], where: { businessId }, _count: { status: true } }),
      this.prisma.client.contract.count({
        where: {
          businessId,
          status: { in: ['ACTIVE', 'RENEWAL_DUE'] },
          expiryDate: { lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), gte: new Date() },
        },
      }),
      this.prisma.client.contract.count({ where: { businessId, status: 'RENEWAL_DUE' } }),
      this.prisma.client.contract.count({ where: { businessId, status: 'EXPIRED' } }),
      this.prisma.client.contractAlert.count({ where: { businessId, acknowledgedAt: null } }),
    ]);

    const byStatus: Record<string, number> = {};
    for (const c of counts) byStatus[c.status] = c._count.status;

    return {
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      byStatus,
      expiringSoon,
      renewalDue,
      expired,
      alertCount,
    };
  }

  // Tag helpers
  async listTags(businessId: string) {
    return this.prisma.client.contractTag.findMany({ where: { businessId }, orderBy: { name: 'asc' } });
  }

  async createTag(businessId: string, name: string, color?: string) {
    return this.prisma.client.contractTag.create({
      data: { businessId, name, color },
    });
  }

  async deleteTag(businessId: string, tagId: string) {
    await this.prisma.client.contractTag.deleteMany({ where: { id: tagId, businessId } });
    return { deleted: true };
  }
}
