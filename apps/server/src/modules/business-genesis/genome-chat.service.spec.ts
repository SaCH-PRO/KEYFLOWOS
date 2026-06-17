import { describe, expect, it, vi } from 'vitest';
import { GenomeChatService } from './genome-chat.service';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { BlueprintService } from '../blueprint/blueprint.service';
import type { ModelGatewayService } from '../ai/model-gateway.service';
import type { GenomeIntegrityResult } from '../blueprint/blueprint.types';

function makeService(responseContent: string) {
  const createdMessages: Array<{
    id: string;
    businessId: string;
    role: string;
    content: string;
    metadata: unknown;
    createdAt: Date;
  }> = [];

  const prisma = {
    client: {
      genomeChatMessage: {
        create: vi.fn().mockImplementation(({ data }) => {
          const row = {
            id: `msg_${createdMessages.length + 1}`,
            ...data,
            createdAt: new Date(),
          };
          createdMessages.push(row);
          return Promise.resolve(row);
        }),
        findMany: vi.fn().mockResolvedValue([]),
      },
    },
  } as unknown as PrismaService;

  const blueprint = {
    calculateGenomeIntegrity: vi.fn().mockResolvedValue({
      genomeIntegrity: 42,
      genomeDnaScores: {
        founder: 60,
        vision: 30,
        business: 50,
        market: 40,
        financial: 20,
        legal: 10,
        operations: 5,
        sales: 0,
        marketing: 0,
        growth: 0,
        technology: 15,
      },
      genomeDnaConfidence: {
        founder: 60,
        vision: 30,
        business: 50,
        market: 40,
        financial: 20,
        legal: 10,
        operations: 5,
        sales: 0,
        marketing: 0,
        growth: 0,
        technology: 15,
      },
      genomeStage: 'CONCEPT',
      threePillarMinimumMet: false,
      dnaSections: [
        { key: 'market', label: 'Market DNA', integrity: 40, confidence: 40, summary: '', fieldsCaptured: 0, fieldsTotal: 1, missingFields: [], recommendation: '' },
      ],
    } as GenomeIntegrityResult),
    updateDnaSection: vi.fn().mockResolvedValue({ id: 'bp_1' }),
  } as unknown as BlueprintService;

  const gateway = {
    complete: vi.fn().mockResolvedValue({
      content: responseContent,
      provider: 'openai',
      model: 'gpt-4o',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, estimatedCost: 0.01 },
      latencyMs: 200,
      fallbackUsed: false,
    }),
  } as unknown as ModelGatewayService;

  const service = new GenomeChatService(prisma, blueprint, gateway);
  return { service, prisma, blueprint, gateway, createdMessages };
}

describe('GenomeChatService', () => {
  it('parses a valid genome_update block and returns proposed updates', async () => {
    const content = `Thanks. I've captured your fixed cost.

\`\`\`json
{"genome_update": {"section": "financial", "data": {"monthlyFixedCosts": 3000}, "summary": "Monthly fixed cost: 3000"}}
\`\`\`

Anything else?`;

    const { service, blueprint } = makeService(content);
    const result = await service.sendMessage('biz_1', 'user_1', 'My fixed cost is 3000');

    expect(result.proposedUpdates).not.toBeNull();
    expect(result.proposedUpdates?.section).toBe('financial');
    expect(result.proposedUpdates?.data).toEqual({ monthlyFixedCosts: 3000 });
    expect(result.proposedUpdates?.summary).toBe('Monthly fixed cost: 3000');
    expect(result.message.content).not.toContain('genome_update');
    expect(blueprint.updateDnaSection).not.toHaveBeenCalled();
  });

  it('returns null proposedUpdates when no genome_update block is present', async () => {
    const { service } = makeService('Tell me more about your target customer.');
    const result = await service.sendMessage('biz_1', 'user_1', 'hello');

    expect(result.proposedUpdates).toBeNull();
    expect(result.message.content).toBe('Tell me more about your target customer.');
  });

  it('returns null proposedUpdates for an invalid JSON block', async () => {
    const content = `Here is an update:

\`\`\`json
not valid json
\`\`\``;

    const { service } = makeService(content);
    const result = await service.sendMessage('biz_1', 'user_1', 'hello');

    expect(result.proposedUpdates).toBeNull();
  });

  it('ignores genome_update blocks with empty data', async () => {
    const content = `\`\`\`json
{"genome_update": {"section": "financial", "data": {}, "summary": "nothing"}}
\`\`\``;

    const { service } = makeService(content);
    const result = await service.sendMessage('biz_1', 'user_1', 'hello');

    expect(result.proposedUpdates).toBeNull();
  });

  it('applyUpdates persists a system message and returns the updated genome', async () => {
    const { service, prisma, blueprint } = makeService('');
    const result = await service.applyUpdates('biz_1', 'user_1', 'financial', {
      monthlyFixedCosts: 3000,
    });

    expect(blueprint.updateDnaSection).toHaveBeenCalledWith('biz_1', 'financial', {
      monthlyFixedCosts: 3000,
    });
    expect(blueprint.calculateGenomeIntegrity).toHaveBeenCalledWith('biz_1');
    expect(prisma.client.genomeChatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: 'system',
          businessId: 'biz_1',
          metadata: expect.objectContaining({ appliedSection: 'financial' }),
        }),
      }),
    );
    expect(result.genomeIntegrity).toBe(42);
  });

  it('persists user and assistant messages', async () => {
    const { service, prisma } = makeService('Great, thanks.');
    await service.sendMessage('biz_1', 'user_1', 'hello');

    expect(prisma.client.genomeChatMessage.create).toHaveBeenCalledTimes(2);
    expect(prisma.client.genomeChatMessage.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({ role: 'user', content: 'hello', businessId: 'biz_1' }),
      }),
    );
    expect(prisma.client.genomeChatMessage.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({ role: 'assistant', content: 'Great, thanks.', businessId: 'biz_1' }),
      }),
    );
  });
});
