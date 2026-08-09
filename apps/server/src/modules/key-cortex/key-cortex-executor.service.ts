// ============================================================================
// KEY CORTEX EXECUTOR SERVICE
// Real Action Execution with Approval Gates, Audit Logging & Rollback
// ============================================================================
// Executes ConnectorCommands produced by the CommandService. Every execution
// is audited, approval-gated where configured, and rollbacks are attempted
// for failed operations.
//
// Sections:
//   1. Imports & Types
//   2. Injectable Service
//   3. execute()              – Single command with approval gate
//   4. executeBatch()         – Sequential multi-command execution
//   5. executeWithApproval()  – Create pending approval request
//   6. requiresApproval()     – Approval policy engine
//   7. logExecution()         – Prisma audit trail
//   8. rollback()             – Undo failed actions
//   9. summarizeResults()     – Human-friendly summary
//   10. Internal Helpers
// ============================================================================

import {
  Injectable,
  Logger,
  InternalServerErrorException,
  Optional,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';

// ─── Prisma ───────────────────────────────────────────────────────────────────
import { PrismaService } from '../../core/prisma/prisma.service';

// ─── Connector ──────────────────────────────────────────────────────────────────
import {
  ConnectorCommand,
  ConnectorResult,
  ModuleName,
  ModuleCapability,
  ModuleAction,
} from './key-cortex-connector.types';
import { KeyCortexConnectorService } from './key-cortex-connector.service';

// ─── Genome Governance ──────────────────────────────────────────────────────────
import { GenomeAutonomyGateService } from '../business-genome/key-genome/genome-autonomy-gate.service';
import { AutonomyOrchestratorService } from '../key-autonomy/autonomy-orchestrator.service';
import { KeyActionProposalService } from '../key-autonomy/key-action-proposal.service';
import { KeyCortexApprovalOrchestratorService } from './key-cortex-approval-orchestrator.service';

// ─── Constants ──────────────────────────────────────────────────────────────────
const EXECUTION_TIMEOUT_MS = 30000;
const BATCH_STOP_ON_FAILURE = true;
const MAX_BATCH_SIZE = 50;
const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const APPROVAL_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// Safety blocklist: actions that are too dangerous to expose through the AI
// command surface until they are hardened with allowlists, read-only scopes,
// and tenant isolation. See docs/key-cortex-safety.md.
const BLOCKED_ACTIONS = new Set([
  'EXECUTE_TOOL',
  'QUERY_DATABASE',
  'UPDATE_RECORD',
]);

function isBlockedCommand(command: ConnectorCommand): boolean {
  return BLOCKED_ACTIONS.has(command.action);
}

// ─── Types ──────────────────────────────────────────────────────────────────────
export interface ExecuteOptions {
  /** Unique execution trace ID */
  traceId?: string;
  /** Override approval gating */
  skipApproval?: boolean;
  /** Rollback on failure? */
  rollbackOnFailure?: boolean;
  /** Stop batch on first failure? */
  stopOnFailure?: boolean;
  /** Alias used by the controller */
  stopOnError?: boolean;
  /** Emit real-time events? */
  emitEvents?: boolean;
  /** Request source info */
  sourceInfo?: Record<string, unknown>;
}

export interface ExecutionRecord {
  id: string;
  command: ConnectorCommand;
  result: ConnectorResult;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  traceId: string;
  rolledBack: boolean;
  rollbackResult?: ConnectorResult;
}

export interface ApprovalRequest {
  id: string;
  command: ConnectorCommand;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  requestedAt: Date;
  respondedAt?: Date;
  correlationId: string;
}

export interface ApprovalPolicy {
  /** Master switch: can this business auto-execute? */
  autonomyLevel: 'full' | 'supervised' | 'manual';
  /** Actions that ALWAYS need approval regardless of autonomy */
  alwaysRequireApproval: string[];
  /** Actions that NEVER need approval (override alwaysRequire) */
  neverRequireApproval: string[];
  /** Spending threshold above which approval is required */
  spendingThreshold?: number;
  /** Per-action spending limits */
  actionSpendingLimits: Record<string, number>;
  /** Max auto-executions per hour */
  maxAutoExecutionsPerHour: number;
  /** Current hour execution count */
  currentHourExecutionCount: number;
}

export interface BatchResult {
  results: ExecutionRecord[];
  totalCommands: number;
  succeededCount: number;
  failedCount: number;
  rolledBackCount: number;
  durationMs: number;
  traceId: string;
  stoppedEarly: boolean;
  summary: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════════════════════

@Injectable()
export class KeyCortexExecutorService {
  private readonly logger = new Logger(KeyCortexExecutorService.name);

  // In-memory approval request cache (short-lived; persisted in DB)
  private pendingApprovals = new Map<string, ApprovalRequest>();
  private approvalCleanupInterval?: NodeJS.Timeout;

  constructor(
    private readonly connector: KeyCortexConnectorService,
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly autonomyGate: GenomeAutonomyGateService,
    // KeyCortexModule and KeyAutonomyModule import each other with forwardRef,
    // so this file and autonomy-orchestrator.service.ts form a circular FILE
    // import — and at the moment this decorator's metadata is emitted, the
    // class reference is still undefined. Nest then sees `?` at index [4],
    // which is TypeScript syntax it cannot read, and refuses to boot the whole
    // application: "Nest can't resolve dependencies of KeyCortexExecutorService
    // (..., ?, +, +)".
    //
    // @Inject(forwardRef(...)) defers resolution to injection time, which is
    // the point of forwardRef. @Optional() alone would also boot — and would
    // silently bind undefined, disabling the autonomy gate on every executed
    // action while the guard at :233 quietly took the other branch. That is the
    // phantom-injection failure this repo already has a spec for; booting is
    // not the same as working.
    @Inject(forwardRef(() => AutonomyOrchestratorService))
    private readonly autonomyOrchestrator?: AutonomyOrchestratorService,
    @Optional()
    private readonly proposalService?: KeyActionProposalService,
    @Optional()
    private readonly approvalOrchestrator?: KeyCortexApprovalOrchestratorService,
  ) {
    // Start periodic cleanup of stale pending approvals (Fix 2)
    this.approvalCleanupInterval = setInterval(() => {
      this.cleanupStaleApprovals();
    }, APPROVAL_CLEANUP_INTERVAL_MS);
  }

  /**
   * Cleanup stale pending approvals to prevent memory leak (Fix 2).
   * Removes entries older than APPROVAL_TTL_MS.
   */
  private cleanupStaleApprovals(): void {
    const cutoff = Date.now() - APPROVAL_TTL_MS;
    let cleaned = 0;
    for (const [id, req] of this.pendingApprovals.entries()) {
      if (req.requestedAt.getTime() < cutoff) {
        this.pendingApprovals.delete(id);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.logger.debug(`[cleanupStaleApprovals] Removed ${cleaned} stale approval(s)`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 3 — execute()
  // ════════════════════════════════════════════════════════════════════════════
  /**
   * Execute a single ConnectorCommand with full lifecycle management:
   *   1. Resolve the approval policy for this business + user.
   *   2. If approval required → delegate to executeWithApproval().
   *   3. Otherwise → call connector.execute() with timeout & error wrapping.
   *   4. Log the execution to Prisma (non-blocking).
   *   5. Emit real-time event (non-blocking).
   *   6. If failed + rollbackOnFailure → attempt rollback.
   *   7. Return the execution record.
   */
  async execute(
    command: ConnectorCommand,
    options: ExecuteOptions = {},
  ): Promise<ExecutionRecord> {
    const traceId = options.traceId ?? this.generateTraceId();
    const startedAt = new Date();
    const startMs = Date.now();

    this.logger.log(
      `[execute] ${command.module}.${command.action} trace=${traceId} biz=${command.businessId}`,
    );

    // ── Safety gate: block high-risk actions ─────────────────────────────────
    if (isBlockedCommand(command)) {
      const reason = `Action "${command.action}" is disabled in this build for safety review.`;
      this.logger.warn(`[execute] Blocked ${command.module}.${command.action}: ${reason}`);
      return {
        id: randomUUID(),
        command,
        result: {
          success: false,
          error: reason,
          executionTimeMs: 0,
          command,
        },
        startedAt,
        finishedAt: new Date(),
        durationMs: 0,
        traceId,
        rolledBack: false,
      };
    }

    // ── Unified Autonomy Orchestrator: canonical verdict ───────────────────────
    try {
      if (this.autonomyOrchestrator) {
        const verdict = await this.autonomyOrchestrator.evaluateAction(
          command.businessId,
          `${command.module}.${command.action}`,
          command.parameters,
          { proposedBy: command.userId },
        );

        if (!verdict.allowed) {
          const reason = verdict.reason || 'Blocked by autonomy orchestrator';
          this.logger.warn(`[execute] Autonomy orchestrator BLOCKED ${command.module}.${command.action}: ${reason}`);
          return {
            id: randomUUID(),
            command,
            result: {
              success: false,
              error: reason,
              executionTimeMs: 0,
              command,
            },
            startedAt,
            finishedAt: new Date(),
            durationMs: 0,
            traceId,
            rolledBack: false,
          };
        }

        if (verdict.requiresApproval && options.skipApproval) {
          options = { ...options, skipApproval: false };
        }
      } else {
        // Legacy fallback: KEY Genome autonomy gate
        const gate = await this.autonomyGate.checkGate({
          businessId: command.businessId,
          actionType: `${command.module}.${command.action}`,
          affectedDomains: command.module ? [command.module as any] : undefined,
          payload: command.parameters,
          proposedBy: command.userId ?? null,
        });

        if (gate.decision === 'BLOCK') {
          const reason =
            gate.blockingReasons?.join('; ') ||
            'Blocked by KEY Genome autonomy gate.';
          this.logger.warn(`[execute] Autonomy gate BLOCKED ${command.module}.${command.action}: ${reason}`);
          return {
            id: randomUUID(),
            command,
            result: {
              success: false,
              error: reason,
              executionTimeMs: 0,
              command,
            },
            startedAt,
            finishedAt: new Date(),
            durationMs: 0,
            traceId,
            rolledBack: false,
          };
        }

        if (gate.decision === 'ALLOW_WITH_APPROVAL' && options.skipApproval) {
          options = { ...options, skipApproval: false };
        }
      }
    } catch (gateErr) {
      this.logger.error(
        `[execute] Autonomy gate error for ${command.module}.${command.action}: ${(gateErr as Error).message}`,
      );
      return {
        id: randomUUID(),
        command,
        result: {
          success: false,
          error: 'Autonomy gate unavailable; execution blocked for safety.',
          executionTimeMs: 0,
          command,
        },
        startedAt,
        finishedAt: new Date(),
        durationMs: 0,
        traceId,
        rolledBack: false,
      };
    }

    // ── Emit START event ─────────────────────────────────────────────────────
    if (options.emitEvents !== false) {
      this.eventEmitter.emit('key.cortex.execution.started', {
        traceId,
        command,
        startedAt,
      });
    }

    // ── 1. Approval check ────────────────────────────────────────────────────
    const needsApproval = options.skipApproval
      ? false
      : await this.requiresApproval(command);

    if (needsApproval) {
      this.logger.log(
        `[execute] Approval required for ${command.module}.${command.action}`,
      );
      const approvalRecord = await this.executeWithApproval(command);

      return {
        id: approvalRecord.id,
        command,
        result: {
          success: false,
          data: { approvalStatus: approvalRecord.status },
          error: 'Approval pending',
          executionTimeMs: Date.now() - startMs,
          command,
        },
        startedAt,
        finishedAt: new Date(),
        durationMs: Date.now() - startMs,
        traceId,
        rolledBack: false,
      };
    }

    // ── 2. Execute via connector ─────────────────────────────────────────────
    let result: ConnectorResult;
    try {
      result = await this.executeWithTimeout(command, EXECUTION_TIMEOUT_MS);
    } catch (error: any) {
      const errMsg =
        error instanceof Error
          ? error.message
          : 'Unknown execution error';
      this.logger.error(
        `[execute] ${command.module}.${command.action} failed: ${errMsg}`,
        (error as Error)?.stack,
      );
      result = {
        success: false,
        error: errMsg,
        executionTimeMs: Date.now() - startMs,
        command,
      };
    }

    const finishedAt = new Date();
    const durationMs = Date.now() - startMs;

    // ── 3. Rollback on failure ───────────────────────────────────────────────
    let rolledBack = false;
    let rollbackResult: ConnectorResult | undefined;

    if (!result.success && options.rollbackOnFailure !== false) {
      this.logger.log(
        `[execute] Attempting rollback for failed ${command.module}.${command.action}`,
      );
      try {
        rollbackResult = await this.rollback(result);
        rolledBack = rollbackResult.success;
      } catch (rollbackErr) {
        this.logger.error(
          `[execute] Rollback failed: ${(rollbackErr as Error).message}`,
        );
        rollbackResult = {
          success: false,
          error: `Rollback failed: ${(rollbackErr as Error).message}`,
          executionTimeMs: 0,
          command,
        };
      }
    }

    // ── 4. Build record ──────────────────────────────────────────────────────
    const record: ExecutionRecord = {
      id: randomUUID(),
      command,
      result,
      startedAt,
      finishedAt,
      durationMs,
      traceId,
      rolledBack,
      rollbackResult,
    };

    // ── 5. Audit log (fire-and-forget) ───────────────────────────────────────
    this.logExecution(record).catch((err) => {
      this.logger.error(`[execute] Audit log failed: ${err.message}`);
    });

    // ── 6. Emit completion event ─────────────────────────────────────────────
    if (options.emitEvents !== false) {
      this.eventEmitter.emit(
        result.success
          ? 'key.cortex.execution.completed'
          : 'key.cortex.execution.failed',
        {
          traceId,
          record,
          command,
          result,
          durationMs,
        },
      );
    }

    this.logger.log(
      `[execute] ${command.module}.${command.action} → ${result.success ? 'SUCCESS' : 'FAILED'} in ${durationMs}ms trace=${traceId}`,
    );

    return record;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 4 — executeBatch()
  // ════════════════════════════════════════════════════════════════════════════
  /**
   * Execute multiple commands in sequence.
   *
   * Behaviour:
   *   • Process commands in the given order.
   *   • If a command fails and stopOnFailure !== false, halt the batch.
   *   • If stopOnFailure === false, continue executing remaining commands.
   *   • Track aggregate statistics and produce a human summary.
   */
  async executeBatch(
    commands: ConnectorCommand[],
    options: ExecuteOptions = {},
  ): Promise<BatchResult> {
    const batchStart = Date.now();
    const traceId = options.traceId ?? this.generateTraceId('batch');

    if (commands.length === 0) {
      return {
        results: [],
        totalCommands: 0,
        succeededCount: 0,
        failedCount: 0,
        rolledBackCount: 0,
        durationMs: 0,
        traceId,
        stoppedEarly: false,
        summary: 'No commands to execute.',
      };
    }

    if (commands.length > MAX_BATCH_SIZE) {
      throw new InternalServerErrorException(
        `Batch size ${commands.length} exceeds maximum of ${MAX_BATCH_SIZE}`,
      );
    }

    this.logger.log(
      `[executeBatch] Starting batch of ${commands.length} commands trace=${traceId}`,
    );

    // Safety gate: reject batches containing blocked high-risk actions
    const blocked = commands.filter(isBlockedCommand);
    if (blocked.length > 0) {
      const names = blocked.map((c) => `${c.module}.${c.action}`).join(', ');
      throw new InternalServerErrorException(
        `Batch contains blocked high-risk actions: ${names}`,
      );
    }

    // Emit batch started
    this.eventEmitter.emit('key.cortex.batch.started', {
      traceId,
      commandCount: commands.length,
      startedAt: new Date(),
    });

    const results: ExecutionRecord[] = [];
    let succeededCount = 0;
    let failedCount = 0;
    let rolledBackCount = 0;
    let stoppedEarly = false;

    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      const cmdTraceId = `${traceId}_step${i + 1}`;

      this.logger.debug(
        `[executeBatch] Step ${i + 1}/${commands.length}: ${cmd.module}.${cmd.action}`,
      );

      const record = await this.execute(cmd, {
        ...options,
        traceId: cmdTraceId,
        emitEvents: false, // we'll emit one aggregated event
      });

      results.push(record);

      if (record.result.success) {
        succeededCount++;
      } else {
        failedCount++;
        if (record.rolledBack) rolledBackCount++;

        const shouldStop =
          options.stopOnFailure ?? BATCH_STOP_ON_FAILURE;
        if (shouldStop) {
          this.logger.warn(
            `[executeBatch] Stopping batch at step ${i + 1} due to failure`,
          );
          stoppedEarly = true;
          break;
        }
      }
    }

    const durationMs = Date.now() - batchStart;
    const summary = this.summarizeResults(
      results.map((r) => r.result),
    );

    const batchResult: BatchResult = {
      results,
      totalCommands: commands.length,
      succeededCount,
      failedCount,
      rolledBackCount,
      durationMs,
      traceId,
      stoppedEarly,
      summary,
    };

    // ── Batch-level audit log ────────────────────────────────────────────────
    this.logBatchExecution(batchResult).catch((err) => {
      this.logger.error(`[executeBatch] Batch audit log failed: ${err.message}`);
    });

    // ── Emit batch completion event ──────────────────────────────────────────
    if (options.emitEvents !== false) {
      this.eventEmitter.emit('key.cortex.batch.completed', {
        traceId,
        batchResult,
        durationMs,
      });
    }

    this.logger.log(
      `[executeBatch] Completed: ${succeededCount} OK, ${failedCount} failed, ${rolledBackCount} rolled back in ${durationMs}ms`,
    );

    return batchResult;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 5 — executeWithApproval()
  // ════════════════════════════════════════════════════════════════════════════
  /**
   * Create a pending approval request and emit a notification event.
   * The actual execution will be triggered when approval is granted
   * (handled by a separate approval-resolution handler).
   *
   * Returns a placeholder record with status 'pending'.
   */
  async executeWithApproval(
    command: ConnectorCommand,
  ): Promise<ApprovalRequest> {
    const correlationId =
      command.correlationId ?? this.generateTraceId('approval');

    let proposalId: string = randomUUID();

    // Persist as a canonical KeyActionProposal via the unified orchestrator
    if (this.approvalOrchestrator) {
      try {
        const proposal = await this.approvalOrchestrator.propose({
          businessId: command.businessId,
          userId: command.userId,
          sourceType: 'KEY_CORTEX',
          sourceId: command.correlationId,
          actionType: 'EXECUTE_TOOL',
          module: command.module,
          toolName: command.action,
          title: this.summarizeCommandForNotification(command),
          summary: `Pending approval for ${command.module}.${command.action}`,
          rationale: `Risk tier requires human approval`,
          parameters: {
            toolName: `${command.module}.${command.action}`,
            parameters: command.parameters,
            commandJson: command,
          },
          correlationId,
        });
        proposalId = proposal.id;
      } catch (dbErr) {
        this.logger.error(
          `[executeWithApproval] Failed to persist approval proposal: ${(dbErr as Error).message}`,
        );
        // Continue with in-memory tracking
      }
    } else if (this.proposalService) {
      // Legacy fallback until module wiring is updated
      try {
        const proposal = await this.proposalService.create(
          command.businessId,
          {
            sourceType: 'KEY_CORTEX',
            sourceMode: command.module,
            title: this.summarizeCommandForNotification(command),
            summary: `Pending approval for ${command.module}.${command.action}`,
            actionType: 'EXECUTE_TOOL',
            payload: {
              toolName: `${command.module}.${command.action}`,
              parameters: command.parameters,
              correlationId,
              commandJson: command,
            },
          },
          command.userId,
        );
        proposalId = proposal.id;
      } catch (dbErr) {
        this.logger.error(
          `[executeWithApproval] Failed to persist approval proposal: ${(dbErr as Error).message}`,
        );
        // Continue with in-memory tracking
      }
    }

    const request: ApprovalRequest = {
      id: proposalId,
      command,
      status: 'pending',
      requestedAt: new Date(),
      correlationId,
    };

    // Cache in memory for quick lookups
    this.pendingApprovals.set(proposalId, request);

    // Auto-clear after TTL to prevent memory leak (Fix 2)
    setTimeout(() => {
      this.pendingApprovals.delete(proposalId);
    }, APPROVAL_TTL_MS);

    // Emit notification event (non-blocking)
    this.eventEmitter.emit('key.cortex.approval.required', {
      approvalId: proposalId,
      correlationId,
      command,
      summary: this.summarizeCommandForNotification(command),
      requestedAt: request.requestedAt,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    this.logger.log(
      `[executeWithApproval] Created approval proposal ${proposalId} for ${command.module}.${command.action}`,
    );

    return request;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 6 — requiresApproval()
  // ════════════════════════════════════════════════════════════════════════════
  /**
   * Approval policy engine. Checks multiple layers:
   *   1. Action-level requiresApproval flag (from capability registry).
   *   2. Business autonomy settings (full / supervised / manual).
   *   3. User-specific approval preferences.
   *   4. Spending / action limits.
   *   5. Rate-limiting (max auto-executions per hour).
   */
  async requiresApproval(command: ConnectorCommand): Promise<boolean> {
    const { module, action, parameters, businessId, userId } = command;

    // ── 1. Fetch business policy ─────────────────────────────────────────────
    let policy: ApprovalPolicy;
    try {
      policy = await this.fetchApprovalPolicy(businessId, userId);
    } catch {
      // Default to supervised if we can't determine
      policy = {
        autonomyLevel: 'supervised',
        alwaysRequireApproval: ['delete_contact', 'delete_invoice', 'refund_payment', 'cancel_subscription', 'transfer_funds'],
        neverRequireApproval: ['get_contact', 'list_invoices', 'get_dashboard'],
        spendingThreshold: 1000,
        actionSpendingLimits: {},
        maxAutoExecutionsPerHour: 100,
        currentHourExecutionCount: 0,
      };
    }

    // ── 2. Never-require override ────────────────────────────────────────────
    const actionKey = `${module}.${action}`;
    if (policy.neverRequireApproval.includes(actionKey)) {
      return false;
    }

    // ── 3. Always-require override ───────────────────────────────────────────
    if (policy.alwaysRequireApproval.includes(actionKey)) {
      return true;
    }

    // ── 4. Action-level flag from capability registry ────────────────────────
    const capabilities = this.connector.getAllCapabilities();
    const cap = capabilities.find((c) => c.module === module);
    const actionDef = cap?.actions.find((a) => a.name === action);
    if (actionDef?.requiresApproval) {
      return true;
    }

    // ── 5. Business autonomy level ───────────────────────────────────────────
    switch (policy.autonomyLevel) {
      case 'manual':
        return true; // Everything needs approval
      case 'full':
        // Full autonomy — only alwaysRequireApproval blocks
        break;
      case 'supervised':
      default:
        // Check spending threshold
        if (this.exceedsSpendingLimit(parameters, policy, actionKey)) {
          return true;
        }
        break;
    }

    // ── 6. Rate limiting ─────────────────────────────────────────────────────
    if (policy.currentHourExecutionCount >= policy.maxAutoExecutionsPerHour) {
      this.logger.warn(
        `[requiresApproval] Rate limit hit for business ${businessId}: ${policy.currentHourExecutionCount}/${policy.maxAutoExecutionsPerHour}`,
      );
      return true;
    }

    return false;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 7 — logExecution()
  // ════════════════════════════════════════════════════════════════════════════
  /**
   * Persist an execution record to the database for audit trail.
   * Writes to aiExecutionLog (or equivalent) with full context.
   */
  async logExecution(record: ExecutionRecord): Promise<void> {
    try {
      await (this.prisma.client as any).aiExecutionLog.create({
        data: {
          id: record.id,
          businessId: record.command.businessId,
          userId: record.command.userId,
          traceId: record.traceId,
          correlationId: record.command.correlationId,
          module: record.command.module,
          action: record.command.action,
          parameters: JSON.stringify(record.command.parameters),
          commandJson: JSON.stringify(record.command),
          success: record.result.success,
          resultData: record.result.data
            ? JSON.stringify(record.result.data)
            : null,
          errorMessage: record.result.error ?? null,
          executionTimeMs: record.durationMs,
          rolledBack: record.rolledBack,
          rollbackResult: record.rollbackResult
            ? JSON.stringify(record.rollbackResult)
            : null,
          startedAt: record.startedAt,
          finishedAt: record.finishedAt,
          source: 'key_cortex',
        },
      });

      this.logger.debug(
        `[logExecution] Logged execution ${record.id} trace=${record.traceId}`,
      );
    } catch (err: any) {
      this.logger.error(
        `[logExecution] Failed to persist audit log: ${(err as Error).message}`,
      );
      throw err; // Let caller decide
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 8 — rollback()
  // ════════════════════════════════════════════════════════════════════════════
  /**
   * Attempt to undo a failed action where a compensating transaction exists.
   * Not all actions are reversible — this is best-effort.
   *
   * Rollback map:
   *   • create_*   → delete_*   (if we have the created entity ID)
   *   • send_*     → cancel_*   (if supported by downstream)
   *   • update_*   → revert to previous state
   *   • delete_*   → recreate   (rare — usually irreversible)
   */
  async rollback(result: ConnectorResult): Promise<ConnectorResult> {
    const { command } = result;
    const startMs = Date.now();

    this.logger.log(
      `[rollback] Attempting rollback for ${command.module}.${command.action}`,
    );

    // Determine the compensating action
    const compensatingAction = this.getCompensatingAction(command.action);

    if (!compensatingAction) {
      this.logger.warn(
        `[rollback] No compensating action known for ${command.action}`,
      );
      return {
        success: false,
        error: `No rollback available for action "${command.action}"`,
        executionTimeMs: Date.now() - startMs,
        command,
      };
    }

    // Build rollback command
    const rollbackCommand: ConnectorCommand = {
      ...command,
      action: compensatingAction,
      parameters: this.buildRollbackParameters(command),
      correlationId: `${command.correlationId}_rollback`,
      timestamp: new Date(),
    };

    try {
      const rollbackResult = await this.executeWithTimeout(
        rollbackCommand,
        EXECUTION_TIMEOUT_MS,
      );

      this.logger.log(
        `[rollback] ${rollbackResult.success ? 'SUCCESS' : 'FAILED'} for ${command.module}.${command.action} in ${Date.now() - startMs}ms`,
      );

      // Emit rollback event
      this.eventEmitter.emit('key.cortex.execution.rollback', {
        originalCommand: command,
        rollbackCommand,
        result: rollbackResult,
        durationMs: Date.now() - startMs,
      });

      return rollbackResult;
    } catch (err: any) {
      this.logger.error(
        `[rollback] Rollback execution failed: ${(err as Error).message}`,
      );
      return {
        success: false,
        error: `Rollback failed: ${(err as Error).message}`,
        executionTimeMs: Date.now() - startMs,
        command: rollbackCommand,
      };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 9 — summarizeResults()
  // ════════════════════════════════════════════════════════════════════════════
  /**
   * Generate a human-friendly summary of a set of execution results.
   *
   * Examples:
   *   "Created 3 tasks, sent 2 messages, 1 action failed"
   *   "All 5 actions completed successfully"
   *   "1 invoice created, 1 email sent. Approval pending for payment."
   */
  summarizeResults(results: ConnectorResult[]): string {
    if (results.length === 0) {
      return 'No actions were executed.';
    }

    if (results.length === 1) {
      const r = results[0];
      if (r.success) {
        const dataDesc = this.describeResultData(r.data);
        return dataDesc
          ? `Done! ${dataDesc}`
          : `Action completed successfully.`;
      }
      if (r.error === 'Approval pending') {
        return 'Waiting for your approval before proceeding.';
      }
      return `Action failed: ${r.error ?? 'Unknown error'}`;
    }

    // ── Aggregate by (module, action) ────────────────────────────────────────
    const actionCounts = new Map<
      string,
      { success: number; failed: number; data: unknown[] }
    >();

    for (const r of results) {
      const key = `${r.command.module}.${r.command.action}`;
      const entry = actionCounts.get(key) ?? {
        success: 0,
        failed: 0,
        data: [],
      };
      if (r.success) {
        entry.success++;
        if (r.data) entry.data.push(r.data);
      } else {
        entry.failed++;
      }
      actionCounts.set(key, entry);
    }

    const parts: string[] = [];
    for (const [key, counts] of actionCounts) {
      const display = key.replace('.', ' ').replace(/_/g, ' ');
      if (counts.success > 0 && counts.failed === 0) {
        parts.push(
          counts.success === 1
            ? `${display} completed`
            : `${counts.success} ${display}s completed`,
        );
      } else if (counts.success > 0 && counts.failed > 0) {
        parts.push(
          `${counts.success} ${display}s completed, ${counts.failed} failed`,
        );
      } else {
        parts.push(
          counts.failed === 1
            ? `${display} failed`
            : `${counts.failed} ${display}s failed`,
        );
      }
    }

    const totalOk = results.filter((r) => r.success).length;
    const totalFail = results.length - totalOk;

    if (totalFail === 0) {
      return `All ${results.length} actions completed successfully. ${parts.join(', ')}.`;
    }

    if (totalOk === 0) {
      return `All ${results.length} actions failed. ${parts.join(', ')}.`;
    }

    return `${parts.join(', ')}.`;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 10 — Internal Helpers
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Execute a connector command with a hard timeout.
   * Clears the timeout after race resolves to prevent memory leak (Fix 4).
   */
  private async executeWithTimeout(
    command: ConnectorCommand,
    timeoutMs: number,
  ): Promise<ConnectorResult> {
    let timeout: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error(`Execution timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    return Promise.race([
      this.connector.execute(command),
      timeoutPromise,
    ]).finally(() => {
      clearTimeout(timeout);
    }) as Promise<ConnectorResult>;
  }

  /**
   * Fetch the approval policy for a business + user from the database.
   */
  private async fetchApprovalPolicy(
    businessId: string,
    _userId: string,
  ): Promise<ApprovalPolicy> {
    try {
      const setting = await (this.prisma.client as any).businessSetting.findUnique({
        where: { businessId },
        select: {
          aiAutonomyLevel: true,
          aiAlwaysRequireApproval: true,
          aiNeverRequireApproval: true,
          aiSpendingThreshold: true,
          aiActionSpendingLimits: true,
          aiMaxAutoExecutionsPerHour: true,
        },
      });

      // Count recent auto-executions for rate-limiting
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recentCount = await (this.prisma.client as any).aiExecutionLog.count({
        where: {
          businessId,
          success: true,
          startedAt: { gte: oneHourAgo },
        },
      });

      const autonomyLevel = (setting?.aiAutonomyLevel as ApprovalPolicy['autonomyLevel']) ?? 'supervised';

      return {
        autonomyLevel,
        alwaysRequireApproval: this.parseStringArray(
          setting?.aiAlwaysRequireApproval,
        ),
        neverRequireApproval: this.parseStringArray(
          setting?.aiNeverRequireApproval,
        ),
        spendingThreshold: setting?.aiSpendingThreshold
          ? Number(setting.aiSpendingThreshold)
          : undefined,
        actionSpendingLimits: this.parseRecord(
          setting?.aiActionSpendingLimits,
        ),
        maxAutoExecutionsPerHour:
          setting?.aiMaxAutoExecutionsPerHour ?? 100,
        currentHourExecutionCount: recentCount,
      };
    } catch {
      // Fallback policy
      return {
        autonomyLevel: 'supervised',
        alwaysRequireApproval: [],
        neverRequireApproval: [],
        spendingThreshold: 1000,
        actionSpendingLimits: {},
        maxAutoExecutionsPerHour: 100,
        currentHourExecutionCount: 0,
      };
    }
  }

  /**
   * Check if the command parameters exceed configured spending limits.
   */
  private exceedsSpendingLimit(
    parameters: Record<string, unknown>,
    policy: ApprovalPolicy,
    actionKey: string,
  ): boolean {
    // Extract monetary values from parameters
    const amount = this.extractMonetaryValue(parameters);
    if (amount === undefined) return false;

    // Check per-action spending limit
    const actionLimit = policy.actionSpendingLimits[actionKey];
    if (actionLimit !== undefined && amount > actionLimit) {
      this.logger.debug(
        `[exceedsSpendingLimit] Amount ${amount} exceeds action limit ${actionLimit}`,
      );
      return true;
    }

    // Check global spending threshold
    if (
      policy.spendingThreshold !== undefined &&
      amount > policy.spendingThreshold
    ) {
      this.logger.debug(
        `[exceedsSpendingLimit] Amount ${amount} exceeds threshold ${policy.spendingThreshold}`,
      );
      return true;
    }

    return false;
  }

  /**
   * Extract a monetary value from command parameters.
   */
  private extractMonetaryValue(
    parameters: Record<string, unknown>,
  ): number | undefined {
    const moneyKeys = ['amount', 'price', 'total', 'value', 'cost', 'spend', 'budget'];
    for (const key of moneyKeys) {
      const val = parameters[key];
      if (typeof val === 'number') return val;
      if (typeof val === 'string') {
        const parsed = parseFloat(val.replace(/[$,]/g, ''));
        if (!isNaN(parsed)) return parsed;
      }
    }

    // Check nested items (e.g., invoice line items)
    const items = parameters.items;
    if (Array.isArray(items)) {
      return items.reduce((sum: number, item: unknown) => {
        if (typeof item === 'object' && item !== null) {
          const it = item as Record<string, unknown>;
          const amt =
            typeof it.amount === 'number'
              ? it.amount
              : typeof it.price === 'number'
                ? it.price
                : typeof it.total === 'number'
                  ? it.total
                  : 0;
          return sum + amt;
        }
        return sum;
      }, 0);
    }

    return undefined;
  }

  /**
   * Map an action to its compensating (undo) action.
   */
  private getCompensatingAction(action: string): string | null {
    const compensations: Record<string, string> = {
      // CRM
      create_contact: 'delete_contact',
      update_contact: 'revert_contact_update',
      add_task: 'delete_task',
      // Commerce
      create_invoice: 'void_invoice',
      create_quote: 'delete_quote',
      create_order: 'cancel_order',
      create_product: 'delete_product',
      apply_discount: 'remove_discount',
      // Bookings
      create_appointment: 'cancel_appointment',
      // Content
      create_campaign: 'delete_campaign',
      schedule_post: 'unschedule_post',
      publish_post: 'unpublish_post',
      // Communications
      send_email: 'cancel_email',
      send_sms: 'cancel_sms',
      send_campaign: 'cancel_campaign',
      // Flow
      create_flow: 'delete_flow',
      enable_flow: 'disable_flow',
      // Projects
      create_project: 'delete_project',
      create_project_task: 'delete_project_task',
      // Notifications
      send_notification: 'cancel_notification',
      // Generic
      update: 'revert_update',
      create: 'delete',
      add: 'remove',
      assign: 'unassign',
      enable: 'disable',
      activate: 'deactivate',
    };

    // Direct match
    if (compensations[action]) {
      return compensations[action];
    }

    // Prefix-based match
    for (const [prefix, compensation] of Object.entries(compensations)) {
      if (action.startsWith(prefix)) {
        return action.replace(prefix, compensation);
      }
    }

    return null;
  }

  /**
   * Build rollback-specific parameters from the original command.
   */
  private buildRollbackParameters(
    command: ConnectorCommand,
  ): Record<string, unknown> {
    const params: Record<string, unknown> = { ...command.parameters };

    // If the original result produced an ID, use it for rollback
    if (params.id) {
      params.targetId = params.id;
    }
    if (params.contactId) {
      params.targetId = params.contactId;
    }
    if (params.invoiceId) {
      params.targetId = params.invoiceId;
    }
    if (params.taskId) {
      params.targetId = params.taskId;
    }
    if (params.appointmentId) {
      params.targetId = params.appointmentId;
    }

    // Include the original action for context
    params._originalAction = command.action;
    params._rollbackReason = 'execution_failure';

    return params;
  }

  /**
   * Describe result data for human-friendly summaries.
   */
  private describeResultData(data: unknown): string | null {
    if (!data) return null;

    try {
      const d = data as Record<string, unknown>;

      if (d.name && typeof d.name === 'string') {
        return `"${d.name}" was created successfully.`;
      }
      if (d.title && typeof d.title === 'string') {
        return `"${d.title}" was created successfully.`;
      }
      if (d.id && typeof d.id === 'string') {
        return `Record ${d.id} was created.`;
      }
      if (d.contactId && typeof d.contactId === 'string') {
        return `Contact ${d.contactId} updated.`;
      }
      if (d.invoiceId && typeof d.invoiceId === 'string') {
        return `Invoice ${d.invoiceId} processed.`;
      }
      if (d.email && typeof d.email === 'string') {
        return `Email sent to ${d.email}.`;
      }
      if (d.count && typeof d.count === 'number') {
        return `${d.count} item(s) affected.`;
      }
      if (d.message && typeof d.message === 'string') {
        return d.message;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Summarize a command for the approval notification payload.
   */
  private summarizeCommandForNotification(
    command: ConnectorCommand,
  ): string {
    const actionDisplay = command.action.replace(/_/g, ' ');
    const moduleDisplay = command.module;
    const paramHighlights: string[] = [];

    const p = command.parameters;
    if (p.name) paramHighlights.push(`name: ${p.name}`);
    if (p.title) paramHighlights.push(`title: ${p.title}`);
    if (p.amount) paramHighlights.push(`amount: $${p.amount}`);
    if (p.email) paramHighlights.push(`to: ${p.email}`);
    if (p.contactName || p.customerName)
      paramHighlights.push(`for: ${p.contactName ?? p.customerName}`);

    const paramStr =
      paramHighlights.length > 0
        ? ` (${paramHighlights.join(', ')})`
        : '';

    return `${moduleDisplay}: ${actionDisplay}${paramStr}`;
  }

  /**
   * Log a batch execution as a single aggregated audit record.
   */
  private async logBatchExecution(batch: BatchResult): Promise<void> {
    try {
      await (this.prisma.client as any).aiExecutionLog.create({
        data: {
          id: randomUUID(),
          businessId:
            batch.results[0]?.command.businessId ?? 'unknown',
          userId: batch.results[0]?.command.userId ?? 'unknown',
          traceId: batch.traceId,
          correlationId: batch.traceId,
          module: 'batch',
          action: 'execute_batch',
          parameters: JSON.stringify({
            totalCommands: batch.totalCommands,
            succeeded: batch.succeededCount,
            failed: batch.failedCount,
            stoppedEarly: batch.stoppedEarly,
          }),
          commandJson: JSON.stringify({
            traceId: batch.traceId,
            results: batch.results.map((r) => ({
              module: r.command.module,
              action: r.command.action,
              success: r.result.success,
              durationMs: r.durationMs,
            })),
          }),
          success: batch.failedCount === 0,
          resultData: JSON.stringify({
            summary: batch.summary,
            succeeded: batch.succeededCount,
            failed: batch.failedCount,
          }),
          errorMessage:
            batch.failedCount > 0
              ? `${batch.failedCount} command(s) failed`
              : null,
          executionTimeMs: batch.durationMs,
          rolledBack: batch.rolledBackCount > 0,
          startedAt: batch.results[0]?.startedAt ?? new Date(),
          finishedAt: new Date(
            (batch.results[0]?.startedAt ?? new Date()).getTime() +
              batch.durationMs,
          ),
          source: 'key_cortex',
        },
      });
    } catch (err: any) {
      this.logger.error(
        `[logBatchExecution] Failed: ${(err as Error).message}`,
      );
    }
  }

  // ─── JSON Parsing Helpers ───────────────────────────────────────────────────

  private parseStringArray(value: unknown): string[] {
    if (Array.isArray(value)) return value as string[];
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return value.split(',').map((s) => s.trim());
      }
    }
    return [];
  }

  private parseRecord(value: unknown): Record<string, number> {
    if (typeof value === 'object' && value !== null) {
      return value as Record<string, number>;
    }
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as Record<string, number>;
      } catch {
        return {};
      }
    }
    return {};
  }

  private generateTraceId(prefix = 'exec'): string {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 6);
    return `${prefix}_${ts}_${rand}`;
  }

  /**
   * Gateway alias: execute the command attached to an already-approved request.
   */
  async executeApprovedAction(approvalId: string): Promise<ExecutionRecord> {
    const start = Date.now();

    if (this.approvalOrchestrator) {
      try {
        const before = await this.proposalService?.getById(approvalId);
        const command = (before?.payload?.commandJson ?? {
          businessId: before?.businessId,
          userId: before?.userId,
        }) as ConnectorCommand;

        const executed = await this.approvalOrchestrator.executeApproved({
          businessId: before?.businessId ?? command.businessId,
          proposalId: approvalId,
          userId: before?.approvedBy ?? undefined,
        });

        const success = executed.status === 'EXECUTED';
        const finishedAt = new Date();
        return {
          id: approvalId,
          command,
          result: {
            success,
            data: success ? (executed.executionResult ?? {}) : undefined,
            error: executed.failureReason ?? undefined,
            executionTimeMs: finishedAt.getTime() - start,
            command,
          },
          startedAt: new Date(start),
          finishedAt,
          durationMs: finishedAt.getTime() - start,
          traceId: approvalId,
          rolledBack: false,
        };
      } catch (err: unknown) {
        this.logger.error(
          `[executeApprovedAction] Failed to execute proposal ${approvalId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        throw err;
      }
    }

    if (this.proposalService) {
      try {
        const proposal = await this.proposalService.getById(approvalId);
        if (proposal.status !== 'APPROVED') {
          throw new Error(`Proposal ${approvalId} is not approved`);
        }
        const executed = await this.proposalService.execute(
          proposal.businessId,
          approvalId,
          proposal.approvedBy ?? undefined,
          true,
          true,
        );
        const command = (proposal.payload?.commandJson ?? {
          businessId: proposal.businessId,
          userId: proposal.userId,
        }) as ConnectorCommand;
        const success = executed.status === 'EXECUTED';
        const finishedAt = new Date();
        return {
          id: approvalId,
          command,
          result: {
            success,
            data: success ? (executed.executionResult ?? {}) : undefined,
            error: executed.failureReason ?? undefined,
            executionTimeMs: finishedAt.getTime() - start,
            command,
          },
          startedAt: new Date(start),
          finishedAt,
          durationMs: finishedAt.getTime() - start,
          traceId: approvalId,
          rolledBack: false,
        };
      } catch (err: unknown) {
        this.logger.error(
          `[executeApprovedAction] Failed to execute proposal ${approvalId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        throw err;
      }
    }

    throw new Error(`Approval proposal ${approvalId} not found`);
  }
}
