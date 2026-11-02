import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { canonicalJson } from '../key-autonomy/action-boundary/action-envelope';

/**
 * The request hash a tool call claims its idempotency key under (V1-19b,
 * SEC-V19-3): sha256 over the canonical JSON (object keys sorted at every
 * depth, as the KEY action boundary fingerprints) of the tool name and its
 * input. The input is taken in its JSON form first, so a Date is its ISO
 * string and an undefined field is absent: two requests that serialize alike
 * are one request to the claim, and two that do not are a 'conflict'.
 *
 * The acting user is part of the request when there is one (V1-19b review,
 * SEC-V19b-4): the same key and input presented by another member is another
 * request, a 'conflict', and is never handed this member's stored outcome. A
 * call with no acting user (a system caller) hashes as name and input alone.
 *
 * It replaces the tool registry's own hash, a 32-bit string hash of
 * key-order-sensitive JSON.stringify ({to:'Aa'} and {to:'BB'} hashed alike;
 * {a,b} and {b,a} did not) that answered '0' for every input it could not
 * serialize. An input with no JSON form (a circular reference, a BigInt) has
 * no fingerprint: this throws, and the caller must not claim a key for it.
 */
export function fingerprintToolRequest(toolName: string, input: unknown, actorId?: string | null): string {
  let jsonForm: unknown;
  try {
    jsonForm = JSON.parse(
      JSON.stringify({ name: toolName, input: input ?? null, ...(actorId ? { actor: actorId } : {}) }),
    );
  } catch (err) {
    throw new Error(`Request cannot be fingerprinted: ${err instanceof Error ? err.message : String(err)}`, {
      cause: err,
    });
  }
  return createHash('sha256').update(canonicalJson(jsonForm)).digest('hex');
}

export interface IdempotencyCheckResult<T = unknown> {
  /**
   * new       — this caller holds the claim: run the action, then complete/fail
   *             (or release, if it decides not to run).
   * pending   — another caller holds the claim and has not finished: do not run.
   * completed — settled: `response` is the stored outcome.
   * failed    — settled: `error` is the stored error, and `response` the stored
   *             outcome when the claimant stored one with it.
   * conflict  — the key was claimed for a different request (request hashes differ).
   */
  status: 'new' | 'pending' | 'completed' | 'failed' | 'conflict';
  response?: T;
  error?: string;
  /**
   * On 'new' only: the id of the claim this caller holds. Passed back to
   * complete(), fail() or release(), it binds that call to this claim alone.
   */
  claimId?: string;
}

export interface IdempotencyRequest {
  businessId: string;
  idempotencyKey: string;
  requestHash?: string;
  /**
   * The claimId check() answered with 'new'. When given, complete() and fail()
   * settle that claim only (never one released and claimed again since).
   */
  claimId?: string;
}

interface StoredIdempotencyKey {
  status: string;
  requestHash: string | null;
  response: unknown;
  error: string | null;
}

type SettleData =
  | { status: 'completed'; response: Prisma.InputJsonValue }
  | { status: 'failed'; error: string; response?: Prisma.InputJsonValue };

const IN_FLIGHT = 'Idempotency key is being processed by another request';

/** Prisma's unique-constraint violation, matched on the code (the idiom of key-action-boundary.service.ts). */
function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: unknown }).code === 'P2002';
}

/** Prisma's "record to update not found": the filtered unique where matched no row. */
function isRecordNotFound(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: unknown }).code === 'P2025';
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
 * is a 'conflict', not the stored outcome of the other request. That holds
 * only as far as the caller's request hash tells two requests apart: requests
 * the caller hashes alike are, to this service, the same request. The tool
 * registry hashes with fingerprintToolRequest() above (V1-19b).
 *
 * Settling is bound to the claim (V1-19 review, SEC-V19-1): complete() and
 * fail() write only a key that is still 'pending', only for the caller's
 * request hash when it presents one, and only for the caller's claimId when it
 * presents that. A settled key is never settled again, and a caller answered
 * 'conflict' cannot overwrite the holder's outcome. Each answers whether it
 * settled the claim. A caller that presents no claimId is bound by status and
 * hash only; the tool registry presents both (V1-19b). release() gives an
 * open claim up without an outcome (V1-19 review, CR-V19-2), so a claimant
 * that decides not to run need not hold the key for good; the tool registry
 * releases on every path that returns without running the tool (V1-19b),
 * except the one that files an approval proposal, which settles the key with
 * that proposal so a retry is answered with it instead of filing another
 * (V1-19b review, SEC-V19b-2).
 */
