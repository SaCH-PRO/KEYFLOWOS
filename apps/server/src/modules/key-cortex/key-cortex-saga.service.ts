import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface SagaContext {
  businessId: string;
  sagaType: string;
  correlationId?: string;
  commandId?: string;
  sessionId?: string;
}

export interface SagaStepResult {
  success: boolean;
  output?: Record<string, unknown>;
  error?: string;
}

export interface SagaCompensation {
  stepName: string;
  action: string;
  payload: Record<string, unknown>;
}

/**
 * Saga orchestrator for multi-step KEY autonomous operations.
 *
 * Provides durable execution logging and a foundation for compensating
 * actions. Each saga records its steps; on failure the caller can invoke
 * compensate() to run stored compensation actions in reverse order.
 */
@Injectable()
export class KeyCortexSagaService {
  private readonly logger = new Logger(KeyCortexSagaService.name);

  constructor(private readonly prisma: PrismaService) {}

  async start(ctx: SagaContext) {
    return this.prisma.client.sagaExecution.create({
      data: {
        businessId: ctx.businessId,
        sagaType: ctx.sagaType,
        status: 'running',
        correlationId: ctx.correlationId ?? null,
        commandId: ctx.commandId ?? null,
        sessionId: ctx.sessionId ?? null,
      },
    });
  }

  async addStep(
    sagaId: string,
    stepIndex: number,
    stepName: string,
    input: Record<string, unknown>,
    compensation?: SagaCompensation,
  ) {
    return this.prisma.client.sagaStep.create({
      data: {
        sagaId,
        stepIndex,
        stepName,
        status: 'pending',
        input: input as any,
        compensationAction: compensation ? (compensation as any) : null,
      },
    });
  }

  async completeStep(sagaId: string, stepIndex: number, output: Record<string, unknown>) {
    await this.prisma.client.sagaStep.updateMany({
      where: { sagaId, stepIndex },
      data: {
        status: 'completed',
        output: output as any,
        completedAt: new Date(),
      },
    });
  }

  async failStep(sagaId: string, stepIndex: number, error: string) {
    await this.prisma.client.sagaStep.updateMany({
      where: { sagaId, stepIndex },
      data: {
        status: 'failed',
        error,
        completedAt: new Date(),
      },
    });
  }

  async completeSaga(sagaId: string) {
    await this.prisma.client.sagaExecution.update({
      where: { id: sagaId },
      data: { status: 'completed', completedAt: new Date() },
    });
  }

  async failSaga(sagaId: string) {
    await this.prisma.client.sagaExecution.update({
      where: { id: sagaId },
      data: { status: 'failed', completedAt: new Date() },
    });
  }

  /**
   * Run compensation actions in reverse order. Returns the list of results;
   * individual compensation failures are logged but do not throw.
   */
  async compensate(sagaId: string): Promise<SagaStepResult[]> {
    const steps = await this.prisma.client.sagaStep.findMany({
      where: { sagaId },
      orderBy: { stepIndex: 'desc' },
    });

    const results: SagaStepResult[] = [];
    for (const step of steps) {
      const action = step.compensationAction as SagaCompensation | null;
      if (!action) continue;

      try {
        // Foundation: log compensation and mark step compensated. Real
        // compensation handlers can be dispatched by action name later.
        this.logger.log(
          `[compensate][${sagaId}] ${step.stepName}: ${action.action} ${JSON.stringify(action.payload)}`,
        );
        await this.prisma.client.sagaStep.updateMany({
          where: { id: step.id },
          data: {
            status: 'compensated',
            compensationResult: { success: true, logged: true } as any,
            completedAt: new Date(),
          },
        });
        results.push({ success: true, output: { step: step.stepName, action: action.action } });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`[compensate][${sagaId}] ${step.stepName} failed: ${message}`);
        await this.prisma.client.sagaStep.updateMany({
          where: { id: step.id },
          data: {
            compensationResult: { success: false, error: message } as any,
          },
        });
        results.push({ success: false, error: message });
      }
    }

    await this.prisma.client.sagaExecution.update({
      where: { id: sagaId },
      data: { status: 'compensated', completedAt: new Date() },
    });

    return results;
  }
}
