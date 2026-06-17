import type { ComplianceItem } from '../blueprint/blueprint.types';

export type { ComplianceItem };

export interface TrinidadComplianceInput {
  entityType?: string;
  hasEmployees?: boolean;
  estimatedAnnualRevenue?: number;
  industry?: string;
  regulatedIndustry?: boolean;
  hasPhysicalLocation?: boolean;
}

const STATUS: ComplianceItem['status'] = 'NOT_STARTED';

export function inferTrinidadCompliance(input: TrinidadComplianceInput): ComplianceItem[] {
  const items: ComplianceItem[] = [
    {
      id: 'tt-name-search',
      label: 'Search and reserve/register the business name through the Companies Registry',
      priority: 'CRITICAL',
      authority: 'Companies Registry',
      status: STATUS,
    },
    {
      id: 'tt-bir',
      label: 'Register with the Board of Inland Revenue and obtain a tax file number',
      priority: 'CRITICAL',
      authority: 'BIR',
      status: STATUS,
    },
    {
      id: 'tt-bank-account',
      label: 'Open a dedicated business bank account',
      priority: 'HIGH',
      status: STATUS,
    },
  ];

  if (input.hasEmployees) {
    items.push({
      id: 'tt-nis-employer',
      label: 'Register as an employer for National Insurance contributions',
      priority: 'HIGH',
      authority: 'NIBTT',
      status: STATUS,
    });
  }

  if (typeof input.estimatedAnnualRevenue === 'number' && input.estimatedAnnualRevenue > 500000) {
    items.push({
      id: 'tt-vat',
      label: 'Monitor VAT registration requirements and register if thresholds are met',
      priority: 'HIGH',
      authority: 'BIR',
      status: STATUS,
    });
  }

  if (input.regulatedIndustry) {
    items.push({
      id: 'tt-regulated-license',
      label: 'Verify industry-specific licensing and regulatory requirements with the relevant authority',
      priority: 'CRITICAL',
      status: STATUS,
    });
  }

  if (input.hasPhysicalLocation) {
    items.push({
      id: 'tt-physical-permits',
      label: 'Confirm municipal permits and fire clearance for the premises',
      priority: 'HIGH',
      status: STATUS,
    });
  }

  return items;
}

export const GENERIC_COMPLIANCE_ITEMS: ComplianceItem[] = [
  {
    id: 'generic-name-search',
    label: 'Verify that the desired business name is available and register it with the relevant authority',
    priority: 'CRITICAL',
    status: STATUS,
  },
  {
    id: 'generic-tax-registration',
    label: 'Register with the local tax authority and obtain a tax identifier',
    priority: 'CRITICAL',
    status: STATUS,
  },
  {
    id: 'generic-bank-account',
    label: 'Open a dedicated business bank account',
    priority: 'HIGH',
    status: STATUS,
  },
  {
    id: 'generic-industry-licenses',
    label: 'Review and obtain any industry-specific licences or permits',
    priority: 'HIGH',
    status: STATUS,
  },
  {
    id: 'generic-employer-obligations',
    label: 'Confirm employer obligations, including social insurance and payroll registrations',
    priority: 'MEDIUM',
    status: STATUS,
  },
];

export function inferCompliance(country: string | undefined, input: TrinidadComplianceInput): ComplianceItem[] {
  if (country && country.trim().toLowerCase() === 'trinidad and tobago') {
    return inferTrinidadCompliance(input);
  }
  return GENERIC_COMPLIANCE_ITEMS;
}