@Injectable()
export class KeyIdempotencyService {
  private readonly logger = new Logger(KeyIdempotencyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Claim an idempotency key, or report who holds it.
   * Returns 'new' (with the claimId) only to the caller whose insert created
   * the key; that caller proceeds and later calls complete, fail or release.
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
      const claim = await this.prisma.client.idempotencyKey.create({
        data: {
          businessId: req.businessId,
          idempotencyKey: req.idempotencyKey,
          status: 'pending',
          requestHash: req.requestHash ?? null,
        },
      });
      return { status: 'new', claimId: claim.id };
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
        ...(row.response ? { response: row.response as T } : {}),
      };
    }

    // Any other status: a claimant holds the key and has not finished.
    return { status: 'pending', error: IN_FLIGHT };
  }

  /**
   * Mark the open claim on an idempotency key as completed with its
   * deterministic response. Answers whether this call settled it (false: no
   * open claim of this caller's, and the stored row is unchanged).
   */
  async complete<T>(req: IdempotencyRequest, response: T): Promise<boolean> {
    return this.settle(req, 'complete', { status: 'completed', response: response as Prisma.InputJsonValue });
  }

  /**
   * Mark the open claim on an idempotency key as failed with its deterministic
   * error and, when given, the answer the claimant gave with it, so a replay
   * answers as the first call did (V1-19b review, SEC-V19b-1). Answers whether
   * this call settled it, as complete() does.
   */
  async fail<T>(req: IdempotencyRequest, error: string, response?: T): Promise<boolean> {
    return this.settle(req, 'fail', {
      status: 'failed',
      error,
      ...(response !== undefined ? { response: response as Prisma.InputJsonValue } : {}),
    });
  }

  /**
   * Give an open claim up without an outcome: the claimant decided not to run
   * the action (refused, or sent for approval). The key is free again, so the
   * next check() is answered 'new'. Only the claimant can do this: its claimId
   * is required, and a settled key is never released. Answers whether it did.
   */
  async release(req: IdempotencyRequest & { claimId: string }): Promise<boolean> {
    const { count } = await this.prisma.client.idempotencyKey.deleteMany({
      where: {
        businessId: req.businessId,
        idempotencyKey: req.idempotencyKey,
        id: req.claimId,
        status: 'pending',
      },
    });
    return count === 1;
  }

  /**
   * The row a settle may write: the key while its claim is still open, for the
   * caller's request (a row stored without a hash has nothing to compare, as in
   * check()), and for the caller's claim when it names one.
   */
  private openClaim(req: IdempotencyRequest) {
    return {
      businessId_idempotencyKey: {
        businessId: req.businessId,
        idempotencyKey: req.idempotencyKey,
      },
      status: 'pending',
      ...(req.requestHash ? { OR: [{ requestHash: req.requestHash }, { requestHash: null }] } : {}),
      ...(req.claimId ? { id: req.claimId } : {}),
    };
  }

  private async settle(req: IdempotencyRequest, op: 'complete' | 'fail', data: SettleData): Promise<boolean> {
    try {
      // update with a filtered unique where: at most the one row is written,
      // and P2025 is the answer when no open claim of this caller's matches.
      await this.prisma.client.idempotencyKey.update({ where: this.openClaim(req), data });
      return true;
    } catch (err) {
      if (!isRecordNotFound(err)) throw err;
      this.logger.warn(
        `[${op}][${req.businessId}] idempotency key ${req.idempotencyKey} has no open claim for this caller; the stored row is unchanged`,
      );
      return false;
    }
  }
}
