import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeyInboxService } from './key-inbox.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { KeyInboxActionService } from './key-inbox-action.service';
import { KeyInboxAnalysisService } from './key-inbox-analysis.service';
import { KeyInboxTemporalEmitterService } from './key-inbox-temporal-emitter.service';
import { KeyInboxReplySenderService } from './key-inbox-reply-sender.service';
import { GenomeSignalService } from '../business-genome/key-genome/genome-signal.service';

describe('KeyInboxService genome signal pipeline', () => {
  let service: KeyInboxService;
  let prisma: {
    client: {
      keyInboxThread: {
        findFirst: ReturnType<typeof vi.fn>;
        update: ReturnType<typeof vi.fn>;
      };
      keyInboxMessage: { findMany: ReturnType<typeof vi.fn> };
    };
  };
  let analysisService: { analyzeThread: ReturnType<typeof vi.fn> };
  let actionService: { buildActions: ReturnType<typeof vi.fn> };
  let temporalEmitter: {
    emitMessageAnalyzed: ReturnType<typeof vi.fn>;
    emitActionSuggested: ReturnType<typeof vi.fn>;
  };
  let genomeSignal: { createSignal: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    prisma = {
      client: {
        keyInboxThread: {
          findFirst: vi.fn(),
          update: vi.fn(),
        },
        keyInboxMessage: { findMany: vi.fn() },
      },
    };
    analysisService = { analyzeThread: vi.fn() };
    actionService = { buildActions: vi.fn() };
    temporalEmitter = {
      emitMessageAnalyzed: vi.fn(),
      emitActionSuggested: vi.fn(),
    };
    genomeSignal = { createSignal: vi.fn() };

    service = new KeyInboxService(
      prisma as unknown as PrismaService,
      analysisService as unknown as KeyInboxAnalysisService,
      actionService as unknown as KeyInboxActionService,
      temporalEmitter as unknown as KeyInboxTemporalEmitterService,
      {} as AiUsageService,
      {} as KeyInboxReplySenderService,
      genomeSignal as unknown as GenomeSignalService,
    );
  });

  it('creates a genome signal when thread has strong complaint intent', async () => {
    prisma.client.keyInboxThread.findFirst.mockResolvedValue({ id: 't1', businessId: 'b1', subject: 'Complaint', channel: 'email' });
    prisma.client.keyInboxMessage.findMany.mockResolvedValue([]);
    prisma.client.keyInboxThread.update.mockResolvedValue({ id: 't1' });
    analysisService.analyzeThread.mockResolvedValue({
      intent: 'complaint',
      urgency: 'high',
      sentiment: 'angry',
      summary: 'Customer is upset',
      entities: {},
      confidence: 0.9,
    });
    actionService.buildActions.mockResolvedValue([]);

    await service.analyzeThread('b1', 't1');

    expect(genomeSignal.createSignal).toHaveBeenCalled();
    const call = genomeSignal.createSignal.mock.calls[0][0];
    expect(call.signalType).toBe('RISK_PATTERN');
    expect(call.section).toBe('risk');
    expect(call.sourceEntityId).toBe('t1');
  });

  it('creates an operations signal for booking intent', async () => {
    prisma.client.keyInboxThread.findFirst.mockResolvedValue({ id: 't2', businessId: 'b1', subject: 'Booking', channel: 'whatsapp' });
    prisma.client.keyInboxMessage.findMany.mockResolvedValue([]);
    prisma.client.keyInboxThread.update.mockResolvedValue({ id: 't2' });
    analysisService.analyzeThread.mockResolvedValue({
      intent: 'booking_request',
      urgency: 'normal',
      sentiment: 'neutral',
      summary: 'Wants to book',
      entities: {},
      confidence: 0.8,
    });
    actionService.buildActions.mockResolvedValue([]);

    await service.analyzeThread('b1', 't2');

    const call = genomeSignal.createSignal.mock.calls[0][0];
    expect(call.signalType).toBe('OPERATIONS_PATTERN');
    expect(call.domain).toBe('bookings');
  });

  it('does not create signal for low-urgency neutral threads', async () => {
    prisma.client.keyInboxThread.findFirst.mockResolvedValue({ id: 't3', businessId: 'b1', subject: 'Hello', channel: 'email' });
    prisma.client.keyInboxMessage.findMany.mockResolvedValue([]);
    prisma.client.keyInboxThread.update.mockResolvedValue({ id: 't3' });
    analysisService.analyzeThread.mockResolvedValue({
      intent: 'general_inquiry',
      urgency: 'low',
      sentiment: 'neutral',
      summary: 'Hello',
      entities: {},
      confidence: 0.6,
    });
    actionService.buildActions.mockResolvedValue([]);

    await service.analyzeThread('b1', 't3');

    expect(genomeSignal.createSignal).not.toHaveBeenCalled();
  });
});
