import { Injectable } from '@nestjs/common';
import { FLOW_TOOLS, type FlowTool } from '../ai/flow-tool-registry';

/**
 * Platform Capability Contract (convergence plan §5.2).
 *
 * One canonical, versioned definition per business action — invoked today by
 * KEY, and by UI buttons, automations, webhooks, jobs and third-party apps as
 * those consumers land. The FLOW_TOOLS registry remains the single source;
 * this service projects it into the platform contract shape and derives the
 * fields the contract requires (permission, executionMode, version).
 */
export interface CapabilityDefinition {
  /** Stable machine name, e.g. crm_merge_execute. */
  name: string;
  /** Contract version — bump when input/output schema changes incompatibly. */
  version: number;
  /** Module that owns the implementation (derived from the tool name prefix). */
  ownerModule: string;
  description: string;
  inputSchema: unknown;
  outputSchema: unknown;
  /** 1 auto-execute, 2 quick-confirm, 3 formal approval, 4 blocked. */
  riskTier: 1 | 2 | 3 | 4;
  riskLevel: 'low' | 'medium' | 'high';
  /** Permission string a principal must hold to invoke: `<owner>.<family>.<name>`. */
  permission: string;
  requiresApproval: boolean;
  executionMode: 'SYNC' | 'ASYNC';
  idempotency: 'REQUIRED' | 'SUPPORTED' | 'NONE';
  family: string;
  manualEquivalentRoute: string;
  changedEntities: string[];
}

const OWNER_PREFIXES: Array<[prefix: string, owner: string]> = [
  ['crm_', 'relationships'],
  ['contact_', 'relationships'],
  ['helpdesk_', 'relationships'],
  ['inbox_', 'relationships'],
  ['comms_', 'relationships'],
  ['sequence_', 'relationships'],
  ['tag_contact', 'relationships'],
  ['segment_contacts', 'relationships'],
  ['commerce_', 'money'],
  ['finance_', 'money'],
  ['expenses_', 'money'],
  ['payroll_', 'money'],
  ['draft_payment', 'money'],
  ['bookings_', 'work'],
  ['calendar_', 'work'],
  ['projects_', 'work'],
  ['time_', 'work'],
  ['call_', 'work'],
  ['approval_', 'work'],
  ['create_task', 'work'],
  ['schedule_action', 'work'],
  ['structure_', 'work'],
  ['performance_', 'work'],
  ['marketing_', 'growth'],
  ['social_', 'growth'],
  ['content_', 'growth'],
  ['seo_', 'growth'],
  ['draft_campaign', 'growth'],
  ['draft_storefront', 'growth'],
  ['draft_followup', 'growth'],
  ['fetch_seo', 'growth'],
  ['sync_seo', 'growth'],
  ['generate_content', 'growth'],
  ['contract_', 'knowledge'],
  ['documents_', 'knowledge'],
  ['drive_', 'knowledge'],
  ['keyflow_create_note', 'knowledge'],
  ['evidence_', 'knowledge'],
  ['update_business_blueprint', 'knowledge'],
  ['fetch_', 'intelligence'],
  ['mcp__', 'connector'],
  ['execute_custom_logic', 'platform'],
];

function ownerFor(name: string): string {
  for (const [prefix, owner] of OWNER_PREFIXES) {
    if (name.startsWith(prefix)) return owner;
  }
  return 'platform';
}

function executionModeFor(tool: FlowTool): 'SYNC' | 'ASYNC' {
  // Reads and drafts answer inline; anything that mutates the world queues
  // through governance and may complete asynchronously.
  return tool.family === 'read' || tool.family === 'draft' ? 'SYNC' : 'ASYNC';
}

function idempotencyFor(tool: FlowTool): CapabilityDefinition['idempotency'] {
  if (tool.family === 'execute' || tool.family === 'crud') return 'REQUIRED';
  if (tool.family === 'organize') return 'SUPPORTED';
  return 'NONE';
}

@Injectable()
export class CapabilityContractService {
  private readonly definitions: CapabilityDefinition[];

  constructor() {
    this.definitions = FLOW_TOOLS.map((tool) => this.project(tool));
  }

  private project(tool: FlowTool): CapabilityDefinition {
    const owner = ownerFor(tool.name);
    const tier = (tool.riskTier ?? (tool.riskLevel === 'high' ? 3 : tool.riskLevel === 'medium' ? 2 : 1)) as CapabilityDefinition['riskTier'];
    return {
      name: tool.name,
      version: 1,
      ownerModule: owner,
      description: tool.description,
      inputSchema: tool.parameters,
      outputSchema: tool.outputSchema,
      riskTier: tier,
      riskLevel: tool.riskLevel,
      permission: `${owner}.${tool.family}.${tool.name}`,
      requiresApproval: tier >= 3,
      executionMode: executionModeFor(tool),
      idempotency: idempotencyFor(tool),
      family: tool.family,
      manualEquivalentRoute: tool.manualEquivalentRoute,
      changedEntities: tool.changedEntities ?? [],
    };
  }

  list(filter?: { ownerModule?: string; family?: string; riskTier?: number }): CapabilityDefinition[] {
    return this.definitions.filter(
      (d) =>
        (!filter?.ownerModule || d.ownerModule === filter.ownerModule) &&
        (!filter?.family || d.family === filter.family) &&
        (!filter?.riskTier || d.riskTier === filter.riskTier),
    );
  }

  get(name: string): CapabilityDefinition | null {
    return this.definitions.find((d) => d.name === name) ?? null;
  }

  stats() {
    const byOwner = new Map<string, number>();
    const byFamily = new Map<string, number>();
    const byTier = new Map<number, number>();
    for (const d of this.definitions) {
      byOwner.set(d.ownerModule, (byOwner.get(d.ownerModule) ?? 0) + 1);
      byFamily.set(d.family, (byFamily.get(d.family) ?? 0) + 1);
      byTier.set(d.riskTier, (byTier.get(d.riskTier) ?? 0) + 1);
    }
    return {
      total: this.definitions.length,
      byOwner: Object.fromEntries(byOwner),
      byFamily: Object.fromEntries(byFamily),
      byRiskTier: Object.fromEntries([...byTier.entries()].map(([k, v]) => [String(k), v])),
    };
  }
}
