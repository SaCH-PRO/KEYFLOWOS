import { Injectable, Logger, Inject, BadRequestException, Optional } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { BlueprintService } from '../blueprint/blueprint.service';
import { ModelGatewayService, type GatewayMessage } from '../ai/model-gateway.service';
import type { DnaSectionKey, GenomeIntegrityResult } from '../blueprint/blueprint.types';
import { GenomeFactService } from '../business-genome/key-genome/genome-fact.service';
import { GenomeEvidenceService } from '../business-genome/key-genome/genome-evidence.service';
import { DNA_TO_KEY_GENOME_SECTION } from '../business-genome/key-genome/key-genome.service';
import {
  genomeIntegrityForReader,
  isServedDnaKey,
  type ProjectedGenome,
} from '../business-genome/key-genome/genome-composites-for-reader';
import {
  isMoneyLabel,
  proposalTextStatesMoney,
  structuredValueStatesMoney,
} from '../business-genome/key-genome/genome-finance-scope';

export interface GenomeChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface ProposedGenomeUpdate {
  section: DnaSectionKey;
  data: Record<string, unknown>;
  summary: string;
  messageId?: string;
  confidence?: number;
  source?: string;
}

export interface ApplyGenomeUpdateOptions {
  messageId?: string;
  confidence?: number;
  source?: string;
}

export interface SendGenomeMessageResult {
  message: GenomeChatMessage;
  proposedUpdates: ProposedGenomeUpdate | null;
}

