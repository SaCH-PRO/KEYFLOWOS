import { BadRequestException, Body, Controller, Delete, Get, HttpException, HttpStatus, Inject, Param, Patch, Post, Put, Query, Redirect, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CrmAiService } from './crm-ai.service';
import { CrmFlowService } from './crm-flow.service';
import { CrmGoogleService } from './crm-google.service';
import { CrmImportService } from './crm-import.service';
import { CrmListsService } from './crm-lists.service';
import { CrmPlaybookService } from './crm-playbook.service';
import { CrmStatsService } from './crm-stats.service';
import { CrmTimelineService } from './crm-timeline.service';
import { CrmVisionService } from './crm-vision.service';
import { CrmSequenceService } from './crm-sequence.service';
import { CrmService } from './crm.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CreateContactDto } from './dto/create-contact.dto';
import { CreateNoteDto } from './dto/create-note.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { memoryStorage } from 'multer';
import type { Express, Response } from 'express';

const AI_RATE_LIMIT = 10;
const AI_RATE_WINDOW_MS = 60_000;
const aiRateMap = new Map<string, number[]>();

function checkAiRateLimit(businessId: string) {
  const now = Date.now();
  const timestamps = (aiRateMap.get(businessId) ?? []).filter((t) => now - t < AI_RATE_WINDOW_MS);
  if (timestamps.length >= AI_RATE_LIMIT) {
    throw new HttpException('AI rate limit exceeded. Please wait a moment before trying again.', HttpStatus.TOO_MANY_REQUESTS);
  }
  timestamps.push(now);
  aiRateMap.set(businessId, timestamps);
}

