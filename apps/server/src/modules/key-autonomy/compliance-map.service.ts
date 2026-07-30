import { Injectable } from '@nestjs/common';

export type ComplianceFramework = 'nist_ai_rmf' | 'eu_ai_act' | 'iso_42001';

export interface ComplianceMapping {
  framework: ComplianceFramework;
  tier: 'manual' | 'supervised' | 'full';
  riskCategory: string;
  controls: string[];
}

/**
 * Maps KEY autonomy tiers to compliance risk categories.
 *
 * Foundation implementation: static mapping tables. This supports audit
 * reporting and helps operators understand which regulatory controls apply.
 */
@Injectable()
export class ComplianceMapService {
  private readonly mappings: ComplianceMapping[] = [
    {
      framework: 'nist_ai_rmf',
      tier: 'manual',
      riskCategory: 'High-risk autonomous decision with human override',
      controls: ['GOVERN-5', 'MAP-1', 'MEASURE-2'],
    },
    {
      framework: 'nist_ai_rmf',
      tier: 'supervised',
      riskCategory: 'Moderate-risk decision with human confirmation',
      controls: ['GOVERN-3', 'MAP-2', 'MANAGE-2'],
    },
    {
      framework: 'nist_ai_rmf',
      tier: 'full',
      riskCategory: 'Low-risk delegated decision',
      controls: ['GOVERN-1', 'MANAGE-1'],
    },
    {
      framework: 'eu_ai_act',
      tier: 'manual',
      riskCategory: 'High-risk AI system operating with human-in-the-loop',
      controls: ['Article 10', 'Article 14'],
    },
    {
      framework: 'eu_ai_act',
      tier: 'supervised',
      riskCategory: 'Limited-risk AI system with transparency obligations',
      controls: ['Article 52'],
    },
    {
      framework: 'eu_ai_act',
      tier: 'full',
      riskCategory: 'Minimal-risk AI system',
      controls: ['Voluntary codes of conduct'],
    },
    {
      framework: 'iso_42001',
      tier: 'manual',
      riskCategory: 'Significant AI risk requiring management review',
      controls: ['A.5.2', 'A.6.3', 'A.8.2'],
    },
    {
      framework: 'iso_42001',
      tier: 'supervised',
      riskCategory: 'Managed AI risk with operational controls',
      controls: ['A.5.1', 'A.6.2'],
    },
    {
      framework: 'iso_42001',
      tier: 'full',
      riskCategory: 'Low AI risk under standard controls',
      controls: ['A.4.1'],
    },
  ];

  getMapping(tier: 'manual' | 'supervised' | 'full'): ComplianceMapping[] {
    return this.mappings.filter((m) => m.tier === tier);
  }

  getAll(): ComplianceMapping[] {
    return this.mappings;
  }
}
