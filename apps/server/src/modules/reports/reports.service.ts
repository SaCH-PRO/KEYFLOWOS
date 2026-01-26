import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(businessId: string) {
    const now = new Date();
    const [contacts, bookings, invoices, paidInvoices, overdueInvoices, overdueTasks, upcomingBookings] =
      await Promise.all([
        this.prisma.client.contact.count({ where: { businessId } }),
        this.prisma.client.booking.count({ where: { businessId } }),
        this.prisma.client.invoice.count({ where: { businessId } }),
        this.prisma.client.invoice.aggregate({
          where: { businessId, status: 'PAID' },
          _sum: { total: true },
        }),
        this.prisma.client.invoice.aggregate({
          where: { businessId, status: { in: ['SENT', 'OVERDUE'] } },
          _sum: { total: true },
        }),
        this.prisma.client.contactTask.count({
          where: { businessId, status: { not: 'DONE' }, dueDate: { lt: now } },
        }),
        this.prisma.client.booking.count({
          where: { businessId, status: { in: ['PENDING', 'CONFIRMED'] }, startTime: { gt: now } },
        }),
      ]);

    return {
      totalContacts: contacts,
      totalBookings: bookings,
      totalInvoices: invoices,
      totalRevenue: Number(paidInvoices._sum.total ?? 0),
      outstandingBalance: Number(overdueInvoices._sum.total ?? 0),
      overdueTasks,
      upcomingBookings,
    };
  }
}
