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
import { PrismaService } from '../../core/prisma/prisma.service';

@Controller('api/admin/businesses')
@UseGuards(AuthGuard, AdminGuard)
export class AdminBusinessController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
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

  @Post(':businessId/gdpr-delete')
  async gdprDelete(@Param('businessId') businessId: string) {
    if (!businessId) throw new BadRequestException('Business ID is required');
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) throw new BadRequestException('Business not found');

    const now = new Date();
    await this.prisma.client.contact.updateMany({ where: { businessId }, data: { deletedAt: now } });
    await this.prisma.client.account.updateMany({ where: { businessId }, data: { deletedAt: now } });
    await this.prisma.client.invoice.updateMany({ where: { businessId }, data: { deletedAt: now } });
    await this.prisma.client.booking.updateMany({ where: { businessId }, data: { deletedAt: now } });

    await this.prisma.client.expense.updateMany({ where: { businessId }, data: { deletedAt: now } });
    await this.prisma.client.socialPost.updateMany({ where: { businessId }, data: { deletedAt: now } });
    await this.prisma.client.automationFlow.updateMany({ where: { businessId }, data: { deletedAt: now } });
    await this.prisma.client.business.update({ where: { id: businessId }, data: { name: '[DELETED]', slug: null, email: null, phone: null, website: null, address: null } });

    return { success: true, message: 'Business data purged per GDPR request.' };
  }
}
