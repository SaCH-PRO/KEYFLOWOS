import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CrmActionsService } from './crm-actions.service';
import { CrmFlowService } from './crm-flow.service';
import { CrmImportService } from './crm-import.service';
import { CrmJourneyService } from './crm-journey.service';
import { CrmPlaybookService } from './crm-playbook.service';
import { CrmRevenueService } from './crm-revenue.service';
import { CrmStatsService } from './crm-stats.service';
import { CrmTimelineService } from './crm-timeline.service';
import { CrmVisionService } from './crm-vision.service';
import { CrmService } from './crm.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CreateContactDto } from './dto/create-contact.dto';
import { CreateNoteDto } from './dto/create-note.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { CrmRateLimitGuard, CrmRateLimit } from './guards/rate-limit.guard';
import { FeatureFlagGuard, RequireFeature } from './guards/feature-flag.guard';
import { checkAiRateLimit } from './ai-rate-limit.util';
import { memoryStorage } from 'multer';
import type { Express } from 'express';

@Controller('crm')
@UseGuards(CrmRateLimitGuard)
export class CrmController {
  constructor(
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(CrmTimelineService) private readonly timeline: CrmTimelineService,
    @Inject(CrmStatsService) private readonly crmStats: CrmStatsService,
    @Inject(CrmImportService) private readonly crmImport: CrmImportService,
    @Inject(CrmPlaybookService) private readonly playbook: CrmPlaybookService,
    @Inject(CrmVisionService) private readonly vision: CrmVisionService,
    @Inject(CrmFlowService) private readonly flow: CrmFlowService,
    @Inject(CrmActionsService) private readonly actions: CrmActionsService,
    @Inject(CrmRevenueService) private readonly revenue: CrmRevenueService,
    @Inject(CrmJourneyService) private readonly journey: CrmJourneyService,
  ) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(120, 60_000)
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
    @Query('cursor') cursor?: string,
    @Query('includeStats') includeStats?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    const validSortBy = ['name', 'newest', 'oldest', 'revenue', 'score', 'lastInteraction'];
    const validSortOrder = ['asc', 'desc'];
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
      cursor: cursor || undefined,
      includeStats: includeStats === 'true',
      sortBy: sortBy && validSortBy.includes(sortBy) ? sortBy as any : undefined,
      sortOrder: sortOrder && validSortOrder.includes(sortOrder) ? sortOrder as 'asc' | 'desc' : undefined,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/contacts')
  createContact(
    @Param('businessId') businessId: string,
    @Body() body: CreateContactDto,
  ) {
    return this.crm.createContact({ businessId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/poll')
  getContactsPollState(@Param('businessId') businessId: string) {
    return this.crmStats.getContactsPollState(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/favorites')
  getFavorites(@Param('businessId') businessId: string) {
    return this.crmStats.getFavorites(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/:contactId')
  getContactDetail(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.crmStats.contactDetail({ businessId, contactId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Patch('businesses/:businessId/contacts/:contactId')
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
  @CrmRateLimit(10, 60_000)
  @Patch('businesses/:businessId/contacts/bulk')
  bulkUpdateContacts(
    @Param('businessId') businessId: string,
    @Body() body: { contactIds: string[]; status?: string; addTags?: string[] },
  ) {
    if (!Array.isArray(body.contactIds) || body.contactIds.length > 100) {
      throw new HttpException('contactIds must be an array of at most 100 items', 400);
    }
    return this.crm.bulkUpdateContacts({ businessId, contactIds: body.contactIds, status: body.status, addTags: body.addTags });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(10, 60_000)
  @Delete('businesses/:businessId/contacts/bulk')
  bulkDeleteContacts(
    @Param('businessId') businessId: string,
    @Body() body: { contactIds: string[] },
  ) {
    if (!Array.isArray(body.contactIds) || body.contactIds.length > 100) {
      throw new HttpException('contactIds must be an array of at most 100 items', 400);
    }
    return this.crm.bulkDeleteContacts({ businessId, contactIds: body.contactIds });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Delete('businesses/:businessId/contacts/:contactId')
  softDeleteContact(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.crm.softDeleteContact({ businessId, contactId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/merge/:duplicateId')
  mergeContact(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Param('duplicateId') duplicateId: string,
    @Body() body?: { fieldOverrides?: Record<string, unknown> },
  ) {
    return this.crm.mergeContacts({ businessId, primaryId: contactId, duplicateId, fieldOverrides: body?.fieldOverrides });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/notes')
  addNote(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: CreateNoteDto,
    @Req() req: any,
  ) {
    return this.timeline.addNote({
      businessId,
      contactId,
      body: body.body,
      authorId: req?.user?.id,
      source: body.source || 'crm',
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contact-stats')
  getContactStats(@Param('businessId') businessId: string) {
    return this.crmStats.getContactStats(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/segments')
  segmentSummary(@Param('businessId') businessId: string) {
    return this.crmStats.segmentSummary({ businessId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/highlights')
  flowHighlights(@Param('businessId') businessId: string) {
    return this.crmStats.flowHighlights({ businessId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/tasks/due')
  dueTasks(
    @Param('businessId') businessId: string,
    @Query('windowDays') windowDays?: string,
  ) {
    return this.timeline.dueTasks({
      businessId,
      windowDays: windowDays ? Number(windowDays) : 7,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/tasks')
  addTask(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: CreateTaskDto,
    @Req() req: any,
  ) {
    return this.timeline.addTask({
      businessId,
      contactId,
      title: body.title,
      dueDate: body.dueDate,
      priority: body.priority,
      assigneeId: body.assigneeId,
      remindAt: body.remindAt,
      creatorId: req?.user?.id,
      source: body.source || 'crm',
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/tasks/:taskId/complete')
  completeTask(
    @Param('businessId') businessId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.timeline.completeTask({ businessId, taskId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/tasks/:taskId/reopen')
  reopenTask(
    @Param('businessId') businessId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.timeline.reopenTask({ businessId, taskId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Patch('businesses/:businessId/notes/:noteId')
  updateNote(
    @Param('businessId') businessId: string,
    @Param('noteId') noteId: string,
    @Body() body: { body?: string; source?: string },
  ) {
    return this.timeline.updateNote({ businessId, noteId, body: body.body, source: body.source });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Delete('businesses/:businessId/notes/:noteId')
  deleteNote(
    @Param('businessId') businessId: string,
    @Param('noteId') noteId: string,
  ) {
    return this.timeline.deleteNote({ businessId, noteId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Patch('businesses/:businessId/tasks/:taskId')
  updateTask(
    @Param('businessId') businessId: string,
    @Param('taskId') taskId: string,
    @Body() body: { title?: string; dueDate?: string; priority?: string; remindAt?: string },
  ) {
    return this.timeline.updateTask({
      businessId,
      taskId,
      title: body.title,
      dueDate: body.dueDate,
      priority: body.priority,
      remindAt: body.remindAt,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Delete('businesses/:businessId/tasks/:taskId')
  deleteTask(
    @Param('businessId') businessId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.timeline.deleteTask({ businessId, taskId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/autopilot-actions/:actionId/approve')
  approveAutopilotAction(
    @Param('businessId') businessId: string,
    @Param('actionId') actionId: string,
  ) {
    return this.timeline.approveAutopilotAction({ businessId, actionId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/autopilot-actions/:actionId/deny')
  denyAutopilotAction(
    @Param('businessId') businessId: string,
    @Param('actionId') actionId: string,
  ) {
    return this.timeline.denyAutopilotAction({ businessId, actionId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(5, 60_000)
  @Post('businesses/:businessId/import/file')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
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
  @CrmRateLimit(5, 60_000)
  @Post('businesses/:businessId/import/link')
  async importContactsFromLink(@Param('businessId') businessId: string, @Body('url') url?: string) {
    if (!url) {
      throw new BadRequestException('url is required');
    }
    return this.crmImport.createLinkImport({ businessId, sourceUrl: url });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(5, 60_000)
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
  @CrmRateLimit(5, 60_000)
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
    checkAiRateLimit(businessId);
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
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/imports')
  listImports(@Param('businessId') businessId: string) {
    return this.crmImport.listImports(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/imports/:importId/records')
  listImportRecords(@Param('businessId') businessId: string, @Param('importId') importId: string) {
    return this.crmImport.listImportRecords(businessId, importId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(10, 60000)
  @Post('businesses/:businessId/contacts/check-duplicates')
  checkImportDuplicates(
    @Param('businessId') businessId: string,
    @Body() body: { contacts: Array<{ email?: string; phone?: string; firstName?: string; lastName?: string }> },
  ) {
    if (!Array.isArray(body.contacts) || body.contacts.length === 0) {
      throw new BadRequestException('contacts array is required');
    }
    if (body.contacts.length > 100) {
      throw new BadRequestException('Maximum 100 contacts per check');
    }
    return this.crm.checkDuplicates(businessId, body.contacts);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/duplicates')
  findDuplicates(@Param('businessId') businessId: string) {
    return this.crm.findDuplicates(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/log-communication')
  logCommunication(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: { channelType: string; outcome: string; duration?: number; notes?: string },
    @Req() req: any,
  ) {
    if (!body.channelType || !body.outcome) {
      throw new BadRequestException('channelType and outcome are required');
    }
    return this.crm.logCommunication({
      businessId,
      contactId,
      channelType: body.channelType,
      outcome: body.outcome,
      duration: body.duration,
      notes: body.notes,
      actorId: req?.user?.id,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
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
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/events')
  contactEvents(@Param('businessId') businessId: string, @Param('contactId') contactId: string) {
    return this.crm.listContactEvents({ businessId, contactId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/notes')
  contactNotes(@Param('businessId') businessId: string, @Param('contactId') contactId: string) {
    return this.crm.listContactNotes({ businessId, contactId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(120, 60_000)
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
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/playbook')
  getPlaybook(@Param('businessId') businessId: string, @Param('contactId') contactId: string) {
    return this.playbook.getOrCreatePlaybook({ businessId, contactId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
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
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/lists')
  listContactLists(@Param('businessId') businessId: string) {
    return this.crm.listContactLists(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/lists')
  createContactList(
    @Param('businessId') businessId: string,
    @Body() body: { name: string; description?: string; color?: string; type?: string; filters?: any; contactIds?: string[] },
  ) {
    return this.crm.createContactList({ businessId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Put('businesses/:businessId/lists/:listId')
  updateContactList(
    @Param('businessId') businessId: string,
    @Param('listId') listId: string,
    @Body() body: { name?: string; description?: string; color?: string; type?: string; filters?: any; contactIds?: string[] },
  ) {
    return this.crm.updateContactList({ businessId, listId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Delete('businesses/:businessId/lists/:listId')
  deleteContactList(
    @Param('businessId') businessId: string,
    @Param('listId') listId: string,
  ) {
    return this.crm.deleteContactList({ businessId, listId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/lists/:listId/contacts')
  getContactListContacts(
    @Param('businessId') businessId: string,
    @Param('listId') listId: string,
  ) {
    return this.crm.getContactListContacts({ businessId, listId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/lists/:listId/contacts')
  addContactsToList(
    @Param('businessId') businessId: string,
    @Param('listId') listId: string,
    @Body() body: { contactIds: string[] },
  ) {
    return this.crm.addContactsToList({ businessId, listId, contactIds: body.contactIds });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Delete('businesses/:businessId/lists/:listId/contacts/:contactId')
  removeContactFromList(
    @Param('businessId') businessId: string,
    @Param('listId') listId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.crm.removeContactFromList({ businessId, listId, contactId });
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('insights')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/flow-intelligence')
  getFlowIntelligence(@Param('businessId') businessId: string) {
    return this.flow.getFlowIntelligence(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/next-actions')
  getNextActions(@Param('businessId') businessId: string) {
    return this.actions.getNextActions(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/next-actions/:actionId/complete')
  completeNextAction(
    @Param('businessId') businessId: string,
    @Param('actionId') actionId: string,
  ) {
    return this.actions.completeNextAction(businessId, actionId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/autopilot-actions')
  getAutopilotActions(@Param('businessId') businessId: string) {
    return this.actions.getAutopilotActions(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/predictive-revenue')
  getPredictiveRevenue(@Param('businessId') businessId: string) {
    return this.revenue.getPredictiveRevenue(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/financial-growth')
  getFinancialGrowth(@Param('businessId') businessId: string) {
    return this.revenue.getFinancialGrowth(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/health-metrics')
  getContactHealthMetrics(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.journey.getContactHealthMetrics(businessId, contactId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/journey')
  getContactJourney(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.journey.getContactJourney(businessId, contactId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/conversation-context')
  getConversationContext(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.journey.getConversationContext(businessId, contactId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/favorite')
  toggleFavorite(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.crm.toggleFavorite(businessId, contactId);
  }
}
