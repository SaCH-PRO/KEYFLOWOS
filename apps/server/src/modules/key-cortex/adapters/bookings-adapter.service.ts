import { Injectable, NotImplementedException } from '@nestjs/common';
import { ConnectorCommand, ConnectorResult } from '../key-cortex-connector.types';
import { connectorOk, connectorFail } from '../key-cortex-connector.utils';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { BookingsService } from '../../bookings/bookings.service';
import { CatalogService } from '../../catalog/catalog.service';

const DAY_TO_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

/**
 * Typed adapter that exposes the bookings methods expected by
 * KeyCortexConnectorService.  Delegates to BookingsService where a real
 * implementation exists; otherwise returns a typed placeholder or
 * throws NotImplementedException.
 */
@Injectable()
export class BookingsAdapterService {
  constructor(
    private readonly bookings: BookingsService,
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
  ) {}

  async createBooking(input: {
    businessId: string;
    contactId: string;
    serviceId: string;
    startTime: string;
    endTime?: string;
    staffId?: string;
    notes?: string;
  }) {
    const service = await this.prisma.client.service.findFirst({
      where: { id: input.serviceId, businessId: input.businessId, deletedAt: null },
    });
    const start = new Date(input.startTime);
    const end = input.endTime
      ? new Date(input.endTime)
      : new Date(start.getTime() + (service?.duration ?? 60) * 60000);

    return this.bookings.createBooking({
      businessId: input.businessId,
      contactId: input.contactId,
      serviceId: input.serviceId,
      staffId: input.staffId ?? '',
      startTime: start,
      endTime: end,
      notes: input.notes,
    });
  }

  async cancelBooking(input: {
    businessId: string;
    bookingId: string;
    reason?: string;
    notifyClient?: boolean;
  }) {
    return this.bookings.updateBookingStatus(
      input.businessId,
      input.bookingId,
      'CANCELLED',
    );
  }

  async rescheduleBooking(input: {
    businessId: string;
    bookingId: string;
    newStartTime: string;
    newEndTime?: string;
    notifyClient?: boolean;
  }) {
    return this.bookings.rescheduleBooking(
      input.businessId,
      input.bookingId,
      new Date(input.newStartTime),
    );
  }

  async confirmBooking(input: {
    businessId: string;
    bookingId: string;
    sendConfirmation?: boolean;
  }) {
    return this.bookings.confirmBooking(input.bookingId);
  }

  async addService(input: {
    businessId: string;
    name: string;
    duration: number;
    price?: number;
    description?: string;
    buffer?: number;
  }) {
    return this.catalog.createService({
      businessId: input.businessId,
      name: input.name,
      duration: input.duration,
      price: input.price ?? 0,
      description: input.description,
      bufferMins: input.buffer ?? 0,
    });
  }

  async updateService(input: {
    businessId: string;
    serviceId: string;
    name?: string;
    duration?: number;
    price?: number;
    active?: boolean;
  }) {
    return this.catalog.updateService({
      businessId: input.businessId,
      serviceId: input.serviceId,
      name: input.name,
      duration: input.duration,
      price: input.price,
    });
  }

  async setAvailability(input: {
    businessId: string;
    staffId: string;
    dayOfWeek: string;
    startTime: string;
    endTime: string;
  }) {
    const dayIndex = DAY_TO_INDEX[input.dayOfWeek.toLowerCase()];
    if (dayIndex === undefined) {
      throw new Error(`Invalid dayOfWeek: ${input.dayOfWeek}`);
    }
    return this.prisma.client.availability.create({
      data: {
        staffId: input.staffId,
        dayOfWeek: dayIndex,
        startTime: input.startTime,
        endTime: input.endTime,
      },
    });
  }

  async blockTime(_input: {
    businessId: string;
    staffId: string;
    startTime: string;
    endTime: string;
    reason?: string;
  }) {
    throw new NotImplementedException('blockTime is not implemented');
  }

  async getUpcomingBookings(input: {
    businessId: string;
    from?: string;
    to?: string;
    contactId?: string;
    staffId?: string;
    limit?: number;
  }) {
    const from = input.from ? new Date(input.from) : new Date();
    const to = input.to ? new Date(input.to) : new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);

    return this.prisma.client.booking.findMany({
      where: {
        businessId: input.businessId,
        deletedAt: null,
        status: { not: 'CANCELLED' },
        startTime: { gte: from, lte: to },
        ...(input.contactId ? { contactId: input.contactId } : {}),
        ...(input.staffId ? { staffId: input.staffId } : {}),
      },
      orderBy: { startTime: 'asc' },
      take: input.limit ?? 50,
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        service: { select: { id: true, name: true, duration: true, price: true } },
        staff: { select: { id: true, name: true } },
      },
    });
  }

  async execute(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'create_booking': {
        const booking = await this.createBooking({
          businessId: command.businessId,
          contactId: command.parameters.contactId as string,
          serviceId: command.parameters.serviceId as string,
          startTime: command.parameters.startTime as string,
          endTime: command.parameters.endTime as string,
          staffId: command.parameters.staffId as string,
          notes: command.parameters.notes as string,
        });
        return connectorOk(command, start, booking);
      }
      case 'cancel_booking': {
        const cancelled = await this.cancelBooking({
          businessId: command.businessId,
          bookingId: command.parameters.bookingId as string,
          reason: command.parameters.reason as string,
          notifyClient: (command.parameters.notifyClient as boolean) ?? true,
        });
        return connectorOk(command, start, cancelled);
      }
      case 'reschedule_booking': {
        const rescheduled = await this.rescheduleBooking({
          businessId: command.businessId,
          bookingId: command.parameters.bookingId as string,
          newStartTime: command.parameters.newStartTime as string,
          newEndTime: command.parameters.newEndTime as string,
          notifyClient: (command.parameters.notifyClient as boolean) ?? true,
        });
        return connectorOk(command, start, rescheduled);
      }
      case 'confirm_booking': {
        const confirmed = await this.confirmBooking({
          businessId: command.businessId,
          bookingId: command.parameters.bookingId as string,
          sendConfirmation: (command.parameters.sendConfirmation as boolean) ?? true,
        });
        return connectorOk(command, start, confirmed);
      }
      case 'add_service': {
        const service = await this.addService({
          businessId: command.businessId,
          name: command.parameters.name as string,
          duration: command.parameters.duration as number,
          price: command.parameters.price as number,
          description: command.parameters.description as string,
          buffer: (command.parameters.buffer as number) || 0,
        });
        return connectorOk(command, start, service);
      }
      case 'update_service': {
        const updated = await this.updateService({
          businessId: command.businessId,
          serviceId: command.parameters.serviceId as string,
          name: command.parameters.name as string,
          duration: command.parameters.duration as number,
          price: command.parameters.price as number,
          active: command.parameters.active as boolean,
        });
        return connectorOk(command, start, updated);
      }
      case 'set_availability': {
        const avail = await this.setAvailability({
          businessId: command.businessId,
          staffId: command.parameters.staffId as string,
          dayOfWeek: command.parameters.dayOfWeek as string,
          startTime: command.parameters.startTime as string,
          endTime: command.parameters.endTime as string,
        });
        return connectorOk(command, start, avail);
      }
      case 'block_time': {
        const blocked = await this.blockTime({
          businessId: command.businessId,
          staffId: command.parameters.staffId as string,
          startTime: command.parameters.startTime as string,
          endTime: command.parameters.endTime as string,
          reason: command.parameters.reason as string,
        });
        return connectorOk(command, start, blocked);
      }
      default:
        return connectorFail(command, start, `Unknown bookings action: ${command.action}`);
    }
  }
}
