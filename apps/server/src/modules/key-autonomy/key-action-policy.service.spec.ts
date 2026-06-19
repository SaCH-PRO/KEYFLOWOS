import { describe, it, expect } from 'vitest';
import { KeyActionPolicyService } from './key-action-policy.service';

describe('KeyActionPolicyService', () => {
  const policy = new KeyActionPolicyService();

  it('returns policy for every supported action type', () => {
    expect(policy.getPolicy('CREATE_TASK').executable).toBe(true);
    expect(policy.getPolicy('OPEN_GENOME').executable).toBe(false);
  });

  it('only marks implemented handlers as executable', () => {
    const executable: string[] = [
      'CREATE_TASK',
      'GENERATE_CONSTITUTION_VERSION',
      'GENERATE_DOCUMENT_EXPORT',
      'CREATE_GENOME_EVOLUTION_PROPOSAL',
    ];
    const notExecutable: string[] = [
      'OPEN_GENOME',
      'OPEN_TEMPORAL_FLOW',
      'OPEN_INTELLIGENCE',
      'REVIEW_EVOLUTION_PROPOSALS',
      'REVIEW_ASSETS',
      'OPEN_CONSTITUTION',
      'OPEN_KEY_INBOX',
      'CREATE_DOCUMENT',
      'REQUEST_APPROVAL',
      'SCHEDULE_FOLLOWUP',
      'ESCALATE_THREAD',
    ];

    for (const action of executable) {
      expect(policy.isExecutable(action as any)).toBe(true);
    }
    for (const action of notExecutable) {
      expect(policy.isExecutable(action as any)).toBe(false);
    }
  });

  it('requires approval for executable actions and REQUEST_APPROVAL', () => {
    expect(policy.requiresApproval('CREATE_TASK')).toBe(true);
    expect(policy.requiresApproval('GENERATE_DOCUMENT_EXPORT')).toBe(true);
    expect(policy.requiresApproval('REQUEST_APPROVAL')).toBe(true);
    expect(policy.requiresApproval('OPEN_GENOME')).toBe(false);
    expect(policy.requiresApproval('CREATE_DOCUMENT')).toBe(false);
  });

  it('throws for unsupported action types', () => {
    expect(() => policy.getPolicy('UNKNOWN' as any)).toThrow('Unsupported action type');
  });
});
