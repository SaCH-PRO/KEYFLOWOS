import { describe, expect, it, vi } from 'vitest';
import { BusinessCommandCenterService } from '../src/modules/business-command-center/business-command-center.service';
import { KeyInboxReplySenderService } from '../src/modules/key-inbox/key-inbox-reply-sender.service';

describe('KEYFlowOS operating system smoke', () => {
  it('BusinessCommandCenterService produces a full snapshot with mocked executive services', async () => {
    const service = new BusinessCommandCenterService(
      {
        generateExecutiveBrief: vi.fn().mockResolvedValue({
          summary: 'All systems nominal.',
          risks: [],
          opportunities: [],
          score: 88,
          insights: [],
        }),
      } as any,
      {
        generateModeBrief: vi.fn().mockResolvedValue({
          mode: 'STRATEGIST',
          label: 'Strategist',
          summary: 'No strategic issues.',
          findings: [],
          recommendedActions: [],
          risks: [],
          opportunities: [],
        }),
      } as any,
      {
        list: vi.fn().mockResolvedValue([]),
      } as any,
      {
        analyze: vi.fn().mockResolvedValue({
          urgentItems: [],
          risks: [],
          opportunities: [],
          summary: 'Temporal flow is calm.',
        }),
      } as any,
      {
        list: vi.fn().mockResolvedValue([]),
      } as any,
      {
        calculateGenomeIntegrity: vi.fn().mockResolvedValue({
          integrity: 72,
          stage: 'OPERATING_BUSINESS',
          weakestSections: [],
          dna: {},
        }),
      } as any,
      {
        list: vi.fn().mockResolvedValue([]),
      } as any,
      {
        latest: vi.fn().mockResolvedValue({ id: 'const_1', version: 1 }),
        staleness: vi.fn().mockResolvedValue({ stale: false }),
      } as any,
      {
        computeFactScores: vi.fn().mockResolvedValue([]),
        computeBusinessScore: vi.fn().mockReturnValue({
          businessId: 'biz_smoke',
          overall: 0,
          integrity: 0,
          readiness: 0,
          confidence: 0,
          sections: [],
          computedAt: new Date().toISOString(),
        }),
      } as any,
      {
        computeReadiness: vi.fn().mockResolvedValue([]),
      } as any,
      {
        listSignals: vi.fn().mockResolvedValue([]),
      } as any,
    );

    const snapshot = await service.snapshot('biz_smoke');

    expect(snapshot.businessId).toBe('biz_smoke');
    expect(snapshot.generatedAt).toBeDefined();
    expect(snapshot.health).toBeDefined();
    expect(Array.isArray(snapshot.topPriorities)).toBe(true);
    expect(Array.isArray(snapshot.pendingApprovals)).toBe(true);
    expect(Array.isArray(snapshot.urgentItems)).toBe(true);
    expect(Array.isArray(snapshot.risks)).toBe(true);
    expect(Array.isArray(snapshot.opportunities)).toBe(true);
    expect(snapshot.genome).toBeDefined();
    expect(snapshot.keyGenome).toBeDefined();
    expect(Array.isArray(snapshot.moduleReadiness)).toBe(true);
    expect(snapshot.constitution).toBeDefined();
    expect(Array.isArray(snapshot.executiveModes)).toBe(true);
    expect(Array.isArray(snapshot.recommendedActions)).toBe(true);
    expect(snapshot.executiveModes.length).toBeGreaterThan(0);
  });

  it('KeyInboxReplySenderService handles unsupported channels gracefully', async () => {
    const replySender = new KeyInboxReplySenderService(
      {} as any,
      {
        client: {
          keyInboxMessage: {
            findFirst: vi.fn().mockResolvedValue(null),
            update: vi.fn().mockResolvedValue({}),
          },
        },
      } as any,
      {
        emit: vi.fn().mockResolvedValue(undefined),
      } as any,
    );

    const result = await replySender.sendReply(
      'biz_smoke',
      { id: 'thread_1', channel: 'carrier_pigeon' } as any,
      { id: 'msg_1', contentText: 'hello' } as any,
      'user_1',
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe('FAILED');
    expect(result.error).toContain('Outbound send not implemented');
  });
});
