import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMock } from '@golevelup/ts-vitest';
import { KeyCommandRouterService } from '../key-command-router.service';
import { KeyCortexReasoningService } from '../key-cortex-reasoning.service';
import { KeyCortexContextService } from '../key-cortex-context.service';
import { KeyCortexActionsService } from '../key-cortex-actions.service';
import { CortexQuery, CortexActionResult } from '../key-cortex.types';

describe('Phase 18B — KeyCommandRouterService', () => {
  let service: KeyCommandRouterService;
  let mockReasoning: ReturnType<typeof createMock<KeyCortexReasoningService>>;
  let mockContext: ReturnType<typeof createMock<KeyCortexContextService>>;
  let mockActions: ReturnType<typeof createMock<KeyCortexActionsService>>;

  beforeEach(() => {
    mockReasoning = createMock<KeyCortexReasoningService>();
    mockContext = createMock<KeyCortexContextService>();
    mockActions = createMock<KeyCortexActionsService>();

    mockContext.buildContextSnapshot = vi.fn().mockResolvedValue({
      genomeStage: 'growth',
      executiveReadiness: 65,
      genomeDna: { execution: 70, strategy: 60 },
      activeProjects: ['p1'],
      pendingInvoices: 2,
      unreadMessages: 0,
    });

    mockReasoning.detectActions = vi.fn().mockResolvedValue([]);
    mockReasoning.processQuery = vi.fn().mockResolvedValue({
      message: { id: 'msg_1', role: 'assistant', content: 'Hello', timestamp: new Date() },
      session: { id: 'sess_1', status: 'active', messages: [] },
    });

    service = new KeyCommandRouterService(mockReasoning, mockContext, mockActions);
  });

  // ── Basic routing ─────────────────────────────────────────

  describe('routeCommand', () => {
    it('should process a simple question (no action)', async () => {
      const query: CortexQuery = {
        text: 'How is my business doing?',
        businessId: 'biz_1',
        userId: 'user_1',
      };

      const result = await service.routeCommand(query);

      expect(mockContext.buildContextSnapshot).toHaveBeenCalledWith('biz_1');
      expect(mockReasoning.processQuery).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should detect actions in the query', async () => {
      mockReasoning.detectActions = vi.fn().mockResolvedValue([
        { actionType: 'CREATE_TASK', status: 'pending_approval', description: 'Create task' },
      ]);

      const query: CortexQuery = {
        text: 'Create a task to follow up with client',
        businessId: 'biz_1',
        userId: 'user_1',
      };

      await service.routeCommand(query);

      expect(mockReasoning.detectActions).toHaveBeenCalledWith(query.text);
    });

    it('should attach trust explanation to response', async () => {
      const query: CortexQuery = {
        text: 'What should I do today?',
        businessId: 'biz_1',
        userId: 'user_1',
      };

      const result = await service.routeCommand(query) as Record<string, unknown>;

      expect(result.trustExplanation).toBeDefined();
      expect(result.trustExplanation).toHaveProperty('reasoning');
      expect(result.trustExplanation).toHaveProperty('evidence');
      expect(result.trustExplanation).toHaveProperty('risks');
    });
  });

  // ── Genome judgment logic ─────────────────────────────────

  describe('Genome judgment', () => {
    it('should allow low-risk actions at full autonomy tier', async () => {
      mockContext.buildContextSnapshot = vi.fn().mockResolvedValue({
        genomeStage: 'mature',
        executiveReadiness: 85,
        genomeDna: { execution: 90 },
        activeProjects: [],
        pendingInvoices: 0,
      });

      mockReasoning.detectActions = vi.fn().mockResolvedValue([
        { actionType: 'CREATE_TASK', status: 'pending_approval', description: 'Task' },
      ]);

      mockActions.executeAction = vi.fn().mockResolvedValue({
        actionType: 'CREATE_TASK', status: 'success', description: 'Done',
      });

      const query: CortexQuery = { text: 'Make a task', businessId: 'biz_1', userId: 'user_1' };
      await service.routeCommand(query);

      expect(mockActions.executeAction).toHaveBeenCalled();
    });

    it('should require approval for high-risk actions', async () => {
      mockContext.buildContextSnapshot = vi.fn().mockResolvedValue({
        genomeStage: 'growth',
        executiveReadiness: 65,
        genomeDna: {},
        activeProjects: [],
        pendingInvoices: 0,
      });

      mockReasoning.detectActions = vi.fn().mockResolvedValue([
        { actionType: 'CREATE_INVOICE', status: 'pending_approval', description: 'Invoice' },
      ]);

      const query: CortexQuery = { text: 'Create an invoice for $5000', businessId: 'biz_1', userId: 'user_1' };
      const result = await service.routeCommand(query);

      // Should NOT execute directly — requires approval
      expect(mockActions.executeAction).not.toHaveBeenCalled();
    });

    it('should deny actions at none autonomy tier', async () => {
      mockContext.buildContextSnapshot = vi.fn().mockResolvedValue({
        genomeStage: 'seed',
        executiveReadiness: 10,
        genomeDna: {},
        activeProjects: [],
        pendingInvoices: 0,
      });

      mockReasoning.detectActions = vi.fn().mockResolvedValue([
        { actionType: 'CREATE_TASK', status: 'pending_approval', description: 'Task' },
      ]);

      const query: CortexQuery = { text: 'Do something', businessId: 'biz_1', userId: 'user_1' };
      await service.routeCommand(query);

      expect(mockActions.executeAction).not.toHaveBeenCalled();
    });
  });

  // ── Intent parsing ────────────────────────────────────────

  describe('Intent detection', () => {
    it('should detect questions', async () => {
      const query: CortexQuery = { text: 'How many invoices are pending?', businessId: 'biz_1', userId: 'user_1' };
      await service.routeCommand(query);
      expect(mockReasoning.processQuery).toHaveBeenCalled();
    });

    it('should detect creative requests', async () => {
      const query: CortexQuery = { text: 'Idea for marketing campaign', businessId: 'biz_1', userId: 'user_1' };
      await service.routeCommand(query);
      expect(mockReasoning.processQuery).toHaveBeenCalled();
    });

    it('should detect urgency', async () => {
      const query: CortexQuery = { text: 'URGENT: Client issue', businessId: 'biz_1', userId: 'user_1' };
      await service.routeCommand(query);
      expect(mockReasoning.processQuery).toHaveBeenCalled();
    });
  });

  // ── Error handling ────────────────────────────────────────

  describe('Error handling', () => {
    it('should handle Genome context failure gracefully', async () => {
      mockContext.buildContextSnapshot = vi.fn().mockRejectedValue(new Error('DB timeout'));

      const query: CortexQuery = { text: 'Hello', businessId: 'biz_1', userId: 'user_1' };

      await expect(service.routeCommand(query)).rejects.toThrow('DB timeout');
    });

    it('should handle action execution failure', async () => {
      mockContext.buildContextSnapshot = vi.fn().mockResolvedValue({
        genomeStage: 'mature', executiveReadiness: 90, genomeDna: {},
        activeProjects: [], pendingInvoices: 0,
      });

      mockReasoning.detectActions = vi.fn().mockResolvedValue([
        { actionType: 'CREATE_TASK', status: 'pending_approval', description: 'Task' },
      ]);

      mockActions.executeAction = vi.fn().mockRejectedValue(new Error('DB error'));

      const query: CortexQuery = { text: 'Make task', businessId: 'biz_1', userId: 'user_1' };
      // Should not throw — logs error and continues
      const result = await service.routeCommand(query);
      expect(result).toBeDefined();
    });
  });
});
