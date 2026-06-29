import { BadRequestException, NotFoundException } from '@nestjs/common';
import { KeyCortexController } from './key-cortex.controller';
import { KeyCortexReasoningService } from './key-cortex-reasoning.service';
import { KeyCortexConversationService } from './key-cortex-conversation.service';
import { KeyAutonomySafetyService } from '../key-autonomy/key-autonomy-safety.service';
import { CortexSession } from './key-cortex.types';

describe('KeyCortexController new endpoints', () => {
  let controller: KeyCortexController;
  let conversation: Partial<KeyCortexConversationService>;
  let reasoning: Partial<KeyCortexReasoningService>;
  let safety: Partial<KeyAutonomySafetyService>;

  const mockSession: CortexSession = {
    id: 'sess_1',
    businessId: 'biz_1',
    userId: 'user_1',
    messages: [
      { id: 'm1', role: 'user', content: 'Hello', timestamp: new Date('2026-06-29T00:00:00Z'), metadata: {} },
      { id: 'm2', role: 'assistant', content: 'Hi there', timestamp: new Date('2026-06-29T00:00:01Z'), metadata: { model: 'gpt-4o' } },
    ],
  } as any;

  const mockProfile = {
    businessId: 'biz_1',
    globalKillSwitch: false,
    maxDailyAutoActions: 10,
    maxDailySpendTtd: 0,
    maxTierWithoutApproval: 3,
    notifyOnBlock: true,
  };

  beforeEach(() => {
    conversation = {
      getSession: vi.fn().mockResolvedValue(mockSession),
      listSessions: vi.fn().mockResolvedValue([mockSession]),
    };

    reasoning = {
      streamQuery: vi.fn().mockImplementation(async function* () {
        yield { type: 'text_delta', content: 'Working' };
        yield { type: 'done' };
      }),
    };

    safety = {
      ensureProfile: vi.fn().mockResolvedValue(mockProfile),
      updateProfile: vi.fn().mockImplementation(async (_businessId: string, updates: any) => ({ ...mockProfile, ...updates })),
    };

    controller = new KeyCortexController(
      reasoning as KeyCortexReasoningService,
      conversation as KeyCortexConversationService,
      {} as any, // voice
      {} as any, // personality
      {} as any, // actions
      {} as any, // context
      {} as any, // connector
      {} as any, // command
      {} as any, // executor
      {} as any, // contextV2
      {} as any, // insight
      {} as any, // monitorV2
      {} as any, // sandbox
      {} as any, // flowStudio
      {} as any, // externalConnector
      {} as any, // evolution
      {} as any, // phone
      {} as any, // document
      {} as any, // learning
      safety as KeyAutonomySafetyService,
      {} as any, // approvalOrchestrator
    );
  });

  describe('GET /api/v1/cortex/messages', () => {
    it('returns messages for the latest session when no sessionId is given', async () => {
      const result = await controller.getMessages('biz_1');
      expect(conversation.listSessions).toHaveBeenCalledWith('biz_1');
      expect(result.messages).toHaveLength(2);
      expect(result.messages[1].sender).toBe('key');
    });

    it('returns messages for a specific sessionId', async () => {
      const result = await controller.getMessages('biz_1', 'sess_1');
      expect(conversation.getSession).toHaveBeenCalledWith('sess_1');
      expect(result.messages).toHaveLength(2);
    });

    it('throws when businessId is missing', async () => {
      await expect(controller.getMessages('')).rejects.toThrow(BadRequestException);
    });

    it('throws when no session exists', async () => {
      (conversation.listSessions as any) = vi.fn().mockResolvedValue([]);
      await expect(controller.getMessages('biz_1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('Sse /api/v1/cortex/stream', () => {
    it('streams query results when a message is provided', async () => {
      const observable = controller.streamEvents('biz_1', 'Do something');
      const values: any[] = [];
      await new Promise<void>((resolve, reject) => {
        observable.subscribe({
          next: (v) => values.push(v.data),
          error: reject,
          complete: resolve,
        });
      });

      expect(reasoning.streamQuery).toHaveBeenCalledWith(
        expect.objectContaining({ businessId: 'biz_1', text: 'Do something', enableActions: true }),
      );
      expect(values.some((v) => v.type === 'chunk' && v.content === 'Working')).toBe(true);
      expect(values.some((v) => v.type === 'complete')).toBe(true);
    });

    it('sends heartbeat when no message is provided', async () => {
      vi.useFakeTimers();
      const observable = controller.streamEvents('biz_1');
      const values: any[] = [];
      const sub = observable.subscribe((v) => values.push(v.data));

      vi.advanceTimersByTime(16000);
      sub.unsubscribe();
      vi.useRealTimers();

      expect(values.length).toBeGreaterThan(0);
      expect(values[0]).toMatchObject({ type: 'heartbeat', businessId: 'biz_1' });
    });

    it('throws when businessId is missing', () => {
      expect(() => controller.streamEvents('')).toThrow(BadRequestException);
    });
  });

  describe('autonomy profile', () => {
    it('returns the autonomy profile', async () => {
      const result = await controller.getAutonomyProfile('biz_1');
      expect(safety.ensureProfile).toHaveBeenCalledWith('biz_1');
      expect(result).toEqual(mockProfile);
    });

    it('updates the autonomy profile', async () => {
      const dto = { businessId: 'biz_1', globalKillSwitch: true };
      const result = await controller.updateAutonomyProfile(dto as any);
      expect(safety.updateProfile).toHaveBeenCalledWith('biz_1', dto);
      expect(result.globalKillSwitch).toBe(true);
    });
  });
});
