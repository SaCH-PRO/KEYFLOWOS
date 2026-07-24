import { Injectable, Inject, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CheckInDto } from './dto/check-in.dto';

@Injectable()
export class CheckInService {
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

  async checkIn(businessId: string, eventId: string, attendeeId: string, dto: CheckInDto) {
    await this.assertEventOwnership(businessId, eventId);

    const attendee = await this.prisma.client.eventAttendee.findFirst({
      where: { id: attendeeId, eventId },
      include: { checkIns: true },
    });
    if (!attendee) {
      throw new NotFoundException('Attendee not found');
    }
    if (attendee.status === 'CANCELLED') {
      throw new BadRequestException('Cannot check in a cancelled attendee');
    }
    if (attendee.checkIns.length > 0) {
      throw new ConflictException('Attendee is already checked in');
    }

    const [checkIn] = await this.prisma.client.$transaction([
      this.prisma.client.eventCheckIn.create({
        data: {
          eventId,
          attendeeId,
          checkedInBy: dto.checkedInBy ?? null,
          notes: dto.notes ?? null,
        },
      }),
      this.prisma.client.eventAttendee.update({
        where: { id: attendeeId },
        data: { status: 'CHECKED_IN', checkedInAt: new Date() },
      }),
    ]);

    return checkIn;
  }

  async undoCheckIn(businessId: string, eventId: string, attendeeId: string) {
    await this.assertEventOwnership(businessId, eventId);

    const attendee = await this.prisma.client.eventAttendee.findFirst({
      where: { id: attendeeId, eventId },
      include: { checkIns: true },
    });
    if (!attendee) {
      throw new NotFoundException('Attendee not found');
    }
    if (attendee.checkIns.length === 0) {
      throw new BadRequestException('Attendee is not checked in');
    }

    await this.prisma.client.$transaction([
      this.prisma.client.eventCheckIn.deleteMany({ where: { eventId, attendeeId } }),
      this.prisma.client.eventAttendee.update({
        where: { id: attendeeId },
        data: { status: 'REGISTERED', checkedInAt: null },
      }),
    ]);

    return { undone: true };
  }
}
