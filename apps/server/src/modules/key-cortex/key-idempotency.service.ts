import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface IdempotencyCheckResult<T = unknown> {
  status: 'new' | 'completed' | 'failed';
  response?: T;
  error?: string;
}

export interface IdempotencyRequest {
  businessId: string;
  idempotencyKey: string;
  requestHash?: string;
}

/**
 * Idempotency registry for KEY autonomous actions.
 *
 * Guarantees that retrying the same action with the same idempotency key
 * returns the original outcome without re-executing side effects.
 */
@Injectable()
export class KeyIdempotencyService {
  private readonly logger = new Logger(KeyIdempotencyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Check whether an idempotency key has already been processed.
   * Returns 'new' if the caller should proceed and later call complete/fail.
   */
  async check<T = unknown>(req: IdempotencyRequest): Promise<IdempotencyCheckResult<T>> {
    const existing = await this.prisma.client.idempotencyKey.findUnique({
      where: {
        businessId_idempotencyKey: {
          businessId: req.businessId,
          idempotencyKey: req.idempotencyKey,
        },
      },
    });

    if (!existing) {
      await this.prisma.client.idempotencyKey.create({
        data: {
          businessId: req.businessId,
          idempotencyKey: req.idempotencyKey,
          status: 'pending',
          requestHash: req.requestHash ?? null,
        },
      });
      return { status: 'new' };
    }

    if (existing.status === 'completed') {
      return {
        status: 'completed',
        response: existing.response ? (existing.response as T) : undefined,
      };
    }

    if (existing.status === 'failed') {
      return {
        status: 'failed',
        error: existing.error ?? undefined,
      };
    }

    // pending: treat as new so the caller can proceed (last-writer-wins).
    return { status: 'new' };
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
