import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { FlowService } from './flow.service';
import { ActivityService } from './activity.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { PrismaService } from '../../core/prisma/prisma.service';

@Controller('flow')
export class FlowController {
  constructor(
    @Inject(FlowService) private readonly flowService: FlowService,
    @Inject(ActivityService) private readonly activityService: ActivityService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get('health')
  health() {
    return { status: 'ok', module: 'flow' };
  }

  @Get('businesses/:businessId/cockpit')
  @UseGuards(AuthGuard, BusinessGuard)
  async getCockpitSummary(@Param('businessId') businessId: string) {
    return this.flowService.getCockpitSummary(businessId);
  }

  @Get('businesses/:businessId/activity')
  @UseGuards(AuthGuard, BusinessGuard)
  async getActivityFeed(
    @Param('businessId') businessId: string,
    @Query('module') module?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.activityService.listForBusiness(businessId, {
      module,
      limit: limit ? parseInt(limit, 10) : 30,
      cursor,
    });
  }

  @Get('businesses/:businessId/search')
  @UseGuards(AuthGuard, BusinessGuard)
  async universalSearch(
    @Param('businessId') businessId: string,
    @Query('q') query: string,
  ) {
    if (!query || query.trim().length < 2) {
      return { contacts: [], invoices: [], bookings: [], products: [], projects: [] };
    }

    const q = query.trim();
    const containsFilter = { contains: q, mode: 'insensitive' as const };

    const [contacts, invoices, bookings, products, projects] = await Promise.all([
      this.prisma.client.contact.findMany({
        where: {
          businessId,
          deletedAt: null,
          OR: [
            { firstName: containsFilter },
            { lastName: containsFilter },
            { displayName: containsFilter },
            { email: containsFilter },
            { phone: containsFilter },
            { company: containsFilter },
          ],
        },
        select: { id: true, firstName: true, lastName: true, displayName: true, email: true, status: true },
        take: 8,
      }),
      this.prisma.client.invoice.findMany({
        where: {
          businessId,
          deletedAt: null,
          OR: [
            { invoiceNumber: containsFilter },
            { contact: { OR: [{ firstName: containsFilter }, { lastName: containsFilter }, { email: containsFilter }] } },
          ],
        },
        select: { id: true, invoiceNumber: true, total: true, currency: true, status: true },
        take: 8,
      }),
      this.prisma.client.booking.findMany({
        where: {
          businessId,
          deletedAt: null,
          OR: [
            { contact: { OR: [{ firstName: containsFilter }, { lastName: containsFilter }] } },
            { service: { name: containsFilter } },
          ],
        },
        select: { id: true, startTime: true, status: true, service: { select: { name: true } }, contact: { select: { firstName: true, lastName: true } } },
        take: 8,
      }),
      this.prisma.client.product.findMany({
        where: {
          businessId,
          deletedAt: null,
          OR: [
            { name: containsFilter },
            { description: containsFilter },
          ],
        },
        select: { id: true, name: true, price: true, currency: true },
        take: 8,
      }),
      this.prisma.client.project.findMany({
        where: {
          businessId,
          deletedAt: null,
          OR: [
            { name: containsFilter },
            { description: containsFilter },
          ],
        },
        select: { id: true, name: true, status: true, priority: true },
        take: 8,
      }),
    ]);

    return { contacts, invoices, bookings, products, projects };
  }
}
