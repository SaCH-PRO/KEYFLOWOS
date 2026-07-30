/**
 * PortalContentService — Customer-scoped data for the client portal.
 *
 * Provides read-only views of a contact's orders, bookings, invoices,
 * and referrals. Used by the KEY portal adapter and the public portal UI.
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface PortalDashboard {
  contact: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  };
  orders: Array<Record<string, unknown>>;
  bookings: Array<Record<string, unknown>>;
  invoices: Array<Record<string, unknown>>;
  openInvoicesTotal: number;
  upcomingBookingsCount: number;
}

@Injectable()
export class PortalContentService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(contactId: string, businessId: string): Promise<PortalDashboard> {
    const contact = await this.prisma.client.contact.findUnique({
      where: { id: contactId, businessId },
      select: { id: true, firstName: true, lastName: true, email: true, phone: true },
    });
    if (!contact) {
      throw new Error('Contact not found');
    }

    const [orders, bookings, invoices] = await Promise.all([
      this.listOrders(contactId, businessId),
      this.listBookings(contactId, businessId),
      this.listInvoices(contactId, businessId),
    ]);

    const openInvoicesTotal = (invoices as any[])
      .filter((inv) => inv.status !== 'PAID' && inv.status !== 'DRAFT')
      .reduce((sum, inv) => sum + Number(inv.total ?? 0), 0);

    const upcomingBookingsCount = (bookings as any[]).filter((b) =>
      b.startTime ? new Date(b.startTime) > new Date() : false,
    ).length;

    return {
      contact,
      orders,
      bookings,
      invoices,
      openInvoicesTotal,
      upcomingBookingsCount,
    };
  }

  async listOrders(contactId: string, businessId: string): Promise<Array<Record<string, unknown>>> {
    const contact = await this.prisma.client.contact.findUnique({
      where: { id: contactId, businessId },
      select: { email: true },
    });
    if (!contact?.email) {
      return [];
    }
    const orders = await this.prisma.client.marketplaceOrder.findMany({
      where: { businessId, customerEmail: contact.email },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { items: { select: { productId: true, quantity: true, unitPrice: true } } },
    });
    return orders as unknown as Array<Record<string, unknown>>;
  }

  async listBookings(contactId: string, businessId: string): Promise<Array<Record<string, unknown>>> {
    const bookings = await this.prisma.client.booking.findMany({
      where: { businessId, contactId, deletedAt: null },
      orderBy: { startTime: 'desc' },
      take: 50,
      include: { service: { select: { name: true } }, staff: { select: { name: true } } },
    });
    return bookings as unknown as Array<Record<string, unknown>>;
  }

  async listInvoices(contactId: string, businessId: string): Promise<Array<Record<string, unknown>>> {
    const invoices = await this.prisma.client.invoice.findMany({
      where: { businessId, contactId, deletedAt: null },
      orderBy: { issueDate: 'desc' },
      take: 50,
      select: { id: true, invoiceNumber: true, total: true, status: true, dueDate: true, currency: true },
    });
    return invoices as unknown as Array<Record<string, unknown>>;
  }
}
