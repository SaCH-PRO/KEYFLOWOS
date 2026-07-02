import { Injectable, Logger } from '@nestjs/common';
import {
  KeyCortexExecutorService,
  ExecuteOptions,
  BatchResult,
} from './key-cortex-executor.service';
import { ConnectorCommand } from './key-cortex-connector.types';
import { KeyCortexSagaService, SagaCompensation, SagaStepResult } from './key-cortex-saga.service';
import { KeyCortexCompensationService } from './key-cortex-compensation.service';
import { BlueprintService } from '../blueprint/blueprint.service';

export interface SagaBatchOptions extends ExecuteOptions {
  /** Pre-computed saga type; defaults to `key_cortex_batch`. */
  sagaType?: string;
  /** Correlation ID for tracing; defaults to a generated trace id. */
  correlationId?: string;
  /** Session ID for grouping. */
  sessionId?: string;
  /** Command ID that triggered this batch. */
  commandId?: string;
  /** Whether to run compensation on any failure. Defaults to true. */
  compensateOnFailure?: boolean;
}

export interface SagaBatchResult {
  batchResult: BatchResult;
  sagaId: string;
  compensationResults?: SagaStepResult[];
}

/**
 * Saga-backed batch executor.
 *
 * Wraps KeyCortexExecutorService.executeBatch() with durable saga logging
 * and automatic compensation. Each command is recorded as a SagaStep before
 * execution; on failure the saga is compensated in reverse order.
 */
@Injectable()
export class KeyCortexSagaExecutorService {
  private readonly logger = new Logger(KeyCortexSagaExecutorService.name);

  constructor(
    private readonly executor: KeyCortexExecutorService,
    private readonly saga: KeyCortexSagaService,
    private readonly compensation: KeyCortexCompensationService,
    private readonly blueprint: BlueprintService,
  ) {}

  async executeSagaBatch(
    businessId: string,
    commands: ConnectorCommand[],
    actor?: { userId?: string; sessionId?: string; correlationId?: string; commandId?: string },
    options: SagaBatchOptions = {},
  ): Promise<SagaBatchResult> {
    const traceId = options.traceId ?? options.correlationId ?? actor?.correlationId ?? this.generateTraceId();
    const saga = await this.saga.start({
      businessId,
      sagaType: options.sagaType ?? 'key_cortex_batch',
      correlationId: traceId,
      sessionId: options.sessionId ?? actor?.sessionId,
      commandId: options.commandId ?? actor?.commandId,
    });

    this.logger.log(
      `[executeSagaBatch] saga=${saga.id} trace=${traceId} commands=${commands.length}`,
    );

    try {
      // Pre-register every command as a saga step with its compensating action.
      for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i];
        const compensation = await this.buildCompensation(businessId, cmd);
        await this.saga.addStep(
          saga.id,
          i,
          `${cmd.module}.${cmd.action}`,
          cmd.parameters,
          compensation,
        );
      }

      const batchResult = await this.executor.executeBatch(commands, {
        ...options,
        traceId,
        rollbackOnFailure: false, // compensation is handled by the saga below
      });

      // Sync step statuses with actual execution results.
      for (let i = 0; i < batchResult.results.length; i++) {
        const record = batchResult.results[i];
        if (record.result.success) {
          await this.saga.completeStep(
            saga.id,
            i,
            (record.result.data ?? {}) as Record<string, unknown>,
          );
        } else {
          await this.saga.failStep(
            saga.id,
            i,
            record.result.error ?? 'Execution failed',
          );
        }
      }

      let compensationResults: SagaStepResult[] | undefined;
      const shouldCompensate = options.compensateOnFailure !== false && batchResult.failedCount > 0;

      if (shouldCompensate) {
        this.logger.warn(
          `[executeSagaBatch] saga=${saga.id} failed steps; running compensation`,
        );
        compensationResults = await this.saga.compensate(saga.id);
      } else {
        await this.saga.completeSaga(saga.id);
      }

      return { batchResult, sagaId: saga.id, compensationResults };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[executeSagaBatch] saga=${saga.id} error: ${message}`);
      await this.saga.failSaga(saga.id);
      throw err;
    }
  }

  private async buildCompensation(
    businessId: string,
    command: ConnectorCommand,
  ): Promise<SagaCompensation | undefined> {
    const actionRef = `${command.module}.${command.action}`;
    const action = this.compensation.getCompensatingAction(actionRef);
    if (!action) return undefined;

    const payload: Record<string, unknown> = {
      businessId,
      ...command.parameters,
    };

    // For DNA updates, capture the previous value so the rollback is real.
    if (actionRef === 'key_genome.dna_update') {
      try {
        const section = command.parameters.section as string | undefined;
        const field = command.parameters.field as string | undefined;
        if (section && field) {
          const blueprint = await this.blueprint.getBlueprint(businessId);
          const sectionData = (blueprint as unknown as Record<string, unknown>)[section] as Record<string, unknown> | undefined;
          payload.previousValue = sectionData?.[field] ?? null;
        }
      } catch (err: unknown) {
        this.logger.warn(
          `[buildCompensation] could not read previous blueprint value: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return {
      stepName: `${command.module}.${command.action}`,
      action,
      payload,
    };
  }

  private generateTraceId(): string {
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
}
