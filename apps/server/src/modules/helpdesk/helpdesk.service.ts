import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface CreateTicketBody {
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  source?: string;
  contactId?: string;
  assignedToId?: string;
  orgUnitId?: string;
}

/** Anything that can insert a ticket: the Prisma client or a transaction on it. */
export interface TicketWriteClient {
  supportTicket: { create(args: any): Promise<any> };
}

@Injectable()
export class HelpdeskService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

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

  async createTicket(businessId: string, body: Omit<CreateTicketBody, 'source'>) {
    // `source` is stripped, not forwarded. The manual route's body is typed
    // inline, so nothing removes an extra key from it, and this method has
    // never written a caller's source. It still does not.
    const ticket = await this.createTicketRow(this.prisma.client, businessId, { ...body, source: undefined });
    this.emitTicketCreated(businessId, ticket, body);
    return ticket;
  }

  /**
   * The row write of createTicket, on a caller-supplied client.
   *
   * KF-EXEC-ACTION-001: the KEY action boundary writes the ticket inside the
   * transaction that admits its execution claim, so the insert has to be able
   * to run on that transaction. It does not emit: an event for a row that may
   * still roll back is an event for a ticket that never existed. The caller
   * emits after its commit, with emitTicketCreated.
   */
  createTicketRow(client: TicketWriteClient, businessId: string, body: CreateTicketBody) {
    return client.supportTicket.create({
      data: {
        businessId,
        title: body.title,
        description: body.description,
        status: body.status || 'OPEN',
        priority: body.priority || 'NORMAL',
        // Omitted, not defaulted, when the caller gives none: the column
        // default (MANUAL) is what the manual route has always produced.
        ...(body.source ? { source: body.source } : {}),
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
  }

  emitTicketCreated(businessId: string, ticket: unknown, body: Pick<CreateTicketBody, 'contactId' | 'priority'>) {
    this.events.emit('supportTicket.created', {
      ticket,
      businessId,
      contactId: body.contactId,
      priority: body.priority || 'NORMAL',
    });
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

  async replyToTicket(
    businessId: string,
    ticketId: string,
    body: string,
    opts?: { channel?: string; authorId?: string | null },
  ) {
    const ticket = await this.prisma.client.supportTicket.findFirst({
      where: { id: ticketId, businessId, deletedAt: null },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const message = await this.prisma.client.supportTicketMessage.create({
      data: {
        businessId,
        ticketId,
        body,
        direction: 'OUTBOUND',
        channel: opts?.channel ?? 'internal',
        authorId: opts?.authorId ?? null,
      },
    });

    // A reply reopens an open/resolved conversation unless explicitly closed.
    if (ticket.status === 'resolved' || ticket.status === 'closed') {
      await this.prisma.client.supportTicket.update({
        where: { id: ticketId },
        data: { status: 'open' },
      });
    }

    return message;
  }

  async listTicketMessages(businessId: string, ticketId: string) {
    const ticket = await this.prisma.client.supportTicket.findFirst({
      where: { id: ticketId, businessId, deletedAt: null },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return this.prisma.client.supportTicketMessage.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
