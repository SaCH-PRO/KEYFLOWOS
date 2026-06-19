import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { TemporalFlowService } from '../temporal-flow/temporal-flow.service';
import { GenomeEvolutionService } from '../business-genome/genome-evolution.service';
import { ConstitutionVersionService } from '../business-genome/constitution-version.service';
import { GenomeDocumentPackService } from '../business-genome/document-pack/genome-document-pack.service';
import type { KeyActionProposalData, KeyExecutableActionType } from './key-action-proposal.types';

export interface ExecutionOutcome {
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
}

@Injectable()
export class KeyActionExecutorService {
  constructor(
    @Inject(TemporalFlowService) private readonly temporal: TemporalFlowService,
    @Inject(GenomeEvolutionService) private readonly genomeEvolution: GenomeEvolutionService,
    @Inject(ConstitutionVersionService) private readonly constitution: ConstitutionVersionService,
    @Inject(GenomeDocumentPackService) private readonly documentPack: GenomeDocumentPackService,
  ) {}

  async execute(
    businessId: string,
    proposal: KeyActionProposalData,
    executedBy?: string,
  ): Promise<ExecutionOutcome> {
    switch (proposal.actionType) {
      case 'CREATE_TASK':
        return this.executeCreateTask(businessId, proposal, executedBy);
      case 'CREATE_GENOME_EVOLUTION_PROPOSAL':
        return this.executeCreateGenomeProposal(businessId, proposal, executedBy);
      case 'GENERATE_CONSTITUTION_VERSION':
        return this.executeGenerateConstitution(businessId, proposal, executedBy);
      case 'GENERATE_DOCUMENT_EXPORT':
        return this.executeGenerateDocumentExport(businessId, proposal);
      default:
        return { success: false, error: `Action ${proposal.actionType} is not executable` };
    }
  }

  private async executeCreateTask(
    businessId: string,
    proposal: KeyActionProposalData,
    executedBy?: string,
  ): Promise<ExecutionOutcome> {
    await this.temporal.emit({
      businessId,
      userId: executedBy,
      source: 'KEY',
      type: 'key.action.create_task',
      module: 'key-autonomy',
      entityType: 'key_action_proposal',
      entityId: proposal.id,
      title: proposal.title,
      summary: proposal.rationale || proposal.summary || undefined,
      status: 'ACTION_REQUIRED',
      importance: 'NORMAL',
      payload: proposal.payload,
    });

    return {
      success: true,
      result: {
        entityType: 'TemporalFlowEvent',
        message: 'Follow-up task recorded in Temporal Flow',
      },
    };
  }

  private async executeCreateGenomeProposal(
    businessId: string,
    proposal: KeyActionProposalData,
    createdBy?: string,
  ): Promise<ExecutionOutcome> {
    const payload = proposal.payload as {
      section: string;
      proposedPatch: Record<string, unknown>;
      reason: string;
      evidence?: string[];
      confidence?: number;
    };

    const created = await this.genomeEvolution.create(businessId, {
      section: payload.section as any,
      proposedPatch: payload.proposedPatch,
      reason: payload.reason,
      evidence: payload.evidence,
      confidence: payload.confidence,
      createdBy,
      sourceEventIds: proposal.sourceId ? [proposal.sourceId] : undefined,
    });

    return {
      success: true,
      result: {
        entityType: 'GenomeEvolutionProposal',
        entityId: created.id,
      },
    };
  }

  private async executeGenerateConstitution(
    businessId: string,
    proposal: KeyActionProposalData,
    generatedBy?: string,
  ): Promise<ExecutionOutcome> {
    const payload = (proposal.payload ?? {}) as { changeNotes?: string; status?: string };

    const version = await this.constitution.generate(
      businessId,
      {
        changeNotes: payload.changeNotes,
        status: payload.status as 'DRAFT' | 'ACTIVE' | 'ARCHIVED' | undefined,
      },
      generatedBy,
    );

    return {
      success: true,
      result: {
        entityType: 'BusinessConstitutionVersion',
        entityId: version.id,
        version: version.version,
      },
    };
  }

  private async executeGenerateDocumentExport(
    businessId: string,
    proposal: KeyActionProposalData,
  ): Promise<ExecutionOutcome> {
    const payload = proposal.payload as {
      artifact: 'executive-brief' | 'constitution' | 'dna-report';
      format: 'pdf' | 'docx';
      version?: number;
    };

    if (!payload.artifact || !payload.format) {
      return { success: false, error: 'Document export requires artifact and format in payload' };
    }

    let result: { filename: string };
    switch (payload.artifact) {
      case 'executive-brief':
        result = await this.documentPack.exportExecutiveBrief(businessId, payload.format);
        break;
      case 'constitution':
        result = await this.documentPack.exportConstitution(businessId, payload.version, payload.format);
        break;
      case 'dna-report':
        result = await this.documentPack.exportDnaReport(businessId, payload.format);
        break;
      default:
        return { success: false, error: `Unsupported document artifact: ${payload.artifact}` };
    }

    const params = new URLSearchParams({ format: payload.format });
    if (payload.version !== undefined) params.set('version', String(payload.version));
    const downloadPath = `/business-genome/businesses/${businessId}/document-pack/${payload.artifact}/export?${params.toString()}`;

    return {
      success: true,
      result: {
        entityType: 'DocumentExport',
        format: payload.format,
        filename: result.filename,
        downloadPath,
      },
    };
  }
}
