import { describe, it, expect } from 'vitest';
import type {
  GenomeAutonomyCheckRequest,
  GenomeAutonomyCheckResponse,
  GenomeOutcomeReport,
  GenomeOutcomeAcknowledgment,
  GenomeEvidenceRequest,
  GenomeEvidenceResponse,
  CortexMemory,
  ProactiveTrigger,
  ToolDeclaration,
  TrustExplanation,
  FeatureVisibility,
} from '../cortex-genome-contracts';

describe('Phase 18A — Cortex ↔ Genome Contracts', () => {
  // ── Autonomy Check Request DTO ────────────────────────────

  describe('GenomeAutonomyCheckRequest', () => {
    it('should create a valid request with all fields', () => {
      const req: GenomeAutonomyCheckRequest = {
        businessId: 'biz_123',
        userId: 'user_456',
        sessionId: 'sess_789',
        action: {
          type: 'CREATE_TASK',
          params: { title: 'Test task' },
          riskLevel: 'low',
          estimatedImpact: 'Minimal business impact',
        },
        context: {
          genomeStage: 'growth',
          executiveReadiness: 65,
          dnaScores: { execution: 70, strategy: 60 },
          activeProjects: 3,
          pendingInvoices: 2,
          recentOutcomes: ['task_created'],
        },
      };

      expect(req.businessId).toBe('biz_123');
      expect(req.action.riskLevel).toBe('low');
      expect(req.context.executiveReadiness).toBe(65);
    });

    it('should accept all risk levels', () => {
      const levels: Array<'low' | 'medium' | 'high' | 'critical'> = ['low', 'medium', 'high', 'critical'];
      for (const riskLevel of levels) {
        const req: GenomeAutonomyCheckRequest = {
          businessId: 'biz_123', userId: 'user_456', sessionId: 'sess_789',
          action: { type: 'CREATE_TASK', params: {}, riskLevel },
          context: { genomeStage: '', executiveReadiness: 0, dnaScores: {}, activeProjects: 0, pendingInvoices: 0, recentOutcomes: [] },
        };
        expect(req.action.riskLevel).toBe(riskLevel);
      }
    });

    it('should handle optional estimatedImpact', () => {
      const req: GenomeAutonomyCheckRequest = {
        businessId: 'biz_123', userId: 'user_456', sessionId: 'sess_789',
        action: { type: 'CREATE_INVOICE', params: {}, riskLevel: 'high' },
        context: { genomeStage: '', executiveReadiness: 0, dnaScores: {}, activeProjects: 0, pendingInvoices: 0, recentOutcomes: [] },
      };
      expect(req.action.estimatedImpact).toBeUndefined();
    });
  });

  // ── Autonomy Check Response DTO ───────────────────────────

  describe('GenomeAutonomyCheckResponse', () => {
    it('should create a valid allowed response', () => {
      const resp: GenomeAutonomyCheckResponse = {
        allowed: true,
        requiresApproval: false,
        policy: { autonomyTier: 'full', maxRiskLevel: 'critical', dailyActionLimit: 50, remainingActions: 48 },
        genomeContext: { readinessScore: 85, relevantDnaDimensions: ['execution', 'strategy'], warnings: [] },
        explanation: 'Full autonomy granted.',
        nextBestAction: 'CREATE_TASK',
      };

      expect(resp.allowed).toBe(true);
      expect(resp.policy.autonomyTier).toBe('full');
      expect(resp.genomeContext.readinessScore).toBe(85);
    });

    it('should create a denied response', () => {
      const resp: GenomeAutonomyCheckResponse = {
        allowed: false,
        requiresApproval: true,
        policy: { autonomyTier: 'none', maxRiskLevel: 'low', dailyActionLimit: 0, remainingActions: 0 },
        genomeContext: { readinessScore: 15, relevantDnaDimensions: [], warnings: ['Readiness below threshold'] },
        explanation: 'Autonomy not granted due to low readiness.',
      };

      expect(resp.allowed).toBe(false);
      expect(resp.genomeContext.warnings.length).toBe(1);
    });

    it('should accept all autonomy tiers', () => {
      const tiers: Array<'none' | 'assisted' | 'semi' | 'full'> = ['none', 'assisted', 'semi', 'full'];
      for (const autonomyTier of tiers) {
        const resp: GenomeAutonomyCheckResponse = {
          allowed: autonomyTier !== 'none',
          requiresApproval: autonomyTier === 'assisted',
          policy: { autonomyTier, maxRiskLevel: 'medium', dailyActionLimit: 10, remainingActions: 10 },
          genomeContext: { readinessScore: 50, relevantDnaDimensions: [], warnings: [] },
          explanation: 'Test',
        };
        expect(resp.policy.autonomyTier).toBe(autonomyTier);
      }
    });
  });

  // ── Outcome Report DTO ────────────────────────────────────

  describe('GenomeOutcomeReport', () => {
    it('should create a success outcome', () => {
      const report: GenomeOutcomeReport = {
        businessId: 'biz_123',
        sessionId: 'sess_789',
        userId: 'user_456',
        action: { type: 'CREATE_TASK', params: { title: 'Done' }, status: 'success' },
        result: { description: 'Task created successfully' },
        timestamps: { proposedAt: new Date(), executedAt: new Date(), completedAt: new Date() },
        genomeSnapshot: { stage: 'growth', readiness: 65, dnaScores: { execution: 70 } },
      };

      expect(report.action.status).toBe('success');
      expect(report.genomeSnapshot.stage).toBe('growth');
    });

    it('should create a pending approval outcome', () => {
      const report: GenomeOutcomeReport = {
        businessId: 'biz_123',
        sessionId: 'sess_789',
        userId: 'user_456',
        action: { type: 'CREATE_INVOICE', params: {}, status: 'pending_approval' },
        result: { description: 'Awaiting approval' },
        timestamps: { proposedAt: new Date(), completedAt: new Date() },
        genomeSnapshot: { stage: 'seed', readiness: 20, dnaScores: {} },
      };

      expect(report.action.status).toBe('pending_approval');
      expect(report.timestamps.executedAt).toBeUndefined();
    });
  });

  describe('GenomeOutcomeAcknowledgment', () => {
    it('should confirm learning applied', () => {
      const ack: GenomeOutcomeAcknowledgment = {
        recorded: true,
        outcomeId: 'out_123',
        learningApplied: true,
        recommendationsUpdated: true,
        confidenceDelta: 0.05,
      };

      expect(ack.recorded).toBe(true);
      expect(ack.confidenceDelta).toBe(0.05);
    });
  });

  // ── Evidence DTOs ─────────────────────────────────────────

  describe('GenomeEvidenceRequest/Response', () => {
    it('should request evidence from multiple sources', () => {
      const req: GenomeEvidenceRequest = {
        businessId: 'biz_123',
        claim: 'Revenue is declining',
        dataSources: ['invoices', 'payments', 'genome'],
        confidenceRequired: 0.8,
      };

      expect(req.dataSources).toHaveLength(3);
      expect(req.confidenceRequired).toBe(0.8);
    });

    it('should return verified evidence', () => {
      const resp: GenomeEvidenceResponse = {
        claim: 'Revenue is declining',
        verified: true,
        evidence: [
          { source: 'invoices', data: { revenue: 5000, previous: 8000 }, relevance: 0.95, timestamp: new Date() },
        ],
        confidence: 0.85,
        gaps: ['Customer churn data not available'],
      };

      expect(resp.verified).toBe(true);
      expect(resp.evidence[0].relevance).toBe(0.95);
    });
  });

  // ── Memory DTO ────────────────────────────────────────────

  describe('CortexMemory', () => {
    it('should create all memory types', () => {
      const types = [
        'user_preference', 'business_fact', 'past_decision', 'failed_attempt',
        'successful_action', 'communication_style', 'risk_tolerance',
        'common_workflow', 'current_goal', 'long_term_strategy',
      ];

      for (const type of types) {
        const mem: CortexMemory = {
          id: `mem_${type}`,
          businessId: 'biz_123',
          type: type as CortexMemory['type'],
          key: 'test_key',
          value: 'test_value',
          confidence: 0.8,
          source: 'inferred',
          lastAccessedAt: new Date(),
          createdAt: new Date(),
          accessCount: 1,
        };
        expect(mem.type).toBe(type);
      }
    });

    it('should track access count for importance weighting', () => {
      const mem: CortexMemory = {
        id: 'mem_1', businessId: 'biz', type: 'user_preference',
        key: 'style', value: 'brief', confidence: 0.9,
        source: 'explicit', lastAccessedAt: new Date(),
        createdAt: new Date(), accessCount: 42,
      };
      expect(mem.accessCount).toBe(42);
    });
  });

  // ── Proactive Trigger DTO ─────────────────────────────────

  describe('ProactiveTrigger', () => {
    it('should create all trigger types', () => {
      const types = [
        'morning_brief', 'end_of_day_report', 'risk_alert', 'opportunity_alert',
        'follow_up_reminder', 'missed_task', 'revenue_anomaly',
        'customer_escalation', 'genome_weakness', 'invoice_overdue', 'lead_dormant',
      ];

      for (const type of types) {
        const trig: ProactiveTrigger = {
          id: `trig_${type}`,
          type: type as ProactiveTrigger['type'],
          businessId: 'biz_123',
          scheduledAt: new Date(),
          priority: type === 'risk_alert' ? 'high' : 'medium',
          data: {},
        };
        expect(trig.type).toBe(type);
      }
    });
  });

  // ── Tool Declaration DTO ──────────────────────────────────

  describe('ToolDeclaration', () => {
    it('should declare a complete tool', () => {
      const tool: ToolDeclaration = {
        id: 'task.create',
        name: 'Create Task',
        description: 'Create a task',
        category: 'workflow',
        genomeRequirements: { minStage: 'seed', minReadiness: 10, requiredDna: {} },
        riskLevel: 'low',
        requiresApproval: false,
        dryRunSupported: true,
        rollbackSupported: true,
        executorRef: 'KeyCortexActionsService.handleCreateTask',
        parameters: {},
        auditPayload: { logsInput: true, logsOutput: true, retentionDays: 90 },
        outcomeTracking: { tracksSuccess: true, tracksFailure: true, successMetrics: ['task_completed'] },
      };

      expect(tool.id).toBe('task.create');
      expect(tool.riskLevel).toBe('low');
    });
  });

  // ── Trust Explanation DTO ─────────────────────────────────

  describe('TrustExplanation', () => {
    it('should create a complete explanation', () => {
      const exp: TrustExplanation = {
        reasoning: 'Revenue declining based on invoice data.',
        evidence: [{ source: 'invoices', data: 'Revenue: 5K vs 8K last month', relevance: 0.95 }],
        risks: [{ description: 'Cash flow impact', probability: 'high', impact: 'May affect operations' }],
        genomeFacts: [{ dimension: 'finance', score: 45, fact: 'Finance DNA below threshold' }],
        knowledgeGaps: ['External market conditions unknown'],
        inactionConsequence: 'Revenue continues declining.',
        trackingPlan: [{ metric: 'revenue_recovery', target: 'Return to 8K', timeframe: '30 days' }],
        rollbackPlan: 'Can adjust strategy if needed.',
      };

      expect(exp.reasoning).toContain('Revenue declining');
      expect(exp.rollbackPlan).toBeDefined();
    });
  });

  // ── Feature Visibility DTO ────────────────────────────────

  describe('FeatureVisibility', () => {
    it('should define visibility for all three tiers', () => {
      const fv: FeatureVisibility = {
        featureId: 'crm.pipelines',
        module: 'crm',
        beginner: false,
        intermediate: true,
        advanced: true,
        unlockCriteria: { usageCount: 10 },
      };

      expect(fv.beginner).toBe(false);
      expect(fv.intermediate).toBe(true);
      expect(fv.unlockCriteria?.usageCount).toBe(10);
    });
  });
});
