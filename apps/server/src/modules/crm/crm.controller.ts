import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { CrmService } from './crm.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CreateContactDto } from './dto/create-contact.dto';
import { CreateNoteDto } from './dto/create-note.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateContactDto } from './dto/update-contact.dto';

@Controller('crm')
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/contacts')
  listContacts(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('hasUnpaidInvoices') hasUnpaidInvoices?: string,
    @Query('hasUpcomingBookings') hasUpcomingBookings?: string,
    @Query('staleDays') staleDays?: string,
    @Query('newThisWeek') newThisWeek?: string,
    @Query('tags') tags?: string | string[],
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('includeStats') includeStats?: string,
  ) {
    return this.crm.listContacts({
      businessId,
      status,
      search,
      hasUnpaidInvoices: hasUnpaidInvoices === 'true',
      hasUpcomingBookings: hasUpcomingBookings === 'true',
      staleDays: staleDays ? Number(staleDays) : undefined,
      newThisWeek: newThisWeek === 'true',
      tags: Array.isArray(tags) ? tags : tags ? [tags] : undefined,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
      includeStats: includeStats === 'true',
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/contacts')
  createContact(
    @Param('businessId') businessId: string,
    @Body() body: CreateContactDto,
  ) {
    return this.crm.createContact({ businessId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/contacts/:contactId')
  getContactDetail(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.crm.contactDetail({ businessId, contactId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/contacts/:contactId')
  updateContact(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: UpdateContactDto,
  ) {
    return this.crm.updateContact({
      businessId,
      contactId,
      ...body,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/contacts/:contactId/delete')
  softDeleteContact(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.crm.softDeleteContact({ businessId, contactId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/contacts/:contactId/merge/:duplicateId')
  mergeContact(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Param('duplicateId') duplicateId: string,
  ) {
    return this.crm.mergeContacts({ businessId, primaryId: contactId, duplicateId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/contacts/:contactId/notes')
  addNote(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: CreateNoteDto,
    @Req() req: any,
  ) {
    return this.crm.addNote({
      businessId,
      contactId,
      body: body.body,
      authorId: req?.user?.id,
      source: 'crm',
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/segments')
  segmentSummary(@Param('businessId') businessId: string) {
    return this.crm.segmentSummary({ businessId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/tasks/due')
  dueTasks(
    @Param('businessId') businessId: string,
    @Query('windowDays') windowDays?: string,
  ) {
    return this.crm.dueTasks({
      businessId,
      windowDays: windowDays ? Number(windowDays) : 7,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/contacts/:contactId/tasks')
  addTask(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: CreateTaskDto,
    @Req() req: any,
  ) {
    return this.crm.addTask({
      businessId,
      contactId,
      title: body.title,
      dueDate: body.dueDate,
      priority: body.priority,
      assigneeId: body.assigneeId,
      remindAt: body.remindAt,
      creatorId: req?.user?.id,
      source: 'crm',
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/tasks/:taskId/complete')
  completeTask(
    @Param('businessId') businessId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.crm.completeTask({ businessId, taskId });
  }
}
