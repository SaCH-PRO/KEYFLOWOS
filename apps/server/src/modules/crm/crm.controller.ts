import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, Redirect, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CrmFlowService } from './crm-flow.service';
import { CrmGoogleService } from './crm-google.service';
import { CrmImportService } from './crm-import.service';
import { CrmPlaybookService } from './crm-playbook.service';
import { CrmVisionService } from './crm-vision.service';
import { CrmService } from './crm.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CreateContactDto } from './dto/create-contact.dto';
import { CreateNoteDto } from './dto/create-note.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { memoryStorage } from 'multer';
import type { Express, Response } from 'express';

@Controller('crm')
export class CrmController {
  constructor(
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(CrmImportService) private readonly crmImport: CrmImportService,
    @Inject(CrmPlaybookService) private readonly playbook: CrmPlaybookService,
    @Inject(CrmVisionService) private readonly vision: CrmVisionService,
    @Inject(CrmGoogleService) private readonly google: CrmGoogleService,
    @Inject(CrmFlowService) private readonly flow: CrmFlowService,
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
  @Patch('businesses/:businessId/contacts/bulk')
  bulkUpdateContacts(
    @Param('businessId') businessId: string,
    @Body() body: { contactIds: string[]; status?: string; addTags?: string[] },
  ) {
    return this.crm.bulkUpdateContacts({ businessId, contactIds: body.contactIds, status: body.status, addTags: body.addTags });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/contacts/bulk-delete')
  bulkDeleteContacts(
    @Param('businessId') businessId: string,
    @Body() body: { contactIds: string[] },
  ) {
    return this.crm.bulkDeleteContacts({ businessId, contactIds: body.contactIds });
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
  @Delete('businesses/:businessId/notes/:noteId')
  deleteNote(
    @Param('businessId') businessId: string,
    @Param('noteId') noteId: string,
  ) {
    return this.crm.deleteNote({ businessId, noteId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/tasks/:taskId')
  deleteTask(
    @Param('businessId') businessId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.crm.deleteTask({ businessId, taskId });
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
    const allowed: Array<'csv' | 'xlsx' | 'pdf' | 'image' | 'vcf'> = ['csv', 'xlsx', 'pdf', 'image', 'vcf'];
    const sourceType = allowed.includes(type as any) ? (type as 'csv' | 'xlsx' | 'pdf' | 'image' | 'vcf') : 'csv';
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
  @Post('businesses/:businessId/import/scan')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async scanContactImage(
    @Param('businessId') businessId: string,
    @UploadedFile() image: Express.Multer.File,
  ) {
    if (!image || !image.buffer) {
      throw new BadRequestException('Image file is required');
    }
    const base64 = `data:${image.mimetype || 'image/jpeg'};base64,${image.buffer.toString('base64')}`;
    const extracted = await this.vision.extractContactFromImage(base64);
    if (!extracted.firstName && !extracted.lastName && !extracted.email && !extracted.phone) {
      throw new BadRequestException('Could not extract any contact information from this image. Try a clearer photo.');
    }
    const contact = await this.crm.findOrCreateContact(businessId, {
      firstName: extracted.firstName,
      lastName: extracted.lastName,
      email: extracted.email,
      phone: extracted.phone,
      companyName: extracted.companyName,
      source: 'scan',
      sourceDetail: 'business_card',
    });
    return { contact, extracted };
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
  @Get('businesses/:businessId/duplicates')
  findDuplicates(@Param('businessId') businessId: string) {
    return this.crm.findDuplicates(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/contacts/:contactId/events')
  createEvent(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: { type: string; description?: string; data?: any },
    @Req() req: any,
  ) {
    return this.crm.logContactEvent({
      businessId,
      contactId,
      type: body.type,
      data: { description: body.description, ...(body.data ?? {}) },
      actorType: 'USER',
      actorId: req?.user?.id,
      source: 'crm',
    });
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

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/google/auth-url')
  getGoogleAuthUrl(@Param('businessId') businessId: string) {
    const url = this.google.getAuthUrl(businessId);
    return { url };
  }

  @Get('google/callback')
  async handleGoogleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const frontendUrl = process.env.REPLIT_DEV_DOMAIN 
      ? `https://${process.env.REPLIT_DEV_DOMAIN}` 
      : 'http://localhost:5000';

    if (!code || !state) {
      return res.redirect(`${frontendUrl}/app/crm/pipeline?google_error=missing_params`);
    }

    const verifiedState = this.google.verifyState(state);
    if (!verifiedState) {
      return res.redirect(`${frontendUrl}/app/crm/pipeline?google_error=invalid_state`);
    }

    try {
      const tokens = await this.google.exchangeCodeForTokens(code);
      const result = await this.google.importGoogleContacts({
        businessId: verifiedState.businessId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
      });

      return res.redirect(`${frontendUrl}/app/crm/pipeline?google_success=true&imported=${result.imported}`);
    } catch (err) {
      return res.redirect(`${frontendUrl}/app/crm/pipeline?google_error=${encodeURIComponent((err as Error).message)}`);
    }
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/google/import')
  async importFromGoogle(
    @Param('businessId') businessId: string,
    @Body() body: { accessToken: string; refreshToken?: string },
  ) {
    if (!body.accessToken) {
      throw new BadRequestException('accessToken is required');
    }
    return this.google.importGoogleContacts({
      businessId,
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/lists')
  listContactLists(@Param('businessId') businessId: string) {
    return this.crm.listContactLists(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/lists')
  createContactList(
    @Param('businessId') businessId: string,
    @Body() body: { name: string; description?: string; color?: string; type?: string; filters?: any; contactIds?: string[] },
  ) {
    return this.crm.createContactList({ businessId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Put('businesses/:businessId/lists/:listId')
  updateContactList(
    @Param('businessId') businessId: string,
    @Param('listId') listId: string,
    @Body() body: { name?: string; description?: string; color?: string; type?: string; filters?: any; contactIds?: string[] },
  ) {
    return this.crm.updateContactList({ businessId, listId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/lists/:listId')
  deleteContactList(
    @Param('businessId') businessId: string,
    @Param('listId') listId: string,
  ) {
    return this.crm.deleteContactList({ businessId, listId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/lists/:listId/contacts')
  getContactListContacts(
    @Param('businessId') businessId: string,
    @Param('listId') listId: string,
  ) {
    return this.crm.getContactListContacts({ businessId, listId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/lists/:listId/contacts')
  addContactsToList(
    @Param('businessId') businessId: string,
    @Param('listId') listId: string,
    @Body() body: { contactIds: string[] },
  ) {
    return this.crm.addContactsToList({ businessId, listId, contactIds: body.contactIds });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/lists/:listId/contacts/:contactId')
  removeContactFromList(
    @Param('businessId') businessId: string,
    @Param('listId') listId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.crm.removeContactFromList({ businessId, listId, contactId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/flow-intelligence')
  getFlowIntelligence(@Param('businessId') businessId: string) {
    return this.flow.getFlowIntelligence(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/next-actions')
  getNextActions(@Param('businessId') businessId: string) {
    return this.flow.getNextActions(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/next-actions/:actionId/complete')
  completeNextAction(
    @Param('businessId') businessId: string,
    @Param('actionId') actionId: string,
  ) {
    return this.flow.completeNextAction(businessId, actionId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/autopilot-actions')
  getAutopilotActions(@Param('businessId') businessId: string) {
    return this.flow.getAutopilotActions(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/predictive-revenue')
  getPredictiveRevenue(@Param('businessId') businessId: string) {
    return this.flow.getPredictiveRevenue(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/contacts/:contactId/health-metrics')
  getContactHealthMetrics(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.flow.getContactHealthMetrics(businessId, contactId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/contacts/:contactId/journey')
  getContactJourney(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.flow.getContactJourney(businessId, contactId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/contacts/:contactId/conversation-context')
  getConversationContext(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.flow.getConversationContext(businessId, contactId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/contacts/:contactId/ai-insight')
  getAiInsight(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.flow.generateAiInsight(businessId, contactId);
  }
}
