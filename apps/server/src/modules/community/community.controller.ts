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
}