@Injectable()
export class GenomeChatService {
  private readonly logger = new Logger(GenomeChatService.name);
  private readonly maxHistory = 20;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BlueprintService) private readonly blueprint: BlueprintService,
    @Inject(ModelGatewayService) private readonly gateway: ModelGatewayService,
    @Optional()
    @Inject(GenomeFactService)
    private readonly genomeFactService?: GenomeFactService,
    @Optional()
    @Inject(GenomeEvidenceService)
    private readonly genomeEvidenceService?: GenomeEvidenceService,
  ) {}

  async getMessages(
    businessId: string,
    options: { limit?: number; cursor?: string; readsRevenue?: boolean } = {},
  ): Promise<GenomeChatMessage[]> {
    const limit = Math.min(options.limit ?? 50, 100);
    const readsRevenue = options.readsRevenue !== false;
    const rows = await this.prisma.client.genomeChatMessage.findMany({
      where: { businessId },
      ...(readsRevenue ? { take: limit } : {}),
      cursor: options.cursor ? { id: options.cursor } : undefined,
      orderBy: { createdAt: 'desc' },
    });

    const mapped: GenomeChatMessage[] = rows.map((row) => ({
      id: row.id,
      role: row.role as 'user' | 'assistant' | 'system',
      content: row.content,
      metadata: (row.metadata as Record<string, unknown>) || undefined,
      createdAt: row.createdAt,
    }));

    if (readsRevenue) {
      return mapped.reverse();
    }

    const projected: GenomeChatMessage[] = [];
    for (const msg of mapped) {
      const cleaned = this.projectMessageForNonRevenueReader(msg);
      if (cleaned) projected.push(cleaned);
      if (projected.length >= limit) break;
    }
    return projected.reverse();
  }

  private projectMessageForNonRevenueReader(msg: GenomeChatMessage): GenomeChatMessage | null {
    const meta = msg.metadata;
    if (meta && typeof meta === 'object') {
      if (meta.moneyOnly === true) {
        return null;
      }
      const appliedSection = meta.appliedSection;
      if (typeof appliedSection === 'string' && !isServedDnaKey(appliedSection)) {
        return null;
      }
      const proposed = meta.proposedUpdates;
      if (proposed && typeof proposed === 'object' && !Array.isArray(proposed)) {
        const proposedRec = proposed as { section?: unknown; summary?: unknown };
        if (typeof proposedRec.section === 'string' && !isServedDnaKey(proposedRec.section)) {
          return null;
        }
        if (typeof proposedRec.summary === 'string' && proposalTextStatesMoney(proposedRec.summary)) {
          return null;
        }
      }
    }

    let content = msg.content;
    // Strip composite prose (Genome Integrity, Executive Readiness, Genome Stage) from legacy or assistant messages.
    content = content
      .replace(/\s*(?:Genome Integrity|Executive Readiness|Genome Stage)[^.]*\.?/gi, '')
      .trim();

    // System messages: drop money sections, and scrub money field names from mixed served sections (e.g. risk.financialRisks).
    if (msg.role === 'system') {
      const sectionMatch = /^Updated\s+([a-z_]+)\s+DNA(?:\s*:\s*([^.]+))?\.?/i.exec(content);
      if (sectionMatch) {
        const sec = sectionMatch[1];
        if (!isServedDnaKey(sec)) {
          return null;
        }
        if (sectionMatch[2]) {
          const rawFields = sectionMatch[2]
            .split(',')
            .map((f) => f.trim())
            .filter(Boolean);
          const safeFields = rawFields.filter((f) => !isMoneyLabel(f) && !proposalTextStatesMoney(f));
          if (rawFields.length > 0 && safeFields.length === 0) {
            return null;
          }
          const rest = content.slice(sectionMatch[0].length).trim();
          const prefix =
            safeFields.length > 0 ? `Updated ${sec} DNA: ${safeFields.join(', ')}.` : `Updated ${sec} DNA.`;
          content = rest ? `${prefix} ${rest}` : prefix;
        }
      }
    }

    // R1-SEC-02: withhold user/assistant/system messages whose remaining prose states money.
    if (proposalTextStatesMoney(content)) {
      return null;
    }

    let nextMeta = meta;
    if (meta && typeof meta === 'object') {
      const copy: Record<string, unknown> = { ...meta };
      if (copy.appliedData && typeof copy.appliedData === 'object' && !Array.isArray(copy.appliedData)) {
        const cleanedData: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(copy.appliedData as Record<string, unknown>)) {
          if (isMoneyLabel(k) || proposalTextStatesMoney(k) || structuredValueStatesMoney(v)) continue;
          cleanedData[k] = v;
        }
        copy.appliedData = cleanedData;
      }
      if (
        copy.proposedUpdates &&
        typeof copy.proposedUpdates === 'object' &&
        !Array.isArray(copy.proposedUpdates)
      ) {
        const pu = { ...(copy.proposedUpdates as Record<string, unknown>) };
        if (pu.data && typeof pu.data === 'object' && !Array.isArray(pu.data)) {
          const cleanedData: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(pu.data as Record<string, unknown>)) {
            if (isMoneyLabel(k) || proposalTextStatesMoney(k) || structuredValueStatesMoney(v)) continue;
            cleanedData[k] = v;
          }
          pu.data = cleanedData;
        }
        copy.proposedUpdates = pu;
      }
      nextMeta = copy;
    }

    return { ...msg, content, metadata: nextMeta };
  }

  private sanitizeProposedUpdatesForNonRevenueReader(
    proposed: ProposedGenomeUpdate | null,
  ): ProposedGenomeUpdate | null {
    if (!proposed) return null;
    if (!isServedDnaKey(proposed.section)) return null;
    if (proposalTextStatesMoney(proposed.summary)) return null;
    const cleanedData: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(proposed.data)) {
      if (isMoneyLabel(k) || proposalTextStatesMoney(k) || structuredValueStatesMoney(v)) continue;
      cleanedData[k] = v;
    }
    if (Object.keys(cleanedData).length === 0) return null;
    return { ...proposed, data: cleanedData };
  }

  async sendMessage(
    businessId: string,
    userId: string,
    content: string,
    options: { readsRevenue?: boolean } = {},
  ): Promise<SendGenomeMessageResult> {
    const readsRevenue = options.readsRevenue !== false;
    await this.persistMessage(businessId, 'user', content);

    const [history, rawGenome] = await Promise.all([
      this.getRecentHistory(businessId, readsRevenue),
      this.blueprint.calculateGenomeIntegrity(businessId),
    ]);

    const genome = genomeIntegrityForReader(rawGenome, readsRevenue);
    const messages = this.buildPrompt(genome, history, content, readsRevenue);

    let assistantContent: string;
    try {
      const response = await this.gateway.complete({
        businessId,
        taskCategory: 'extraction',
        messages,
        temperature: 0.4,
        maxTokens: 2048,
      });
      assistantContent = response.content ?? 'I\'m not sure how to respond to that. Could you rephrase?';
    } catch (err: any) {
      this.logger.warn(`Genome Chat AI call failed for ${businessId}: ${(err as Error).message}`);
      assistantContent = 'KEY is having trouble thinking right now. Please try again in a moment.';
    }

    const { displayContent: rawDisplayContent, proposedUpdates: rawProposed } =
      this.extractProposedUpdates(assistantContent);
    const proposedUpdates = readsRevenue
      ? rawProposed
      : this.sanitizeProposedUpdatesForNonRevenueReader(rawProposed);
    const displayContent = readsRevenue
      ? rawDisplayContent
      : rawDisplayContent
          .replace(/\s*(?:Genome Integrity|Executive Readiness|Genome Stage)[^.]*\.?/gi, '')
          .trim();

    const message = await this.persistMessage(
      businessId,
      'assistant',
      displayContent,
      proposedUpdates ? { proposedUpdates } : undefined,
    );

    if (proposedUpdates) {
      proposedUpdates.messageId = message.id;
    }

    return { message, proposedUpdates };
  }

  async applyUpdates(
    businessId: string,
    userId: string,
    section: DnaSectionKey,
    data: Record<string, unknown>,
    opts?: ApplyGenomeUpdateOptions,
  ): Promise<GenomeIntegrityResult> {
    await this.blueprint.updateDnaSection(businessId, section, data);
    const genome = await this.blueprint.calculateGenomeIntegrity(businessId);

    // SR-15, SR-17 & R1-SEC-02: never persist genome integrity % or money DNA values/fields (even inside
    // mixed served sections like `risk` containing `financialRisks`) in the shared chat history.
    if (isServedDnaKey(section)) {
      const safeData: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(data)) {
        if (isMoneyLabel(k) || proposalTextStatesMoney(k) || structuredValueStatesMoney(v)) continue;
        safeData[k] = v;
      }
      const safeFields = Object.keys(safeData);
      const moneyOnly = Object.keys(data).length > 0 && safeFields.length === 0;
      const summaryText =
        safeFields.length > 0 ? `Updated ${section} DNA: ${safeFields.join(', ')}.` : `Updated ${section} DNA.`;
      await this.persistMessage(businessId, 'system', summaryText, {
        appliedSection: section,
        ...(safeFields.length > 0 ? { appliedData: safeData } : {}),
        ...(moneyOnly ? { moneyOnly: true } : {}),
      });
    } else {
      const populatedFields = Object.keys(data).join(', ');
      await this.persistMessage(
        businessId,
        'system',
        `Updated ${section} DNA: ${populatedFields}.`,
        { appliedSection: section },
      );
    }

    await this.writeEvidenceBackedFacts(businessId, userId, section, data, opts);

    return genome;
  }

  private async writeEvidenceBackedFacts(
    businessId: string,
    userId: string,
    section: DnaSectionKey,
    data: Record<string, unknown>,
    opts?: ApplyGenomeUpdateOptions,
  ): Promise<void> {
    if (!this.genomeFactService || !this.genomeEvidenceService) {
      this.logger.debug(`Genome fact/evidence services unavailable; skipping chat fact sync`);
      return;
    }

    const keyGenomeSection = DNA_TO_KEY_GENOME_SECTION[section];
    if (!keyGenomeSection) {
      this.logger.warn(`No KEY Genome section mapping for DNA section ${section}`);
      return;
    }

    const confidence = opts?.confidence ?? 0.85;
    const sourceEntityId = opts?.messageId ?? userId;

    for (const [field, value] of Object.entries(data)) {
      if (value === undefined) continue;

      const fact = await this.genomeFactService.upsertFact({
        businessId,
        section: keyGenomeSection,
        domain: section,
        field,
        value: { raw: value, type: 'JSON' },
        sourceModule: 'genome_chat',
        sourceType: 'GENOME_CHAT',
        sourceEntityType: 'GenomeChatMessage',
        sourceEntityId,
        verificationStatus: 'USER_VERIFIED',
        confidenceScore: confidence,
      });

      await this.genomeEvidenceService.attachEvidence({
        businessId,
        factId: fact.id,
        sourceModule: 'genome_chat',
        sourceEntityType: 'GenomeChatMessage',
        sourceEntityId,
        summary: opts?.source
          ? `${opts.source} — ${section}.${field}: ${JSON.stringify(value).slice(0, 200)}`
          : `Genome chat update for ${section}.${field}: ${JSON.stringify(value).slice(0, 200)}`,
        evidenceStrength: confidence,
      });
    }
  }

  private async persistMessage(
    businessId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<GenomeChatMessage> {
    const row = await this.prisma.client.genomeChatMessage.create({
      data: {
        businessId,
        role,
        content,
        metadata: metadata ?? {},
      },
    });

    return {
      id: row.id,
      role: row.role as 'user' | 'assistant' | 'system',
      content: row.content,
      metadata: (row.metadata as Record<string, unknown>) || undefined,
      createdAt: row.createdAt,
    };
  }

  private async getRecentHistory(businessId: string, readsRevenue = true): Promise<GenomeChatMessage[]> {
    const rows = await this.prisma.client.genomeChatMessage.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      ...(readsRevenue ? { take: this.maxHistory } : {}),
    });

    const mapped: GenomeChatMessage[] = rows.map((row) => ({
      id: row.id,
      role: row.role as 'user' | 'assistant' | 'system',
      content: row.content,
      metadata: (row.metadata as Record<string, unknown>) || undefined,
      createdAt: row.createdAt,
    }));

    if (readsRevenue) {
      return mapped.reverse();
    }

    const projected: GenomeChatMessage[] = [];
    for (const msg of mapped) {
      const cleaned = this.projectMessageForNonRevenueReader(msg);
      if (cleaned) projected.push(cleaned);
      if (projected.length >= this.maxHistory) break;
    }
    return projected.reverse();
  }

  private buildPrompt(
    genome: GenomeIntegrityResult | ProjectedGenome<GenomeIntegrityResult>,
    history: GenomeChatMessage[],
    userMessage: string,
    readsRevenue = true,
  ): GatewayMessage[] {
    const sections = genome.dnaSections
      .map((s) => `- ${s.label}: ${s.integrity}% (${s.fieldsCaptured}/${s.fieldsTotal} fields)`)
      .join('\n');

    const weakest = [...genome.dnaSections]
      .filter((s) => s.integrity < 100)
      .sort((a, b) => a.integrity - b.integrity)[0];

    const compositeHeader =
      readsRevenue && genome.genomeIntegrity !== null && genome.genomeStage !== null
        ? `Current Genome Integrity: ${genome.genomeIntegrity}%\nStage: ${genome.genomeStage}\n`
        : '';

    const exampleJson = readsRevenue
      ? '{"genome_update": {"section": "financial", "data": {"monthlyFixedCosts": 3000}, "summary": "Monthly fixed cost: 3000"}}'
      : '{"genome_update": {"section": "operations", "data": {"coreWorkflows": ["client intake"]}, "summary": "Core workflow: client intake"}}';

    const systemPrompt = `You are KEY, an executive business advisor operating in **Genome Mode**.

Your goal is to help the user build a complete Business Genome — the structured operating DNA of their company.

${compositeHeader}Three-Pillar Minimum (Founder + Business + Market DNA ≥ 50%): ${genome.threePillarMinimumMet ? 'MET' : 'NOT YET MET'}

DNA Sections:
${sections}

${weakest ? `Next recommended focus: ${weakest.label} (${weakest.integrity}%). Suggested question: "${weakest.recommendation}"` : 'All DNA sections are complete. Help the user refine their Genome.'}

Rules:
1. Ask one clear question at a time.
2. When the user gives you a business fact, you may propose a structured update by including a JSON block like this:

\`\`\`json
${exampleJson}
\`\`\`

3. Do NOT tell the user the update has been saved. It is only a proposal until they confirm.
4. If you are unsure, ask a follow-up instead of guessing.
5. Stay focused on completing the Genome. Do not execute actions outside the Genome.`;

    const messages: GatewayMessage[] = [{ role: 'system', content: systemPrompt }];

    for (const h of history) {
      if (h.role === 'user' || h.role === 'assistant') {
        messages.push({ role: h.role, content: h.content });
      }
    }

    messages.push({ role: 'user', content: userMessage });

    return messages;
  }

  private extractProposedUpdates(content: string): {
    displayContent: string;
    proposedUpdates: ProposedGenomeUpdate | null;
  } {
    const fencePattern = /```json\s*([\s\S]*?)```/g;
    let match: RegExpExecArray | null;
    let lastMatch: RegExpExecArray | null = null;

    while ((match = fencePattern.exec(content)) !== null) {
      if (match[1].includes('"genome_update"')) {
        lastMatch = match;
      }
    }

    if (!lastMatch) {
      return { displayContent: content, proposedUpdates: null };
    }

    const blockContent = lastMatch[1];

    try {
      const parsed = JSON.parse(blockContent.trim()) as { genome_update?: unknown };
      const update = parsed.genome_update as ProposedGenomeUpdate | undefined;

      if (
        update &&
        typeof update.section === 'string' &&
        update.data &&
        typeof update.data === 'object' &&
        Object.keys(update.data).length > 0
      ) {
        const before = content.slice(0, lastMatch.index).trim();
        const after = content.slice(lastMatch.index + lastMatch[0].length).trim();
        const displayContent = [before, after].filter(Boolean).join('\n\n');

        return {
          displayContent,
          proposedUpdates: {
            section: update.section as DnaSectionKey,
            data: update.data as Record<string, unknown>,
            summary: update.summary || `Update ${update.section} DNA`,
          },
        };
      }
    } catch (err: any) {
      this.logger.warn(`Failed to parse genome_update block: ${(err as Error).message}`);
    }

    return { displayContent: content, proposedUpdates: null };
  }

}
