import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class SignalsService {
  private readonly logger = new Logger(SignalsService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listSignals(businessId: string, opts?: { module?: string; status?: string; severity?: string; limit?: number; offset?: number }) {
    const where: Record<string, unknown> = { businessId };
    if (opts?.module) where.module = opts.module;
    if (opts?.status) where.status = opts.status;
    if (opts?.severity) where.severity = opts.severity;

    const [items, total] = await Promise.all([
      this.prisma.client.businessSignal.findMany({
        where,
        orderBy: [{ severity: 'desc' }, { lastSeenAt: 'desc' }],
        take: opts?.limit ?? 50,
        skip: opts?.offset ?? 0,
      }),
      this.prisma.client.businessSignal.count({ where }),
    ]);
    return { items, total };
  }

  async createSignal(businessId: string, input: {
    module: string;
    type: string;
    severity: string;
    title: string;
    description?: string;
    entityType?: string;
    entityId?: string;
    contactId?: string;
    score?: number;
    value?: number;
    currency?: string;
    data?: Record<string, unknown>;
  }) {
    return this.prisma.client.businessSignal.create({
      data: {
        businessId,
        module: input.module,
        type: input.type,
        severity: input.severity,
        title: input.title,
        description: input.description,
        entityType: input.entityType,
        entityId: input.entityId,
        contactId: input.contactId,
        score: input.score,
        value: input.value ?? null,
        currency: input.currency,
        data: (input.data ?? {}) as any,
      },
    });
  }

  async upsertSignal(businessId: string, dedupKey: { module: string; type: string; entityType?: string; entityId?: string }, input: {
    module: string;
    type: string;
    severity: string;
    title: string;
    description?: string;
    entityType?: string;
    entityId?: string;
    contactId?: string;
    score?: number;
    value?: number;
    currency?: string;
    data?: Record<string, unknown>;
  }) {
    const existing = await this.prisma.client.businessSignal.findFirst({
      where: {
        businessId,
        module: dedupKey.module,
        type: dedupKey.type,
        entityType: dedupKey.entityType ?? null,
        entityId: dedupKey.entityId ?? null,
        status: 'ACTIVE',
      },
      orderBy: { lastSeenAt: 'desc' },
    });

    if (existing) {
      return this.prisma.client.businessSignal.update({
        where: { id: existing.id },
        data: {
          severity: input.severity,
          title: input.title,
          description: input.description,
          score: input.score,
          value: input.value ?? null,
          currency: input.currency,
          data: (input.data ?? {}) as any,
          lastSeenAt: new Date(),
        },
      });
    }

    return this.createSignal(businessId, input);
  }

  async resolveSignal(businessId: string, id: string) {
    const signal = await this.prisma.client.businessSignal.findFirst({ where: { id, businessId } });
    if (!signal) throw new Error('Signal not found');
    return this.prisma.client.businessSignal.update({
      where: { id },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
  }

  async dismissSignal(businessId: string, id: string) {
    const signal = await this.prisma.client.businessSignal.findFirst({ where: { id, businessId } });
    if (!signal) throw new Error('Signal not found');
    return this.prisma.client.businessSignal.update({
      where: { id },
      data: { status: 'IGNORED', resolvedAt: new Date() },
    });
  }

  async deleteSignal(businessId: string, id: string) {
    const signal = await this.prisma.client.businessSignal.findFirst({ where: { id, businessId } });
    if (!signal) throw new Error('Signal not found');
    return this.prisma.client.businessSignal.delete({ where: { id } });
  }
}
