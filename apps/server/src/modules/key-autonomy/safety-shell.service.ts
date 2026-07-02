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

  async rollback(_actionKey: string, rollbackActions: unknown[]): Promise<{ success: boolean; results: unknown[] }> {
    const results: unknown[] = [];
    for (const action of rollbackActions) {
      // Foundation: log rollback actions; real compensations are body-specific.
      this.logger.log(`[rollback] Would execute compensating action: ${JSON.stringify(action)}`);
      results.push({ action, status: 'logged' });
    }
    return { success: true, results };
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
