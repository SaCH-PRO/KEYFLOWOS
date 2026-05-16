import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { HelpdeskService } from './helpdesk.service';

@Controller('helpdesk')
@UseGuards(AuthGuard, BusinessGuard)
export class HelpdeskController {
  constructor(@Inject(HelpdeskService) private readonly helpdesk: HelpdeskService) {}

  @Get('businesses/:businessId/tickets')
  listTickets(
    @Param('businessId') businessId: string,
    @Query('orgUnitId') orgUnitId?: string,
  ) {
    return this.helpdesk.listTickets(businessId, orgUnitId);
  }

  @Get('businesses/:businessId/tickets/:ticketId')
  getTicket(
    @Param('businessId') businessId: string,
    @Param('ticketId') ticketId: string,
  ) {
    return this.helpdesk.getTicket(businessId, ticketId);
  }

  @Post('businesses/:businessId/tickets')
  createTicket(
    @Param('businessId') businessId: string,
    @Body() body: {
      title: string;
      description?: string;
      status?: string;
      priority?: string;
      contactId?: string;
      assignedToId?: string;
      orgUnitId?: string;
    },
  ) {
    return this.helpdesk.createTicket(businessId, body);
  }

  @Patch('businesses/:businessId/tickets/:ticketId')
  updateTicket(
    @Param('businessId') businessId: string,
    @Param('ticketId') ticketId: string,
    @Body() body: {
      title?: string;
      description?: string;
      status?: string;
      priority?: string;
      contactId?: string | null;
      assignedToId?: string | null;
      orgUnitId?: string | null;
    },
  ) {
    return this.helpdesk.updateTicket(businessId, ticketId, body);
  }

  @Delete('businesses/:businessId/tickets/:ticketId')
  deleteTicket(
    @Param('businessId') businessId: string,
    @Param('ticketId') ticketId: string,
  ) {
    return this.helpdesk.deleteTicket(businessId, ticketId);
  }
}
