import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  Inject,
  ParseIntPipe,
  DefaultValuePipe,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { AdminGuard } from '../../core/auth/admin.guard';
import { GdprPurgeService } from './gdpr-purge.service';
import { PrismaService } from '../../core/prisma/prisma.service';

@Controller('api/admin/businesses')
@UseGuards(AuthGuard, AdminGuard)
export class AdminBusinessController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GdprPurgeService) private readonly gdprPurge: GdprPurgeService,
  ) {}

  @Get()
  async listBusinesses(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('search') search?: string,
  ) {
    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { owner: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.client.business.findMany({
        where,
        select: {
          id: true,
          name: true,
          slug: true,
          currency: true,
          timezone: true,
          ownerId: true,
          _count: { select: { members: true, contacts: true, invoices: true } },
        },
        orderBy: { name: 'asc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.client.business.count({ where }),
    ]);

    const ownerIds = [...new Set(items.map((b) => b.ownerId))];
    const owners = ownerIds.length > 0
      ? await this.prisma.client.user.findMany({
          where: { id: { in: ownerIds } },
          select: { id: true, email: true, name: true },
        })
      : [];
    const ownerMap = new Map(owners.map((o) => [o.id, o]));

    return {
      items: items.map((b) => ({
        id: b.id,
        name: b.name,
        slug: b.slug,
        currency: b.currency,
        timezone: b.timezone,
        owner: ownerMap.get(b.ownerId) ?? { id: b.ownerId, email: '—', name: null },
        memberCount: b._count.members,
        contactCount: b._count.contacts,
        invoiceCount: b._count.invoices,
      })),
      total,
    };
  }

  /**
   * GDPR Article 17 erasure. IRREVERSIBLE.
   *
   * This used to set `deletedAt` on seven models, null six columns on Business,
   * and return "Business data purged per GDPR request." Nothing was erased: a
   * soft delete is a flag, the rows stayed, and the tenant set covers 302
   * models — messages, call logs, documents, bank transactions, payments and
   * cortex memories were all untouched, with their personal data intact.
   *
   * A false sentence about a legal obligation is worse than no endpoint, since
   * someone answered a data-subject request with it.
   *
   * GdprPurgeService does the real thing and then ASKS THE DATABASE whether it
   * worked, throwing if any row survives. The response reports what was
   * removed instead of asserting that something was.
   */
  @Post(':businessId/gdpr-delete')
  async gdprDelete(@Param('businessId') businessId: string) {
    if (!businessId) throw new BadRequestException('Business ID is required');
    return this.gdprPurge.purgeBusiness(businessId);
  }
}
