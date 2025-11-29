import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CrmService } from './crm.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CreateContactDto } from './dto/create-contact.dto';
import { CreateNoteDto } from './dto/create-note.dto';
import { CreateTaskDto } from './dto/create-task.dto';

@Controller('crm')
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/contacts')
  listContacts(@Param('businessId') businessId: string) {
    return this.crm.listContacts(businessId);
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
  @Post('businesses/:businessId/contacts/:contactId/notes')
  addNote(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: CreateNoteDto,
  ) {
    return this.crm.addNote({ businessId, contactId, body: body.body });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/contacts/:contactId/tasks')
  addTask(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: CreateTaskDto,
  ) {
    return this.crm.addTask({
      businessId,
      contactId,
      title: body.title,
      dueDate: body.dueDate,
    });
  }
}
