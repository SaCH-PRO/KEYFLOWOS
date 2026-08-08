import { Injectable } from '@nestjs/common';
import type { JobRole } from '@prisma/client';

/**
 * Position-scoped governance envelope: what a specific JobRole (position)
 * may use mid-conversation. Derived from the role's `permissions` JSON map
 * ({ module: "read" | "write" | "admin" }) — deny-by-default: modules not
 * granted are outside the position's scope.
 */
export interface JobRoleEnvelope {
  jobRoleId: string;
  jobRoleName: string;
  approvedTools: string[];
  blockedTools: string[];
  maxRiskTier: number;
}

/** Module permission key → tool-name families it unlocks. */
const MODULE_TOOL_FAMILIES: Record<string, string[]> = {
  finance: ['finance_*', 'expenses_*'],
  crm: ['crm_*'],
  sales: ['crm_*', 'commerce_*'],
  commerce: ['commerce_*'],
  bookings: ['bookings_*', 'calendar_*'],
  calendar: ['calendar_*'],
  projects: ['projects_*', 'time_*'],
  time: ['time_*'],
  marketing: ['marketing_*', 'social_*', 'content_*'],
  social: ['social_*'],
  content: ['content_*'],
  helpdesk: ['helpdesk_*'],
  comms: ['comms_*', 'inbox_*'],
  inbox: ['inbox_*'],
  structure: ['structure_*'],
  hr: ['structure_*'],
  contracts: ['contract_*'],
  legal: ['contract_*'],
  procurement: ['procurement_*'],
  documents: ['documents_*', 'drive_*'],
};

/** Baseline reads every position keeps regardless of grants. */
const BASELINE_READS = ['fetch_*', 'calendar_check_conflicts', 'documents_list'];

const LEVEL_TIER: Record<string, number> = { read: 1, write: 2, admin: 3 };

@Injectable()
export class JobRolePolicyService {
  envelopeForJobRole(jobRole: Pick<JobRole, 'id' | 'name' | 'permissions'>): JobRoleEnvelope {
    const permissions = (jobRole.permissions ?? {}) as Record<string, string>;
    const approved = new Set<string>(BASELINE_READS);
    let maxRiskTier = 1;

    for (const [module, levelRaw] of Object.entries(permissions)) {
      const level = (levelRaw ?? '').toLowerCase();
      const families = MODULE_TOOL_FAMILIES[module.toLowerCase()];
      if (!families || !(level in LEVEL_TIER)) continue;
      families.forEach((f) => approved.add(f));
      maxRiskTier = Math.max(maxRiskTier, LEVEL_TIER[level]);
    }

    return {
      jobRoleId: jobRole.id,
      jobRoleName: jobRole.name,
      approvedTools: [...approved],
      blockedTools: [],
      maxRiskTier,
    };
  }

  /** Same wildcard semantics as RoleEngine: exact match or trailing-* prefix. */
  isToolAllowed(envelope: JobRoleEnvelope, toolName: string): boolean {
    if (envelope.blockedTools.includes(toolName)) return false;
    for (const pattern of envelope.approvedTools) {
      if (pattern.endsWith('*')) {
        if (toolName.startsWith(pattern.slice(0, -1))) return true;
      } else if (pattern === toolName) {
        return true;
      }
    }
    return false;
  }
}
