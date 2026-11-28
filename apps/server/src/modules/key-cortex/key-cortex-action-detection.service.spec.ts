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

    it('detects high-approval v1 actions like create invoice and omits v1-removed stub actions', () => {
      const invoiceActions = service.detectActions('Bill the client for consulting');
      const invoiceAction = invoiceActions.find((a) => a.actionType === 'CREATE_INVOICE');
      expect(invoiceAction).toBeDefined();
      expect(invoiceAction?.requiresApproval).toBe(true);

      const emailActions = service.detectActions('Send an email to the team');
      expect(emailActions.find((a) => a.actionType === 'SEND_EMAIL')).toBeUndefined();
      const reportActions = service.detectActions('Generate a monthly sales report');
      expect(reportActions.find((a) => a.actionType === 'GENERATE_REPORT')).toBeUndefined();
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
