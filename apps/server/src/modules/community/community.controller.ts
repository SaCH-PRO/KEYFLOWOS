import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CommunityService } from './community.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';

@Controller()
export class CommunityController {
  constructor(
    @Inject(CommunityService) private readonly community: CommunityService,
  ) {}

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
    @Query('businessStage') businessStage?: string,
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
    return this.community.searchDirectory({
      search,
      industry,
      city,
      country,
      skills: skills ? skills.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      businessStage,
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
}
