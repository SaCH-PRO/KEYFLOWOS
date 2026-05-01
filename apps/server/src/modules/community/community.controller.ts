import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { CommunityService } from './community.service';
import { ReputationService } from './reputation.service';
import { OpportunityService } from './opportunity.service';
import { PartnerProgramService } from './partner-program.service';
import { ResourceMarketplaceService } from './resource-marketplace.service';
import { NetworkActivityService } from './network-activity.service';
import { NetworkAnalyticsService } from './network-analytics.service';
import { BusinessMatchingService } from '../ai/business-matching.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { OptionalAuthGuard } from '../../core/auth/optional-auth.guard';
import { PrismaService } from '../../core/prisma/prisma.service';

@Controller()
export class CommunityController {
  constructor(
    @Inject(CommunityService) private readonly community: CommunityService,
    @Inject(ReputationService) private readonly reputation: ReputationService,
    @Inject(BusinessMatchingService) private readonly matching: BusinessMatchingService,
    @Inject(OpportunityService) private readonly opportunities: OpportunityService,
    @Inject(PartnerProgramService) private readonly partners: PartnerProgramService,
    @Inject(ResourceMarketplaceService) private readonly resources: ResourceMarketplaceService,
    @Inject(NetworkActivityService) private readonly activity: NetworkActivityService,
    @Inject(NetworkAnalyticsService) private readonly analytics: NetworkAnalyticsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  private async getRequesterBusinessIds(req: any): Promise<string[]> {
    const userId = req?.user?.id;
    if (!userId) return [];
    const businesses = await this.prisma.client.business.findMany({
      where: { OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
      select: { id: true },
    });
    return businesses.map((b) => b.id);
  }

  @UseGuards(AuthGuard)
  @Get('community/posts')
  listPosts(
    @Query('type') type?: string,
    @Query('tag') tag?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.community.listPosts({
      type,
      tag,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @UseGuards(AuthGuard)
  @Get('community/posts/:id')
  getPost(@Param('id') id: string) {
    return this.community.getPost(id);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/community/posts')
  createPost(
    @Param('businessId') businessId: string,
    @Body() body: { title?: string; content: string; type?: string; tags?: string[] },
  ) {
    return this.community.createPost(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/community/posts/:postId')
  updatePost(
    @Param('businessId') businessId: string,
    @Param('postId') postId: string,
    @Body() body: { title?: string; content?: string; type?: string; tags?: string[] },
  ) {
    return this.community.updatePost(businessId, postId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/community/posts/:postId')
  deletePost(
    @Param('businessId') businessId: string,
    @Param('postId') postId: string,
  ) {
    return this.community.deletePost(businessId, postId);
  }

  @UseGuards(AuthGuard)
  @Post('community/posts/:postId/like')
  likePost(@Param('postId') postId: string) {
    return this.community.likePost(postId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/community/posts/:postId/comments')
  addComment(
    @Param('businessId') businessId: string,
    @Param('postId') postId: string,
    @Body() body: { content: string },
  ) {
    return this.community.addComment(businessId, postId, body.content);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/community/comments/:commentId')
  deleteComment(
    @Param('businessId') businessId: string,
    @Param('commentId') commentId: string,
  ) {
    return this.community.deleteComment(businessId, commentId);
  }

  @UseGuards(AuthGuard)
  @Get('community/cohorts')
  listCohorts() {
    return this.community.listCohorts();
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/community/cohorts/:cohortId/join')
  joinCohort(
    @Param('businessId') businessId: string,
    @Param('cohortId') cohortId: string,
  ) {
    return this.community.joinCohort(businessId, cohortId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/community/cohorts/:cohortId/leave')
  leaveCohort(
    @Param('businessId') businessId: string,
    @Param('cohortId') cohortId: string,
  ) {
    return this.community.leaveCohort(businessId, cohortId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/community/my-cohorts')
  getMyCohorts(@Param('businessId') businessId: string) {
    return this.community.getMyCohorts(businessId);
  }

  @UseGuards(AuthGuard)
  @Get('community/directory')
  searchDirectory(
    @Query('search') search?: string,
    @Query('industry') industry?: string,
    @Query('city') city?: string,
    @Query('country') country?: string,
    @Query('skills') skills?: string,
    @Query('skill') skill?: string,
    @Query('businessStage') businessStage?: string,
    @Query('stage') stage?: string,
    @Query('acceptingWork') acceptingWork?: string,
    @Query('currentCapacity') currentCapacity?: string,
    @Query('budgetFit') budgetFit?: string,
    @Query('serviceType') serviceType?: string,
    @Query('priceMin') priceMin?: string,
    @Query('priceMax') priceMax?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sort') sort?: string,
  ) {
    const resolvedSkills = skills || skill;
    return this.community.searchDirectory({
      search,
      industry,
      city,
      country,
      skills: resolvedSkills ? resolvedSkills.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      businessStage: businessStage || stage,
      acceptingWork: acceptingWork !== undefined ? acceptingWork === 'true' : undefined,
      currentCapacity,
      budgetFit,
      serviceType,
      priceMin: priceMin ? parseFloat(priceMin) : undefined,
      priceMax: priceMax ? parseFloat(priceMax) : undefined,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      sort,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/community/connections')
  createConnection(
    @Param('businessId') businessId: string,
    @Body() body: { toBusinessId: string; type?: 'FOLLOW' | 'SAVE' },
  ) {
    const connectionType = body.type === 'SAVE' ? 'SAVE' : 'FOLLOW';
    return this.community.createConnection(businessId, body.toBusinessId, connectionType);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/community/connections')
  removeConnection(
    @Param('businessId') businessId: string,
    @Body() body: { toBusinessId: string; type?: 'FOLLOW' | 'SAVE' },
  ) {
    const connectionType = body.type === 'SAVE' ? 'SAVE' : 'FOLLOW';
    return this.community.removeConnection(businessId, body.toBusinessId, connectionType);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/community/connections')
  getConnections(
    @Param('businessId') businessId: string,
    @Query('direction') direction?: string,
    @Query('type') type?: string,
  ) {
    return this.community.getConnections(
      businessId,
      (direction === 'to' ? 'to' : 'from') as 'from' | 'to',
      type,
    );
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/community/connection-status/:targetId')
  getConnectionStatus(
    @Param('businessId') businessId: string,
    @Param('targetId') targetId: string,
  ) {
    return this.community.getConnectionStatus(businessId, targetId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/community/recommendations')
  getRecommendations(
    @Param('businessId') businessId: string,
    @Query('refresh') refresh?: string,
  ) {
    return this.matching.getRecommendations(businessId, refresh === 'true');
  }

  @UseGuards(AuthGuard)
  @Get('community/trust-signals/:businessId')
  getTrustSignals(@Param('businessId') businessId: string) {
    return this.community.getTrustSignals(businessId);
  }

  @UseGuards(AuthGuard)
  @Get('community/endorsements/:businessId')
  getEndorsements(@Param('businessId') businessId: string) {
    return this.community.getEndorsements(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/community/endorsements-given/:targetId')
  getMyEndorsementsGiven(
    @Param('businessId') businessId: string,
    @Param('targetId') targetId: string,
  ) {
    return this.community.getMyEndorsementsGiven(businessId, targetId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/community/endorsements')
  createEndorsement(
    @Param('businessId') businessId: string,
    @Body() body: { toBusinessId: string; skill: string; message?: string },
  ) {
    return this.community.createEndorsement(businessId, body.toBusinessId, body.skill, body.message);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/community/endorsements')
  updateEndorsement(
    @Param('businessId') businessId: string,
    @Body() body: { toBusinessId: string; skill: string; message: string },
  ) {
    return this.community.updateEndorsement(businessId, body.toBusinessId, body.skill, body.message);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/community/endorsements')
  removeEndorsement(
    @Param('businessId') businessId: string,
    @Body() body: { toBusinessId: string; skill: string },
  ) {
    return this.community.removeEndorsement(businessId, body.toBusinessId, body.skill);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/community/match-analytics')
  getMatchAnalytics(@Param('businessId') businessId: string) {
    return this.matching.getMatchAnalytics(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/community/intro-draft')
  draftIntroMessage(
    @Param('businessId') businessId: string,
    @Body() body: { toBusinessId: string; context?: string; goal?: 'introduce' | 'collaborate' | 'quote' | 'referral' },
  ) {
    return this.matching.draftIntroMessage(businessId, body.toBusinessId, {
      context: body.context,
      goal: body.goal,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/community/need-matches')
  matchProvidersForNeed(
    @Param('businessId') businessId: string,
    @Body() body: {
      title?: string;
      description: string;
      budgetMin?: number;
      budgetMax?: number;
      timeline?: string;
      projectType?: string;
      categoryHint?: string;
      limit?: number;
    },
  ) {
    const { limit, ...need } = body;
    return this.matching.matchProvidersForNeed(businessId, need, limit ?? 5);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/community/relationship-insights')
  getRelationshipInsights(@Param('businessId') businessId: string) {
    return this.matching.getRelationshipInsights(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/community/relationship-insights/dismiss')
  dismissRelationshipInsight(
    @Param('businessId') businessId: string,
    @Body() body: { targetBusinessId: string; snoozeDays?: number },
  ) {
    return this.matching.dismissRelationshipInsight(businessId, body.targetBusinessId, body.snoozeDays);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/community/relationship-insights/dismiss/:targetBusinessId')
  restoreRelationshipInsight(
    @Param('businessId') businessId: string,
    @Param('targetBusinessId') targetBusinessId: string,
  ) {
    return this.matching.restoreRelationshipInsight(businessId, targetBusinessId);
  }

  // ==========================================
  // QUOTE REQUESTS
  // ==========================================

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/community/quote-requests')
  createQuoteRequest(
    @Param('businessId') businessId: string,
    @Body() body: {
      toBusinessId: string;
      title: string;
      description: string;
      budgetMin?: number;
      budgetMax?: number;
      currency?: string;
      timeline?: string;
      attachments?: string[];
    },
  ) {
    return this.community.createQuoteRequest(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/community/quote-requests')
  listQuoteRequests(
    @Param('businessId') businessId: string,
    @Query('direction') direction?: 'sent' | 'received',
  ) {
    return this.community.listQuoteRequests(businessId, direction);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/community/quote-requests/:requestId/respond')
  respondToQuoteRequest(
    @Param('businessId') businessId: string,
    @Param('requestId') requestId: string,
    @Body() body: { status: 'RESPONDED' | 'DECLINED'; responseNote?: string },
  ) {
    return this.community.respondToQuoteRequest(businessId, requestId, body);
  }

  // ==========================================
  // REFERRALS
  // ==========================================

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/community/referrals')
  createReferral(
    @Param('businessId') businessId: string,
    @Body() body: {
      toBusinessId: string;
      referredToName: string;
      referredToEmail?: string;
      referredToPhone?: string;
      opportunity: string;
      context?: string;
    },
  ) {
    return this.community.createReferral(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/community/referrals')
  listReferrals(
    @Param('businessId') businessId: string,
    @Query('direction') direction?: 'sent' | 'received',
  ) {
    return this.community.listReferrals(businessId, direction);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/community/referrals/:referralId/status')
  updateReferralStatus(
    @Param('businessId') businessId: string,
    @Param('referralId') referralId: string,
    @Body() body: { status: 'VIEWED' | 'ACCEPTED' | 'COMPLETED' | 'DECLINED'; statusNote?: string },
  ) {
    return this.community.updateReferralStatus(businessId, referralId, body);
  }

  // ==========================================
  // COLLABORATIONS
  // ==========================================

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/community/collaborations')
  createCollaboration(
    @Param('businessId') businessId: string,
    @Body() body: {
      toBusinessId: string;
      type?: string;
      title: string;
      scope: string;
      proposedTerms?: string;
      timeline?: string;
    },
  ) {
    return this.community.createCollaboration(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/community/collaborations')
  listCollaborations(
    @Param('businessId') businessId: string,
    @Query('direction') direction?: 'sent' | 'received',
  ) {
    return this.community.listCollaborations(businessId, direction);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/community/collaborations/:collabId/respond')
  respondToCollaboration(
    @Param('businessId') businessId: string,
    @Param('collabId') collabId: string,
    @Body() body: { status: 'ACCEPTED' | 'DECLINED'; responseNote?: string },
  ) {
    return this.community.respondToCollaboration(businessId, collabId, body);
  }

  // ==========================================
  // MESSAGING
  // ==========================================

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/community/messages')
  sendMessage(
    @Param('businessId') businessId: string,
    @Body() body: { toBusinessId: string; content: string },
  ) {
    return this.community.sendMessage(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/community/conversations')
  getConversations(@Param('businessId') businessId: string) {
    return this.community.getConversations(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/community/conversations/:conversationId')
  getConversationMessages(
    @Param('businessId') businessId: string,
    @Param('conversationId') conversationId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.community.getConversationMessages(
      businessId,
      conversationId,
      page ? parseInt(page, 10) : undefined,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/community/messages/unread-count')
  getUnreadMessageCount(@Param('businessId') businessId: string) {
    return this.community.getUnreadMessageCount(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/community/collab-requests')
  createCollabRequest(
    @Param('businessId') businessId: string,
    @Body() body: { toBusinessId: string; type?: string; title: string; message?: string },
  ) {
    return this.community.createCollabRequest(businessId, body.toBusinessId, {
      type: body.type,
      title: body.title,
      message: body.message,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/community/collab-requests/:requestId')
  respondToCollabRequest(
    @Param('businessId') businessId: string,
    @Param('requestId') requestId: string,
    @Body() body: { status: 'ACCEPTED' | 'DECLINED' },
  ) {
    return this.community.respondToCollabRequest(businessId, requestId, body.status);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/community/collab-requests')
  getCollabRequests(
    @Param('businessId') businessId: string,
    @Query('direction') direction?: string,
    @Query('status') status?: string,
  ) {
    return this.community.getCollabRequests(
      businessId,
      (direction === 'outgoing' ? 'outgoing' : 'incoming') as 'incoming' | 'outgoing',
      status,
    );
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/community/notifications')
  getNotifications(
    @Param('businessId') businessId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.community.getNotifications(
      businessId,
      page ? parseInt(page, 10) : undefined,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/community/notifications/:notificationId/read')
  markNotificationRead(
    @Param('businessId') businessId: string,
    @Param('notificationId') notificationId: string,
  ) {
    return this.community.markNotificationRead(businessId, notificationId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/community/notifications/read-all')
  markAllNotificationsRead(@Param('businessId') businessId: string) {
    return this.community.markAllNotificationsRead(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/community/notifications/unread-count')
  getUnreadNotificationCount(@Param('businessId') businessId: string) {
    return this.community.getUnreadNotificationCount(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/community/match-feedback')
  submitMatchFeedback(
    @Param('businessId') businessId: string,
    @Body() body: { targetBusinessId: string; feedback: 'HELPFUL' | 'DISMISSED'; matchScore?: number; matchType?: string },
  ) {
    return this.matching.submitFeedback(businessId, body.targetBusinessId, body.feedback, body.matchScore, body.matchType);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/community/match-feedback')
  getMatchFeedback(@Param('businessId') businessId: string) {
    return this.matching.getFeedback(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/community/messages/threads')
  listThreads(@Param('businessId') businessId: string) {
    return this.community.listThreads(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/community/messages/thread/:otherBusinessId')
  getThread(
    @Param('businessId') businessId: string,
    @Param('otherBusinessId') otherBusinessId: string,
  ) {
    return this.community.getThread(businessId, otherBusinessId);
  }

  // ==========================================
  // SAVED BUSINESSES / SHORTLIST
  // ==========================================

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/community/saved')
  saveBusiness(
    @Param('businessId') businessId: string,
    @Body() body: { savedBusinessId: string; note?: string },
  ) {
    return this.community.saveBusiness(businessId, body.savedBusinessId, body.note);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/community/saved/:savedBusinessId')
  unsaveBusiness(
    @Param('businessId') businessId: string,
    @Param('savedBusinessId') savedBusinessId: string,
  ) {
    return this.community.unsaveBusiness(businessId, savedBusinessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/community/saved')
  listSavedBusinesses(@Param('businessId') businessId: string) {
    return this.community.listSavedBusinesses(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/community/saved/check/:targetBusinessId')
  isBusinessSaved(
    @Param('businessId') businessId: string,
    @Param('targetBusinessId') targetBusinessId: string,
  ) {
    return this.community.isBusinessSaved(businessId, targetBusinessId);
  }

  // ==========================================
  // INTERACTION HISTORY
  // ==========================================

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/community/history/:otherBusinessId')
  getInteractionHistory(
    @Param('businessId') businessId: string,
    @Param('otherBusinessId') otherBusinessId: string,
  ) {
    return this.community.getInteractionHistory(businessId, otherBusinessId);
  }

  // ==========================================
  // REVIEWS & REPUTATION
  // ==========================================

  @UseGuards(AuthGuard)
  @Get('community/reputation/:businessId')
  getReputation(@Param('businessId') businessId: string) {
    return this.reputation.getOrCompute(businessId);
  }

  @UseGuards(AuthGuard)
  @Get('community/reviews/:businessId')
  getReviewsForBusiness(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
  ) {
    return this.reputation.listReviewsForBusiness(businessId, limit ? parseInt(limit, 10) : 20);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/community/reviews/given')
  getReviewsByBusiness(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
  ) {
    return this.reputation.listReviewsByBusiness(businessId, limit ? parseInt(limit, 10) : 20);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/community/reviewable/:otherBusinessId')
  getReviewableTransactions(
    @Param('businessId') businessId: string,
    @Param('otherBusinessId') otherBusinessId: string,
  ) {
    return this.reputation.getReviewableTransactions(businessId, otherBusinessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/community/reviews')
  createReview(
    @Param('businessId') businessId: string,
    @Body() body: {
      revieweeBusinessId: string;
      transactionType: 'QUOTE_REQUEST' | 'COLLABORATION' | 'REFERRAL';
      transactionId: string;
      rating: number;
      title?: string;
      body?: string;
      qualityRating?: number;
      communicationRating?: number;
      timelinessRating?: number;
      isPublic?: boolean;
    },
  ) {
    return this.reputation.createReview(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/community/reviews/:reviewId')
  deleteReview(
    @Param('businessId') businessId: string,
    @Param('reviewId') reviewId: string,
  ) {
    return this.reputation.deleteReview(businessId, reviewId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/community/referrals/:referralId/outcome')
  markReferralOutcome(
    @Param('businessId') businessId: string,
    @Param('referralId') referralId: string,
    @Body() body: { outcome: 'CONVERTED' | 'NOT_CONVERTED'; note?: string },
  ) {
    return this.reputation.markReferralOutcome(businessId, referralId, body.outcome, body.note);
  }

  // ==========================================
  // OPPORTUNITY BOARD (Phase 5)
  // ==========================================

  @UseGuards(AuthGuard)
  @Get('community/opportunities')
  listOpportunities(
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.opportunities.list({
      type, status, category, search,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @UseGuards(AuthGuard)
  @Get('community/opportunities/:id')
  async getOpportunity(@Param('id') id: string, @Req() req: any) {
    const requesterBusinessIds = await this.getRequesterBusinessIds(req);
    return this.opportunities.getById(id, requesterBusinessIds);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/community/opportunities')
  createOpportunity(
    @Param('businessId') businessId: string,
    @Body() body: any,
  ) {
    return this.opportunities.create(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/community/opportunities/mine')
  listMyOpportunities(@Param('businessId') businessId: string) {
    return this.opportunities.listMine(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/community/opportunities/:id')
  updateOpportunity(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.opportunities.update(businessId, id, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/community/opportunities/:id/close')
  closeOpportunity(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.opportunities.close(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/community/opportunities/:id')
  deleteOpportunity(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.opportunities.delete(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/community/opportunities/:id/apply')
  applyToOpportunity(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { message: string; proposedBudget?: number; proposedTimeline?: string; attachments?: string[] },
  ) {
    return this.opportunities.apply(businessId, id, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/community/opportunity-applications/mine')
  listMyApplications(@Param('businessId') businessId: string) {
    return this.opportunities.listMyApplications(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/community/opportunity-applications/:id/respond')
  respondToOpportunityApplication(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { status: 'SHORTLISTED' | 'AWARDED' | 'DECLINED'; responseNote?: string },
  ) {
    return this.opportunities.respondToApplication(businessId, id, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/community/opportunity-applications/:id/withdraw')
  withdrawApplication(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.opportunities.withdrawApplication(businessId, id);
  }

  // ==========================================
  // PARTNER PROGRAMS (Phase 5)
  // ==========================================

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/community/partner-programs')
  proposePartnerProgram(
    @Param('businessId') businessId: string,
    @Body() body: any,
  ) {
    return this.partners.propose(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/community/partner-programs')
  listPartnerPrograms(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
  ) {
    return this.partners.listForBusiness(businessId, { status });
  }

  @UseGuards(AuthGuard)
  @Get('community/partner-programs/profile/:businessId')
  listPublicPartnerProgramsForProfile(@Param('businessId') businessId: string) {
    return this.partners.listPublicForProfile(businessId);
  }

  @UseGuards(AuthGuard)
  @Get('community/partner-programs/:id')
  getPartnerProgram(@Param('id') id: string) {
    return this.partners.getById(id);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/community/partner-programs/:id/respond')
  respondToPartnerProgram(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { status: 'ACTIVE' | 'DECLINED'; responseNote?: string },
  ) {
    return this.partners.respond(businessId, id, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/community/partner-programs/:id/terminate')
  terminatePartnerProgram(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { note?: string },
  ) {
    return this.partners.terminate(businessId, id, body?.note);
  }

  // ==========================================
  // RESOURCE MARKETPLACE (Phase 5)
  // ==========================================

  @UseGuards(AuthGuard)
  @Get('community/resources')
  listResources(
    @Query('resourceType') resourceType?: string,
    @Query('search') search?: string,
    @Query('isFree') isFree?: string,
    @Query('businessId') businessId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.resources.list({
      resourceType,
      search,
      isFree: isFree === 'true' ? true : isFree === 'false' ? false : undefined,
      businessId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @UseGuards(AuthGuard)
  @Get('community/resources/:id')
  getResource(@Param('id') id: string) {
    return this.resources.getById(id);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/community/resources')
  publishResource(
    @Param('businessId') businessId: string,
    @Body() body: any,
  ) {
    return this.resources.publish(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/community/resources/mine')
  listMyResources(@Param('businessId') businessId: string) {
    return this.resources.listForBusiness(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/community/resources/:id/download')
  recordResourceDownload(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { source?: string },
  ) {
    return this.resources.recordDownload(businessId, id, body?.source);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/community/resource-downloads/mine')
  listMyResourceDownloads(@Param('businessId') businessId: string) {
    return this.resources.listMyDownloads(businessId);
  }

  // ==========================================
  // NETWORK ACTIVITY FEED (Phase 5)
  // ==========================================

  @UseGuards(AuthGuard)
  @Get('community/activity')
  listActivityFeed(
    @Query('types') types?: string,
    @Query('actorBusinessId') actorBusinessId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.activity.listFeed({
      types: types ? types.split(',').filter(Boolean) : undefined,
      actorBusinessId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/community/activity/following')
  listFollowingActivity(
    @Param('businessId') businessId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.activity.listFeed({
      followingOf: businessId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @UseGuards(AuthGuard)
  @Get('community/activity/business/:businessId')
  listActivityForBusiness(@Param('businessId') businessId: string) {
    return this.activity.listForActor(businessId);
  }

  // ==========================================
  // NETWORK ANALYTICS (Phase 5)
  // ==========================================

  @UseGuards(OptionalAuthGuard)
  @Post('community/profile-views/:viewedBusinessId')
  async recordProfileView(
    @Param('viewedBusinessId') viewedBusinessId: string,
    @Body() body: { viewerBusinessId?: string; source?: string },
    @Req() req: any,
  ) {
    // Derive viewer business from authenticated session, never trust body alone.
    // If a viewerBusinessId is supplied, it must belong to the authenticated user.
    let viewerBusinessId: string | null = null;
    const requesterBusinessIds = await this.getRequesterBusinessIds(req);
    if (requesterBusinessIds.length > 0) {
      if (body?.viewerBusinessId && requesterBusinessIds.includes(body.viewerBusinessId)) {
        viewerBusinessId = body.viewerBusinessId;
      } else {
        viewerBusinessId = requesterBusinessIds[0];
      }
    }
    return this.analytics.recordProfileView(viewedBusinessId, viewerBusinessId, body?.source);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/community/analytics/dashboard')
  getAnalyticsDashboard(
    @Param('businessId') businessId: string,
    @Query('days') days?: string,
  ) {
    return this.analytics.getDashboard(businessId, days ? parseInt(days, 10) : 30);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/community/analytics/recent-viewers')
  getRecentViewers(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
  ) {
    return this.analytics.listRecentViewers(businessId, limit ? parseInt(limit, 10) : 20);
  }
}
