import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../../core/prisma/prisma.service';
import { DocumentParsingService } from '../ingestion/document-parsing.service';
import { AiUsageService } from '../ai/ai-usage.service';

/** The 41 CUAD clause labels (Contract Understanding Atticus Dataset). */
export const CUAD_LABELS = [
  'Document Name', 'Parties', 'Agreement Date', 'Effective Date', 'Expiration Date',
  'Renewal Term', 'Notice Period To Terminate Renewal', 'Governing Law', 'Most Favored Nation',
  'Non-Compete', 'Exclusivity', 'No-Solicit Of Customers', 'No-Solicit Of Employees',
  'Non-Disparagement', 'Termination For Convenience', 'Right Of First Refusal',
  'Right Of First Offer', 'Right Of First Negotiation', 'Change Of Control',
  'Anti-Assignment', 'Revenue/Profit Sharing', 'Price Restrictions', 'Minimum Commitment',
  'Volume Restriction', 'IP Ownership Assignment', 'Joint IP Ownership', 'License Grant',
  'Non-Transferable License', 'Affiliate License-License', 'Affiliate License-IP',
  'Unlimited/All-You-Can-Eat-License', 'Irrevocable Or Perpetual License', 'Source Code Escrow',
  'Post-Termination Services', 'Cap On Liability', 'Liquidated Damages',
  'Warranty Duration', 'Insurance', 'Indemnification', 'Indemnification Of IP Claims',
  'Limitation Of Liability', 'Covenant Not To Sue',
] as const;

export interface ClauseFinding {
  label: string;
  present: boolean;
  summary?: string;
  sourceText?: string;
  importance?: 'standard' | 'notable' | 'critical';
  confidence?: number;
}

export interface ClauseAnalysisResult {
  analyzedAt: string;
  source: string;
  total: number;
  present: ClauseFinding[];
  notableAbsent: string[];
  clauses: ClauseFinding[];
}

/**
 * W11-DISPATCH-REFUSAL-FINAL review SEC-1, COR-1 (owner ruling D-134): the cause on the 400
 * extractClauses answers when the host of the contract's document did not answer (5xx, 408, 429).
 * The 400 is what it always was (same status, message and body; a cause is not serialized). KEY's
 * contract_extract_clauses, this service's only caller, reads the cause to hand its plan queue a
 * failure worth retrying instead of a final refusal.
 */
export class DocumentHostUnavailableError extends Error {
  constructor(readonly hostStatus: number) {
    super(`The document host answered ${hostStatus}`);
    this.name = 'DocumentHostUnavailableError';
  }
}