@Controller('crm')
export class CrmController {
  constructor(
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(CrmTimelineService) private readonly timeline: CrmTimelineService,
    @Inject(CrmListsService) private readonly lists: CrmListsService,
    @Inject(CrmStatsService) private readonly crmStats: CrmStatsService,
    @Inject(CrmImportService) private readonly crmImport: CrmImportService,
    @Inject(CrmPlaybookService) private readonly playbook: CrmPlaybookService,
    @Inject(CrmVisionService) private readonly vision: CrmVisionService,
    @Inject(CrmGoogleService) private readonly google: CrmGoogleService,
    @Inject(CrmFlowService) private readonly flow: CrmFlowService,
    @Inject(CrmAiService) private readonly crmAi: CrmAiService,
    @Inject(CrmSequenceService) private readonly sequences: CrmSequenceService,
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
  @Post('businesses/:businessId/contacts')
  createContact(
    @Param('businessId') businessId: string,
    @Body() body: CreateContactDto,
  ) {
    return this.crm.createContact({ businessId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/contacts/poll')
  getContactsPollState(@Param('businessId') businessId: string) {
    return this.crmStats.getContactsPollState(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/contacts/favorites')
  getFavorites(@Param('businessId') businessId: string) {
    return this.crmStats.getFavorites(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/contacts/:contactId')
  getContactDetail(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.crmStats.contactDetail({ businessId, contactId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
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
  @Delete('businesses/:businessId/contacts/:contactId')
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
    @Body() body?: { fieldOverrides?: Record<string, unknown> },
  ) {
    return this.crm.mergeContacts({ businessId, primaryId: contactId, duplicateId, fieldOverrides: body?.fieldOverrides });
  }

  @UseGuards(AuthGuard, BusinessGuard)
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
  @Get('businesses/:businessId/contact-stats')
  getContactStats(@Param('businessId') businessId: string) {
    return this.crmStats.getContactStats(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/segments')
  segmentSummary(@Param('businessId') businessId: string) {
    return this.crmStats.segmentSummary({ businessId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/highlights')
  flowHighlights(@Param('businessId') businessId: string) {
    return this.crmStats.flowHighlights({ businessId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
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
  @Post('businesses/:businessId/tasks/:taskId/complete')
  completeTask(
    @Param('businessId') businessId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.timeline.completeTask({ businessId, taskId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/tasks/:taskId/reopen')
  reopenTask(
    @Param('businessId') businessId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.timeline.reopenTask({ businessId, taskId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/notes/:noteId')
  updateNote(
    @Param('businessId') businessId: string,
    @Param('noteId') noteId: string,
    @Body() body: { body?: string; source?: string },
  ) {
    return this.timeline.updateNote({ businessId, noteId, body: body.body, source: body.source });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/notes/:noteId')
  deleteNote(
    @Param('businessId') businessId: string,
    @Param('noteId') noteId: string,
  ) {
    return this.timeline.deleteNote({ businessId, noteId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
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
  @Delete('businesses/:businessId/tasks/:taskId')
  deleteTask(
    @Param('businessId') businessId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.timeline.deleteTask({ businessId, taskId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/autopilot-actions/:actionId/approve')
  approveAutopilotAction(
    @Param('businessId') businessId: string,
    @Param('actionId') actionId: string,
  ) {
    return this.timeline.approveAutopilotAction({ businessId, actionId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/autopilot-actions/:actionId/deny')
  denyAutopilotAction(
    @Param('businessId') businessId: string,
    @Param('actionId') actionId: string,
  ) {
    return this.timeline.denyAutopilotAction({ businessId, actionId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
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
    checkAiRateLimit(businessId);
    return this.flow.generateAiInsight(businessId, contactId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/contacts/:contactId/ai-tags')
  aiSuggestTags(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    checkAiRateLimit(businessId);
    return this.crmAi.suggestTags(businessId, contactId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/contacts/:contactId/ai-prep-brief')
  aiPrepBrief(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    checkAiRateLimit(businessId);
    return this.crmAi.generatePrepBrief(businessId, contactId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/ai-command')
  aiCommand(
    @Param('businessId') businessId: string,
    @Body() body: { command: string },
  ) {
    if (!body.command || typeof body.command !== 'string') {
      throw new BadRequestException('command is required');
    }
    if (body.command.length > 500) {
      throw new BadRequestException('command must be 500 characters or less');
    }
    checkAiRateLimit(businessId);
    return this.crmAi.interpretCommand(businessId, body.command);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/ai-analyze')
  aiAnalyze(
    @Param('businessId') businessId: string,
    @Body() body: { prompt: string; contactIds?: string[] },
  ) {
    if (!body.prompt || typeof body.prompt !== 'string') {
      throw new BadRequestException('prompt is required');
    }
    if (body.prompt.length > 2000) {
      throw new BadRequestException('prompt must be 2000 characters or less');
    }
    if (Array.isArray(body.contactIds) && body.contactIds.length > 100) {
      throw new BadRequestException('Maximum 100 contactIds per request');
    }
    checkAiRateLimit(businessId);
    return this.crmAi.analyzeContacts(businessId, body.prompt, body.contactIds);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/ai-analyze/execute')
  async aiExecuteTasks(
    @Param('businessId') businessId: string,
    @Req() req: any,
    @Body() body: { tasks: Array<{ contactId: string; contactName?: string; title: string; dueDate: string; priority: 'HIGH' | 'NORMAL' | 'LOW' }> },
  ) {
    if (!Array.isArray(body.tasks) || body.tasks.length === 0) {
      throw new BadRequestException('tasks array is required');
    }
    if (body.tasks.length > 100) {
      throw new BadRequestException('Maximum 100 tasks per request');
    }
    const userId = req.user?.id ?? req.user?.sub ?? 'system';
    return this.crmAi.executeTasks(businessId, userId, body.tasks);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai-guidelines')
  getAiGuidelines(@Param('businessId') businessId: string) {
    return this.crmAi.getGuidelines(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/ai-guidelines')
  saveAiGuidelines(
    @Param('businessId') businessId: string,
    @Body() body: { guidelines: string[] },
  ) {
    if (!Array.isArray(body.guidelines)) {
      throw new BadRequestException('guidelines array is required');
    }
    return this.crmAi.saveGuidelines(businessId, body.guidelines);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/contacts/:contactId/ai-summary')
  aiContactSummary(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    checkAiRateLimit(businessId);
    return this.crmAi.summarizeContact(businessId, contactId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/contacts/:contactId/ai-score')
  aiLeadScore(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    checkAiRateLimit(businessId);
    return this.crmAi.scoreContactWithAi(businessId, contactId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/contacts/:contactId/ai-note-analysis')
  aiNoteAnalysis(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: { noteBody: string; noteId?: string },
  ) {
    if (!body.noteBody || typeof body.noteBody !== 'string') {
      throw new BadRequestException('noteBody is required');
    }
    if (body.noteBody.length > 5000) {
      throw new BadRequestException('Note too long (max 5000 chars)');
    }
    checkAiRateLimit(businessId);
    return this.crmAi.analyzeNote(businessId, contactId, body.noteBody, body.noteId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/ai-churn-risk')
  aiChurnDetection(@Param('businessId') businessId: string) {
    checkAiRateLimit(businessId);
    return this.crmAi.detectChurnRisk(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/ai-search')
  aiNaturalLanguageSearch(
    @Param('businessId') businessId: string,
    @Body() body: { query: string },
  ) {
    if (!body.query || typeof body.query !== 'string') {
      throw new BadRequestException('query is required');
    }
    if (body.query.length > 500) {
      throw new BadRequestException('Query too long (max 500 chars)');
    }
    checkAiRateLimit(businessId);
    return this.crmAi.naturalLanguageSearch(businessId, body.query);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/sequences')
  listSequences(@Param('businessId') businessId: string) {
    return this.sequences.listSequences(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/sequences')
  createSequence(
    @Param('businessId') businessId: string,
    @Body() body: { name: string; description?: string; steps: unknown },
  ) {
    return this.sequences.createSequence(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/sequences/:id')
  getSequence(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.sequences.getSequence(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/sequences/:id')
  updateSequence(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string; steps?: unknown; status?: string },
  ) {
    return this.sequences.updateSequence(businessId, id, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/sequences/:id')
  deleteSequence(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.sequences.deleteSequence(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/sequences/:id/duplicate')
  duplicateSequence(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.sequences.duplicateSequence(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/sequences/:id/enroll')
  enrollContacts(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { contactIds: string[] },
  ) {
    return this.sequences.enrollContacts(businessId, id, body.contactIds);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/contacts/:contactId/favorite')
  toggleFavorite(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.crm.toggleFavorite(businessId, contactId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/sequences/:id/enrollments/:enrollmentId/advance')
  advanceEnrollment(
    @Param('businessId') businessId: string,
    @Param('enrollmentId') enrollmentId: string,
  ) {
    return this.sequences.advanceEnrollment(businessId, enrollmentId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/sequences/:id/enrollments/:enrollmentId/unenroll')
  unenrollContact(
    @Param('businessId') businessId: string,
    @Param('enrollmentId') enrollmentId: string,
  ) {
    return this.sequences.unenrollContact(businessId, enrollmentId);
  }
}
