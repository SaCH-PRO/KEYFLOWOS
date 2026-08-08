import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CreateTicketTypeDto } from './dto/create-ticket-type.dto';
import { UpdateTicketTypeDto } from './dto/update-ticket-type.dto';

@Injectable()
export class TicketTypeService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async assertEventOwnership(businessId: string, eventId: string) {
    const event = await this.prisma.client.event.findFirst({
      where: { id: eventId, businessId },
      select: { id: true },
    });
    if (!event) {
      throw new NotFoundException('Event not found');
    }
  }

  async listTicketTypes(businessId: string, eventId: string) {
    await this.assertEventOwnership(businessId, eventId);
    return this.prisma.client.eventTicketType.findMany({
      where: { eventId },
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { attendees: true } },
      },
    });
  }

  async createTicketType(businessId: string, eventId: string, dto: CreateTicketTypeDto) {
    await this.assertEventOwnership(businessId, eventId);
    this.validateSaleWindow(dto.salesStartAt, dto.salesEndAt);

    return this.prisma.client.eventTicketType.create({
      data: {
        eventId,
        name: dto.name,
        description: dto.description ?? null,
        price: dto.price,
        currency: dto.currency ?? 'USD',
        quantity: dto.quantity ?? null,
        salesStartAt: dto.salesStartAt ?? null,
        salesEndAt: dto.salesEndAt ?? null,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateTicketType(
    businessId: string,
    eventId: string,
    ticketTypeId: string,
    dto: UpdateTicketTypeDto,
  ) {
    await this.assertEventOwnership(businessId, eventId);

    const existing = await this.prisma.client.eventTicketType.findFirst({
      where: { id: ticketTypeId, eventId },
    });
    if (!existing) {
      throw new NotFoundException('Ticket type not found');
    }

    const salesStartAt = dto.salesStartAt !== undefined ? dto.salesStartAt : existing.salesStartAt;
    const salesEndAt = dto.salesEndAt !== undefined ? dto.salesEndAt : existing.salesEndAt;
    this.validateSaleWindow(salesStartAt, salesEndAt);

    if (dto.quantity !== undefined && dto.quantity < existing.quantitySold) {
      throw new BadRequestException(
        `Quantity cannot be less than already sold tickets (${existing.quantitySold})`,
      );
    }

    return this.prisma.client.eventTicketType.update({
      where: { id: ticketTypeId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.price !== undefined && { price: dto.price }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        ...(dto.quantity !== undefined && { quantity: dto.quantity }),
        ...(dto.salesStartAt !== undefined && { salesStartAt: dto.salesStartAt }),
        ...(dto.salesEndAt !== undefined && { salesEndAt: dto.salesEndAt }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async deleteTicketType(businessId: string, eventId: string, ticketTypeId: string) {
    await this.assertEventOwnership(businessId, eventId);

    const existing = await this.prisma.client.eventTicketType.findFirst({
      where: { id: ticketTypeId, eventId },
      include: { _count: { select: { attendees: true } } },
    });
    if (!existing) {
      throw new NotFoundException('Ticket type not found');
    }
    if (existing._count.attendees > 0) {
      throw new BadRequestException('Cannot delete ticket type with registered attendees');
    }

    await this.prisma.client.eventTicketType.delete({ where: { id: ticketTypeId } });
    return { deleted: true };
  }

  private validateSaleWindow(salesStartAt: Date | null | undefined, salesEndAt: Date | null | undefined) {
    if (salesStartAt && salesEndAt && salesEndAt <= salesStartAt) {
      throw new BadRequestException('salesEndAt must be after salesStartAt');
    }
  }
}
