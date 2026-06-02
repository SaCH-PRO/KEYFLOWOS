import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface SignalToCommandInput {
  businessId: string;
  sourceModule: string;
  sourceType?: string;
  sourceId?: string;
  contactId?: string;
  title: string;
  description?: string;
  category: string;
  actionType: string;
  priority?: number;
  urgency?: number;
  riskTier?: number;
  expectedValue?: number;
  currency?: string;
  dueAt?: Date;
  executableByKey?: boolean;
  requiresApproval?: boolean;
  executionTool?: string;
  executionPayload?: Record<string, unknown>;
}

@Injectable()
export class CommandBridgeService {
  private readonly logger = new Logger(CommandBridgeService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async bridge(signalInput: SignalToCommandInput) {
    const unique = await this.prisma.client.commandItem.findFirst({
      where: {
        businessId: signalInput.businessId,
        sourceModule: signalInput.sourceModule,
        sourceType: signalInput.sourceType ?? null,
        sourceId: signalInput.sourceId ?? null,
        actionType: signalInput.actionType,
        status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_APPROVAL'] },
      },
    });

    if (unique) {
      this.logger.debug(`Command item already exists for ${signalInput.actionType}, skipping duplicate`);
      return unique;
    }

    return this.prisma.client.commandItem.create({
      data: {
        businessId: signalInput.businessId,
        sourceModule: signalInput.sourceModule,
        sourceType: signalInput.sourceType ?? null,
        sourceId: signalInput.sourceId ?? null,
        contactId: signalInput.contactId ?? null,
        title: signalInput.title,
        description: signalInput.description,
        category: signalInput.category,
        actionType: signalInput.actionType,
        status: 'OPEN',
        priority: signalInput.priority ?? 50,
        urgency: signalInput.urgency ?? 50,
        riskTier: signalInput.riskTier ?? 1,
        expectedValue: signalInput.expectedValue ?? null,
        currency: signalInput.currency ?? null,
        dueAt: signalInput.dueAt ?? null,
        executableByKey: signalInput.executableByKey ?? false,
        requiresApproval: signalInput.requiresApproval ?? false,
        executionTool: signalInput.executionTool ?? null,
        executionPayload: (signalInput.executionPayload ?? {}) as any,
        recommendedBy: 'SYSTEM',
      },
    });
  }

  async resolveCommandsForEntity(businessId: string, entityType: string, entityId: string) {
    return this.prisma.client.commandItem.updateMany({
      where: {
        businessId,
        sourceType: entityType,
        sourceId: entityId,
        status: { in: ['OPEN', 'IN_PROGRESS'] },
      },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
  }
}
