import { Injectable } from '@nestjs/common';
import type {
  BlueprintData,
  BlueprintExecutionRoadmap,
  ComplianceItem,
} from '../blueprint/blueprint.types';
import type { GenesisActionPlan, GenesisReadinessScore } from './business-genesis.types';

type DomainKey = 'legal' | 'finance' | 'market' | 'operations' | 'compliance';

interface DomainConfig {
  key: DomainKey;
  priority: number;
  label: string;
  actions: string[];
}

const DOMAIN_CONFIGS: Record<DomainKey, DomainConfig> = {
  legal: {
    key: 'legal',
    priority: 1,
    label: 'Legal & Registration',
    actions: [
      'Confirm the recommended entity type with a local attorney or registry',
      'Search and reserve/register the business name through the Companies Registry',
      'Register with the Board of Inland Revenue (BIR) for a tax file number',
      'Open a dedicated business bank account',
      'Accept the legal entity disclaimer and file any required partnership or shareholder agreements',
    ],
  },
  finance: {
    key: 'finance',
    priority: 2,
    label: 'Finance & Projections',
    actions: [
      'List all startup costs and confirm total capital required',
      'Set or validate your average ticket price and pricing model',
      'Calculate and confirm your break-even revenue and units',
      'Build a 12-month cash-flow model with conservative and aggressive scenarios',
      'Set a monthly financial review rhythm and KPI dashboard',
    ],
  },
  market: {
    key: 'market',
    priority: 3,
    label: 'Market & Go-to-Market',
    actions: [
      'Define your ideal customer profile and primary pain points',
      'Validate your core offer with 3–5 target prospects',
      'Choose 1–3 launch marketing channels',
      'Draft your first campaign or outreach sequence',
      'Set a launch date and early-adopter incentive',
    ],
  },
  operations: {
    key: 'operations',
    priority: 4,
    label: 'Operations & Systems',
    actions: [
      'Document your core workflow from lead to delivery',
      'Set up CRM and payment collection tools',
      'Define your customer support and escalation process',
      'Create a daily/weekly operating checklist',
      'Configure automation rules and AI hand-off boundaries',
    ],
  },
  compliance: {
    key: 'compliance',
    priority: 5,
    label: 'Compliance & Licences',
    actions: [
      'Complete all CRITICAL compliance checklist items',
      'Schedule a review of industry-specific licences and permits',
      'Confirm municipal permits and fire clearance if you have a physical location',
      'Set calendar reminders for annual filings and licence renewals',
    ],
  },
};

const MILESTONES = [
  'Launch-ready legal, tax and banking foundation complete',
  'First paying customers and repeatable marketing channels validated',
  'Operating workflows documented and core systems integrated',
  'Profitable unit economics and 12-month cash-flow plan in place',
];

@Injectable()
export class GenesisActionPlanBuilder {
  build(blueprint: BlueprintData, readiness: GenesisReadinessScore): GenesisActionPlan {
    const domains = this.sortDomains(readiness);
    const criticalCompliance = this.getCriticalUndoneCompliance(blueprint);
    const criticalActions = criticalCompliance.map(
      (item) => `[CRITICAL] ${item.label}${item.authority ? ` (${item.authority})` : ''}`,
    );

    const lowest = domains[0];
    const lowestConfig = DOMAIN_CONFIGS[lowest.key];

    const today: string[] = [
      ...criticalActions,
      ...lowestConfig.actions.slice(0, 3),
    ];

    const sevenDayPlan: string[] = [
      `Day 1–3 — ${lowestConfig.label}: ${lowestConfig.actions[0]}`,
      `Day 4–5 — ${lowestConfig.label}: ${lowestConfig.actions[1]}`,
      `Day 6–7 — ${lowestConfig.label}: ${lowestConfig.actions[2]}`,
      ...(lowestConfig.actions[3] ? [`Day 7 — ${lowestConfig.label}: ${lowestConfig.actions[3]}`] : []),
    ];

    const thirtyDayPlan: string[] = this.buildThirtyDayPlan(domains);
    const ninetyDayPlan: string[] = this.buildNinetyDayPlan(domains);

    const executionRoadmap: BlueprintExecutionRoadmap = {
      today,
      sevenDayPlan,
      thirtyDayPlan,
      ninetyDayPlan,
      twelveMonthMilestones: MILESTONES,
    };

    const nextActions: string[] = [
      ...today.slice(0, 5),
      ...criticalActions.filter((action) => !today.slice(0, 5).includes(action)),
    ].slice(0, 7);

    return {
      roadmap: [
        ...today,
        ...sevenDayPlan,
        ...thirtyDayPlan,
        ...ninetyDayPlan,
        ...MILESTONES,
      ],
      executionRoadmap,
      complianceItems: blueprint.complianceProfile?.complianceItems || [],
      nextActions,
      projectedRunwayMonths: blueprint.projectionProfile?.runwayMonths,
      breakEvenRevenue: blueprint.projectionProfile?.breakEvenRevenue,
    };
  }

  private sortDomains(readiness: GenesisReadinessScore): DomainConfig[] {
    const entries: DomainConfig[] = [
      { ...DOMAIN_CONFIGS.legal, key: 'legal', priority: 1 },
      { ...DOMAIN_CONFIGS.finance, key: 'finance', priority: 2 },
      { ...DOMAIN_CONFIGS.market, key: 'market', priority: 3 },
      { ...DOMAIN_CONFIGS.operations, key: 'operations', priority: 4 },
      { ...DOMAIN_CONFIGS.compliance, key: 'compliance', priority: 5 },
    ];

    return entries.sort((a, b) => {
      const scoreDiff = readiness[a.key] - readiness[b.key];
      if (scoreDiff !== 0) return scoreDiff;
      return a.priority - b.priority;
    });
  }

  private buildThirtyDayPlan(domains: DomainConfig[]): string[] {
    const plan: string[] = [];
    const first = domains[0];
    const second = domains[1] ?? first;

    const weeklyFocus = [
      { domain: first, weeks: 2 },
      { domain: second, weeks: 2 },
    ];

    let week = 1;
    for (const focus of weeklyFocus) {
      for (let i = 0; i < focus.weeks && week <= 4; i++) {
        const actionIndex = i % focus.domain.actions.length;
        plan.push(
          `Week ${week} — ${focus.domain.label}: ${focus.domain.actions[actionIndex]}`,
        );
        week++;
      }
    }

    return plan;
  }

  private buildNinetyDayPlan(domains: DomainConfig[]): string[] {
    const plan: string[] = [];
    for (let week = 1; week <= 12; week++) {
      const domain = domains[(week - 1) % domains.length];
      const actionIndex = Math.floor((week - 1) / domains.length) % domain.actions.length;
      plan.push(`Week ${week} — ${domain.label}: ${domain.actions[actionIndex]}`);
    }
    return plan;
  }

  private getCriticalUndoneCompliance(blueprint: BlueprintData): ComplianceItem[] {
    const items = blueprint.complianceProfile?.complianceItems || [];
    return items.filter(
      (item) =>
        item.priority === 'CRITICAL' &&
        item.status !== 'DONE' &&
        item.status !== 'NOT_APPLICABLE',
    );
  }
}
