import { describe, it, expect, beforeEach } from 'vitest';
import { KeyCortexActionDetectionService } from './key-cortex-action-detection.service';

describe('KeyCortexActionDetectionService', () => {
  let service: KeyCortexActionDetectionService;

  beforeEach(() => {
    service = new KeyCortexActionDetectionService();
  });

  describe('detectActions', () => {
    it('detects structured action markers', () => {
      const content =
        '[[ACTION:CREATE_TASK]]Follow up with the client[[/ACTION]]';
      const actions = service.detectActions(content);
      expect(actions).toHaveLength(1);
      expect(actions[0].actionType).toBe('CREATE_TASK');
      expect(actions[0].description).toBe('Follow up with the client');
      expect(actions[0].requiresApproval).toBe(false);
    });

    it('detects natural-language create-task intent', () => {
      const actions = service.detectActions('Please create a new task for me');
      expect(actions.some((a) => a.actionType === 'CREATE_TASK')).toBe(true);
    });

    it('detects high-approval actions like send email', () => {
      const actions = service.detectActions('Send an email to the team');
      const emailAction = actions.find((a) => a.actionType === 'SEND_EMAIL');
      expect(emailAction).toBeDefined();
      expect(emailAction?.requiresApproval).toBe(true);
    });

    it('deduplicates duplicate intent matches', () => {
      const actions = service.detectActions(
        'Create a task and also add a task for later',
      );
      expect(actions.filter((a) => a.actionType === 'CREATE_TASK')).toHaveLength(
        1,
      );
    });

    it('returns empty array when no actions detected', () => {
      const actions = service.detectActions('Just a general chat message');
      expect(actions).toHaveLength(0);
    });
  });

  describe('isValidActionType', () => {
    it('accepts known action types', () => {
      expect(service.isValidActionType('CREATE_TASK')).toBe(true);
      expect(service.isValidActionType('EXECUTE_TOOL')).toBe(true);
    });

    it('rejects unknown action types', () => {
      expect(service.isValidActionType('FLY_TO_MARS')).toBe(false);
    });
  });

  describe('requiresApproval', () => {
    it('requires approval for high-impact actions', () => {
      expect(service.requiresApproval('SEND_EMAIL')).toBe(true);
      expect(service.requiresApproval('CREATE_INVOICE')).toBe(true);
    });

    it('does not require approval for low-risk actions', () => {
      expect(service.requiresApproval('CREATE_TASK')).toBe(false);
      expect(service.requiresApproval('ANALYZE_DATA')).toBe(false);
    });
  });
});
