import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { KeyActionExecutorService } from './key-action-executor.service';
import { TemporalFlowService } from '../temporal-flow/temporal-flow.service';
import { GenomeEvolutionService } from '../business-genome/genome-evolution.service';
import { ConstitutionVersionService } from '../business-genome/constitution-version.service';
import { GenomeDocumentPackService } from '../business-genome/document-pack/genome-document-pack.service';
import { KeyActionExecutorRegistryService } from './key-action-executor-registry.service';
import { SafetyShellService } from './safety-shell.service';
import { ActionAuditService } from './action-audit.service';
import type { KeyActionProposalData } from './key-action-proposal.types';

const baseProposal = (actionType: KeyActionProposalData['actionType'], payload: Record<string, unknown> = {}): KeyActionProposalData => ({
  id: 'prop_1',
  businessId: 'biz_1',
  sourceType: 'EXECUTIVE_MODE',
  title: 'Test',
  evidence: [],
  actionType,
  payload,
  riskLevel: 'LOW',
  status: 'APPROVED',
  requiresApproval: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

describe('KeyActionExecutorService', () => {
  let service: KeyActionExecutorService;
  let temporal: TemporalFlowService;
  let genomeEvolution: GenomeEvolutionService;
  let constitution: ConstitutionVersionService;
  let documentPack: GenomeDocumentPackService;
  let safetyShell: SafetyShellService;
  let actionAudit: ActionAuditService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        KeyActionExecutorService,
        {
          provide: ActionAuditService,
          useValue: {
            recordExecuted: vi.fn().mockResolvedValue(undefined),
            recordBlocked: vi.fn().mockResolvedValue(undefined),
            recordFailed: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: KeyActionExecutorRegistryService,
          useValue: { register: vi.fn(), execute: vi.fn(), hasPlugin: vi.fn().mockReturnValue(false) },
        },
        {
          provide: TemporalFlowService,
          useValue: { emit: vi.fn(async () => ({})) },
        },
        {
          provide: GenomeEvolutionService,
          useValue: {
            create: vi.fn(async () => ({ id: 'proposal_1' })),
          },
        },
        {
          provide: ConstitutionVersionService,
          useValue: {
            generate: vi.fn(async () => ({ id: 'cv_1', version: 4 })),
          },
        },
        {
          provide: GenomeDocumentPackService,
          useValue: {
            exportExecutiveBrief: vi.fn(async () => ({ filename: 'executive-brief.pdf' })),
            exportConstitution: vi.fn(async () => ({ filename: 'constitution.pdf' })),
            exportDnaReport: vi.fn(async () => ({ filename: 'dna-report.pdf' })),
          },
        },
        {
          provide: SafetyShellService,
          useValue: {
            check: vi.fn().mockResolvedValue({
              safe: true,
              preconditionsMet: true,
              idempotencyKey: 'key_1',
              rollbackActions: [],
            }),
            rollback: vi.fn().mockResolvedValue({ success: true, results: [] }),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(KeyActionExecutorService);
    temporal = moduleRef.get(TemporalFlowService);
    genomeEvolution = moduleRef.get(GenomeEvolutionService);
    constitution = moduleRef.get(ConstitutionVersionService);
    documentPack = moduleRef.get(GenomeDocumentPackService);
    safetyShell = moduleRef.get(SafetyShellService);
    actionAudit = moduleRef.get(ActionAuditService);
  });

  it('CREATE_TASK emits a Temporal Flow event', async () => {
    const outcome = await service.execute('biz_1', baseProposal('CREATE_TASK', { title: 'Task' }), 'user_1');
    expect(outcome.success).toBe(true);
    expect(outcome.result?.entityType).toBe('TemporalFlowEvent');
    expect(temporal.emit).toHaveBeenCalled();
  });

  it('CREATE_GENOME_EVOLUTION_PROPOSAL creates a proposal', async () => {
    const payload = {
      section: 'marketing',
      proposedPatch: { foo: 'bar' },
      reason: 'Improve targeting',
      evidence: ['ev_1'],
      confidence: 0.8,
    };
    const outcome = await service.execute('biz_1', baseProposal('CREATE_GENOME_EVOLUTION_PROPOSAL', payload), 'user_1');
    expect(outcome.success).toBe(true);
    expect(outcome.result?.entityType).toBe('GenomeEvolutionProposal');
    expect(genomeEvolution.create).toHaveBeenCalledWith(
      'biz_1',
      expect.objectContaining({ ...payload, createdBy: 'user_1' }),
    );
  });

  it('GENERATE_CONSTITUTION_VERSION generates a version', async () => {
    const outcome = await service.execute(
      'biz_1',
      baseProposal('GENERATE_CONSTITUTION_VERSION', { changeNotes: 'Test' }),
      'user_1',
    );
    expect(outcome.success).toBe(true);
    expect(outcome.result?.entityType).toBe('BusinessConstitutionVersion');
    expect(constitution.generate).toHaveBeenCalledWith('biz_1', { changeNotes: 'Test', status: undefined }, 'user_1');
  });

  it('GENERATE_DOCUMENT_EXPORT returns download path for executive brief', async () => {
    const outcome = await service.execute(
      'biz_1',
      baseProposal('GENERATE_DOCUMENT_EXPORT', { artifact: 'executive-brief', format: 'pdf' }),
      'user_1',
    );
    expect(outcome.success).toBe(true);
    expect(outcome.result?.downloadPath).toContain('/document-pack/executive-brief/export?format=pdf');
    expect(documentPack.exportExecutiveBrief).toHaveBeenCalledWith('biz_1', 'pdf');
  });

  it('GENERATE_DOCUMENT_EXPORT returns download path for constitution with version', async () => {
    const outcome = await service.execute(
      'biz_1',
      baseProposal('GENERATE_DOCUMENT_EXPORT', { artifact: 'constitution', format: 'docx', version: 3 }),
      'user_1',
    );
    expect(outcome.success).toBe(true);
    expect(outcome.result?.downloadPath).toContain('version=3');
    expect(documentPack.exportConstitution).toHaveBeenCalledWith('biz_1', 3, 'docx');
  });

  it('fails for unsupported executable action', async () => {
    const outcome = await service.execute('biz_1', baseProposal('OPEN_GENOME'), 'user_1');
    expect(outcome.success).toBe(false);
    expect(outcome.error).toContain('not executable');
    expect(safetyShell.rollback).toHaveBeenCalled();
  });

  it('safety shell blocks unsafe proposals', async () => {
    (safetyShell.check as any).mockResolvedValueOnce({
      safe: false,
      preconditionsMet: false,
      idempotencyKey: 'key_blocked',
      reason: 'Required pre-conditions are missing',
    });
    const outcome = await service.execute('biz_1', baseProposal('CREATE_TASK'), 'user_1');
    expect(outcome.success).toBe(false);
    expect(outcome.error).toContain('pre-conditions');
    expect(temporal.emit).not.toHaveBeenCalled();
    expect(actionAudit.recordBlocked).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 'biz_1', actionType: 'CREATE_TASK' }),
    );
  });

  it('records an audit event when an action executes successfully', async () => {
    const outcome = await service.execute('biz_1', baseProposal('CREATE_TASK', { title: 'Task' }), 'user_1');
    expect(outcome.success).toBe(true);
    expect(actionAudit.recordExecuted).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz_1',
        actionType: 'CREATE_TASK',
        actorId: 'user_1',
        actorType: 'human',
        proposalId: 'prop_1',
      }),
    );
  });

  it('records a failed audit event and rolls back when execution fails', async () => {
    const outcome = await service.execute('biz_1', baseProposal('OPEN_GENOME'), 'user_1');
    expect(outcome.success).toBe(false);
    expect(safetyShell.rollback).toHaveBeenCalled();
    expect(actionAudit.recordFailed).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 'biz_1', actionType: 'OPEN_GENOME' }),
    );
  });
});
