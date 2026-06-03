import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface KeyAgentConfigInput {
  name?: string;
  agentType?: string;
  status?: string;
  channels?: unknown[];
  goals?: unknown[];
  allowedTools?: unknown[];
  approvalPolicy?: Record<string, unknown>;
  memoryScope?: string;
  knowledgeSources?: unknown[];
  kpis?: unknown[];
}

@Injectable()
export class KeyAgentConfigService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getOrCreate(businessId: string) {
    const existing = await this.prisma.client.keyAgentConfig.findFirst({
      where: { businessId, deletedAt: null },
    });
    if (existing) return existing;
    return this.prisma.client.keyAgentConfig.create({
      data: {
        businessId,
        name: 'KEY Default',
        agentType: 'general',
        status: 'ACTIVE',
        channels: [],
        goals: [],
        allowedTools: [],
        approvalPolicy: {},
        memoryScope: 'business',
        knowledgeSources: [],
        kpis: [],
      },
    });
  }

  async update(businessId: string, input: KeyAgentConfigInput) {
    const existing = await this.getOrCreate(businessId);
    return this.prisma.client.keyAgentConfig.update({
      where: { id: existing.id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.agentType !== undefined && { agentType: input.agentType }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.channels !== undefined && { channels: input.channels as any }),
        ...(input.goals !== undefined && { goals: input.goals as any }),
        ...(input.allowedTools !== undefined && { allowedTools: input.allowedTools as any }),
        ...(input.approvalPolicy !== undefined && { approvalPolicy: input.approvalPolicy as any }),
        ...(input.memoryScope !== undefined && { memoryScope: input.memoryScope }),
        ...(input.knowledgeSources !== undefined && { knowledgeSources: input.knowledgeSources as any }),
        ...(input.kpis !== undefined && { kpis: input.kpis as any }),
      },
    });
  }
}
