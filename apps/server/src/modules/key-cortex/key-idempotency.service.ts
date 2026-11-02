import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface IdempotencyCheckResult<T = unknown> {
  /**
   * new       — this caller holds the claim: run the action, then complete/fail.
   * pending   — another caller holds the claim and has not finished: do not run.
   * completed — settled: `response` is the stored outcome.
   * failed    — settled: `error` is the stored error.
   * conflict  — the key was claimed for a different request (request hashes differ).
   */
  status: 'new' | 'pending' | 'completed' | 'failed' | 'conflict';
  response?: T;
  error?: string;
}

export interface IdempotencyRequest {
  businessId: string;
  idempotencyKey: string;
  requestHash?: string;
}

interface StoredIdempotencyKey {
  status: string;
  requestHash: string | null;
  response: unknown;
  error: string | null;
}

const IN_FLIGHT = 'Idempotency key is being processed by another request';

/** Prisma's unique-constraint violation, matched on the code (the idiom of key-action-boundary.service.ts). */
function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: unknown }).code === 'P2002';
}

/**
 * Idempotency registry for KEY autonomous actions.
 *
 * Guarantees that retrying the same action with the same idempotency key
 * returns the original outcome without re-executing side effects.
 *
 * V1-19-KEY-IDEMPOTENCY-CLAIM (#174 KEY-04, PRS-M26): check() is a claim. The
 * INSERT on the (business_id, idempotency_key) unique index decides who runs:
 * exactly one caller is answered 'new', and every other caller, concurrent or
 * later, is answered 'pending' until that claimant completes or fails. Before,
 * check() was read-then-insert: two callers that both read before either
 * inserted both took the insert (the loser's P2002 escaped check()), and a key
 * found pending was answered 'new' ("last-writer-wins"), so a caller arriving
 * while the first was still running ran the action too. The stored
 * request_hash is now compared: a key presented with a different request hash
 * is a 'conflict', never the stored outcome of the other request.
 */
@Injectable()
export class KeyIdempotencyService {
  private readonly logger = new Logger(KeyIdempotencyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Claim an idempotency key, or report who holds it.
   * Returns 'new' only to the caller whose insert created the key; that caller
   * proceeds and later calls complete/fail.
   */
  async check<T = unknown>(req: IdempotencyRequest): Promise<IdempotencyCheckResult<T>> {
    const where = {
      businessId_idempotencyKey: {
        businessId: req.businessId,
        idempotencyKey: req.idempotencyKey,
      },
    };

    // A settled key answers from the read; there is nothing left to claim.
    const existing = await this.prisma.client.idempotencyKey.findUnique({ where });
    if (existing && (existing.status === 'completed' || existing.status === 'failed')) {
      return this.answerFor<T>(existing, req);
    }

    // Absent or in flight: the insert is the claim. A held key fails it on the
    // unique index, and this caller is told about the holder's row instead.
    try {
      await this.prisma.client.idempotencyKey.create({
        data: {
          businessId: req.businessId,
          idempotencyKey: req.idempotencyKey,
          status: 'pending',
          requestHash: req.requestHash ?? null,
        },
      });
      return { status: 'new' };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }

    const holder = await this.prisma.client.idempotencyKey.findUnique({ where });
    if (!holder) {
      // The holder's row went away between the failed insert and this read.
      // The claim was never this caller's, so it still must not run.
      return { status: 'pending', error: IN_FLIGHT };
    }
    return this.answerFor<T>(holder, req);
  }

  /** What a caller that does not hold the claim is told about the stored key. */
  private answerFor<T>(row: StoredIdempotencyKey, req: IdempotencyRequest): IdempotencyCheckResult<T> {
    // Compared only when both sides carry a hash: a key stored or presented
    // without one has nothing to compare and replays as before.
    if (req.requestHash && row.requestHash && req.requestHash !== row.requestHash) {
      this.logger.warn(
        `[check][${req.businessId}] idempotency key ${req.idempotencyKey} reused for a different request`,
      );
      return { status: 'conflict', error: 'Idempotency key was already used for a different request' };
    }

    if (row.status === 'completed') {
      return {
        status: 'completed',
        response: row.response ? (row.response as T) : undefined,
      };
    }

    if (row.status === 'failed') {
      return {
        status: 'failed',
        error: row.error ?? undefined,
      };
    }

    // Any other status: a claimant holds the key and has not finished.
    return { status: 'pending', error: IN_FLIGHT };
  }

  /**
   * Mark an idempotency key as completed with its deterministic response.
   */
  async complete<T>(req: IdempotencyRequest, response: T): Promise<void> {
    await this.prisma.client.idempotencyKey.update({
      where: {
        businessId_idempotencyKey: {
          businessId: req.businessId,
          idempotencyKey: req.idempotencyKey,
        },
      },
      data: {
        status: 'completed',
        response: response as any,
      },
    });
  }

  /**
   * Mark an idempotency key as failed with its deterministic error.
   */
  async fail(req: IdempotencyRequest, error: string): Promise<void> {
    await this.prisma.client.idempotencyKey.update({
      where: {
        businessId_idempotencyKey: {
          businessId: req.businessId,
          idempotencyKey: req.idempotencyKey,
        },
      },
      data: {
        status: 'failed',
        error,
      },
    });
  }
}
