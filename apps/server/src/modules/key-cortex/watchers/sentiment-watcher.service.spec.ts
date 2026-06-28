import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SentimentWatcherService } from './sentiment-watcher.service';

function createMockPrisma(overrides: any = {}) {
  return {
    client: {
      keyInboxMessage: {
        findMany: vi.fn().mockResolvedValue(overrides.keyInboxMessages ?? []),
      },
      directMessage: {
        findMany: vi.fn().mockResolvedValue(overrides.directMessages ?? []),
      },
      message: {
        findMany: vi.fn().mockResolvedValue(overrides.messages ?? []),
      },
      business: {
        findMany: vi.fn().mockResolvedValue(overrides.businesses ?? []),
      },
    },
  };
}

function createEventBus() {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
  };
}

describe('SentimentWatcherService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits proactive.negative_sentiment for messages matching negative keywords', async () => {
    const keyInboxMessages = [
      {
        id: 'kim_1',
        channel: 'email',
        contentText: 'I am very disappointed with the terrible service.',
        direction: 'INBOUND',
        receivedAt: new Date(),
        createdAt: new Date(),
        senderName: 'Alice',
        senderEmail: 'alice@example.com',
        threadId: 'th_1',
      },
    ];
    const mockPrisma = createMockPrisma({ keyInboxMessages });
    const eventBus = createEventBus();
    const service = new SentimentWatcherService(mockPrisma as any, eventBus as any);

    const count = await service.scan('biz_1');

    expect(count).toBe(1);
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'proactive_watcher',
        type: 'proactive.negative_sentiment',
        businessId: 'biz_1',
        payload: expect.objectContaining({
          messageId: 'kim_1',
          keywords: expect.arrayContaining(['disappointed', 'terrible']),
        }),
      }),
    );
  });

  it('does not emit events for neutral messages', async () => {
    const keyInboxMessages = [
      {
        id: 'kim_2',
        channel: 'email',
        contentText: 'Thanks for the quick response.',
        direction: 'INBOUND',
        receivedAt: new Date(),
        createdAt: new Date(),
        senderName: 'Bob',
        senderEmail: 'bob@example.com',
        threadId: 'th_2',
      },
    ];
    const mockPrisma = createMockPrisma({ keyInboxMessages });
    const eventBus = createEventBus();
    const service = new SentimentWatcherService(mockPrisma as any, eventBus as any);

    const count = await service.scan('biz_1');

    expect(count).toBe(0);
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('detectSentiment returns detected true with matching keywords', async () => {
    const service = new SentimentWatcherService({} as any, {} as any);
    const result = await service.detectSentiment('This is absolutely unacceptable and ridiculous.');

    expect(result.detected).toBe(true);
    expect(result.keywords).toContain('unacceptable');
    expect(result.keywords).toContain('ridiculous');
    expect(result.score).toBeGreaterThan(0.4);
  });

  it('detectSentiment returns detected false for neutral text', async () => {
    const service = new SentimentWatcherService({} as any, {} as any);
    const result = await service.detectSentiment('Hello, can we schedule a call next week?');

    expect(result.detected).toBe(false);
    expect(result.keywords).toHaveLength(0);
  });

  it('optionally boosts score when LLM confirms negative sentiment', async () => {
    const modelGateway = {
      complete: vi.fn().mockResolvedValue({ text: 'NEGATIVE:0.95:customer is angry about refund' }),
    };
    const service = new SentimentWatcherService({} as any, {} as any, modelGateway as any);
    const result = await service.detectSentiment('I want a refund, this is fraud!');

    expect(result.detected).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.95);
    expect(result.llmReason).toContain('angry');
  });

  it('scanAll iterates active businesses and sums emitted events', async () => {
    const businesses = [{ id: 'biz_1' }];
    const keyInboxMessages = [
      {
        id: 'kim_3',
        channel: 'whatsapp',
        contentText: 'I hate this product.',
        direction: 'INBOUND',
        receivedAt: new Date(),
        createdAt: new Date(),
        senderName: 'Carol',
        senderEmail: null,
        threadId: 'th_3',
      },
    ];
    const mockPrisma = createMockPrisma({ businesses, keyInboxMessages });
    const eventBus = createEventBus();
    const service = new SentimentWatcherService(mockPrisma as any, eventBus as any);

    const count = await service.scanAll();

    expect(count).toBe(1);
  });

  it('scanAll isolates failures per business', async () => {
    const businesses = [{ id: 'biz_ok' }, { id: 'biz_fail' }];
    const mockPrisma = createMockPrisma({ businesses });
    mockPrisma.client.keyInboxMessage.findMany
      .mockResolvedValueOnce([
        {
          id: 'kim_ok',
          channel: 'email',
          contentText: 'worst experience ever',
          direction: 'INBOUND',
          receivedAt: new Date(),
          createdAt: new Date(),
          senderName: null,
          senderEmail: null,
          threadId: null,
        },
      ])
      .mockRejectedValueOnce(new Error('DB error'));
    const eventBus = createEventBus();
    const service = new SentimentWatcherService(mockPrisma as any, eventBus as any);

    const count = await service.scanAll();

    expect(count).toBe(1);
  });
});
