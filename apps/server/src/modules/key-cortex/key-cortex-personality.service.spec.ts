import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexPersonalityService } from './key-cortex-personality.service';
import { CortexContextSnapshot } from './key-cortex.types';

const baseContext: CortexContextSnapshot = {
  businessId: 'biz-1',
  genomeDna: { execution: 50, strategy: 50, finance: 50, marketing: 50, operations: 50 },
  genomeStage: 'startup',
  executiveReadiness: 50,
  recentTasks: [],
  recentEvents: [],
  keyMetrics: {},
  activeProjects: [],
  pendingInvoices: 0,
  unreadMessages: 0,
  teamStatus: '',
  timestamp: new Date(),
};

describe('KeyCortexPersonalityService', () => {
  let service: KeyCortexPersonalityService;

  beforeEach(() => {
    service = new KeyCortexPersonalityService();
  });

  describe('classifyPersona', () => {
    it('returns null when no model gateway is available', async () => {
      const result = await service.classifyPersona(
        'Analyze my revenue and margins',
        'biz-1',
      );
      expect(result).toBeNull();
    });

    it('returns the LLM-chosen persona when valid', async () => {
      const gateway = {
        complete: vi.fn().mockResolvedValue({ content: 'titan' }),
      };
      const serviceWithGateway = new KeyCortexPersonalityService(undefined, gateway as any);

      const result = await serviceWithGateway.classifyPersona(
        'Show me the numbers on our latest quarter',
        'biz-1',
      );

      expect(gateway.complete).toHaveBeenCalledWith(
        expect.objectContaining({
          businessId: 'biz-1',
          taskCategory: 'classification',
          temperature: 0,
          maxTokens: 20,
        }),
      );
      expect(result).toBe('titan');
    });

    it('returns null for ambiguous classifications', async () => {
      const gateway = {
        complete: vi.fn().mockResolvedValue({ content: 'ambiguous' }),
      };
      const serviceWithGateway = new KeyCortexPersonalityService(undefined, gateway as any);

      const result = await serviceWithGateway.classifyPersona('Hi', 'biz-1');
      expect(result).toBeNull();
    });

    it('returns null when LLM returns an unknown persona', async () => {
      const gateway = {
        complete: vi.fn().mockResolvedValue({ content: 'batman' }),
      };
      const serviceWithGateway = new KeyCortexPersonalityService(undefined, gateway as any);

      const result = await serviceWithGateway.classifyPersona('Hello', 'biz-1');
      expect(result).toBeNull();
    });

    it('returns null when LLM call fails', async () => {
      const gateway = {
        complete: vi.fn().mockRejectedValue(new Error('timeout')),
      };
      const serviceWithGateway = new KeyCortexPersonalityService(undefined, gateway as any);

      const result = await serviceWithGateway.classifyPersona('Hello', 'biz-1');
      expect(result).toBeNull();
    });
  });

  describe('selectTone', () => {
    it('returns mood-driven tone for urgent mood', async () => {
      const result = await service.selectTone('Any text', 'jarvis', 'urgent');
      expect(result.tone).toBe('urgent and concise');
      expect(result.temperatureAdjustment).toBeLessThanOrEqual(0);
    });

    it('returns creative tone and bounded adjustment for creative mood', async () => {
      const result = await service.selectTone('Any text', 'nova', 'creative');
      expect(result.tone).toBe('imaginative and energetic');
      expect(result.temperatureAdjustment).toBeGreaterThanOrEqual(-0.1);
      expect(result.temperatureAdjustment).toBeLessThanOrEqual(0.1);
    });

    it('infers urgent tone from query keywords', async () => {
      const result = await service.selectTone(
        'This is urgent and needs to happen immediately',
        'jarvis',
      );
      expect(result.tone).toBe('urgent and decisive');
      expect(result.temperatureAdjustment).toBe(-0.1);
    });

    it('infers creative tone from query keywords', async () => {
      const result = await service.selectTone(
        'Give me creative ideas for a campaign',
        'nova',
      );
      expect(result.tone).toBe('creative and expansive');
      expect(result.temperatureAdjustment).toBe(0.1);
    });

    it('infers analytical tone from query keywords', async () => {
      const result = await service.selectTone(
        'Analyze the ROI and metrics for me',
        'titan',
      );
      expect(result.tone).toBe('analytical and precise');
      expect(result.temperatureAdjustment).toBe(-0.05);
    });

    it('falls back to persona default tone', async () => {
      const result = await service.selectTone('Generic inquiry', 'jarvis');
      expect(result.tone).toContain('formal');
      expect(result.temperatureAdjustment).toBe(0);
    });
  });

  describe('buildSystemPrompt', () => {
    it('includes persona name and role expertise', () => {
      const prompt = service.buildSystemPrompt('titan', baseContext);
      expect(prompt).toContain('Titan');
      expect(prompt).toContain('ROLE EXPERTISE');
      expect(prompt).toContain('commerce');
    });
  });
});
