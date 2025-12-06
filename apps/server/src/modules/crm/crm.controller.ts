import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CrmImportService } from './crm-import.service';
import { CrmPlaybookService } from './crm-playbook.service';
import { CrmService } from './crm.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CreateContactDto } from './dto/create-contact.dto';
import { CreateNoteDto } from './dto/create-note.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { memoryStorage } from 'multer';
import type { Express } from 'express';

@Controller('crm')
export class CrmController {
  constructor(
    private readonly crm: CrmService,
    private readonly crmImport: CrmImportService,
    private readonly playbook: CrmPlaybookService,
  ) {}

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
  @Get('businesses/:businessId/highlights')
  flowHighlights(@Param('businessId') businessId: string) {
    return this.crm.flowHighlights({ businessId });
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

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/import/file')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async importContactsFromFile(
    @Param('businessId') businessId: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('type') type?: string,
  ) {
    if (!file || !file.buffer) {
      throw new BadRequestException('File is required');
    }
    const allowed: Array<'csv' | 'xlsx' | 'pdf' | 'image'> = ['csv', 'xlsx', 'pdf', 'image'];
    const sourceType = allowed.includes(type as any) ? (type as 'csv' | 'xlsx' | 'pdf' | 'image') : 'csv';
    return this.crmImport.createFileImport({
      businessId,
      sourceType,
      originalName: file.originalname,
      fileBuffer: file.buffer,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/import/link')
  async importContactsFromLink(@Param('businessId') businessId: string, @Body('url') url?: string) {
    if (!url) {
      throw new BadRequestException('url is required');
    }
    return this.crmImport.createLinkImport({ businessId, sourceUrl: url });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/import/image/ocr')
  async createContactFromOcr(
    @Param('businessId') businessId: string,
    @Body() body: { ocrText?: string; url?: string; type?: string },
  ) {
    if (!body?.ocrText) {
      throw new BadRequestException('ocrText is required');
    }
    return this.crmImport.createContactFromOcr({
      businessId,
      ocrText: body.ocrText,
      mediaUrl: body.url,
      type: body.type,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/imports')
  listImports(@Param('businessId') businessId: string) {
    return this.crmImport.listImports(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/imports/:importId/records')
  listImportRecords(@Param('businessId') businessId: string, @Param('importId') importId: string) {
    return this.crmImport.listImportRecords(businessId, importId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/contacts/:contactId/events')
  contactEvents(@Param('businessId') businessId: string, @Param('contactId') contactId: string) {
    return this.crm.listContactEvents({ businessId, contactId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/contacts/:contactId/notes')
  contactNotes(@Param('businessId') businessId: string, @Param('contactId') contactId: string) {
    return this.crm.listContactNotes({ businessId, contactId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/tasks')
  listTasks(
    @Param('businessId') businessId: string,
    @Query('contactId') contactId?: string,
    @Query('status') status?: string,
    @Query('dueBefore') dueBefore?: string,
  ) {
    return this.crm.listContactTasks({
      businessId,
      contactId,
      status,
      dueBefore: dueBefore ? new Date(dueBefore) : undefined,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/contacts/:contactId/playbook')
  getPlaybook(@Param('businessId') businessId: string, @Param('contactId') contactId: string) {
    return this.playbook.getOrCreatePlaybook({ businessId, contactId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/contacts/:contactId/playbook')
  updatePlaybook(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: { data: any; type?: string },
  ) {
    return this.playbook.updatePlaybook({
      businessId,
      contactId,
      data: body.data,
      type: body.type,
    });
  }
}
