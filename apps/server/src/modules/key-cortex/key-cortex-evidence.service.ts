import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { Evidence, EvidenceClaimType } from '@prisma/client';
import { createHash } from 'crypto';

/**
 * KeyCortexEvidenceService — Proof of Work Completion
 *
 * Evidence provides tamper-proof proof that work was completed. Each piece
 * of evidence carries a SHA-256 hash of its proof payload, enabling
 * integrity verification at any time. Evidence that contributes to DNA
 * feeds the genome evolution engine.
 *
 * Design principles:
 *   1. Every significant claim about work done requires evidence
 *   2. Evidence is cryptographically hashed for tamper detection
 *   3. DNA-contributing evidence drives genome score evolution
 *   4. Confidence scores indicate evidence quality
 *   5. Cross-references link evidence to related modules and entities
 */
@Injectable()
export class KeyCortexEvidenceService {
  private readonly logger = new Logger(KeyCortexEvidenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create evidence for a claim. The proof payload is hashed with SHA-256
   * for tamper detection. If the proof changes later, the integrity check
   * will fail.
   *
   * When contributesToDna=true, this evidence will be used by the genome
   * engine to update DNA section scores.
   */
  async createEvidence(params: {
    businessId: string;
    claim: string;
    claimType: EvidenceClaimType;
    proof: Record<string, unknown>;
    confidence: number;
    source: string;
    sourceEventId?: string;
    relatedModule: string;
    relatedEntityId?: string;
    contributesToDna?: boolean;
    dnaSection?: string;
  }): Promise<Evidence> {
    const proofHash = this.hashProof(params.proof);

    const evidence = await (this.prisma.client as any).evidence.create({
      data: {
        businessId: params.businessId,
        claim: params.claim,
        claimType: params.claimType,
        proof: params.proof as never,
        proofHash,
        confidence: params.confidence,
        source: params.source,
        sourceEventId: params.sourceEventId,
        relatedModule: params.relatedModule,
        relatedEntityId: params.relatedEntityId,
        contributesToDna: params.contributesToDna ?? false,
        dnaSection: params.dnaSection,
        verified: false,
      },
    });

    this.logger.debug(
      `[Evidence] ${params.claimType}: ${params.claim} (${params.confidence} confidence)`,
    );
    return evidence;
  }

  /**
   * Verify evidence. Once verified, the evidence's claim is considered
   * proven and can be used for DNA evolution and reporting.
   */
  async verifyEvidence(
    evidenceId: string,
    params: {
      verifiedBy: string;
      verificationMethod: string;
    },
  ): Promise<Evidence> {
    const updated = await (this.prisma.client as any).evidence.update({
      where: { id: evidenceId },
      data: {
        verified: true,
        verifiedBy: params.verifiedBy,
        verificationMethod: params.verificationMethod,
        verifiedAt: new Date(),
      },
    });

    this.logger.log(
      `[Evidence] Verified ${updated.claimType} (${updated.id}) by ${params.verifiedBy}`,
    );
    return updated;
  }

  /**
   * Batch verify multiple pieces of evidence. Used when automated
   * verification confirms a batch of claims at once.
   */
  async batchVerify(
    evidenceIds: string[],
    params: {
      verifiedBy: string;
      verificationMethod: string;
    },
  ): Promise<number> {
    const result = await (this.prisma.client as any).evidence.updateMany({
      where: { id: { in: evidenceIds } },
      data: {
        verified: true,
        verifiedBy: params.verifiedBy,
        verificationMethod: params.verificationMethod,
        verifiedAt: new Date(),
      },
    });

    this.logger.log(
      `[Evidence] Batch verified ${result.count} items by ${params.verifiedBy}`,
    );
    return result.count;
  }

  /**
   * Find evidence with flexible filtering.
   */
  async findEvidence(
    businessId: string,
    filters: {
      claimType?: EvidenceClaimType;
      relatedModule?: string;
      relatedEntityId?: string;
      verified?: boolean;
      limit?: number;
    } = {},
  ): Promise<Evidence[]> {
    return (this.prisma.client as any).evidence.findMany({
      where: { businessId, ...filters },
      orderBy: { createdAt: 'desc' },
      take: filters.limit ?? 50,
    });
  }

  /**
   * Get evidence that contributes to the business genome DNA.
   * Optionally filter by DNA section (marketing, sales, operations, etc.)
   */
  async getDnaEvidence(
    businessId: string,
    dnaSection?: string,
  ): Promise<Evidence[]> {
    const where: Record<string, unknown> = {
      businessId,
      contributesToDna: true,
    };
    if (dnaSection) where.dnaSection = dnaSection;
    return (this.prisma.client as any).evidence.findMany({
      where,
      orderBy: { confidence: 'desc' },
    });
  }

  /**
   * Verify the cryptographic integrity of evidence.
   * Compares the stored SHA-256 hash against a fresh hash of the
   * current proof payload. Returns false if the proof was tampered with.
   */
  async verifyIntegrity(
    evidenceId: string,
  ): Promise<{
    valid: boolean;
    currentHash: string;
    storedHash: string;
  }> {
    const evidence = await (this.prisma.client as any).evidence.findUnique({
      where: { id: evidenceId },
    });
    if (!evidence) throw new Error('Evidence not found');

    const currentHash = this.hashProof(
      evidence.proof as Record<string, unknown>,
    );
    const storedHash = evidence.proofHash ?? '';
    return { valid: currentHash === storedHash, currentHash, storedHash };
  }

  /**
   * Batch integrity check for multiple evidence items.
   * Returns items where the proof hash doesn't match (potential tampering).
   */
  async batchVerifyIntegrity(
    evidenceIds: string[],
  ): Promise<
    Array<{
      evidenceId: string;
      valid: boolean;
      currentHash: string;
      storedHash: string;
    }>
  > {
    const results = [];
    for (const id of evidenceIds) {
      try {
        const result = await this.verifyIntegrity(id);
        results.push({ evidenceId: id, ...result });
      } catch {
        results.push({
          evidenceId: id,
          valid: false,
          currentHash: '',
          storedHash: '',
        });
      }
    }
    return results;
  }

  /**
   * Private: compute SHA-256 hash of a proof payload.
   * The payload is canonicalized by sorting keys before hashing
   * to ensure deterministic results.
   */
  private hashProof(proof: Record<string, unknown>): string {
    const canonical = JSON.stringify(proof, Object.keys(proof).sort());
    return createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * Aggregate DNA-contributing evidence by section.
   * Returns count, average confidence, and latest timestamp for each
   * DNA section. Used by the genome engine to compute evolution signals.
   */
  async aggregateForGenome(
    businessId: string,
  ): Promise<
    Record<
      string,
      { count: number; avgConfidence: number; latest: Date }
    >
  > {
    const evidence = await (this.prisma.client as any).evidence.groupBy({
      by: ['dnaSection'],
      where: { businessId, contributesToDna: true },
      _count: true,
      _avg: { confidence: true },
      _max: { createdAt: true },
    });

    return Object.fromEntries(
      evidence.map((e: any) => [
        e.dnaSection ?? 'general',
        {
          count: e._count,
          avgConfidence: e._avg.confidence ?? 0,
          latest: e._max.createdAt,
        },
      ]),
    );
  }

  /**
   * Get evidence statistics for a business.
   * Returns counts by claim type and verification status.
   */
  async getStats(businessId: string): Promise<{
    total: number;
    verified: number;
    unverified: number;
    dnaContributing: number;
    byType: Record<string, number>;
  }> {
    const [total, verified, dnaContributing, byType] = await Promise.all([
      (this.prisma.client as any).evidence.count({ where: { businessId } }),
      (this.prisma.client as any).evidence.count({
        where: { businessId, verified: true },
      }),
      (this.prisma.client as any).evidence.count({
        where: { businessId, contributesToDna: true },
      }),
      (this.prisma.client as any).evidence.groupBy({
        by: ['claimType'],
        where: { businessId },
        _count: true,
      }),
    ]);

    return {
      total,
      verified,
      unverified: total - verified,
      dnaContributing,
      byType: Object.fromEntries(
        byType.map((t: any) => [t.claimType, t._count]),
      ),
    };
  }

  /**
   * Create evidence for a completed task. Convenience wrapper that
   * sets the claim type to TASK_COMPLETED.
   */
  async createTaskEvidence(params: {
    businessId: string;
    taskId: string;
    taskType: string;
    result: Record<string, unknown>;
    confidence: number;
    source: string;
    relatedModule: string;
    contributesToDna?: boolean;
    dnaSection?: string;
  }): Promise<Evidence> {
    return this.createEvidence({
      businessId: params.businessId,
      claim: `Task ${params.taskType} (${params.taskId}) completed`,
      claimType: EvidenceClaimType.TASK_COMPLETED,
      proof: {
        taskId: params.taskId,
        taskType: params.taskType,
        result: params.result,
      },
      confidence: params.confidence,
      source: params.source,
      relatedModule: params.relatedModule,
      contributesToDna: params.contributesToDna,
      dnaSection: params.dnaSection,
    });
  }

  /**
   * Create evidence for an invoice collection. Convenience wrapper
   * that sets the claim type to INVOICE_COLLECTED.
   */
  async createInvoiceEvidence(params: {
    businessId: string;
    invoiceId: string;
    amount: number;
    paymentDate: string;
    confidence: number;
    source: string;
  }): Promise<Evidence> {
    return this.createEvidence({
      businessId: params.businessId,
      claim: `Invoice #${params.invoiceId} collected ($${params.amount})`,
      claimType: EvidenceClaimType.INVOICE_COLLECTED,
      proof: {
        invoiceId: params.invoiceId,
        amount: params.amount,
        paymentDate: params.paymentDate,
      },
      confidence: params.confidence,
      source: params.source,
      relatedModule: 'commerce',
      relatedEntityId: params.invoiceId,
      contributesToDna: true,
      dnaSection: 'sales',
    });
  }
}
