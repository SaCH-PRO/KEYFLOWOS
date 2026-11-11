import { createHash, randomUUID } from 'crypto';
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

/** An open claim as check() reads it: the row id is its claimId. */
interface StoredClaim extends StoredIdempotencyKey {
  id: string;
  updatedAt: Date;
}

type SettleData =
  | { status: 'completed'; response: Prisma.InputJsonValue }
  | { status: 'failed'; error: string; response?: Prisma.InputJsonValue };

const IN_FLIGHT = 'Idempotency key is being processed by another request';

/**
 * The claim lease (owner ruling D-103, W10-CLAIM-LEASE; closes V1-19 review
 * CR-V19-2 and supersedes D-51's manual release): a claim still open this long
 * after it was taken is stranded (its claimant crashed between check() and its
 * settle), and the next check() of the same request takes it over.
 */
export const KEY_IDEMPOTENCY_CLAIM_LEASE_MS = 15 * 60 * 1000;

/** The KEY execution log's (CortexActionLog) action type of a takeover (D-103). */
export const KEY_IDEMPOTENCY_TAKEOVER_ACTION = 'idempotency.claim_takeover';

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
 *
 * A claim stranded by a crash between check() and its settle is not held for
 * good (owner ruling D-103, W10-CLAIM-LEASE, closing CR-V19-2): still open
 * KEY_IDEMPOTENCY_CLAIM_LEASE_MS (15 minutes) after it was taken (the row's
 * updated_at: when it was claimed, or last taken over), it is taken over by
 * the next check() of the same request. See takeOver().
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

    // A settled key answers from the read; there is nothing left to claim, and
    // however old it is, a finished claim is never run again (D-103).
    const existing = await this.prisma.client.idempotencyKey.findUnique({ where });
    if (existing && (existing.status === 'completed' || existing.status === 'failed')) {
      return this.answerFor<T>(existing, req);
    }

    // D-103: an open claim past its lease is stranded, and this retry of the
    // same request takes it over. A retry that loses the takeover to another
    // (or finds the claim settled or released meanwhile) goes on below and is
    // answered from the row as it now is.
    if (existing && this.isStranded(existing) && !this.isOtherRequest(existing, req)) {
      const takenOver = await this.takeOver<T>(existing, req);
      if (takenOver) return takenOver;
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

  /**
   * Whether the caller presents another request than the one the key was
   * claimed for. Compared only when both sides carry a hash: a key stored or
   * presented without one has nothing to compare and replays as before.
   */
  private isOtherRequest(row: StoredIdempotencyKey, req: IdempotencyRequest): boolean {
    return !!(req.requestHash && row.requestHash && req.requestHash !== row.requestHash);
  }

  /**
   * D-103: an open claim (status 'pending', the status check() claims under)
   * not taken again for KEY_IDEMPOTENCY_CLAIM_LEASE_MS. Any other status is
   * not this service's claim to take over: a settled key is never run again,
   * and the KEY action boundary's own rows in this table ('claimed', 'voided')
   * are never touched here.
   */
  private isStranded(row: StoredIdempotencyKey & { updatedAt?: Date }): row is StoredClaim {
    return (
      row.status === 'pending' &&
      row.updatedAt instanceof Date &&
      Date.now() - row.updatedAt.getTime() >= KEY_IDEMPOTENCY_CLAIM_LEASE_MS
    );
  }

  /**
   * Take a stranded claim over for this caller (owner ruling D-103,
   * W10-CLAIM-LEASE). One conditional update on the claim row: it matches only
   * while the row is still the stranded claim this caller read (its id, still
   * 'pending', still past its lease), and it gives the row a new id, the new
   * claimId, and a new lease (updated_at now). Of two retries racing for one
   * stranded claim, the second update waits on the row lock and then matches
   * nothing (the id is gone), so exactly one takes it over. The stranded
   * holder's claimId then names no row: its complete(), fail() and release()
   * bind nothing and answer false.
   *
   * The takeover is written to the KEY execution log (CortexActionLog) in the
   * same transaction, naming the old claim and its age, so no takeover goes
   * unrecorded: if the log row cannot be written the takeover is undone and
   * the error propagates, as any other database error of check() does.
   *
   * Answers 'new' with the new claimId, or null when another caller took the
   * claim over first, or it was settled or released meanwhile.
   */
  private async takeOver<T>(stale: StoredClaim, req: IdempotencyRequest): Promise<IdempotencyCheckResult<T> | null> {
    const claimId = randomUUID();
    // The stranded claim as this caller read it (values, not the row object).
    const staleId = stale.id;
    const staleTakenAt = new Date(stale.updatedAt.getTime());
    const staleHash = stale.requestHash;
    const now = new Date();
    const ageMs = now.getTime() - staleTakenAt.getTime();
    const ageMinutes = Math.floor(ageMs / 60_000);
    const leaseMinutes = KEY_IDEMPOTENCY_CLAIM_LEASE_MS / 60_000;

    const taken = await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.idempotencyKey.updateMany({
        where: {
          id: staleId,
          businessId: req.businessId,
          idempotencyKey: req.idempotencyKey,
          status: 'pending',
          updatedAt: { lte: new Date(now.getTime() - KEY_IDEMPOTENCY_CLAIM_LEASE_MS) },
        },
        // The key stays bound to its request: only the same request (or one
        // with nothing to compare) gets here, so the stored hash is kept unless
        // the row had none and this caller brings one, as a fresh claim would.
        data: { id: claimId, updatedAt: now, requestHash: req.requestHash ?? staleHash },
      });
      if (count !== 1) return false;

      await tx.cortexActionLog.create({
        data: {
          businessId: req.businessId,
          sessionId: `idempotency:${req.idempotencyKey}`,
          actionType: KEY_IDEMPOTENCY_TAKEOVER_ACTION,
          status: 'success',
          description:
            `Idempotency claim ${staleId} on key ${req.idempotencyKey} was still open ${ageMinutes} min after it was taken ` +
            `(lease ${leaseMinutes} min, D-103): taken over as claim ${claimId}`,
          result: JSON.stringify({
            idempotencyKey: req.idempotencyKey,
            staleClaimId: staleId,
            staleClaimTakenAt: staleTakenAt.toISOString(),
            staleClaimAgeMs: ageMs,
            newClaimId: claimId,
            leaseMs: KEY_IDEMPOTENCY_CLAIM_LEASE_MS,
            ruling: 'D-103',
          }),
          requiresApproval: false,
          startedAt: now,
          completedAt: now,
          durationMs: 0,
          createdAt: now,
        },
      });
      return true;
    });
    if (!taken) return null;

    this.logger.warn(
      `[check][${req.businessId}] idempotency key ${req.idempotencyKey}: claim ${staleId} open ${ageMinutes} min past its taking (lease ${leaseMinutes} min) was taken over as claim ${claimId} (D-103)`,
    );
    return { status: 'new', claimId };
  }

  /** What a caller that does not hold the claim is told about the stored key. */
  private answerFor<T>(row: StoredIdempotencyKey, req: IdempotencyRequest): IdempotencyCheckResult<T> {
    if (this.isOtherRequest(row, req)) {
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
      // A claimId that names no open claim was settled, released, or (D-103)
      // taken over after its lease by a retry: this settle binds nothing.
      this.logger.warn(
        `[${op}][${req.businessId}] idempotency key ${req.idempotencyKey} has no open claim for this caller` +
          `${req.claimId ? ` (claim ${req.claimId} is settled, released, or was taken over after its lease)` : ''}; the stored row is unchanged`,
      );
      return false;
    }
  }
}
