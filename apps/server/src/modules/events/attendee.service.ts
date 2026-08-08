import { Injectable, Inject, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CreateAttendeeDto } from './dto/create-attendee.dto';
import { UpdateAttendeeDto } from './dto/update-attendee.dto';
import { CommerceService } from '../commerce/commerce.service';
import { CrmService } from '../crm/crm.service';

type PrismaTx = Parameters<Parameters<PrismaService['client']['$transaction']>[0]>[0];

@Injectable()
export class AttendeeService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CommerceService) private readonly commerce: CommerceService,
    @Inject(CrmService) private readonly crm: CrmService,
  ) {}

  private async assertEventOwnership(businessId: string, eventId: string) {
    const event = await this.prisma.client.event.findFirst({
      where: { id: eventId, businessId },
      select: { id: true, status: true, name: true },
    });
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  private splitName(fullName?: string | null): { firstName?: string; lastName?: string } {
    if (!fullName?.trim()) return {};
    const parts = fullName.trim().split(/\s+/);
    const firstName = parts[0];
    const lastName = parts.slice(1).join(' ');
    return { firstName, lastName: lastName || undefined };
  }

  async listAttendees(businessId: string, eventId: string) {
    await this.assertEventOwnership(businessId, eventId);
    return this.prisma.client.eventAttendee.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
      include: { ticketType: true },
    });
  }

  async createAttendee(businessId: string, eventId: string, dto: CreateAttendeeDto) {
    const event = await this.assertEventOwnership(businessId, eventId);
    if (event.status === 'CANCELLED') {
      throw new BadRequestException('Cannot register attendees for a cancelled event');
    }

    const ticketType = dto.ticketTypeId
      ? await this.validateTicketType(eventId, dto.ticketTypeId)
      : null;

    const attendee = await this.prisma.client.$transaction(async (tx) => {
      if (ticketType) {
        await this.claimTicketSlot(tx, ticketType.id);
      }

      return tx.eventAttendee.create({
        data: {
          eventId,
          businessId,
          ticketTypeId: ticketType?.id ?? null,
          email: dto.email,
          name: dto.name ?? null,
          phone: dto.phone ?? null,
          status: dto.status ?? 'REGISTERED',
          paymentId: null,
          checkedInAt: dto.checkedInAt ?? null,
        },
        include: { ticketType: true },
      });
    });

    // Paid tickets mint a SENT invoice and store its id on the attendee so the
    // unified payment gateway can collect later.
    const ticketPrice = ticketType ? Number(ticketType.price) : 0;
    if (ticketType && ticketPrice > 0) {
      try {
        const { firstName, lastName } = this.splitName(dto.name);
        const contact = await this.crm.findOrCreateContact(businessId, {
          email: dto.email,
          displayName: dto.name ?? null,
          firstName: firstName ?? null,
          lastName: lastName ?? null,
          phone: dto.phone ?? null,
          source: 'event',
          sourceDetail: eventId,
        });

        const invoice = await this.commerce.createInvoice({
          businessId,
          contactId: contact.id,
          currency: ticketType.currency,
          items: [
            {
              description: `${event.name} — ${ticketType.name}`,
              quantity: 1,
              unitPrice: ticketPrice,
            },
          ],
          notes: `Event ticket for "${event.name}"`,
        });

        await this.commerce.updateInvoiceStatus({ invoiceId: invoice.id, status: 'SENT' });

        const updated = await this.prisma.client.eventAttendee.update({
          where: { id: attendee.id },
          data: { paymentId: invoice.id },
          include: { ticketType: true },
        });
        return updated;
      } catch (err: any) {
        // Roll back the slot claim + attendee record so the business doesn't
        // end up with a registered attendee and no way to collect payment.
        await this.deleteAttendee(businessId, eventId, attendee.id).catch(() => undefined);
        throw err;
      }
    }

    return attendee;
  }

  async updateAttendee(
    businessId: string,
    eventId: string,
    attendeeId: string,
    dto: UpdateAttendeeDto,
  ) {
    await this.assertEventOwnership(businessId, eventId);

    const existing = await this.prisma.client.eventAttendee.findFirst({
      where: { id: attendeeId, eventId },
      include: { ticketType: true },
    });
    if (!existing) {
      throw new NotFoundException('Attendee not found');
    }

    const newTicketTypeId = dto.ticketTypeId !== undefined ? dto.ticketTypeId : existing.ticketTypeId;
    if (newTicketTypeId && newTicketTypeId !== existing.ticketTypeId) {
      await this.validateTicketType(eventId, newTicketTypeId);
    }

    return this.prisma.client.eventAttendee.update({
      where: { id: attendeeId },
      data: {
        ...(dto.ticketTypeId !== undefined && { ticketTypeId: dto.ticketTypeId }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.paymentId !== undefined && { paymentId: dto.paymentId }),
        ...(dto.checkedInAt !== undefined && { checkedInAt: dto.checkedInAt }),
      },
      include: { ticketType: true },
    });
  }

  async deleteAttendee(businessId: string, eventId: string, attendeeId: string) {
    const event = await this.assertEventOwnership(businessId, eventId);

    const existing = await this.prisma.client.eventAttendee.findFirst({
      where: { id: attendeeId, eventId },
      include: { checkIns: true, ticketType: true },
    });
    if (!existing) {
      throw new NotFoundException('Attendee not found');
    }

    await this.prisma.client.$transaction(async (tx) => {
      if (existing.checkIns.length > 0) {
        await tx.eventCheckIn.deleteMany({ where: { attendeeId } });
      }
      await tx.eventAttendee.delete({ where: { id: attendeeId } });
      if (existing.ticketTypeId) {
        await tx.eventTicketType.update({
          where: { id: existing.ticketTypeId },
          data: { quantitySold: { decrement: 1 } },
        });
      }
    });

    return { deleted: true };
  }

  private async validateTicketType(eventId: string, ticketTypeId: string) {
    const ticketType = await this.prisma.client.eventTicketType.findFirst({
      where: { id: ticketTypeId, eventId, isActive: true },
    });
    if (!ticketType) {
      throw new NotFoundException('Ticket type not found');
    }

    const now = new Date();
    if (ticketType.salesStartAt && now < ticketType.salesStartAt) {
      throw new BadRequestException('Ticket sales have not started yet');
    }
    if (ticketType.salesEndAt && now > ticketType.salesEndAt) {
      throw new BadRequestException('Ticket sales have ended');
    }
    if (ticketType.quantity !== null && ticketType.quantitySold >= ticketType.quantity) {
      throw new ConflictException('Ticket type is sold out');
    }

    return ticketType;
  }

  private async claimTicketSlot(tx: PrismaTx, ticketTypeId: string) {
    const ticketType = await tx.eventTicketType.findUnique({
      where: { id: ticketTypeId },
    });
    if (!ticketType) {
      throw new NotFoundException('Ticket type not found');
    }
    if (ticketType.quantity !== null && ticketType.quantitySold >= ticketType.quantity) {
      throw new ConflictException('Ticket type is sold out');
    }
    await tx.eventTicketType.update({
      where: { id: ticketTypeId },
      data: { quantitySold: { increment: 1 } },
    });
  }
}
