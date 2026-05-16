import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class HelpdeskService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  listTickets(businessId: string, orgUnitId?: string) {
    return this.prisma.client.supportTicket.findMany({
      where: { businessId, deletedAt: null, ...(orgUnitId ? { orgUnitId } : {}) },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, email: true, displayName: true } },
        assignee: { select: { id: true, name: true, email: true } },
        orgUnit: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  getTicket(businessId: string, ticketId: string) {
    return this.prisma.client.supportTicket.findFirst({
      where: { id: ticketId, businessId, deletedAt: null },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, email: true, displayName: true } },
        assignee: { select: { id: true, name: true, email: true } },
        orgUnit: { select: { id: true, name: true } },
      },
    });
  }

  async createTicket(businessId: string, body: {
    title: string;
    description?: string;
    status?: string;
    priority?: string;
    contactId?: string;
    assignedToId?: string;
    orgUnitId?: string;
  }) {
    const ticket = await this.prisma.client.supportTicket.create({
      data: {
        businessId,
        title: body.title,
        description: body.description,
        status: body.status || 'OPEN',
        priority: body.priority || 'NORMAL',
        contactId: body.contactId,
        assignedToId: body.assignedToId,
        orgUnitId: body.orgUnitId,
      },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, email: true, displayName: true } },
        assignee: { select: { id: true, name: true, email: true } },
        orgUnit: { select: { id: true, name: true } },
      },
    });
    return ticket;
  }

  async updateTicket(businessId: string, ticketId: string, body: {
    title?: string;
    description?: string;
    status?: string;
    priority?: string;
    contactId?: string | null;
    assignedToId?: string | null;
    orgUnitId?: string | null;
  }) {
    const existing = await this.prisma.client.supportTicket.findFirst({
      where: { id: ticketId, businessId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Ticket not found');

    const ticket = await this.prisma.client.supportTicket.update({
      where: { id: ticketId },
      data: {
        title: body.title,
        description: body.description,
        status: body.status,
        priority: body.priority,
        contactId: body.contactId,
        assignedToId: body.assignedToId,
        orgUnitId: body.orgUnitId,
      },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, email: true, displayName: true } },
        assignee: { select: { id: true, name: true, email: true } },
        orgUnit: { select: { id: true, name: true } },
      },
    });
    return ticket;
  }

  async deleteTicket(businessId: string, ticketId: string) {
    const existing = await this.prisma.client.supportTicket.findFirst({
      where: { id: ticketId, businessId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Ticket not found');

    await this.prisma.client.supportTicket.update({
      where: { id: ticketId },
      data: { deletedAt: new Date() },
    });
    return { success: true };
  }
}
