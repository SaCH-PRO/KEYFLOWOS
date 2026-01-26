import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { SocialService } from './social.service';
import { CreateSocialConnectionDto } from './dto/create-social-connection.dto';
import { CreateSocialPostDto } from './dto/create-social-post.dto';
import { UpdateSocialPostDto } from './dto/update-social-post.dto';

@Controller('social')
export class SocialController {
  constructor(private readonly social: SocialService) {}

  @Get('health')
  health() {
    return { status: 'ok', module: 'social' };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/posts')
  createPost(@Param('businessId') businessId: string, @Body() body: CreateSocialPostDto) {
    return this.social.createDraft(businessId, body.content, body.mediaUrls ?? []);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/posts')
  listPosts(@Param('businessId') businessId: string, @Query('status') status?: string) {
    return this.social.listPosts(businessId, status);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/posts/:postId')
  updatePost(
    @Param('businessId') businessId: string,
    @Param('postId') postId: string,
    @Body() body: UpdateSocialPostDto,
  ) {
    return this.social.updatePost(businessId, postId, {
      content: body.content,
      mediaUrls: body.mediaUrls,
      status: body.status,
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/posts/:postId/publish')
  publish(@Param('businessId') businessId: string, @Param('postId') postId: string) {
    return this.social.publishPost(businessId, postId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/posts/:postId')
  deletePost(@Param('businessId') businessId: string, @Param('postId') postId: string) {
    return this.social.deletePost(businessId, postId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/connections')
  listConnections(@Param('businessId') businessId: string) {
    return this.social.listConnections(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/connections')
  createConnection(
    @Param('businessId') businessId: string,
    @Body() body: CreateSocialConnectionDto,
  ) {
    return this.social.createConnection(businessId, {
      platform: body.platform,
      platformId: body.platformId,
      token: body.token,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/connections/:connectionId')
  deleteConnection(
    @Param('businessId') businessId: string,
    @Param('connectionId') connectionId: string,
  ) {
    return this.social.deleteConnection(businessId, connectionId);
  }
}
