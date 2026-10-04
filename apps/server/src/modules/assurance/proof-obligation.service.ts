import { BadRequestException, Injectable } from '@nestjs/common';
import { z } from 'zod';

export const RISK_TIERS = ['R0', 'R1', 'R2', 'R3', 'R4'] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

export const assuranceInputSchema = z.object({
  declaredRisk: z.enum(RISK_TIERS),
  surfaces: z.object({
    authTenancy: z.boolean().default(false),
    moneyPayments: z.boolean().default(false),
    destructiveData: z.boolean().default(false),
    migration: z.boolean().default(false),
    externalIntegration: z.boolean().default(false),
    aiAgent: z.boolean().default(false),
    concurrency: z.boolean().default(false),
    infrastructure: z.boolean().default(false),
    userJourney: z.boolean().default(false),
  }),
});

export type AssuranceInput = z.infer<typeof assuranceInputSchema>;

export type ProofObligation =
  | 'STATIC'
  | 'UNIT_COMPONENT'
  | 'INTEGRATION_API'
  | 'REGRESSION'
  | 'SECURITY_TENANT'
  | 'CRITICAL_E2E'
  | 'NEGATIVE_CONTROLS'
  | 'EXACT_HEAD_REVIEW'
  | 'CONTRACT_PROVIDER'
  | 'MIGRATION_INTEGRITY'
  | 'AI_TEVV'
  | 'CONCURRENCY_STATE_MACHINE'
  | 'RESILIENCE_FAULT_INJECTION'
  | 'OBSERVABILITY'
  | 'RECOVERY_ROLLBACK'
  | 'POST_DEPLOY_VERIFY'
  | 'INDEPENDENT_REVIEW'
  | 'UAT_ACCESSIBILITY_COMPATIBILITY';

export interface ProofObligationResult {
  declaredRisk: RiskTier;
  effectiveRisk: RiskTier;
  riskEscalated: boolean;
  obligations: Array<{
    id: ProofObligation;
    reason: string;
  }>;
}

const rank: Record<RiskTier, number> = { R0: 0, R1: 1, R2: 2, R3: 3, R4: 4 };

function maxRisk(a: RiskTier, b: RiskTier): RiskTier {
  return rank[a] >= rank[b] ? a : b;
}

function surfaceFloor(input: AssuranceInput['surfaces']): RiskTier {
  let floor: RiskTier = 'R0';
  if (input.userJourney) floor = maxRisk(floor, 'R1');
  if (input.externalIntegration) floor = maxRisk(floor, 'R2');
  if (input.authTenancy || input.moneyPayments || input.destructiveData || input.migration || input.aiAgent) {
    floor = maxRisk(floor, 'R3');
  }
  if (input.concurrency || input.infrastructure) floor = maxRisk(floor, 'R4');
  return floor;
}

function baseForRisk(risk: RiskTier): ProofObligation[] {
  const out: ProofObligation[] = ['STATIC'];
  if (rank[risk] >= rank.R1) out.push('UNIT_COMPONENT');
  if (rank[risk] >= rank.R2) out.push('INTEGRATION_API', 'REGRESSION');
  if (rank[risk] >= rank.R3) {
    out.push('SECURITY_TENANT', 'CRITICAL_E2E', 'NEGATIVE_CONTROLS', 'EXACT_HEAD_REVIEW');
  }
  if (rank[risk] >= rank.R4) {
    out.push(
      'CONCURRENCY_STATE_MACHINE',
      'RESILIENCE_FAULT_INJECTION',
      'OBSERVABILITY',
      'RECOVERY_ROLLBACK',
      'POST_DEPLOY_VERIFY',
      'INDEPENDENT_REVIEW',
    );
  }
  return out;
}

function reasonFor(id: ProofObligation, input: AssuranceInput, effectiveRisk: RiskTier): string {
  switch (id) {
    case 'STATIC': return `${effectiveRisk} requires static/type/schema/security checks.`;
    case 'UNIT_COMPONENT': return `${effectiveRisk} requires deterministic unit/component proof.`;
    case 'INTEGRATION_API': return `${effectiveRisk} requires integration/API proof.`;
    case 'REGRESSION': return `${effectiveRisk} requires regression proof for affected invariants.`;
    case 'SECURITY_TENANT': return 'Critical-risk changes require authentication/authorization/tenant-isolation proof.';
    case 'CRITICAL_E2E': return 'Critical-risk changes require focused end-to-end proof of the affected business path.';
    case 'NEGATIVE_CONTROLS': return 'Critical-risk proof must demonstrate that restored defects make the proof fail.';
    case 'EXACT_HEAD_REVIEW': return 'Critical-risk review and proof must bind to the exact semantic head.';
    case 'CONTRACT_PROVIDER': return 'External integrations require provider/contract behavior proof, including failure modes.';
    case 'MIGRATION_INTEGRITY': return 'Schema/data migration requires ownership, referential-integrity and rollback proof.';
    case 'AI_TEVV': return 'AI/agent changes require task, authority, epistemic, tool-use and adversarial evaluation.';
    case 'CONCURRENCY_STATE_MACHINE': return 'Concurrency/systemic changes require safety and liveness/state-machine proof.';
    case 'RESILIENCE_FAULT_INJECTION': return 'Systemic changes require bounded fault-injection/resilience proof.';
    case 'OBSERVABILITY': return 'Systemic changes require proof that failures are detectable and causally attributable.';
    case 'RECOVERY_ROLLBACK': return 'Systemic changes require a proven recovery/rollback path.';
    case 'POST_DEPLOY_VERIFY': return 'Systemic changes require post-deploy verification bound to the released build.';
    case 'INDEPENDENT_REVIEW': return 'Systemic changes require an independent semantic review.';
    case 'UAT_ACCESSIBILITY_COMPATIBILITY': return 'User-facing journeys require usability/accessibility/compatibility release proof.';
    default: return 'Required by assurance policy.';
  }
}

@Injectable()
export class ProofObligationService {
  compile(raw: unknown): ProofObligationResult {
    const parsed = assuranceInputSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'ASSURANCE_INPUT_INVALID',
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const input = parsed.data;
    const effectiveRisk = maxRisk(input.declaredRisk, surfaceFloor(input.surfaces));
    const ids = new Set<ProofObligation>(baseForRisk(effectiveRisk));

    if (input.surfaces.externalIntegration) ids.add('CONTRACT_PROVIDER');
    if (input.surfaces.migration) ids.add('MIGRATION_INTEGRITY');
    if (input.surfaces.aiAgent) ids.add('AI_TEVV');
    if (input.surfaces.concurrency) ids.add('CONCURRENCY_STATE_MACHINE');
    if (input.surfaces.userJourney) ids.add('UAT_ACCESSIBILITY_COMPATIBILITY');

    return {
      declaredRisk: input.declaredRisk,
      effectiveRisk,
      riskEscalated: effectiveRisk !== input.declaredRisk,
      obligations: [...ids].map((id) => ({
        id,
        reason: reasonFor(id, input, effectiveRisk),
      })),
    };
  }
}
