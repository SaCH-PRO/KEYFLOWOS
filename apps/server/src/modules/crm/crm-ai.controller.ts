import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { CrmAiService } from './crm-ai.service';
import { CrmJourneyService } from './crm-journey.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CrmRateLimitGuard, CrmRateLimit } from './guards/rate-limit.guard';
import { FeatureFlagGuard, RequireFeature } from './guards/feature-flag.guard';
import { checkAiRateLimit } from './ai-rate-limit.util';

@Controller('crm')
@UseGuards(CrmRateLimitGuard)
export class CrmAiController {
  constructor(
    @Inject(CrmAiService) private readonly crmAi: CrmAiService,
    @Inject(CrmJourneyService) private readonly journey: CrmJourneyService,
  ) {}

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/ai-insight')
  getAiInsight(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    checkAiRateLimit(businessId);
    return this.journey.generateAiInsight(businessId, contactId);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/ai-tags')
  aiSuggestTags(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    checkAiRateLimit(businessId);
    return this.crmAi.suggestTags(businessId, contactId);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/ai-prep-brief')
  aiPrepBrief(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    checkAiRateLimit(businessId);
    return this.crmAi.generatePrepBrief(businessId, contactId);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
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

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
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

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
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

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/ai-guidelines')
  getAiGuidelines(@Param('businessId') businessId: string) {
    return this.crmAi.getGuidelines(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(30, 60_000)
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

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/ai-summary')
  aiContactSummary(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    checkAiRateLimit(businessId);
    return this.crmAi.summarizeContact(businessId, contactId);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/ai-score')
  aiLeadScore(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    checkAiRateLimit(businessId);
    return this.crmAi.scoreContactWithAi(businessId, contactId);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
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

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Get('businesses/:businessId/ai-churn-risk')
  aiChurnDetection(@Param('businessId') businessId: string) {
    checkAiRateLimit(businessId);
    return this.crmAi.detectChurnRisk(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
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
}
