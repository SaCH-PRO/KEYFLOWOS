import { Injectable, Logger } from '@nestjs/common';

export interface SafetyCheckResult {
  safe: boolean;
  preconditionsMet: boolean;
  postconditionsMet?: boolean;
  idempotencyKey?: string;
  rollbackActions?: unknown[];
  reason?: string;
  /** Before-state snapshot captured at safety-check time. */
  snapshot?: Record<string, unknown>;
  /** Actor id associated with the safety check. */
  actorId?: string;
}

export interface SafetyShellOptions {
  idempotencyKey?: string;
  preconditions?: Array<{ field: string; required: boolean }>;
  rollbackActions?: unknown[];
  /** Optional before-state snapshot used for audit/undo. */
  snapshot?: Record<string, unknown>;
  /** Optional actor id to associate with the safety check. */
  actorId?: string;
}

/**
 * Deterministic safety shell for autonomous actions.
 *
 * Foundation implementation validates pre-conditions, enforces idempotency
 * keys, and records rollback actions. Future versions will validate full
 * post-conditions and automatically execute compensating transactions.
 */
@Injectable()
export class SafetyShellService {
  private readonly logger = new Logger(SafetyShellService.name);
  private readonly idempotencyCache = new Set<string>();

  async check(
    actionKey: string,
    parameters: Record<string, unknown>,
    options: SafetyShellOptions = {},
  ): Promise<SafetyCheckResult> {
    const idempotencyKey = options.idempotencyKey ?? this.generateIdempotencyKey(actionKey, parameters);

    if (this.idempotencyCache.has(idempotencyKey)) {
      return {
        safe: false,
        preconditionsMet: true,
        idempotencyKey,
        reason: 'Duplicate execution detected via idempotency key',
      };
    }

    const preconditionsMet = this.validatePreconditions(parameters, options.preconditions ?? []);
    if (!preconditionsMet) {
      return {
        safe: false,
        preconditionsMet: false,
        idempotencyKey,
        reason: 'Required pre-conditions are missing',
      };
    }

    this.idempotencyCache.add(idempotencyKey);
    return {
      safe: true,
      preconditionsMet: true,
      idempotencyKey,
      rollbackActions: options.rollbackActions ?? [],
      snapshot: options.snapshot,
      actorId: options.actorId,
    };
  }

  /**
   * Compensate a failed action.
   *
   * THIS DOES NOT COMPENSATE ANYTHING YET, AND NOW SAYS SO.
   *
   * It used to log "Would execute compensating action" for each item and return
   * `{ success: true }` regardless — a component whose entire job is safety,
   * reporting that it had undone work it had not touched.
   *
   * Today that is harmless in practice, which is the only reason this is a
   * correction rather than an incident: the sole caller of `check()`
   * (key-action-executor.service.ts:31) does not pass `rollbackActions`, so the
   * list is always empty, the loop never runs, and `success: true` is the
   * truthful answer to "did you undo the nothing I gave you".
   *
   * It is still a loaded gun. The first caller to pass real rollback actions
   * gets silent no-ops reported as success, and the failure would surface as
   * data that should have been reverted and quietly was not.
   *
   * So: an empty list still succeeds, because there is genuinely nothing to do.
   * A non-empty list now FAILS LOUDLY. That is not a regression — no caller can
   * currently reach that branch — it is a tripwire, so that whoever wires the
   * first real compensation is told to implement this rather than discovering
   * months later that it never ran.
   *
   * Implementing it for real means delegating to KeyCortexCompensationService,
   * which holds genuine handlers (soft-delete contact, void invoice, cancel
   * booking). That registry is itself unreachable today — nothing writes
   * SagaStep.compensationAction — so wiring one inert component to another would
   * have produced a longer call chain that still reverts nothing.
   */
  async rollback(
    actionKey: string,
    rollbackActions: unknown[],
  ): Promise<{ success: boolean; results: unknown[]; reason?: string }> {
    if (rollbackActions.length === 0) return { success: true, results: [] };

    const reason =
      'SafetyShellService.rollback cannot compensate: no handler is wired. ' +
      'Delegate to KeyCortexCompensationService (and make its handler map ' +
      'reachable) before relying on this.';

    this.logger.error(
      `[rollback] REFUSING to report success for ${rollbackActions.length} ` +
        `compensating action(s) on "${actionKey}" — none were executed. ${reason}`,
    );

    return {
      success: false,
      reason,
      results: rollbackActions.map((action) => ({ action, status: 'not_executed' })),
    };
  }

  private validatePreconditions(
    parameters: Record<string, unknown>,
    preconditions: Array<{ field: string; required: boolean }>,
  ): boolean {
    for (const precondition of preconditions) {
      if (precondition.required) {
        const value = parameters[precondition.field];
        if (value === undefined || value === null || value === '') {
          return false;
        }
      }
    }
    return true;
  }

  private generateIdempotencyKey(actionKey: string, parameters: Record<string, unknown>): string {
    const payload = JSON.stringify({ actionKey, parameters });
    let hash = 0;
    for (let i = 0; i < payload.length; i++) {
      const char = payload.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return `safety:${actionKey}:${hash.toString(16)}`;
  }
}
