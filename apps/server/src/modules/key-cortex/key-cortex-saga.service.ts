import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { KeyCortexCompensationService } from './key-cortex-compensation.service';

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

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly compensation?: KeyCortexCompensationService,
  ) {}

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
    /** Steps that declared a compensation and therefore could be undone. */
    let compensable = 0;

    for (const step of steps) {
      const action = step.compensationAction as SagaCompensation | null;
      if (!action) continue;
      compensable += 1;

      try {
        let compensationResult: Record<string, unknown> = { success: true, logged: true };
        if (this.compensation) {
          const result = await this.compensation.compensate(action.action, {
            businessId: (action.payload as Record<string, unknown>)?.businessId as string,
            parameters: action.payload as Record<string, unknown>,
            output: step.output as Record<string, unknown> | undefined,
          });
          compensationResult = result;
        }
        this.logger.log(
          `[compensate][${sagaId}] ${step.stepName}: ${action.action} ${JSON.stringify(action.payload)}`,
        );
        await this.prisma.client.sagaStep.updateMany({
          where: { id: step.id },
          data: {
            status: 'compensated',
            compensationResult: compensationResult as any,
            completedAt: new Date(),
          },
        });
        results.push({ success: true, output: { step: step.stepName, action: action.action, result: compensationResult } });
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

    // 'compensated' is a durable claim that the work was undone. Only say it if
    // something actually was.
    //
    // This used to be written unconditionally, at the end of a loop whose every
    // iteration begins `if (!action) continue`. Nothing in production writes
    // SagaStep.compensationAction — the planner omits the argument, no tool
    // declares one, and the one path that builds compensations
    // (KeyCortexSagaExecutorService) has zero callers. So every real saga
    // skipped every step, returned [], and then recorded that it had rolled
    // back. The audit trail asserted a recovery that never happened.
    //
    // A saga with steps but no declared compensations is not compensated; it is
    // a saga nobody taught how to undo itself. Recording that distinctly is the
    // difference between a known gap and a false record of safety.
    const status =
      compensable === 0 && steps.length > 0
        ? 'compensation_unavailable'
        : results.some((r) => !r.success)
          ? 'compensation_failed'
          : 'compensated';

    if (status !== 'compensated') {
      this.logger.warn(
        `[compensate][${sagaId}] ${status}: ${compensable} of ${steps.length} step(s) ` +
          `declared a compensating action. Nothing was undone for the rest.`,
      );
    }

    await this.prisma.client.sagaExecution.update({
      where: { id: sagaId },
      data: { status, completedAt: new Date() },
    });

    return results;
  }
}
