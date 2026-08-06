// @keyflow:dormant — registered in key-cortex.module.ts and injected by nothing.
//
// Verified 2026-08-06: zero injection sites repo-wide. Nest constructs it on
// every boot and no code path ever calls it. Kept rather than deleted because
// it is honestly dormant — unlike KeyCommandRouterService, which was deleted
// the same day for being @Optional()-injected while registered nowhere, so its
// call site read as wired when it could never resolve.
//
// Either give it a driver or delete it; do not leave it looking live.
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { CognitionSession, Prisma } from '@prisma/client';

export interface CreateCognitionSessionInput {
  businessId: string;
  sessionId: string;
  userId?: string | null;
  contextSnapshot?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

export interface UpdateCognitionSessionInput {
  status?: string;
  contextSnapshot?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

@Injectable()
export class CognitionSessionService {
  constructor(private readonly prisma: PrismaService) {}

  async createSession(input: CreateCognitionSessionInput): Promise<CognitionSession> {
    return this.prisma.client.cognitionSession.create({
      data: {
        businessId: input.businessId,
        sessionId: input.sessionId,
        userId: input.userId ?? null,
        contextSnapshot: input.contextSnapshot ?? {},
        metadata: input.metadata ?? {},
      },
    });
  }

  async getSession(businessId: string, sessionId: string): Promise<CognitionSession | null> {
    return this.prisma.client.cognitionSession.findFirst({
      where: { businessId, sessionId },
    });
  }

  async updateSession(
    businessId: string,
    sessionId: string,
    updates: UpdateCognitionSessionInput,
  ): Promise<CognitionSession> {
    const existing = await this.getSession(businessId, sessionId);
    if (!existing) {
      throw new NotFoundException(`CognitionSession not found for business ${businessId} and session ${sessionId}`);
    }

    const data: Prisma.CognitionSessionUpdateInput = {};
    if (updates.status !== undefined) data.status = updates.status;
    if (updates.contextSnapshot !== undefined) data.contextSnapshot = updates.contextSnapshot as Prisma.InputJsonValue;
    if (updates.metadata !== undefined) data.metadata = updates.metadata as Prisma.InputJsonValue;

    return this.prisma.client.cognitionSession.update({
      where: { id: existing.id },
      data,
    });
  }

  async completeSession(businessId: string, sessionId: string): Promise<CognitionSession> {
    return this.updateSession(businessId, sessionId, { status: 'completed' });
  }
}
