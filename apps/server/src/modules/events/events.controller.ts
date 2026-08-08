import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { EventsService } from './events.service';
import { TicketTypeService } from './ticket-type.service';
import { AttendeeService } from './attendee.service';
import { CheckInService } from './check-in.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { CreateTicketTypeDto } from './dto/create-ticket-type.dto';
import { UpdateTicketTypeDto } from './dto/update-ticket-type.dto';
import { CreateAttendeeDto } from './dto/create-attendee.dto';
import { UpdateAttendeeDto } from './dto/update-attendee.dto';
import { CheckInDto } from './dto/check-in.dto';
import { EventListQueryDto } from './dto/event-list-query.dto';

@Controller()
@UseGuards(AuthGuard, BusinessGuard)
export class EventsController {
  constructor(
    @Inject(EventsService) private readonly eventsService: EventsService,
    @Inject(TicketTypeService) private readonly ticketTypeService: TicketTypeService,
    @Inject(AttendeeService) private readonly attendeeService: AttendeeService,
    @Inject(CheckInService) private readonly checkInService: CheckInService,
  ) {}

  // Events
  @Get('businesses/:businessId/events')
  listEvents(
    @Param('businessId') businessId: string,
    @Query() query: EventListQueryDto,
  ) {
    return this.eventsService.listEvents(businessId, query);
  }

  @Post('businesses/:businessId/events')
  createEvent(
    @Param('businessId') businessId: string,
    @Body() body: CreateEventDto,
  ) {
    return this.eventsService.createEvent(businessId, body);
  }

  @Get('businesses/:businessId/events/:eventId')
  getEvent(
    @Param('businessId') businessId: string,
    @Param('eventId') eventId: string,
  ) {
    return this.eventsService.getEvent(businessId, eventId);
  }

  @Patch('businesses/:businessId/events/:eventId')
  updateEvent(
    @Param('businessId') businessId: string,
    @Param('eventId') eventId: string,
    @Body() body: UpdateEventDto,
  ) {
    return this.eventsService.updateEvent(businessId, eventId, body);
  }

  @Delete('businesses/:businessId/events/:eventId')
  deleteEvent(
    @Param('businessId') businessId: string,
    @Param('eventId') eventId: string,
  ) {
    return this.eventsService.deleteEvent(businessId, eventId);
  }

  // Ticket types
  @Get('businesses/:businessId/events/:eventId/ticket-types')
  listTicketTypes(
    @Param('businessId') businessId: string,
    @Param('eventId') eventId: string,
  ) {
    return this.ticketTypeService.listTicketTypes(businessId, eventId);
  }

  @Post('businesses/:businessId/events/:eventId/ticket-types')
  createTicketType(
    @Param('businessId') businessId: string,
    @Param('eventId') eventId: string,
    @Body() body: CreateTicketTypeDto,
  ) {
    return this.ticketTypeService.createTicketType(businessId, eventId, body);
  }

  @Patch('businesses/:businessId/events/:eventId/ticket-types/:ticketTypeId')
  updateTicketType(
    @Param('businessId') businessId: string,
    @Param('eventId') eventId: string,
    @Param('ticketTypeId') ticketTypeId: string,
    @Body() body: UpdateTicketTypeDto,
  ) {
    return this.ticketTypeService.updateTicketType(businessId, eventId, ticketTypeId, body);
  }

  @Delete('businesses/:businessId/events/:eventId/ticket-types/:ticketTypeId')
  deleteTicketType(
    @Param('businessId') businessId: string,
    @Param('eventId') eventId: string,
    @Param('ticketTypeId') ticketTypeId: string,
  ) {
    return this.ticketTypeService.deleteTicketType(businessId, eventId, ticketTypeId);
  }

  // Attendees
  @Get('businesses/:businessId/events/:eventId/attendees')
  listAttendees(
    @Param('businessId') businessId: string,
    @Param('eventId') eventId: string,
  ) {
    return this.attendeeService.listAttendees(businessId, eventId);
  }

  @Post('businesses/:businessId/events/:eventId/attendees')
  createAttendee(
    @Param('businessId') businessId: string,
    @Param('eventId') eventId: string,
    @Body() body: CreateAttendeeDto,
  ) {
    return this.attendeeService.createAttendee(businessId, eventId, body);
  }

  @Patch('businesses/:businessId/events/:eventId/attendees/:attendeeId')
  updateAttendee(
    @Param('businessId') businessId: string,
    @Param('eventId') eventId: string,
    @Param('attendeeId') attendeeId: string,
    @Body() body: UpdateAttendeeDto,
  ) {
    return this.attendeeService.updateAttendee(businessId, eventId, attendeeId, body);
  }

  @Delete('businesses/:businessId/events/:eventId/attendees/:attendeeId')
  deleteAttendee(
    @Param('businessId') businessId: string,
    @Param('eventId') eventId: string,
    @Param('attendeeId') attendeeId: string,
  ) {
    return this.attendeeService.deleteAttendee(businessId, eventId, attendeeId);
  }

  // Check-ins
  @Post('businesses/:businessId/events/:eventId/attendees/:attendeeId/check-in')
  checkIn(
    @Param('businessId') businessId: string,
    @Param('eventId') eventId: string,
    @Param('attendeeId') attendeeId: string,
    @Body() body: CheckInDto,
  ) {
    return this.checkInService.checkIn(businessId, eventId, attendeeId, body);
  }

  @Delete('businesses/:businessId/events/:eventId/attendees/:attendeeId/check-in')
  undoCheckIn(
    @Param('businessId') businessId: string,
    @Param('eventId') eventId: string,
    @Param('attendeeId') attendeeId: string,
  ) {
    return this.checkInService.undoCheckIn(businessId, eventId, attendeeId);
  }
}
