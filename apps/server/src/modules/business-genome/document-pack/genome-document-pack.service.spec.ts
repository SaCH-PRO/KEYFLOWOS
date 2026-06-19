import { describe, it, expect, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { GenomeDocumentPackService } from './genome-document-pack.service';
import { BusinessIntelligenceService } from '../../intelligence/business-intelligence.service';
import { ConstitutionVersionService } from '../constitution-version.service';
import { BlueprintService } from '../../blueprint/blueprint.service';
import type { BusinessExecutiveBrief } from '../../intelligence/business-intelligence.types';
import type { ConstitutionVersionData } from '../constitution-version.types';
import type { GenomeIntegrityResult } from '../../blueprint/blueprint.types';

const mockBrief: BusinessExecutiveBrief = {
  businessId: 'biz_1',
  generatedAt: new Date().toISOString(),
  summary: 'Executive Readiness 65%, Genome Integrity 70%. Business health is stable.',
  genomeIntegrity: 70,
  executiveReadinessScore: 65,
  genomeStage: 'OPERATING_BUSINESS',
  insights: [
    {
      id: 'genome-integrity',
      domain: 'GENOME',
      priority: 'MEDIUM',
      title: 'Genome Integrity is 70%',
      finding: 'The Business Genome is partially complete.',
      evidence: ['Genome Integrity: 70%'],
      confidence: 0.95,
    },
  ],
  topPriorities: [
    {
      id: 'genome-integrity',
      domain: 'GENOME',
      priority: 'MEDIUM',
      title: 'Genome Integrity is 70%',
      finding: 'The Business Genome is partially complete.',
      evidence: ['Genome Integrity: 70%'],
      confidence: 0.95,
    },
  ],
};

const mockConstitution: ConstitutionVersionData = {
  id: 'cv_1',
  businessId: 'biz_1',
  version: 3,
  title: 'Business Constitution',
  status: 'ACTIVE',
  content: {
    genomeIntegrity: 70,
    executiveReadinessScore: 65,
    genomeStage: 'OPERATING_BUSINESS',
    sections: {
      executiveSummary: {
        title: 'Executive Summary',
        sourceDna: ['business', 'vision'],
        strength: 80,
        content: 'Business: Acme. Mission: Build widgets.',
      },
    },
  },
  summary: 'Generated from Genome Integrity 70%.',
  changeNotes: 'Updated after DNA review',
  sourceGenomeIntegrity: 70,
  sourceExecutiveReadiness: 65,
  sourceGenomeStage: 'OPERATING_BUSINESS',
  generatedBy: null,
  generatedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
};

const allDnaScores: Record<
  'founder' | 'vision' | 'business' | 'market' | 'financial' | 'legal' | 'operations' | 'sales' | 'marketing' | 'growth' | 'technology' | 'risk',
  number
> = {
  founder: 80,
  vision: 75,
  business: 70,
  market: 65,
  financial: 60,
  legal: 55,
  operations: 70,
  sales: 65,
  marketing: 60,
  growth: 50,
  technology: 55,
  risk: 60,
};

const allDnaConfidence: Record<
  'founder' | 'vision' | 'business' | 'market' | 'financial' | 'legal' | 'operations' | 'sales' | 'marketing' | 'growth' | 'technology' | 'risk',
  number
> = {
  founder: 0.8,
  vision: 0.75,
  business: 0.7,
  market: 0.65,
  financial: 0.6,
  legal: 0.55,
  operations: 0.7,
  sales: 0.65,
  marketing: 0.6,
  growth: 0.5,
  technology: 0.55,
  risk: 0.6,
};

const mockGenome: GenomeIntegrityResult = {
  genomeIntegrity: 70,
  genomeDnaScores: allDnaScores,
  genomeDnaConfidence: allDnaConfidence,
  genomeStage: 'OPERATING_BUSINESS',
  threePillarMinimumMet: true,
  dnaSections: [
    {
      key: 'founder',
      label: 'Founder DNA',
      integrity: 80,
      confidence: 0.8,
      summary: 'Founder profile is strong.',
      fieldsCaptured: 8,
      fieldsTotal: 10,
      missingFields: ['advisorNetwork'],
      recommendation: 'Add advisor network details.',
    },
  ],
  executiveReadinessScore: 65,
  readinessBreakdown: {},
};

describe('GenomeDocumentPackService', () => {
  let service: GenomeDocumentPackService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        GenomeDocumentPackService,
        {
          provide: BusinessIntelligenceService,
          useValue: {
            generateExecutiveBrief: async () => mockBrief,
          },
        },
        {
          provide: ConstitutionVersionService,
          useValue: {
            latest: async () => mockConstitution,
            getVersion: async () => mockConstitution,
          },
        },
        {
          provide: BlueprintService,
          useValue: {
            calculateGenomeIntegrity: async () => mockGenome,
          },
        },
      ],
    }).compile();

    service = moduleRef.get(GenomeDocumentPackService);
  });

  it('exports Executive Brief as PDF', async () => {
    const result = await service.exportExecutiveBrief('biz_1', 'pdf');
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.contentType).toBe('application/pdf');
    expect(result.filename).toMatch(/^executive-brief-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it('exports Executive Brief as DOCX', async () => {
    const result = await service.exportExecutiveBrief('biz_1', 'docx');
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.contentType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(result.buffer.subarray(0, 2).toString()).toBe('PK');
    expect(result.filename).toMatch(/^executive-brief-\d{4}-\d{2}-\d{2}\.docx$/);
  });

  it('exports latest Constitution as PDF with version suffix', async () => {
    const result = await service.exportConstitution('biz_1', undefined, 'pdf');
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.filename).toMatch(/^constitution-v3-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it('exports a specific Constitution version as DOCX', async () => {
    const result = await service.exportConstitution('biz_1', 3, 'docx');
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.buffer.subarray(0, 2).toString()).toBe('PK');
    expect(result.filename).toMatch(/^constitution-v3-\d{4}-\d{2}-\d{2}\.docx$/);
  });

  it('exports DNA Report as PDF', async () => {
    const result = await service.exportDnaReport('biz_1', 'pdf');
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.contentType).toBe('application/pdf');
    expect(result.filename).toMatch(/^dna-report-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it('exports DNA Report as DOCX', async () => {
    const result = await service.exportDnaReport('biz_1', 'docx');
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.buffer.subarray(0, 2).toString()).toBe('PK');
    expect(result.filename).toMatch(/^dna-report-\d{4}-\d{2}-\d{2}\.docx$/);
  });
});
