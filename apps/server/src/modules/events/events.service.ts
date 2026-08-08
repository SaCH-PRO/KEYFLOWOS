import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { EventListQueryDto } from './dto/event-list-query.dto';

@Injectable()
export class EventsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listEvents(businessId: string, query: EventListQueryDto) {
    const { status, search, skip = 0, take = 100 } = query;
    const where = {
      businessId,
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { description: { contains: search, mode: 'insensitive' as const } },
              { location: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.client.event.findMany({
        where,
        orderBy: { startsAt: 'desc' },
        skip,
        take,
        include: {
          _count: { select: { ticketTypes: true, attendees: true, checkIns: true } },
        },
      }),
      this.prisma.client.event.count({ where }),
    ]);

    return { items, total, skip, take };
  }

  async getEvent(businessId: string, eventId: string) {
    const event = await this.prisma.client.event.findFirst({
      where: { id: eventId, businessId },
      include: {
        ticketTypes: { orderBy: { createdAt: 'asc' } },
        _count: { select: { attendees: true, checkIns: true } },
      },
    });
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  async createEvent(businessId: string, dto: CreateEventDto) {
    this.validateEventDates(dto.startsAt, dto.endsAt);

    return this.prisma.client.event.create({
      data: {
        businessId,
        name: dto.name,
        description: dto.description ?? null,
        startsAt: dto.startsAt,
        endsAt: dto.endsAt ?? null,
        timezone: dto.timezone ?? 'UTC',
        location: dto.location ?? null,
        isPublished: dto.isPublished ?? false,
        coverImageUrl: dto.coverImageUrl ?? null,
        status: dto.status ?? 'DRAFT',
      },
      include: {
        ticketTypes: true,
      },
    });
  }

  async updateEvent(businessId: string, eventId: string, dto: UpdateEventDto) {
    const existing = await this.prisma.client.event.findFirst({
      where: { id: eventId, businessId },
    });
    if (!existing) {
      throw new NotFoundException('Event not found');
    }

    const startsAt = dto.startsAt ?? existing.startsAt;
    const endsAt = dto.endsAt !== undefined ? dto.endsAt : existing.endsAt;
    this.validateEventDates(startsAt, endsAt);

    return this.prisma.client.event.update({
      where: { id: eventId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.startsAt !== undefined && { startsAt: dto.startsAt }),
        ...(dto.endsAt !== undefined && { endsAt: dto.endsAt }),
        ...(dto.timezone !== undefined && { timezone: dto.timezone }),
        ...(dto.location !== undefined && { location: dto.location }),
        ...(dto.isPublished !== undefined && { isPublished: dto.isPublished }),
        ...(dto.coverImageUrl !== undefined && { coverImageUrl: dto.coverImageUrl }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
      include: {
        ticketTypes: true,
      },
    });
  }

  async deleteEvent(businessId: string, eventId: string) {
    const existing = await this.prisma.client.event.findFirst({
      where: { id: eventId, businessId },
    });
    if (!existing) {
      throw new NotFoundException('Event not found');
    }

    await this.prisma.client.event.delete({ where: { id: eventId } });
    return { deleted: true };
  }

  private validateEventDates(startsAt: Date, endsAt: Date | null | undefined) {
    if (endsAt && endsAt <= startsAt) {
      throw new BadRequestException('endsAt must be after startsAt');
    }
  }
}
