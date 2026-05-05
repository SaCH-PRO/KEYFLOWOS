import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export type ReasonKind = 'WON' | 'LOST';

const DEFAULT_WON_REASONS: Array<{ label: string; slug: string }> = [
  { label: 'Best price/value', slug: 'best-price' },
  { label: 'Better fit / features', slug: 'better-fit' },
  { label: 'Strong relationship', slug: 'relationship' },
  { label: 'Referral / recommendation', slug: 'referral' },
  { label: 'Timing / urgency', slug: 'timing' },
];
const DEFAULT_LOST_REASONS: Array<{ label: string; slug: string }> = [
  { label: 'Price too high', slug: 'price' },
  { label: 'Lost to competitor', slug: 'competitor' },
  { label: 'No budget', slug: 'no-budget' },
  { label: 'No decision / went silent', slug: 'no-decision' },
  { label: 'Wrong fit', slug: 'wrong-fit' },
  { label: 'Bad timing', slug: 'bad-timing' },
];

@Injectable()
export class WonLostReasonService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async ensureDefaults(businessId: string) {
    const existing = await this.prisma.client.wonLostReason.count({ where: { businessId } });
    if (existing > 0) return;
    const data = [
      ...DEFAULT_WON_REASONS.map((r, i) => ({
        businessId, kind: 'WON' as const, label: r.label, slug: r.slug, position: i, isDefault: true,
      })),
      ...DEFAULT_LOST_REASONS.map((r, i) => ({
        businessId, kind: 'LOST' as const, label: r.label, slug: r.slug, position: i, isDefault: true,
      })),
    ];
    await this.prisma.client.wonLostReason.createMany({ data, skipDuplicates: true });
  }

  async list(input: { businessId: string; kind?: ReasonKind }) {
    await this.ensureDefaults(input.businessId);
    return this.prisma.client.wonLostReason.findMany({
      where: { businessId: input.businessId, archivedAt: null, ...(input.kind ? { kind: input.kind } : {}) },
      orderBy: [{ kind: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async create(input: { businessId: string; kind: ReasonKind; label: string; slug?: string; position?: number }) {
    const label = input.label?.trim();
    if (!label) throw new BadRequestException('label is required');
    if (!['WON', 'LOST'].includes(input.kind)) throw new BadRequestException('kind must be WON or LOST');
    const slug = (input.slug ?? label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const max = await this.prisma.client.wonLostReason.aggregate({
      where: { businessId: input.businessId, kind: input.kind },
      _max: { position: true },
    });
    return this.prisma.client.wonLostReason.create({
      data: {
        businessId: input.businessId,
        kind: input.kind,
        label,
        slug,
        position: input.position ?? ((max._max.position ?? -1) + 1),
      },
    });
  }

  async update(input: { businessId: string; reasonId: string; label?: string; position?: number; archived?: boolean }) {
    const reason = await this.prisma.client.wonLostReason.findFirst({
      where: { id: input.reasonId, businessId: input.businessId },
    });
    if (!reason) throw new NotFoundException('Reason not found');
    return this.prisma.client.wonLostReason.update({
      where: { id: reason.id },
      data: {
        label: input.label?.trim() || undefined,
        position: input.position ?? undefined,
        archivedAt: input.archived === true ? new Date() : input.archived === false ? null : undefined,
      },
    });
  }

  async remove(input: { businessId: string; reasonId: string }) {
    const reason = await this.prisma.client.wonLostReason.findFirst({
      where: { id: input.reasonId, businessId: input.businessId },
    });
    if (!reason) throw new NotFoundException('Reason not found');
    if (reason.isDefault) {
      return this.prisma.client.wonLostReason.update({
        where: { id: reason.id },
        data: { archivedAt: new Date() },
      });
    }
    return this.prisma.client.wonLostReason.delete({ where: { id: reason.id } });
  }

  async resolveForUse(input: { businessId: string; reasonId?: string | null; kind: ReasonKind }) {
    if (!input.reasonId) return null;
    const reason = await this.prisma.client.wonLostReason.findFirst({
      where: { id: input.reasonId, businessId: input.businessId, kind: input.kind },
    });
    if (!reason) throw new BadRequestException('Invalid reasonId for this business/kind');
    return reason;
  }
}
