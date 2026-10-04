import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ProofObligationService } from './proof-obligation.service';

const service = new ProofObligationService();
const empty = {
  authTenancy: false,
  moneyPayments: false,
  destructiveData: false,
  migration: false,
  externalIntegration: false,
  aiAgent: false,
  concurrency: false,
  infrastructure: false,
  userJourney: false,
};

describe('ProofObligationService', () => {
  it('keeps R0 minimal when no higher-risk surface exists', () => {
    const out = service.compile({ declaredRisk: 'R0', surfaces: empty });
    expect(out.effectiveRisk).toBe('R0');
    expect(out.riskEscalated).toBe(false);
    expect(out.obligations.map((x) => x.id)).toEqual(['STATIC']);
  });

  it('never accepts a declared risk below the minimum implied by auth/tenancy', () => {
    const out = service.compile({
      declaredRisk: 'R1',
      surfaces: { ...empty, authTenancy: true },
    });
    expect(out.effectiveRisk).toBe('R3');
    expect(out.riskEscalated).toBe(true);
    expect(out.obligations.map((x) => x.id)).toEqual(expect.arrayContaining([
      'SECURITY_TENANT',
      'CRITICAL_E2E',
      'NEGATIVE_CONTROLS',
      'EXACT_HEAD_REVIEW',
    ]));
  });

  it('escalates concurrency/infrastructure work to R4 and requires resilience/liveness proof', () => {
    const out = service.compile({
      declaredRisk: 'R2',
      surfaces: { ...empty, concurrency: true },
    });
    expect(out.effectiveRisk).toBe('R4');
    expect(out.obligations.map((x) => x.id)).toEqual(expect.arrayContaining([
      'CONCURRENCY_STATE_MACHINE',
      'RESILIENCE_FAULT_INJECTION',
      'OBSERVABILITY',
      'RECOVERY_ROLLBACK',
      'POST_DEPLOY_VERIFY',
      'INDEPENDENT_REVIEW',
    ]));
  });

  it('adds domain-specific proof without removing base risk obligations', () => {
    const out = service.compile({
      declaredRisk: 'R3',
      surfaces: {
        ...empty,
        migration: true,
        externalIntegration: true,
        aiAgent: true,
        userJourney: true,
      },
    });
    const ids = out.obligations.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining([
      'STATIC',
      'INTEGRATION_API',
      'SECURITY_TENANT',
      'CONTRACT_PROVIDER',
      'MIGRATION_INTEGRITY',
      'AI_TEVV',
      'UAT_ACCESSIBILITY_COMPATIBILITY',
    ]));
  });

  it('fails closed on unknown risk values instead of silently defaulting', () => {
    expect(() => service.compile({ declaredRisk: 'R9', surfaces: empty })).toThrow(BadRequestException);
  });

  it('fails closed when the surface contract is incomplete', () => {
    expect(() => service.compile({ declaredRisk: 'R3', surfaces: { authTenancy: true } })).toThrow(BadRequestException);
  });
});