function isDocumentHostOutage(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

/**
 * CUAD-style contract clause extraction on top of the Docling parse layer:
 * contract source -> parsed markdown -> GPT-4o with the 41-label checklist as
 * a structured checklist -> persisted on the contract record. Output always
 * routes through human review (contract stays in `reviewing` flows) — zero-shot
 * clause extraction is advisory, not authoritative.
 */
@Injectable()
export class ContractClauseService {
  private readonly logger = new Logger(ContractClauseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleRef: ModuleRef,
  ) {}

  private getDocling() {
    return this.moduleRef.get(DocumentParsingService, { strict: false });
  }
  private getAiUsage() {
    return this.moduleRef.get(AiUsageService, { strict: false });
  }

  async extractClauses(
    businessId: string,
    contractId: string,
    opts: { url?: string; base64Content?: string; mimeType?: string; filename?: string },
  ): Promise<ClauseAnalysisResult> {
    const contract = await this.prisma.client.contract.findFirst({
      where: { id: contractId, businessId },
    });
    if (!contract) throw new NotFoundException('Contract not found');

    const { buffer, mimeType, filename, source, hostOutage } = await this.resolveBytes(businessId, contract, opts);
    if (!buffer) {
      throw new BadRequestException(
        'No source document available for this contract (upload one or link an asset/document)',
        hostOutage ? { cause: new DocumentHostUnavailableError(hostOutage), description: 'Bad Request' } : undefined,
      );
    }

    const parsed = await this.getDocling().parse(buffer, filename, mimeType);
    const text = parsed?.markdown ?? buffer.toString('utf8');
    if (!text.trim()) {
      throw new BadRequestException('Could not extract any text from the source document');
    }

    const prompt = this.buildClausePrompt(text.slice(0, 14000), contract.title ?? filename);
    const response = await this.getAiUsage().trackAndComplete(
      businessId,
      undefined,
      'contract_clause_extract',
      {
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: 'Analyze the contract against the checklist and respond with the JSON object only.' },
        ],
        maxTokens: 3000,
        temperature: 0,
      } as never,
    );

    const findings = this.parseFindings(String(response.content ?? ''));
    const result: ClauseAnalysisResult = {
      analyzedAt: new Date().toISOString(),
      source,
      total: findings.length,
      present: findings.filter((c) => c.present),
      notableAbsent: findings.filter((c) => !c.present && (c.importance === 'notable' || c.importance === 'critical')).map((c) => c.label),
      clauses: findings,
    };

    await this.prisma.client.contract.update({
      where: { id: contract.id },
      data: { clauseAnalysis: result as unknown as object },
    });

    return result;
  }

  private async resolveBytes(
    businessId: string,
    contract: { sourceAssetId?: string | null; sourceDocumentInstanceId?: string | null; sourceDriveFileId?: string | null; title?: string | null },
    opts: { url?: string; base64Content?: string; mimeType?: string; filename?: string },
  ): Promise<{ buffer: Buffer | null; mimeType: string; filename: string; source: string; hostOutage?: number }> {
    if (opts.base64Content) {
      return {
        buffer: Buffer.from(opts.base64Content, 'base64'),
        mimeType: opts.mimeType ?? 'application/pdf',
        filename: opts.filename ?? 'contract.pdf',
        source: 'upload',
      };
    }
    if (opts.url) {
      const res = await fetch(opts.url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) {
        throw new BadRequestException(
          `Could not fetch document URL (${res.status})`,
          isDocumentHostOutage(res.status) ? { cause: new DocumentHostUnavailableError(res.status), description: 'Bad Request' } : undefined,
        );
      }
      return {
        buffer: Buffer.from(await res.arrayBuffer()),
        mimeType: res.headers.get('content-type') ?? 'application/pdf',
        filename: opts.filename ?? 'contract.pdf',
        source: 'url',
      };
    }

    if (contract.sourceAssetId) {
      const asset = await this.prisma.client.asset.findFirst({ where: { id: contract.sourceAssetId, businessId } });
      if (asset?.url && asset.url.startsWith('http')) {
        const res = await fetch(asset.url, { signal: AbortSignal.timeout(30_000) });
        if (res.ok) {
          return {
            buffer: Buffer.from(await res.arrayBuffer()),
            mimeType: asset.mimeType ?? 'application/pdf',
            filename: asset.name ?? 'asset',
            source: 'asset',
          };
        }
        // W11-DISPATCH-REFUSAL-FINAL review COR-1 (D-134): the asset's host did not answer (5xx, 408,
        // 429). What extractClauses answers is unchanged (its 400 'No source document available');
        // the host's status rides on it as its cause, so KEY's plan queue can tell an outage from a
        // contract that has no document and retry it (flow-orchestrator's contract_extract_clauses).
        if (isDocumentHostOutage(res.status)) {
          return { buffer: null, mimeType: 'application/pdf', filename: 'contract.pdf', source: 'none', hostOutage: res.status };
        }
      }
    }

    return { buffer: null, mimeType: 'application/pdf', filename: 'contract.pdf', source: 'none' };
  }

  private buildClausePrompt(contractText: string, title: string): string {
    return `You are a contract analysis engine. Analyze the contract below against this exact 41-label checklist (CUAD taxonomy):
${CUAD_LABELS.map((l, i) => `${i + 1}. ${l}`).join('\n')}

Rules:
- For EVERY label, decide present: true/false.
- When present, add a one-sentence summary, the closest sourceText snippet (max 200 chars), and importance (standard|notable|critical).
- When absent, include only the label and importance (mark critical only for clauses whose absence is a material risk: Indemnification, Cap On Liability, Limitation Of Liability, Termination For Convenience, Governing Law, IP Ownership Assignment, License Grant, Insurance).
- confidence: 0.0-1.0 per finding.
- Respond ONLY with valid JSON: {"clauses": [{"label": "...", "present": true|false, "summary": "...", "sourceText": "...", "importance": "...", "confidence": 0.0}]}

CONTRACT (${title}):
"""
${contractText}
"""`;
  }

  private parseFindings(raw: string): ClauseFinding[] {
    try {
      const cleaned = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start === -1 || end === -1) return [];
      const parsed = JSON.parse(cleaned.slice(start, end + 1)) as { clauses?: ClauseFinding[] };
      if (!Array.isArray(parsed.clauses)) return [];
      return parsed.clauses.filter((c) => typeof c?.label === 'string');
    } catch (err) {
      this.logger.warn(`Clause JSON parse failed: ${(err as Error).message}`);
      return [];
    }
  }
}
